---
name: canvas-clear
description: Clear all panels from the Claud-io canvas. TRIGGER when user asks to clear the canvas, remove all panels, or start fresh.
allowed-tools: Bash
user-invocable: true
disable-model-invocation: true
---

Clear all panels from the Claud-io visualizer canvas.

```bash
curl -s -X POST http://localhost:3333/api/clear
```

Run this command to remove all panels. Confirm with the user before executing.
