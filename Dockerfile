FROM node:20-slim

RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install Claude CLI (Linux x86_64)
# Update this URL when the official download path is confirmed
RUN curl -fsSL https://storage.googleapis.com/anthropic-sdk/claude-code/claude-code-latest-linux-x64.tar.gz \
    -o /tmp/claude.tar.gz \
    && tar -xzf /tmp/claude.tar.gz -C /usr/local/bin \
    && rm /tmp/claude.tar.gz \
    && chmod +x /usr/local/bin/claude \
    || echo "WARN: Claude CLI install failed — update URL in Dockerfile"

RUN useradd -m -u 1000 appuser

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=appuser:appuser . .

USER appuser

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3333/api/panels || exit 1

CMD ["node", "server.js"]
