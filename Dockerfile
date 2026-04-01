FROM node:20-slim

RUN apt-get update && apt-get install -y curl ca-certificates git && rm -rf /var/lib/apt/lists/*

RUN useradd -m appuser || true

# Install Claude CLI via official installer (as appuser so it lands in ~/.local/bin)
USER appuser
RUN curl -fsSL https://claude.ai/install.sh | bash
USER root

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=appuser:appuser . .

USER appuser

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3333/api/panels || exit 1

ENV PATH="/home/appuser/.local/bin:${PATH}"
ENV CLAUDE_CLI_PATH="/home/appuser/.local/bin/claude"

COPY --chown=appuser:appuser scripts/entrypoint.sh /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server.js"]
