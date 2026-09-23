output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}

output "db_master_secret_arn" {
  value = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "github_deploy_role_arns" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN variable on the matching GitHub environment."
  value       = { for k, r in aws_iam_role.github_deploy : k => r.arn }
}

# Values the deploy workflow needs to run a one-off migrate/bootstrap task.
output "run_task_network" {
  value = {
    cluster         = aws_ecs_cluster.main.name
    subnets         = aws_subnet.public[*].id
    security_groups = [aws_security_group.app.id]
  }
}

output "services" {
  value = {
    for k, m in module.service : k => {
      service        = m.service_name
      app_family     = m.app_task_family
      migrate_family = m.migrate_task_family
      log_group      = m.log_group_name
    }
  }
}
