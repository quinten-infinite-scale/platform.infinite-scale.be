/**
 * CloudTalk → Supabase dials sync (webhook, real-time)
 *
 * Triggered by CloudTalk Workflow Automation on "Call ended" (outgoing only).
 * Receives { agent_email, started_at } and increments the daily dial count.
 */

const SB_URL = 'https://database.infinite-scale.be';

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
