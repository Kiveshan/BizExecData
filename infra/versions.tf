terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Bucket is created by infra/bootstrap. S3-native locking (no DynamoDB).
  backend "s3" {
    bucket       = "bizexec-terraform-state-845235958349"
    key          = "main/terraform.tfstate"
    region       = "af-south-1"
    profile      = "BizExec"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = "BizExecData"
      ManagedBy = "terraform"
    }
  }
}
