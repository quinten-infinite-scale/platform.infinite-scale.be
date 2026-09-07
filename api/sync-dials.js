/**
 * CloudTalk → Supabase dials sync (calls/index.json API, Basic auth)
 *
 * Fetches outbound call counts from CloudTalk per agent per day,
 * then upserts into the `dials` and `dials_hourly` tables.
 *
 * Auth: HTTP Basic with CLOUDTALK_API_KEY:CLOUDTALK_API_SECRET
 * Agents: my.cloudtalk.io/api/agents/index.json
 * Calls:  my.cloudtalk.io/api/calls/index.json?type=outgoing&user_id=…&date_from=…&date_to=…
 *
 * Cron: runs multiple times daily
 * Manual: GET /api/sync-dials                              → syncs today
 *         GET /api/sync-dials?date=YYYY-MM-DD             → syncs specific day
 *         GET /api/sync-dials?date_from=…&date_to=…       → syncs date range
 *         GET /api/sync-dials?probe=true                  → dumps CloudTalk agent list
 */

const CT_KEY    = process.env.CLOUDTALK_API_KEY    || '';
const CT_SECRET = process.env.CLOUDTALK_API_SECRET || '';
const SB_URL    = 'https://database.infinite-scale.be';

// Map CloudTalk agent email (lowercase) → platform agent ID
// Updated 2026-09-01: CloudTalk agents were migrated to generic callagent accounts
const AGENT_MAP = {
  'senne.db@infinite-scale.be':      'a1',   // Senne De Braekeler (confirmed by call volume)
  'quinten@infinite-scale.be':       'a11',  // Quinten Eeckhoudt (confirmed)
  'callagent@infinite-scale.be':     'a4',   // Bram Sanders (confirmed by Aug volume match)
  'callagent1@infinite-scale.be':    'a9',   // Lothar (confirmed by Aug volume match)
  'callagent2@infinite-scale.be':    'a12',  // Rick Hoekstra (confirmed by exact match)
  'callagent4@infinite-scale.be':    'a15',  // Rabih Ibrahim
  'callagent5@infinite-scale.be':    'a16',  // Romy Zwiers
  'callagent7@infinite-scale.be':    'a14',  // Jimmy Verschut (confirmed by exact match)
};

function basicAuth() {
  return 'Basic ' + Buffer.from(`${CT_KEY}:${CT_SECRET}`).toString('base64');
}

// Fetch agent list → [{id, email}]
async function getCtAgents() {
  let page = 1;
  const agents = [];
  while (true) {
    const r = await fetch(`https://my.cloudtalk.io/api/agents/index.json?limit=100&page=${page}`, {
      headers: { Authorization: basicAuth(), Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`CT agents ${r.status}: ${(await r.text()).slice(0, 100)}`);
    const j = await r.json();
    const data = j?.responseData?.data || [];
    for (const item of data) {
      const a = item.Agent || item;
      if (a.id && a.email) agents.push({ id: String(a.id), email: a.email.toLowerCase() });
    }
    if (agents.length >= (j?.responseData?.itemsCount || 0) || data.length === 0) break;
    page++;
  }
  return agents;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Count outbound calls for a specific CT agent ID in a date-time range
// date_from / date_to: "YYYY-MM-DD HH:MM:SS"
async function fetchCallCount(ctAgentId, dateFrom, dateTo) {
  const params = new URLSearchParams({
    limit: '1',
    type: 'outgoing',
    user_id: ctAgentId,
    date_from: dateFrom,
    date_to: dateTo,
  });
  const r = await fetch(`https://my.cloudtalk.io/api/calls/index.json?${params}`, {
    headers: { Authorization: basicAuth(), Accept: 'application/json' },
  });
  if (r.status === 429) {
    await sleep(2000);
    return fetchCallCount(ctAgentId, dateFrom, dateTo); // retry once
  }
  if (!r.ok) throw new Error(`CT calls ${r.status} agent=${ctAgentId} ${dateFrom}: ${(await r.text()).slice(0, 100)}`);
  const j = await r.json();
  await sleep(300); // respect rate limits
  return j?.responseData?.itemsCount ?? 0;
}

async function fetchAgentDayCount(ctAgentId, date) {
  return fetchCallCount(ctAgentId, `${date} 00:00:00`, `${date} 23:59:59`);
}

async function fetchAgentHourCount(ctAgentId, date, utcHour) {
  const pad = n => String(n).padStart(2, '0');
  return fetchCallCount(ctAgentId, `${date} ${pad(utcHour)}:00:00`, `${date} ${pad(utcHour)}:59:59`);
}

function dateRange(from, to) {
  const dates = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
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

  try {
    const ctAgents = await getCtAgents();

    // Build email → cloudtalk id map
    const emailToCtId = {};
    for (const a of ctAgents) {
      emailToCtId[a.email] = a.id;
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

    const skipHourly = req.query.no_hourly === 'true';
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
        const count = await fetchAgentDayCount(ctId, date);
        rows.push({ agent_id: platId, dial_date: date, count });

        if (!skipHourly) {
          // Hourly breakdown (9am–maxLocalHour local time)
          for (let h = 9; h <= maxLocalHour; h++) {
            const utcH = (h - offset + 24) % 24;
            const hCount = await fetchAgentHourCount(ctId, date, utcH);
            hourlyRows.push({ agent_id: platId, dial_date: date, hour: h, count: hCount });
          }
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
