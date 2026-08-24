/**
 * Claude Agent — cloud-ready version
 * Reads/writes files via GitHub API → Vercel auto-deploys on push.
 * Runs on Railway (always on) OR locally (node server-claude.js).
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY  — Anthropic API key
 *   GITHUB_TOKEN       — GitHub PAT with repo read/write scope
 *   GITHUB_OWNER       — GitHub username (quinten-infinite-scale)
 *   GITHUB_REPO        — Repo name (platform.infinite-scale.be)
 *   AGENT_SECRET       — Shared secret for the /execute endpoint
 */

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'quinten-infinite-scale';
const GITHUB_REPO = process.env.GITHUB_REPO || 'platform.infinite-scale.be';
const AGENT_SECRET = process.env.AGENT_SECRET || 'claude-agent-local-2026';

// ── GitHub API helpers ──────────────────────────────────────────────────────

function ghRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const reqBody = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'claude-agent/1.0',
        ...(reqBody ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reqBody) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (reqBody) req.write(reqBody);
    req.end();
  });
}

async function ghReadFile(path) {
  const r = await ghRequest('GET', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`);
  if (r.status !== 200) return { error: `${r.status}: ${JSON.stringify(r.body?.message || r.body)}`, sha: null, content: null };
  const content = Buffer.from(r.body.content, 'base64').toString('utf-8');
  return { content, sha: r.body.sha, error: null };
}

async function ghWriteFile(path, content, sha, message) {
  const r = await ghRequest('PUT', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
    message: message || `Claude: update ${path}`,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {}),
  });
  if (r.status !== 200 && r.status !== 201) return `Error ${r.status}: ${JSON.stringify(r.body?.message || r.body)}`;
  return `✓ Committed ${path} → ${r.body.commit?.sha?.slice(0, 7)} (Vercel will auto-deploy)`;
}

async function ghListDir(path) {
  const r = await ghRequest('GET', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path || '')}`);
  if (r.status !== 200) return `Error ${r.status}: ${JSON.stringify(r.body?.message || r.body)}`;
  if (!Array.isArray(r.body)) return String(r.body);
  return r.body.map(f => `${f.type === 'dir' ? '📁' : '📄'} ${f.name}`).join('\n');
}

async function ghSearchCode(query) {
  const r = await ghRequest('GET', `/search/code?q=${encodeURIComponent(query + ` repo:${GITHUB_OWNER}/${GITHUB_REPO}`)}&per_page=10`);
  if (r.status !== 200) return `Error ${r.status}: ${JSON.stringify(r.body?.message || r.body)}`;
  const items = r.body.items || [];
  return items.map(i => `${i.path} (line matches: ${i.text_matches?.length || '?'})`).join('\n') || 'No results';
}

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file from the GitHub repository. Path is relative to repo root (e.g. "public/js/screen-admin.js").',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'write_file',
    description: 'Write/update a file in the GitHub repository. This creates a git commit immediately and Vercel will auto-deploy.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, commit_message: { type: 'string', description: 'Optional commit message' } }, required: ['path', 'content'] },
  },
  {
    name: 'list_dir',
    description: 'List files and directories at a path in the repo.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path, default root "."' } }, required: [] },
  },
  {
    name: 'search_code',
    description: 'Search for a string or pattern in the codebase.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

async function executeTool(name, input) {
  switch (name) {
    case 'read_file': {
      const r = await ghReadFile(input.path);
      if (r.error) return `Error reading ${input.path}: ${r.error}`;
      return r.content;
    }
    case 'write_file': {
      // Read current SHA first (needed for updates)
      const existing = await ghReadFile(input.path);
      const sha = existing.sha || null; // null for new files
      return await ghWriteFile(input.path, input.content, sha, input.commit_message);
    }
    case 'list_dir': {
      return await ghListDir(input.path || '');
    }
    case 'search_code': {
      return await ghSearchCode(input.query);
    }
    default: return `Unknown tool: ${name}`;
  }
}

// ── Anthropic API call ──────────────────────────────────────────────────────

function callAnthropic(body) {
  return new Promise((resolve, reject) => {
    const reqBody = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(reqBody),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Failed to parse API response')); }
      });
    });
    req.on('error', reject);
    req.write(reqBody);
    req.end();
  });
}

// ── Main execute handler ────────────────────────────────────────────────────

async function handleExecute(body, res) {
  const { title, notes } = body;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const send = data => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {} };

  if (!ANTHROPIC_API_KEY) { send({ error: 'ANTHROPIC_API_KEY not configured on agent server' }); send({ done: true }); return res.end(); }
  if (!GITHUB_TOKEN) { send({ error: 'GITHUB_TOKEN not configured on agent server' }); send({ done: true }); return res.end(); }

  const systemPrompt = `You are Claude Code, executing platform tasks for Infinite Scale — a Belgian appointment-setting operations platform.

Repository: ${GITHUB_OWNER}/${GITHUB_REPO} (GitHub)
Stack: Custom DCLogic framework (React-like, no JSX), Supabase backend (https://database.infinite-scale.be), Vercel deployment.

Key files:
- public/index.html — version strings (var V=), script tags with ?v= cache busters
- public/js/screen-admin.js — admin dashboard, todos, Claude button
- public/js/modals.js — all modal/wizard UI
- public/js/contract-templates.js — PDF contract generation
- api/*.js — Vercel serverless functions

IMPORTANT RULES:
- Always read a file before writing it (so you have the correct SHA for the GitHub API)
- After editing any JS file, also update its ?v= version string in public/index.html and bump var V= to force a reload
- Every write_file call creates a git commit → Vercel will auto-deploy after your last change
- Be thorough — implement the full task completely`;

  const messages = [{
    role: 'user',
    content: `Execute this task fully:\n\n**${title}**${notes ? `\n\nNotes: ${notes}` : ''}\n\nRead the relevant files, implement all changes, and update version strings when done. Report progress as you go.`,
  }];

  try {
    while (true) {
      send({ text: '\n' }); // keep connection alive
      const data = await callAnthropic({
        model: 'claude-opus-5',
        max_tokens: 8000,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });

      if (data.error) { send({ error: `API error: ${data.error.message || JSON.stringify(data.error)}` }); break; }

      const content = data.content || [];

      for (const block of content) {
        if (block.type === 'text' && block.text) send({ text: block.text });
        else if (block.type === 'tool_use') send({ tool: block.name, input: block.input });
      }

      if (data.stop_reason === 'end_turn' || data.stop_reason !== 'tool_use') break;

      const toolResults = [];
      for (const block of content) {
        if (block.type === 'tool_use') {
          send({ toolRunning: block.name });
          const result = await executeTool(block.name, block.input);
          send({ toolResult: block.name, output: String(result).slice(0, 400) });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result) });
        }
      }

      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: toolResults });
    }
  } catch (err) {
    send({ error: String(err) });
  }

  send({ done: true });
  res.end();
}

// ── HTTP server ─────────────────────────────────────────────────────────────

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: true, version: '2.0', mode: 'github-api' }));
  }

  if (req.method === 'POST' && req.url === '/execute') {
    if ((req.headers.authorization || '') !== `Bearer ${AGENT_SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { handleExecute(JSON.parse(body), res); }
      catch { res.writeHead(400); res.end(JSON.stringify({ error: 'Bad request' })); }
    });
    return;
  }

  res.writeHead(404);
  res.end();
}).listen(PORT, () => {
  console.log(`\n⚡ Claude Agent (cloud) running on port ${PORT}`);
  console.log(`   GitHub: ${GITHUB_OWNER}/${GITHUB_REPO}`);
  console.log(`   Anthropic: ${ANTHROPIC_API_KEY ? '✓' : '✗ missing'}`);
  console.log(`   GitHub token: ${GITHUB_TOKEN ? '✓' : '✗ missing'}`);
  console.log(`\n   Every write_file → git commit → Vercel auto-deploys.\n`);
});
