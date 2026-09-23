# GitHub Actions authenticates with short-lived OIDC tokens instead of
# long-lived AWS keys. Each GitHub *environment* maps to its own role, so a
# job can only touch production after passing that environment's required
# reviewers.

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
}

data "aws_iam_policy_document" "github_assume" {
  for_each = local.services

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${each.key}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  for_each = local.services

  name                 = "bizexec-github-deploy-${each.key}"
  assume_role_policy   = data.aws_iam_policy_document.github_assume[each.key].json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  for_each = local.services

  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Only staging builds and pushes. Production deploys the exact image that
  # already passed staging, so it only needs to confirm the image exists.
  statement {
    sid = "EcrRepo"
    actions = concat(
      ["ecr:DescribeImages", "ecr:BatchGetImage", "ecr:BatchCheckLayerAvailability"],
      each.key == "staging" ? [
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage",
      ] : []
    )
    resources = [aws_ecr_repository.app.arn]
  }

  # These ECS actions do not support resource-level scoping.
  statement {
    sid       = "EcsTaskDefinitions"
    actions   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition", "ecs:DescribeTasks"]
    resources = ["*"]
  }

  statement {
    sid       = "EcsService"
    actions   = ["ecs:UpdateService", "ecs:DescribeServices"]
    resources = ["arn:aws:ecs:${var.region}:${local.account_id}:service/${aws_ecs_cluster.main.name}/${module.service[each.key].service_name}"]
  }

  statement {
    sid     = "EcsRunMigrations"
    actions = ["ecs:RunTask"]
    resources = [
      "arn:aws:ecs:${var.region}:${local.account_id}:task-definition/${module.service[each.key].migrate_task_family}:*",
    ]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  statement {
    sid       = "PassOnlyThisEnvironmentsRoles"
    actions   = ["iam:PassRole"]
    resources = module.service[each.key].role_arns
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid       = "ReadMigrationLogs"
    actions   = ["logs:GetLogEvents", "logs:FilterLogEvents"]
    resources = ["arn:aws:logs:${var.region}:${local.account_id}:log-group:${module.service[each.key].log_group_name}:*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  for_each = local.services

  name   = "deploy"
  role   = aws_iam_role.github_deploy[each.key].id
  policy = data.aws_iam_policy_document.github_deploy[each.key].json
}
