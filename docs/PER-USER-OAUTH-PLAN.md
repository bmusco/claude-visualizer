# Per-User OAuth for MCP Integrations

## Goal
Each Claud-io user authenticates with their own Google/Slack/Atlassian account,
so MCP operations use their identity and data scope — not shared credentials.

## Architecture

```
User Browser          Claud-io API (ECS)         MCP Server (portal)
    │                       │                          │
    │ 1. Click "Connect"    │                          │
    │──────────────────────>│                          │
    │                       │ 2. GET /auth-metadata    │
    │                       │─────────────────────────>│
    │                       │ 3. {auth_url, client_id} │
    │                       │<─────────────────────────│
    │ 4. Redirect to auth   │                          │
    │<──────────────────────│                          │
    │                       │                          │
    │ 5. User authorizes    │                          │
    │──────────────────────>│ (OAuth provider)         │
    │                       │                          │
    │ 6. Callback w/ code   │                          │
    │──────────────────────>│                          │
    │                       │ 7. Exchange code→tokens  │
    │                       │─────────────────────────>│
    │                       │ 8. {access, refresh}     │
    │                       │<─────────────────────────│
    │                       │ 9. Store per-user        │
    │ 10. "Connected!"      │                          │
    │<──────────────────────│                          │
```

## Implementation Tasks

### 1. Session Management (server.js)
- Add cookie-based session middleware (no external deps — use signed cookies)
- Generate random session ID on first request, store in `claudio_sid` cookie
- Session TTL: 30 days

```js
const crypto = require('crypto');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const userSessions = new Map(); // sessionId -> { userId, tokens: { google: {...}, slack: {...} } }

app.use((req, res, next) => {
  let sid = req.cookies?.claudio_sid;
  if (!sid || !userSessions.has(sid)) {
    sid = crypto.randomBytes(24).toString('hex');
    res.cookie('claudio_sid', sid, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30*24*60*60*1000 });
    userSessions.set(sid, { tokens: {} });
  }
  req.userSession = userSessions.get(sid);
  next();
});
```

### 2. Per-User Token Store (new file: token-store.js)
- In-memory Map with file-based persistence (like panels)
- Encrypt tokens at rest using AES-256 with SESSION_SECRET
- Schema: `{ [sessionId]: { google: { accessToken, refreshToken, expiresAt }, slack: {...} } }`
- Periodic cleanup of expired sessions

### 3. OAuth Endpoints (server.js)

```
GET  /api/auth/:provider/start    → Returns OAuth URL for popup
GET  /api/auth/:provider/callback → Exchanges code for tokens, stores per-user
GET  /api/auth/:provider/status   → Returns connected/disconnected for current user
POST /api/auth/:provider/disconnect → Removes tokens for current user
```

**Discover OAuth metadata from MCP servers:**
The MCP servers on portal expose OAuth metadata. Hit the MCP endpoint unauthenticated
to get the auth URL and client ID.

### 4. Modify mcpCallTool (server.js)
- Accept `userToken` parameter instead of using global `mcpAccessToken`
- Lookup token from `req.userSession.tokens.google.accessToken`
- On 401, attempt token refresh using refreshToken

```js
function mcpCallToolForUser(toolName, args, accessToken) {
  // Same as mcpCallTool but uses provided accessToken
}
```

### 5. Frontend Changes (app.js)
- "Connect" button opens popup: `window.open('/api/auth/google/start', ...)`
- Popup redirects through OAuth, lands on callback page that calls `window.opener.postMessage()`
- Parent window receives message, updates UI to "Connected"
- Send `claudio_sid` cookie with all API requests (add `credentials: 'include'` to fetch calls)

### 6. CORS Update
- Add `credentials: true` to CORS headers
- Set specific origin instead of `*` (required for credentials)

## Files to Change
| File | Changes |
|------|---------|
| `server.js` | Session middleware, OAuth endpoints, per-user mcpCallTool |
| `public/app.js` | Popup OAuth flow, credentials in fetch, per-user status |
| `public/auth-callback.html` | New — landing page for OAuth redirect |
| `lib/token-store.js` | New — encrypted per-user token persistence |
| `package.json` | Add `cookie-parser` dependency |

## Environment Variables
| Variable | Description |
|----------|-------------|
| `SESSION_SECRET` | AES key for encrypting stored tokens |
| `OAUTH_CALLBACK_URL` | `https://claudio-api.int-tools.cmtelematics.com/api/auth/callback` |

## Migration Path
1. Deploy with session middleware + token store (no breaking changes)
2. Add OAuth endpoints (new routes, doesn't affect existing)
3. Update frontend connect buttons (swap Claude CLI flow for popup OAuth)
4. Remove shared token fallback once per-user is working
