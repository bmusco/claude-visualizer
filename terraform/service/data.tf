data "aws_vpc" "vpc" {
  filter {
    name   = "tag:terraform-name"
    values = [local.vpc-name]
  }
}

data "aws_subnets" "subnets" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.vpc.id]
  }
  filter {
    name   = "tag:role-type"
    values = [var.subnet-role]
  }
}

data "aws_lb" "shared-alb" {
  name = local.shared-alb-name
}

data "aws_lb_listener" "shared-alb443" {
  load_balancer_arn = data.aws_lb.shared-alb.arn
  port              = 443
}

data "aws_security_group" "alb" {
  filter {
    name   = "group-id"
    values = data.aws_lb.shared-alb.security_groups
  }
}
