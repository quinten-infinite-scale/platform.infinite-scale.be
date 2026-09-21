// Merged renocheck-lead + renocheck-status into one function to stay under Vercel Hobby 12-function limit.
// POST /api/renocheck?action=lead   → create a new Renocheck lead
// GET  /api/renocheck?action=status → list appts needing status update
// POST /api/renocheck?action=status → run full Renocheck status sync

const RN_AUTH = '9bc5fb0e-2ca3-4779-ae84-4a13bcac6271';
const RN_BASE = 'https://renocheck.be/api/v2';
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const CAT_SLUGS = {
  'Airco': 'airco',
  'Thuisbatt': 'thuisbatterijen',
  'Zonnepanelen': 'zonnepanelen',
  'Ramen en deuren': 'ramen-deuren',
  'Keukens': 'keuken',
  'Badkamers': 'badkamer',
  'Crepi': 'crepi',
  'Dak': 'dak-renovatie',
  'Chapewerken': 'chapewerken',
};

async function rnGet(path) {
  const r = await fetch(`${RN_BASE}${path}`, {
    headers: { Authorization: RN_AUTH, 'Content-Type': 'application/json' },
  });
  if (!r.ok) return null;
  return r.json();
}

async function sbGet(table, query) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) return [];
  return r.json();
}

async function sbPatch(table, query, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    method: 'PATCH',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  return r.ok;
}

async function handleLead(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    category, firstname, lastname, email, phonenumber,
    street, number, zipcode, city, external_id, description, data,
  } = req.body || {};

  if (!category || !firstname || !phonenumber) {
    return res.status(400).json({ error: 'Missing required fields: category, firstname, phonenumber' });
  }

  const category_slug = CAT_SLUGS[category];
  if (!category_slug) {
    return res.status(400).json({ error: 'Unknown category: ' + category });
  }

  const payload = {
    category: category_slug,
    full_name: [firstname, lastname || ''].filter(Boolean).join(' '),
    phone: phonenumber,
    email: email || '',
    street: street || '',
    number: number || '',
    zipcode: zipcode || '',
    city: city || '',
    external_id: external_id || ('IS-' + Date.now()),
    ...(description ? { description } : {}),
    ...(data ? { data } : {}),
  };

  const r = await fetch('https://renocheck.be/api/v2/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': RN_AUTH },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  if (!r.ok) {
    console.error('renocheck lead error:', r.status, text);
    return res.status(r.status).json({ error: text });
  }

  let data2;
  try { data2 = JSON.parse(text); } catch { data2 = { raw: text }; }
  return res.status(200).json({ ok: true, data: data2 });
}

async function handleStatus(req, res) {
  const appts = await sbGet('appointments', '?client_id=eq.c15&select=id,client_feedback,lead_name,sub_client_id&order=date_logged.desc&limit=1000');
  if (!appts || !appts.length) return res.status(200).json({ ok: true, checked: 0, updated: 0 });

  const rnAppts = appts.filter(a => {
    try { const fb = JSON.parse(a.client_feedback || '{}'); return fb._rn && (fb.external_id || fb.rn_id); }
    catch(_) { return false; }
  });

  const backfillAppts = appts.filter(a => {
    try { const fb = JSON.parse(a.client_feedback || '{}'); return fb._rn && !fb.external_id && !fb.rn_id; }
    catch(_) { return false; }
  });

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, total: rnAppts.length, backfill: backfillAppts.length, appts: rnAppts.map(a => a.id) });
  }

  let updated = 0;
  const errors = [];
  let backfilled = 0;

  for (const appt of backfillAppts) {
    try {
      let fb;
      try { fb = JSON.parse(appt.client_feedback); } catch(_) { continue; }
      const name = appt.lead_name || fb.name || fb.naam || '';
      const catSlug = appt.sub_client_id || fb.category || fb.categorie || '';
      if (!name) continue;

      const searchResults = await rnGet(`/leads?search=${encodeURIComponent(name)}&limit=20`);
      const candidates = Array.isArray(searchResults) ? searchResults : (searchResults?.data || []);
      if (!candidates.length) continue;

      const normalName = name.toLowerCase().trim();
      let match = candidates.find(c => {
        const cName = ((c.name || c.naam || c.first_name || '') + ' ' + (c.last_name || c.achternaam || '')).toLowerCase().trim();
        if (!cName.includes(normalName) && !normalName.includes(cName.split(' ')[0])) return false;
        if (catSlug && c.category) return c.category.toLowerCase().includes(catSlug.toLowerCase()) || catSlug.toLowerCase().includes(c.category.toLowerCase());
        return true;
      });
      if (!match) match = candidates.find(c => {
        const cName = ((c.name || c.naam || c.first_name || '') + ' ' + (c.last_name || c.achternaam || '')).toLowerCase().trim();
        return cName.includes(normalName.split(' ')[0]) || normalName.split(' ')[0] in cName;
      });
      if (!match) continue;

      const newStatus = match.status || match.platform_status || null;
      const newComment = match.comment || match.refusal_reason || match.reden || null;
      const wasGeweigerd = newStatus === 'geweigerd' || newStatus === 'refused' || newStatus === 'rejected';
      const updatedFb = {
        ...fb,
        rn_id: match.id,
        ...(newStatus ? { platform_status: newStatus } : {}),
        ...(newComment ? { platform_comment: newComment } : {}),
        ...(wasGeweigerd ? { geweigerd: true, geweigerd_at: new Date().toISOString() } : {}),
        status_checked_at: new Date().toISOString(),
      };
      const ok = await sbPatch('appointments', `?id=eq.${appt.id}`, { client_feedback: JSON.stringify(updatedFb) });
      if (ok) backfilled++;
    } catch(_) {}
  }

  for (const appt of rnAppts) {
    try {
      let fb;
      try { fb = JSON.parse(appt.client_feedback); } catch(_) { continue; }

      let rnLead = null;
      if (fb.rn_id) rnLead = await rnGet(`/leads/${fb.rn_id}`);
      if (!rnLead && fb.external_id) {
        const list = await rnGet(`/leads?external_id=${encodeURIComponent(fb.external_id)}`);
        rnLead = Array.isArray(list) ? list[0] : (list?.data?.[0] || null);
      }
      if (!rnLead) continue;

      const newStatus = rnLead.status || rnLead.platform_status || null;
      const newComment = rnLead.comment || rnLead.refusal_reason || rnLead.reden || null;
      const wasGeweigerd = newStatus === 'geweigerd' || newStatus === 'refused' || newStatus === 'rejected';

      if (!newStatus && !newComment) continue;
      if (fb.platform_status === newStatus && fb.platform_comment === newComment) continue;

      const updatedFb = {
        ...fb,
        platform_status: newStatus,
        ...(newComment ? { platform_comment: newComment } : {}),
        ...(wasGeweigerd ? { geweigerd: true, geweigerd_at: new Date().toISOString() } : {}),
        ...(rnLead.id && !fb.rn_id ? { rn_id: rnLead.id } : {}),
        status_checked_at: new Date().toISOString(),
      };

      const ok = await sbPatch('appointments', `?id=eq.${appt.id}`, { client_feedback: JSON.stringify(updatedFb) });
      if (ok) updated++;
    } catch(err) {
      errors.push({ id: appt.id, error: String(err) });
    }
  }

  return res.status(200).json({ ok: true, checked: rnAppts.length, updated, backfilled, errors: errors.length ? errors : undefined });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action || (req.url?.includes('action=') ? new URL('http://x' + req.url).searchParams.get('action') : null);

  if (action === 'lead') return handleLead(req, res);
  if (action === 'status' || !action) return handleStatus(req, res);
  return res.status(400).json({ error: 'Unknown action. Use ?action=lead or ?action=status' });
}
