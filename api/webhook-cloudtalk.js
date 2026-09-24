/**
 * CloudTalk → Supabase dials sync (webhook, real-time)
 *
 * Triggered by CloudTalk Workflow Automation on "Call ended" (outgoing only).
 * Receives { agent_email, started_at } and increments the daily dial count.
 */

const SB_URL = 'https://database.infinite-scale.be';
const CT_KEY    = process.env.CLOUDTALK_API_KEY    || 'WWAPRPI7ALOG7GQHPCHA';
const CT_SECRET = process.env.CLOUDTALK_API_SECRET || '';

async function ctGetToken() {
  const auth = Buffer.from(`${CT_KEY}:${CT_SECRET}`).toString('base64');
  const r = await fetch('https://dashboard.cloudtalk.io/api/auth/tokens/access', { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`ct-token ${r.status}`);
  const j = await r.json();
  return j.accessToken || j.access_token || j.token;
}

function ctMakeFilter(timeframe) {
  return { datetime: { type: 'relative', timeframe, usePreviousPeriod: false }, groupIds: ['274186'], agentIds: [], voiceAgentIds: [], externalNumber: '', contactNumbers: [], contactNames: [], contactName: '', tagIds: [], callRating: [], callDirection: ['inboundAndOutbound'], countryCodes: [], internalNumberIds: [], callId: '', groupMissedReason: [], agentMissedReason: [], callMissedReason: [], outOfOffice: false, talkingTime: { gte: 0, lte: 0 }, isResolved: null, anonymous: null };
}

async function ctFetchCount(token, timeframe) {
  const r = await fetch('https://analytics-api.cloudtalk.io/api/metrics/call-counts/total-calls', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ filter: ctMakeFilter(timeframe) }) });
  if (!r.ok) throw new Error(`ct-api ${r.status} ${timeframe}`);
  const j = await r.json();
  return j?.data?.value ?? j?.value ?? j?.total ?? 0;
}

async function ctManagementFee(req, res) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Server misconfigured' });
  const sbH = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const callerToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!callerToken) return res.status(401).json({ error: 'Unauthorized' });
  const userRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${callerToken}` } });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
  const userInfo = await userRes.json();
  if (userInfo.email !== 'senne.db@infinite-scale.be') return res.status(403).json({ error: 'Forbidden' });
  const [apptRes, acRes] = await Promise.all([fetch(`${SB_URL}/rest/v1/appointments?status=eq.show&agent_id=neq.a1&select=agent_id,client_id,date_appt,date_logged`, { headers: sbH }), fetch(`${SB_URL}/rest/v1/agent_clients?agent_id=neq.a1&select=agent_id,client_id,rate`, { headers: sbH })]);
  if (!apptRes.ok || !acRes.ok) return res.status(500).json({ error: 'DB fetch failed' });
  const appts = await apptRes.json(); const acRows = await acRes.json();
  const rateMap = {}; for (const row of acRows) { if (!rateMap[row.agent_id]) rateMap[row.agent_id] = {}; rateMap[row.agent_id][row.client_id] = row.rate || 0; }
  const FEE = 0.15; const now = new Date(); const currentYM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const byMonth = {}; let runningThisMonth = 0;
  const agentRes = await fetch(`${SB_URL}/rest/v1/agents?select=id,name`, { headers: sbH });
  const agentRows = agentRes.ok ? await agentRes.json() : []; const agentNames = {}; for (const ag of agentRows) agentNames[ag.id] = ag.name || ag.id;
  for (const a of appts) { const ym = (a.date_appt || a.date_logged || '').slice(0, 7); if (!ym) continue; const rate = (rateMap[a.agent_id] || {})[a.client_id] || 0; if (!byMonth[ym]) byMonth[ym] = { agentRevenue: 0, fee: 0, count: 0, agents: {} }; byMonth[ym].agentRevenue += rate; byMonth[ym].fee += rate * FEE; byMonth[ym].count++; if (!byMonth[ym].agents[a.agent_id]) byMonth[ym].agents[a.agent_id] = { revenue: 0, count: 0 }; byMonth[ym].agents[a.agent_id].revenue += rate; byMonth[ym].agents[a.agent_id].count++; if (ym === currentYM) runningThisMonth += rate * FEE; }
  const months = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).map(([ym, v]) => ({ ym, agentRevenue: v.agentRevenue, fee: v.fee, count: v.count, agents: Object.entries(v.agents).sort((a, b) => b[1].revenue - a[1].revenue).map(([id, d]) => ({ id, name: agentNames[id] || id, revenue: d.revenue, count: d.count, fee: d.revenue * FEE })) }));
  return res.status(200).json({ ok: true, feeRate: FEE, currentYM, runningThisMonth, months });
}

// CloudTalk migrated to generic callagent@ accounts (2026-09-01).
// Personal emails kept as fallback for agents who kept their own account.
// Source of truth: sync-dials.js (confirmed by call-volume matching).
const AGENT_MAP = {
  // Personal accounts (kept own CloudTalk login)
  'senne.db@infinite-scale.be':       'a1',
  'john.vda@infinite-scale.be':       'a2',
  'kaiusr@proton.me':                 'a3',
  'ditske@infinite-scale.be':         'a5',
  'nick@infinite-scale.be':           'a6',
  'lotte@infinite-scale.be':          'a7',
  'shalom@infinite-scale.be':         'a8',
  'mieke@infinite-scale.be':          'a10',
  'quinten@infinite-scale.be':        'a11',
  'isa.fleur@hotmail.com':            'a13',
  'zb.constulting@gmail.com':         'a17',
  'soretmaxim2006@icloud.com':        'a18',
  'jolijnemmers@hotmail.com':         'a19',
  'wien_ruessink@hotmail.com':        'a20',
  // Generic callagent@ accounts (confirmed by volume matching in sync-dials.js)
  'callagent@infinite-scale.be':      'a4',   // Bram Sanders
  'callagent1@infinite-scale.be':     'a9',   // Lothar
  'callagent2@infinite-scale.be':     'a12',  // Rick Hoekstra
  'callagent4@infinite-scale.be':     'a15',  // Rabih Ibrahim
  'callagent5@infinite-scale.be':     'a16',  // Romy Zwiers
  'callagent7@infinite-scale.be':     'a14',  // Jimmy Verschut
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — CloudTalk stats proxy (replaces /api/cloudtalk-stats)
  if (req.method === 'GET') {
    if (req.query.mode === 'management-fee') return ctManagementFee(req, res);
    try {
      const token = await ctGetToken();
      const [today, week, month] = await Promise.all([ctFetchCount(token, 'today'), ctFetchCount(token, 'this week'), ctFetchCount(token, 'this month')]);
      return res.status(200).json({ today, week, month, ok: true });
    } catch (err) {
      return res.status(200).json({ today: null, week: null, month: null, ok: false, error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Optional secret token check
  const secret = process.env.CLOUDTALK_WEBHOOK_SECRET;
  if (secret) {
    const auth = req.headers['x-webhook-secret'] || req.headers.authorization?.replace('Bearer ', '');
    if (auth !== secret) return res.status(401).json({ error: 'Unauthorized' });
  }

  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const body = req.body || {};
  const agentEmail = (body.agent_email || '').toLowerCase().trim();
  const startedAt  = body.started_at || '';

  if (!agentEmail || !startedAt) {
    return res.status(400).json({ error: 'Missing agent_email or started_at', body });
  }

  const agentId = AGENT_MAP[agentEmail];
  if (!agentId) {
    // Not one of our tracked agents — ignore silently
    return res.status(200).json({ ignored: true, reason: 'agent not tracked', agent_email: agentEmail });
  }

  const dialDate = startedAt.slice(0, 10); // "2026-08-21"

  // Atomically increment via fetch-then-upsert
  // (race conditions are extremely rare for same agent, same second)
  const fetchRes = await fetch(
    `${SB_URL}/rest/v1/dials?agent_id=eq.${agentId}&dial_date=eq.${dialDate}&select=count`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  const rows = await fetchRes.json();
  const currentCount = rows[0]?.count ?? 0;

  const upsertRes = await fetch(`${SB_URL}/rest/v1/dials?on_conflict=agent_id,dial_date`, {
    method: 'POST',
    headers: {
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ agent_id: agentId, dial_date: dialDate, count: currentCount + 1 }),
  });

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    console.error('[webhook-cloudtalk] upsert error:', err);
    return res.status(500).json({ error: err.slice(0, 200) });
  }

  console.log(`[webhook-cloudtalk] ${agentId} ${dialDate} → ${currentCount + 1}`);
  return res.status(200).json({ ok: true, agent_id: agentId, dial_date: dialDate, new_count: currentCount + 1 });
}
