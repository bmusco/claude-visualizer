#!/usr/bin/env bash
set -euo pipefail

# Installs recommended Claude Code plugins and MCP servers.
# Run from the repo root: ./claude/setup.sh
#
# Source of truth for MCP servers:
#   https://cmtelematics.atlassian.net/wiki/spaces/PA1/pages/3419799599/CMT+MCP+Server+Registry
#
# Prerequisites:
#   - Claude Code installed (brew install --cask claude-code)
#   - cmtaws installed and logged in (cmtaws sso login)
#   - uv installed (for Serena)
#   - Node.js / npx available (for Atlassian MCP)
#   - gh CLI authenticated (for GitHub MCP)
#   - MCP_LOG_LEVEL env var set (for AWS Core MCP, e.g. export MCP_LOG_LEVEL=error)
#   - Jamf Trust connected (for Google Workspace and Slack MCPs)

echo "=== Claude Code Setup ==="
echo ""

# --- Plugins ---
echo "--- Plugins ---"
echo ""
echo "Ralph Wiggum and Superpowers must be installed from within Claude Code:"
echo "  1. Run: claude"
echo "  2. Type: /plugin"
echo "  3. Search for and install: superpowers"
echo "  4. For Ralph Wiggum, follow: https://awesomeclaude.ai/ralph-wiggum"
echo ""

# --- MCP Servers ---
echo "--- MCP Servers ---"
echo ""

echo "[1/7] Serena (semantic code navigation)..."
claude mcp remove --scope user serena 2>/dev/null || true
claude mcp add --scope user serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context=claude-code --project-from-cwd
echo ""

echo "[2/7] Atlassian (Jira + Confluence)..."
claude mcp remove --scope user atlassian 2>/dev/null || true
claude mcp add --scope user atlassian -- npx -y mcp-remote@0.1.13 https://mcp.atlassian.com/v1/sse
echo ""

echo "[3/7] Google Workspace (Drive, Gmail, Calendar, Sheets, Docs, Slides, Tasks)..."
claude mcp remove --scope user google-workspace 2>/dev/null || true
claude mcp add --scope user --transport http \
  google-workspace \
  https://portal.int-tools.cmtelematics.com/google-workspace-mcp/mcp
echo ""

echo "[4/7] Slack (messages, channels, threads, users)..."
claude mcp remove --scope user slack 2>/dev/null || true
claude mcp add --scope user --transport http \
  slack \
  https://portal.int-tools.cmtelematics.com/slack-mcp/mcp
echo ""

echo "[5/7] AWS documentation suite..."
# Individual servers for docs search, Aurora DSQL queries, and Glue/Athena/EMR data processing.
claude mcp remove aws-docs 2>/dev/null || true
claude mcp add aws-docs uvx awslabs.aws-documentation-mcp-server@latest
claude mcp remove aurora-dsql 2>/dev/null || true
claude mcp add aurora-dsql uvx awslabs.aurora-dsql-mcp-server@latest
claude mcp remove aws-dataprocessing 2>/dev/null || true
claude mcp add aws-dataprocessing uvx awslabs.aws-dataprocessing-mcp-server@latest
echo ""

echo "[6/7] AWS Core MCP (requires MCP_LOG_LEVEL env var)..."
# Proxy server that bundles multiple AWS MCP servers behind one entry point.
# Provides prompt_understanding (AWS solution planning) and activates role-based
# tool suites (serverless, databases, finops, etc.) via environment variables.
# Complements the individual servers above — some overlap is expected.
claude mcp remove awslabs-core-mcp-server -s project 2>/dev/null || true
claude mcp add awslabs-core-mcp-server -s project \
  -e FASTMCP_LOG_LEVEL="$MCP_LOG_LEVEL" \
  -- uvx awslabs.core-mcp-server@latest
echo ""

echo "[7/7] GitHub..."
claude mcp remove github 2>/dev/null || true
if command -v gh &> /dev/null; then
    TOKEN=$(gh auth token 2>/dev/null || true)
    if [ -n "$TOKEN" ]; then
        claude mcp add-json github "{\"type\":\"http\",\"url\":\"https://api.githubcopilot.com/mcp\",\"headers\":{\"Authorization\":\"Bearer $TOKEN\"}}"
    else
        echo "  Skipped: gh is installed but not authenticated. Run 'gh auth login' first."
    fi
else
    echo "  Skipped: gh CLI not found. Install it and run 'gh auth login' first."
fi
echo ""

# --- Settings reminder ---
echo "--- Settings ---"
echo ""
echo "Make sure your ~/.claude/settings.json includes:"
echo '  "env": { "ENABLE_TOOL_SEARCH": "true" }'
echo ""
echo "See the Confluence page for full settings.json reference:"
echo "  https://cmtelematics.atlassian.net/wiki/spaces/PA1/pages/2965209153"
echo ""
echo "=== Done ==="
