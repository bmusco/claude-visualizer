data "aws_iam_policy_document" "ecs-assume-role-policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "task-policy" {
  statement {
    sid = "BedrockInvoke"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:ListFoundationModels",
    ]
    resources = ["*"]
  }

  statement {
    sid = "CloudWatchLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["*"]
  }

  statement {
    sid = "SSMSessionManager"
    actions = [
      "ssm:StartSession",
      "ssm:TerminateSession",
      "ssm:ResumeSession",
      "ssm:DescribeSessions",
      "ssm:GetConnectionStatus",
    ]
    resources = ["*"]
  }

  statement {
    sid = "SSMMessages"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }

  statement {
    sid = "RedshiftCredentials"
    actions = [
      "redshift:GetClusterCredentials",
      "redshift:GetClusterCredentialsWithIAM",
      "redshift:DescribeClusters",
    ]
    resources = ["*"]
  }

  statement {
    sid = "EC2DescribeForGateway"
    actions = [
      "ec2:DescribeInstances",
    ]
    resources = ["*"]
  }

  statement {
    sid = "STSAssumeRole"
    actions = [
      "sts:AssumeRole",
      "sts:GetCallerIdentity",
    ]
    resources = ["*"]
  }
}

data "aws_iam_policy_document" "task-execution-policy" {
  statement {
    actions = [
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["*"]
  }

  statement {
    sid     = "GetSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      "arn:aws:secretsmanager:${var.region}:${var.aws-id}:secret:${var.token}/${var.service-name}/*"
    ]
  }
}

resource "aws_iam_role" "task-role" {
  assume_role_policy = data.aws_iam_policy_document.ecs-assume-role-policy.json
  description        = "IAM role for ${var.service-name} ECS task"
  name               = "${var.token}-container-role-${var.service-name}"
  tags = {
    terraform-name = "${var.token}-container-role-${var.service-name}"
  }
}

resource "aws_iam_role" "task-execution-role" {
  assume_role_policy = data.aws_iam_policy_document.ecs-assume-role-policy.json
  description        = "IAM role for ${var.service-name} ECS task execution"
  name               = "${var.token}-task-execution-role-${var.service-name}"
  tags = {
    terraform-name = "${var.token}-task-execution-role-${var.service-name}"
  }
}

resource "aws_iam_policy" "task-policy" {
  name   = "${var.token}-container-policy-${var.service-name}"
  policy = data.aws_iam_policy_document.task-policy.json
}

resource "aws_iam_policy" "task-execution-policy" {
  name   = "${var.token}-container-execution-policy-${var.service-name}"
  policy = data.aws_iam_policy_document.task-execution-policy.json
}

resource "aws_iam_role_policy_attachment" "task-role-attach" {
  role       = aws_iam_role.task-role.name
  policy_arn = aws_iam_policy.task-policy.arn
}

resource "aws_iam_role_policy_attachment" "task-execution-role-attach" {
  role       = aws_iam_role.task-execution-role.name
  policy_arn = aws_iam_policy.task-execution-policy.arn
}
