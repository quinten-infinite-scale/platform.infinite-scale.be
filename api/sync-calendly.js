/**
 * /api/sync-calendly — Calendly → Supabase CRM sync
 *
 * Called by n8n schedule (every 5 min). Polls Calendly for events from last 90 days,
 * deduplicates via prospect_meetings, creates/updates prospects and inserts meeting rows.
 *
 * Protected by X-Sync-Secret header (pass CRON_SECRET from Vercel env).
 * Calendly PAT passed via X-Calendly-Token header from n8n (not stored in Vercel env).
 */

export const config = { api: { bodyParser: true } };

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const USER_URI = 'https://api.calendly.com/users/b00e78f0-287c-4471-93c9-c74e60b126b5';

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
}

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  return r.json().catch(() => []);
}

async function sbPost(table, body) {
  return fetch(`${SB_URL}/rest/v1/${table}`, { method: 'POST', headers: sbHeaders(), body: JSON.stringify(body) });
}

async function sbPatch(table, query, body) {
  return fetch(`${SB_URL}/rest/v1/${table}${query}`, { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(body) });
}

function getBookingStage(pipelineId) {
  return pipelineId === 'manuele' ? 'meeting_gepland' : 'appointment_booked';
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check
  const secret = process.env.CRON_SECRET;
  const provided = req.headers['x-sync-secret'] || req.query.secret;
  if (secret && provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const CAL_PAT = req.headers['x-calendly-token'] || process.env.CALENDLY_PAT;
  if (!CAL_PAT) return res.status(400).json({ error: 'Missing Calendly token' });

  const calH = { Authorization: `Bearer ${CAL_PAT}` };

  const minTime = new Date(Date.now() - 90 * 86400000).toISOString();
  let evData;
  try {
    const r = await fetch(
      `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(USER_URI)}&status=active&count=100&min_start_time=${minTime}`,
      { headers: calH }
    );
    evData = await r.json();
  } catch (err) {
    return res.status(500).json({ error: 'Calendly fetch failed', detail: err.message });
  }

  const events = evData.collection || [];
  const results = [];

  for (const ev of events) {
    const eventUri = ev.uri || null;
    const eventId = eventUri?.split('/').pop() || null;
    const startTime = ev.start_time || null;
    const endTime = ev.end_time || null;
    const startDate = startTime?.slice(0, 10) || null;
    const eventName = ev.name || 'Calendly Meeting';

    // Get invitees
    let invData;
    try {
      const r = await fetch(`${ev.uri}/invitees`, { headers: calH });
      invData = await r.json();
    } catch { continue; }

    const inv = (invData.collection || [])[0];
    if (!inv?.email) continue;

    // Deduplication
    const pmCheck = await sbGet(`prospect_meetings?calendly_event_id=eq.${encodeURIComponent(eventUri)}&select=id&limit=1`);
    if (Array.isArray(pmCheck) && pmCheck.length > 0) {
      results.push({ action: 'skip', email: inv.email, eventId });
      continue;
    }

    // Find prospect
    const byEmail = await sbGet(`prospects?email=eq.${encodeURIComponent(inv.email)}&select=id,stage,pipeline_id&limit=1`);
    const domain = inv.email.split('@')[1]?.split('.')[0] || inv.email;
    const pipelineId = byEmail?.[0]?.pipeline_id || 'meta_ads';
    const bookingStage = getBookingStage(pipelineId);
    const today = new Date().toISOString().slice(0, 10);
    let prospectId;

    if (Array.isArray(byEmail) && byEmail.length > 0) {
      prospectId = byEmail[0].id;
      await sbPatch('prospects', `?id=eq.${prospectId}`, {
        stage: bookingStage, appointment_date: startDate, calendly_event_id: eventUri,
        next_action_type: 'meeting', next_action_date: startDate,
        last_followup: today, last_followup_type: 'calendly_booked',
      });
      results.push({ action: 'updated', email: inv.email, eventId, stage: bookingStage });
    } else {
      prospectId = 'p' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      await sbPost('prospects', {
        id: prospectId, pipeline_id: 'meta_ads', stage: 'appointment_booked',
        contact: inv.name || null, company: domain, email: inv.email, lead_source: 'Calendly',
        appointment_date: startDate, calendly_event_id: eventUri,
        next_action_type: 'meeting', next_action_date: startDate,
        last_followup: today, last_followup_type: 'calendly_booked',
        created_at: inv.created_at || new Date().toISOString(),
      });
      results.push({ action: 'created', email: inv.email, eventId, stage: 'appointment_booked' });
    }

    // Insert meeting
    await sbPost('prospect_meetings', {
      prospect_id: prospectId, meeting_date: startTime, meeting_end: endTime,
      meeting_title: eventName, status: 'booked', calendly_event_id: eventUri,
    });
  }

  const summary = { total: events.length, processed: results.length, results };
  console.log('[sync-calendly]', JSON.stringify(summary));
  return res.status(200).json({ ok: true, ...summary });
}
