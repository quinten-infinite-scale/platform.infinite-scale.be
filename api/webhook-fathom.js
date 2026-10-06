/**
 * /api/webhook-fathom — Fathom webhook receiver
 *
 * Fires when a Fathom recording is transcribed.
 * Finds the matching prospect by attendee email, runs CLOSER analysis via Claude,
 * updates prospect_meetings with score + type, and auto-advances the prospect stage.
 *
 * Fathom webhook setup: Fathom → Settings → Webhooks → Add endpoint
 *   URL: https://platform.infinite-scale.be/api/webhook-fathom
 *   Events: recording_transcribed (or equivalent)
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FATHOM_WEBHOOK_SECRET (optional, for signature verification)
 */

export const config = { api: { bodyParser: true } };

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
  const r = await fetch(`${SB_URL}/rest/v1/${table}${query}`, { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(body) });
  if (!r.ok) { const err = await r.text().catch(() => ''); console.error(`[fathom] sbPatch ${table}${query} failed ${r.status}: ${err}`); }
  return r;
}

// Parse Fathom webhook payload — flexible across payload shapes
function parseFathomPayload(body) {
  // Fathom sends different shapes depending on version; normalise here
  const data = body.data || body.payload || body;
  const meeting = data.meeting || data.call || data.session || data;
  const attendees = data.attendees || data.participants || meeting.attendees || meeting.participants || [];
  const transcript = data.transcript || data.transcription || meeting.transcript || '';
  const summary = data.summary || data.ai_summary || meeting.summary || '';
  const title = meeting.title || meeting.name || data.title || '';
  const startTime = meeting.start_time || meeting.started_at || meeting.date || data.start_time || null;
  const endTime = meeting.end_time || meeting.ended_at || data.end_time || null;

  // Extract external attendee email (not the organiser / IS account)
  const IS_DOMAINS = ['infinite-scale.be'];
  const externalAttendees = attendees.filter(a => {
    const email = (a.email || a.emailAddress || '').toLowerCase();
    return email && !IS_DOMAINS.some(d => email.endsWith('@' + d));
  });
  const primaryEmail = externalAttendees[0]?.email || externalAttendees[0]?.emailAddress || '';
  const primaryName = externalAttendees[0]?.name || externalAttendees[0]?.displayName || '';

  return { title, startTime, endTime, transcript, summary, primaryEmail, primaryName, attendees };
}

// Find prospect by email, then by name
async function findProspect(email, name) {
  if (email) {
    const rows = await sbGet(`prospects?email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=1`);
    if (rows?.[0]) return rows[0];
  }
  if (name) {
    const since = new Date(Date.now() - 180 * 86400000).toISOString();
    const rows = await sbGet(`prospects?contact=ilike.${encodeURIComponent(name)}&created_at=gt.${since}&order=created_at.desc&limit=1`);
    if (rows?.[0]) return rows[0];
  }
  return null;
}

// Count completed meetings for stage progression
async function countCompletedMeetings(prospectId) {
  const rows = await sbGet(`prospect_meetings?prospect_id=eq.${prospectId}&status=eq.completed&select=id`);
  return Array.isArray(rows) ? rows.length : 0;
}

// Determine stage after a completed call
function getCompletedStage(pipelineId, completedCount) {
  const metaStages = ['call_1', 'call_2', 'call_3', 'call_4', 'long_term_follow_up'];
  const manueleStages = ['first_call', 'second_call', 'follow_up_call', 'herplan_call', 'lange_termijn'];
  const stages = pipelineId === 'manuele' ? manueleStages : metaStages;
  return stages[Math.min(completedCount - 1, stages.length - 1)] || stages[stages.length - 1];
}

// Meeting type → stage override
function getMeetingTypeStage(pipelineId, meetingType) {
  if (meetingType === 'kick_off') return 'gewonnen';
  if (meetingType === 'no_show') return pipelineId === 'manuele' ? 'herplan_call' : 'herplan_call';
  if (meetingType === 'briefing') return pipelineId === 'manuele' ? 'second_call' : 'send_info';
  return null; // use count-based stage
}

// Run CLOSER analysis + meeting type classification via Claude
async function analyseTranscript(transcript, meetingTitle) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const prompt = `Je bent een sales coach die verkoopgesprekken analyseert voor Infinite Scale, een Belgisch appointment-setting bureau.

Analyseer het volgende transcript en geef een volledige analyse in het Nederlands (Vlaams).

STAP 1 — Bepaal het meeting type. Kies één van:
- "sales_call": een sales gesprek of demo waarbij er een pitch of closing poging was
- "kick_off": een kick-off meeting met een betalende klant (project gestart)
- "briefing": een inhoudelijke briefing of strategy call
- "follow_up": een kort follow-up gesprek zonder echte closing poging
- "no_show": de prospect was niet aanwezig, gesprek was te kort om te analyseren (<5 min)

STAP 2 — CLOSER analyse (enkel als het een sales_call of follow_up is):
C - Clarify: werd de reden van het gesprek helder gesteld? Werden de doelen verduidelijkt?
L - Label: werd het probleem van de prospect gelabeld? Voelde de prospect zich begrepen?
O - Overview/Consequence: werden de gevolgen van niet-handelen duidelijk gemaakt?
S - Sell the vacation: werd de gewenste toekomststaat verkocht (niet het product)?
E - Explain away objections: werden bezwaren proactief weggenomen?
R - Reinforce: werd de beslissing versterkt? Werden next steps duidelijk afgesproken?

Voor elke CLOSER-sectie: wat_er_gebeurde, wat_beter_kon, score /10.

Eindig met: biggest_growth_point (1 zin), score_total (gemiddelde /10).

STAP 3 — Identificeer de volgende actie:
- next_action_type: één van "second_call", "follow_up_call", "send_info", "kick_off_gepland", "herplan_call", "niet_gekwalificeerd", "geen_actie"
- next_action_date: datum indien vermeld (YYYY-MM-DD), anders null
- next_action_notes: 1 korte zin

Geef ALLEEN geldig JSON terug zonder markdown of uitleg:
{"meeting_type":"sales_call","c":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":7},"l":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":6},"o":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":5},"s":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":7},"e":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":6},"r":{"wat_er_gebeurde":"...","wat_beter_kon":"...","score":8},"biggest_growth_point":"...","score_total":6.5,"deal_facts":{"prospect":"...","pricing":"...","terms":"...","next_steps":"..."},"next_action_type":"second_call","next_action_date":null,"next_action_notes":"..."}

MEETING TITEL: ${meetingTitle || 'Onbekend'}

TRANSCRIPT:
${transcript.slice(0, 12000)}`; // cap at ~12k chars to stay within Claude context

  const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
  });
  const aiData = await aiResp.json();
  if (!aiResp.ok) throw new Error('Claude API error: ' + JSON.stringify(aiData).slice(0, 200));

  const raw = aiData.content?.[0]?.text || '';
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude returned no JSON');
  const cleaned = m[0].replace(/[\x00-\x1F\x7F]/g, c => (c === '\n' || c === '\r' || c === '\t') ? ' ' : '');
  return JSON.parse(cleaned);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body || {};
  console.log('[fathom] webhook received, event:', body.event || body.type || '?');

  const { title, startTime, endTime, transcript, summary, primaryEmail, primaryName } = parseFathomPayload(body);

  if (!transcript || transcript.trim().length < 100) {
    console.warn('[fathom] No usable transcript in payload');
    return res.status(200).json({ ok: true, skipped: 'no_transcript' });
  }
  if (!primaryEmail && !primaryName) {
    console.warn('[fathom] No external attendee found in payload');
    return res.status(200).json({ ok: true, skipped: 'no_attendee' });
  }

  const prospect = await findProspect(primaryEmail, primaryName);
  if (!prospect) {
    console.warn(`[fathom] No prospect found for email=${primaryEmail} name=${primaryName}`);
    return res.status(200).json({ ok: true, skipped: 'no_prospect_match', email: primaryEmail });
  }

  console.log(`[fathom] Matched prospect ${prospect.id} (${prospect.company}), analysing...`);

  let analysis;
  try {
    analysis = await analyseTranscript(transcript, title);
  } catch (err) {
    console.error('[fathom] Claude analysis failed:', err.message);
    return res.status(500).json({ error: 'analysis_failed', detail: err.message });
  }

  const meetingType = analysis.meeting_type || 'sales_call';
  const scoreTotal = analysis.score_total || null;
  const pipelineId = prospect.pipeline_id || 'meta_ads';

  // Count completed meetings BEFORE this one to determine new stage
  const priorCompletedCount = await countCompletedMeetings(prospect.id);
  const newCompletedCount = priorCompletedCount + 1;

  // Determine new stage: type override takes priority, otherwise count-based
  const typeStage = getMeetingTypeStage(pipelineId, meetingType);
  const countStage = getCompletedStage(pipelineId, newCompletedCount);
  const newStage = typeStage || countStage;

  const now = new Date().toISOString();

  // Find matching prospect_meetings row (booked record from Calendly) by date proximity
  // or create a new completed row if Calendly didn't create one
  let existingMeeting = null;
  if (startTime) {
    const d = new Date(startTime);
    const from = new Date(d.getTime() - 1800000).toISOString(); // ±30min window
    const to   = new Date(d.getTime() + 1800000).toISOString();
    const rows = await sbGet(
      `prospect_meetings?prospect_id=eq.${prospect.id}&meeting_date=gte.${from}&meeting_date=lte.${to}&status=neq.canceled&limit=1`
    );
    existingMeeting = rows?.[0] || null;
  }

  const meetingPayload = {
    status: meetingType === 'no_show' ? 'no_show' : 'completed',
    meeting_type: meetingType,
    meeting_title: title || existingMeeting?.meeting_title || null,
    meeting_date: startTime || existingMeeting?.meeting_date || null,
    meeting_end: endTime || existingMeeting?.meeting_end || null,
    closer_score: scoreTotal,
    closer_analysis: { ...analysis, call_date: now },
    fathom_transcript: transcript.slice(0, 50000), // cap stored transcript
    fathom_summary: summary || null,
    next_action_type: analysis.next_action_type || null,
    next_action_date: analysis.next_action_date || null,
    next_action_notes: analysis.next_action_notes || null,
    updated_at: now,
  };

  if (existingMeeting) {
    await sbPatch('prospect_meetings', `?id=eq.${existingMeeting.id}`, meetingPayload);
    console.log(`[fathom] Updated existing meeting ${existingMeeting.id}`);
  } else {
    // No prior Calendly booking — insert new completed record
    await fetch(`${SB_URL}/rest/v1/prospect_meetings`, {
      method: 'POST', headers: sbHeaders(),
      body: JSON.stringify({ ...meetingPayload, prospect_id: prospect.id }),
    });
    console.log(`[fathom] Inserted new completed meeting for prospect ${prospect.id}`);
  }

  // Update prospect: new stage + CLOSER score + fathom summary
  const prospectUpdates = {
    stage: newStage,
    closer_score_total: scoreTotal,
    closer_analysis: { ...analysis, call_date: now },
    fathom_summary: summary || null,
    last_call_at: now,
    last_followup: now.slice(0, 10),
    last_followup_type: 'fathom_completed',
    ...(analysis.next_action_type ? { next_action_type: analysis.next_action_type } : {}),
    ...(analysis.next_action_date ? { next_action_date: analysis.next_action_date } : {}),
    ...(analysis.next_action_notes ? { next_action_notes: analysis.next_action_notes } : {}),
    // If kick-off → mark as won
    ...(meetingType === 'kick_off' ? { status: 'gewonnen' } : {}),
  };

  await sbPatch('prospects', `?id=eq.${prospect.id}`, prospectUpdates);

  console.log(`[fathom] prospect ${prospect.id} → stage=${newStage}, type=${meetingType}, score=${scoreTotal}`);
  return res.status(200).json({
    ok: true,
    prospect_id: prospect.id,
    meeting_type: meetingType,
    new_stage: newStage,
    score: scoreTotal,
  });
}
