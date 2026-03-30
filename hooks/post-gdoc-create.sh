#!/bin/bash
# PostToolUse hook: auto-preview Google Docs/Sheets/Slides in the visualizer
# Only fires for sessions spawned by the claud-io UI (CLAUDEIO_SESSION=1)

# Skip if not a claud-io UI session
[ "$CLAUDEIO_SESSION" != "1" ] && exit 0

INPUT=$(cat)

# Extract URL - try multiple approaches
# 1. jq object path
URL=$(echo "$INPUT" | jq -r '.tool_response.url // .tool_response.result.url // empty' 2>/dev/null)

# 2. grep from anywhere in the JSON
if [ -z "$URL" ]; then
  URL=$(echo "$INPUT" | grep -oE 'https://docs\.google\.com/[^"\\[:space:]]+' | head -1)
fi

# 3. For read tools, construct URL from tool_input
if [ -z "$URL" ]; then
  TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
  case "$TOOL" in
    *gslides_read*)
      PRES_ID=$(echo "$INPUT" | jq -r '.tool_input.presentationId // .tool_input.presentation_id // empty' 2>/dev/null)
      [ -n "$PRES_ID" ] && URL="https://docs.google.com/presentation/d/$PRES_ID/edit"
      ;;
    *gdocs_read*)
      DOC_ID=$(echo "$INPUT" | jq -r '.tool_input.documentId // .tool_input.document_id // .tool_input.doc_id // empty' 2>/dev/null)
      [ -n "$DOC_ID" ] && URL="https://docs.google.com/document/d/$DOC_ID/edit"
      ;;
    *gsheets_read*)
      SHEET_ID=$(echo "$INPUT" | jq -r '.tool_input.spreadsheetId // .tool_input.spreadsheet_id // empty' 2>/dev/null)
      [ -n "$SHEET_ID" ] && URL="https://docs.google.com/spreadsheets/d/$SHEET_ID/edit"
      ;;
  esac
fi

if [ -z "$URL" ]; then
  exit 0
fi

# Extract title
TITLE=$(echo "$INPUT" | jq -r '.tool_response.title // .tool_response.result.title // empty' 2>/dev/null)
if [ -z "$TITLE" ]; then
  TITLE=$(echo "$INPUT" | jq -r '.tool_input.title // empty' 2>/dev/null)
fi
[ -z "$TITLE" ] && TITLE="Google Doc"

# Push to visualizer
curl -s -X POST http://localhost:3333/api/panel \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"embed\",\"title\":\"$TITLE\",\"url\":\"$URL\"}" > /dev/null 2>&1

exit 0
