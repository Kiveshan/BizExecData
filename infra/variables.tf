variable "region" {
  type    = string
  default = "af-south-1"
}

variable "aws_profile" {
  description = "Local AWS CLI profile. Set to null in CI, where OIDC credentials come from the environment."
  type        = string
  default     = "BizExec"
}

variable "domain" {
  type    = string
  default = "bizexecdata.co.za"
}

variable "github_repository" {
  description = "owner/name allowed to assume the deploy roles via OIDC."
  type        = string
  default     = "Kiveshan/BizExecData"
}

# ─── Database ────────────────────────────────────────────────────────────────

variable "db_snapshot_identifier" {
  description = "Snapshot of the old bizexec-prod instance that the new database is restored from. Only read at creation."
  type        = string
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_multi_az" {
  description = "Standby in a second AZ. Roughly doubles database cost; the old instance had it on."
  type        = bool
  default     = true
}

# ─── Services ────────────────────────────────────────────────────────────────

variable "initial_image_tag" {
  description = <<-EOT
    ECR tag the task definitions are first created with. After that CI owns the
    image: each deploy takes the family's latest revision, swaps the image and
    registers a new one, so Terraform-side env/secret changes ride along with
    the next deploy rather than being lost.
  EOT
  type        = string
}
