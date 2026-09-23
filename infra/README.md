# Infrastructure (ECS Fargate, af-south-1)

```
internet ─► ALB (80→443, host routing) ─► ECS Fargate tasks (public subnets, inbound from ALB only)
                                               │
                                               ▼
                                   RDS Postgres 17 (private subnets, no public endpoint)
```

| | staging | production |
|---|---|---|
| Host | `staging.bizexecdata.co.za` | `bizexecdata.co.za`, `www.` |
| Tasks | 1 | 2 (two AZs) |
| Database | `bizexec_staging` | `postgres` (restored data) |
| DB login | `bizexec_staging_app` | `bizexec_prod_app` |
| QuickBooks | sandbox | production |

Both databases live on one RDS instance. App roles have data access only;
migrations and `scripts/db-bootstrap.js` run as the RDS-managed master user
through the `*-migrate` task definition.

## Secrets

| Secret | Contents | Managed by |
|---|---|---|
| `bizexec/<env>/app` | `SESSION_SECRET`, `ENCRYPTION_KEY`, `DB_USER`, `DB_PASSWORD` | Terraform (generated) |
| `bizexec/<env>/integrations` | `CLIENT_ID`, `CLIENT_SECRET`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `SAGE_API_KEY` | By hand; never in Terraform |
| RDS master | `username`, `password` | RDS (auto-rotated) |

After changing a Terraform-managed env var or secret, run the Deploy
workflow: CI registers each new task revision from the latest one, so the
change takes effect on the next deploy.

## Deploying

Push to `main` → tests → image built once → staging (migrations, then rolling
update) → **approval** → production with the same image. A deploy whose new
tasks never become healthy is rolled back automatically by ECS and the
workflow fails.

By hand: `scripts/ecs-deploy.sh <staging|production> <image>`

## Debugging a live task

```bash
aws ecs execute-command --cluster bizexec --task <task-id> --container app --interactive --command sh
aws logs tail /ecs/bizexec-production --follow
```

## First-time setup

1. `cd infra/bootstrap && terraform init && terraform apply` (state bucket)
2. Snapshot the old DB: `aws rds create-db-snapshot --db-instance-identifier bizexec-prod --db-snapshot-identifier bizexec-prod-migration`
3. `cd infra && terraform init`
4. `terraform apply -target=aws_ecr_repository.app`, then build and push the first image tagged with the git SHA
5. Set `db_snapshot_identifier` and `initial_image_tag` in `terraform.tfvars`, then `terraform plan` → review → `terraform apply`
6. Fill `bizexec/<env>/integrations`
7. `scripts/ecs-deploy.sh <env> <image> --bootstrap` for staging, then production
8. `scripts/ecs-deploy.sh staging <image>`, verify, then production
9. Cutover: `prod_dns_target = "ecs"` → apply. Roll back: set it to `"eb"` → apply.

## Rolling back

- **Bad deploy:** ECS rolls back by itself. To pin an older image, rerun `scripts/ecs-deploy.sh <env> <older-image>`.
- **Cutover problem:** `prod_dns_target = "eb"`, `terraform apply`.
