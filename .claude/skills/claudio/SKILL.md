---
name: claudio
description: Launch the Claud-io visual workspace. TRIGGER when user asks to start, launch, or open the visualizer, canvas, or workspace.
allowed-tools: Bash, Read
user-invocable: true
---

## Launch the Claud-io Visual Workspace

Start the Claud-io server and open it in the browser.

### Steps

1. **Check if already running** — curl the health endpoint first:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/api/panels 2>/dev/null
```

2. **If not running (non-200)**, start the server in the background:
```bash
cd /Users/bmusco/claude-visualizer && node server.js &
```
Wait 2 seconds, then verify it's up.

3. **Open in browser**:
```bash
open http://localhost:3333/claudio
```

4. **Switch to Sonnet 4.6** — Tell the user to run `/model sonnet` to switch to the faster model for canvas work.

5. Confirm to the user: "Claud-io is running at http://localhost:3333/claudio"

### Notes
- The server runs on port 3333
- If the port is already in use by another process, inform the user
- Do NOT restart the server if it's already running
