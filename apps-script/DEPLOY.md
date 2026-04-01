# Deploy the CMT Slide Builder Apps Script

## Updating the Script

1. **Open** the Apps Script editor at https://script.google.com
2. **Find** the "CMT Slide Builder" project
3. **Replace** the contents of `Code.gs` with the code from this folder's `Code.gs`
4. **Deploy** → Manage deployments → Edit (pencil icon) → **New version** → Deploy

The deployment URL stays the same — no server restart needed.

## First-Time Setup

1. **Go to** https://script.google.com and click **New project**

2. **Replace** the contents of `Code.gs` with the code from this folder's `Code.gs`

3. **Click** Deploy > New deployment

4. **Select type**: Web app

5. **Settings**:
   - Description: `CMT Slide Builder`
   - Execute as: `Me`
   - Who has access: `Anyone` (or `Anyone with Google Account` if in a Workspace org)

6. **Click Deploy**, then **Authorize access** when prompted
   - Choose your Google account
   - Click "Advanced" > "Go to CMT Slide Builder (unsafe)" if you see a warning
   - Click "Allow"

7. **Copy the Web app URL** (looks like `https://script.google.com/macros/s/XXXXX/exec`)

8. Update `APPS_SCRIPT_URL` in `server.js` with the new URL

9. **Restart the server**

## Testing

Run the `testBuild()` function in the Apps Script editor to verify it creates a test presentation in your Drive.

## Notes

- `clasp` is blocked by the org — deploy manually via the script editor
- The canvas in CLAUDE.md uses 960×540; the Apps Script scales to 720×405 (0.75×) automatically
- Supported layouts: metrics, comparison, table, section-blue, split, fact, quote, statement, two-cols, image-left, image-right, custom
