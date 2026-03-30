# Claud-io Visual Workspace

## Agent Configuration
- Default model for Agent tool: `sonnet` (use `model: "sonnet"` when spawning agents unless a task specifically requires opus)

Claud-io is a visual workspace running at **http://localhost:3333** that displays panels (slides, documents, charts, embeds) on a canvas alongside a Claude chat.

## Creating Visual Content

When the user asks you to create a presentation, document, chart, or any visual content — even from outside the web UI — push it to the Claud-io canvas via its API.

### Research First

Before creating content, research in this exact order:
1. **Google Slides FIRST** — `gdrive_search` for presentations, then `gslides_read`. Existing decks have the most polished messaging.
2. **Google Docs SECOND** — `gdrive_search` for documents, then `gdocs_read`. Detailed writeups and strategy.
3. **Confluence ONLY if Drive didn't have enough** — `confluence_search`
4. **Web as last resort**
**NEVER use Slack for research.**

Use what you find to make content accurate, specific, and grounded in real data.

**Do NOT use Slack as a research source for presentations or documents.** Slack is informal and not a source of truth.

### Push to Canvas API

Create a panel by POSTing to the server:

```bash
curl -s -X POST http://localhost:3333/api/panel \
  -H 'Content-Type: application/json' \
  -d '{"type":"TYPE","title":"TITLE","content":"CONTENT"}'
```

#### Panel Types

**Slides / Presentations** — Use `<!--GSLIDES:...-->` (NOT `<!--PANEL:...-->`):
Presentations are created directly in Google Slides with CMT branding. Output a `<!--GSLIDES:{...}-->` marker:
```
<!--GSLIDES:{"title":"My Presentation","slides":[...]}-->
```
- **No title slides** — every slide must contain active content/insights
- Each slide has optional `title`, `body`, `layout`, `elements`, `notes` fields
- The system sends this to the Apps Script which creates a real Google Slides presentation with CMT branding

**Slide Layout System — Custom-First + Data Helpers:**

**Default to `"custom"` layout** for most slides. Be creative — compose unique visual layouts with text, shape, and image elements. No two slides should look the same.

Structured layouts only for specific data formats:
- `"metrics"` — big number grid. Body: `"35%|label\n20%|label"`
- `"fact"` — single hero stat. Title = big number, Body = context
- `"comparison"` — before/after table. Title: `"Before|After"`, Body: `"old|new"` per line
- `"two-cols"` — two equal content columns. Title: `"Left|Right"`, Body: `"left|right"` per line
- `"image-left"` / `"image-right"` — image on one side, text on other. Uses `image` field for description
- `"table"` — data table with blue header. Title: `"Col1|Col2|Col3"`, Body: `"val|val|val"` per line
- `"section-blue"` — gradient blue section divider. Title = heading, Body = subtitle. **No footer on this layout.**
- `"split"` — left gradient hero + right white details. Title: `"Hero Text|Right Header"`, Body: one item per line

Custom layout (for unique compositions):
- Set `"layout": "custom"` and provide an `"elements"` array
- Each element: `{"type": "text|shape|image|chart", "x": 0, "y": 0, "w": 200, "h": 40, ...}`
- **Text**: `content`, `fontSize`, `color`, `bold`, `italic`, `align` ("left"/"center"/"right"), `lineSpacing`. Supports `**bold**` markers.
- **Shape**: `shape` ("rect"/"ellipse"), `fill` color, optional `content` (centered text), `fontSize`, `color`, `bold`
- **Image**: `description` (renders as TBD placeholder box)
- **Chart**: `chart` (Chart.js config object with `type` and `data`). For data visualizations (bar charts, line charts, pie charts), use `type: 'chart'` elements with Chart.js config. This renders a real chart, not a placeholder. Chart types: `"bar"`, `"line"`, `"pie"`, `"doughnut"`. Use CMT brand colors for datasets: `#1a80d7`, `#5387C6`, `#0D4A8A`, `#3BB87A`, `#DB2727`.
- Canvas: 960x540 points. Safe area: x:40-920, y:20-490 (bottom 42px = footer)
- If no layout specified and no elements provided, defaults to custom (renders nothing)

**Shape-based diagrams:** For flowcharts and process diagrams, compose them from shape elements (colored boxes with text content) connected by thin rect shapes as arrows/connectors. This renders as a real visual in both the preview and Google Slides export.

**Deck Configuration** (optional top-level `deckConfig` object):
- `accentColor` — override brand color (default: `#1a80d7`)
- `font` — override font (default: `Helvetica Neue`)
- `transition` — deck-wide transition: `FADE`, `SLIDE_FROM_LEFT`, `SLIDE_FROM_RIGHT`, `FLIP`, `CUBE`, `GALLERY`, `DISSOLVE`, `NONE`
- `transitionDuration` — seconds (default: 0.3)
- Per-slide `"transition"` overrides deck-wide default

**Design rules:**
- Font: Helvetica Neue throughout. Brand blue: `#1a80d7` for titles/accents, black body, gray `#9CA3AF` for subtle elements
- **Every slide needs a visual anchor** — a big number, image placeholder, diagram, or visual layout. No "text only" slides.
- **Image placeholders on 60-70% of slides** — add image elements with specific descriptions. Be specific: "Bar chart comparing 10M connected vs. <5% priced" not "chart showing data".
- **Two-zone slide design** — every slide has a HERO zone (visual anchor, 60% weight) and a DETAIL zone (2-3 supporting bullets, 40% weight).
- **Max 3-4 bullets per slide.** Each must add new information.
- Visual variety — no two consecutive slides should use the same layout or composition.
- 5-8 slides ideal. One idea per slide. No filler or fluff.
- Footer auto-added on all slides except `section-blue`: "Confidential & Proprietary | Cambridge Mobile Telematics" (left, 6pt, #CBCBCB) + CMT gray logo (right). Bottom 42px reserved. **NEVER place content below y=490.**
- **Allowed backgrounds:** white, `#F3F4F6`, `#E8F2FC`, `#1a80d7`, `#0D4A8A`. Never dark navy/charcoal. **Prefer white or light backgrounds** (`#FFFFFF`, `#F3F4F6`, `#E8F2FC`) for most slides. Reserve blue backgrounds (`#1a80d7`, `#0D4A8A`) only for `section-blue` dividers.
- **No political references** — never echo political slogans (e.g., "Make X great/profitable again").

**Document** (`type: "document"`):
Content is an HTML string:
```json
{
  "type": "document",
  "title": "Status Report",
  "content": "<h1>Report Title</h1><h2>Section</h2><p>Content here...</p>"
}
```

**Markdown** (`type: "markdown"`):
Content is a markdown string:
```json
{
  "type": "markdown",
  "title": "Notes",
  "content": "# Heading\n\n- bullet one\n- bullet two"
}
```

**Charts** (`type: "chart-bar"`, `"chart-line"`, or `"chart-pie"`):
Content is Chart.js data JSON:
```json
{
  "type": "chart-bar",
  "title": "Revenue",
  "content": {
    "labels": ["Jan","Feb","Mar"],
    "datasets": [{"label":"Revenue","data":[100,200,150]}]
  }
}
```

**Embed** (`type: "embed"`):
For Google Docs/Sheets/Slides URLs:
```json
{
  "type": "embed",
  "title": "Q1 Planning",
  "url": "https://docs.google.com/document/d/DOC_ID/edit"
}
```

### Other API Endpoints

- `GET /api/panels` — list all panels
- `PUT /api/panel/:id` — update panel content/title
- `DELETE /api/panel/:id` — remove a panel
- `POST /api/clear` — remove all panels

### Workflow

1. Research the topic (Drive, Confluence, web)
2. Build the content using findings
3. POST to the API — it appears instantly on the canvas at localhost:3333
4. Tell the user it's ready and they can view/edit it in the browser

### Exporting Slides to Google Slides

Export is handled automatically via the Apps Script. The Export button on a slide panel sends the slide data to the Apps Script which creates a branded Google Slides presentation.
