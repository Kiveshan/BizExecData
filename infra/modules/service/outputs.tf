output "target_group_arn" {
  value = aws_lb_target_group.this.arn
}

output "service_name" {
  value = aws_ecs_service.this.name
}

output "app_task_family" {
  value = aws_ecs_task_definition.app.family
}

output "migrate_task_family" {
  value = aws_ecs_task_definition.migrate.family
}

output "role_arns" {
  description = "Roles the deploy workflow must be allowed to pass to ECS."
  value = [
    aws_iam_role.execution.arn,
    aws_iam_role.migrate_execution.arn,
    aws_iam_role.task.arn,
  ]
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.this.name
}
