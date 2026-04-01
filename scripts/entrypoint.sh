#!/usr/bin/env bash
set -e

# Unpack Claude CLI config from Secrets Manager if provided
if [ -n "$CLAUDE_CONFIG_TAR_B64" ] && [ "$CLAUDE_CONFIG_TAR_B64" != "placeholder" ]; then
  echo "[entrypoint] Unpacking Claude CLI config..."
  echo "$CLAUDE_CONFIG_TAR_B64" | base64 -d | tar xzf - -C "$HOME"
  echo "[entrypoint] Claude config restored to $HOME/.claude/"
fi

exec "$@"
