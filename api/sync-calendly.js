/**
 * /api/sync-calendly — polls Calendly API for new/canceled meetings and updates the CRM.
 * Called by Vercel cron every 20 minutes during business hours.
 *
 * Flow:
 *   1. GET /scheduled_events?user=...&min_start_time=90daysago&max_start_time=30daysahead
 *   2. For each event, GET /scheduled_events/{uuid}/invitees
 *   3. Process each invitee: find/create prospect, set stage=appointment_booked, insert meeting
 *   4. Dedup via calendly_event_id on prospect_meetings table
 *
 * Env vars required:
 *   CALENDLY_PAT                 — Personal Access Token with scheduled_events:read + users:read
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
  if (!r.ok) { const e = await r.text().catch(() => ''); console.error(`[sync-cal] sbPost ${table} ${r.status}: ${e}`); return null; }
  const rows = await r.json().catch(() => []);
  return rows?.[0] || null;
}

async function calGet(url, pat) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    console.error(`[sync-cal] Calendly ${url} failed ${r.status}: ${err}`);
    return null;
  }
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

async function processInvitee(event, invitee) {
  const eventUri = event?.uri || '';
  const inviteeUri = invitee?.uri || '';
  const inviteeEmail = invitee?.email || '';
  const inviteeName = invitee?.name || '';
  const eventName = event?.name || '';
  const startTime = event?.start_time || null;
  const endTime = event?.end_time || null;
  const eventStatus = event?.status || 'active';
  const inviteeStatus = invitee?.status || 'active';

  if (!inviteeEmail && !inviteeName) return { skipped: true, reason: 'no contact info' };

  // Check if this specific invitee is already synced
  // We use the invitee URI (not the event URI) for deduplication since each invitee is unique
  if (inviteeUri) {
    const existing = await sbGet(`prospect_meetings?calendly_event_id=eq.${encodeURIComponent(inviteeUri)}&select=id,prospect_id,status`);
    if (existing?.[0]) {
      const meeting = existing[0];
      // Handle cancellation if status changed
      if ((eventStatus === 'canceled' || inviteeStatus === 'canceled') && meeting.status !== 'canceled') {
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
      return { skipped: true, reason: 'already synced', invitee: inviteeEmail };
    }
  }

  if (eventStatus === 'canceled' || inviteeStatus === 'canceled') {
    return { skipped: true, reason: 'canceled, no existing record' };
  }

  let prospect = await findProspect(inviteeEmail, inviteeName);

  if (!prospect) {
    const domain = inviteeEmail ? inviteeEmail.split('@')[1]?.split('.')[0] || '' : '';
    const newProspect = {
      pipeline_id: 'meta_ads',
      stage: 'appointment_booked',
      contact: inviteeName || null,
      email: inviteeEmail || null,
      company: domain || inviteeName || 'Onbekend',
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
    calendly_event_id: inviteeUri || eventUri,
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
    calendly_event_id: inviteeUri || eventUri || null,
  });

  console.log(`[sync-cal] Prospect ${prospect.id} → stage=${bookingStage}, meeting inserted (${inviteeName} ${meetingDateStr})`);
  return { synced: true, prospect_id: prospect.id, stage: bookingStage, name: inviteeName, date: meetingDateStr };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET/POST only' });

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pat = process.env.CALENDLY_PAT;
  if (!pat) return res.status(500).json({ error: 'CALENDLY_PAT not set' });

  // Date range: past 90 days to 30 days future (capture past meetings + upcoming)
  const lookbackDays = parseInt(req.query.lookback_days || '90', 10);
  const minStartTime = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const maxStartTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  console.log(`[sync-cal] Fetching events ${minStartTime} → ${maxStartTime}`);

  // Get all scheduled events in window
  const eventsUrl = `${CAL_BASE}/scheduled_events?user=${encodeURIComponent(CAL_USER_URI)}&min_start_time=${encodeURIComponent(minStartTime)}&max_start_time=${encodeURIComponent(maxStartTime)}&count=100&sort=start_time:desc`;
  const eventsResp = await calGet(eventsUrl, pat);

  if (!eventsResp?.collection) {
    return res.status(500).json({ error: 'Failed to fetch Calendly events', details: eventsResp });
  }

  const events = eventsResp.collection;
  console.log(`[sync-cal] Found ${events.length} scheduled events`);

  // Also get canceled events
  const canceledUrl = `${CAL_BASE}/scheduled_events?user=${encodeURIComponent(CAL_USER_URI)}&min_start_time=${encodeURIComponent(minStartTime)}&max_start_time=${encodeURIComponent(maxStartTime)}&count=100&sort=start_time:desc&status=canceled`;
  const canceledResp = await calGet(canceledUrl, pat);
  const canceledEvents = canceledResp?.collection || [];
  console.log(`[sync-cal] Found ${canceledEvents.length} canceled events`);

  const allEvents = [...events, ...canceledEvents];
  const results = [];

  for (const event of allEvents) {
    const eventUuid = event.uri.split('/').pop();
    const inviteesResp = await calGet(`${CAL_BASE}/scheduled_events/${eventUuid}/invitees?count=20`, pat);
    const invitees = inviteesResp?.collection || [];

    for (const invitee of invitees) {
      const result = await processInvitee(event, invitee);
      results.push(result);
    }
  }

  const synced = results.filter(r => r.synced).length;
  const updated = results.filter(r => r.updated).length;
  const skipped = results.filter(r => r.skipped).length;

  console.log(`[sync-cal] Done. synced=${synced} updated=${updated} skipped=${skipped}`);
  return res.status(200).json({ ok: true, events: allEvents.length, results: { synced, updated, skipped }, details: results });
}
