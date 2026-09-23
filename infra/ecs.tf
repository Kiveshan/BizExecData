resource "aws_ecs_cluster" "main" {
  name = "bizexec"

  setting {
    name  = "containerInsights"
    value = "disabled" # enable if per-task CPU/memory metrics are needed (extra cost)
  }
}

locals {
  services = {
    staging = {
      desired_count          = 1
      public_url             = "https://staging.${var.domain}"
      quickbooks_environment = "sandbox"
    }
    production = {
      # Two tasks in two AZs: a deploy or a single failure never takes the
      # site down, unlike the single EB instance.
      desired_count          = 2
      public_url             = "https://${var.domain}"
      quickbooks_environment = "production"
    }
  }
}

module "service" {
  source   = "./modules/service"
  for_each = local.services

  environment       = each.key
  cluster_arn       = aws_ecs_cluster.main.arn
  vpc_id            = aws_vpc.main.id
  subnet_ids        = aws_subnet.public[*].id
  security_group_id = aws_security_group.app.id
  image             = "${aws_ecr_repository.app.repository_url}:${var.initial_image_tag}"

  desired_count          = each.value.desired_count
  public_url             = each.value.public_url
  quickbooks_environment = each.value.quickbooks_environment

  db_host              = aws_db_instance.main.address
  db_name              = local.environments[each.key].db_name
  db_master_secret_arn = aws_db_instance.main.master_user_secret[0].secret_arn

  app_secret_arn          = aws_secretsmanager_secret.app[each.key].arn
  integrations_secret_arn = aws_secretsmanager_secret.integrations[each.key].arn
  integration_keys        = local.integration_keys
}
