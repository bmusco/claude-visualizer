---
name: create-chart
description: Create a chart visualization on the Claud-io canvas. TRIGGER when the user asks to build a chart, graph, or data visualization for the canvas.
allowed-tools: Read, Grep, Bash, mcp__google-workspace__gdrive_search, mcp__google-workspace__gdocs_read, mcp__google-workspace__gsheets_read, mcp__atlassian__confluence_search, WebFetch
argument-hint: [topic or data description]
user-invocable: true
---

Create a chart panel on the Claud-io visualizer canvas.

## Steps
1. Research data for the chart topic if needed (Google Drive, Confluence, web)
2. Choose the best chart type for the data: `chart-bar`, `chart-line`, or `chart-pie`
3. POST it to the canvas:

```bash
curl -s -X POST http://localhost:3333/api/panel \
  -H 'Content-Type: application/json' \
  -d '{"type":"chart-bar","title":"TITLE","content":CHARTJS_DATA}'
```

## Format
Content is a Chart.js data object:
```json
{
  "labels": ["Label1", "Label2", "Label3"],
  "datasets": [{"label": "Series Name", "data": [100, 200, 150]}]
}
```

- Multiple datasets supported for grouped/stacked charts
- Use descriptive labels and series names
- No fabricated data — use real numbers from research or clearly label as illustrative

## Topic
$ARGUMENTS
