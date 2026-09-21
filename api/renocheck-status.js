// Daily Renocheck status sync — can be called from n8n cron or manually
// GET  /api/renocheck-status?mode=check  → returns all Renocheck appts needing status update
// POST /api/renocheck-status             → runs full sync, updates clientFeedback in Supabase

const RN_AUTH = '9bc5fb0e-2ca3-4779-ae84-4a13bcac6271';
const RN_BASE = 'https://renocheck.be/api/v2';
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Fetch all Renocheck appointments (client_id = c15) that have clientFeedback with _rn flag
  const appts = await sbGet('appointments', '?client_id=eq.c15&select=id,client_feedback&order=date_logged.desc&limit=500');
  if (!appts || !appts.length) return res.status(200).json({ ok: true, checked: 0, updated: 0 });

  const rnAppts = appts.filter(a => {
    try { const fb = JSON.parse(a.client_feedback || '{}'); return fb._rn && (fb.external_id || fb.rn_id); }
    catch(_) { return false; }
  });

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, total: rnAppts.length, appts: rnAppts.map(a => a.id) });
  }

  let updated = 0;
  const errors = [];

  for (const appt of rnAppts) {
    try {
      let fb;
      try { fb = JSON.parse(appt.client_feedback); } catch(_) { continue; }

      // Look up by external_id or rn_id
      let rnLead = null;
      if (fb.rn_id) {
        rnLead = await rnGet(`/leads/${fb.rn_id}`);
      }
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

  return res.status(200).json({ ok: true, checked: rnAppts.length, updated, errors: errors.length ? errors : undefined });
}
