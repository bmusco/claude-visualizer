# Deploy the CMT Slide Builder Apps Script

One-time setup (~3 minutes):

## Steps

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

8. **Set the env var** before starting the server:
   ```bash
   export SLIDES_SCRIPT_URL="https://script.google.com/macros/s/XXXXX/exec"
   ```

   Or add it to your `.zshenv`:
   ```bash
   echo 'export SLIDES_SCRIPT_URL="https://script.google.com/macros/s/XXXXX/exec"' >> ~/.zshenv
   ```

9. **Restart the server** — the "Export to Slides" button will now create fully branded CMT presentations directly.

## Testing

Run the `testBuild()` function in the Apps Script editor to verify it creates a test presentation in your Drive.
