resource "aws_security_group" "task" {
  name        = "${var.token}-${var.service-name}"
  description = "for ${var.token}-${var.service-name} ecs task"
  vpc_id      = data.aws_vpc.vpc.id

  tags = {
    Name           = "${var.token}-${var.service-name}"
    terraform-name = "${var.token}-${var.service-name}"
  }
}

resource "aws_security_group_rule" "in-elb-http" {
  description              = "ingress from ALB to ${var.service-name} container"
  type                     = "ingress"
  from_port                = var.container-port
  to_port                  = var.container-port
  protocol                 = "tcp"
  source_security_group_id = data.aws_security_group.alb.id
  security_group_id        = aws_security_group.task.id
}

resource "aws_security_group_rule" "container-out-https" {
  description       = "${var.service-name} egress for HTTPS (Bedrock, ECR, SSM, Secrets Manager)"
  type              = "egress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.task.id
}

resource "aws_security_group_rule" "container-out-redshift" {
  description       = "${var.service-name} egress for Redshift (via SSM tunnel)"
  type              = "egress"
  from_port         = 5439
  to_port           = 5439
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.task.id
}

resource "aws_security_group_rule" "elb-out-container" {
  description              = "ALB egress to ${var.service-name} container"
  type                     = "egress"
  from_port                = var.container-port
  to_port                  = var.container-port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.task.id
  security_group_id        = data.aws_security_group.alb.id
}
