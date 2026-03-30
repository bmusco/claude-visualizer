## Create Slides — In-Chat Preview Skill

Create a branded CMT presentation with an in-chat slide preview. The user reviews the slides visually, requests edits, then exports to Google Slides when ready.

### Workflow

**Step 1 — Scope**
Ask clarifying questions (one at a time) to understand what's needed:
- Topic and key message
- Audience (leadership, engineering, customers, partners)
- Number of slides (default: 5-8)
- Any specific data, metrics, or points to include
- Should you research existing content in Drive or Confluence first?

If the user provided enough context, confirm your understanding and move on.

**Step 2 — Research (if needed)**
Search for relevant content:
1. Google Drive via `mcp__google-workspace__gdrive_search`
2. Confluence via `mcp__atlassian__confluence_search`
3. Read relevant docs via `mcp__google-workspace__gdocs_read`

**Step 3 — Build**
Output the slides as a `<!--GSLIDES:{...}-->` marker. The canvas will render a branded preview automatically.

```
<!--GSLIDES:{"title":"Presentation Title","slides":[...]}-->
```

Each slide object has these fields:
- `title` (string, required) — slide heading
- `body` (string, optional) — content text. Use `\n` for line breaks.
- `layout` (string, optional) — one of the layouts below
- `image` (string, optional) — image description for image layouts
- `elements` (array, optional) — for custom layout, array of positioned elements

**Layout options:**
- *(omit layout)* — default bullet list with accent bars
- `"metrics"` — big number grid. Body: `"35%|label\n20%|label"`
- `"fact"` — single hero stat. Title = big number, Body = context
- `"two-cols"` — two columns. Title: `"Left|Right"`, Body: `"left|right"` per line
- `"comparison"` — before/after. Title: `"Before|After"`, Body: `"old|new"` per line
- `"image-left"` / `"image-right"` — image placeholder + text bullets. Uses `image` field
- `"table"` — data table. Title: `"Col1|Col2|Col3"`, Body: `"val|val|val"` per line
- `"section-blue"` — gradient blue section divider. Title = heading, Body = subtitle
- `"split"` — left gradient hero + right detail bullets. Title: `"Hero|Right Header"`, Body: one line per bullet
- `"custom"` — freeform positioned elements (see CLAUDE.md for element spec)

**Design rules:**
- **No title slides.** Slide 1 must be substantive content — executive summary, key metrics, or the main point. Use `metrics`, `fact`, or default layout for slide 1.
- **Prefer white/light backgrounds** for most slides. Reserve blue only for `section-blue` dividers.
- Every slide needs a visual anchor — a big number, image placeholder, or visual layout.
- Max 3-4 bullets per slide. Visual variety — no two consecutive slides should use the same layout.
- 5-8 slides ideal. One idea per slide.

**Step 4 — Review**
After the preview appears on the canvas, ask:
> "How does this look? You can:
> - **Export to Google Slides** — click Export on the panel, or tell me to export
> - **Make edits** — tell me what to change
> - **Start over** — I'll rebuild from scratch"

When the user requests edits, rebuild the full deck and output a new `<!--GSLIDES:{...}-->` marker.

### Topic
$ARGUMENTS
