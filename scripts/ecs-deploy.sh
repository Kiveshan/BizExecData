#!/usr/bin/env bash
#
# Deploy one image to one environment on ECS:
#   1. run database migrations as a one-off task (as the RDS master user)
#   2. roll the web service onto the new image and wait until it is healthy
#
# Usage:
#   scripts/ecs-deploy.sh <staging|production> <image>              # deploy
#   scripts/ecs-deploy.sh <staging|production> <image> --bootstrap  # only run scripts/db-bootstrap.js
#
# Used by .github/workflows/deploy.yml and for the very first deploy by hand.
# Requires: aws CLI v2, jq. Exits non-zero on any failure, including an ECS
# circuit-breaker rollback, so CI never reports a rolled-back deploy as green.

set -euo pipefail

ENV="${1:?environment (staging|production) required}"
IMAGE="${2:?image required}"
MODE="${3:-deploy}"

case "$ENV" in staging|production) ;; *) echo "Unknown environment: $ENV" >&2; exit 2 ;; esac

CLUSTER="bizexec"
SERVICE="bizexec-${ENV}"
APP_FAMILY="bizexec-${ENV}"
MIGRATE_FAMILY="bizexec-${ENV}-migrate"
LOG_GROUP="/ecs/bizexec-${ENV}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

# Registers a new revision of <family> identical to the latest one except for
# the image, so settings Terraform changed since the last deploy are kept.
register_revision() {
  local family="$1"
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json \
    | jq --arg image "$IMAGE" '
        .containerDefinitions[0].image = $image
        | {family, taskRoleArn, executionRoleArn, networkMode, containerDefinitions,
           requiresCompatibilities, cpu, memory, runtimePlatform}
        | with_entries(select(.value != null))' \
    > "$WORKDIR/$family.json"
  aws ecs register-task-definition \
    --cli-input-json "file://$WORKDIR/$family.json" \
    --query taskDefinition.taskDefinitionArn --output text
}

# Runs a one-off task in the service's subnets/security group and fails if
# the container exits non-zero. Prints the task's logs either way.
run_one_off() {
  local task_def="$1" command_json="${2:-}"
  local network overrides task_arn task_id exit_code reason

  network=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
    --query 'services[0].networkConfiguration' --output json)

  overrides='{"containerOverrides":[]}'
  if [ -n "$command_json" ]; then
    overrides=$(jq -n --argjson cmd "$command_json" '{containerOverrides:[{name:"migrate",command:$cmd}]}')
  fi

  task_arn=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
    --task-definition "$task_def" \
    --network-configuration "$network" \
    --overrides "$overrides" \
    --query 'tasks[0].taskArn' --output text)
  task_id="${task_arn##*/}"
  log "Started one-off task $task_id, waiting for it to finish"

  aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task_arn"

  exit_code=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" \
    --query 'tasks[0].containers[0].exitCode' --output text)
  reason=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" \
    --query 'tasks[0].stoppedReason' --output text)

  log "---- task output ----"
  aws logs get-log-events --log-group-name "$LOG_GROUP" \
    --log-stream-name "migrate/migrate/$task_id" \
    --start-from-head --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' || true
  log "---------------------"

  if [ "$exit_code" != "0" ]; then
    log "One-off task failed (exit code: $exit_code, reason: $reason)"
    return 1
  fi
}

migrate_def=$(register_revision "$MIGRATE_FAMILY")
log "Registered $migrate_def"

if [ "$MODE" = "--bootstrap" ]; then
  run_one_off "$migrate_def" '["node","scripts/db-bootstrap.js"]'
  log "Bootstrap complete for $ENV"
  exit 0
fi

log "Running migrations for $ENV"
run_one_off "$migrate_def"

app_def=$(register_revision "$APP_FAMILY")
log "Registered $app_def, updating $SERVICE"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition "$app_def" --query 'service.serviceName' --output text >/dev/null

# Not `aws ecs wait services-stable`: right after update-service the new
# deployment may not be visible yet, so the old one briefly looks "stable"
# and the waiter returns at once; it also succeeds after a circuit-breaker
# rollback. Instead, follow the deployment of *our* revision to its outcome.
log "Waiting for the $SERVICE rollout to finish"
deadline=$((SECONDS + 1200))
while :; do
  # shellcheck disable=SC2016 # backticks are JMESPath literals, not shell
  read -r deploy_status rollout_state < <(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
    --query "services[0].deployments[?taskDefinition=='${app_def}'] | [0].[status, rolloutState]" --output text)

  if [ "$deploy_status" = "PRIMARY" ] && [ "$rollout_state" = "COMPLETED" ]; then
    break
  fi
  if [ "$rollout_state" = "FAILED" ] || [ "$deploy_status" = "INACTIVE" ] || [ "$SECONDS" -ge "$deadline" ]; then
    log "Deployment did not complete: status=$deploy_status state=$rollout_state"
    aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
      --query 'services[0].events[:10].[createdAt,message]' --output text
    exit 1
  fi
  sleep 15
done

log "Deployed $IMAGE to $ENV"
