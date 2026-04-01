terraform {
  required_version = ">= 1.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.98.0"
    }
  }
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      token        = var.token
      managed-by   = "terraform"
      cmt-service  = "internal-tools"
      service-name = var.service-name
      tf_repo_path = var.tf_repo_path
    }
  }
  assume_role {
    role_arn = "arn:aws:iam::${var.aws-id}:role/${var.super-admin-role}"
  }
}
