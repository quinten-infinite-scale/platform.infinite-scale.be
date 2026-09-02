/**
 * Server-side proxy for all Supabase writes + storage uploads.
 * Uses the service role key so RLS never blocks admin operations.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-file-path');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  // Storage upload: detected by x-file-path header
  const filePath = req.headers['x-file-path'];
  if (filePath) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const r = await fetch(`${SB_URL}/storage/v1/object/contracts/${filePath}`, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': req.headers['content-type'] || 'application/pdf' },
      body: buffer,
    });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ ok: false, error: text });
    return res.status(200).json({ ok: true, url: `${SB_URL}/storage/v1/object/public/contracts/${filePath}` });
  }

  // JSON body for DB writes
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  let parsed;
  try { parsed = JSON.parse(rawBody); } catch { return res.status(400).json({ ok: false, error: 'invalid JSON' }); }

  const { method, table, query, body, conflict } = parsed || {};

  if (method === 'exec_sql') {
    const sql = parsed.sql;
    if (!sql) return res.status(400).json({ ok: false, error: 'sql required' });
    const r2 = await fetch(`${SB_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const t2 = await r2.text();
    return res.status(200).json({ ok: r2.ok, status: r2.status, body: t2 });
  }

  if (!table) return res.status(400).json({ ok: false, error: 'table required' });

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
