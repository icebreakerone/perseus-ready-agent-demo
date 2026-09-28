locals {
  certs_dir = "/tmp/perseus/certs"
  image     = "${aws_ecr_repository.web.repository_url}:${var.image_tag}"
  secret    = aws_secretsmanager_secret.app.arn

  # PEM environment variable in the container => key in the Secrets Manager
  # secret. docker/web-entrypoint.sh writes each to the file the app reads.
  certificate_secrets = {
    CLIENT_KEY_PEM           = "client_key"
    CLIENT_CERT_PEM          = "client_cert"
    CLIENT_INTERMEDIATE_PEM  = "client_intermediate"
    CLIENT_ROOT_CA_PEM       = "client_root_ca"
    SIGNING_KEY_PEM          = "signing_key"
    SIGNING_CERT_PEM         = "signing_cert"
    SIGNING_INTERMEDIATE_PEM = "signing_intermediate"
    SIGNING_ROOT_CA_PEM      = "signing_root_ca"
  }

  web_environment = merge(var.app_config, {
    APP_URL           = "https://${var.domain_name}"
    CLIENT_KEY_PATH   = "${local.certs_dir}/client/key.pem"
    CLIENT_CERT_PATH  = "${local.certs_dir}/client/cert.pem"
    CLIENT_CA_DIR     = "${local.certs_dir}/directory-client-certificates"
    SIGNING_KEY_PATH  = "${local.certs_dir}/signing/key.pem"
    SIGNING_CERT_PATH = "${local.certs_dir}/signing/cert.pem"
    SIGNING_CA_DIR    = "${local.certs_dir}/directory-signing-certificates"
  })
}

resource "aws_ecs_cluster" "main" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  volume {
    name = "data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.data.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.data.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name         = "web"
      image        = local.image
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment  = [for key, value in local.web_environment : { name = key, value = value }]
      secrets = concat(
        [for name, key in local.certificate_secrets : { name = name, valueFrom = "${local.secret}:${key}::" }],
        [{ name = "SESSION_SECRET", valueFrom = "${local.secret}:session_secret::" }],
      )
      # The app keeps sessions and the permission log in <cwd>/.data.
      mountPoints = [{ sourceVolume = "data", containerPath = "/app/.data" }]
      healthCheck = {
        command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.web.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "web"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "app" {
  name                   = var.name
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.app.arn
  launch_type            = "FARGATE"
  desired_count          = 1
  enable_execute_command = var.enable_execute_command
  # Sessions are plain files on EFS with no locking: never run two tasks at
  # once, even during a deployment (at the cost of a short outage while it
  # rolls).
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  health_check_grace_period_seconds  = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.https, aws_efs_mount_target.data]
}
