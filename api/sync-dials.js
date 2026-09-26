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

// Admin/internal emails that are always mapped (not in cloudtalk_accounts UI)
const ADMIN_EMAIL_MAP = {
  'senne.db@infinite-scale.be': 'a1',
  'quinten@infinite-scale.be':  'a11',
};

// CloudTalk account number → CT login email
// 1 → callagent@, 2 → callagent1@, 3 → callagent2@, N≥4 → callagentN@
function ctEmailForAccount(n) {
  const N = Number(n);
  if (N === 1) return 'callagent@infinite-scale.be';
  if (N === 2) return 'callagent1@infinite-scale.be';
  if (N === 3) return 'callagent2@infinite-scale.be';
  return `callagent${N}@infinite-scale.be`;
}

// Build dynamic agent map from platform_settings.cloudtalk_accounts + agents table
async function buildAgentMap(sbKey) {
  const [settingsRes, agentsRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/platform_settings?key=eq.cloudtalk_accounts&select=value`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    }),
    fetch(`${SB_URL}/rest/v1/agents?select=id,name`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    }),
  ]);

  const settings = await settingsRes.json();
  const agents   = await agentsRes.json();

  let ctAccounts = {};
  if (settings?.[0]?.value) {
    ctAccounts = typeof settings[0].value === 'string'
      ? JSON.parse(settings[0].value)
      : settings[0].value;
  }

  const nameToId = {};
  for (const a of (agents || [])) {
    if (a.name) nameToId[a.name.toLowerCase().trim()] = a.id;
  }

  const map = { ...ADMIN_EMAIL_MAP };
  for (const [accountNum, names] of Object.entries(ctAccounts)) {
    const namesArr = Array.isArray(names) ? names : (names ? [String(names)] : []);
    const agentName = namesArr[0]; // one agent per account
    if (!agentName) continue;
    const agentId = nameToId[agentName.toLowerCase().trim()];
    if (!agentId) continue;
    map[ctEmailForAccount(accountNum)] = agentId;
  }

  return map;
}

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

async function verifyAdminJwt(token) {
  if (!token) return false;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return false;
  // Verify token and get user id
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + token },
  }).catch(() => null);
  if (!r || !r.ok) return false;
  const user = await r.json().catch(() => null);
  if (!user || !user.id) return false;
  // Check profiles table for admin role
  const p = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
    headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey },
  }).catch(() => null);
  if (!p || !p.ok) return false;
  const profiles = await p.json().catch(() => []);
  return Array.isArray(profiles) && profiles.length > 0 && profiles[0].role === 'admin';
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // Allow CORS for browser-triggered syncs from the platform
  res.setHeader('Access-Control-Allow-Origin', 'https://platform.infinite-scale.be');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const cronSecret = process.env.CRON_SECRET;
  const debugToken = process.env.SYNC_DEBUG_TOKEN;

  const isValidCron = cronSecret && auth === `Bearer ${cronSecret}`;
  const isValidDebug = debugToken && auth === `Bearer ${debugToken}`;
  const isValidAdmin = !isValidCron && !isValidDebug ? await verifyAdminJwt(token) : false;

  if (cronSecret && !isValidCron && !isValidDebug && !isValidAdmin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  try {
    // Reattribute action: move all dials from one agent_id to another instantly
    if (req.query.action === 'reattribute') {
      const fromAgent = req.query.from;
      const toAgent   = req.query.to;
      if (!fromAgent || !toAgent) return res.status(400).json({ error: 'Missing from/to params' });
      // Only reattribute from today onwards — historical dials stay with the old agent
      const fromDate = req.query.from_date || new Date().toISOString().slice(0, 10);
      await Promise.all([
        fetch(`${SB_URL}/rest/v1/dials?agent_id=eq.${fromAgent}&dial_date=gte.${fromDate}`, {
          method: 'PATCH',
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ agent_id: toAgent }),
        }),
        fetch(`${SB_URL}/rest/v1/dials_hourly?agent_id=eq.${fromAgent}&dial_date=gte.${fromDate}`, {
          method: 'PATCH',
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ agent_id: toAgent }),
        }),
      ]);
      console.log(`[sync-dials] reattributed dials ${fromAgent} → ${toAgent} from ${fromDate}`);
      return res.status(200).json({ reattributed: true, from: fromAgent, to: toAgent, from_date: fromDate });
    }

    const agentMap = await buildAgentMap(sbKey);
    const ctAgents = await getCtAgents();

    // Build email → cloudtalk id map
    const emailToCtId = {};
    for (const a of ctAgents) {
      emailToCtId[a.email] = a.id;
    }

    // Probe mode: show agent list + mapping
    if (req.query.probe === 'true') {
      return res.status(200).json({ probe: true, ctAgents, emailToCtId, agentMap });
    }

    // Build list of (platformAgentId, ctAgentId) pairs we can sync
    const agentPairs = Object.entries(agentMap)
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
          // Hourly breakdown (8am–maxLocalHour local time)
          for (let h = 8; h <= maxLocalHour; h++) {
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
