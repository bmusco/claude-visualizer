#!/usr/bin/env bash
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────
AWS_S3_BUCKET="${AWS_S3_BUCKET:?AWS_S3_BUCKET is required}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_CLOUDFRONT_ID="${AWS_CLOUDFRONT_ID:-}"
AWS_S3_PREFIX="${AWS_S3_PREFIX:-}"
API_BASE="${API_BASE:?API_BASE is required (e.g. https://claudio-api.int-tools.cmtelematics.com)}"

SRC_DIR="public"
S3_DEST="s3://${AWS_S3_BUCKET}/${AWS_S3_PREFIX}"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── Pre-flight ────────────────────────────────────────────────────
log "Checking AWS identity..."
aws sts get-caller-identity --region "$AWS_REGION" > /dev/null

if [ ! -d "$SRC_DIR" ]; then
  echo "ERROR: $SRC_DIR directory not found. Run from project root." >&2
  exit 1
fi

# ── Inject API_BASE into index.html ──────────────────────────────
log "Injecting API_BASE=${API_BASE} into index.html..."
DIST_DIR=$(mktemp -d)
cp -r "$SRC_DIR"/* "$DIST_DIR/"

# Add config script before app.js
sed -i.bak "s|</head>|<script>window.CLAUDIO_API_BASE='${API_BASE}';window.CLAUDIO_WS_BASE='${API_BASE}'.replace('http','ws');</script></head>|" "$DIST_DIR/index.html"
rm -f "$DIST_DIR/index.html.bak"

# ── Sync hashed assets (long cache) ──────────────────────────────
log "Syncing assets to ${S3_DEST}..."
aws s3 sync "$DIST_DIR/" "$S3_DEST" \
  --region "$AWS_REGION" \
  --exclude "*.html" \
  --cache-control "public, max-age=31536000, immutable"

# ── Copy HTML (no cache) ─────────────────────────────────────────
log "Uploading HTML files (no-cache)..."
for html in "$DIST_DIR"/*.html; do
  [ -f "$html" ] || continue
  filename=$(basename "$html")
  aws s3 cp "$html" "${S3_DEST}${filename}" \
    --region "$AWS_REGION" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "text/html"
done

# ── SPA fallback: copy index.html → 404.html ─────────────────────
log "Creating 404.html SPA fallback..."
aws s3 cp "$DIST_DIR/index.html" "${S3_DEST}404.html" \
  --region "$AWS_REGION" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html"

# ── CloudFront invalidation ──────────────────────────────────────
if [ -n "$AWS_CLOUDFRONT_ID" ]; then
  log "Invalidating CloudFront distribution ${AWS_CLOUDFRONT_ID}..."
  aws cloudfront create-invalidation \
    --distribution-id "$AWS_CLOUDFRONT_ID" \
    --paths "/*" \
    --region "$AWS_REGION" \
    --query 'Invalidation.Id' \
    --output text
fi

# ── Cleanup ───────────────────────────────────────────────────────
rm -rf "$DIST_DIR"

log "Frontend deploy complete → s3://${AWS_S3_BUCKET}/${AWS_S3_PREFIX}"
