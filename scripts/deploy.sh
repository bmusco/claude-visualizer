#!/usr/bin/env bash
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REPO="${ECR_REPO:?ECR_REPO is required (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/claudio)}"
ECS_CLUSTER="${ECS_CLUSTER:?ECS_CLUSTER is required}"
ECS_SERVICE="${ECS_SERVICE:-claudio}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"

DRY_RUN="${DRY_RUN:-}"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── Pre-flight ────────────────────────────────────────────────────
log "Checking AWS identity..."
aws sts get-caller-identity --region "$AWS_REGION" > /dev/null

# ── Build ─────────────────────────────────────────────────────────
log "Building image: claudio:${IMAGE_TAG}"
docker build --platform linux/amd64 -t "claudio:${IMAGE_TAG}" .

# ── Tag & Push ────────────────────────────────────────────────────
log "Tagging for ECR..."
docker tag "claudio:${IMAGE_TAG}" "${ECR_REPO}:${IMAGE_TAG}"
docker tag "claudio:${IMAGE_TAG}" "${ECR_REPO}:latest"

log "Authenticating to ECR..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${ECR_REPO%%/*}"

if [ -n "$DRY_RUN" ]; then
  log "DRY RUN — skipping push and deploy"
  exit 0
fi

log "Pushing ${ECR_REPO}:${IMAGE_TAG} ..."
docker push "${ECR_REPO}:${IMAGE_TAG}"
docker push "${ECR_REPO}:latest"

# ── Deploy ────────────────────────────────────────────────────────
log "Updating ECS service ${ECS_SERVICE} in cluster ${ECS_CLUSTER}..."
aws ecs update-service \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --force-new-deployment \
  --query 'service.deployments[0].status' \
  --output text

log "Waiting for service to stabilize..."
aws ecs wait services-stable \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE"

log "Deploy complete — ${ECR_REPO}:${IMAGE_TAG}"
