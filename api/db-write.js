/**
 * Server-side proxy for all Supabase writes + storage uploads.
 * Uses the service role key so RLS never blocks admin operations.
 * Requires a valid Supabase user JWT in the Authorization header.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGIN = 'https://platform.infinite-scale.be';

const ALLOWED_TABLES = new Set([
  'agents', 'clients', 'appointments', 'agent_clients', 'eod_reports',
  'tickets', 'recruits', 'prospects', 'contracts', 'events', 'notifications',
  'agent_schedules', 'activity_log', 'platform_settings', 'presence',
  'invoice_states', 'whatsapp_messages', 'client_whatsapp_templates',
  'dials', 'dials_hourly', 'profiles',
]);

export const config = { api: { bodyParser: false } };

async function verifyToken(token) {
  if (!token) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + token },
  });
  if (!r.ok) return null;
  return r.json();
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-file-path');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  // Verify caller is a logged-in platform user
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const user = await verifyToken(token);
  if (!user || !user.id) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  // Storage upload: detected by x-file-path header
  const filePath = req.headers['x-file-path'];
  if (filePath) {
    // Sanitise the path to prevent path traversal
    const safePath = filePath.replace(/\.\./g, '').replace(/^\/+/, '');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const r = await fetch(`${SB_URL}/storage/v1/object/contracts/${safePath}`, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': req.headers['content-type'] || 'application/pdf' },
      body: buffer,
    });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ ok: false, error: text });
    return res.status(200).json({ ok: true, url: `${SB_URL}/storage/v1/object/public/contracts/${safePath}` });
  }

  // JSON body for DB writes
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  let parsed;
  try { parsed = JSON.parse(rawBody); } catch { return res.status(400).json({ ok: false, error: 'invalid JSON' }); }

  const { method, table, query, body, conflict } = parsed || {};

  if (!table) return res.status(400).json({ ok: false, error: 'table required' });
  if (!ALLOWED_TABLES.has(table)) return res.status(400).json({ ok: false, error: 'table not allowed' });

  const base = `${SB_URL}/rest/v1/${table}`;
  const hdrs = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  let url, fetchMethod, fetchBody;

  if (method === 'patch') {
    url = base + (query || '');
    fetchMethod = 'PATCH';
    let patchBody = body;
    if (table === 'clients' && body && typeof body === 'object') {
      const { phone: _phone, vat: _vat, ...rest } = body;
      patchBody = rest;
    }
    fetchBody = JSON.stringify(patchBody);
  } else if (method === 'post') {
    url = base;
    fetchMethod = 'POST';
    fetchBody = JSON.stringify(body);
  } else if (method === 'upsert') {
    url = conflict ? `${base}?on_conflict=${conflict}` : base;
    fetchMethod = 'POST';
    hdrs['Prefer'] = `resolution=merge-duplicates,return=representation`;
    fetchBody = JSON.stringify(body);
  } else if (method === 'del') {
    url = base + (query || '');
    fetchMethod = 'DELETE';
    delete hdrs['Prefer'];
  } else {
    return res.status(400).json({ ok: false, error: 'unknown method' });
  }

  try {
    const r = await fetch(url, { method: fetchMethod, headers: hdrs, body: fetchBody });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    if (!r.ok) return res.status(200).json({ ok: false, status: r.status, error: data });
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}
