resource "aws_lb_target_group" "tg-shared" {
  name                 = local.tg-shared-name
  port                 = var.container-port
  protocol             = "HTTP"
  protocol_version     = "HTTP1"
  target_type          = var.network-mode == "awsvpc" ? "ip" : "instance"
  vpc_id               = data.aws_vpc.vpc.id
  deregistration_delay = var.alb-deregistration-delay

  health_check {
    protocol = "HTTP"
    path     = "/health"
  }

  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400
    enabled         = true
  }

  tags = {
    terraform-name = local.tg-shared-name
  }
}

resource "aws_lb_listener_rule" "service-rule" {
  listener_arn = data.aws_lb_listener.shared-alb443.arn
  priority     = var.alb-listener-priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.tg-shared.arn
  }

  condition {
    host_header {
      values = [var.api-hostname]
    }
  }

  tags = {
    terraform-name = "${var.service-name}-listener-rule"
  }
}
