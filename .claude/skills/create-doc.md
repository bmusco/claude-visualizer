Create a document panel on the Claud-io visualizer canvas.

## Steps
1. Research the topic first:
   - Search Google Drive via `mcp__google-workspace__gdrive_search`
   - Search Confluence via `mcp__atlassian__confluence_search`
   - Read relevant docs found
   - Use web search if needed
2. Write a well-structured document using HTML
3. POST it to the canvas:

```bash
curl -s -X POST http://localhost:3333/api/panel \
  -H 'Content-Type: application/json' \
  -d '{"type":"document","title":"TITLE","content":"HTML_CONTENT"}'
```

## Format
- Content is an HTML string with proper tags: h1, h2, h3, p, ul, li, table, tr, th, td, strong, em
- Use tables for structured data
- Use clear section headings
- Keep it concise and executive-ready

## Topic
$ARGUMENTS
