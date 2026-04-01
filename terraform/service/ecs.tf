resource "aws_cloudwatch_log_group" "service" {
  name              = local.log-group-name
  retention_in_days = var.log-retention-days
  tags = {
    terraform-name = local.log-group-name
  }
}

resource "aws_ecs_task_definition" "service" {
  family                   = "${var.token}-${var.service-name}"
  network_mode             = var.network-mode
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.task-execution-role.arn
  task_role_arn            = aws_iam_role.task-role.arn

  container_definitions = jsonencode([
    {
      name  = var.service-name
      image = local.service-image
      portMappings = [
        {
          hostPort      = var.container-port
          protocol      = "tcp"
          containerPort = var.container-port
        }
      ]
      essential   = true
      entryPoint  = ["/app/entrypoint.sh"]
      command     = ["node", "server.js"]
      environment = [
        { name = "PORT", value = tostring(var.container-port) },
        { name = "CORS_ORIGIN", value = var.frontend-url },
        { name = "NODE_ENV", value = "production" },
        { name = "AWS_DEFAULT_REGION", value = var.region },
      ]
      secrets = [
        {
          name      = "CLAUDE_CONFIG_TAR_B64"
          valueFrom = aws_secretsmanager_secret.claude-config.arn
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.service.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = var.service-name
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:${var.container-port}/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
    },
    {
      name      = "pgproxy"
      image     = "${var.container-registry}/${var.service-repo-prefix}/claudio-pgproxy:main"
      essential = false
      portMappings = [
        {
          hostPort      = 13626
          protocol      = "tcp"
          containerPort = 13626
        }
      ]
      environment = [
        { name = "AWS_DEFAULT_REGION", value = var.region },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.service.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "pgproxy"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "test -f /usr/local/bin/cmtpgproxy"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
    }
  ])

  tags = {
    terraform-name = "${var.token}-${var.service-name}"
  }
}

resource "aws_ecs_service" "service" {
  name            = var.service-name
  cluster         = "arn:aws:ecs:${var.region}:${var.aws-id}:cluster/${var.token}-${var.cluster-name}"
  task_definition = aws_ecs_task_definition.service.arn
  desired_count   = var.desired-count

  enable_execute_command = var.enable-execute-command

  dynamic "capacity_provider_strategy" {
    for_each = var.capacity-provider-strategy
    content {
      capacity_provider = capacity_provider_strategy.value.capacity_provider
      base              = capacity_provider_strategy.value.base
      weight            = capacity_provider_strategy.value.weight
    }
  }

  depends_on = [aws_lb_listener_rule.service-rule]

  load_balancer {
    target_group_arn = aws_lb_target_group.tg-shared.arn
    container_name   = var.service-name
    container_port   = var.container-port
  }

  deployment_circuit_breaker {
    enable   = var.enable-circuit-breaker
    rollback = var.circuit-breaker-rollback
  }

  dynamic "network_configuration" {
    for_each = var.network-mode == "awsvpc" ? ["awsvpc"] : []
    content {
      assign_public_ip = false
      subnets          = data.aws_subnets.subnets.ids
      security_groups  = [aws_security_group.task.id]
    }
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  tags = {
    terraform-name = var.service-name
  }
}
