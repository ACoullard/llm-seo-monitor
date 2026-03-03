// LLM SEO Monitor — local web server
// Usage: npx tsx server.ts [port]
// Default port: 3456

import { config as loadEnv } from 'dotenv';
loadEnv();

import http from 'http';
import { URL } from 'url';
import {
  deleteRun,
  getEvaluationsForRun,
  getRuns,
  getRunById,
} from './src/db.js';
import { executePrompt } from './src/executor.js';
import { loadPrompts } from './src/config.js';

// ---- In-memory run-tracking ----
const runningPromptIds = new Set<string>();

// ---- Router helpers ----

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
) => Promise<void> | void;

function json(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ---- API handlers ----

const handlers: Array<{
  method: string;
  pattern: RegExp;
  handler: Handler;
}> = [
  // GET /api/prompts
  {
    method: 'GET',
    pattern: /^\/api\/prompts$/,
    handler(_req, res) {
      try {
        const prompts = loadPrompts();
        const withStatus = prompts.map((p) => ({
          ...p,
          is_running: runningPromptIds.has(p.id),
        }));
        json(res, 200, withStatus);
      } catch (err: unknown) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    },
  },

  // POST /api/prompts/:id/run — fires background execution, returns 202
  {
    method: 'POST',
    pattern: /^\/api\/prompts\/([^/]+)\/run$/,
    async handler(req, res, url) {
      const id = url.pathname.split('/')[3];
      if (!id) { json(res, 400, { error: 'Missing prompt id' }); return; }

      let prompt;
      try {
        prompt = loadPrompts().find((p) => p.id === id);
      } catch (err: unknown) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        return;
      }
      if (!prompt) { json(res, 404, { error: 'Prompt not found' }); return; }

      if (runningPromptIds.has(id)) {
        json(res, 409, { error: 'Already running' });
        return;
      }

      // Fire async; don't await
      runningPromptIds.add(id);
      json(res, 202, { message: 'Execution started' });

      executePrompt(prompt, { runJudge: true })
        .catch((err) =>
          console.error(`[server] executor error for ${id}:`, err),
        )
        .finally(() => runningPromptIds.delete(id));
    },
  },

  // GET /api/runs?promptId=&limit=
  {
    method: 'GET',
    pattern: /^\/api\/runs$/,
    handler(_req, res, url) {
      const promptId = url.searchParams.get('promptId') ?? undefined;
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const runs = getRuns(promptId, limit);
      const withEvals = runs.map((run) => ({
        ...run,
        evaluations: getEvaluationsForRun(run.id),
      }));
      json(res, 200, withEvals);
    },
  },

  // GET /api/runs/:id
  {
    method: 'GET',
    pattern: /^\/api\/runs\/([^/]+)$/,
    handler(_req, res, url) {
      const runId = url.pathname.split('/')[3];
      const run = getRunById(runId);
      if (!run) { json(res, 404, { error: 'Run not found' }); return; }
      json(res, 200, { ...run, evaluations: getEvaluationsForRun(run.id) });
    },
  },

  // DELETE /api/runs/:id
  {
    method: 'DELETE',
    pattern: /^\/api\/runs\/([^/]+)$/,
    handler(_req, res, url) {
      const runId = url.pathname.split('/')[3];
      if (!getRunById(runId)) { json(res, 404, { error: 'Run not found' }); return; }
      deleteRun(runId);
      json(res, 200, { ok: true });
    },
  },
];

// ---- Embedded frontend ----

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LLM SEO Monitor</title>
<style>
:root {
  --bg: #0d0d0d;
  --surface: #161616;
  --surface2: #1e1e1e;
  --border: #2a2a2a;
  --border2: #333;
  --text: #e2e2e2;
  --muted: #777;
  --green: #4ade80;
  --red: #f87171;
  --yellow: #fbbf24;
  --cyan: #67e8f9;
  --amber: #f59e0b;
  --primary: #f59e0b;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; font-size: 14px; }
body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

/* Layout */
header { display: flex; align-items: center; gap: 12px; padding: 0 20px; height: 48px; border-bottom: 1px solid var(--border); flex-shrink: 0; background: var(--surface); }
header h1 { font-size: 16px; font-weight: 700; letter-spacing: .04em; color: var(--primary); }
header .subtitle { color: var(--muted); font-size: 12px; }
.layout { display: flex; flex: 1; overflow: hidden; }
.sidebar { width: 340px; flex-shrink: 0; border-right: 1px solid var(--border); overflow-y: auto; display: flex; flex-direction: column; }
.sidebar-header { padding: 10px 12px 10px 16px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); border-bottom: 1px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
.main { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.main-header { padding: 14px 20px 10px; font-size: 15px; font-weight: 600; color: var(--text); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }

/* Prompts list */
.prompt-card { padding: 14px 16px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background .15s; }
.prompt-card:hover { background: var(--surface2); }
.prompt-card.active { background: rgba(245,158,11,.06); border-left: 2px solid var(--primary); padding-left: 14px; }
.prompt-title { font-weight: 600; font-size: 13px; line-height: 1.4; margin-bottom: 6px; color: var(--text); }
.prompt-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.badge { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 3px; text-transform: uppercase; letter-spacing: .04em; border: 1px solid; }
.badge-active   { color: var(--green);  border-color: rgba(74,222,128,.25); background: rgba(74,222,128,.07); }
.badge-paused   { color: var(--muted);  border-color: rgba(120,120,120,.25); background: rgba(120,120,120,.07); }
.badge-running  { color: var(--amber);  border-color: rgba(245,158,11,.35); background: rgba(245,158,11,.1); animation: pulse 1.2s ease-in-out infinite; }
.badge-search   { color: var(--cyan);   border-color: rgba(103,232,249,.25); background: rgba(103,232,249,.07); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
.prompt-models { font-size: 11px; color: var(--muted); font-family: monospace; margin-bottom: 8px; line-height: 1.5; }
.prompt-cron   { font-size: 11px; color: var(--muted); font-family: monospace; }
.run-btn { font-size: 12px; font-weight: 600; padding: 5px 14px; border: none; border-radius: 3px; background: var(--primary); color: #000; cursor: pointer; transition: opacity .15s; margin-top: 4px; }
.run-btn:hover:not(:disabled) { opacity: .85; }
.run-btn:disabled { opacity: .4; cursor: not-allowed; }

/* Runs list */
.runs-list { flex: 1; overflow-y: auto; }
.run-row { padding: 12px 20px; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; align-items: flex-start; gap: 12px; transition: background .15s; }
.run-row:hover { background: var(--surface2); }
.run-row.selected { background: rgba(245,158,11,.06); border-left: 2px solid var(--primary); padding-left: 18px; }
.run-row-left { flex: 1; min-width: 0; }
.run-model   { font-weight: 600; font-size: 13px; color: var(--cyan); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.run-query   { font-size: 12px; color: var(--muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.run-scores  { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.run-score   { font-size: 11px; font-weight: 600; font-family: monospace; }
.run-row-right { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
.run-ts { font-size: 11px; color: var(--muted); white-space: nowrap; }
.del-btn { font-size: 11px; padding: 2px 8px; border: 1px solid rgba(248,113,113,.3); background: rgba(248,113,113,.08); color: var(--red); border-radius: 3px; cursor: pointer; transition: background .15s; white-space: nowrap; }
.del-btn:hover { background: rgba(248,113,113,.18); }
.empty { padding: 40px 20px; text-align: center; color: var(--muted); font-size: 13px; }

/* Detail panel */
.detail { flex: 1; overflow-y: auto; padding: 20px; display: none; }
.detail.open { display: block; }
.detail-model { font-size: 18px; font-weight: 700; color: var(--cyan); margin-bottom: 4px; }
.detail-meta  { font-size: 12px; color: var(--muted); font-family: monospace; margin-bottom: 16px; }
.section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 8px; }
.response-box { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 14px; font-size: 13px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; max-height: 380px; overflow-y: auto; font-family: ui-monospace, monospace; color: var(--text); margin-bottom: 20px; }
.eval-card { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 12px 14px; margin-bottom: 8px; }
.eval-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.eval-name  { font-weight: 600; font-size: 13px; }
.eval-score { font-family: monospace; font-weight: 700; font-size: 14px; }
.eval-reason { font-size: 12px; color: var(--muted); line-height: 1.5; }

/* colours */
.score-green { color: var(--green); }
.score-red   { color: var(--red); }
.score-yellow { color: var(--yellow); }
.score-muted  { color: var(--muted); }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
</style>
</head>
<body>
<header>
  <h1>⬡ LLM SEO Monitor</h1>
</header>
<div class="layout">
  <!-- Sidebar: prompts -->
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header">Prompts<button class="run-btn" id="runAllBtn" onclick="runAll()">▶▶ Run all</button></div>
    <div id="promptList"><div class="empty">Loading…</div></div>
  </aside>

  <!-- Main: runs -->
  <main class="main">
    <div class="main-header">
      <span id="mainTitle">Select a prompt</span>
      <span id="runCount" style="color:var(--muted);font-size:11px"></span>
    </div>
    <div class="layout" style="overflow:hidden;flex:1">
      <div class="runs-list" id="runsList" style="flex:1;border-right:1px solid var(--border)">
        <div class="empty" id="runsEmpty">Select a prompt to view its runs</div>
      </div>
      <div class="detail" id="detailPanel" style="width:420px;flex-shrink:0;border-left:0"></div>
    </div>
  </main>
</div>

<script>
let prompts = [];
let runs = [];
let selectedPromptId = null;
let selectedRunId = null;
let pollTimer = null;
let runningSet = new Set();

// ---- Fetch helpers ----
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ---- Prompts ----
async function loadPrompts() {
  prompts = await api('GET', '/api/prompts');
  runningSet = new Set(prompts.filter(p => p.is_running).map(p => p.id));
  renderPrompts();

  // Keep polling while any prompt is running
  if (runningSet.size > 0) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => { loadPrompts(); if (selectedPromptId) loadRuns(selectedPromptId); }, 2000);
  }
}

function renderPrompts() {
  const el = document.getElementById('promptList');
  if (!prompts.length) { el.innerHTML = '<div class="empty">No prompts found in prompts.json</div>'; return; }

  el.innerHTML = prompts.map(p => {
    const isRunning = runningSet.has(p.id);
    const isActive = p.is_active;
    const anySearch = (p.targets || []).some(t => t.use_search);
    const statusBadge = isRunning
      ? \`<span class="badge badge-running">Running…</span>\`
      : isActive
        ? \`<span class="badge badge-active">Active</span>\`
        : \`<span class="badge badge-paused">Paused</span>\`;
    const searchBadge = anySearch ? \`<span class="badge badge-search">Search</span>\` : '';
    const models = (p.targets || []).map(t => t.model.split('/')[1] || t.model).join(', ');
    const cron = p.schedule_cron ? \`<div class="prompt-cron">⏱ \${p.schedule_cron}</div>\` : '';
    const selected = p.id === selectedPromptId ? ' active' : '';

    return \`<div class="prompt-card\${selected}" onclick="selectPrompt('\${p.id}')">
      <div class="prompt-title">\${esc(p.id)}</div>
      <div class="prompt-meta">\${statusBadge}\${searchBadge}</div>
      <div class="prompt-models">\${esc(models)}</div>
      \${cron}
      <button class="run-btn" \${isRunning ? 'disabled' : ''} onclick="runPrompt(event, '\${p.id}')">
        \${isRunning ? 'Running…' : '▶ Run now'}
      </button>
    </div>\`;
  }).join('');
}

// ---- Run a prompt ----
async function runPrompt(e, id) {
  e.stopPropagation();
  try {
    runningSet.add(id);
    renderPrompts();
    await api('POST', \`/api/prompts/\${id}/run\`);
    // Poll for new runs
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      await loadPrompts();
      if (selectedPromptId === id) await loadRuns(id);
      startPollingIfRunning();
    }, 2500);
  } catch (err) {
    alert('Run failed: ' + err.message);
    runningSet.delete(id);
    renderPrompts();
  }
}

async function runAll() {
  const btn = document.getElementById('runAllBtn');
  const active = prompts.filter(p => p.is_active);
  if (!active.length) { alert('No active prompts.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
  for (const p of active) {
    if (runningSet.has(p.id)) continue;
    try {
      runningSet.add(p.id);
      renderPrompts();
      await api('POST', '/api/prompts/' + p.id + '/run');
    } catch (err) {
      runningSet.delete(p.id);
      renderPrompts();
    }
  }
  if (btn) { btn.disabled = false; btn.textContent = '▶▶ Run all'; }
  startPollingIfRunning();
  if (selectedPromptId) { clearTimeout(pollTimer); pollTimer = setTimeout(() => loadRuns(selectedPromptId), 2500); }
}

function startPollingIfRunning() {
  if (runningSet.size > 0) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      await loadPrompts();
      if (selectedPromptId) await loadRuns(selectedPromptId);
      startPollingIfRunning();
    }, 2500);
  }
}

// ---- Select prompt ----
async function selectPrompt(id) {
  selectedPromptId = id;
  selectedRunId = null;
  renderPrompts();
  const p = prompts.find(x => x.id === id);
  document.getElementById('mainTitle').textContent = p ? p.query_text : id;
  document.getElementById('detailPanel').classList.remove('open');
  document.getElementById('detailPanel').innerHTML = '';
  await loadRuns(id);
}

// ---- Runs ----
async function loadRuns(promptId) {
  runs = await api('GET', \`/api/runs?promptId=\${promptId}&limit=100\`);
  document.getElementById('runCount').textContent = runs.length ? runs.length + ' run(s)' : '';
  renderRuns();
}

function renderRuns() {
  const el = document.getElementById('runsList');
  const empty = document.getElementById('runsEmpty');

  if (!selectedPromptId) { el.innerHTML = '<div class="empty" id="runsEmpty">Select a prompt to view its runs</div>'; return; }
  if (!runs.length) { el.innerHTML = '<div class="empty" id="runsEmpty">No runs yet — click Run now</div>'; return; }

  el.innerHTML = runs.map(run => {
    const ts = new Date(run.executed_at).toLocaleString();
    const model = (run.model_used.split('/')[1] || run.model_used);
    const search = run.web_search_enabled ? ' <span style="font-size:10px;color:var(--cyan)">[search]</span>' : '';
    const scoresHtml = (run.evaluations || []).map(ev => {
      const { label, cls } = formatScore(ev.score, ev.rule_type);
      return \`<span class="run-score \${cls}">\${esc(ev.rule_name)}: \${label}</span>\`;
    }).join('');
    const selected = run.id === selectedRunId ? ' selected' : '';

    return \`<div class="run-row\${selected}" onclick="selectRun('\${run.id}')">
      <div class="run-row-left">
        <div class="run-model">\${esc(model)}\${search}</div>
        \${scoresHtml ? \`<div class="run-scores">\${scoresHtml}</div>\` : ''}
      </div>
      <div class="run-row-right">
        <span class="run-ts">\${ts}</span>
        <button class="del-btn" onclick="deleteRun(event, '\${run.id}')">Delete</button>
      </div>
    </div>\`;
  }).join('');
}

// ---- Select run (show detail) ----
async function selectRun(id) {
  selectedRunId = id;
  renderRuns();
  const run = runs.find(r => r.id === id);
  if (!run) return;

  const panel = document.getElementById('detailPanel');
  panel.classList.add('open');

  const modelShort = run.model_used.split('/')[1] || run.model_used;
  const ts = new Date(run.executed_at).toLocaleString();
  const evalsHtml = (run.evaluations || []).map(ev => {
    const { label, cls } = formatScore(ev.score, ev.rule_type);
    return \`<div class="eval-card">
      <div class="eval-top">
        <span class="eval-name">\${esc(ev.rule_name)}</span>
        <span class="eval-score \${cls}">\${label}</span>
      </div>
      \${ev.reasoning ? \`<div class="eval-reason">\${esc(ev.reasoning)}</div>\` : ''}
    </div>\`;
  }).join('');

  panel.innerHTML = \`
    <div class="detail-model">\${esc(modelShort)}</div>
    <div class="detail-meta">
      \${esc(run.model_used)} · \${ts}<br>
      \${run.token_usage_input}in / \${run.token_usage_output}out tokens\${run.web_search_enabled ? ' · search enabled' : ''}
    </div>
    \${evalsHtml ? \`<div class="section-title" style="margin-bottom:8px">Evaluations</div>\${evalsHtml}<div style="margin-bottom:20px"></div>\` : ''}
    <div class="section-title">Response</div>
    <div class="response-box">\${esc(run.response_text || '(no response)')}</div>
  \`;
}

// ---- Delete run ----
async function deleteRun(e, id) {
  e.stopPropagation();
  if (!confirm('Delete this run and its evaluations?')) return;
  try {
    await api('DELETE', \`/api/runs/\${id}\`);
    if (selectedRunId === id) {
      selectedRunId = null;
      document.getElementById('detailPanel').classList.remove('open');
      document.getElementById('detailPanel').innerHTML = '';
    }
    runs = runs.filter(r => r.id !== id);
    document.getElementById('runCount').textContent = runs.length ? runs.length + ' run(s)' : '';
    renderRuns();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// ---- Helpers ----
function formatScore(score, type) {
  if (type === 'binary') {
    return score ? { label: 'yes', cls: 'score-green' } : { label: 'no', cls: 'score-red' };
  }
  if (type === 'ranking') {
    if (score === 0) return { label: 'not found', cls: 'score-muted' };
    const cls = score <= 3 ? 'score-green' : score <= 5 ? 'score-yellow' : 'score-red';
    return { label: '#' + score, cls };
  }
  if (type === 'sentiment') {
    const cls = score > 0.3 ? 'score-green' : score < -0.3 ? 'score-red' : 'score-yellow';
    return { label: score.toFixed(2), cls };
  }
  return { label: String(score), cls: '' };
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ---- Boot ----
loadPrompts();
</script>
</body>
</html>`;

// ---- HTTP server ----

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 3456);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  // Serve frontend
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  // Route API
  for (const { method, pattern, handler } of handlers) {
    if (req.method === method && pattern.test(url.pathname)) {
      try {
        await handler(req, res, url);
      } catch (err: unknown) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`\n  LLM SEO Monitor running at  http://localhost:${PORT}\n`);
});
