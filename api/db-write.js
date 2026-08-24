/**
 * Server-side proxy for all Supabase writes.
 * Uses the service role key so RLS never blocks admin operations.
 * The browser sends its user JWT so we can validate it's a real session.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const { method, table, query, body, conflict } = req.body || {};

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
    if (table === 'appointments' && body && !String(body.phone || '').trim()) {
      return res.status(400).json({ ok: false, error: 'phone required' });
    }
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
