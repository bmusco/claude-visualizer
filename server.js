const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { spawn, spawnSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3333;
const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || 'claude';
const USER_HOME = process.env.CLAUDIO_HOME || os.homedir();

// ── MCP integration test commands (shared across endpoints) ─────
const MCP_TEST_COMMANDS = {
  'google-workspace': 'Use the mcp__google-workspace__gdrive_search tool to search for "test" with max 1 result. Return only the result.',
  'atlassian': 'Use the mcp__atlassian__jira_get_all_projects tool to list projects with limit 1. Return only the result.',
  'slack': 'Use the mcp__slack__slack_list_channels tool to list channels with limit 1. Return only the result.'
};

// ── Session management for warm subprocesses ─────────────────────
// Map conversationId -> { sessionId, lastUsed }
const warmSessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 min

// Detect if a message can skip MCP (quick mode) — default is to INCLUDE MCP
function canSkipMcp(prompt, isEditing) {
  const lower = prompt.toLowerCase();
  // Explicit quick mode: user says quick/fast/no research
  if (/\b(quick|fast|no research|skip research)\b/.test(lower)) return true;
  // Short edit requests on existing panels don't need MCP
  if (isEditing && lower.length < 300) return true;
  // Everything else gets MCP tools (research, chat, data queries, etc.)
  return false;
}

// Clean up stale sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [convId, sess] of warmSessions) {
    if (now - sess.lastUsed > SESSION_TTL) warmSessions.delete(convId);
  }
}, 5 * 60 * 1000);

// CORS for split deploy (frontend on S3, API on ECS)
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use((req, res, next) => {
  const origin = CORS_ORIGIN === '*' ? (req.headers.origin || '*') : CORS_ORIGIN;
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Title, X-Filename');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// ── Per-user session + token management ──────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const USER_TOKENS_FILE = path.join(__dirname, '.user-tokens.json');
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

const userTokenStore = new Map();
try {
  const saved = JSON.parse(fs.readFileSync(USER_TOKENS_FILE, 'utf-8'));
  for (const [sid, data] of Object.entries(saved)) {
    if (Date.now() - (data.createdAt || 0) < SESSION_MAX_AGE) {
      userTokenStore.set(sid, data);
    }
  }
} catch {}

let _tokenSaveTimer = null;
function saveUserTokens() {
  if (_tokenSaveTimer) clearTimeout(_tokenSaveTimer);
  _tokenSaveTimer = setTimeout(() => {
    const obj = {};
    for (const [sid, data] of userTokenStore) obj[sid] = data;
    fs.writeFile(USER_TOKENS_FILE, JSON.stringify(obj), () => {});
  }, 500);
}

function encryptToken(text) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(SESSION_SECRET, 'claudio-salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptToken(encrypted) {
  try {
    const [ivHex, data] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.scryptSync(SESSION_SECRET, 'claudio-salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(data, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  } catch { return null; }
}

// Session middleware — creates/reads claudio_sid cookie
app.use((req, res, next) => {
  let sid = req.cookies?.claudio_sid;
  if (!sid || !userTokenStore.has(sid)) {
    sid = crypto.randomBytes(24).toString('hex');
    const cookieOpts = { httpOnly: true, maxAge: SESSION_MAX_AGE, path: '/' };
    if (process.env.NODE_ENV === 'production') {
      cookieOpts.secure = true;
      cookieOpts.sameSite = 'none';
    }
    res.cookie('claudio_sid', sid, cookieOpts);
    userTokenStore.set(sid, { tokens: {}, createdAt: Date.now() });
    saveUserTokens();
  }
  req.sessionId = sid;
  req.userSession = userTokenStore.get(sid);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Per-user OAuth for MCP integrations ──────────────────────────
const MCP_OAUTH_SERVERS = {
  'google-workspace': {
    baseUrl: 'https://portal.int-tools.cmtelematics.com/google-workspace-mcp',
    scope: 'google-workspace',
    name: 'Google Workspace',
  },
  'slack': {
    baseUrl: 'https://portal.int-tools.cmtelematics.com/slack-mcp',
    scope: 'slack',
    name: 'Slack',
  },
};

const oauthClients = new Map();
const OAUTH_CLIENTS_PATHS = [
  path.join(__dirname, '.oauth-clients.json'),
  path.join(os.homedir(), '.oauth-clients.json'),
];
for (const p of OAUTH_CLIENTS_PATHS) {
  try {
    const saved = JSON.parse(fs.readFileSync(p, 'utf-8'));
    for (const [k, v] of Object.entries(saved)) oauthClients.set(k, v);
    console.log(`[OAUTH] Loaded ${oauthClients.size} OAuth clients from ${p}`);
    break;
  } catch {}
}
if (oauthClients.size === 0) console.log('[OAUTH] No pre-registered OAuth clients found');

function saveOauthClients() {
  const obj = {};
  for (const [k, v] of oauthClients) obj[k] = v;
  fs.writeFile(OAUTH_CLIENTS_FILE, JSON.stringify(obj), () => {});
}

const OAUTH_CALLBACK_URL = process.env.OAUTH_CALLBACK_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://claudio-api.int-tools.cmtelematics.com/api/auth/callback'
    : `http://localhost:${PORT}/api/auth/callback`);

const pendingOauthFlows = new Map();

async function getOrRegisterClient(provider) {
  if (oauthClients.has(provider)) return oauthClients.get(provider);
  const serverConf = MCP_OAUTH_SERVERS[provider];
  if (!serverConf) throw new Error('Unknown provider');
  const resp = await fetch(`${serverConf.baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claud-io',
      redirect_uris: [OAUTH_CALLBACK_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    }),
  });
  if (!resp.ok) throw new Error(`Registration failed: ${resp.status}`);
  const client = await resp.json();
  oauthClients.set(provider, client);
  saveOauthClients();
  return client;
}

function generatePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

app.get('/api/auth/:provider/start', async (req, res) => {
  const provider = req.params.provider;
  const serverConf = MCP_OAUTH_SERVERS[provider];
  if (!serverConf) return res.status(400).json({ ok: false, error: 'Unknown provider' });

  try {
    let client = oauthClients.get(provider);
    if (!client) {
      try {
        client = await getOrRegisterClient(provider);
      } catch (regErr) {
        return res.json({ ok: false, error: `OAuth client not registered and registration failed: ${regErr.message}. Pre-register clients via the entrypoint config.` });
      }
    }

    const pkce = generatePkce();
    const state = crypto.randomBytes(16).toString('hex');

    pendingOauthFlows.set(state, {
      provider,
      sessionId: req.sessionId,
      codeVerifier: pkce.verifier,
      createdAt: Date.now(),
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: OAUTH_CALLBACK_URL,
      scope: serverConf.scope,
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    });

    res.json({ ok: true, authUrl: `${serverConf.baseUrl}/authorize?${params}` });
  } catch (err) {
    console.error('[OAUTH START ERROR]', provider, err.message, err.cause || '');
    res.json({ ok: false, error: err.message });
  }
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send('<html><body><h2>Authorization failed</h2><p>' + error + '</p><script>window.close()</script></body></html>');
  }

  const flow = pendingOauthFlows.get(state);
  if (!flow) {
    return res.send('<html><body><h2>Invalid or expired state</h2><script>window.close()</script></body></html>');
  }
  pendingOauthFlows.delete(state);

  const provider = flow.provider;
  const serverConf = MCP_OAUTH_SERVERS[provider];

  try {
    const client = oauthClients.get(provider);
    const tokenResp = await fetch(`${serverConf.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: OAUTH_CALLBACK_URL,
        client_id: client.client_id,
        client_secret: client.client_secret,
        code_verifier: flow.codeVerifier,
      }),
    });

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      throw new Error(`Token exchange failed: ${tokenResp.status} ${errBody}`);
    }

    const tokens = await tokenResp.json();
    const session = userTokenStore.get(flow.sessionId);
    if (session) {
      session.tokens[provider] = {
        accessToken: encryptToken(tokens.access_token),
        refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
        expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
      };
      saveUserTokens();
    }

    res.send(`<html><body><h2>${serverConf.name} connected!</h2><script>
      if (window.opener) { window.opener.postMessage({type:'oauth-complete',provider:'${provider}',ok:true},'*'); }
      setTimeout(() => window.close(), 1500);
    </script></body></html>`);
  } catch (err) {
    console.error('[OAUTH CALLBACK ERROR]', err.message, err.cause || '');
    res.send(`<html><body><h2>Authorization failed</h2><p>${err.message}</p><script>
      if (window.opener) { window.opener.postMessage({type:'oauth-complete',provider:'${provider}',ok:false,error:'${err.message}'},'*'); }
      setTimeout(() => window.close(), 3000);
    </script></body></html>`);
  }
});

app.get('/api/auth/:provider/status', (req, res) => {
  const provider = req.params.provider;
  const session = req.userSession;
  const tokenData = session?.tokens?.[provider];
  if (!tokenData?.accessToken) return res.json({ ok: false, connected: false });

  const expired = tokenData.expiresAt && Date.now() > tokenData.expiresAt;
  res.json({ ok: true, connected: !expired, hasRefreshToken: !!tokenData.refreshToken });
});

app.post('/api/auth/:provider/disconnect', (req, res) => {
  const provider = req.params.provider;
  if (req.userSession?.tokens?.[provider]) {
    delete req.userSession.tokens[provider];
    saveUserTokens();
  }
  res.json({ ok: true });
});

// Helper: get decrypted access token for current user + provider
function getUserMcpToken(req, provider) {
  const tokenData = req.userSession?.tokens?.[provider];
  if (!tokenData?.accessToken) return null;
  if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) return null;
  return decryptToken(tokenData.accessToken);
}

// Helper: refresh expired token
async function refreshUserToken(sessionId, provider) {
  const session = userTokenStore.get(sessionId);
  const tokenData = session?.tokens?.[provider];
  if (!tokenData?.refreshToken) return null;

  const serverConf = MCP_OAUTH_SERVERS[provider];
  const client = oauthClients.get(provider);
  if (!serverConf || !client) return null;

  try {
    const resp = await fetch(`${serverConf.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: decryptToken(tokenData.refreshToken),
        client_id: client.client_id,
        client_secret: client.client_secret,
      }),
    });
    if (!resp.ok) return null;
    const tokens = await resp.json();
    tokenData.accessToken = encryptToken(tokens.access_token);
    if (tokens.refresh_token) tokenData.refreshToken = encryptToken(tokens.refresh_token);
    tokenData.expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null;
    saveUserTokens();
    return tokens.access_token;
  } catch { return null; }
}

// Periodically clean up expired pending flows
setInterval(() => {
  const now = Date.now();
  for (const [state, flow] of pendingOauthFlows) {
    if (now - flow.createdAt > 10 * 60 * 1000) pendingOauthFlows.delete(state);
  }
}, 60 * 1000);

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Serve the app at /claudio
app.get('/claudio', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Persist panels to disk (debounced async writes)
const PANELS_FILE = path.join(__dirname, '.panels.json');
let panels = [];
let _panelSaveTimer = null;
try { panels = JSON.parse(fs.readFileSync(PANELS_FILE, 'utf-8')); } catch {}
function savePanels() {
  if (_panelSaveTimer) clearTimeout(_panelSaveTimer);
  _panelSaveTimer = setTimeout(() => {
    fs.writeFile(PANELS_FILE, JSON.stringify(panels), () => {});
  }, 200);
}

// Unique panel ID — counter avoids Date.now() collisions
let _panelIdCounter = 0;
function nextPanelId() {
  return Date.now() * 100 + (++_panelIdCounter % 100);
}

// API: push content to the visualizer
app.post('/api/panel', (req, res) => {
  const { type, title, content, url, mimeType, manual } = req.body;

  // Only allow embed panels from explicit user actions (embed modal, Drive picker)
  // This prevents research docs from appearing as panels during chat
  if (type === 'embed' && !manual) {
    return res.json({ ok: true, id: 0, blocked: true });
  }

  // Dedup embed panels by Google Doc ID
  if (type === 'embed' && url) {
    const docIdMatch = url.match(/\/d\/([^/]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (docIdMatch) {
      const existing = panels.find(p => p.url && (p.url.includes(docIdMatch[1]) || p.url.includes('/d/' + docIdMatch[1])));
      if (existing) {
        // Update mimeType on existing panel if newly provided
        if (mimeType && !existing.mimeType) { existing.mimeType = mimeType; savePanels(); }
        return res.json({ ok: true, id: existing.id, duplicate: true });
      }
    }
  }

  const conversationId = req.body.conversationId || null;
  const panel = { id: nextPanelId(), type, title, content, url, conversationId, timestamp: new Date().toISOString() };
  if (mimeType) panel.mimeType = mimeType;
  panels.push(panel);
  savePanels();
  broadcast({ action: 'add', panel });
  res.json({ ok: true, id: panel.id });
});

// API: replace all panels
app.post('/api/clear', (req, res) => {
  panels = [];
  savePanels();
  broadcast({ action: 'clear' });
  res.json({ ok: true });
});

// API: reorder panels
app.post('/api/panels/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ ok: false, error: 'order array required' });
  const byId = new Map(panels.map(p => [p.id, p]));
  const reordered = order.map(id => byId.get(id)).filter(Boolean);
  // Append any panels not in the order array (safety)
  panels.forEach(p => { if (!order.includes(p.id)) reordered.push(p); });
  panels = reordered;
  savePanels();
  res.json({ ok: true });
});

// API: get all panels
app.get('/api/panels', (req, res) => {
  res.json(panels);
});

// API: update a panel
app.put('/api/panel/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const panel = panels.find(p => p.id === id);
  if (!panel) return res.status(404).json({ ok: false, error: 'Not found' });
  if (req.body.content !== undefined) panel.content = req.body.content;
  if (req.body.title !== undefined) panel.title = req.body.title;
  savePanels();
  broadcast({ action: 'update', panel });
  res.json({ ok: true });
});

// API: delete a panel
app.delete('/api/panel/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = panels.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
  panels.splice(idx, 1);
  savePanels();
  broadcast({ action: 'remove', id });
  res.json({ ok: true });
});

// CLI endpoint: accept piped text
app.post('/api/pipe', express.text({ type: '*/*', limit: '10mb' }), (req, res) => {
  const panel = {
    id: nextPanelId(),
    type: 'markdown',
    title: req.headers['x-title'] || 'Output',
    content: req.body,
    timestamp: new Date().toISOString()
  };
  panels.push(panel);
  savePanels();
  broadcast({ action: 'add', panel });
  res.json({ ok: true, id: panel.id });
});

// File upload endpoint
app.post('/api/upload', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  try {
    const rawFilename = req.headers['x-filename'] || 'upload.txt';
    let filename;
    try {
      filename = decodeURIComponent(rawFilename).replace(/[/\\]/g, '_');
    } catch {
      filename = rawFilename.replace(/[/\\]/g, '_');
    }
    const tmpDir = path.join(os.tmpdir(), 'claude-visualizer-uploads');
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, `${Date.now()}-${filename}`);
    fs.writeFileSync(filePath, req.body);
    res.json({ ok: true, path: filePath, filename });
  } catch (err) {
    console.error('[UPLOAD ERROR]', err.message, err.stack);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Config / Settings API ─────────────────────────────────────────
let selectedModel = null; // null = use default from settings.json

function getConfig() {
  const config = {
    cli: { path: CLAUDE_CLI, version: null, home: USER_HOME },
    model: { current: null, available: [] },
    mcpServers: [],
    sources: []
  };

  // CLI version
  try {
    config.cli.version = execSync(`${CLAUDE_CLI} --version 2>&1`, { encoding: 'utf-8' }).trim();
  } catch {}

  // Read user settings for model + env
  try {
    const userSettings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf-8'));
    config.model.current = selectedModel || userSettings.model || 'claude-sonnet-4-6';
    if (userSettings.env) {
      if (userSettings.env.CLAUDE_CODE_USE_BEDROCK === '1') config.sources.push({ name: 'AWS Bedrock', type: 'provider', detail: userSettings.env.AWS_REGION || 'us-east-1' });
    }
  } catch {
    config.model.current = selectedModel || 'claude-sonnet-4-6';
  }

  // Available models — Bedrock
  config.model.available = [
    { id: 'us.anthropic.claude-opus-4-6-v1', label: 'Claude Opus 4.6' },
    { id: 'us.anthropic.claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Claude Haiku 4.5' },
    { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5' },
    { id: 'us.anthropic.claude-opus-4-20250514-v1:0', label: 'Claude Opus 4' },
    { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0', label: 'Claude Sonnet 4' },
    { id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet' },
    { id: 'us.anthropic.claude-3-5-haiku-20241022-v1:0', label: 'Claude 3.5 Haiku' },
  ];

  // Read local settings for hooks/MCP integrations
  try {
    const localSettings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude', 'settings.local.json'), 'utf-8'));
    if (localSettings.hooks?.PostToolUse) {
      localSettings.hooks.PostToolUse.forEach(h => {
        if (h.matcher) {
          const tools = h.matcher.split('|');
          const serverNames = new Set();
          tools.forEach(t => {
            const match = t.match(/^mcp__([^_]+)/);
            if (match) serverNames.add(match[1]);
          });
          serverNames.forEach(name => {
            config.mcpServers.push({ name: formatMcpName(name), id: name, status: 'unknown', tools: tools.filter(t => t.startsWith(`mcp__${name}`)).length });
          });
        }
      });
    }
  } catch {}

  // Detect MCP servers from allowed permissions (project-level + user-level)
  const settingsPaths = [
    path.join(__dirname, '..', '.claude', 'settings.local.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];
  settingsPaths.forEach(sp => {
    try {
      const s = JSON.parse(fs.readFileSync(sp, 'utf-8'));
      const allowed = s.permissions?.allow || [];
      const mcpNames = new Set();
      allowed.forEach(rule => {
        const match = rule.match(/^mcp__([^_]+)/);
        if (match) mcpNames.add(match[1]);
      });
      mcpNames.forEach(name => {
        if (!config.mcpServers.some(srv => srv.id === name)) {
          const toolCount = allowed.filter(r => r.startsWith(`mcp__${name}`)).length;
          config.mcpServers.push({ name: formatMcpName(name), status: 'unknown', id: name, tools: toolCount });
        }
      });
    } catch {}
  });

  // Add id to existing servers if missing
  config.mcpServers.forEach(s => {
    if (!s.id) {
      if (s.name.includes('Google')) s.id = 'google-workspace';
      else if (s.name.includes('Atlassian')) s.id = 'atlassian';
    }
  });

  // AWS Bedrock auth info
  const isBedrock = config.sources.some(s => s.name === 'AWS Bedrock');
  if (isBedrock) {
    config.auth = config.auth || {};
    config.auth.bedrock = { profile: 'cmtdev-sso-user', region: 'us-east-1', hasRefreshScript: true };
  }

  // Sources
  config.sources.push({ name: 'Claude CLI', type: 'cli', detail: config.cli.version });
  config.sources.push({ name: 'System Prompt', type: 'file', detail: 'system-prompt.md' });

  return config;
}

function formatMcpName(raw) {
  const names = { 'atlassian': 'Atlassian (Jira & Confluence)', 'google-workspace': 'Google Workspace', 'slack': 'Slack' };
  return names[raw] || raw.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

app.get('/api/config', (req, res) => {
  res.json(getConfig());
});

// Test MCP connection by running a simple tool call
app.post('/api/config/test/:server', (req, res) => {
  const serverName = req.params.server;

  const prompt = MCP_TEST_COMMANDS[serverName];
  if (!prompt) {
    return res.json({ ok: false, error: `Unknown server: ${serverName}` });
  }

  const result = spawnSync(CLAUDE_CLI, ['-p', '--output-format', 'text', prompt], {
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, HOME: USER_HOME },
    cwd: USER_HOME
  });

  const output = (result.stdout || '') + (result.stderr || '');
  const hasError = output.toLowerCase().includes('error') && (output.toLowerCase().includes('auth') || output.toLowerCase().includes('denied'));
  res.json({ ok: !hasError && result.status === 0, output: output.slice(0, 500) });
});

// Integration status cache (avoids re-testing every time settings opens)
let integrationStatusCache = {};
let integrationStatusCacheTime = 0;
const INTEGRATION_CACHE_TTL = 120000; // 2 minutes

function testOneIntegration(server) {
  return new Promise(resolve => {
    const proc = spawn(CLAUDE_CLI, ['-p', '--output-format', 'text', MCP_TEST_COMMANDS[server]], {
      env: { ...process.env, HOME: USER_HOME },
      cwd: USER_HOME
    });
    let output = '';
    const timer = setTimeout(() => { proc.kill(); resolve(false); }, 30000);
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { output += d.toString(); });
    proc.on('close', code => {
      clearTimeout(timer);
      const hasError = output.toLowerCase().includes('error') && (output.toLowerCase().includes('auth') || output.toLowerCase().includes('denied'));
      resolve(!hasError && code === 0);
    });
    proc.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// Batch integration status check — parallel + cached
app.get('/api/integrations/status', async (req, res) => {
  const force = req.query.force === '1';
  // Return cache if fresh
  if (!force && Date.now() - integrationStatusCacheTime < INTEGRATION_CACHE_TTL && Object.keys(integrationStatusCache).length > 0) {
    return res.json({ ok: true, status: integrationStatusCache, cached: true });
  }

  const servers = ['google-workspace', 'slack', 'atlassian'];
  // Run all 3 tests in parallel
  const results = await Promise.all(servers.map(s => testOneIntegration(s)));
  const status = {};
  servers.forEach((s, i) => { status[s] = results[i]; });
  integrationStatusCache = status;
  integrationStatusCacheTime = Date.now();
  res.json({ ok: true, status });
});

// Connect MCP server — triggers OAuth flow in user's browser
app.post('/api/integrations/connect/:server', (req, res) => {
  const serverName = req.params.server;

  // Clear any cached auth state to force fresh OAuth
  const cachePath = path.join(os.homedir(), '.claude', 'mcp-needs-auth-cache.json');
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    delete cache[serverName];
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch {}

  const prompt = MCP_TEST_COMMANDS[serverName];
  if (!prompt) return res.json({ ok: false, error: 'Unknown integration' });

  // Spawn async so the OAuth browser window can open while we wait
  const proc = spawn(CLAUDE_CLI, ['-p', '--output-format', 'text', prompt], {
    env: { ...process.env, HOME: USER_HOME },
    cwd: USER_HOME
  });

  let output = '';
  proc.stdout.on('data', d => { output += d.toString(); });
  proc.stderr.on('data', d => { output += d.toString(); });

  // Invalidate cache so next status check re-tests
  integrationStatusCacheTime = 0;
  // Respond immediately — OAuth flow happens in browser
  res.json({ ok: true, message: 'Authentication started — complete the sign-in in your browser' });

  // The process will complete on its own after user finishes OAuth
  proc.on('close', () => {
    // Connection result will be picked up by the next status check
  });
});

// Save Atlassian API credentials
app.post('/api/integrations/atlassian/credentials', (req, res) => {
  const { email, token } = req.body;
  if (!email || !token) return res.json({ ok: false, error: 'Email and token are required' });

  // Store credentials in a local file for the MCP server to use
  const credDir = path.join(os.homedir(), '.claude', 'mcp-credentials');
  try { fs.mkdirSync(credDir, { recursive: true }); } catch {}
  const credPath = path.join(credDir, 'atlassian.json');
  fs.writeFileSync(credPath, JSON.stringify({ email, token, updated: new Date().toISOString() }, null, 2));
  res.json({ ok: true, message: 'Atlassian credentials saved' });
});

// Disconnect MCP server — invalidate local cache (actual OAuth managed by Claude CLI)
app.delete('/api/integrations/:server/tokens', (req, res) => {
  const serverName = req.params.server;
  integrationStatusCacheTime = 0;
  if (integrationStatusCache[serverName] !== undefined) {
    integrationStatusCache[serverName] = false;
  }
  res.json({ ok: true, message: `To fully disconnect ${serverName}, run /mcp in the Claude CLI` });
});

// Refresh AWS SSO credentials
app.post('/api/config/refresh-aws', (req, res) => {
  try {
    execSync('cmtaws sso login 2>&1', { encoding: 'utf-8', timeout: 60000, env: { ...process.env, HOME: USER_HOME } });
    res.json({ ok: true });
  } catch (err) {
    // Even if the command "fails", SSO login may have opened a browser
    res.json({ ok: true, note: 'SSO login initiated - check your browser' });
  }
});

// Re-authenticate MCP server (triggers OAuth flow)
app.post('/api/config/reauth/:server', (req, res) => {
  const serverName = req.params.server;

  // Delete the auth cache to force re-auth
  const cachePath = path.join(os.homedir(), '.claude', 'mcp-needs-auth-cache.json');
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    delete cache[serverName];
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch {}

  const prompt = MCP_TEST_COMMANDS[serverName];
  if (!prompt) return res.json({ ok: false, error: 'Unknown server' });

  const result = spawnSync(CLAUDE_CLI, ['-p', '--output-format', 'text', prompt], {
    encoding: 'utf-8',
    timeout: 60000,
    env: { ...process.env, HOME: USER_HOME },
    cwd: USER_HOME
  });

  const output = (result.stdout || '') + (result.stderr || '');
  res.json({ ok: result.status === 0, output: output.slice(0, 300) });
});

// ── Direct SQL query endpoint (Option A) ──────────────────────────
const { Pool } = require('pg');
const pgPool = new Pool({
  user: 'bmusco@cmtelematics.com',
  host: '127.0.0.1',
  port: 13626,
  password: 'magic',
  database: 'prod_redshift',
  ssl: false,
  connectionTimeoutMillis: 10000,
  query_timeout: 120000,
});

// Query result cache: sql hash -> { rows, fields, ts }
const queryCache = new Map();
const QUERY_CACHE_TTL = 5 * 60 * 1000; // 5 min

function sqlCacheKey(sql) {
  return require('crypto').createHash('md5').update(sql.trim()).digest('hex');
}

app.post('/api/query', express.json(), async (req, res) => {
  const { sql, database } = req.body;
  if (!sql) return res.status(400).json({ ok: false, error: 'Missing sql parameter' });

  // Basic safety: block destructive statements
  const upper = sql.trim().toUpperCase();
  if (/^\s*(DROP|DELETE|TRUNCATE|ALTER|INSERT|UPDATE|CREATE|GRANT|REVOKE)\b/.test(upper)) {
    return res.status(403).json({ ok: false, error: 'Only SELECT queries are allowed' });
  }

  // Check cache
  const cacheKey = sqlCacheKey(sql + (database || ''));
  const cached = queryCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < QUERY_CACHE_TTL) {
    return res.json({ ok: true, rows: cached.rows, fields: cached.fields, cached: true, duration: cached.duration });
  }

  const db = database || 'prod_redshift';
  const start = Date.now();
  try {
    // Use a one-off client if database differs from pool default
    let client;
    let needRelease = false;
    if (db !== 'prod_redshift') {
      const { Client } = require('pg');
      client = new Client({
        user: 'bmusco@cmtelematics.com',
        host: '127.0.0.1',
        port: 13626,
        password: 'magic',
        database: db,
        ssl: false,
      });
      await client.connect();
      needRelease = true;
    } else {
      client = await pgPool.connect();
      needRelease = true;
    }

    try {
      const result = await client.query(sql);
      const duration = Date.now() - start;
      const fields = result.fields ? result.fields.map(f => f.name) : [];
      const rows = result.rows || [];

      // Cache result
      queryCache.set(cacheKey, { rows, fields, ts: Date.now(), duration });

      res.json({ ok: true, rows, fields, rowCount: rows.length, duration });
    } finally {
      if (needRelease) {
        if (db !== 'prod_redshift') {
          client.end().catch(() => {});
        } else {
          client.release();
        }
      }
    }
  } catch (err) {
    res.json({ ok: false, error: err.message, duration: Date.now() - start });
  }
});

// ── Auto-name chat ─────────────────────────────────────────────────
app.post('/api/chat-title', (req, res) => {
  const { messages } = req.body;
  if (!messages || messages.length === 0) return res.json({ ok: false });

  // Build a compact summary of the conversation for naming
  const summary = messages.slice(0, 4).map(m =>
    `${m.role}: ${(m.content || '').slice(0, 200)}`
  ).join('\n');

  const prompt = `Generate a short title (3-6 words, no quotes, no punctuation at end) for this chat conversation. Return ONLY the title, nothing else.\n\n${summary}`;

  const result = spawnSync(CLAUDE_CLI, ['-p', '--output-format', 'text', '--max-turns', '1', prompt], {
    encoding: 'utf-8',
    timeout: 15000,
    env: { ...process.env, HOME: USER_HOME },
    cwd: USER_HOME
  });

  const title = (result.stdout || '').trim().replace(/^["']|["']$/g, '').slice(0, 80);
  if (title) {
    res.json({ ok: true, title });
  } else {
    res.json({ ok: false });
  }
});

// ── Google Drive search with caching ─────────────────────────────
const driveCache = new Map(); // query -> { files, ts }
const CACHE_TTL = 30 * 60 * 1000; // 30 min cache (Drive files don't change that fast)
const STALE_TTL = 2 * 60 * 60 * 1000; // serve stale for 2 hours while refreshing
let activeFetches = new Map(); // query -> Promise — dedup concurrent requests

// ── Direct MCP connection (bypasses Claude CLI for ~10x faster Drive search) ──
const MCP_GOOGLE_URL = 'https://portal.int-tools.cmtelematics.com/google-workspace-mcp/mcp';
let mcpAccessToken = null;
let directMcpAvailable = false;

function loadMcpTokensFromKeychain() {
  // Try per-user token store first (container-friendly)
  try {
    const credFile = path.join(os.homedir(), '.claude', 'mcp-credentials.json');
    const creds = JSON.parse(fs.readFileSync(credFile, 'utf-8'));
    const gw = Object.values(creds.mcpOAuth || {}).find(
      v => v.serverName === 'google-workspace'
    );
    if (gw?.accessToken) {
      mcpAccessToken = gw.accessToken;
      return true;
    }
  } catch {}
  // Fallback: macOS keychain (local dev only)
  try {
    const result = execSync(
      'security find-generic-password -s "Claude Code-credentials" -g 2>&1',
      { encoding: 'utf-8', timeout: 5000 }
    );
    const pwMatch = result.match(/^password: "(.*)"$/m);
    if (!pwMatch) return false;
    const creds = JSON.parse(pwMatch[1]);
    const gw = Object.values(creds.mcpOAuth || {}).find(
      v => v.serverName === 'google-workspace'
    );
    if (!gw?.accessToken) return false;
    mcpAccessToken = gw.accessToken;
    return true;
  } catch { return false; }
}

// MCP tool call with explicit token (for per-user OAuth)
function mcpCallToolWithToken(toolName, args, token, mcpUrl) {
  const https = require('https');
  const url = mcpUrl || MCP_GOOGLE_URL;
  return new Promise((resolve) => {
    const body = JSON.stringify({
      jsonrpc: '2.0', method: 'tools/call', id: Date.now(),
      params: { name: toolName, arguments: args }
    });
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${token}`,
      }
    }, (res) => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        res.resume();
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const dataMatch = data.match(/^data:\s*(.+)$/m);
          if (dataMatch) { resolve(JSON.parse(dataMatch[1])); return; }
          resolve(JSON.parse(data));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// Backward-compatible wrapper using global token (shared/fallback)
function mcpCallTool(toolName, args) {
  return mcpCallToolWithToken(toolName, args, mcpAccessToken).then(result => {
    if (result === null && loadMcpTokensFromKeychain()) {
      return mcpCallToolWithToken(toolName, args, mcpAccessToken);
    }
    return result;
  });
}

function parseDriveResults(mcpResult) {
  if (!mcpResult?.result?.content) return [];
  const files = [];
  for (const item of mcpResult.result.content) {
    if (item.type !== 'text' || !item.text) continue;
    try {
      const parsed = JSON.parse(item.text);
      const arr = Array.isArray(parsed) ? parsed : (parsed.files || []);
      for (const f of arr) {
        if (f.id) files.push({
          id: f.id,
          name: f.name || f.title || 'Untitled',
          mimeType: f.mimeType || '',
          webViewLink: f.webViewLink || f.webUrl || f.url || ''
        });
      }
    } catch {}
  }
  return files;
}

function fetchDriveFilesAsync(query) {
  const cacheKey = query.toLowerCase().trim();
  if (activeFetches.has(cacheKey)) return activeFetches.get(cacheKey);

  const promise = (async () => {
    let files = [];

    // FAST PATH: Direct MCP call (~1s vs ~15s via Claude CLI)
    if (directMcpAvailable) {
      try {
        const driveQuery = query || ' '; // space = recent files
        const result = await mcpCallTool('gdrive_search', { query: driveQuery });
        files = parseDriveResults(result);
      } catch {}
    }

    // FALLBACK: Claude CLI (if direct MCP failed or unavailable)
    if (files.length === 0 && !directMcpAvailable) {
      files = await new Promise((resolve) => {
        const prompt = query
          ? `Use the mcp__google-workspace__gdrive_search tool to search for "${query}". Return ONLY a raw JSON array of objects with fields: id, name, mimeType, webViewLink. No markdown, no explanation, no code fences, just the JSON array.`
          : `Use the mcp__google-workspace__gdrive_search tool to list recent files (query: "modifiedTime > '${new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0]}'"). Return ONLY a raw JSON array of objects with fields: id, name, mimeType, webViewLink. No markdown, no explanation, no code fences, just the JSON array.`;

        const proc = spawn(CLAUDE_CLI, ['-p', '--output-format', 'text', prompt], {
          env: { ...process.env, HOME: USER_HOME },
          cwd: USER_HOME
        });
        let output = '';
        const timer = setTimeout(() => { proc.kill(); resolve([]); }, 30000);
        proc.stdout.on('data', d => { output += d.toString(); });
        proc.stderr.on('data', d => { output += d.toString(); });
        proc.on('close', () => {
          clearTimeout(timer);
          const jsonMatch = output.match(/\[[\s\S]*\]/);
          let f = [];
          if (jsonMatch) { try { f = JSON.parse(jsonMatch[0]); } catch {} }
          resolve(f);
        });
        proc.on('error', () => { clearTimeout(timer); resolve([]); });
      });
    }

    // Update cache
    if (files.length > 0 || cacheKey) {
      driveCache.set(cacheKey, { files, ts: Date.now() });
    }
    activeFetches.delete(cacheKey);
    return files;
  })();

  activeFetches.set(cacheKey, promise);
  return promise;
}

// Initialize direct MCP on server start
setTimeout(async () => {
  if (loadMcpTokensFromKeychain()) {
    directMcpAvailable = true;
    console.log('[MCP] Direct Google Workspace token loaded (fast mode ~1s vs ~15s)');
  }
  // Pre-fetch recent files
  fetchDriveFilesAsync('');
  setTimeout(() => fetchDriveFilesAsync('mimeType:application/vnd.google-apps.presentation'), 3000);
}, 500);

// Fast server-side fuzzy filter across ALL cached Drive files
function fuzzyFilterCache(query) {
  if (!query) return null;
  const q = query.toLowerCase();
  const allFiles = new Map(); // dedup by id
  for (const [, entry] of driveCache) {
    for (const f of entry.files) {
      if (f.id && !allFiles.has(f.id) && (f.name || '').toLowerCase().includes(q)) {
        allFiles.set(f.id, f);
      }
    }
  }
  return allFiles.size > 0 ? [...allFiles.values()] : null;
}

app.get('/api/gdrive/search', async (req, res) => {
  const query = req.query.q || '';
  const cacheKey = query.toLowerCase().trim();

  const cached = driveCache.get(cacheKey);
  const now = Date.now();

  // Fresh cache — return immediately
  if (cached && (now - cached.ts) < CACHE_TTL) {
    return res.json({ ok: true, files: cached.files, cached: true });
  }

  // Stale cache — return stale results NOW, refresh in background
  if (cached && (now - cached.ts) < STALE_TTL) {
    res.json({ ok: true, files: cached.files, cached: true, refreshing: true });
    fetchDriveFilesAsync(query); // fire-and-forget background refresh
    return;
  }

  // FAST PATH: fuzzy-filter across all cached files for instant results
  // while the real search runs in the background
  const fuzzyResults = fuzzyFilterCache(query);
  if (fuzzyResults) {
    res.json({ ok: true, files: fuzzyResults, cached: true, fuzzy: true, refreshing: true });
    fetchDriveFilesAsync(query); // fire-and-forget full search
    return;
  }

  // No cache at all — must wait for results (but async, doesn't block server)
  const files = await fetchDriveFilesAsync(query);
  res.json({ ok: true, files });
});

// ── Google Doc preview (reads content via direct MCP) ────────────
const docPreviewCache = new Map(); // docId -> { preview, ts }
const DOC_PREVIEW_TTL = 10 * 60 * 1000; // 10 min

app.get('/api/gdrive/preview/:docId', async (req, res) => {
  const { docId } = req.params;
  const docType = req.query.type || 'document';
  if (!docId) return res.json({ ok: false, error: 'docId required' });

  // Check cache
  const cached = docPreviewCache.get(docId);
  if (cached && Date.now() - cached.ts < DOC_PREVIEW_TTL) {
    return res.json({ ok: true, preview: cached.preview });
  }

  if (!directMcpAvailable) {
    return res.json({ ok: false, error: 'MCP not available' });
  }

  try {
    let toolName, args;
    if (docType === 'spreadsheet') {
      // Discover actual sheet name first (may not be "Sheet1")
      const meta = await mcpCallTool('gsheets_get', { spreadsheet_id: docId });
      let sheetName = 'Sheet1';
      try {
        const metaText = meta?.result?.content?.find(c => c.type === 'text')?.text || '';
        const metaJson = JSON.parse(metaText);
        if (metaJson.sheets && metaJson.sheets.length > 0) {
          sheetName = metaJson.sheets[0].name;
        }
      } catch {}
      toolName = 'gsheets_read';
      args = { spreadsheet_id: docId, range: sheetName };
    } else if (docType === 'presentation') {
      toolName = 'gslides_read';
      args = { presentation_id: docId };
    } else {
      toolName = 'gdocs_read';
      args = { document_id: docId };
    }

    const result = await mcpCallTool(toolName, args);
    if (!result?.result?.content) {
      return res.json({ ok: false, error: 'No content returned' });
    }

    let preview = '';
    for (const item of result.result.content) {
      if (item.type === 'text') {
        preview += item.text;
      }
    }

    // Truncate for preview (first ~3000 chars, HTML-escaped)
    preview = preview.slice(0, 3000)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (preview.length >= 3000) preview += '\n\n... (truncated)';

    docPreviewCache.set(docId, { preview, ts: Date.now() });
    res.json({ ok: true, preview });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.put('/api/config/model', (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ ok: false, error: 'model required' });
  selectedModel = model;
  broadcast({ action: 'config-updated', key: 'model', value: model });
  res.json({ ok: true, model });
});

// Map MCP tool names to friendly status labels
function toolStatusLabel(name) {
  const map = {
    'mcp__google-workspace__gdrive_search': 'Searching Google Drive...',
    'mcp__google-workspace__gdocs_read': 'Reading Google Doc...',
    'mcp__google-workspace__gdocs_create': 'Creating Google Doc...',
    'mcp__google-workspace__gdocs_update': 'Updating Google Doc...',
    'mcp__google-workspace__gdocs_insert': 'Editing Google Doc...',
    'mcp__google-workspace__gdocs_replace': 'Editing Google Doc...',
    'mcp__google-workspace__gsheets_read': 'Reading Google Sheet...',
    'mcp__google-workspace__gsheets_create': 'Creating Google Sheet...',
    'mcp__google-workspace__gsheets_update': 'Updating Google Sheet...',
    'mcp__google-workspace__gslides_create': 'Creating Google Slides...',
    'mcp__google-workspace__gslides_read': 'Reading Google Slides...',
    'mcp__google-workspace__gdrive_read': 'Reading from Drive...',
    'mcp__google-workspace__gdrive_copy': 'Copying Drive file...',
    'mcp__atlassian__confluence_search': 'Searching Confluence...',
    'mcp__atlassian__confluence_get_page': 'Reading Confluence page...',
    'mcp__atlassian__jira_search': 'Searching Jira...',
    'mcp__atlassian__jira_get_issue': 'Reading Jira issue...',
    'mcp__atlassian__jira_create_issue': 'Creating Jira issue...',
  };
  if (map[name]) return map[name];
  // Fallback: extract a readable label from tool name
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    const server = parts[1] || '';
    const action = (parts[2] || '').replace(/_/g, ' ');
    const serverLabel = { 'google-workspace': 'Google', 'atlassian': 'Atlassian', 'slack': 'Slack' }[server] || server;
    return `${serverLabel}: ${action}...`;
  }
  return null;
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// Chat: track active claude processes; shared history (single-user app)
const chatSessions = new Map();
const CHAT_HISTORY_FILE = path.join(__dirname, '.chat-history.json');
let chatHistory = [];
try { chatHistory = JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf-8')); } catch {}
const MAX_HISTORY = 50;
let _chatSaveTimer = null;

function saveChatHistory() {
  if (_chatSaveTimer) clearTimeout(_chatSaveTimer);
  _chatSaveTimer = setTimeout(() => {
    fs.writeFile(CHAT_HISTORY_FILE, JSON.stringify(chatHistory), () => {});
  }, 200);
}

// Load system prompt from file
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system-prompt.md'), 'utf-8').replace(/\x00/g, '');

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ action: 'init', panels }));
  // Send existing chat history to client on reconnect
  if (chatHistory.length > 0) {
    ws.send(JSON.stringify({ action: 'chat-history', messages: chatHistory }));
  }

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    try {
    if (msg.action === 'chat') {
      const prompt = msg.text;
      const files = msg.files || [];
      if (!prompt) return;

      // Kill any existing process for this client
      if (chatSessions.has(ws)) {
        chatSessions.get(ws).kill();
      }

      ws.send(JSON.stringify({ action: 'chat-start' }));

      // ── Expand slash commands into natural language prompts ──
      // Skills from ~/.claude/skills/ don't work in -p mode, so we
      // intercept /command patterns and rewrite them here.
      let userMessage = prompt;

      const slashMatch = prompt.match(/^\/create-slides\s+(.*)/i);
      let preSearchPromise = null;
      if (slashMatch) {
        const topic = slashMatch[1].trim();
        // Check for slide count (e.g., "/create-slides 5 on byod")
        const countMatch = topic.match(/^(\d+)\s+(?:on\s+|about\s+|for\s+)?(.+)/i);
        const slideTopic = countMatch ? countMatch[2] : topic;
        const slideCount = countMatch ? countMatch[1] : '5-7';

        // Pre-fetch Drive results NOW while we build the prompt (saves 5-15s)
        preSearchPromise = Promise.all([
          fetchDriveFilesAsync(slideTopic),
          fetchDriveFilesAsync(slideTopic + ' mimeType:application/vnd.google-apps.presentation'),
        ]).then(([allFiles, slideFiles]) => {
          // Merge and dedup by id
          const seen = new Set();
          const merged = [];
          // Prioritize presentations
          for (const f of [...slideFiles, ...allFiles]) {
            if (f.id && !seen.has(f.id)) { seen.add(f.id); merged.push(f); }
          }
          return merged.slice(0, 10);
        });

        userMessage = `Create a ${slideCount}-slide presentation about: ${slideTopic}`;
      }

      if (files.length > 0) {
        const localFiles = [];
        const driveFiles = [];

        for (const f of files) {
          if (f.type === 'gdrive') {
            driveFiles.push(f);
          } else {
            try {
              const content = fs.readFileSync(f.path, 'utf-8');
              localFiles.push(`\n--- File: ${f.filename} ---\n${content}\n--- End of ${f.filename} ---`);
            } catch {
              localFiles.push(`\n[Could not read file: ${f.filename}]`);
            }
          }
        }

        if (localFiles.length > 0) {
          userMessage += '\n\nAttached files:' + localFiles.join('\n');
        }

        if (driveFiles.length > 0) {
          const driveInstructions = driveFiles.map(f => {
            const mimeType = f.mimeType || '';
            if (mimeType.includes('document') || mimeType.includes('word')) {
              return `- Read Google Doc "${f.filename}" using mcp__google-workspace__gdocs_read with document ID: ${f.docId}`;
            } else if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
              return `- Read Google Sheet "${f.filename}" using mcp__google-workspace__gsheets_read with spreadsheet ID: ${f.docId}`;
            } else if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
              return `- Read Google Slides "${f.filename}" using mcp__google-workspace__gslides_read with presentation ID: ${f.docId}`;
            } else {
              return `- Read Google Drive file "${f.filename}" using mcp__google-workspace__gdrive_read with file ID: ${f.docId}`;
            }
          }).join('\n');
          userMessage += `\n\nIMPORTANT: The user has attached Google Drive files. Read them FIRST before responding:\n${driveInstructions}\n\nUse the content from these files to inform your response.`;
        }
      }

      // ── Inject pre-fetched Drive results for /create-slides ──
      if (preSearchPromise) {
        try {
          const driveResults = await preSearchPromise;
          if (driveResults.length > 0) {
            const fileList = driveResults.map(f => {
              const type = (f.mimeType || '').includes('presentation') ? 'Slides'
                : (f.mimeType || '').includes('document') ? 'Doc'
                : (f.mimeType || '').includes('spreadsheet') ? 'Sheet' : 'File';
              return `  - [${type}] "${f.name}" (ID: ${f.id})`;
            }).join('\n');
            const readInstructions = driveResults
              .filter(f => (f.mimeType || '').includes('presentation'))
              .slice(0, 3)
              .map(f => `Read these slides for reusable messaging: mcp__google-workspace__gslides_read with presentation ID "${f.id}"`)
              .join('\n');
            userMessage += `\n\n[PRE-FETCHED DRIVE RESULTS — skip gdrive_search, these are already the search results for this topic]\n${fileList}\n\n${readInstructions ? 'PRIORITIZE reading the presentations listed above for reusable content. ' : ''}Go straight to reading the most relevant 1-2 files, then create the GSLIDES output. Do NOT call gdrive_search again — use these results.`;
          }
        } catch {}
      }

      // Build full prompt with conversation history
      let fullPrompt = SYSTEM_PROMPT + '\n\n';
      if (chatHistory.length > 0) {
        fullPrompt += 'Conversation so far:\n\n';
        fullPrompt += chatHistory.map(m =>
          `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`
        ).join('\n\n');
        fullPrompt += '\n\n';
      }
      fullPrompt += `Human: ${userMessage}`;

      // Add user message to history
      chatHistory.push({ role: 'user', content: userMessage });
      saveChatHistory();

      // Strip null bytes that can creep in from file reads or binary attachments
      fullPrompt = fullPrompt.replace(/\x00/g, '');

      // ── Quick mode vs Normal mode ──
      const isEditing = !!msg.editingPanel;
      const skipMcp = canSkipMcp(userMessage, isEditing);

      const cliArgs = ['-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages'];
      if (selectedModel) cliArgs.push('--model', selectedModel);

      // Quick mode: skip MCP servers entirely (saves 2-5s connection overhead)
      if (skipMcp) {
        cliArgs.push('--strict-mcp-config');
        // No --mcp-config means no MCP servers loaded
      }

      // Warm session: resume previous session for this conversation
      const convId = msg.conversationId || 'default';
      const warmSession = warmSessions.get(convId);
      if (warmSession && warmSession.sessionId) {
        cliArgs.push('--resume', warmSession.sessionId);
        // When resuming, send only the new user message (context is preserved)
        fullPrompt = userMessage;
      }

      let claude;
      // If prompt is too large for CLI args (>100KB), pipe via temp file
      if (Buffer.byteLength(fullPrompt) > 100000) {
        const promptFile = path.join(os.tmpdir(), `claudio-prompt-${Date.now()}.txt`);
        fs.writeFileSync(promptFile, fullPrompt);
        claude = spawn(CLAUDE_CLI, cliArgs, {
          env: { ...process.env, HOME: USER_HOME, CLAUDEIO_SESSION: '1' },
          cwd: USER_HOME,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        // Pipe prompt via stdin
        const promptStream = fs.createReadStream(promptFile);
        promptStream.pipe(claude.stdin);
        promptStream.on('end', () => {
          setTimeout(() => { try { fs.unlinkSync(promptFile); } catch {} }, 2000);
        });
      } else {
        cliArgs.push(fullPrompt);
        claude = spawn(CLAUDE_CLI, cliArgs, {
          env: { ...process.env, HOME: USER_HOME, CLAUDEIO_SESSION: '1' },
          cwd: USER_HOME
        });
      }

      chatSessions.set(ws, claude);

      let output = '';
      let buffer = '';
      let inThinkingBlock = false;
      let inToolUseBlock = false;
      let currentToolName = '';
      let toolInputJson = '';
      let thinkingText = '';
      let processedBlocks = new Set();

      claude.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);

            // Unwrap stream_event wrapper from --include-partial-messages
            const event = parsed.type === 'stream_event' ? parsed.event : parsed;
            const eventType = event?.type || parsed.type;

            if (eventType === 'message_start') {
              ws.send(JSON.stringify({ action: 'chat-status', text: 'Thinking...' }));

            } else if (eventType === 'content_block_start') {
              const block = event.content_block || {};
              if (block.type === 'thinking') {
                inThinkingBlock = true;
                thinkingText = '';
                ws.send(JSON.stringify({ action: 'chat-thinking-start' }));
              } else if (block.type === 'tool_use' && block.name) {
                inToolUseBlock = true;
                currentToolName = block.name;
                toolInputJson = '';
                const status = toolStatusLabel(block.name);
                if (status) ws.send(JSON.stringify({ action: 'chat-status', text: status }));
              }

            } else if (eventType === 'content_block_delta') {
              const delta = event.delta || {};
              if (inThinkingBlock) {
                const text = delta.thinking || delta.text || '';
                if (text) {
                  thinkingText += text;
                  ws.send(JSON.stringify({ action: 'chat-thinking-delta', text }));
                }
              } else if (inToolUseBlock && delta.type === 'input_json_delta' && delta.partial_json) {
                toolInputJson += delta.partial_json;
              } else if (delta.type === 'text_delta' && delta.text) {
                output += delta.text;
                ws.send(JSON.stringify({ action: 'chat-chunk', text: delta.text }));
              }

            } else if (eventType === 'content_block_stop') {
              if (inThinkingBlock) {
                inThinkingBlock = false;
                ws.send(JSON.stringify({ action: 'chat-thinking-done', text: thinkingText }));
              }
              if (inToolUseBlock) {
                inToolUseBlock = false;
                // If model called gslides_create, inject a GSLIDES marker into the output
                // so the client can create a canvas panel from it
                if (currentToolName === 'mcp__google-workspace__gslides_create' && toolInputJson) {
                  try {
                    const toolInput = JSON.parse(toolInputJson);
                    // gslides_create input has title and slides — same shape as GSLIDES marker
                    if (toolInput.title && toolInput.slides) {
                      const gslidesMarker = `<!--GSLIDES:${JSON.stringify(toolInput)}-->`;
                      output += gslidesMarker;
                      ws.send(JSON.stringify({ action: 'chat-chunk', text: gslidesMarker }));
                    }
                  } catch {}
                }
                currentToolName = '';
                toolInputJson = '';
              }

            } else if (parsed.type === 'assistant') {
              // Final assistant message — skip, we already streamed everything

            } else if (parsed.type === 'result' || eventType === 'result') {
              const result = parsed.result || event.result;
              if (result) {
                output = result;
                ws.send(JSON.stringify({ action: 'chat-result', text: result }));
              }
              // Capture session ID for warm subprocess resumption
              const sessionId = parsed.session_id || parsed.sessionId || event?.session_id;
              if (sessionId && convId) {
                warmSessions.set(convId, { sessionId, lastUsed: Date.now() });
              }
            }
          } catch {
            output += line;
            ws.send(JSON.stringify({ action: 'chat-chunk', text: line }));
          }
        }
      });

      claude.stderr.on('data', () => {
        // stderr may contain progress info; don't double-up thinking status
      });

      claude.on('close', async (code) => {
        chatSessions.delete(ws);

        // ── Option C: Auto-execute SQL code blocks from Claude's output ──
        // Detect ```sql blocks and run them directly, much faster than
        // waiting for Claude to call Bash -> psql
        const sqlBlockRegex = /```sql\n([\s\S]*?)```/g;
        let sqlMatch;
        const sqlBlocks = [];
        while ((sqlMatch = sqlBlockRegex.exec(output)) !== null) {
          const sql = sqlMatch[1].trim();
          // Only auto-execute SELECT queries
          if (/^\s*SELECT\b/i.test(sql) || /^\s*WITH\b/i.test(sql)) {
            sqlBlocks.push(sql);
          }
        }

        if (sqlBlocks.length > 0) {
          for (const sql of sqlBlocks) {
            try {
              ws.send(JSON.stringify({ action: 'chat-status', text: 'Running query...' }));
              const start = Date.now();

              // Check cache first
              const cacheKey = sqlCacheKey(sql);
              const cached = queryCache.get(cacheKey);
              let rows, fields, duration;

              if (cached && Date.now() - cached.ts < QUERY_CACHE_TTL) {
                rows = cached.rows;
                fields = cached.fields;
                duration = cached.duration;
              } else {
                const client = await pgPool.connect();
                try {
                  const result = await client.query(sql);
                  duration = Date.now() - start;
                  fields = result.fields ? result.fields.map(f => f.name) : [];
                  rows = result.rows || [];
                  queryCache.set(cacheKey, { rows, fields, ts: Date.now(), duration });
                } finally {
                  client.release();
                }
              }

              // Send query results to the UI
              ws.send(JSON.stringify({
                action: 'query-result',
                sql: sql.slice(0, 200),
                fields,
                rows: rows.slice(0, 1000), // cap at 1000 rows for the UI
                rowCount: rows.length,
                duration,
              }));
            } catch (err) {
              ws.send(JSON.stringify({
                action: 'query-error',
                sql: sql.slice(0, 200),
                error: err.message,
              }));
            }
          }
        }

        // Save assistant response to history
        if (output) {
          chatHistory.push({ role: 'assistant', content: output });
          // Trim history to keep it manageable
          while (chatHistory.length > MAX_HISTORY * 2) {
            chatHistory.splice(0, 2);
          }
          saveChatHistory();
        }
        try { ws.send(JSON.stringify({ action: 'chat-done', text: output })); } catch {}
      });

      claude.on('error', (err) => {
        chatSessions.delete(ws);
        try { ws.send(JSON.stringify({ action: 'chat-error', text: err.message })); } catch {}
      });
    }

    if (msg.action === 'chat-stop') {
      if (chatSessions.has(ws)) {
        chatSessions.get(ws).kill();
        chatSessions.delete(ws);
      }
    }

    if (msg.action === 'chat-clear-history') {
      chatHistory = [];
      saveChatHistory();
    }
    } catch (err) {
      console.error('[WS MESSAGE ERROR]', err.message, err.stack);
      try { ws.send(JSON.stringify({ action: 'chat-error', text: 'Server error: ' + err.message })); } catch {}
    }
  });

  ws.on('close', () => {
    if (chatSessions.has(ws)) {
      chatSessions.get(ws).kill();
      chatSessions.delete(ws);
    }
  });
});

// ── Google Slides export ─────────────────────────────────────────
// CMT template ID for branded presentations
const CMT_TEMPLATE_ID = '16vLh7CTiIeW6C9-No0aC5JBTGhuJLAYrm0DpdEiVKhQ';
// Template layout types (9 layouts in the CMT master):
// 1=Title, 2=White+Bullets, 3=Split, 4=Blue+Bullets, 5=Two-headline, 6=Quote, 7=Section, 8=App Screenshot, 9=Thank You

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxxE7uBeAdGVeGDUlm9O8IONGEyfPOitiPFaHWy3HJYPRvcF336czy-bef2MzWUQ0b27A/exec';

app.post('/api/export/slides', async (req, res) => {
  const { title, slides } = req.body;
  if (!title || !slides) return res.json({ ok: false, error: 'title and slides required' });

  try {
    const payload = JSON.stringify({ title, slides });

    // Apps Script redirects POST responses to a googleusercontent URL.
    // Don't auto-follow — grab the Location header, then GET it for the JSON result.
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      redirect: 'manual'
    });

    let data;
    if (resp.status >= 300 && resp.status < 400) {
      // Follow the redirect with GET to retrieve the JSON response
      const location = resp.headers.get('location');
      if (location) {
        const resp2 = await fetch(location, { redirect: 'follow' });
        data = await resp2.json();
      } else {
        return res.json({ ok: false, error: 'Apps Script redirect missing Location header' });
      }
    } else {
      data = await resp.json();
    }

    if (data.ok && data.url) {
      // Normalize /open?id= URLs to /presentation/d/ID/edit for proper type detection
      let url = data.url;
      const openIdMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (openIdMatch && !url.includes('/presentation/')) {
        url = `https://docs.google.com/presentation/d/${openIdMatch[1]}/edit`;
      }
      return res.json({ ok: true, url });
    }
    res.json({ ok: false, error: data.error || 'Apps Script returned no URL' });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Memory API ───────────────────────────────────────────────────
const MEMORY_DIR = process.env.CLAUDIO_MEMORY_DIR || path.join(USER_HOME, '.claude', 'projects', '-Users-bmusco', 'memory');

function parseMemoryIndex() {
  const indexPath = path.join(MEMORY_DIR, 'MEMORY.md');
  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    return content;
  } catch {
    return '';
  }
}

function classifyMemoryFile(filename, content) {
  const lower = (filename + ' ' + content).toLowerCase();
  if (lower.includes('user preference') || lower.includes('user pref')) return 'user';
  if (lower.includes('feedback') || lower.includes('coach')) return 'feedback';
  if (lower.includes('schema') || lower.includes('reference') || lower.includes('db-')) return 'reference';
  return 'project';
}

app.get('/api/memories', (req, res) => {
  try {
    const indexContent = parseMemoryIndex();
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'));
    const memories = files.map(filename => {
      const filePath = path.join(MEMORY_DIR, filename);
      const content = fs.readFileSync(filePath, 'utf-8');
      const stat = fs.statSync(filePath);
      const lines = content.split('\n').filter(l => l.trim());
      const firstHeading = lines.find(l => l.startsWith('#'));
      const name = firstHeading ? firstHeading.replace(/^#+\s*/, '') : filename.replace('.md', '');
      const preview = lines.filter(l => !l.startsWith('#')).slice(0, 3).join(' ').slice(0, 200);
      const type = classifyMemoryFile(filename, content);
      return {
        filename,
        name,
        type,
        preview,
        content,
        modified: stat.mtime.toISOString(),
        size: stat.size
      };
    });
    res.json({ ok: true, memories, indexContent });
  } catch (err) {
    res.json({ ok: false, error: err.message, memories: [] });
  }
});

// ── Export table data to Google Sheets ─────────────────────────────
app.post('/api/export/sheets', async (req, res) => {
  const { title, headers, rows } = req.body;
  if (!title || !headers || !rows) return res.json({ ok: false, error: 'title, headers, and rows required' });
  if (!directMcpAvailable) return res.json({ ok: false, error: 'MCP not available' });

  try {
    // Create the spreadsheet
    const createResult = await mcpCallTool('gsheets_create', { title });
    const createText = createResult?.result?.content?.find(c => c.type === 'text')?.text || '';
    // Extract spreadsheet ID from response
    let spreadsheetId;
    try {
      const createJson = JSON.parse(createText);
      spreadsheetId = createJson.spreadsheet_id || createJson.spreadsheetId || createJson.id;
    } catch {
      // Try to extract ID from URL in response
      const urlMatch = createText.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (urlMatch) spreadsheetId = urlMatch[1];
    }
    if (!spreadsheetId) return res.json({ ok: false, error: 'Could not get spreadsheet ID from creation response' });

    // Build the data array: headers + rows
    const allRows = [headers, ...rows];
    // Convert to the format gsheets_update expects
    await mcpCallTool('gsheets_update', {
      spreadsheet_id: spreadsheetId,
      range: 'Sheet1',
      values: allRows
    });

    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    res.json({ ok: true, url });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.get('/api/memory/:filename', (req, res) => {
  try {
    const filePath = path.join(MEMORY_DIR, req.params.filename);
    if (!filePath.startsWith(MEMORY_DIR)) return res.status(400).json({ ok: false, error: 'Invalid path' });
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ ok: true, content, filename: req.params.filename });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

app.post('/api/memory', (req, res) => {
  try {
    const { filename, content, type, name } = req.body;
    if (!filename || !content) return res.status(400).json({ ok: false, error: 'filename and content required' });
    const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '-');
    const filePath = path.join(MEMORY_DIR, safeName);
    if (!filePath.startsWith(MEMORY_DIR)) return res.status(400).json({ ok: false, error: 'Invalid path' });
    fs.writeFileSync(filePath, content, 'utf-8');

    // Update MEMORY.md index if it references the file
    const indexPath = path.join(MEMORY_DIR, 'MEMORY.md');
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    if (!indexContent.includes(safeName)) {
      const linkLine = `\n- See [${name || safeName}](${safeName}) for ${type || 'project'} details\n`;
      fs.appendFileSync(indexPath, linkLine, 'utf-8');
    }

    res.json({ ok: true, filename: safeName });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.put('/api/memory/:filename', (req, res) => {
  try {
    const filePath = path.join(MEMORY_DIR, req.params.filename);
    if (!filePath.startsWith(MEMORY_DIR)) return res.status(400).json({ ok: false, error: 'Invalid path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'Not found' });
    fs.writeFileSync(filePath, req.body.content, 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.delete('/api/memory/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    if (filename === 'MEMORY.md') return res.status(400).json({ ok: false, error: 'Cannot delete index file' });
    const filePath = path.join(MEMORY_DIR, filename);
    if (!filePath.startsWith(MEMORY_DIR)) return res.status(400).json({ ok: false, error: 'Invalid path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'Not found' });
    fs.unlinkSync(filePath);

    // Remove reference from MEMORY.md
    const indexPath = path.join(MEMORY_DIR, 'MEMORY.md');
    let indexContent = fs.readFileSync(indexPath, 'utf-8');
    const lines = indexContent.split('\n');
    const filtered = lines.filter(l => !l.includes(filename));
    fs.writeFileSync(indexPath, filtered.join('\n'), 'utf-8');

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Global crash protection — log & stay alive
process.on('uncaughtException', (err) => {
  console.error('[CRASH CAUGHT] uncaughtException:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH CAUGHT] unhandledRejection:', reason);
});

server.listen(PORT, () => {
  console.log(`Claud-io running at http://localhost:${PORT}`);
});
