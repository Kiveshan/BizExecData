# Two secrets per environment:
#
#   bizexec/<env>/app           generated here: session secret, encryption key,
#                               and the env's least-privilege DB login
#   bizexec/<env>/integrations  QuickBooks / Xero / Sage credentials. Terraform
#                               creates the container only; values are filled
#                               out of band so they never enter state or code.

locals {
  environments = {
    staging = {
      db_name = "bizexec_staging"
      db_user = "bizexec_staging_app"
    }
    production = {
      db_name = "postgres"
      db_user = "bizexec_prod_app"
    }
  }

  integration_keys = [
    "CLIENT_ID",
    "CLIENT_SECRET",
    "XERO_CLIENT_ID",
    "XERO_CLIENT_SECRET",
    "SAGE_API_KEY",
  ]
}

resource "random_password" "session_secret" {
  for_each = local.environments
  length   = 64
  special  = false
}

# AES-256 needs exactly 32 bytes; alphanumeric keeps it one byte per char.
resource "random_password" "encryption_key" {
  for_each = local.environments
  length   = 32
  special  = false
}

resource "random_password" "db_app" {
  for_each = local.environments
  length   = 40
  special  = false
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.environments

  name                    = "bizexec/${each.key}/app"
  description             = "Generated app secrets and DB login for ${each.key}"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  for_each = local.environments

  secret_id = aws_secretsmanager_secret.app[each.key].id
  secret_string = jsonencode({
    SESSION_SECRET = random_password.session_secret[each.key].result
    ENCRYPTION_KEY = random_password.encryption_key[each.key].result
    DB_USER        = each.value.db_user
    DB_PASSWORD    = random_password.db_app[each.key].result
  })
}

resource "aws_secretsmanager_secret" "integrations" {
  for_each = local.environments

  name                    = "bizexec/${each.key}/integrations"
  description             = "QuickBooks, Xero and Sage credentials for ${each.key} (values managed outside Terraform)"
  recovery_window_in_days = 7
}

# Placeholder so the ECS secret references resolve; overwritten out of band
# and never reverted because of ignore_changes.
resource "aws_secretsmanager_secret_version" "integrations" {
  for_each = local.environments

  secret_id     = aws_secretsmanager_secret.integrations[each.key].id
  secret_string = jsonencode({ for k in local.integration_keys : k => "UNSET" })

  lifecycle {
    ignore_changes = [secret_string, version_stages]
  }
}
