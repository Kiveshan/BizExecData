# One environment of the app: target group, task definitions (web + migrate),
# IAM roles and the ECS service.

locals {
  name = "bizexec-${var.environment}"

  common_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "DB_HOST", value = var.db_host },
    { name = "DB_PORT", value = "5432" },
    { name = "DB_NAME", value = var.db_name },
  ]

  app_environment = concat(local.common_environment, [
    { name = "APP_ENV", value = var.environment },
    { name = "CORS_ORIGIN", value = var.public_url },
    { name = "QB_ENVIRONMENT", value = var.quickbooks_environment },
    { name = "REDIRECT_URI", value = "${var.public_url}/callback" },
    { name = "XERO_REDIRECT_URI", value = "${var.public_url}/auth/xero/callback" },
  ])

  # ECS resolves "<secret-arn>:<json-key>::" to a single field of a JSON secret.
  app_secrets = concat(
    [for k in ["SESSION_SECRET", "ENCRYPTION_KEY", "DB_USER", "DB_PASSWORD"] :
    { name = k, valueFrom = "${var.app_secret_arn}:${k}::" }],
    [for k in var.integration_keys :
    { name = k, valueFrom = "${var.integrations_secret_arn}:${k}::" }],
  )

  # Migrations and the bootstrap script run as the RDS master user.
  migrate_secrets = [
    { name = "DB_USER", valueFrom = "${var.db_master_secret_arn}:username::" },
    { name = "DB_PASSWORD", valueFrom = "${var.db_master_secret_arn}:password::" },
    # Read by scripts/db-bootstrap.js to set the app role's password.
    { name = "APP_DB_USER", valueFrom = "${var.app_secret_arn}:DB_USER::" },
    { name = "APP_DB_PASSWORD", valueFrom = "${var.app_secret_arn}:DB_PASSWORD::" },
  ]

  log_config = {
    logDriver = "awslogs"
    options = {
      "awslogs-group"         = aws_cloudwatch_log_group.this.name
      "awslogs-region"        = data.aws_region.current.region
      "awslogs-stream-prefix" = "app"
    }
  }
}

data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days
}

# ─── IAM ─────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by ECS itself to pull the image, write logs and inject secrets.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = [var.app_secret_arn, var.integrations_secret_arn]
    }]
  })
}

# Separate execution role for the migrate task: the only one that can read
# the database master secret.
resource "aws_iam_role" "migrate_execution" {
  name               = "${local.name}-migrate-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "migrate_execution_managed" {
  role       = aws_iam_role.migrate_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "migrate_execution_secrets" {
  name = "read-migrate-secrets"
  role = aws_iam_role.migrate_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = [var.db_master_secret_arn, var.app_secret_arn]
    }]
  })
}

# The running container's own identity. The app calls no AWS APIs; the only
# permissions are for ECS Exec, so we can open a shell in a live task instead
# of being blind the way we were on Elastic Beanstalk.
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "task_exec" {
  name = "ecs-exec"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
      ]
      Resource = "*"
    }]
  })
}

# ─── Task definitions ────────────────────────────────────────────────────────
# CI registers every revision after the first (new image, same everything
# else), so Terraform ignores container_definitions drift.

resource "aws_ecs_task_definition" "app" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name                   = "app"
    image                  = var.image
    essential              = true
    readonlyRootFilesystem = false
    portMappings           = [{ containerPort = 3000, protocol = "tcp" }]
    environment            = local.app_environment
    secrets                = local.app_secrets
    logConfiguration       = local.log_config
    stopTimeout            = 30
  }])

  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.migrate_execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name             = "migrate"
    image            = var.image
    essential        = true
    command          = ["npx", "prisma", "migrate", "deploy"]
    environment      = concat(local.common_environment, [{ name = "APP_ENV", value = var.environment }])
    secrets          = local.migrate_secrets
    logConfiguration = merge(local.log_config, { options = merge(local.log_config.options, { "awslogs-stream-prefix" = "migrate" }) })
  }])

  lifecycle {
    ignore_changes = [container_definitions]
  }
}

# ─── Load balancing + service ────────────────────────────────────────────────

resource "aws_lb_target_group" "this" {
  name        = local.name
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  deregistration_delay = 30

  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "this" {
  listener_arn = var.listener_arn
  priority     = var.listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }

  condition {
    host_header {
      values = var.hosts
    }
  }
}

resource "aws_ecs_service" "this" {
  # ECS refuses to attach a service to a target group that no listener uses
  # yet, so the rule must exist first.
  depends_on = [aws_lb_listener_rule.this]

  name            = local.name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  enable_execute_command            = true
  health_check_grace_period_seconds = 60

  # Keep full capacity during a deploy, and if the new tasks never become
  # healthy, roll back automatically instead of hanging.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_id]
    assign_public_ip = true # outbound only; inbound is locked to the ALB
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = "app"
    container_port   = 3000
  }

  lifecycle {
    ignore_changes = [task_definition] # owned by the deploy workflow
  }
}
