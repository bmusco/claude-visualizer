#!/usr/bin/env node
/**
 * MCP server that gives Claude a `execute_sql` tool.
 * Communicates over stdio (JSON-RPC 2.0) and calls the Claud-io
 * REST API on localhost to actually run queries.
 */
const http = require('http');
const readline = require('readline');

const API_PORT = process.env.CLAUDIO_PORT || 3333;
const API_HOST = process.env.CLAUDIO_HOST || '127.0.0.1';

// ── JSON-RPC helpers ─────────────────────────────────────────────
function send(obj) {
  const json = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── HTTP client to call Claud-io /api/query ──────────────────────
function queryApi(sql, database) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ sql, database: database || undefined });
    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/query',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid API response')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Query timed out')); });
    req.write(body);
    req.end();
  });
}

// ── Format results as readable text ──────────────────────────────
function formatResults(apiResult) {
  if (!apiResult.ok) {
    return `ERROR: ${apiResult.error}\nDatabase: ${apiResult.database || 'unknown'}\nDuration: ${apiResult.duration || 0}ms`;
  }

  const { fields, rows, rowCount, duration, database } = apiResult;

  if (!rows || rows.length === 0) {
    return `No results returned.\nDatabase: ${database}\nDuration: ${duration}ms`;
  }

  // Build a markdown-style table (Claude reads these well)
  let out = `${rowCount} row${rowCount !== 1 ? 's' : ''} returned (${duration}ms, ${database})\n\n`;

  // Header
  out += '| ' + fields.join(' | ') + ' |\n';
  out += '| ' + fields.map(() => '---').join(' | ') + ' |\n';

  // Rows (cap at 100 for readability)
  const displayRows = rows.slice(0, 100);
  for (const row of displayRows) {
    out += '| ' + fields.map(f => String(row[f] ?? '')).join(' | ') + ' |\n';
  }

  if (rows.length > 100) {
    out += `\n... and ${rows.length - 100} more rows\n`;
  }

  return out;
}

// ── MCP message handler ──────────────────────────────────────────
async function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'claudio-db', version: '1.0.0' },
      });
      break;

    case 'notifications/initialized':
      // No response needed for notifications
      break;

    case 'tools/list':
      respond(id, {
        tools: [{
          name: 'execute_sql',
          description: `Execute a SQL query against CMT databases. Returns results as a markdown table.

The default database is prod_redshift (Redshift analytics). Aurora tables (prod_clone) require pgproxy which may not be available — if you get an Aurora/pgproxy error, rewrite using Redshift analytics tables.

To discover available tables: SELECT DISTINCT tablename FROM pg_tables WHERE schemaname='analytics' AND tablename LIKE '%keyword%'

Only SELECT and WITH queries are allowed.`,
          inputSchema: {
            type: 'object',
            properties: {
              sql: {
                type: 'string',
                description: 'The SQL query to execute (SELECT or WITH only)',
              },
              database: {
                type: 'string',
                description: 'Optional database name. Defaults to prod_redshift. Use prod_clone for Aurora tables (if pgproxy available).',
              },
            },
            required: ['sql'],
          },
        }],
      });
      break;

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      if (toolName !== 'execute_sql') {
        respondError(id, -32601, `Unknown tool: ${toolName}`);
        return;
      }

      const sql = args.sql;
      if (!sql) {
        respond(id, { content: [{ type: 'text', text: 'ERROR: Missing sql parameter' }], isError: true });
        return;
      }

      try {
        const result = await queryApi(sql, args.database);
        const text = formatResults(result);
        respond(id, {
          content: [{ type: 'text', text }],
          isError: !result.ok,
        });
      } catch (err) {
        respond(id, {
          content: [{ type: 'text', text: `ERROR: ${err.message}` }],
          isError: true,
        });
      }
      break;
    }

    default:
      if (id !== undefined) {
        respondError(id, -32601, `Method not found: ${method}`);
      }
  }
}

// ── Stdio transport (Content-Length framing) ─────────────────────
let inputBuffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;

  while (true) {
    // Look for Content-Length header
    const headerEnd = inputBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = inputBuffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      // Skip malformed header
      inputBuffer = inputBuffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1]);
    const bodyStart = headerEnd + 4;

    if (inputBuffer.length < bodyStart + contentLength) break; // Wait for more data

    const body = inputBuffer.slice(bodyStart, bodyStart + contentLength);
    inputBuffer = inputBuffer.slice(bodyStart + contentLength);

    try {
      const msg = JSON.parse(body);
      handleMessage(msg).catch(err => {
        process.stderr.write(`[mcp-db] Error: ${err.message}\n`);
        if (msg.id !== undefined) {
          respondError(msg.id, -32603, err.message);
        }
      });
    } catch (err) {
      process.stderr.write(`[mcp-db] Parse error: ${err.message}\n`);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
process.stderr.write('[mcp-db] MCP database server started\n');
