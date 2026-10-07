/**
 * /api/sync-calendly — polls Calendly API for new/canceled meetings and updates the CRM.
 * Called by Vercel cron every 20 minutes during business hours.
 *
 * Env vars required:
 *   CALENDLY_PAT                 — Personal Access Token with webhooks:read, scheduled_events:read, users:read, organizations:read
 *   SUPABASE_SERVICE_ROLE_KEY    — already present
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const CAL_BASE = 'https://api.calendly.com';
const CAL_USER_URI = 'https://api.calendly.com/users/b00e78f0-287c-4471-93c9-c74e60b126b5';
const CAL_ORG_URI = 'https://api.calendly.com/organizations/0027fa68-030f-4f71-9126-c5fffe4a91dc';

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
  const r = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(body),
  });
  return r;
}

async function sbPost(table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST', headers: sbHeaders(), body: JSON.stringify(body),
  });
  const rows = await r.json().catch(() => []);
  return rows?.[0] || null;
}

async function calGet(path, pat) {
  const r = await fetch(`${CAL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
  });
  if (!r.ok) { const err = await r.text().catch(() => ''); console.error(`[sync-cal] Calendly ${path} failed ${r.status}: ${err}`); return null; }
  return r.json().catch(() => null);
}

async function findProspect(email, name) {
  if (email) {
    const rows = await sbGet(`prospects?email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=1`);
    if (rows?.[0]) return rows[0];
  }
  if (name) {
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const rows = await sbGet(`prospects?contact=ilike.${encodeURIComponent(name)}&created_at=gt.${since}&order=created_at.desc&limit=1`);
    if (rows?.[0]) return rows[0];
  }
  return null;
}

function getBookingStage(pipelineId) {
  const map = { meta_ads: 'appointment_booked', manuele: 'meeting_gepland' };
  return map[pipelineId] || 'appointment_booked';
}

async function processScheduledEvent(event, inviteeData, pat) {
  const inviteeEmail = inviteeData?.email || '';
  const inviteeName = inviteeData?.name || '';
  const eventName = event?.name || '';
  const startTime = event?.start_time || null;
  const endTime = event?.end_time || null;
  const eventUri = event?.uri || '';
  const eventStatus = event?.status || 'active';

  if (!inviteeEmail && !inviteeName) return { skipped: true, reason: 'no contact info' };

  // Check if we already have this event in prospect_meetings
  if (eventUri) {
    const existing = await sbGet(`prospect_meetings?calendly_event_id=eq.${encodeURIComponent(eventUri)}&select=id,prospect_id,status`);
    if (existing?.[0]) {
      const meeting = existing[0];
      // If event was canceled and meeting is not yet marked canceled, update it
      if (eventStatus === 'canceled' && meeting.status !== 'canceled') {
        await sbPatch('prospect_meetings', `?id=eq.${meeting.id}`, { status: 'canceled' });
        await sbPatch('prospects', `?id=eq.${meeting.prospect_id}`, {
          calendly_event_id: null,
          appointment_date: null,
          next_action_type: 'follow_up_call',
          next_action_date: new Date().toISOString().slice(0, 10),
          next_action_notes: 'Meeting geannuleerd via Calendly',
          last_followup: new Date().toISOString().slice(0, 10),
          last_followup_type: 'calendly_canceled',
        });
        return { updated: 'canceled', prospect_id: meeting.prospect_id };
      }
      return { skipped: true, reason: 'already synced', event_uri: eventUri };
    }
  }

  if (eventStatus === 'canceled') return { skipped: true, reason: 'canceled with no existing meeting record' };

  let prospect = await findProspect(inviteeEmail, inviteeName);

  if (!prospect) {
    const newProspect = {
      pipeline_id: 'meta_ads',
      stage: 'appointment_booked',
      contact: inviteeName || null,
      email: inviteeEmail || null,
      company: inviteeEmail ? inviteeEmail.split('@')[1]?.split('.')[0] || inviteeName : inviteeName,
      lead_source: 'Calendly',
      created_at: new Date().toISOString(),
    };
    prospect = await sbPost('prospects', newProspect);
    if (!prospect) return { skipped: true, reason: 'failed to create prospect' };
    console.log(`[sync-cal] Created prospect for ${inviteeName} <${inviteeEmail}>`);
  }

  const pipelineId = prospect.pipeline_id || 'meta_ads';
  const bookingStage = getBookingStage(pipelineId);
  const meetingDateStr = startTime ? startTime.slice(0, 10) : null;

  await sbPatch('prospects', `?id=eq.${prospect.id}`, {
    stage: bookingStage,
    calendly_event_id: eventUri,
    appointment_date: meetingDateStr,
    next_action_type: 'meeting',
    next_action_date: meetingDateStr,
    next_action_notes: `Meeting gepland: ${eventName}${startTime ? ' op ' + new Date(startTime).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }) : ''}`,
    last_followup: new Date().toISOString().slice(0, 10),
    last_followup_type: 'calendly_booked',
  });

  await sbPost('prospect_meetings', {
    prospect_id: prospect.id,
    meeting_date: startTime || null,
    meeting_end: endTime || null,
    meeting_title: eventName || null,
    status: 'booked',
    calendly_event_id: eventUri || null,
  });

  console.log(`[sync-cal] Prospect ${prospect.id} → stage=${bookingStage}, meeting inserted`);
  return { synced: true, prospect_id: prospect.id, stage: bookingStage };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET/POST only' });

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  if (cronSecret && req.method === 'GET' && authHeader !== `Bearer ${cronSecret}`) {
    // Cron jobs hit with authorization header, manual test via GET without it is fine for debugging
    // but only if this is not from Vercel cron (Vercel adds x-vercel-cron header)
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    if (isVercelCron && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const pat = process.env.CALENDLY_PAT;
  if (!pat) return res.status(500).json({ error: 'CALENDLY_PAT not set' });

  // Look back 30 minutes (covers the cron interval + buffer)
  const lookbackMinutes = parseInt(req.query.lookback || '30', 10);
  const minCreated = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();

  console.log(`[sync-cal] Polling Calendly events since ${minCreated}`);

  // Get all scheduled events (active + canceled) within lookback window
  const params = new URLSearchParams({
    organization: CAL_ORG_URI,
    user: CAL_USER_URI,
    min_start_time: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // look back 90 days for meeting dates
    count: '100',
    sort: 'start_time:desc',
  });

  // Get recently created invitees (more useful than events because we need contact info)
  const inviteesResp = await calGet(`/scheduled_events/invitees?organization=${encodeURIComponent(CAL_ORG_URI)}&count=100&sort=created_at:desc`, pat);

  if (!inviteesResp?.collection) {
    return res.status(500).json({ error: 'Failed to fetch Calendly invitees', details: inviteesResp });
  }

  const invitees = inviteesResp.collection;
  console.log(`[sync-cal] Found ${invitees.length} recent invitees`);

  // Filter to those created in the lookback window
  const recentInvitees = invitees.filter(inv => {
    const created = new Date(inv.created_at);
    const cutoff = new Date(minCreated);
    return created >= cutoff;
  });

  console.log(`[sync-cal] ${recentInvitees.length} invitees since ${minCreated}`);

  const results = [];
  for (const invitee of recentInvitees) {
    const eventUri = invitee.event;
    const eventResp = await calGet(`/scheduled_events/${eventUri.split('/').pop()}`, pat);
    const event = eventResp?.resource || {};

    const result = await processScheduledEvent(event, invitee, pat);
    results.push({ invitee: invitee.email || invitee.name, ...result });
  }

  // Also check for any prospects with appointment_booked that have calendly_event_id
  // to see if they were canceled in Calendly
  // (handled on next run when the invitee's event shows as canceled)

  console.log(`[sync-cal] Done. Processed ${results.length} invitees.`);
  return res.status(200).json({ ok: true, processed: results.length, results, polled_since: minCreated });
}
