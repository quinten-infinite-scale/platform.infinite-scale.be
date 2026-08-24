/**
 * Proxy for CloudTalk analytics API.
 * Exchanges the API key/secret for a JWT via dashboard.cloudtalk.io,
 * then fetches total-calls for today / this week / this month.
 *
 * Also handles ?mode=management-fee for Senne's payment tab.
 */

const CT_KEY    = process.env.CLOUDTALK_API_KEY    || 'WWAPRPI7ALOG7GQHPCHA';
const CT_SECRET = process.env.CLOUDTALK_API_SECRET || '';
const SB_URL    = 'https://database.infinite-scale.be';

async function getToken() {
  const auth = Buffer.from(`${CT_KEY}:${CT_SECRET}`).toString('base64');
  const r = await fetch('https://dashboard.cloudtalk.io/api/auth/tokens/access', {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = await r.json();
  return j.accessToken || j.access_token || j.token;
}

function makeFilter(timeframe) {
  return {
    datetime: { type: 'relative', timeframe, usePreviousPeriod: false },
    groupIds: ['274186'],
    agentIds: [], voiceAgentIds: [], externalNumber: '',
    contactNumbers: [], contactNames: [], contactName: '',
    tagIds: [], callRating: [],
    callDirection: ['inboundAndOutbound'],
    countryCodes: [], internalNumberIds: [], callId: '',
    groupMissedReason: [], agentMissedReason: [], callMissedReason: [],
    outOfOffice: false, talkingTime: { gte: 0, lte: 0 }, isResolved: null, anonymous: null,
  };
}

async function fetchCount(token, timeframe) {
  const r = await fetch('https://analytics-api.cloudtalk.io/api/metrics/call-counts/total-calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ filter: makeFilter(timeframe) }),
  });
  if (!r.ok) throw new Error(`api ${r.status} ${timeframe}`);
  const j = await r.json();
  // Response shape: { data: { value: N } } or { value: N } or { total: N }
  return j?.data?.value ?? j?.value ?? j?.total ?? 0;
}

async function managementFee(req, res) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Server misconfigured' });

  const sbHeaders = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // Verify caller is Senne via their JWT
  const callerToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!callerToken) return res.status(401).json({ error: 'Unauthorized' });

  const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${callerToken}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
  const userInfo = await userRes.json();
  if (userInfo.email !== 'senne.db@infinite-scale.be') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Fetch all shows from agents other than a1
  const [apptRes, acRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/appointments?status=eq.show&agent_id=neq.a1&select=agent_id,client_id,date_appt,date_logged`, { headers: sbHeaders }),
    fetch(`${SB_URL}/rest/v1/agent_clients?agent_id=neq.a1&select=agent_id,client_id,rate`, { headers: sbHeaders }),
  ]);
  if (!apptRes.ok || !acRes.ok) return res.status(500).json({ error: 'DB fetch failed' });

  const appts  = await apptRes.json();
  const acRows = await acRes.json();

  // Build rate lookup: agentId → clientId → rate
  const rateMap = {};
  for (const row of acRows) {
    if (!rateMap[row.agent_id]) rateMap[row.agent_id] = {};
    rateMap[row.agent_id][row.client_id] = row.rate || 0;
  }

  const FEE = 0.15;
  const now = new Date();
  const currentYM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const byMonth = {};
  let runningThisMonth = 0;

  // Also fetch agent names for the breakdown
  const agentRes = await fetch(`${SB_URL}/rest/v1/agents?select=id,name`, { headers: sbHeaders });
  const agentRows = agentRes.ok ? await agentRes.json() : [];
  const agentNames = {};
  for (const ag of agentRows) agentNames[ag.id] = ag.name || ag.id;

  for (const a of appts) {
    const ym = (a.date_appt || a.date_logged || '').slice(0, 7);
    if (!ym) continue;
    const rate = (rateMap[a.agent_id] || {})[a.client_id] || 0;
    if (!byMonth[ym]) byMonth[ym] = { agentRevenue: 0, fee: 0, count: 0, agents: {} };
    byMonth[ym].agentRevenue += rate;
    byMonth[ym].fee += rate * FEE;
    byMonth[ym].count++;
    if (!byMonth[ym].agents[a.agent_id]) byMonth[ym].agents[a.agent_id] = { revenue: 0, count: 0 };
    byMonth[ym].agents[a.agent_id].revenue += rate;
    byMonth[ym].agents[a.agent_id].count++;
    if (ym === currentYM) runningThisMonth += rate * FEE;
  }

  const months = Object.entries(byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ym, v]) => ({
      ym,
      agentRevenue: v.agentRevenue,
      fee: v.fee,
      count: v.count,
      agents: Object.entries(v.agents)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([id, d]) => ({ id, name: agentNames[id] || id, revenue: d.revenue, count: d.count, fee: d.revenue * FEE }))
    }));

  return res.status(200).json({ ok: true, feeRate: FEE, currentYM, runningThisMonth, months });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.query.mode === 'management-fee') return managementFee(req, res);

  try {
    const token = await getToken();
    const [today, week, month] = await Promise.all([
      fetchCount(token, 'today'),
      fetchCount(token, 'this week'),
      fetchCount(token, 'this month'),
    ]);
    return res.status(200).json({ today, week, month, ok: true });
  } catch (err) {
    return res.status(200).json({ today: null, week: null, month: null, ok: false, error: err.message });
  }
}
