#!/usr/bin/env bash
set -e

# Unpack Claude CLI config from Secrets Manager if provided
if [ -n "$CLAUDE_CONFIG_TAR_B64" ] && [ "$CLAUDE_CONFIG_TAR_B64" != "placeholder" ]; then
  echo "[entrypoint] Unpacking Claude CLI config..."
  echo "$CLAUDE_CONFIG_TAR_B64" | base64 -d | tar xzf - -C "$HOME"
  echo "[entrypoint] Claude config restored to $HOME/.claude/"

  # Restore MCP OAuth tokens into Claude CLI credential store
  if [ -f "$HOME/.claude/mcp-credentials.json" ]; then
    echo "[entrypoint] MCP credentials found, will be available to Claude CLI"
  fi

  # Copy .mcp.json to app directory if present in config
  if [ -f "$HOME/.mcp.json" ]; then
    cp "$HOME/.mcp.json" /app/.mcp.json 2>/dev/null || true
    echo "[entrypoint] .mcp.json restored"
  fi

  # Restore OAuth client registrations
  if [ -f "$HOME/.oauth-clients.json" ]; then
    cp "$HOME/.oauth-clients.json" /app/.oauth-clients.json 2>/dev/null || true
    echo "[entrypoint] OAuth clients restored"
  fi

  # Load OAuth credentials from config if not set via env
  if [ -f "$HOME/.oauth-env" ]; then
    source "$HOME/.oauth-env"
    echo "[entrypoint] OAuth env vars loaded"
  fi

  # Create memory directory if it doesn't exist
  MEMORY_DIR="${CLAUDIO_MEMORY_DIR:-$HOME/.claude/projects/-Users-bmusco/memory}"
  mkdir -p "$MEMORY_DIR"
  if [ ! -f "$MEMORY_DIR/MEMORY.md" ]; then
    echo "# Claud-io Memory" > "$MEMORY_DIR/MEMORY.md"
    echo "[entrypoint] Memory directory initialized"
  fi
fi

exec "$@"
