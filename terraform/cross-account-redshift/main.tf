# This module creates an IAM role in the PROD account (062438643287)
# that allows the claudio ECS task in the DEV account (423031077609)
# to query Redshift Serverless via the Data API.
#
# Apply with: terraform apply -var="claudio_task_role_arn=arn:aws:iam::423031077609:role/int-tools-container-role-claudio"

terraform {
  required_version = ">= 1.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.98.0"
    }
  }
}

variable "claudio_task_role_arn" {
  type        = string
  description = "ARN of the claudio ECS task role in the dev account"
  default     = "arn:aws:iam::423031077609:role/int-tools-container-role-claudio"
}

variable "redshift_workgroup" {
  type    = string
  default = "prod-research"
}

variable "region" {
  type    = string
  default = "us-west-2"
}

provider "aws" {
  region = var.region
}

# IAM role that the claudio ECS task assumes to query Redshift
resource "aws_iam_role" "claudio_redshift_query" {
  name = "claudio-redshift-query"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { AWS = var.claudio_task_role_arn }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    managed-by = "terraform"
    purpose    = "claudio cross-account redshift query access"
  }
}

resource "aws_iam_role_policy" "redshift_data_api" {
  name = "redshift-data-api-access"
  role = aws_iam_role.claudio_redshift_query.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RedshiftDataAPI"
        Effect = "Allow"
        Action = [
          "redshift-data:ExecuteStatement",
          "redshift-data:DescribeStatement",
          "redshift-data:GetStatementResult",
          "redshift-data:CancelStatement",
          "redshift-data:ListStatements"
        ]
        Resource = "*"
      },
      {
        Sid    = "RedshiftServerlessAccess"
        Effect = "Allow"
        Action = [
          "redshift-serverless:GetCredentials",
          "redshift-serverless:GetWorkgroup",
          "redshift-serverless:GetNamespace"
        ]
        Resource = "*"
      }
    ]
  })
}

output "role_arn" {
  value       = aws_iam_role.claudio_redshift_query.arn
  description = "Set REDSHIFT_CROSS_ACCOUNT_ROLE env var to this value"
}
