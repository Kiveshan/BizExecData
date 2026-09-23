variable "environment" {
  description = "staging or production"
  type        = string
}

variable "cluster_arn" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "image" {
  description = "Full image reference used when the task definitions are first created."
  type        = string
}

variable "desired_count" {
  type = number
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "public_url" {
  description = "https://host the environment is served on; used for OAuth redirect URIs and CORS."
  type        = string
}

variable "quickbooks_environment" {
  description = "sandbox or production"
  type        = string
}

variable "db_host" {
  type = string
}

variable "db_name" {
  type = string
}

variable "app_secret_arn" {
  type = string
}

variable "integrations_secret_arn" {
  type = string
}

variable "integration_keys" {
  type = list(string)
}

variable "db_master_secret_arn" {
  description = "RDS-managed master secret; only the migrate task definition can read it."
  type        = string
}

variable "log_retention_days" {
  type    = number
  default = 30
}
