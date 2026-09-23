# New Postgres instance, restored from a snapshot of the old bizexec-prod so
# all existing data comes across. Lives in private subnets with no public
# endpoint.
#
# Databases on this instance:
#   postgres         production data (name inherited from the old instance)
#   bizexec_staging  staging, created by scripts/db-bootstrap.js
#
# The master password is generated and rotated by RDS in Secrets Manager —
# the restored copy's old (publicly leaked) password stops working once this
# instance is created. The master login is used only for migrations and the
# bootstrap script; the app connects as per-environment least-privilege roles.

resource "aws_db_subnet_group" "main" {
  name       = "bizexec"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "postgres17" {
  name   = "bizexec-postgres17"
  family = "postgres17"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot" # what RDS reports back; avoids a perpetual diff
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000" # log queries slower than 1s
  }
}

resource "aws_db_instance" "main" {
  identifier          = "bizexec-db"
  snapshot_identifier = var.db_snapshot_identifier

  instance_class    = var.db_instance_class
  storage_type      = "gp3"
  allocated_storage = 20
  multi_az          = var.db_multi_az

  # Inherited from the (encrypted) snapshot. Must be stated: left unset,
  # Terraform reads it as "not encrypted" and plans to REPLACE the instance.
  storage_encrypted = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.postgres17.name
  publicly_accessible    = false
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  manage_master_user_password = true

  backup_retention_period    = 7
  backup_window              = "01:00-02:00" # 03:00-04:00 SAST
  maintenance_window         = "sun:02:30-sun:03:30"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "bizexec-db-final"

  lifecycle {
    # Any plan that would destroy or replace the database fails outright
    # instead of relying on someone spotting "must be replaced" in a diff.
    prevent_destroy = true

    # Only meaningful at creation; changing it later must never trigger a
    # replace (which would restore over live data).
    ignore_changes = [snapshot_identifier]
  }
}
