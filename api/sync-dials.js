/**
 * CloudTalk → Supabase dials sync (JWT analytics API)
 *
 * Fetches outbound call counts from CloudTalk per agent per day,
 * then upserts into the `dials` table.
 *
 * Cron: runs 4x daily at 08:00, 10:00, 14:00, 18:00 UTC
 * Manual: GET /api/sync-dials                              → syncs today
 *         GET /api/sync-dials?date=YYYY-MM-DD             → syncs specific day
 *         GET /api/sync-dials?date_from=…&date_to=…       → syncs date range
 *         GET /api/sync-dials?probe=true                  → dumps CloudTalk agent list
 */

const CT_KEY    = process.env.CLOUDTALK_API_KEY    || '';
const CT_SECRET = process.env.CLOUDTALK_API_SECRET || '';
const SB_URL    = 'https://database.infinite-scale.be';

// Map CloudTalk agent email (lowercase) → platform agent ID
const AGENT_MAP = {
  'senne.db@infinite-scale.be':  'a1',
  'john.vda@infinite-scale.be':  'a2',
  'kaiusr@proton.me':            'a3',
  'sanders.bram2003@gmail.com':  'a4',
  'ditske@infinite-scale.be':    'a5',
  'nick@infinite-scale.be':      'a6',
  'lotte@infinite-scale.be':     'a7',
  'shalom@infinite-scale.be':    'a8',
  'lothar_dg@hotmail.com':       'a9',
  'quinten@infinite-scale.be':   'a11',
};

async function getToken() {
  const auth = Buffer.from(`${CT_KEY}:${CT_SECRET}`).toString('base64');
  // Try api.cloudtalk.io first (new endpoint), fall back to dashboard
  for (const url of [
    'https://api.cloudtalk.io/api/auth/tokens/access',
    'https://dashboard.cloudtalk.io/api/auth/tokens/access',
  ]) {
    const r = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });
    const text = await r.text();
    if (text.trim().startsWith('<')) continue; // HTML = wrong endpoint
    const j = JSON.parse(text);
    const tok = j.accessToken || j.access_token || j.token || j.data?.accessToken;
    if (tok) return tok;
    if (!r.ok) throw new Error(`CT token ${r.status}: ${text.slice(0, 100)}`);
  }
  throw new Error('Could not obtain CloudTalk access token from any endpoint');
}

// Fetch agent list → [{id, email}]
async function getCtAgents(token) {
  const tryFetch = async (authHeader) => {
    const r = await fetch('https://api.cloudtalk.io/api/agents.json', {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const text = await r.text();
    if (text.trim().startsWith('<')) return null; // HTML = broken
    try { return JSON.parse(text); } catch { return null; }
  };

  let data = await tryFetch(`Bearer ${token}`);
  if (!data) {
    const basic = Buffer.from(`${CT_KEY}:${CT_SECRET}`).toString('base64');
    data = await tryFetch(`Basic ${basic}`);
  }
  if (!data) throw new Error('Could not fetch CT agent list');

  // Handle various response shapes
  const list = data?.responseData?.agents || data?.agents || data?.data || data || [];
  return Array.isArray(list) ? list : [];
}

// Fetch total outbound calls for a specific CT agent ID and date (YYYY-MM-DD)
// Pass dateFrom/dateTo as datetime strings to get hourly sub-ranges
async function fetchAgentCallCount(token, ctAgentId, dateFrom, dateTo) {
  const body = {
    filter: {
      datetime: { type: 'absolute', dateFrom, dateTo },
      groupIds: ['274186'],
      agentIds: [String(ctAgentId)],
      voiceAgentIds: [], externalNumber: '',
      contactNumbers: [], contactNames: [], contactName: '',
      tagIds: [], callRating: [],
      callDirection: ['outbound'],
      countryCodes: [], internalNumberIds: [], callId: '',
      groupMissedReason: [], agentMissedReason: [], callMissedReason: [],
      outOfOffice: false, talkingTime: { gte: 0, lte: 0 }, isResolved: null, anonymous: null,
    },
  };

  const r = await fetch('https://analytics-api.cloudtalk.io/api/metrics/call-counts/total-calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`analytics ${r.status} agent=${ctAgentId} ${dateFrom}`);
  const j = await r.json();
  return j?.data?.value ?? j?.value ?? j?.total ?? 0;
}

async function fetchAgentDayCount(token, ctAgentId, date) {
  return fetchAgentCallCount(token, ctAgentId, date, date);
}

// Belgian local hour offset (UTC+2 summer, UTC+1 winter)
function localOffset(date) {
  const m = new Date(date + 'T12:00:00Z').getUTCMonth() + 1;
  return m >= 4 && m <= 9 ? 2 : 1;
}

async function sbUpsertHourly(serviceKey, rows) {
  const r = await fetch(`${SB_URL}/rest/v1/dials_hourly?on_conflict=agent_id,dial_date,hour`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Supabase hourly upsert → ${r.status}: ${err.slice(0, 300)}`);
  }
}

async function sbUpsert(serviceKey, rows) {
  const r = await fetch(`${SB_URL}/rest/v1/dials?on_conflict=agent_id,dial_date`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Supabase upsert → ${r.status}: ${err.slice(0, 300)}`);
  }
}

function dateRange(from, to) {
  const dates = [];
  const cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  const debugToken = process.env.SYNC_DEBUG_TOKEN;
  if (cronSecret && auth !== `Bearer ${cronSecret}` && !(debugToken && auth === `Bearer ${debugToken}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  if (req.query.auth_test === 'true') {
    const basicAuth = Buffer.from(`${CT_KEY}:${CT_SECRET}`).toString('base64');
    const results = { key_len: CT_KEY.length };
    // agents with Basic
    const ra = await fetch('https://api.cloudtalk.io/api/agents.json', { headers: { Authorization: `Basic ${basicAuth}`, Accept: 'application/json' } });
    results.agents_basic = { status: ra.status, body: (await ra.text()).slice(0, 300) };
    // analytics without groupIds
    const rb = await fetch('https://analytics-api.cloudtalk.io/api/metrics/call-counts/total-calls', {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ filter: { datetime: { type: 'absolute', dateFrom: '2026-08-21', dateTo: '2026-08-21' }, callDirection: ['outbound'] } }),
    });
    results.analytics_no_group = { status: rb.status, body: (await rb.text()).slice(0, 300) };
    // Try calls.json
    const rc = await fetch('https://api.cloudtalk.io/api/calls.json?limit=2', { headers: { Authorization: `Basic ${basicAuth}`, Accept: 'application/json' } });
    results.calls = { status: rc.status, body: (await rc.text()).slice(0, 300) };
    // Try analytics with the KEY itself as Bearer (QS token format)
    const re = await fetch('https://analytics-api.cloudtalk.io/api/metrics/call-counts/total-calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CT_SECRET}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ filter: { datetime: { type: 'absolute', dateFrom: '2026-08-21', dateTo: '2026-08-21' }, callDirection: ['outbound'] } }),
    });
    results.analytics_bearer_secret = { status: re.status, body: (await re.text()).slice(0, 300) };
    // Try QS key as Bearer
    const rf = await fetch('https://analytics-api.cloudtalk.io/api/metrics/call-counts/total-calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CT_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ filter: { datetime: { type: 'absolute', dateFrom: '2026-08-21', dateTo: '2026-08-21' }, callDirection: ['outbound'] } }),
    });
    results.analytics_bearer_id = { status: rf.status, body: (await rf.text()).slice(0, 300) };
    return res.status(200).json(results);
  }

  try {
    const token = await getToken();
    const ctAgents = await getCtAgents(token);

    // Build email → cloudtalk id map
    const emailToCtId = {};
    for (const a of ctAgents) {
      const email = (a.email || a.username || '').toLowerCase();
      const id = a.id || a.agentId || a.agent_id;
      if (email && id) emailToCtId[email] = String(id);
    }

    // Probe mode: show agent list + mapping
    if (req.query.probe === 'true') {
      return res.status(200).json({ probe: true, ctAgents, emailToCtId });
    }

    // Build list of (platformAgentId, ctAgentId) pairs we can sync
    const agentPairs = Object.entries(AGENT_MAP)
      .map(([email, platId]) => ({ platId, ctId: emailToCtId[email], email }))
      .filter(p => p.ctId);

    if (agentPairs.length === 0) {
      return res.status(200).json({
        synced: 0,
        note: 'No CT agent IDs matched — use ?probe=true to inspect',
        emailToCtId,
      });
    }

    const today    = new Date().toISOString().slice(0, 10);
    const dateFrom = req.query.date_from || req.query.date || today;
    const dateTo   = req.query.date_to   || req.query.date || today;
    const dates    = dateRange(dateFrom, dateTo);

    const rows = [];
    const hourlyRows = [];
    const now = new Date();
    const nowUTCHour = now.getUTCHours();

    for (const date of dates) {
      const offset = localOffset(date);
      const isToday = date === now.toISOString().slice(0, 10);
      // Hours to sync: 9am–7pm local, but cap at current local hour for today
      const maxLocalHour = isToday ? Math.min(nowUTCHour + offset, 19) : 19;

      for (const { platId, ctId } of agentPairs) {
        const count = await fetchAgentDayCount(token, ctId, date);
        rows.push({ agent_id: platId, dial_date: date, count });

        // Hourly breakdown (9am–maxLocalHour local time)
        for (let h = 9; h <= maxLocalHour; h++) {
          const pad = n => String(n).padStart(2, '0');
          const utcH = (h - offset + 24) % 24;
          const dateFrom2 = `${date} ${pad(utcH)}:00:00`;
          const dateTo2   = `${date} ${pad(utcH)}:59:59`;
          const hCount = await fetchAgentCallCount(token, ctId, dateFrom2, dateTo2);
          hourlyRows.push({ agent_id: platId, dial_date: date, hour: h, count: hCount });
        }
      }
    }

    if (rows.length > 0) await sbUpsert(sbKey, rows);
    if (hourlyRows.length > 0) await sbUpsertHourly(sbKey, hourlyRows);

    console.log(`[sync-dials] Synced ${rows.length} daily + ${hourlyRows.length} hourly rows for ${dateFrom}→${dateTo}`);
    return res.status(200).json({ synced: rows.length, hourly: hourlyRows.length, date_from: dateFrom, date_to: dateTo });

  } catch (e) {
    console.error('[sync-dials] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
