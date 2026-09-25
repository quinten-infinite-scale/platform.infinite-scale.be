/**
 * /api/webhook-calendly — Calendly webhook receiver
 *
 * Events handled:
 *   invitee.created    → find prospect by email → move to meeting_gepland stage, store event details
 *   invitee.canceled   → find prospect → add cancellation note, optionally revert stage
 *
 * Note: Calendly reschedules arrive as a cancel + a new create, so they are handled
 * automatically by the two events above.
 *
 * Env vars required:
 *   CALENDLY_WEBHOOK_SIGNING_KEY  — from Calendly → Integrations → Webhooks
 *   SUPABASE_SERVICE_ROLE_KEY     — already present
 */

import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
}
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) return [];
  return r.json().catch(() => []);
}
async function sbPatch(table, query, body) {
  return fetch(`${SB_URL}/rest/v1/${table}${query}`, { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(body) });
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, header) {
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) return true; // allow unsigned if key not configured yet (setup phase)
  if (!header) return false;
  // Calendly signature format: "t=<timestamp>,v1=<hmac>"
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const expected = crypto.createHmac('sha256', signingKey).update(`${timestamp}.${rawBody}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex')); } catch { return false; }
}

async function findProspect(email, name) {
  if (email) {
    const rows = await sbGet(`prospects?email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=1`);
    if (rows?.[0]) return rows[0];
  }
  // Fallback: match by contact name (case-insensitive, last 90 days)
  if (name) {
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const rows = await sbGet(`prospects?contact=ilike.${encodeURIComponent(name)}&created_at=gt.${since}&order=created_at.desc&limit=1`);
    if (rows?.[0]) return rows[0];
  }
  return null;
}

async function getMeetingStage(pipelineId) {
  // Hardcoded per pipeline first, then fall back to regex scan
  const hardcoded = { meta_ads: 'appointment_booked', manuele: 'meeting_gepland' };
  if (hardcoded[pipelineId]) return hardcoded[pipelineId];
  try {
    const rows = await sbGet('platform_settings?key=eq.prospect_pipelines&select=value');
    const pipelines = JSON.parse(rows?.[0]?.value || '[]');
    const pipeline = pipelines.find(p => p.id === pipelineId) || pipelines[0];
    if (!pipeline) return null;
    const stageIds = (pipeline.stages || []).map(s => s.id);
    return stageIds.find(id => /meeting|gepland|booked|geplande/i.test(id)) || null;
  } catch { return null; }
}

async function createProspect(data) {
  const r = await fetch(`${SB_URL}/rest/v1/prospects`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows?.[0] || null;
}

export default async function handler(req, res) {
  const rawBody = await getRawBody(req);

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sig = req.headers['calendly-webhook-signature'] || '';
  if (!verifySignature(rawBody, sig)) {
    console.warn('[calendly] Signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const event = payload.event; // "invitee.created" | "invitee.canceled"
  const p = payload.payload || {};
  const invitee = p.invitee || {};
  const scheduledEvent = p.event || {};

  const inviteeEmail = invitee.email || '';
  const inviteeName = invitee.name || '';
  const eventName = p.event_type?.name || scheduledEvent.name || '';
  const startTime = scheduledEvent.start_time || null;
  const endTime = scheduledEvent.end_time || null;
  const eventUri = scheduledEvent.uri || '';
  const cancelReason = p.cancellation?.reason || '';
  const isRescheduled = p.cancellation?.canceled_by === 'invitee' && !!p.new_invitee;

  console.log(`[calendly] ${event} — ${inviteeName} <${inviteeEmail}> — ${eventName}`);

  let prospect = await findProspect(inviteeEmail, inviteeName);

  if (!prospect && event === 'invitee.created') {
    // Auto-create a new prospect in the meta_ads pipeline
    const nameParts = inviteeName.trim().split(' ');
    const newProspect = {
      pipeline_id: 'meta_ads',
      stage: 'appointment_booked',
      contact: inviteeName || null,
      email: inviteeEmail || null,
      company: inviteeEmail ? inviteeEmail.split('@')[1]?.split('.')[0] || inviteeName : inviteeName,
      lead_source: 'Meta Ads',
      created_at: new Date().toISOString(),
    };
    prospect = await createProspect(newProspect);
    if (prospect) {
      console.log(`[calendly] Auto-created prospect ${prospect.id} for ${inviteeName} <${inviteeEmail}>`);
    } else {
      console.warn(`[calendly] Failed to auto-create prospect for ${inviteeName} <${inviteeEmail}>`);
      return res.status(200).json({ ok: true, matched: false });
    }
  }

  if (!prospect) {
    console.warn(`[calendly] No prospect found for email=${inviteeEmail} name=${inviteeName}`);
    return res.status(200).json({ ok: true, matched: false });
  }

  const pipelineId = prospect.pipeline_id || 'meta_ads';

  if (event === 'invitee.created') {
    // Find the right "meeting booked" stage for this pipeline
    const meetingStage = await getMeetingStage(pipelineId);

    const updates = {
      ...(meetingStage ? { stage: meetingStage } : {}),
      calendly_event_uri: eventUri,
      calendly_event_start: startTime,
      calendly_event_name: eventName,
      next_action_type: 'meeting',
      next_action_date: startTime ? startTime.slice(0, 10) : null,
      next_action_notes: `Meeting gepland: ${eventName}${startTime ? ' op ' + new Date(startTime).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }) : ''}`,
      last_followup: new Date().toISOString().slice(0, 10),
      last_followup_type: 'calendly_booked',
    };

    await sbPatch('prospects', `?id=eq.${prospect.id}`, updates);
    console.log(`[calendly] Updated prospect ${prospect.id} (${prospect.company}) → stage=${meetingStage || 'unchanged'}, meeting=${startTime}`);
    return res.status(200).json({ ok: true, matched: true, prospect_id: prospect.id, stage: meetingStage });
  }

  if (event === 'invitee.canceled') {
    const note = isRescheduled
      ? `Meeting herpland door klant`
      : `Meeting geannuleerd${cancelReason ? ': ' + cancelReason : ''}`;

    const updates = {
      calendly_event_uri: null,
      calendly_event_start: null,
      next_action_type: isRescheduled ? 'herplan_call' : 'follow_up_call',
      next_action_date: new Date().toISOString().slice(0, 10),
      next_action_notes: note,
      last_followup: new Date().toISOString().slice(0, 10),
      last_followup_type: isRescheduled ? 'calendly_rescheduled' : 'calendly_canceled',
    };

    await sbPatch('prospects', `?id=eq.${prospect.id}`, updates);
    console.log(`[calendly] Prospect ${prospect.id} meeting ${isRescheduled ? 'rescheduled' : 'canceled'}`);
    return res.status(200).json({ ok: true, matched: true, prospect_id: prospect.id, canceled: true });
  }

  return res.status(200).json({ ok: true, event, handled: false });
}
