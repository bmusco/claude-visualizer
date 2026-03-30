// API base URL — empty string for same-origin, or set to API server origin for split deploy
const API_BASE = window.CLAUDIO_API_BASE || '';
const WS_BASE = window.CLAUDIO_WS_BASE || '';

// WebSocket connection
let ws;
let panels = [];
let currentSlide = 0;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = WS_BASE || `${protocol}//${location.host}`;
  ws = new WebSocket(wsHost);

  ws.onopen = () => {
    document.getElementById('status').textContent = 'Connected';
    document.getElementById('status').classList.add('connected');
  };

  ws.onclose = () => {
    document.getElementById('status').textContent = 'Disconnected';
    document.getElementById('status').classList.remove('connected');
    setTimeout(connect, 2000);
  };

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.action === 'init') {
      panels = data.panels;
      renderAll();
    } else if (data.action === 'add') {
      // Dedup: skip if panel with same id already exists (e.g. from undo)
      if (panels.some(p => p.id == data.panel.id)) return;
      panels.push(data.panel);
      renderAll();
    } else if (data.action === 'update') {
      const idx = panels.findIndex(p => p.id == data.panel.id);
      if (idx >= 0) { panels[idx] = data.panel; renderAll(); }
    } else if (data.action === 'remove') {
      // Skip if already removed locally (avoids double renderAll from our own DELETE)
      if (!panels.some(p => p.id == data.id)) return;
      panels = panels.filter(p => p.id != data.id);
      delete panelLayout[data.id];
      renderAll();
    } else if (data.action === 'clear') {
      panels = [];
      renderAll();
    } else if (data.action && data.action.startsWith('chat-')) {
      handleChatMessage(data);
    }
  };
}

// ── Settings ──────────────────────────────────────────────────────
let appConfig = null;

function loadConfig() {
  fetch(`${API_BASE}/api/config`).then(r => r.json()).then(config => {
    appConfig = config;
    renderSettingsDropdown(config);
    renderModelBadge(config);
    // Update model pill label
    const currentModel = config.model?.current || '';
    const modelInfo = (config.model?.available || []).find(m => m.id === currentModel);
    const pillLabel = document.getElementById('model-pill-label');
    if (pillLabel && modelInfo) pillLabel.textContent = modelInfo.label;
    // Also update settings modal if open
    if (document.getElementById('settings-modal')?.classList.contains('active')) {
      renderSettingsModal();
    }
  }).catch(() => {});
}

function renderModelBadge(config) {
  let badge = document.getElementById('model-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'model-badge';
    badge.className = 'model-current';
    document.querySelector('.header-left').appendChild(badge);
  }
  const model = config.model.current || '';
  // Show short label
  const match = config.model.available.find(m => m.id === model);
  badge.textContent = match ? match.label.replace(' (Bedrock)', '').replace('Claude ', '') : model.replace(/^us\.anthropic\.|^claude-/g, '').replace(/-v\d.*$/, '');
}

function renderSettingsDropdown(config) {
  const dd = document.getElementById('settings-dropdown');
  let html = '';

  // AWS Bedrock / Provider
  const bedrockSource = config.sources.find(s => s.name === 'AWS Bedrock');
  if (bedrockSource) {
    html += `<div class="settings-section">
      <div class="settings-section-title">AI Provider</div>
      <div class="settings-item">
        <span class="status-dot info"></span>
        <span class="item-label">AWS Bedrock</span>
        <span class="item-detail">${escapeHtml(bedrockSource.detail || '')}</span>
      </div>
      <div class="settings-item">
        <span class="item-label" style="font-size:12px;color:var(--text-muted)">Model: ${escapeHtml(config.model.current || '')}</span>
      </div>
      <div class="settings-auth-actions">
        <button class="settings-action-btn" onclick="refreshAws(this)">Refresh AWS SSO</button>
      </div>
    </div>`;
  }

  // MCP Servers with test + re-auth
  if (config.mcpServers.length > 0) {
    html += `<div class="settings-section">
      <div class="settings-section-title">Integrations</div>
      ${config.mcpServers.map(s => {
        const serverId = s.id || '';
        return `
        <div class="settings-server-card" id="server-${serverId}">
          <div class="settings-item">
            <span class="status-dot" id="dot-${serverId}"></span>
            <span class="item-label">${escapeHtml(s.name)}</span>
            <span class="item-detail">${s.tools} tool${s.tools !== 1 ? 's' : ''}</span>
          </div>
          ${serverId ? `<div class="settings-auth-actions">
            <button class="settings-action-btn" onclick="testMcpConnection('${serverId}', this)">Test</button>
            <button class="settings-action-btn" onclick="reauthMcp('${serverId}', this)">Re-authenticate</button>
          </div>
          <div class="settings-status-msg" id="status-${serverId}"></div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  // Sources & CLI
  html += `<div class="settings-section">
    <div class="settings-section-title">Sources</div>
    ${config.sources.filter(s => s.type !== 'provider').map(s => `
      <div class="settings-item">
        <span class="status-dot source"></span>
        <span class="item-label">${escapeHtml(s.name)}</span>
        <span class="item-detail">${escapeHtml(s.detail || '')}</span>
      </div>
    `).join('')}
  </div>`;

  // Clear All action
  html += `<div class="settings-section">
    <button class="settings-action-btn" style="width:100%" onclick="clearAllPanels()">Clear All Panels</button>
  </div>`;

  dd.innerHTML = html;
}

function testMcpConnection(serverId, btn) {
  const badge = document.getElementById('badge-' + serverId);
  const statusMsg = document.getElementById('status-' + serverId);
  const connectBtn = document.getElementById('connect-btn-' + serverId);
  if (btn) { btn.textContent = 'Testing...'; btn.disabled = true; }
  if (badge) { badge.textContent = 'Checking...'; badge.className = 'integration-badge checking'; }
  if (statusMsg) { statusMsg.textContent = ''; statusMsg.className = 'settings-status-msg'; }

  fetch(`${API_BASE}/api/config/test/${serverId}`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      if (badge) { badge.textContent = data.ok ? 'Connected' : 'Not Connected'; badge.className = 'integration-badge ' + (data.ok ? 'connected' : 'disconnected'); }
      if (statusMsg) { statusMsg.textContent = data.ok ? '' : 'Authentication required — click Connect to sign in'; statusMsg.className = 'settings-status-msg ' + (data.ok ? 'ok' : 'err'); }
      // Google/Slack: show Reconnect when connected
      if (serverId !== 'atlassian' && connectBtn) {
        connectBtn.textContent = data.ok ? 'Reconnect' : ({ 'google-workspace': 'Connect Google Account', 'slack': 'Connect Slack' }[serverId] || 'Connect');
      }
      // Atlassian: hide credential fields when connected
      if (serverId === 'atlassian') {
        const emailField = document.getElementById('atlassian-email');
        const tokenField = document.getElementById('atlassian-token');
        const instrEl = document.querySelector('#server-atlassian .integration-instructions');
        if (data.ok) {
          if (emailField) emailField.style.display = 'none';
          if (tokenField) tokenField.style.display = 'none';
          if (instrEl) instrEl.style.display = 'none';
          if (connectBtn) connectBtn.style.display = 'none';
        } else {
          if (emailField) emailField.style.display = '';
          if (tokenField) tokenField.style.display = '';
          if (instrEl) instrEl.style.display = '';
          if (connectBtn) connectBtn.style.display = '';
        }
      }
      if (btn) { btn.textContent = 'Test'; btn.disabled = false; }
    })
    .catch(() => {
      if (badge) { badge.textContent = 'Error'; badge.className = 'integration-badge disconnected'; }
      if (statusMsg) { statusMsg.textContent = 'Connection error'; statusMsg.className = 'settings-status-msg err'; }
      if (btn) { btn.textContent = 'Test'; btn.disabled = false; }
    });
}

function reauthMcp(serverId, btn) {
  const origText = btn.textContent;
  btn.textContent = 'Authenticating...';
  btn.disabled = true;
  const statusMsg = document.getElementById('status-' + serverId);
  if (statusMsg) { statusMsg.textContent = 'Starting re-authentication...'; statusMsg.className = 'settings-status-msg'; }

  fetch(`${API_BASE}/api/config/reauth/${serverId}`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      btn.textContent = origText;
      btn.disabled = false;
      if (data.ok) {
        if (statusMsg) { statusMsg.textContent = 'Auth refreshed — testing...'; statusMsg.className = 'settings-status-msg ok'; }
        setTimeout(() => testMcpConnection(serverId), 1000);
      } else {
        if (statusMsg) { statusMsg.textContent = data.error || 'Re-auth failed'; statusMsg.className = 'settings-status-msg err'; }
      }
    })
    .catch(() => {
      btn.textContent = origText;
      btn.disabled = false;
      if (statusMsg) { statusMsg.textContent = 'Re-auth error'; statusMsg.className = 'settings-status-msg err'; }
    });
}

function connectIntegration(serverId, shortName, btn) {
  const badge = document.getElementById('badge-' + serverId);
  const statusMsg = document.getElementById('status-' + serverId);
  btn.textContent = 'Connecting...';
  btn.disabled = true;
  if (badge) { badge.textContent = 'Connecting...'; badge.className = 'integration-badge checking'; }
  if (statusMsg) { statusMsg.textContent = 'Opening sign-in in your browser...'; statusMsg.className = 'settings-status-msg'; }

  fetch(`${API_BASE}/api/integrations/connect/${serverId}`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      if (statusMsg) { statusMsg.textContent = 'Complete the sign-in in your browser, then click "Check Connection" below.'; statusMsg.className = 'settings-status-msg'; }
      btn.textContent = 'Check Connection';
      btn.disabled = false;
      btn.onclick = () => {
        btn.textContent = 'Checking...';
        btn.disabled = true;
        if (statusMsg) { statusMsg.textContent = ''; }
        testMcpConnection(serverId, null);
        // Restore button after test completes
        setTimeout(() => {
          btn.textContent = `Connect ${shortName} Account`;
          btn.disabled = false;
          btn.onclick = () => connectIntegration(serverId, shortName, btn);
        }, 35000);
      };
    })
    .catch(() => {
      btn.textContent = `Connect ${shortName} Account`;
      btn.disabled = false;
      if (badge) { badge.textContent = 'Error'; badge.className = 'integration-badge disconnected'; }
      if (statusMsg) { statusMsg.textContent = 'Connection failed'; statusMsg.className = 'settings-status-msg err'; }
    });
}

function saveAtlassianCredentials(btn) {
  const email = document.getElementById('atlassian-email')?.value?.trim();
  const token = document.getElementById('atlassian-token')?.value?.trim();
  const badge = document.getElementById('badge-atlassian');
  const statusMsg = document.getElementById('status-atlassian');
  const disconnectBtn = document.getElementById('disconnect-btn-atlassian');

  if (!email || !token) {
    if (statusMsg) { statusMsg.textContent = 'Please enter both email and API token.'; statusMsg.className = 'settings-status-msg err'; }
    return;
  }

  btn.textContent = 'Saving...';
  btn.disabled = true;
  if (statusMsg) { statusMsg.textContent = 'Saving credentials and testing connection...'; statusMsg.className = 'settings-status-msg'; }

  fetch(`${API_BASE}/api/integrations/atlassian/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, token })
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        // Test the connection
        testMcpConnection('atlassian', null);
        btn.textContent = 'Save Atlassian Credentials';
        btn.disabled = false;
      } else {
        if (badge) { badge.textContent = 'Not Connected'; badge.className = 'integration-badge disconnected'; }
        if (statusMsg) { statusMsg.textContent = data.error || 'Failed to save credentials'; statusMsg.className = 'settings-status-msg err'; }
        btn.textContent = 'Save Atlassian Credentials';
        btn.disabled = false;
      }
    })
    .catch(() => {
      if (statusMsg) { statusMsg.textContent = 'Error saving credentials'; statusMsg.className = 'settings-status-msg err'; }
      btn.textContent = 'Save Atlassian Credentials';
      btn.disabled = false;
    });
}

function refreshAws(btn) {
  const origText = btn.textContent;
  btn.textContent = 'Refreshing...';
  btn.disabled = true;

  fetch(`${API_BASE}/api/config/refresh-aws`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      btn.textContent = data.ok ? 'SSO Refreshed' : 'Failed';
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 3000);
    })
    .catch(() => {
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 3000);
    });
}

function changeModel(modelId) {
  fetch(`${API_BASE}/api/config/model`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId })
  }).then(r => r.json()).then(() => {
    if (appConfig) {
      appConfig.model.current = modelId;
      renderModelBadge(appConfig);
    }
  });
}

document.getElementById('btn-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  openSettingsModal();
});

// ── Layout engine ──────────────────────────────────────────────────
const GAP = 16;
const MIN_W = 300;
const MIN_H = 180;
let panelLayout = {}; // id -> { w, h }  (x,y computed by flow)

function getContainerWidth() {
  const container = document.getElementById('panels');
  // Account for padding (24px each side)
  return container.clientWidth;
}

// Flow-pack panels into rows, no overlap, no horizontal scroll
function flowLayout(skipId) {
  const container = document.getElementById('panels');
  const cw = container.clientWidth - 48; // Account for 24px padding each side

  let x = 0, y = 0, rowH = 0;

  panels.forEach(panel => {
    const lay = panelLayout[panel.id];
    if (!lay) return;
    if (panel.id == skipId) return;

    // Clamp width to container
    if (lay.w > cw) lay.w = cw;

    // Next row if doesn't fit
    if (x > 0 && x + lay.w > cw) {
      x = 0;
      y += rowH + GAP;
      rowH = 0;
    }

    lay.x = x;
    lay.y = y;
    rowH = Math.max(rowH, lay.h);
    x += lay.w + GAP;

    const el = container.querySelector(`[data-id="${panel.id}"]`);
    if (el) {
      el.style.left = lay.x + 'px';
      el.style.top = lay.y + 'px';
      el.style.width = lay.w + 'px';
      el.style.height = lay.h + 'px';
    }
  });

  // Re-scale all slide frames after layout
  container.querySelectorAll('.slides-body').forEach(b => scaleSlideFrame(b));

  // Set scroll height via spacer div (absolute children don't contribute to scroll)
  const totalH = y + rowH + GAP;
  let spacer = container.querySelector('.layout-spacer');
  if (!spacer) {
    spacer = document.createElement('div');
    spacer.className = 'layout-spacer';
    container.appendChild(spacer);
  }
  spacer.style.height = totalH + 'px';
}

// Find insert index based on a drop point (center of dragged panel)
function findInsertIndex(cx, cy, skipId) {
  let best = panels.length;
  let bestDist = Infinity;

  panels.forEach((panel, i) => {
    if (panel.id == skipId) return;
    const lay = panelLayout[panel.id];
    if (!lay) return;
    const px = lay.x + lay.w / 2;
    const py = lay.y + lay.h / 2;
    const dist = Math.abs(cy - py) * 2 + Math.abs(cx - px); // weight vertical
    if (dist < bestDist) {
      bestDist = dist;
      // Insert before or after based on horizontal position
      best = cx < px ? i : i + 1;
    }
  });

  return best;
}

// ── Render ─────────────────────────────────────────────────────────
let _renderAllPending = false;

function renderAll(immediate) {
  // During streaming, defer renderAll to next animation frame to avoid blocking
  // the main thread (which freezes thinking animations and WebSocket processing)
  if (chatStreaming && !immediate) {
    if (!_renderAllPending) {
      _renderAllPending = true;
      requestAnimationFrame(() => {
        _renderAllPending = false;
        _doRenderAll();
      });
    }
    return;
  }
  _doRenderAll();
}

function _doRenderAll() {
  const container = document.getElementById('panels');

  // Preserve empty-state element — detach before clearing
  let empty = document.getElementById('empty-state');
  if (empty && empty.parentNode) {
    empty.parentNode.removeChild(empty);
  }

  updateChatLayout();

  // Filter panels to only show those belonging to the active conversation
  const visiblePanels = panels.filter(p =>
    p.conversationId === activeConversationId
  );

  if (visiblePanels.length === 0) {
    // Remove all panel elements
    container.querySelectorAll('.panel').forEach(el => el.remove());
    // Remove spacer
    const spacer = container.querySelector('.layout-spacer');
    if (spacer) spacer.remove();
    if (empty) {
      container.appendChild(empty);
      empty.style.display = '';
    }
    return;
  }

  if (empty) empty.style.display = 'none';

  // DOM-diff: reuse existing panel elements, only add/remove what changed
  const existingEls = new Map();
  container.querySelectorAll('.panel[data-id]').forEach(el => {
    existingEls.set(el.dataset.id, el);
  });

  const visibleIds = new Set(visiblePanels.map(p => String(p.id)));

  // Remove panels no longer visible
  for (const [id, el] of existingEls) {
    if (!visibleIds.has(id)) {
      el.remove();
      existingEls.delete(id);
    }
  }

  // Add/reorder panels — insert in correct order
  let prevEl = null;
  visiblePanels.forEach((panel, i) => {
    const id = String(panel.id);
    // Init layout if needed
    if (!panelLayout[panel.id]) {
      const isSlides = panel.type === 'slides';
      const isWide = panel.type === 'embed' || panel.type === 'document';
      panelLayout[panel.id] = {
        w: isSlides ? 900 : isWide ? 800 : 700,
        h: isSlides ? 560 : isWide ? 500 : 420,
        x: 0, y: 0
      };
    }

    let el = existingEls.get(id);
    if (!el) {
      // New panel — create and insert
      try {
        el = createPanelElement(panel, i);
      } catch (e) {
        console.error('Error rendering panel:', panel.id, e);
        return;
      }
    }

    // Ensure correct DOM order
    if (prevEl) {
      if (el.previousElementSibling !== prevEl) {
        prevEl.after(el);
      }
    } else {
      if (el.parentNode !== container || el !== container.querySelector('.panel')) {
        container.prepend(el);
      }
    }
    prevEl = el;
  });

  flowLayout();
}

function createPanelElement(panel, index) {
  const el = document.createElement('div');
  el.className = 'panel';
  el.dataset.id = panel.id;

  const lay = panelLayout[panel.id];
  el.style.width = lay.w + 'px';
  el.style.height = lay.h + 'px';
  if (minimizedPanels.has(String(panel.id))) el.classList.add('minimized');

  const time = new Date(panel.timestamp).toLocaleTimeString();
  const typeIcon = getPanelTypeIcon(panel.type);

  el.innerHTML = `
    <div class="panel-header">
      <div class="panel-header-info">
        <span class="panel-type-icon">${typeIcon}</span>
        <span class="panel-title">${escapeHtml(panel.title || panel.type)}</span>
        <span class="panel-time">${time}</span>
      </div>
      <div class="panel-actions">
        <button class="panel-btn edit-btn" data-action="edit" data-panel-id="${panel.id}" title="Edit with chat">Edit</button>
        ${panel.type === 'embed' && panel.url && panel.url.includes('docs.google.com') ? `<a class="panel-btn" href="${escapeHtml(panel.url)}" target="_blank" title="Open in Google Docs">&#x2197;</a>` : ''}
        ${panel.type === 'slides' ? `<button class="panel-btn export-btn" data-action="export" data-export-type="slides" data-panel-id="${panel.id}" title="Export to Google Slides">Export to Slides</button>` : ''}
        ${panel.type === 'document' ? `<button class="panel-btn export-btn" data-action="export" data-export-type="doc" data-panel-id="${panel.id}" title="Export to Google Docs">Export to Docs</button>` : ''}
        <button class="panel-btn minimize-btn" data-action="minimize" data-panel-id="${panel.id}" title="Minimize">&ndash;</button>
        <button class="panel-btn close-btn" data-action="remove" data-panel-id="${panel.id}" title="Remove">&times;</button>
      </div>
    </div>
    <div class="panel-body ${panel.type === 'embed' ? 'embed' : ''}"></div>
    <div class="resize-handle rh-n"></div>
    <div class="resize-handle rh-s"></div>
    <div class="resize-handle rh-e"></div>
    <div class="resize-handle rh-w"></div>
    <div class="resize-handle rh-nw"></div>
    <div class="resize-handle rh-ne"></div>
    <div class="resize-handle rh-sw"></div>
    <div class="resize-handle rh-se"></div>
  `;

  // Button handlers are handled by document-level delegation (see bottom of file)

  // ── Double-click to expand ──────────────────────────────────────
  const header = el.querySelector('.panel-header');
  header.addEventListener('dblclick', (e) => {
    if (e.target.closest('.panel-actions')) return;
    toggleExpand(panel.id);
  });

  // ── Drag by header ───────────────────────────────────────────────
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.panel-actions')) return;
    if (e.button !== 0) return;
    e.preventDefault();

    const container = document.getElementById('panels');
    const rect = container.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const origX = lay.x, origY = lay.y;

    el.classList.add('dragging');
    el.style.zIndex = 1000;

    // Overlay to capture mouse over iframes
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:999;cursor:grabbing';
    document.body.appendChild(overlay);

    // Flow remaining panels into place
    flowLayout(panel.id);

    const onMove = (ev) => {
      const nx = Math.max(0, origX + ev.clientX - startX);
      const ny = Math.max(0, origY + ev.clientY - startY);
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
      lay.x = nx;
      lay.y = ny;
    };

    const onUp = (ev) => {
      overlay.remove();
      el.classList.remove('dragging');
      el.style.zIndex = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      // Find where to insert based on drop position
      const cx = lay.x + lay.w / 2;
      const cy = lay.y + lay.h / 2;
      const oldIdx = panels.findIndex(p => p.id == panel.id);
      let newIdx = findInsertIndex(cx, cy, panel.id);

      // Adjust for removal shift
      if (newIdx > oldIdx) newIdx--;

      if (newIdx !== oldIdx) {
        panels.splice(oldIdx, 1);
        panels.splice(newIdx, 0, panel);
      }

      flowLayout();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // ── Resize from edges/corners ────────────────────────────────────
  el.querySelectorAll('.resize-handle').forEach(handle => {
    const cls = handle.className;
    const hasN = cls.includes('rh-n');
    const hasS = cls.includes('rh-s');
    const hasE = cls.includes('rh-e');
    const hasW = cls.includes('rh-w');

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX, startY = e.clientY;
      const origW = lay.w, origH = lay.h;
      const cw = getContainerWidth();

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:' + getComputedStyle(handle).cursor;
      document.body.appendChild(overlay);

      const isSlidePanel = !!el.querySelector('.slides-body');
      // For slide panels: header ~48px, controls ~42px = 90px chrome
      const SLIDE_CHROME = 90;
      const SLIDE_RATIO = 16 / 9;

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (hasE) lay.w = Math.min(cw, Math.max(MIN_W, origW + dx));
        if (hasW) lay.w = Math.min(cw, Math.max(MIN_W, origW - dx));
        if (hasS) lay.h = Math.max(MIN_H, origH + dy);
        if (hasN) lay.h = Math.max(MIN_H, origH - dy);

        // Lock slide panels to 16:9 aspect ratio (for the slide area)
        if (isSlidePanel) {
          if (hasE || hasW) {
            // Width changed — derive height from width
            lay.h = Math.round(lay.w / SLIDE_RATIO) + SLIDE_CHROME;
          } else if (hasS || hasN) {
            // Height changed — derive width from height
            lay.w = Math.round((lay.h - SLIDE_CHROME) * SLIDE_RATIO);
          }
          lay.w = Math.min(cw, Math.max(MIN_W, lay.w));
          lay.h = Math.max(MIN_H, lay.h);
        }

        el.style.width = lay.w + 'px';
        el.style.height = lay.h + 'px';

        // Re-scale slides live during resize
        const slidesBody = el.querySelector('.slides-body');
        if (slidesBody) scaleSlideFrame(slidesBody);

        // Re-flow on every frame to show live layout
        flowLayout();
      };

      const onUp = () => {
        overlay.remove();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        flowLayout();
        // Final re-scale for slides
        const slidesBody = el.querySelector('.slides-body');
        if (slidesBody) scaleSlideFrame(slidesBody);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  // ── Render body content ──────────────────────────────────────────
  const body = el.querySelector('.panel-body');

  if (panel.type === 'markdown') {
    body.innerHTML = marked.parse(panel.content || '');
    body.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
  } else if (panel.type === 'embed') {
    const embedUrl = convertToEmbedUrl(panel.url);
    body.innerHTML = `<iframe src="${escapeHtml(embedUrl)}" allowfullscreen></iframe>`;
  } else if (panel.type === 'slides') {
    renderSlidesPanel(body, panel);
  } else if (panel.type === 'document') {
    renderDocumentPanel(body, panel);
  } else if (panel.type && panel.type.startsWith('chart-')) {
    const chartType = panel.type.replace('chart-', '');
    body.innerHTML = '<div class="chart-container"><canvas></canvas></div>';
    setTimeout(() => renderChart(body.querySelector('canvas'), chartType, panel.content), 50);
  }

  return el;
}

// ── Slides panel ───────────────────────────────────────────────────
function renderSlidesPanel(body, panel) {
  let slides;
  let gslidesData = null;
  try {
    const data = typeof panel.content === 'string' ? JSON.parse(panel.content) : panel.content;
    slides = Array.isArray(data) ? data : data.slides || [];
    gslidesData = data._gslidesData || null;
  } catch {
    body.innerHTML = '<p style="padding:20px;color:var(--red)">Invalid slides data</p>';
    return;
  }

  body.classList.add('slides-body');
  body.innerHTML = `
    <div class="slides-viewport">
      <div class="slide-frame"></div>
    </div>
    <div class="slides-controls">
      <button class="slides-nav-btn" data-dir="prev">&larr;</button>
      <span class="slides-counter">1 / ${slides.length}</span>
      <button class="slides-nav-btn" data-dir="next">&rarr;</button>
    </div>
  `;

  let idx = 0;
  const frame = body.querySelector('.slide-frame');
  const counter = body.querySelector('.slides-counter');

  function showSlide() {
    frame.innerHTML = slides[idx].html || slides[idx];
    counter.textContent = `${idx + 1} / ${slides.length}`;
    // Auto-shrink overflowing content to fit the 960×540 frame
    requestAnimationFrame(() => autoFitSlideContent(frame));
  }

  body.querySelector('[data-dir="prev"]').onclick = () => { if (idx > 0) { idx--; showSlide(); } };
  body.querySelector('[data-dir="next"]').onclick = () => { if (idx < slides.length - 1) { idx++; showSlide(); } };

  body.closest('.panel')._slidesData = slides;
  body.closest('.panel')._slidesTitle = panel.title;
  body.closest('.panel')._gslidesData = gslidesData;

  showSlide();
  scaleSlideFrame(body);
}

// Scale the 960×540 slide frame to fit its viewport container
function scaleSlideFrame(body) {
  const viewport = body.querySelector('.slides-viewport');
  const frame = body.querySelector('.slide-frame');
  if (!viewport || !frame) return;

  const vw = viewport.clientWidth - 24; // padding
  const vh = viewport.clientHeight - 24;
  const scale = Math.min(vw / 960, vh / 540, 1); // never scale above 1
  frame.style.transform = `scale(${scale})`;
}

// Auto-shrink slide content that overflows the 960×540 frame
// Uses a wrapper div with CSS transform to scale everything down proportionally
function autoFitSlideContent(frame) {
  const root = frame.querySelector('.slide-content-root');
  if (!root) return;
  // Temporarily allow overflow to measure real content bounds
  root.style.overflow = 'visible';
  root.style.transform = '';
  root.style.transformOrigin = 'top left';
  // Find the bottom-most element to detect actual content height
  let maxBottom = 0;
  root.querySelectorAll('[style*="position:absolute"]').forEach(el => {
    const rect = el.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const bottom = rect.bottom - rootRect.top;
    if (bottom > maxBottom) maxBottom = bottom;
  });
  // Also check non-absolute content via scrollHeight
  maxBottom = Math.max(maxBottom, root.scrollHeight);
  root.style.overflow = 'hidden';
  if (maxBottom > 540) {
    const scale = Math.max(0.6, 540 / maxBottom); // don't shrink below 60%
    root.style.transform = `scale(${scale})`;
    root.style.transformOrigin = 'top left';
    // Expand dimensions so scaled content fills the frame
    root.style.width = (960 / scale) + 'px';
    root.style.height = (540 / scale) + 'px';
  }
}

// ── Document panel ─────────────────────────────────────────────────
function renderDocumentPanel(body, panel) {
  body.classList.add('document-body');
  const content = typeof panel.content === 'string' ? panel.content : (panel.content?.html || '');
  body.innerHTML = `<div class="doc-frame">${content}</div>`;

  const panelEl = body.closest('.panel');
  panelEl._docContent = content;
  panelEl._docTitle = panel.title;
}

// ── Export to Google via chat ───────────────────────────────────────
function exportToGoogle(panelId, exportType) {
  const el = document.querySelector(`.panel[data-id="${panelId}"]`);
  if (!el) return;

  const btn = el.querySelector('.export-btn');
  const origText = btn.textContent;
  btn.textContent = 'Exporting...';
  btn.disabled = true;

  let prompt;

  if (exportType === 'slides') {
    const slides = el._slidesData;
    if (!slides) { btn.textContent = origText; btn.disabled = false; return; }

    // Use stored GSLIDES data if available (structured title/body/layout)
    let parsedSlides;
    if (el._gslidesData && el._gslidesData.slides) {
      parsedSlides = el._gslidesData.slides;
    } else {
      // Fallback: extract plain text from HTML slides
      parsedSlides = slides.map((s, i) => {
        const html = typeof s === 'string' ? s : s.html || '';
        const tmp = document.createElement('div');
        tmp.innerHTML = html;

        let title = '';
        const heading = tmp.querySelector('h1, h2, h3');
        if (heading) title = heading.textContent.trim();

        const bodyParts = [];
        tmp.querySelectorAll('li').forEach(li => bodyParts.push('- ' + li.textContent.trim()));
        if (bodyParts.length === 0) {
          tmp.querySelectorAll('p').forEach(p => {
            const text = p.textContent.trim();
            if (text && text !== title) bodyParts.push(text);
          });
        }
        if (!title && bodyParts.length > 0) title = bodyParts.shift().replace(/^- /, '');

        let layout = '';
        if (html.includes('quote') || html.includes('\u201C')) layout = 'quote';
        else if (html.includes('section') || html.includes('divider')) layout = 'section';

        return { title: title || `Slide ${i + 1}`, body: bodyParts.join('\n'), layout };
      });
    }

    btn.textContent = 'Exporting...';
    fetch(`${API_BASE}/api/export/slides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: el._slidesTitle || 'Presentation', slides: parsedSlides })
    })
      .then(r => r.json())
      .then(data => {
        btn.textContent = origText;
        btn.disabled = false;
        if (data.ok && data.url) {
          if (!chatOpen) toggleChat();
          const presTitle = el._slidesTitle || 'Presentation';
          const msg = `**Exported to Google Slides (CMT branded):**\n\n[${presTitle}](${data.url})`;
          fetch(`${API_BASE}/api/panel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'embed', title: presTitle, url: data.url, manual: true, conversationId: activeConversationId || null })
          });
          addChatMessage('assistant', msg, true);
        } else {
          if (!chatOpen) toggleChat();
          addChatMessage('assistant', `Export failed: ${data.error || 'Unknown error'}. Try asking Claude Code directly to export.`, true);
        }
      })
      .catch(() => {
        btn.textContent = origText;
        btn.disabled = false;
        if (!chatOpen) toggleChat();
        addChatMessage('assistant', 'Export failed — network error. Try asking Claude Code directly to export.', true);
      });
    return; // Don't fall through to the chat prompt path
  } else {
    const content = el._docContent;
    if (!content) { btn.textContent = origText; btn.disabled = false; return; }
    prompt = `Create a Google Doc titled "${el._docTitle || 'Document'}" using the gdocs_create MCP tool.

IMPORTANT: Preserve the formatting from the HTML below. Maintain headings, bold text, bullet points, tables, and overall structure. Here is the HTML content:\n\n${content}\n\nCreate it now with proper formatting and return the URL.`;
  }

  if (!chatOpen) toggleChat();
  addChatMessage('user', `Export: ${exportType === 'slides' ? 'Creating Google Slides' : 'Creating Google Doc'}...`);

  chatStreaming = true;
  streamingConversationId = activeConversationId;
  currentResponseText = '';
  updateSendButton();
  showStatus();
  ws.send(JSON.stringify({ action: 'chat', text: prompt, files: [], conversationId: activeConversationId }));

  const origFinish = finishChat;
  finishChat = function() {
    btn.textContent = origText;
    btn.disabled = false;
    finishChat = origFinish;
    origFinish();
  };
}


function convertToEmbedUrl(url) {
  if (!url) return '';
  if (url.includes('docs.google.com/document')) {
    return url.replace(/\/edit.*$/, '/preview');
  }
  if (url.includes('docs.google.com/presentation')) {
    return url.replace(/\/edit.*$/, '/embed?start=false&loop=false&delayms=3000');
  }
  if (url.includes('docs.google.com/spreadsheets')) {
    return url.replace(/\/edit.*$/, '/pubhtml?widget=true&headers=false');
  }
  return url;
}

function renderChart(canvas, type, content) {
  let data;
  try {
    data = typeof content === 'string' ? JSON.parse(content) : content;
  } catch (e) {
    canvas.parentElement.innerHTML = `<p style="color: var(--danger)">Invalid chart JSON: ${e.message}</p>`;
    return;
  }

  new Chart(canvas, {
    type: type,
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#5f6672' } }
      },
      scales: type !== 'pie' ? {
        x: { ticks: { color: '#5f6672' }, grid: { color: '#e2e5ea' } },
        y: { ticks: { color: '#5f6672' }, grid: { color: '#e2e5ea' } }
      } : undefined
    }
  });
}

function removePanel(id) {
  const idx = panels.findIndex(p => p.id == id);
  if (idx === -1) return;
  const removedPanel = panels[idx];
  const removedLayout = panelLayout[id] ? { ...panelLayout[id] } : null;

  panels.splice(idx, 1);
  delete panelLayout[id];
  fetch(`${API_BASE}/api/panel/${id}`, { method: 'DELETE' }).catch(() => {});

  // During streaming, remove just the DOM element + reflow instead of full renderAll
  // to avoid blocking the main thread (which freezes thinking animations)
  const panelEl = document.querySelector(`.panel[data-id="${id}"]`);
  if (chatStreaming && panelEl) {
    panelEl.remove();
    if (panels.length === 0) {
      const empty = document.getElementById('empty-state');
      if (empty) empty.style.display = '';
    }
    flowLayout();
  } else {
    renderAll();
  }

  // Show undo toast
  showUndoToast(removedPanel, removedLayout, idx);
}

function showUndoToast(panel, layout, index) {
  // Clear previous undo
  if (undoCloseTimer) { clearTimeout(undoCloseTimer); dismissUndoToast(); }

  undoCloseData = { panel, layout, index };

  let toast = document.getElementById('undo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'undo-toast';
    toast.className = 'undo-toast';
    document.body.appendChild(toast);
  }
  const title = escapeHtml(panel.title || panel.type);
  toast.innerHTML = `<span>Removed "${title}"</span><button onclick="undoClose()">Undo</button>`;
  requestAnimationFrame(() => toast.classList.add('visible'));

  undoCloseTimer = setTimeout(() => {
    dismissUndoToast();
  }, 5000);
}

function dismissUndoToast() {
  const toast = document.getElementById('undo-toast');
  if (toast) toast.classList.remove('visible');
  undoCloseData = null;
  undoCloseTimer = null;
}

function undoClose() {
  if (!undoCloseData) return;
  const { panel, layout, index } = undoCloseData;

  // Re-add locally first (server broadcast will be deduped below)
  panels.splice(Math.min(index, panels.length), 0, panel);
  if (layout) panelLayout[panel.id] = layout;
  renderAll();

  // Re-add to server — the WebSocket broadcast will see it already exists and skip
  fetch(`${API_BASE}/api/panel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(panel)
  });

  if (undoCloseTimer) clearTimeout(undoCloseTimer);
  dismissUndoToast();
}

// Single document-level delegation for ALL panel button actions.
// Uses pointerdown (fires before click, not stolen by iframes).
// Avoids per-button handlers that break when renderAll() rebuilds DOM mid-event.
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  // Only handle buttons inside #panels
  if (!btn.closest('#panels')) return;
  e.stopPropagation();
  e.preventDefault();
  const action = btn.dataset.action;
  const panelId = btn.dataset.panelId;
  if (!panelId) return;
  if (action === 'remove') removePanel(panelId);
  else if (action === 'minimize') toggleMinimize(panelId);
  else if (action === 'edit') startEditing(panelId);
  else if (action === 'export') exportToGoogle(panelId, btn.dataset.exportType);
}, true); // capture phase — fires before any per-element handler

// Re-flow on window resize + re-scale slides
window.addEventListener('resize', () => {
  flowLayout();
  document.querySelectorAll('.slides-body').forEach(b => scaleSlideFrame(b));
});

// ── Modals ─────────────────────────────────────────────────────────
function closePasteModal() {
  document.getElementById('paste-modal').classList.remove('active');
  document.getElementById('paste-title').value = '';
  document.getElementById('paste-content').value = '';
}

function submitPaste() {
  const title = document.getElementById('paste-title').value || 'Pasted Content';
  const type = document.getElementById('paste-type').value;
  const content = document.getElementById('paste-content').value;
  if (!content.trim()) return;

  fetch(`${API_BASE}/api/panel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, title, content, conversationId: activeConversationId || null })
  });
  closePasteModal();
}

function closeEmbedModal() {
  document.getElementById('embed-modal').classList.remove('active');
  document.getElementById('embed-title').value = '';
  document.getElementById('embed-url').value = '';
}

function submitEmbed() {
  const title = document.getElementById('embed-title').value || 'Embedded Content';
  const url = document.getElementById('embed-url').value;
  if (!url.trim()) return;

  fetch(`${API_BASE}/api/panel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'embed', title, url, manual: true, conversationId: activeConversationId || null })
  });
  closeEmbedModal();
}

function clearAllPanels() {
  if (!confirm('Clear all panels from this chat?')) return;
  // Only delete panels belonging to the active conversation
  const toDelete = panels.filter(p => p.conversationId === activeConversationId);
  toDelete.forEach(p => {
    fetch(`${API_BASE}/api/panel/${p.id}`, { method: 'DELETE' });
  });
}

// ── Presentation mode ──────────────────────────────────────────────
document.getElementById('btn-present').addEventListener('click', () => {
  if (panels.length === 0) return;
  currentSlide = 0;
  showPresentation();
});

function showPresentation() {
  document.getElementById('presentation').classList.add('active');
  renderSlide();
  document.addEventListener('keydown', presKeyHandler);
}

function exitPresentation() {
  document.getElementById('presentation').classList.remove('active');
  document.removeEventListener('keydown', presKeyHandler);
}

function renderSlide() {
  const panel = panels[currentSlide];
  const content = document.getElementById('presentation-content');
  document.getElementById('slide-counter').textContent = `${currentSlide + 1} / ${panels.length}`;

  if (panel.type === 'markdown') {
    content.innerHTML = marked.parse(panel.content || '');
    content.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
  } else if (panel.type === 'embed') {
    const embedUrl = convertToEmbedUrl(panel.url);
    content.innerHTML = `<iframe src="${escapeHtml(embedUrl)}" style="width:100%;height:80vh;border:none;" allowfullscreen></iframe>`;
  } else if (panel.type && panel.type.startsWith('chart-')) {
    const chartType = panel.type.replace('chart-', '');
    content.innerHTML = '<div style="height:70vh;"><canvas></canvas></div>';
    setTimeout(() => renderChart(content.querySelector('canvas'), chartType, panel.content), 50);
  }
}

function prevSlide() { if (currentSlide > 0) { currentSlide--; renderSlide(); } }
function nextSlide() { if (currentSlide < panels.length - 1) { currentSlide++; renderSlide(); } }

function presKeyHandler(e) {
  if (e.key === 'ArrowLeft') prevSlide();
  else if (e.key === 'ArrowRight') nextSlide();
  else if (e.key === 'Escape') exitPresentation();
}

// ── Edit mode ──────────────────────────────────────────────────────
let editingPanel = null;

function startEditing(panelId) {
  const panel = panels.find(p => p.id == panelId);
  if (!panel) return;
  editingPanel = { id: panel.id, type: panel.type, title: panel.title };

  if (panel.type === 'embed' && panel.url && panel.url.includes('docs.google.com')) {
    editingPanel.isGoogleDoc = true;
    editingPanel.googleUrl = panel.url;
    const docMatch = panel.url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
    if (docMatch) {
      const typeMap = { document: 'document', spreadsheets: 'spreadsheet', presentation: 'presentation' };
      editingPanel.googleDocType = typeMap[docMatch[1]] || docMatch[1];
      editingPanel.googleDocId = docMatch[2];
    }
  }

  document.querySelectorAll('.panel').forEach(el => el.classList.remove('editing'));
  const el = document.querySelector(`.panel[data-id="${panelId}"]`);
  if (el) el.classList.add('editing');

  if (!chatOpen) toggleChat();
  renderEditBanner();
  document.getElementById('chat-input').focus();
}

function stopEditing() {
  editingPanel = null;
  document.querySelectorAll('.panel').forEach(el => el.classList.remove('editing'));
  renderEditBanner();
  updateChatContext();
}

function renderEditBanner() {
  let banner = document.getElementById('edit-banner');
  if (!editingPanel) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'edit-banner';
    const inputArea = document.querySelector('.chat-input-area');
    inputArea.parentNode.insertBefore(banner, inputArea);
  }
  banner.className = 'edit-banner';
  banner.innerHTML = `
    <span>Editing: <strong>${escapeHtml(editingPanel.title || editingPanel.type)}</strong></span>
    <button onclick="stopEditing()">Done</button>
  `;
}

// ── Chat ───────────────────────────────────────────────────────────
let chatOpen = true; // chat starts open
let chatStreaming = false;
let streamingConversationId = null;
let currentResponseEl = null;
let currentResponseText = '';
let statusEl = null;
let thinkingEl = null;
let thinkingText = '';
let attachedFiles = [];
let createdDocIds = new Set(); // track docs already embedded this response
let undoCloseTimer = null;
let undoCloseData = null; // { panel, layout, index }
let _streamRenderTimer = null; // debounce streaming markdown renders
let _thinkingRenderTimer = null; // debounce thinking markdown renders

document.getElementById('btn-chat').addEventListener('click', toggleChat);

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chat-drawer').classList.toggle('open', chatOpen);
  document.getElementById('btn-chat').textContent = chatOpen ? 'Hide Chat' : 'Chat';
  if (chatOpen) {
    document.getElementById('chat-input').focus();
    updateChatContext();
    restoreChatHistory();
  }
  // Re-flow panels after chat drawer transition completes (width change)
  setTimeout(flowLayout, 350);
}

document.getElementById('chat-file-input').addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files.length) return;

  for (const file of files) {
    try {
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
        body: file
      });
      const data = await res.json();
      if (data.ok) {
        attachedFiles.push({ path: data.path, filename: data.filename, size: file.size });
      } else {
        console.error('Upload error:', data.error);
        addChatMessage('assistant', `Failed to attach "${file.name}": ${data.error || 'unknown error'}`, false);
      }
    } catch (err) {
      console.error('Upload failed:', err);
      addChatMessage('assistant', `Failed to upload "${file.name}": ${err.message}`, false);
    }
  }
  renderFilePreview();
  e.target.value = '';
});

function renderFilePreview() {
  const container = document.getElementById('chat-file-preview');
  if (attachedFiles.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  container.innerHTML = attachedFiles.map((f, i) => {
    const icon = f.type === 'gdrive'
      ? getDriveIcon(f.mimeType || '')
      : '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 1h6l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z"/><path d="M10 1v4h4"/></svg>';
    const sizeLabel = f.type === 'gdrive' ? 'Drive' : formatSize(f.size);
    return `<div class="file-chip${f.type === 'gdrive' ? ' gdrive' : ''}">
      ${icon}
      <span>${escapeHtml(f.filename)}</span>
      <span class="file-size">${sizeLabel}</span>
      <button onclick="removeFile(${i})">&times;</button>
    </div>`;
  }).join('');
}

function removeFile(index) {
  attachedFiles.splice(index, 1);
  renderFilePreview();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || chatStreaming) return;

  let displayText = text;
  if (attachedFiles.length > 0) {
    displayText += '\n\n' + attachedFiles.map(f => `[Attached: ${f.filename}]`).join(' ');
  }
  addChatMessage('user', displayText);

  // Wrap with prompt type context if a quick-prompt workflow is active
  const promptType = input.dataset.promptType;
  delete input.dataset.promptType;
  input.placeholder = 'Ask Claude anything... (\u2318K)';
  input.value = '';

  let fullText = text;
  if (promptType && !editingPanel) {
    const researchPreamble = `Before creating content, research this topic thoroughly:
1. Search Google Drive (gdrive_search) for any relevant existing documents, spreadsheets, or presentations
2. Search Confluence (confluence_search) for any relevant wiki pages or documentation
3. If the Drive and Confluence results don't provide enough information, use web search to fill in gaps

Use what you find to make the content accurate, specific, and grounded in real data. Cite sources where relevant.\n\n`;
    const wrappers = {
      presentation: `${researchPreamble}Then create a slide presentation about this topic. Output the slides as a <!--GSLIDES:{...}--> block (NOT a <!--PANEL:--> block). Follow the slide creation rules in your system prompt. CRITICAL DESIGN RULES: Every custom slide MUST have background shape elements to create visual zones — NEVER just text on white. Use two-zone composition: HERO zone (60% — big stat, image, diagram, colored shape) + DETAIL zone (40% — 2-3 points). Max 3-4 bullets per slide. Topic:\n\n${text}`,
      document: `${researchPreamble}Then write a well-structured document about the following topic. Include clear sections with headings:\n\n${text}`,
      chart: `${researchPreamble}Then build a chart visualizing the following data or topic. Choose the best chart type (bar, line, or pie) for the data:\n\n${text}`
    };
    fullText = wrappers[promptType] || text;
  } else if (editingPanel) {
    const panel = panels.find(p => p.id == editingPanel.id);
    if (panel) {
      if (editingPanel.isGoogleDoc) {
        const docId = editingPanel.googleDocId;
        const docType = editingPanel.googleDocType;
        const toolHint = docType === 'document' ? 'gdocs_read, gdocs_update, gdocs_replace, gdocs_insert'
          : docType === 'spreadsheet' ? 'gsheets_read, gsheets_update'
          : docType === 'presentation' ? 'gslides_read, gslides_create'
          : 'the appropriate Google Workspace MCP tools';
        fullText = `I need you to edit a Google ${docType} (ID: ${docId}, URL: ${editingPanel.googleUrl}). Use the MCP tools (${toolHint}) to first read the current content, then make the following changes:\n\n${text}\n\nUse the MCP tools directly to modify the document. Do NOT create a new document - edit the existing one. After making changes, confirm what you changed.`;
      } else if (panel.type === 'slides') {
        const currentContent = getCurrentContent(panel);
        fullText = `I'm editing the slides panel titled "${panel.title}". Here is the current GSLIDES data:\n\n${currentContent}\n\nMy edit request: ${text}\n\nReturn the complete updated slides as a <!--GSLIDES:{...}--> block. The JSON must have "title" and "slides" array.

DEFAULT TO CUSTOM LAYOUT. Every custom slide MUST start with at least one background shape element to create visual zones — NEVER leave text on plain white. USE THE FULL 960px SLIDE WIDTH — never leave half the slide empty. Two-zone composition: if you have text/cards on the left, put an image placeholder, chart, big stat, or colored shape on the right (or vice versa). Max 3-4 bullets per text block — more items are fine if placed in separate visual containers (cards, colored boxes, columns with background shapes).

Custom layout: set "layout":"custom" with "elements" array. Canvas: 960x540. Each element: {"type":"text|shape|image", "x":0, "y":0, "w":200, "h":40, ...}. ALWAYS include shape elements for visual zones (e.g. #F3F4F6 sidebar, #E8F2FC card, #1a80d7 accent bar, #0D4A8A dark hero zone). Keep all content above y=490 (footer zone).

CMT style: white bg, blue (#1a80d7) accents, black body. Allowed backgrounds: #FFFFFF, #F3F4F6, #E8F2FC, #1a80d7, #0D4A8A. No dark navy/charcoal. 5-8 slides ideal.`;
      } else {
        const currentContent = getCurrentContent(panel);
        fullText = `I'm editing the ${panel.type} panel titled "${panel.title}". Here is the current content:\n\n${currentContent}\n\nMy edit request: ${text}\n\nPlease return the complete updated content using a <!--PANEL:--> block with type "${panel.type}".`;
      }
    }
  }

  chatStreaming = true;
  streamingConversationId = activeConversationId;
  currentResponseText = '';
  updateSendButton();
  renderHistoryList();

  showStatus();
  ws.send(JSON.stringify({ action: 'chat', text: fullText, files: attachedFiles, conversationId: activeConversationId, editingPanel: !!editingPanel }));

  attachedFiles = [];
  renderFilePreview();
}

function getCurrentContent(panel) {
  if (panel.type === 'slides') {
    try {
      const data = typeof panel.content === 'string' ? JSON.parse(panel.content) : panel.content;
      if (data._gslidesData) {
        return JSON.stringify(data._gslidesData, null, 2);
      }
      const slides = Array.isArray(data) ? data : data.slides || [];
      return slides.map((s, i) => `Slide ${i + 1}:\n${typeof s === 'string' ? s : s.html || ''}`).join('\n\n---\n\n');
    } catch { return '[]'; }
  } else if (panel.type === 'document') {
    return typeof panel.content === 'string' ? panel.content : (panel.content?.html || '');
  } else {
    return panel.content || '';
  }
}

function stopChat() {
  ws.send(JSON.stringify({ action: 'chat-stop' }));
  finishChat();
}

// ── Send/Stop button + chat-first layout ──────────────────────────
function updateSendButton() {
  const btn = document.getElementById('chat-send');
  if (chatStreaming) {
    btn.className = 'chat-send-btn stop active';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    btn.onclick = stopChat;
    btn.title = 'Stop generating';
  } else {
    const hasText = document.getElementById('chat-input').value.trim().length > 0;
    btn.className = 'chat-send-btn' + (hasText ? ' active' : '');
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
    btn.onclick = () => { sendChat(); };
    btn.title = 'Send (Enter)';
  }
}

// Toggle chat-first layout based on panel count
function updateChatLayout() {
  const layout = document.getElementById('app-layout');
  const visibleCount = panels.filter(p => p.conversationId === activeConversationId).length;
  if (visibleCount === 0) {
    layout.classList.add('chat-only');
  } else {
    layout.classList.remove('chat-only');
  }
}

// ── Model pill selector in input area ─────────────────────────────
function toggleModelPillMenu() {
  const menu = document.getElementById('model-pill-menu');
  menu.classList.toggle('open');
  if (menu.classList.contains('open')) renderModelPillMenu();
}

function renderModelPillMenu() {
  const menu = document.getElementById('model-pill-menu');
  const models = appConfig?.model?.available || [];
  const current = appConfig?.model?.current || '';
  menu.innerHTML = models.map(m =>
    `<button class="${current === m.id ? 'selected' : ''}" onclick="selectModelPill('${m.id}', '${m.label}')">${m.label}</button>`
  ).join('');
}

function selectModelPill(id, label) {
  fetch(`${API_BASE}/api/config/model`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: id })
  });
  document.getElementById('model-pill-label').textContent = label;
  document.getElementById('model-pill-menu').classList.remove('open');
  if (appConfig) appConfig.model.current = id;
}

// Close model menu on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.input-model-selector')) {
    document.getElementById('model-pill-menu')?.classList.remove('open');
  }
});

// ── Copy buttons on messages and code blocks ──────────────────────
function addMsgActions(msgEl) {
  if (!msgEl || msgEl.querySelector('.msg-actions')) return;
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.innerHTML = `<button class="msg-action-btn" onclick="copyMessage(this)" title="Copy"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy</button>`;
  msgEl.appendChild(actions);
  // Add copy buttons to code blocks
  msgEl.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.textContent = 'Copy';
    btn.onclick = (e) => { e.stopPropagation(); copyCodeBlock(btn, pre); };
    pre.appendChild(btn);
  });
  // Collapse long messages after a short delay so content is measured
  requestAnimationFrame(() => maybeCollapseMsg(msgEl));
}

const MSG_COLLAPSE_HEIGHT = 280; // px threshold

function maybeCollapseMsg(msgEl) {
  if (!msgEl || msgEl.classList.contains('msg-collapsible')) return;
  if (msgEl.scrollHeight <= MSG_COLLAPSE_HEIGHT) return;
  // Find parent chat-msg if this is the content wrapper
  const chatMsg = msgEl.closest('.chat-msg') || msgEl;
  chatMsg.classList.add('msg-collapsible', 'msg-collapsed');
  // Add toggle button to the content wrapper
  const toggle = document.createElement('button');
  toggle.className = 'msg-expand-btn';
  toggle.textContent = 'Show more';
  toggle.onclick = (e) => {
    e.stopPropagation();
    toggleMsgExpand(chatMsg, toggle);
  };
  msgEl.appendChild(toggle);
}

function toggleMsgExpand(msgEl, btn) {
  const collapsed = msgEl.classList.toggle('msg-collapsed');
  btn.textContent = collapsed ? 'Show more' : 'Show less';
  if (!collapsed) scrollChat();
}

function copyMessage(btn) {
  const msg = btn.closest('.chat-msg');
  const text = msg.innerText.replace(/\nCopy$/, '').trim();
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied';
    setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy'; }, 2000);
  });
}

function copyCodeBlock(btn, pre) {
  const code = pre.querySelector('code');
  const text = code ? code.innerText : pre.innerText;
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.classList.remove('copied'); btn.textContent = 'Copy'; }, 2000);
  });
}

function finishChat() {
  chatStreaming = false;
  streamingConversationId = null;
  updateSendButton();
  removeStatus();
  renderHistoryList();

  if (currentResponseText) {
    if (editingPanel && editingPanel.isGoogleDoc) {
      // Delay refresh to let Google's API propagate changes
      const editId = editingPanel.id;
      setTimeout(() => refreshEmbedPanel(editId), 1500);
    } else if (editingPanel) {
      applyEditResponse(currentResponseText);
    } else {
      // Retry GSLIDES scan with repair (may have failed during streaming)
      if (!gslidesCreatedThisResponse) {
        liveScanGSlides(currentResponseText);
      }
      extractAndCreatePanel(currentResponseText);
    }
  }

  // Sync with server to catch hook-created panels, then refresh iframes.
  // Check at 500ms and 2000ms to catch late-arriving hook panels.
  const syncAndRefresh = () => {
    fetch(`${API_BASE}/api/panels`).then(r => r.json()).then(serverPanels => {
      const serverIds = new Set(serverPanels.map(p => p.id));
      const localIds = new Set(panels.map(p => p.id));
      const hasNew = serverPanels.some(p => !localIds.has(p.id));
      if (hasNew || serverPanels.length !== panels.length) {
        panels = serverPanels;
        renderAll();
      }
    }).catch(() => {});
  };
  setTimeout(syncAndRefresh, 500);
  setTimeout(syncAndRefresh, 2000);
  setTimeout(refreshAllEmbeds, 600);

  // Auto-enter edit mode on the newly created panel so follow-up messages edit it
  if (panelCreatedThisResponse && !editingPanel) {
    const lastPanel = panels[panels.length - 1];
    if (lastPanel) {
      showSuggestedPrompts(lastPanel.type);
      // Delay to ensure panel exists in DOM after renderAll
      setTimeout(() => {
        const p = panels[panels.length - 1];
        if (p) startEditing(p.id);
      }, 600);
    }
  } else if (!panelCreatedThisResponse) {
    removeSuggestedPrompts();
  }

  updateChatContext();

  // Auto-name conversation after first exchange
  autoNameConversation();
}

function refreshEmbedPanel(panelId) {
  const panelEl = document.querySelector(`.panel[data-id="${panelId}"]`);
  if (!panelEl) return;
  const iframe = panelEl.querySelector('iframe');
  if (iframe) {
    const src = iframe.src;
    // Add cache buster to force reload
    const bustUrl = src.includes('?') ? src + '&_t=' + Date.now() : src + '?_t=' + Date.now();
    iframe.src = '';
    setTimeout(() => { iframe.src = bustUrl; }, 800);
  }
}

function refreshAllEmbeds() {
  document.querySelectorAll('.panel-body.embed iframe').forEach((iframe, i) => {
    const src = iframe.src;
    iframe.src = '';
    setTimeout(() => { iframe.src = src; }, 300 + i * 100);
  });
}

function applyEditResponse(responseText) {
  const panel = panels.find(p => p.id == editingPanel.id);
  if (!panel) return;

  const match = responseText.match(/<!--PANEL:([\s\S]*?)-->/);
  if (!match) return;

  try {
    const panelData = JSON.parse(match[1]);
    if (panelData.content !== undefined) {
      panel.content = panelData.content;
      if (panelData.title) panel.title = panelData.title;

      fetch(`${API_BASE}/api/panel/${panel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: panel.content, title: panel.title })
      });

      renderAll();
    }
  } catch (e) {
    console.error('Failed to parse edit response:', e);
  }
}

function showStatus() {
  if (document.getElementById('chat-status')) return; // already showing
  removeStatus();
  statusEl = document.createElement('div');
  statusEl.className = 'chat-status';
  statusEl.id = 'chat-status';
  statusEl.innerHTML = `<div class="dot-pulse"><span></span><span></span><span></span></div>`;
  document.getElementById('chat-messages').appendChild(statusEl);
  scrollChat();
}

function updateStatus() {
  if (!document.getElementById('chat-status')) showStatus();
}

function removeStatus() {
  const el = document.getElementById('chat-status');
  if (el) el.remove();
  statusEl = null;
}

const chatInput = document.getElementById('chat-input');

function autoResizeInput() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
}

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
    // Reset height after send
    setTimeout(() => { chatInput.style.height = 'auto'; }, 0);
  }
});

// Send button click is managed by updateSendButton() (sets onclick to sendChat or stopChat)

// Intercept Google Doc links in chat - open in visualizer frame (dedup by URL)
document.getElementById('chat-messages').addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  if (href.match(/docs\.google\.com\/(document|spreadsheets|presentation|forms)\//)) {
    e.preventDefault();
    e.stopPropagation();
    // Extract doc ID to check for duplicates
    const docIdMatch = href.match(/\/d\/([^/]+)/);
    const docId = docIdMatch ? docIdMatch[1] : null;
    const alreadyExists = docId && panels.some(p => p.url && p.url.includes(docId));
    if (!alreadyExists) {
      const title = link.textContent || 'Google Doc';
      fetch(`${API_BASE}/api/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'embed', title, url: href, manual: true, conversationId: activeConversationId || null })
      });
    }
  }
});

function addChatMessage(role, content, isMarkdown, skipSave) {
  const messages = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;

  // Create avatar
  const avatar = document.createElement('div');
  avatar.className = `chat-avatar ${role}`;
  if (role === 'assistant') {
    avatar.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>';
  } else {
    avatar.textContent = 'Y';
  }

  // Create content wrapper
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'chat-msg-content';

  if (role === 'assistant' || isMarkdown) {
    contentWrapper.innerHTML = marked.parse(content);
    contentWrapper.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
    if (role === 'assistant') addMsgActions(contentWrapper);
  } else {
    contentWrapper.textContent = content;
  }

  msg.appendChild(avatar);
  msg.appendChild(contentWrapper);
  messages.appendChild(msg);
  scrollChat();
  if (!skipSave) saveChatHistory(role, content);
  return msg;
}

// ── Chat persistence ─────────────────────────────────────────────
function saveChatHistory(role, content) {
  try {
    const history = JSON.parse(localStorage.getItem('claudeio-chat') || '[]');
    history.push({ role, content, ts: Date.now() });
    while (history.length > 100) history.shift();
    localStorage.setItem('claudeio-chat', JSON.stringify(history));
  } catch {}
}

function restoreChatHistory() {
  const messages = document.getElementById('chat-messages');
  if (messages.children.length > 0) return;
  try {
    const history = JSON.parse(localStorage.getItem('claudeio-chat') || '[]');
    if (history.length === 0) return;
    history.forEach(m => {
      addChatMessage(m.role, m.content, m.role === 'assistant', true);
    });
  } catch {}
}

function clearSavedChatHistory() {
  localStorage.removeItem('claudeio-chat');
}

// ── Typing indicator ──────────────────────────────────────────────
function showTypingIndicator() {
  removeTypingIndicator();
  const messages = document.getElementById('chat-messages');
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.id = 'typing-indicator';
  indicator.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div> Claude is thinking...';
  messages.appendChild(indicator);
  scrollChat();
}

function removeTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function scrollChat() {
  const messages = document.getElementById('chat-messages');
  messages.scrollTop = messages.scrollHeight;
}

// Disabled: don't auto-embed Google Docs found in responses (research docs clutter the canvas)
// Users can still click links or use Add > Google Drive to embed manually
function scanAndEmbed() {}

let panelCreatedThisResponse = false;
let lastCreatedPanelType = null; // track type of panel created this response
let gslidesCreatedThisResponse = false;

// Generate CMT-branded HTML for a single slide preview
// Matches Code.gs layouts: metrics, fact, two-cols, image-left/right,
// comparison, table, section-blue, split, custom
function generateCMTSlideHtml(slide, index, total) {
  const title = slide.title || '';
  const body = slide.body || '';
  const layout = (slide.layout || '').toLowerCase().replace(/-/g, '');
  const esc = escapeHtml;
  const imageDesc = slide.image || '';

  // Footer matching Code.gs: separator line, text left, CMT logo right
  // Skip footer on section-blue
  const cmtLogo = '<svg width="16" height="16" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="44" stroke="#CBCBCB" stroke-width="6" fill="none"/><path d="M18 48 Q50 8 82 48" stroke="#CBCBCB" stroke-width="5" fill="none"/><line x1="18" y1="48" x2="82" y2="48" stroke="#CBCBCB" stroke-width="4"/><line x1="30" y1="48" x2="30" y2="88" stroke="#CBCBCB" stroke-width="5"/><line x1="42" y1="48" x2="42" y2="88" stroke="#CBCBCB" stroke-width="5"/><line x1="50" y1="48" x2="50" y2="88" stroke="#CBCBCB" stroke-width="5"/><line x1="58" y1="48" x2="58" y2="88" stroke="#CBCBCB" stroke-width="5"/><line x1="70" y1="48" x2="70" y2="88" stroke="#CBCBCB" stroke-width="5"/></svg>';
  const footer = layout === 'sectionblue' ? '' :
    '<div style="position:absolute;left:20px;right:20px;top:498px;height:1px;background:#E5E7EB;"></div>' +
    '<div style="position:absolute;left:20px;top:506px;font-size:6px;color:#CBCBCB;font-family:Helvetica Neue,sans-serif;">Confidential &amp; Proprietary | Cambridge Mobile Telematics</div>' +
    '<div style="position:absolute;right:20px;top:504px;">' + cmtLogo + '</div>';

  const wrap = (inner) => '<div class="slide-content-root" style="width:960px;height:540px;position:relative;overflow:hidden;font-family:\'Helvetica Neue\', Helvetica, Arial, sans-serif;background:#FFFFFF;">' + inner + footer + '</div>';

  // Image placeholder matching Code.gs buildImagePlaceholder
  function imgPlaceholder(desc, x, y, w, h) {
    return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:#E5E7EB;border:2px dashed #9CA3AF;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;">` +
      '<div style="font-size:18px;color:#6B7280;font-weight:700;margin-bottom:4px;">TBD</div>' +
      `<div style="font-size:12px;color:#6B7280;text-align:center;padding:0 16px;line-height:1.4;">${esc(desc)}</div></div>`;
  }

  // ── METRICS — branded card grid
  if (layout === 'metrics') {
    const items = body.split('\n').filter(l => l.trim());
    const cols = items.length <= 3 ? items.length : (items.length <= 4 ? 2 : 3);
    const rows = Math.ceil(items.length / cols);
    const accentColors = ['#1a80d7', '#0D4A8A', '#3BB87A', '#5387C6', '#DB2727', '#1a80d7'];
    const padX = 48, padY = 88;
    const gapX = 20, gapY = 20;
    const totalW = 960 - padX * 2;
    const totalH = 490 - padY - 20;
    const cardW = (totalW - (cols - 1) * gapX) / cols;
    const cardH = (totalH - (rows - 1) * gapY) / rows;
    let grid = '';
    // Subtle full-slide background
    grid += `<div style="position:absolute;left:0;top:0;width:960px;height:540px;background:#F8FAFC;"></div>`;
    items.forEach((item, i) => {
      const parts = item.split('|');
      const metric = parts[0].trim();
      const label = parts.length > 1 ? parts[1].trim() : '';
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padX + col * (cardW + gapX);
      const y = padY + row * (cardH + gapY);
      const accent = accentColors[i % accentColors.length];
      const mFS = cols <= 2 ? 44 : 36;
      // Card background
      grid += `<div style="position:absolute;left:${x}px;top:${y}px;width:${cardW}px;height:${cardH}px;background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,0.06);"></div>`;
      // Left accent bar
      grid += `<div style="position:absolute;left:${x}px;top:${y}px;width:4px;height:${cardH}px;background:${accent};border-radius:8px 0 0 8px;"></div>`;
      // Metric number
      grid += `<div style="position:absolute;left:${x + 24}px;top:${y + (cardH * 0.18)}px;width:${cardW - 40}px;font-size:${mFS}px;font-weight:700;color:${accent};">${esc(metric)}</div>`;
      // Label
      if (label) grid += `<div style="position:absolute;left:${x + 24}px;top:${y + (cardH * 0.58)}px;width:${cardW - 40}px;font-size:14px;color:#515B73;line-height:1.4;">${esc(label)}</div>`;
    });
    return wrap(
      `<div style="position:absolute;left:48px;top:28px;font-size:26px;font-weight:700;color:#1a80d7;">${esc(title)}</div>` + grid
    );
  }

  // ── FACT — matches Code.gs buildFact
  if (layout === 'fact') {
    return wrap(
      `<div style="position:absolute;left:-40px;top:40px;width:600px;height:280px;font-size:160px;font-weight:700;color:#D7DFF1;text-align:center;">${esc(title)}</div>` +
      `<div style="position:absolute;left:80px;top:100px;width:800px;height:160px;font-size:84px;font-weight:700;color:#1a80d7;text-align:center;">${esc(title)}</div>` +
      '<div style="position:absolute;left:420px;top:275px;width:120px;height:3px;background:#1a80d7;"></div>' +
      (body ? `<div style="position:absolute;left:140px;top:300px;width:680px;height:140px;font-size:20px;color:#515B73;text-align:center;line-height:1.5;">${esc(body)}</div>` : '')
    );
  }

  // ── TWO-COLS — matches Code.gs buildTwoCols
  if (layout === 'twocols') {
    const titles = title.split('|');
    const lines = body.split('\n').filter(l => l.trim());
    const itemH = Math.min(70, 390 / lines.length);
    const fontSize = lines.length > 5 ? 13 : 15;
    let items = '';
    lines.forEach((line, i) => {
      const parts = line.split('|');
      const y = 84 + i * itemH;
      const lt = (parts[0] || '').trim().replace(/^[-•]\s*/, '');
      const rt = (parts.length > 1 ? parts[1] : '').trim().replace(/^[-•]\s*/, '');
      items += `<div style="position:absolute;left:48px;top:${y + 8}px;width:6px;height:6px;background:#1a80d7;border-radius:50%;"></div>`;
      items += `<div style="position:absolute;left:64px;top:${y}px;width:400px;height:${itemH}px;font-size:${fontSize}px;color:#000;line-height:1.35;">${esc(lt)}</div>`;
      if (rt) {
        items += `<div style="position:absolute;left:496px;top:${y + 8}px;width:6px;height:6px;background:#1a80d7;border-radius:50%;"></div>`;
        items += `<div style="position:absolute;left:512px;top:${y}px;width:400px;height:${itemH}px;font-size:${fontSize}px;color:#000;line-height:1.35;">${esc(rt)}</div>`;
      }
    });
    return wrap(
      `<div style="position:absolute;left:48px;top:30px;font-size:22px;font-weight:700;color:#1a80d7;">${esc((titles[0] || '').trim())}</div>` +
      `<div style="position:absolute;left:496px;top:30px;font-size:22px;font-weight:700;color:#1a80d7;">${esc((titles[1] || '').trim())}</div>` +
      '<div style="position:absolute;left:478px;top:30px;width:2px;height:440px;background:#E5E7EB;"></div>' +
      items
    );
  }

  // ── IMAGE-LEFT / IMAGE-RIGHT — matches Code.gs buildImageSide
  if (layout === 'imageleft' || layout === 'imageright') {
    const side = layout === 'imageleft' ? 'left' : 'right';
    const imgX = side === 'left' ? 40 : 520;
    const textX = side === 'left' ? 472 : 48;
    const textW = 440;
    const lines = body.split('\n').filter(l => l.trim());
    const itemH = Math.min(65, 370 / lines.length);
    const fontSize = lines.length > 5 ? 13 : 15;
    let items = '';
    lines.forEach((line, i) => {
      const text = line.trim().replace(/^[-•]\s*/, '');
      const y = 96 + i * itemH;
      items += `<div style="position:absolute;left:${textX}px;top:${y + 4}px;width:3px;height:${itemH - 12}px;background:#1a80d7;"></div>`;
      items += `<div style="position:absolute;left:${textX + 14}px;top:${y + 4}px;width:${textW - 14}px;height:${itemH - 8}px;font-size:${fontSize}px;color:#000;line-height:1.4;">${esc(text)}</div>`;
    });
    return wrap(
      imgPlaceholder(imageDesc, imgX, 30, 400, 440) +
      `<div style="position:absolute;left:${textX}px;top:30px;width:${textW}px;font-size:28px;font-weight:700;color:#1a80d7;">${esc(title)}</div>` +
      items
    );
  }

  // ── COMPARISON — matches Code.gs buildComparison
  if (layout === 'comparison') {
    const titles = title.split('|');
    const lines = body.split('\n').filter(l => l.trim());
    const rowH = Math.min(80, 440 / lines.length);
    let maxLen = 0;
    lines.forEach(l => l.split('|').forEach(p => { maxLen = Math.max(maxLen, p.trim().length); }));
    let cellFS = 15;
    if (maxLen > 60 || lines.length > 5) cellFS = 13;
    if (maxLen > 80 || lines.length > 7) cellFS = 11;
    let rows = '';
    lines.forEach((line, i) => {
      const p = line.split('|');
      const y = 84 + i * rowH;
      if (i > 0) rows += `<div style="position:absolute;left:48px;top:${y - 2}px;width:864px;height:1px;background:#F3F4F6;"></div>`;
      rows += `<div style="position:absolute;left:48px;top:${y + 4}px;width:416px;height:${rowH - 8}px;font-size:${cellFS}px;color:#9CA3AF;line-height:1.3;">${esc(p[0].trim())}</div>`;
      if (p.length > 1) rows += `<div style="position:absolute;left:496px;top:${y + 4}px;width:416px;height:${rowH - 8}px;font-size:${cellFS}px;color:#000;line-height:1.3;">${esc(p[1].trim())}</div>`;
    });
    return wrap(
      `<div style="position:absolute;left:48px;top:30px;width:416px;height:42px;background:#F3F4F6;display:flex;align-items:center;padding-left:12px;box-sizing:border-box;font-size:20px;font-weight:700;color:#000;">${esc(titles[0].trim())}</div>` +
      `<div style="position:absolute;left:496px;top:30px;width:416px;height:42px;background:#1a80d7;display:flex;align-items:center;padding-left:12px;box-sizing:border-box;font-size:20px;font-weight:700;color:#fff;">${esc((titles[1] || '').trim())}</div>` +
      rows
    );
  }

  // ── TABLE — matches Code.gs buildTable
  if (layout === 'table') {
    const headers = title.split('|');
    const lines = body.split('\n').filter(l => l.trim());
    const cols = headers.length;
    const colW = Math.floor(864 / cols);
    const rowH = Math.min(56, 410 / lines.length);
    let table = '';
    headers.forEach((h, c) => {
      table += `<div style="position:absolute;left:${48 + c * colW}px;top:48px;width:${colW}px;height:40px;background:#1a80d7;display:flex;align-items:center;padding-left:8px;box-sizing:border-box;font-size:14px;font-weight:700;color:#fff;">${esc(h.trim())}</div>`;
    });
    lines.forEach((line, r) => {
      const cells = line.split('|');
      const y = 48 + 40 + r * rowH;
      const bg = r % 2 === 0 ? '#F3F4F6' : '#FFFFFF';
      cells.forEach((cell, c) => {
        if (c < cols) table += `<div style="position:absolute;left:${48 + c * colW}px;top:${y}px;width:${colW}px;height:${rowH}px;background:${bg};display:flex;align-items:center;padding-left:8px;box-sizing:border-box;font-size:14px;color:#000;border-bottom:1px solid #E5E7EB;">${esc(cell.trim())}</div>`;
      });
    });
    return wrap(table);
  }

  // ── SECTION-BLUE — matches Code.gs buildSectionBlue (gradient strips)
  if (layout === 'sectionblue') {
    return wrap(
      '<div style="position:absolute;left:0;top:0;width:240px;height:540px;background:#0D4A8A;"></div>' +
      '<div style="position:absolute;left:240px;top:0;width:240px;height:540px;background:#1463AC;"></div>' +
      '<div style="position:absolute;left:480px;top:0;width:240px;height:540px;background:#1a80d7;"></div>' +
      '<div style="position:absolute;left:720px;top:0;width:240px;height:540px;background:#3A9BE8;"></div>' +
      `<div style="position:absolute;left:64px;top:130px;width:830px;font-size:38px;font-weight:700;color:#fff;line-height:1.3;">${esc(title)}</div>` +
      '<div style="position:absolute;left:64px;top:240px;width:60px;height:3px;background:#fff;"></div>' +
      (body ? `<div style="position:absolute;left:64px;top:260px;width:830px;font-size:20px;color:#D7DFF1;line-height:1.5;">${esc(body)}</div>` : '')
    );
  }

  // ── SPLIT — matches Code.gs buildSplit (gradient left panel)
  if (layout === 'split') {
    const titles = title.split('|');
    const leftTitle = (titles[0] || '').trim();
    const rightTitle = (titles[1] || '').trim();
    const lines = body.split('\n').filter(l => l.trim());
    const startY = rightTitle ? 90 : 60;
    const itemH = Math.min(56, (rightTitle ? 380 : 420) / lines.length);
    let maxLen = 0;
    lines.forEach(l => { maxLen = Math.max(maxLen, l.trim().length); });
    let itemFont = 15;
    if (maxLen > 60 || lines.length > 5) itemFont = 13;
    if (maxLen > 80 || lines.length > 7) itemFont = 11;
    let items = '';
    lines.forEach((line, i) => {
      const text = line.trim().replace(/^[-•]\s*/, '');
      const y = startY + i * itemH;
      items += `<div style="position:absolute;left:412px;top:${y + 4}px;width:3px;height:${itemH - 12}px;background:#1a80d7;"></div>`;
      items += `<div style="position:absolute;left:424px;top:${y + 4}px;width:480px;height:${itemH - 8}px;font-size:${itemFont}px;color:#000;line-height:1.4;">${esc(text)}</div>`;
    });
    return wrap(
      '<div style="position:absolute;left:0;top:0;width:380px;height:180px;background:#0D4A8A;"></div>' +
      '<div style="position:absolute;left:0;top:180px;width:380px;height:180px;background:#1463AC;"></div>' +
      '<div style="position:absolute;left:0;top:360px;width:380px;height:180px;background:#1a80d7;"></div>' +
      `<div style="position:absolute;left:40px;top:160px;width:300px;font-size:26px;font-weight:700;color:#fff;text-align:center;line-height:1.3;">${esc(leftTitle)}</div>` +
      '<div style="position:absolute;left:170px;top:370px;width:40px;height:3px;background:#fff;"></div>' +
      (rightTitle ? `<div style="position:absolute;left:412px;top:38px;width:500px;font-size:20px;font-weight:700;color:#1a80d7;">${esc(rightTitle)}</div>` : '') +
      items
    );
  }

  // ── CUSTOM — matches Code.gs buildCustom (freeform elements)
  // Sanitize colors: remap off-brand dark backgrounds to allowed CMT palette
  function sanitizeFill(hex) {
    if (!hex) return '#F3F4F6';
    const h = hex.toLowerCase().replace(/\s/g, '');
    // Allowed fills pass through
    const allowed = ['#ffffff','#fff','#f3f4f6','#e8f2fc','#1a80d7','#0d4a8a','#e5e7eb','#f8fafc',
      '#d7dff1','#b4c5e5','#93adda','#7499cf','#5387c6','#1463ac','#db2727','#ef4444','#3bb87a','#21c36f','#cbcbcb','#f3f3f2'];
    if (allowed.includes(h)) return hex;
    // Thin accent lines/bars (height ≤ 6) can be any color
    // Parse hex to check if it's a dark off-brand color
    const r = parseInt(h.slice(1,3),16)||0, g = parseInt(h.slice(3,5),16)||0, b = parseInt(h.slice(5,7),16)||0;
    const lum = 0.299*r + 0.587*g + 0.114*b;
    // Dark off-brand colors (luminance < 80) → remap to allowed dark blue
    if (lum < 80) return '#0D4A8A';
    // Mid-dark off-brand (80-140) → remap to brand blue
    if (lum < 140) return '#1a80d7';
    return hex; // light colors pass through
  }
  if (layout === 'custom' || (slide.elements && slide.elements.length)) {
    const elements = slide.elements || [];
    let html = '';
    elements.forEach(el => {
      const x = el.x || 0, w = el.w || 200, h = el.h || 40;
      // Clamp content so it doesn't overlap footer (except full-slide background shapes)
      let y = el.y || 0;
      if (el.type !== 'shape' || h < 500) { y = Math.min(y, 490 - h); }
      // Sanitize full-width dark title bars — convert to transparent (let white bg show through)
      // Catches: full-width shapes at top of slide that are dark colored (banner/bar pattern)
      if (el.type === 'shape' && w > 700 && h < 200 && h > 10 && y <= 10) {
        const fill = (el.fill || '').toLowerCase();
        if (fill && fill !== 'transparent' && fill !== '#ffffff' && fill !== '#fff' && fill !== '#f3f4f6' && fill !== '#e8f2fc' && fill !== '#f8fafc' && fill !== '#e5e7eb') {
          const r = parseInt(fill.slice(1,3),16)||0, g = parseInt(fill.slice(3,5),16)||0, b = parseInt(fill.slice(5,7),16)||0;
          const lum = 0.299*r + 0.587*g + 0.114*b;
          if (lum < 180) { el.fill = 'transparent'; if (el.color) el.color = '#1a80d7'; }
        }
      }
      if (el.type === 'text') {
        // If white text is in the title area (top of slide, large font), convert to brand blue
        // This catches titles that were designed for dark banner backgrounds we've removed
        let textColor = el.color || '#000';
        const tc = textColor.toLowerCase();
        if ((tc === '#fff' || tc === '#ffffff' || tc === 'white') && w > 500 && y <= 60 && (el.fontSize || 16) >= 20) {
          textColor = '#1a80d7'; // Convert white title text to brand blue
        }
        const content = (el.content || '').replace(/^- /gm, '\u2022  ').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        const align = el.align === 'center' ? 'center' : el.align === 'right' ? 'right' : 'left';
        const ls = el.lineSpacing ? `line-height:${el.lineSpacing / 100}` : 'line-height:1.3';
        html += `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;font-size:${el.fontSize || 16}px;color:${textColor};font-weight:${el.bold ? '700' : '400'};${el.italic ? 'font-style:italic;' : ''}text-align:${align};${ls};white-space:pre-wrap;overflow:hidden;">${content}</div>`;
      } else if (el.type === 'shape') {
        const isCircle = el.shape === 'ellipse' || el.shape === 'circle';
        const radius = isCircle ? '50%' : '0';
        const fill = (w > 20 && h > 20) ? sanitizeFill(el.fill) : (el.fill || '#F3F4F6');
        const contentStyle = el.content ? `display:flex;align-items:center;justify-content:center;font-size:${el.fontSize || 14}px;color:${el.color || '#fff'};font-weight:${el.bold ? '700' : '400'};` : '';
        html += `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${fill};border-radius:${radius};${contentStyle}">${el.content ? esc(el.content) : ''}</div>`;
      } else if (el.type === 'image') {
        html += imgPlaceholder(el.description || el.content || '', x, y, w, h);
      } else if (el.type === 'chart') {
        const chartId = 'slide-chart-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
        const chartConfig = el.chart || {};
        html += `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;"><canvas id="${chartId}" width="${w}" height="${h}"></canvas></div>`;
        // Queue chart rendering after DOM insertion
        setTimeout(() => {
          const canvas = document.getElementById(chartId);
          if (canvas && window.Chart) {
            new Chart(canvas, {
              type: chartConfig.type || 'bar',
              data: chartConfig.data || {labels:[], datasets:[]},
              options: {
                ...chartConfig.options,
                responsive: false,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                  ...(chartConfig.options?.plugins || {}),
                  legend: { ...(chartConfig.options?.plugins?.legend || {}), labels: { font: { family: 'Helvetica Neue' } } }
                }
              }
            });
          }
        }, 100);
      }
    });
    return wrap(html);
  }

  // ── DEFAULT FALLBACK — visual card layout with accent bar and label|description parsing
  const bullets = body.split('\n').filter(l => l.trim());
  const itemCount = bullets.length;
  const itemH = Math.min(80, 380 / Math.max(itemCount, 1));
  const fontSize = itemCount > 5 ? 13 : 15;
  let bulletHtml = '';
  bullets.forEach((l, i) => {
    const text = l.trim().replace(/^[-•]\s*/, '');
    const parts = text.split('|');
    const y = 90 + i * itemH;
    if (parts.length > 1) {
      // Label|Description format — bold label + description
      const label = parts[0].trim();
      const desc = parts.slice(1).join('|').trim();
      bulletHtml += `<div style="position:absolute;left:60px;top:${y}px;width:3px;height:${itemH - 16}px;background:#1a80d7;border-radius:2px;"></div>`;
      bulletHtml += `<div style="position:absolute;left:76px;top:${y}px;width:820px;font-size:${fontSize + 2}px;font-weight:700;color:#1a80d7;line-height:1.3;">${esc(label)}</div>`;
      bulletHtml += `<div style="position:absolute;left:76px;top:${y + (fontSize + 6)}px;width:820px;font-size:${fontSize}px;color:#515B73;line-height:1.3;">${esc(desc)}</div>`;
    } else {
      // Plain bullet
      bulletHtml += `<div style="position:absolute;left:60px;top:${y}px;width:3px;height:${itemH - 16}px;background:#1a80d7;border-radius:2px;"></div>`;
      bulletHtml += `<div style="position:absolute;left:76px;top:${y + 4}px;width:820px;font-size:${fontSize}px;color:#000;line-height:1.4;">${esc(text)}</div>`;
    }
  });
  // Decorative background element — subtle accent shape
  const bgAccent = '<div style="position:absolute;right:-30px;top:-30px;width:200px;height:200px;background:rgba(26,128,215,0.04);border-radius:50%;"></div>';
  return wrap(
    bgAccent +
    '<div style="position:absolute;left:48px;top:28px;width:40px;height:3px;background:#1a80d7;"></div>' +
    `<div style="position:absolute;left:48px;top:40px;width:860px;font-size:28px;font-weight:700;color:#000;">${esc(title)}</div>` +
    bulletHtml
  );
}

// Intercept <!--GSLIDES:{...}--> markers — create or update styled preview on canvas
function repairGSlidesJson(raw) {
  // Try direct parse first
  try { return JSON.parse(raw); } catch {}

  // Fix 1: Replace literal newlines/tabs with escape sequences
  let fixed = raw.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  try { return JSON.parse(fixed); } catch {}

  // Fix 2: Fix escaped quotes in content fields
  fixed = raw.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  fixed = fixed.replace(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g, (m, inner) => {
    const cleaned = inner.replace(/\\"/g, "'");
    return '"content":"' + cleaned + '"';
  });
  try { return JSON.parse(fixed); } catch {}

  // Fix 3: Strip all control chars
  fixed = raw.replace(/[\x00-\x1f]/g, '');
  try { return JSON.parse(fixed); } catch {}

  // Fix 4: Aggressive — strip control chars AND replace with spaces
  fixed = raw.replace(/[\x00-\x1f]/g, ' ');
  try { return JSON.parse(fixed); } catch {}

  // Last resort: extract title + slides manually
  try {
    const singleLine = raw.replace(/\n/g, '\\n').replace(/\r/g, '');
    const titleMatch = singleLine.match(/"title"\s*:\s*"([^"]+)"/);
    if (!titleMatch) return null;
    const start = singleLine.indexOf('"slides"');
    if (start === -1) return null;
    let depth = 0, arrayStart = -1;
    for (let i = start; i < singleLine.length; i++) {
      if (singleLine[i] === '[') { if (arrayStart === -1) arrayStart = i; depth++; }
      if (singleLine[i] === ']') { depth--; if (depth === 0) {
        let slidesStr = singleLine.substring(arrayStart, i + 1);
        slidesStr = slidesStr.replace(/"code"\s*:\s*"(?:[^"\\]|\\.)*"/g, '"description":"Diagram"');
        try { return { title: titleMatch[1], slides: JSON.parse(slidesStr) }; } catch {}
        break;
      }}
    }
  } catch {}
  return null;
}

let _lastGSlidesAttemptLen = 0;
function liveScanGSlides(text) {
  if (gslidesCreatedThisResponse) return;
  let match = text.match(/<!--GSLIDES:([\s\S]*)-->/);
  if (!match) {
    // Fallback: if GSLIDES started but no closing -->, try to extract and close the JSON
    // This handles cases where the model ran out of tokens
    const fallback = text.match(/<!--GSLIDES:([\s\S]+)$/);
    if (fallback) {
      // Try to close any open braces/brackets to salvage the JSON
      let raw = fallback[1].trim();
      // Count open vs close braces and brackets
      let braces = 0, brackets = 0;
      for (const c of raw) { if (c === '{') braces++; if (c === '}') braces--; if (c === '[') brackets++; if (c === ']') brackets--; }
      while (brackets > 0) { raw += ']'; brackets--; }
      while (braces > 0) { raw += '}'; braces--; }
      match = [null, raw];
    } else {
      return;
    }
  }
  // Only re-attempt repair if JSON length changed (avoids hundreds of duplicate logs)
  const jsonLen = match[1].length;
  if (jsonLen === _lastGSlidesAttemptLen) return;
  _lastGSlidesAttemptLen = jsonLen;
  try {
    const data = repairGSlidesJson(match[1].trim());
    if (!data || !data.title || !data.slides) {
      console.error('[GSLIDES] repair returned null or missing title/slides');
      return;
    }
    gslidesCreatedThisResponse = true;
    panelCreatedThisResponse = true;

    // Clean the marker from displayed message
    if (currentResponseEl) {
      const cleanText = text.replace(/<!--GSLIDES:[\s\S]*-->/, '').trim();
      currentResponseEl.innerHTML = cleanText
        ? marked.parse(cleanText)
        : '<em style="color:var(--text-muted)">' + (editingPanel ? 'Updated' : 'Created') + ' presentation preview on canvas.</em>';
    }

    // Generate styled CMT-branded HTML slides for preview
    const htmlSlides = data.slides.map((s, i) => ({
      html: generateCMTSlideHtml(s, i, data.slides.length)
    }));

    const newContent = JSON.stringify({ slides: htmlSlides, _gslidesData: data });

    if (editingPanel) {
      // Update existing panel instead of creating new one
      const panel = panels.find(p => p.id == editingPanel.id);
      if (panel) {
        panel.content = newContent;
        panel.title = data.title;
        fetch(`${API_BASE}/api/panel/${panel.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: newContent, title: data.title })
        });
        renderAll();
      }
    } else {
      // Create new panel on canvas
      fetch(`${API_BASE}/api/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'slides',
          title: data.title,
          content: newContent,
          conversationId: activeConversationId || null
        })
      }).then(r => r.json()).catch(e => {
        console.error('[GSLIDES] POST failed:', e);
      });
    }
  } catch (e) {
    // During streaming, JSON may be incomplete — that's expected.
    // Log only if the closing marker is present (JSON is complete but broken)
    if (text.includes('-->') && match) {
      console.error('GSLIDES JSON parse failed:', e.message, match[1]?.substring(0, 200));
    }
  }
}

function liveScanPanel(text) {
  if (panelCreatedThisResponse || editingPanel) return;
  const match = text.match(/<!--PANEL:([\s\S]*?)-->/);
  if (!match) return;
  try {
    const panelData = JSON.parse(match[1]);
    // Never auto-create embed panels from response text (prevents research docs from appearing)
    if (panelData.type === 'embed') return;
    if (panelData.type && (panelData.content || panelData.url)) {
      panelCreatedThisResponse = true;
      lastCreatedPanelType = panelData.type;
      panelData.conversationId = activeConversationId || null;
      fetch(`${API_BASE}/api/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(panelData)
      });
      // Clean the panel marker from displayed message
      if (currentResponseEl) {
        const cleanText = text.replace(/<!--PANEL:[\s\S]*?-->/, '').trim();
        if (cleanText) {
          currentResponseEl.innerHTML = marked.parse(cleanText);
          currentResponseEl.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
        } else {
          currentResponseEl.innerHTML = '<em style="color:var(--text-muted)">Created panel on canvas.</em>';
        }
      }
    }
  } catch { /* JSON not complete yet, wait for more chunks */ }
}

function extractAndCreatePanel(text) {
  if (panelCreatedThisResponse) return; // already created during streaming
  const match = text.match(/<!--PANEL:([\s\S]*?)-->/);
  if (!match) return;

  try {
    const panelData = JSON.parse(match[1]);
    // Never auto-create embed panels from response text (prevents research docs from appearing)
    if (panelData.type === 'embed') return;
    if (panelData.type && (panelData.content || panelData.url)) {
      panelCreatedThisResponse = true;
      lastCreatedPanelType = panelData.type;
      panelData.conversationId = activeConversationId || null;
      fetch(`${API_BASE}/api/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(panelData)
      });

      if (currentResponseEl) {
        const cleanText = currentResponseText.replace(/<!--PANEL:[\s\S]*?-->/, '').trim();
        if (cleanText) {
          currentResponseEl.innerHTML = marked.parse(cleanText);
          currentResponseEl.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
        } else {
          currentResponseEl.innerHTML = '<em style="color:var(--text-muted)">Created panel on canvas.</em>';
        }
      }
    }
  } catch (e) {
    console.error('Failed to parse panel data:', e);
  }
}

function clearChatHistory() {
  ws.send(JSON.stringify({ action: 'chat-clear-history' }));
  document.getElementById('chat-messages').innerHTML = '';
  clearSavedChatHistory();
  stopEditing();
}

// ── Minimize / Expand ─────────────────────────────────────────────
let minimizedPanels = new Set();

function toggleMinimize(panelId) {
  panelId = String(panelId);
  const el = document.querySelector(`.panel[data-id="${panelId}"]`);
  if (!el) return;
  if (minimizedPanels.has(panelId)) {
    minimizedPanels.delete(panelId);
    el.classList.remove('minimized');
    const lay = panelLayout[panelId];
    if (lay && lay._savedH) { lay.h = lay._savedH; delete lay._savedH; }
  } else {
    minimizedPanels.add(panelId);
    const lay = panelLayout[panelId];
    if (lay) { lay._savedH = lay.h; lay.h = 48; }
    el.classList.add('minimized');
  }
  flowLayout();
}

let expandedPanelId = null;

function toggleExpand(panelId) {
  if (expandedPanelId === panelId) {
    collapseExpanded();
    return;
  }
  if (expandedPanelId) collapseExpanded();

  const el = document.querySelector(`.panel[data-id="${panelId}"]`);
  if (!el) return;
  expandedPanelId = panelId;
  el.classList.add('expanded');

  // Add overlay
  const overlay = document.createElement('div');
  overlay.className = 'panel-expand-overlay';
  overlay.id = 'expand-overlay';
  overlay.onclick = collapseExpanded;
  document.body.appendChild(overlay);
}

function collapseExpanded() {
  if (!expandedPanelId) return;
  const el = document.querySelector(`.panel[data-id="${expandedPanelId}"]`);
  if (el) el.classList.remove('expanded');
  expandedPanelId = null;
  const overlay = document.getElementById('expand-overlay');
  if (overlay) overlay.remove();
  flowLayout();
}

// ── Suggested prompts ────────────────────────────────────────────
function showSuggestedPrompts(panelType) {
  removeSuggestedPrompts();
  const prompts = getSuggestionsForType(panelType);
  if (!prompts.length) return;

  const container = document.createElement('div');
  container.className = 'suggested-prompts';
  container.id = 'suggested-prompts';
  prompts.forEach(p => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = p;
    chip.onclick = () => {
      document.getElementById('chat-input').value = p;
      sendChat();
      removeSuggestedPrompts();
    };
    container.appendChild(chip);
  });

  const inputArea = document.querySelector('.chat-input-area');
  inputArea.parentNode.insertBefore(container, inputArea);
}

function removeSuggestedPrompts() {
  const el = document.getElementById('suggested-prompts');
  if (el) el.remove();
}

function getSuggestionsForType(type) {
  if (type === 'slides') return ['Add another slide', 'Make it more visual', 'Export to Google Slides'];
  if (type === 'document') return ['Make it shorter', 'Add a summary', 'Export to Google Docs'];
  if (type === 'embed') return ['Edit this document', 'Summarize the content'];
  if (type && type.startsWith('chart-')) return ['Change to bar chart', 'Add more data points'];
  return ['Create a presentation', 'Build a chart', 'Write a document'];
}

// ── Chat context indicator ───────────────────────────────────────
function updateChatContext() {
  let ctx = document.getElementById('chat-context');
  const tags = [];

  if (panels.length > 0) tags.push({ text: `${panels.length} panel${panels.length > 1 ? 's' : ''}`, active: false });
  if (editingPanel) tags.push({ text: `Editing: ${editingPanel.title || editingPanel.type}`, active: true });

  const history = document.querySelectorAll('.chat-msg');
  const msgCount = history.length;
  if (msgCount > 0) tags.push({ text: `${msgCount} messages`, active: false });

  if (tags.length === 0) {
    if (ctx) ctx.remove();
    return;
  }

  if (!ctx) {
    ctx = document.createElement('div');
    ctx.className = 'chat-context';
    ctx.id = 'chat-context';
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.parentNode.insertBefore(ctx, chatMessages);
  }

  ctx.innerHTML = tags.map(t =>
    `<span class="ctx-tag${t.active ? ' active' : ''}">${escapeHtml(t.text)}</span>`
  ).join('');
}

function handleChatMessage(data) {
  // Guard: if streaming belongs to a different conversation than what's displayed,
  // only process final/bookkeeping events — don't touch the DOM
  const streamingElsewhere = chatStreaming && streamingConversationId && streamingConversationId !== activeConversationId;

  if (data.action === 'chat-start') {
    if (!streamingElsewhere) {
      showStatus();
      showTypingIndicator();
    }
    currentResponseText = '';
    currentResponseEl = null;
    thinkingEl = null;
    thinkingText = '';
    createdDocIds = new Set();
    panelCreatedThisResponse = false;
    gslidesCreatedThisResponse = false;
    _lastGSlidesAttemptLen = 0;
    lastCreatedPanelType = null;
  } else if (data.action === 'chat-status') {
    if (!streamingElsewhere) updateStatus();
  } else if (data.action === 'chat-thinking-start') {
    thinkingText = '';
    if (streamingElsewhere) return;
    removeStatus();
    // Create a thinking container in the chat
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg assistant';

    // Create avatar
    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar assistant';
    avatar.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>';

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'chat-msg-content';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble thinking-bubble';
    bubble.innerHTML = `
      <details class="thinking-details" open>
        <summary class="thinking-summary">
          <span class="thinking-label">Thinking</span>
          <span class="thinking-dots"><span></span><span></span><span></span></span>
        </summary>
        <div class="thinking-content"></div>
      </details>
    `;
    contentWrapper.appendChild(bubble);
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(contentWrapper);
    document.getElementById('chat-messages').appendChild(msgDiv);
    thinkingEl = bubble.querySelector('.thinking-content');
    scrollChat();
  } else if (data.action === 'chat-thinking-delta') {
    thinkingText += data.text;
    if (streamingElsewhere) return;
    // Debounce thinking markdown re-parse
    if (!_thinkingRenderTimer) {
      _thinkingRenderTimer = setTimeout(() => {
        _thinkingRenderTimer = null;
        // Re-acquire reference if stale (e.g., after DOM changes from panel operations)
        if (thinkingEl && !thinkingEl.isConnected) {
          const els = document.querySelectorAll('#chat-messages .thinking-content');
          thinkingEl = els.length ? els[els.length - 1] : null;
        }
        if (thinkingEl) {
          thinkingEl.innerHTML = marked.parse(thinkingText);
          scrollChat();
        }
      }, 80);
    }
  } else if (data.action === 'chat-thinking-done') {
    if (streamingElsewhere) { thinkingEl = null; return; }
    if (thinkingEl && !thinkingEl.isConnected) {
      const els = document.querySelectorAll('#chat-messages .thinking-content');
      thinkingEl = els.length ? els[els.length - 1] : null;
    }
    if (thinkingEl) {
      const details = thinkingEl.closest('.thinking-details');
      if (details) {
        details.removeAttribute('open');
        details.querySelector('.thinking-dots').style.display = 'none';
      }
      thinkingEl.innerHTML = marked.parse(data.text || thinkingText);
    }
    thinkingEl = null;
  } else if (data.action === 'chat-chunk') {
    currentResponseText += data.text;
    // Still scan for GSLIDES/panels even if viewing another conv (panels are global)
    liveScanGSlides(currentResponseText);
    liveScanPanel(currentResponseText);
    if (streamingElsewhere) return;
    removeStatus();
    removeTypingIndicator();
    if (!currentResponseEl) {
      currentResponseEl = addChatMessage('assistant', '', false);
    }
    // Debounce markdown re-parse — batch rapid chunks into ~80ms renders
    if (!_streamRenderTimer) {
      _streamRenderTimer = setTimeout(() => {
        _streamRenderTimer = null;
        if (!currentResponseEl) return;
        let displayText = currentResponseText
          .replace(/<!--GSLIDES:[\s\S]*(?:-->|$)/, '')
          .replace(/<!--PANEL:[\s\S]*(?:-->|$)/, '')
          .trim();
        const contentWrapper = currentResponseEl.querySelector('.chat-msg-content');
        if (contentWrapper) {
          contentWrapper.innerHTML = (displayText ? marked.parse(displayText) : '<em style="color:var(--text-muted)">Creating visual content...</em>') + '<span class="streaming-cursor"></span>';
          contentWrapper.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
        }
        scrollChat();
      }, 80);
    }
  } else if (data.action === 'chat-result') {
    currentResponseText = data.text;
    // Scan for panels regardless of which conv is active
    liveScanGSlides(currentResponseText);
    if (streamingElsewhere) {
      // Save the response to the streaming conversation's history
      if (streamingConversationId && conversations[streamingConversationId]) {
        conversations[streamingConversationId].messages.push({ role: 'assistant', content: currentResponseText });
        conversations[streamingConversationId].updatedAt = Date.now();
        saveConversations();
      }
      finishChat();
      return;
    }
    removeStatus();
    removeTypingIndicator();
    if (!currentResponseEl) {
      currentResponseEl = addChatMessage('assistant', '', false);
    }
    let finalDisplayText = currentResponseText
      .replace(/<!--GSLIDES:[\s\S]*(?:-->|$)/, '')
      .replace(/<!--PANEL:[\s\S]*(?:-->|$)/, '')
      .trim();
    const contentWrapper = currentResponseEl.querySelector('.chat-msg-content');
    if (contentWrapper) {
      contentWrapper.innerHTML = finalDisplayText ? marked.parse(finalDisplayText) : '<em style="color:var(--text-muted)">Created visual content on canvas.</em>';
      contentWrapper.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
      addMsgActions(contentWrapper);
    }
    scrollChat();
    scanAndEmbed(currentResponseText);
    finishChat();
  } else if (data.action === 'chat-done') {
    if (!chatStreaming) return; // already finished via chat-result
    if (streamingElsewhere) {
      // Save response to the streaming conversation
      if (currentResponseText && streamingConversationId && conversations[streamingConversationId]) {
        conversations[streamingConversationId].messages.push({ role: 'assistant', content: currentResponseText });
        conversations[streamingConversationId].updatedAt = Date.now();
        saveConversations();
      }
      finishChat();
      renderHistoryList();
      return;
    }
    removeTypingIndicator();
    if (!currentResponseEl && currentResponseText) {
      removeStatus();
      currentResponseEl = addChatMessage('assistant', currentResponseText, true);
    }
    if (currentResponseEl) {
      const contentWrapper = currentResponseEl.querySelector('.chat-msg-content');
      if (contentWrapper) addMsgActions(contentWrapper);
    }
    finishChat();
  } else if (data.action === 'chat-history') {
    // Server sends history on reconnect — restore if client has nothing
    const messages = document.getElementById('chat-messages');
    if (messages.children.length === 0 && data.messages && data.messages.length > 0) {
      data.messages.forEach(m => {
        addChatMessage(m.role, m.content, m.role === 'assistant', true);
      });
    }
  } else if (data.action === 'chat-error') {
    removeStatus();
    addChatMessage('assistant', 'Error: ' + data.text, false);
    finishChat();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Close overlays in priority order (topmost z-index first)
    const memoriesOverlay = document.getElementById('memories-overlay');
    if (memoriesOverlay && memoriesOverlay.classList.contains('active')) { closeMemories(); return; }
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && settingsModal.classList.contains('active')) { closeSettingsModal(); return; }
    const shortcuts = document.getElementById('shortcuts-modal');
    if (shortcuts && shortcuts.classList.contains('active')) { shortcuts.classList.remove('active'); return; }
    if (expandedPanelId) { collapseExpanded(); return; }
    const pasteModal = document.getElementById('paste-modal');
    if (pasteModal && pasteModal.classList.contains('active')) { closePasteModal(); return; }
    const embedModal = document.getElementById('embed-modal');
    if (embedModal && embedModal.classList.contains('active')) { closeEmbedModal(); return; }
    const gdriveModal = document.getElementById('gdrive-modal');
    if (gdriveModal && gdriveModal.classList.contains('active')) { closeDriveSearch(); return; }
    if (historySidebarOpen) { toggleHistorySidebar(); return; }
    return;
  }
  // Cmd+K — toggle chat
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    toggleChat();
    if (chatOpen) document.getElementById('chat-input').focus();
    return;
  }
  // Cmd+/ — shortcuts modal
  if ((e.metaKey || e.ctrlKey) && e.key === '/') {
    e.preventDefault();
    document.getElementById('shortcuts-modal').classList.toggle('active');
    return;
  }
  // Cmd+N — new chat
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault();
    clearChatHistory();
    return;
  }
  // Cmd+P — present
  if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
    e.preventDefault();
    if (panels.length > 0) { currentSlide = 0; showPresentation(); }
    return;
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Google Drive Search ──────────────────────────────────────────
function openDriveSearch() {
  document.getElementById('gdrive-modal').classList.add('active');
  document.getElementById('gdrive-query').focus();
  // Load recent files by default
  loadDriveFiles('');
}

function closeDriveSearch() {
  document.getElementById('gdrive-modal').classList.remove('active');
  document.getElementById('gdrive-query').value = '';
  document.getElementById('gdrive-results').innerHTML = '';
}

function searchDrive() {
  const query = document.getElementById('gdrive-query').value.trim();
  loadDriveFiles(query);
}

let driveResultsCache = null; // client-side full cache for instant filtering
let driveSearchCache = new Map(); // query -> files cache

// Pre-fetch recent files on page load for instant access
function prefetchDriveFiles() {
  fetch(`${API_BASE}/api/gdrive/search`)
    .then(r => r.json())
    .then(data => {
      if (data.ok && data.files && data.files.length > 0) {
        driveResultsCache = data.files;
      }
    }).catch(() => {});
}
prefetchDriveFiles();

function loadDriveFiles(query) {
  const results = document.getElementById('gdrive-results');

  // INSTANT: filter cached results client-side first (only if cache has files)
  if (driveResultsCache && driveResultsCache.length > 0) {
    if (!query) {
      renderDriveResults(driveResultsCache);
    } else {
      const q = query.toLowerCase();
      const filtered = driveResultsCache.filter(f =>
        (f.name || '').toLowerCase().includes(q)
      );
      if (filtered.length > 0) {
        renderDriveResults(filtered, true); // true = show "searching for more..." hint
      } else {
        results.innerHTML = `<div class="gdrive-loading"><div class="dot-pulse"><span></span><span></span><span></span></div> Searching Drive...</div>`;
      }
    }
  } else if (!query) {
    results.innerHTML = `<div class="gdrive-loading"><div class="dot-pulse"><span></span><span></span><span></span></div> Loading recent files...</div>`;
  } else {
    results.innerHTML = `<div class="gdrive-loading"><div class="dot-pulse"><span></span><span></span><span></span></div> Searching...</div>`;
  }

  // Check query-specific cache
  if (query && driveSearchCache.has(query.toLowerCase())) {
    renderDriveResults(driveSearchCache.get(query.toLowerCase()));
    return;
  }

  // Background: fetch full server results to augment/replace client filter
  const url = query ? `${API_BASE}/api/gdrive/search?q=${encodeURIComponent(query)}` : `${API_BASE}/api/gdrive/search`;
  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (!data.ok || !data.files) return;
      if (!query) {
        if (data.files.length > 0) {
          driveResultsCache = data.files;
          renderDriveResults(data.files);
        }
      } else if (data.files.length > 0) {
        driveSearchCache.set(query.toLowerCase(), data.files);
        // Merge with cached results (server results are authoritative for the query)
        renderDriveResults(data.files);
      }
      // Merge new files into the main cache for future client-side filtering
      if (data.files && data.files.length > 0) {
        const existingIds = new Set((driveResultsCache || []).map(f => f.id));
        const newFiles = data.files.filter(f => !existingIds.has(f.id));
        if (newFiles.length > 0 && driveResultsCache) {
          driveResultsCache = [...driveResultsCache, ...newFiles];
        }
      }
    })
    .catch(() => {});
}

function renderDriveResults(files, searching) {
  const results = document.getElementById('gdrive-results');
  const html = files.map(f => {
    const url = (f.webViewLink || '').replace(/'/g, "\\'");
    const name = (f.name || 'Untitled').replace(/'/g, "\\'");
    const mime = (f.mimeType || '').replace(/'/g, "\\'");
    const icon = getDriveIcon(f.mimeType || '');
    return `<div class="gdrive-file" onclick="selectDriveFile('${url}', '${name}', '${mime}')">
      <span class="gdrive-icon">${icon}</span>
      <span class="gdrive-name">${escapeHtml(f.name || 'Untitled')}</span>
      <span class="gdrive-type">${formatMimeType(f.mimeType || '')}</span>
    </div>`;
  }).join('');
  results.innerHTML = html + (searching ? '<div class="gdrive-loading" style="padding:8px;font-size:11px"><div class="dot-pulse" style="display:inline-flex;gap:3px;margin-right:6px"><span></span><span></span><span></span></div>Searching Drive for more...</div>' : '');
}

let _driveSearchTimer = null;
document.getElementById('gdrive-query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); clearTimeout(_driveSearchTimer); searchDrive(); return; }
});
document.getElementById('gdrive-query').addEventListener('input', () => {
  clearTimeout(_driveSearchTimer);
  _driveSearchTimer = setTimeout(searchDrive, 400);
});

function selectDriveFile(url, name, mimeType) {
  closeDriveSearch();
  if (!url) return;

  // Extract doc ID from URL for MCP tool reference
  const docMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const docId = docMatch ? docMatch[1] : '';

  // Attach as a Google Drive reference — Claude will read it via MCP tools
  attachedFiles.push({
    path: null, // no local path — server will instruct Claude to read via MCP
    filename: name,
    size: 0,
    type: 'gdrive',
    url: url,
    docId: docId,
    mimeType: mimeType
  });
  renderFilePreview();

  if (!chatOpen) toggleChat();
  document.getElementById('chat-input').focus();
}

function getDriveIcon(mimeType) {
  if (mimeType.includes('document') || mimeType.includes('word')) return '<svg width="14" height="14" viewBox="0 0 16 16" fill="#4285f4" stroke="none"><rect x="3" y="1" width="10" height="14" rx="1.5" fill="none" stroke="#4285f4" stroke-width="1.3"/><line x1="5.5" y1="5" x2="10.5" y2="5" stroke="#4285f4" stroke-width="1"/><line x1="5.5" y1="7.5" x2="10.5" y2="7.5" stroke="#4285f4" stroke-width="1"/><line x1="5.5" y1="10" x2="8.5" y2="10" stroke="#4285f4" stroke-width="1"/></svg>';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#0f9d58" stroke-width="1.3"><rect x="3" y="1" width="10" height="14" rx="1.5"/><line x1="3" y1="5.5" x2="13" y2="5.5"/><line x1="3" y1="10" x2="13" y2="10"/><line x1="8" y1="5.5" x2="8" y2="15"/></svg>';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#f4b400" stroke-width="1.3"><rect x="2" y="3" width="12" height="10" rx="1.5"/><rect x="5" y="5.5" width="6" height="5" rx="0.5"/></svg>';
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 1h6l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z"/><path d="M10 1v4h4"/></svg>';
}

function formatMimeType(mt) {
  if (mt.includes('document')) return 'Doc';
  if (mt.includes('spreadsheet')) return 'Sheet';
  if (mt.includes('presentation')) return 'Slides';
  if (mt.includes('folder')) return 'Folder';
  if (mt.includes('pdf')) return 'PDF';
  if (mt.includes('image')) return 'Image';
  return 'File';
}

// ── Add menu ─────────────────────────────────────────────────────
document.getElementById('btn-add').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('add-menu-dropdown').classList.toggle('open');
});
function closeAddMenu() {
  document.getElementById('add-menu-dropdown').classList.remove('open');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.add-menu-wrapper')) closeAddMenu();
});

// ── Quick prompts from empty state ───────────────────────────────
function quickPrompt(type) {
  if (!chatOpen) toggleChat();
  const input = document.getElementById('chat-input');
  const placeholders = {
    presentation: 'What should the presentation be about?',
    document: 'What should the document cover? (e.g., project status, meeting notes, proposal...)',
    chart: 'What data should the chart show? (e.g., monthly revenue, user growth, survey results...)'
  };
  input.value = '';
  input.placeholder = placeholders[type] || 'Ask Claude anything...';
  input.dataset.promptType = type;
  input.focus();
  // Auto-grow reset
  input.style.height = 'auto';
}

// ── Panel type icons ─────────────────────────────────────────────
function getPanelTypeIcon(type) {
  if (type === 'slides') return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="3" width="12" height="10" rx="1.5"/><rect x="5" y="5.5" width="6" height="5" rx="0.5"/></svg>';
  if (type === 'document') return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="1" width="10" height="14" rx="1.5"/><line x1="5.5" y1="5" x2="10.5" y2="5"/><line x1="5.5" y1="7.5" x2="10.5" y2="7.5"/><line x1="5.5" y1="10" x2="8.5" y2="10"/></svg>';
  if (type === 'embed') return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="3" width="14" height="10" rx="1.5"/><path d="M5 7l-2 2 2 2M11 7l2 2-2 2"/></svg>';
  if (type === 'markdown') return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="3" width="14" height="10" rx="1.5"/><path d="M4 10V6l2 2.5L8 6v4M11 8.5l1.5-1.5M11 8.5V6m1.5 2.5L11 10"/></svg>';
  if (type && type.startsWith('chart-')) return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="8" width="3" height="6"/><rect x="6.5" y="4" width="3" height="10"/><rect x="11" y="6" width="3" height="8"/></svg>';
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2" width="12" height="12" rx="2"/></svg>';
}

// ── Drag & drop files ────────────────────────────────────────────
const dropOverlay = document.getElementById('drop-overlay');
let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1) dropOverlay.classList.add('active');
});
document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('active'); }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('active');

  const files = e.dataTransfer.files;
  if (!files.length) return;

  for (const file of files) {
    try {
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
        body: file
      });
      const data = await res.json();
      if (data.ok) {
        attachedFiles.push({ path: data.path, filename: data.filename, size: file.size });
      }
    } catch (err) {
      console.error('Drop upload failed:', err);
    }
  }
  renderFilePreview();
  if (!chatOpen) toggleChat();
  document.getElementById('chat-input').focus();
});

// ── Chat auto-grow textarea ──────────────────────────────────────
const chatTextarea = document.getElementById('chat-input');
chatTextarea.addEventListener('input', () => {
  chatTextarea.style.height = 'auto';
  chatTextarea.style.height = Math.min(chatTextarea.scrollHeight, 200) + 'px';
  updateSendButton();
});

// ── Conversation Management (History Sidebar) ────────────────────
let conversations = {};
let activeConversationId = null;
let historySidebarOpen = false;

function generateConversationId() {
  return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function loadConversations() {
  try {
    conversations = JSON.parse(localStorage.getItem('claudeio-conversations') || '{}');
  } catch { conversations = {}; }
}

function saveConversations() {
  try {
    localStorage.setItem('claudeio-conversations', JSON.stringify(conversations));
  } catch {}
}

function getActiveConversation() {
  if (activeConversationId && conversations[activeConversationId]) {
    return conversations[activeConversationId];
  }
  return null;
}

function newConversation() {
  // Save current conversation first
  saveCurrentConversation();

  // If current conversation is empty, remove it to avoid duplicate "New Chat" entries
  const current = conversations[activeConversationId];
  if (current && (!current.messages || current.messages.length === 0)) {
    delete conversations[activeConversationId];
  }

  const id = generateConversationId();
  conversations[id] = {
    id,
    title: 'New Chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  activeConversationId = id;
  saveConversations();
  localStorage.setItem('claudeio-active-conv', id);

  // Clear chat UI + server history + localStorage
  ws.send(JSON.stringify({ action: 'chat-clear-history' }));
  document.getElementById('chat-messages').innerHTML = '';
  clearSavedChatHistory();
  stopEditing();

  // Show clean chat-only view (no panels, chat open)
  renderAll();
  if (!chatOpen) toggleChat();
  renderHistoryList();
}

function saveCurrentConversation() {
  if (!activeConversationId) return;
  const conv = conversations[activeConversationId];
  if (!conv) return;

  // Pull messages from localStorage chat
  try {
    const history = JSON.parse(localStorage.getItem('claudeio-chat') || '[]');
    conv.messages = history;
    conv.updatedAt = Date.now();
    saveConversations();
  } catch {}
}

function loadConversation(id) {
  if (id === activeConversationId) return; // already viewing this conversation
  saveCurrentConversation();

  const conv = conversations[id];
  if (!conv) return;

  activeConversationId = id;
  localStorage.setItem('claudeio-active-conv', id);

  // Detach DOM refs if streaming belongs to a different conversation
  // (streaming continues in background; events will be buffered, not rendered)
  if (chatStreaming && streamingConversationId !== id) {
    currentResponseEl = null;
    thinkingEl = null;
  }

  // Clear current chat UI (don't clear server history if still streaming for another conv)
  if (!chatStreaming || streamingConversationId === id) {
    ws.send(JSON.stringify({ action: 'chat-clear-history' }));
  }
  document.getElementById('chat-messages').innerHTML = '';
  clearSavedChatHistory();

  // Restore messages to localStorage and UI
  if (conv.messages && conv.messages.length > 0) {
    localStorage.setItem('claudeio-chat', JSON.stringify(conv.messages));
    conv.messages.forEach(m => {
      addChatMessage(m.role, m.content, m.role === 'assistant', true);
    });
  }

  renderAll();
  renderHistoryList();
  if (!chatOpen) toggleChat();
}

function deleteConversation(id, e) {
  if (e) e.stopPropagation();
  if (!confirm('Delete this conversation?')) return;

  delete conversations[id];
  saveConversations();

  if (activeConversationId === id) {
    activeConversationId = null;
    clearSavedChatHistory();
    document.getElementById('chat-messages').innerHTML = '';
    ws.send(JSON.stringify({ action: 'chat-clear-history' }));
    // Load most recent or create new
    const sorted = Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);
    if (sorted.length > 0) {
      loadConversation(sorted[0].id);
    } else {
      newConversation();
    }
  }

  renderHistoryList();
}

function startRenameConversation(id, e) {
  if (e) e.stopPropagation();
  const item = document.querySelector(`.history-item[data-id="${id}"]`);
  if (!item) return;
  const titleEl = item.querySelector('.history-item-title');
  const currentTitle = conversations[id]?.title || '';

  titleEl.innerHTML = `<input class="history-rename-input" value="${escapeHtml(currentTitle)}" />`;
  const input = titleEl.querySelector('input');
  input.focus();
  input.select();

  const finish = () => {
    const newTitle = input.value.trim();
    if (newTitle && conversations[id]) {
      conversations[id].title = newTitle;
      saveConversations();
    }
    renderHistoryList();
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(); }
    if (ev.key === 'Escape') { renderHistoryList(); }
  });
}

function renderHistoryList(filter) {
  const list = document.getElementById('history-list');
  if (!list) return;

  const sorted = Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);
  const filterText = (filter || '').toLowerCase();
  const filtered = filterText
    ? sorted.filter(c => c.title.toLowerCase().includes(filterText))
    : sorted;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="history-empty">No conversations yet</div>';
    return;
  }

  list.innerHTML = filtered.map(conv => {
    const isActive = conv.id === activeConversationId;
    const isThinking = chatStreaming && conv.id === streamingConversationId;
    const msgCount = (conv.messages || []).length;
    const panelCount = panels.filter(p => p.conversationId === conv.id).length;
    const date = new Date(conv.updatedAt);
    const timeStr = formatHistoryDate(date);
    return `
      <div class="history-item${isActive ? ' active' : ''}${isThinking ? ' thinking' : ''}" data-id="${conv.id}" onclick="loadConversation('${conv.id}')">
        <div class="history-item-title">${isThinking ? '<span class="thinking-indicator"></span>' : ''}${escapeHtml(conv.title)}</div>
        <div class="history-item-meta">
          <span>${timeStr}</span>
          <span>${msgCount} msg${msgCount !== 1 ? 's' : ''}${panelCount > 0 ? ' · ' + panelCount + ' panel' + (panelCount !== 1 ? 's' : '') : ''}</span>
        </div>
        <div class="history-item-actions">
          <button onclick="startRenameConversation('${conv.id}', event)" title="Rename"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="delete-btn" onclick="deleteConversation('${conv.id}', event)" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </div>
    `;
  }).join('');
}

function formatHistoryDate(date) {
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return date.toLocaleDateString();
}

function toggleHistorySidebar() {
  historySidebarOpen = !historySidebarOpen;
  const sidebar = document.getElementById('history-sidebar');
  sidebar.classList.toggle('open', historySidebarOpen);

  if (historySidebarOpen) {
    saveCurrentConversation();
    renderHistoryList();
  }
}

document.getElementById('btn-history').addEventListener('click', toggleHistorySidebar);

document.getElementById('history-search-input').addEventListener('input', (e) => {
  renderHistoryList(e.target.value);
});

// Close history sidebar on click outside
document.addEventListener('click', (e) => {
  if (historySidebarOpen && !e.target.closest('#history-sidebar') && !e.target.closest('#btn-history')) {
    historySidebarOpen = false;
    document.getElementById('history-sidebar').classList.remove('open');
  }
});

// ── Settings Modal ───────────────────────────────────────────────
function openSettingsModal() {
  loadConfig();
  document.getElementById('settings-modal').classList.add('active');
  renderSettingsModal();
  // Auto-test integrations via batch endpoint (faster than individual tests)
  setTimeout(() => {
    fetch(`${API_BASE}/api/integrations/status`)
      .then(r => r.json())
      .then(data => {
        if (!data.ok) return;
        Object.entries(data.status).forEach(([id, connected]) => {
          const badge = document.getElementById('badge-' + id);
          const connectBtn = document.getElementById('connect-btn-' + id);
          if (badge) {
            badge.textContent = connected ? 'Connected' : 'Not Connected';
            badge.className = 'integration-badge ' + (connected ? 'connected' : 'disconnected');
          }
          // Google/Slack: show Reconnect when connected
          if (id !== 'atlassian' && connectBtn) {
            connectBtn.textContent = connected ? 'Reconnect' : ({ 'google-workspace': 'Connect Google Account', 'slack': 'Connect Slack' }[id] || 'Connect');
          }
          // Atlassian: hide credential fields when connected
          if (id === 'atlassian') {
            const emailField = document.getElementById('atlassian-email');
            const tokenField = document.getElementById('atlassian-token');
            const instrEl = document.querySelector('#server-atlassian .integration-instructions');
            if (connected) {
              if (emailField) emailField.style.display = 'none';
              if (tokenField) tokenField.style.display = 'none';
              if (instrEl) instrEl.style.display = 'none';
              if (connectBtn) connectBtn.style.display = 'none';
            } else {
              if (emailField) emailField.style.display = '';
              if (tokenField) tokenField.style.display = '';
              if (instrEl) instrEl.style.display = '';
              if (connectBtn) connectBtn.style.display = '';
            }
          }
        });
      })
      .catch(() => {
        ['google-workspace', 'slack', 'atlassian'].forEach(id => {
          const badge = document.getElementById('badge-' + id);
          if (badge) { badge.textContent = 'Error'; badge.className = 'integration-badge disconnected'; }
        });
      });
  }, 100);
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.remove('active');
}

function renderSettingsModal() {
  if (!appConfig) return;
  const config = appConfig;
  const body = document.getElementById('settings-modal-body');
  let html = '';

  // AI Provider
  const bedrockSource = config.sources.find(s => s.name === 'AWS Bedrock');
  if (bedrockSource) {
    html += `<div class="settings-section">
      <div class="settings-section-title">AI Provider</div>
      <div class="settings-item">
        <span class="status-dot info"></span>
        <span class="item-label">AWS Bedrock</span>
        <span class="item-detail">${escapeHtml(bedrockSource.detail || '')}</span>
      </div>
      <div class="settings-auth-actions">
        <button class="settings-action-btn" onclick="refreshAws(this)">Refresh AWS SSO</button>
      </div>
    </div>`;
  }

  // Model Selection
  html += `<div class="settings-section">
    <div class="settings-section-title">Language Model</div>
    <p style="font-size:12px;color:var(--text-muted);margin:0 0 8px">Choose which Claude model powers the assistant.</p>
    <select onchange="changeModel(this.value)">
      ${config.model.available.map(m => `<option value="${m.id}" ${m.id === config.model.current ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
    </select>
  </div>`;

  // Integrations — replicate portal connection methods per service
  html += `<div class="settings-section">
    <div class="settings-section-title">Integrations</div>

    <!-- Google Workspace — OAuth connect -->
    <div class="integration-card" id="server-google-workspace">
      <div class="integration-card-header">
        <span class="integration-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
        </span>
        <div class="integration-card-info">
          <span class="integration-card-name">Google Workspace</span>
          <span class="integration-card-desc">Connect your Google account to give the assistant read-only access to Gmail, Calendar, Drive, Docs, Slides, and Tasks.</span>
        </div>
        <span class="integration-badge checking" id="badge-google-workspace">${config.mcpServers.find(s => s.id === 'google-workspace') ? 'Checking...' : 'Not Configured'}</span>
      </div>
      <div class="integration-card-actions" id="actions-google-workspace">
        ${config.mcpServers.find(s => s.id === 'google-workspace') ? `
          <button class="settings-action-btn connect-btn" id="connect-btn-google-workspace" onclick="connectIntegration('google-workspace', 'Google', this)">Connect Google Account</button>
        ` : `<button class="settings-action-btn connect-btn" disabled>Not Available</button>`}
      </div>
      <div class="settings-status-msg" id="status-google-workspace"></div>
    </div>

    <!-- Slack — OAuth connect -->
    <div class="integration-card" id="server-slack">
      <div class="integration-card-header">
        <span class="integration-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313z" fill="#E01E5A"/><path d="M8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312z" fill="#36C5F0"/><path d="M18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 01-2.523 2.521 2.528 2.528 0 01-2.52-2.521V2.522A2.528 2.528 0 0115.163 0a2.528 2.528 0 012.523 2.522v6.312z" fill="#2EB67D"/><path d="M15.163 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.163 24a2.528 2.528 0 01-2.52-2.522v-2.522h2.52zm0-1.27a2.528 2.528 0 01-2.52-2.523 2.528 2.528 0 012.52-2.52h6.315A2.528 2.528 0 0124 15.163a2.528 2.528 0 01-2.522 2.523h-6.315z" fill="#ECB22E"/></svg>
        </span>
        <div class="integration-card-info">
          <span class="integration-card-name">Slack</span>
          <span class="integration-card-desc">Connect your Slack account to search messages, read channels, and browse threads.</span>
        </div>
        <span class="integration-badge checking" id="badge-slack">${config.mcpServers.find(s => s.id === 'slack') ? 'Checking...' : 'Not Configured'}</span>
      </div>
      <div class="integration-card-actions" id="actions-slack">
        ${config.mcpServers.find(s => s.id === 'slack') ? `
          <button class="settings-action-btn connect-btn" id="connect-btn-slack" onclick="connectIntegration('slack', 'Slack', this)">Connect Slack</button>
        ` : `<button class="settings-action-btn connect-btn" disabled>Not Available</button>`}
      </div>
      <div class="settings-status-msg" id="status-slack"></div>
    </div>

    <!-- Atlassian — API token fields -->
    <div class="integration-card" id="server-atlassian">
      <div class="integration-card-header">
        <span class="integration-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7.127 11.063c-.14-.144-.334-.17-.475-.028L.308 17.38a1.43 1.43 0 00.985 2.455h7.462a.47.47 0 00.42-.264c1.333-2.676.642-6.468-2.048-8.508z" fill="#2684FF"/><path d="M11.875.248c-2.894 4.274-2.736 8.478-.008 11.828.097.12.262.165.407.12l.067-.024 6.164-2.96a1.43 1.43 0 00.688-1.9L14.89.297a1.428 1.428 0 00-1.822-.66 1.42 1.42 0 00-.55.367l-.643.244z" fill="url(#atlassian_grad)"/><defs><linearGradient id="atlassian_grad" x1="11.2" y1="3.8" x2="15.7" y2="11.8" gradientUnits="userSpaceOnUse"><stop stop-color="#0052CC"/><stop offset="1" stop-color="#2684FF"/></linearGradient></defs></svg>
        </span>
        <div class="integration-card-info">
          <span class="integration-card-name">Atlassian (Jira & Confluence)</span>
          <span class="integration-card-desc">Search issues, read wiki pages, and manage tickets.</span>
        </div>
        <span class="integration-badge checking" id="badge-atlassian">${config.mcpServers.find(s => s.id === 'atlassian') ? 'Checking...' : 'Not Configured'}</span>
      </div>
      ${config.mcpServers.find(s => s.id === 'atlassian') ? `
        <div class="integration-instructions">Create an API token at <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank">id.atlassian.com</a>, then enter your CMT Atlassian email and paste the token below.</div>
        <input type="email" class="integration-field" id="atlassian-email" placeholder="you@cmtelematics.com" value="">
        <input type="password" class="integration-field" id="atlassian-token" placeholder="API token">
      ` : ''}
      <div class="integration-card-actions" id="actions-atlassian">
        ${config.mcpServers.find(s => s.id === 'atlassian') ? `
          <button class="settings-action-btn connect-btn" id="connect-btn-atlassian" onclick="saveAtlassianCredentials(this)">Save Atlassian Credentials</button>
        ` : `<button class="settings-action-btn connect-btn" disabled>Not Available</button>`}
      </div>
      <div class="settings-status-msg" id="status-atlassian"></div>
    </div>
  </div>`;

  // Sources
  html += `<div class="settings-section">
    <div class="settings-section-title">Sources</div>
    ${config.sources.filter(s => s.type !== 'provider').map(s => `
      <div class="settings-item">
        <span class="status-dot source"></span>
        <span class="item-label">${escapeHtml(s.name)}</span>
        <span class="item-detail">${escapeHtml(s.detail || '')}</span>
      </div>
    `).join('')}
  </div>`;

  // Memory Management
  html += `<div class="settings-section">
    <div class="settings-section-title">Memory Management</div>
    <button class="settings-action-btn settings-memory-btn" onclick="closeSettingsModal(); openMemories()">Browse & Manage Memories</button>
    <button class="settings-action-btn settings-memory-btn" onclick="clearAllMemories()">Clear All Memories</button>
  </div>`;

  // Clear panels
  html += `<div class="settings-section">
    <button class="settings-action-btn" style="width:100%" onclick="clearAllPanels()">Clear All Panels</button>
  </div>`;

  body.innerHTML = html;
}

function clearAllMemories() {
  if (!confirm('Are you sure you want to clear all memory files? This cannot be undone.')) return;
  if (!confirm('This will delete all memory .md files except MEMORY.md. Proceed?')) return;
  fetch(`${API_BASE}/api/memories`).then(r => r.json()).then(data => {
    if (!data.ok) return;
    const toDelete = data.memories.filter(m => m.filename !== 'MEMORY.md');
    Promise.all(toDelete.map(m =>
      fetch(`${API_BASE}/api/memory/` + encodeURIComponent(m.filename), { method: 'DELETE' })
    )).then(() => {
      alert('All memory files cleared.');
    });
  });
}

// ── Memories Screen ──────────────────────────────────────────────
let memoriesData = [];
let memoryFilter = 'all';

function openMemories() {
  document.getElementById('memories-overlay').classList.add('active');
  loadMemories();
}

function closeMemories() {
  document.getElementById('memories-overlay').classList.remove('active');
}

function loadMemories() {
  const grid = document.getElementById('memories-grid');
  grid.innerHTML = '<div class="memory-card-empty">Loading memories...</div>';

  fetch(`${API_BASE}/api/memories`)
    .then(r => r.json())
    .then(data => {
      if (!data.ok) {
        grid.innerHTML = '<div class="memory-card-empty">Could not load memories</div>';
        return;
      }
      memoriesData = data.memories || [];
      renderMemories();
    })
    .catch(() => {
      grid.innerHTML = '<div class="memory-card-empty">Error loading memories</div>';
    });
}

function renderMemories() {
  const grid = document.getElementById('memories-grid');
  const searchText = (document.getElementById('memory-search')?.value || '').toLowerCase();

  let filtered = memoriesData;
  if (memoryFilter !== 'all') {
    filtered = filtered.filter(m => m.type === memoryFilter);
  }
  if (searchText) {
    filtered = filtered.filter(m =>
      m.name.toLowerCase().includes(searchText) ||
      m.content.toLowerCase().includes(searchText) ||
      m.filename.toLowerCase().includes(searchText)
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="memory-card-empty">No memories found</div>';
    return;
  }

  grid.innerHTML = filtered.map(m => {
    const date = new Date(m.modified).toLocaleDateString();
    return `
      <div class="memory-card" data-filename="${escapeHtml(m.filename)}" data-type="${m.type}">
        <div class="memory-card-header">
          <span class="memory-card-name" title="${escapeHtml(m.filename)}">${escapeHtml(m.name)}</span>
          <span class="memory-badge ${m.type}">${m.type}</span>
        </div>
        <div class="memory-card-preview" onclick="toggleMemoryCard(this)">${escapeHtml(stripFrontmatter(m.content || m.preview))}</div>
        <div class="memory-card-footer">
          <span class="memory-card-date">${date}</span>
          <span class="memory-expand-hint" onclick="toggleMemoryCard(this.closest('.memory-card').querySelector('.memory-card-preview'))"><span class="expand-text">Show more</span><span class="collapse-text">Show less</span></span>
          <div class="memory-card-actions">
            <button onclick="editMemory('${escapeHtml(m.filename)}')">Edit</button>
            <button class="delete-mem-btn" onclick="deleteMemory('${escapeHtml(m.filename)}')">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Mark truncated cards
  requestAnimationFrame(() => {
    grid.querySelectorAll('.memory-card-preview').forEach(el => {
      if (el.scrollHeight > el.clientHeight + 2) el.classList.add('truncated');
    });
  });
}

function filterMemories(type, btn) {
  memoryFilter = type;
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderMemories();
}

document.getElementById('memory-search')?.addEventListener('input', () => renderMemories());

function stripFrontmatter(text) {
  if (!text) return '';
  return text.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();
}

function toggleMemoryCard(previewEl) {
  const card = previewEl.closest('.memory-card');
  if (!card) return;
  card.classList.toggle('expanded');
}

function editMemory(filename) {
  const mem = memoriesData.find(m => m.filename === filename);
  if (!mem) return;

  const card = document.querySelector(`.memory-card[data-filename="${filename}"]`);
  if (!card) return;
  card.classList.add('expanded');

  const preview = card.querySelector('.memory-card-preview');
  const footer = card.querySelector('.memory-card-footer');

  preview.innerHTML = `<textarea class="memory-editor">${escapeHtml(mem.content)}</textarea>`;
  const editor = preview.querySelector('.memory-editor');
  editor.focus();

  footer.innerHTML = `
    <button class="btn btn-sm" onclick="loadMemories()">Cancel</button>
    <button class="btn btn-sm btn-accent" onclick="saveMemoryEdit('${escapeHtml(filename)}', this)">Save</button>
  `;
}

function saveMemoryEdit(filename, btn) {
  const card = document.querySelector(`.memory-card[data-filename="${filename}"]`);
  if (!card) return;
  const editor = card.querySelector('.memory-editor');
  if (!editor) return;

  const content = editor.value;
  btn.textContent = 'Saving...';
  btn.disabled = true;

  fetch(`${API_BASE}/api/memory/` + encodeURIComponent(filename), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        loadMemories(); // Refresh
      } else {
        alert('Save failed: ' + (data.error || 'Unknown error'));
        btn.textContent = 'Save';
        btn.disabled = false;
      }
    })
    .catch(() => {
      alert('Save failed');
      btn.textContent = 'Save';
      btn.disabled = false;
    });
}

function deleteMemory(filename) {
  if (filename === 'MEMORY.md') {
    alert('Cannot delete the index file.');
    return;
  }
  if (!confirm('Delete ' + filename + '?')) return;

  fetch(`${API_BASE}/api/memory/` + encodeURIComponent(filename), { method: 'DELETE' })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        loadMemories();
      } else {
        alert('Delete failed: ' + (data.error || 'Unknown error'));
      }
    });
}

function toggleAddMemory() {
  const section = document.getElementById('memories-add-section');
  section.style.display = section.style.display === 'none' ? 'block' : 'none';
  if (section.style.display === 'block') {
    document.getElementById('new-memory-name').focus();
  }
}

function saveNewMemory() {
  const name = document.getElementById('new-memory-name').value.trim();
  const type = document.getElementById('new-memory-type').value;
  const content = document.getElementById('new-memory-content').value.trim();

  if (!name || !content) {
    alert('Name and content are required');
    return;
  }

  const filename = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_.-]/g, '') + '.md';
  const fullContent = `# ${name}\n\n${content}`;

  fetch(`${API_BASE}/api/memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, content: fullContent, type, name })
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        document.getElementById('new-memory-name').value = '';
        document.getElementById('new-memory-content').value = '';
        document.getElementById('memories-add-section').style.display = 'none';
        loadMemories();
      } else {
        alert('Save failed: ' + (data.error || 'Unknown error'));
      }
    });
}

// Escape handling consolidated in the main keydown handler above

// ── Auto-name conversations ──────────────────────────────────────
function autoNameConversation() {
  if (!activeConversationId) return;
  const conv = conversations[activeConversationId];
  if (!conv) return;
  // Only auto-name if still "New Chat" and we have at least 1 user + 1 assistant message
  if (conv.title !== 'New Chat') return;
  const history = JSON.parse(localStorage.getItem('claudeio-chat') || '[]');
  const hasUser = history.some(m => m.role === 'user');
  const hasAssistant = history.some(m => m.role === 'assistant');
  if (!hasUser || !hasAssistant) return;

  // Set a temporary title immediately from first user message
  const firstUser = history.find(m => m.role === 'user');
  conv.title = firstUser.content.slice(0, 50).replace(/\n/g, ' ');
  if (firstUser.content.length > 50) conv.title += '...';
  saveConversations();
  renderHistoryList();

  // Then get an AI-generated title in the background
  fetch(`${API_BASE}/api/chat-title`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: history.slice(0, 4) })
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok && data.title && conversations[activeConversationId]) {
        conversations[activeConversationId].title = data.title;
        saveConversations();
        renderHistoryList();
      }
    })
    .catch(() => {}); // Keep the truncated title on failure
}

// ── Override clearChatHistory to work with conversations ─────────
const _origClearChatHistory = clearChatHistory;
clearChatHistory = function() {
  newConversation();
};

// ── Auto-save conversation periodically ──────────────────────────
setInterval(() => {
  saveCurrentConversation();
}, 10000);

// ── Initialize ───────────────────────────────────────────────────
connect();
loadConfig();
loadConversations();

// Restore or create initial conversation
const savedActiveConv = localStorage.getItem('claudeio-active-conv');
if (savedActiveConv && conversations[savedActiveConv]) {
  activeConversationId = savedActiveConv;
} else {
  // Migrate existing chat to a conversation
  const existingChat = localStorage.getItem('claudeio-chat');
  const id = generateConversationId();
  conversations[id] = {
    id,
    title: 'New Chat',
    messages: existingChat ? JSON.parse(existingChat) : [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  if (conversations[id].messages.length > 0) {
    const firstUser = conversations[id].messages.find(m => m.role === 'user');
    if (firstUser) {
      conversations[id].title = firstUser.content.slice(0, 50).replace(/\n/g, ' ');
      if (firstUser.content.length > 50) conversations[id].title += '...';
    }
  }
  activeConversationId = id;
  saveConversations();
  localStorage.setItem('claudeio-active-conv', id);
}

// Chat drawer starts open — initialize state
document.getElementById('chat-drawer').classList.add('open');
updateChatContext();
restoreChatHistory();
updateChatLayout();
updateSendButton();
setTimeout(flowLayout, 350);
