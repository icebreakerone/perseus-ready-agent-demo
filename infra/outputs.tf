output "url" {
  value = "https://${var.domain_name}"
}

output "ecr_repository" {
  value = aws_ecr_repository.web.repository_url
}

output "secret_arn" {
  description = "Set its value with scripts/put-secrets.sh."
  value       = aws_secretsmanager_secret.app.arn
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "service" {
  value = aws_ecs_service.app.name
}

output "edp_redirect_uri" {
  description = "The OAuth redirect URI the app sends to the EDP."
  value       = "https://${var.domain_name}/api/auth/callback"
}
