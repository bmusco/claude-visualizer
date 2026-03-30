# Claud-io — Internal Tool Deployment (Split Architecture)

**Frontend** (S3 + CloudFront) — static HTML/JS/CSS from `public/`
**API** (ECS Fargate + ALB) — Express server + WebSocket + Claude CLI

```
User → CloudFront
         ├── /api/*  → ALB → ECS Fargate (container:3333)
         ├── wss://  → ALB → ECS Fargate (WebSocket)
         └── /*      → S3 bucket (static frontend)
```

---

## Prerequisites

- AWS CLI v2 + `cmtaws sso login`
- Docker (with `linux/amd64` buildx support)
- Terraform / Terragrunt

---

## One-Time Setup

### 1. Frontend — S3 bucket

```bash
aws s3 mb s3://claudio-int-tools --region us-east-1
```

Or via Terraform using the `custom-s3-backed-static-website` module:
- `bucket-override-name` → `claudio-int-tools`
- `website-domain` → `claudio.int-tools.cmtelematics.com`
- `custom-error-responses` → 403/404 → `/index.html` (SPA routing)

### 2. API — ECR repository

```bash
aws ecr create-repository \
  --repository-name claudio-api \
  --region us-east-1 \
  --image-scanning-configuration scanOnPush=true
```

### 3. API — ECS infrastructure

Terraform resources needed:

| Resource | Config |
|----------|--------|
| ECS Task Definition | 0.5 vCPU / 1 GB, port 3333, health `/health` |
| ECS Service | 2 tasks, rolling deploy |
| ALB Target Group | HTTP:3333, health GET `/health` |
| ALB Listener Rule | Host `claudio-api.int-tools.cmtelematics.com` |
| Security Groups | ALB → ECS on 3333 |

Environment variables for the task:
```
PORT=3333
CLAUDE_CLI_PATH=/usr/local/bin/claude
CLAUDIO_HOME=/home/appuser
CORS_ORIGIN=https://claudio.int-tools.cmtelematics.com
```

### 4. CloudFront distribution

Single distribution with two origins:

| Path | Origin | Cache |
|------|--------|-------|
| `/api/*` | ALB (API) | Disabled |
| `wss://` | ALB (API) | Disabled, forward `Upgrade` + `Connection` headers |
| `/*` (default) | S3 bucket | 60s for assets, no-cache for HTML |

Enable WebSocket: forward `Upgrade`, `Connection`, `Sec-WebSocket-*` headers.

### 5. Claude CLI auth in container

**Secrets Manager (recommended):**
```bash
tar czf /tmp/claude-config.tar.gz -C ~ .claude/
aws secretsmanager create-secret \
  --name claudio/claude-config \
  --secret-binary fileb:///tmp/claude-config.tar.gz
rm /tmp/claude-config.tar.gz
```

### 6. Jamf / access ticket (INFSUP)

> Internal tool launch: please **restrict Jamf trust IP** and **allowlist**:
> - Frontend: `https://claudio.int-tools.cmtelematics.com`
> - API: `https://claudio-api.int-tools.cmtelematics.com`
>
> AWS context: **S3 bucket** `claudio-int-tools`, **CloudFront distribution** `<DIST_ID>`, **region** `us-east-1`.

---

## Deploy

```bash
cp .env.example .env   # fill in real values

make deploy             # deploys both frontend + API
make deploy-frontend    # frontend only (S3)
make deploy-api         # API only (ECR + ECS)
```

---

## Local Development

```bash
make run        # docker-compose up (localhost:3333, same-origin)
make logs       # tail logs
make down       # stop
```

Locally, `API_BASE` is empty so frontend calls go to same origin — no split needed.

---

## Rollback

**Frontend:** Re-deploy previous version of `public/` or revert S3 objects.

**API:**
```bash
aws ecs list-task-definitions --family claudio-api --sort DESC --max-items 5
aws ecs update-service \
  --cluster internal-tools \
  --service claudio-api \
  --task-definition claudio-api:<PREV_REVISION>
```

---

## Environment Variables

### API container

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3333` | Server port |
| `CLAUDE_CLI_PATH` | No | local path | Claude CLI binary |
| `CLAUDIO_HOME` | No | `$HOME` | Home dir for CLI config |
| `CLAUDIO_MEMORY_DIR` | No | auto | Memory file storage |
| `CORS_ORIGIN` | No | `*` | Allowed frontend origin |

### Frontend deploy

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_S3_BUCKET` | Yes | S3 bucket name |
| `AWS_CLOUDFRONT_ID` | No | CloudFront dist ID (for invalidation) |
| `API_BASE` | Yes | API server URL |

---

## Cost Estimate (~$50/mo)

| Component | Monthly |
|-----------|---------|
| ECS Fargate (2 × 0.5 vCPU / 1 GB) | ~$36 |
| S3 + CloudFront | ~$5 |
| ALB (prorated, shared) | ~$5 |
| ECR + CloudWatch + Secrets | ~$4 |
