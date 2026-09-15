/**
 * Server-side proxy for all Supabase writes + storage uploads.
 * Uses the service role key so RLS never blocks admin operations.
 * Requires a valid Supabase user JWT in the Authorization header.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGIN = 'https://platform.infinite-scale.be';

const ALLOWED_TABLES = new Set([
  'agents', 'clients', 'appointments', 'agent_clients', 'eod_reports',
  'tickets', 'recruits', 'prospects', 'contracts', 'events', 'notifications',
  'agent_schedules', 'activity_log', 'platform_settings', 'presence',
  'invoice_states', 'whatsapp_messages', 'client_whatsapp_templates',
  'dials', 'dials_hourly', 'profiles',
]);

export const config = { api: { bodyParser: false } };

async function verifyToken(token) {
  if (!token) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + token },
  });
  if (!r.ok) return null;
  return r.json();
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigin = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-file-path');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: read a table using service key (bypasses RLS) — ?table=xxx&query=yyy
  // GET ?action=magic_link&email=xxx — generate + server-side verify magic link, return session
  // GET ?action=run_migration&secret=xxx — run DB migration (temp, remove after use)
  if (req.method === 'GET') {
    const { action, email, table: tbl, query: q } = req.query || {};


    // Magic link: generate and verify server-side so browser never hits database.infinite-scale.be directly
    if (action === 'magic_link') {
      // Require admin auth
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const user = await verifyToken(token);
      if (!user || !user.id) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      if (!email) return res.status(400).json({ ok: false, error: 'email required' });

      // Generate link server-side
      const genR = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'magiclink', email }),
      });
      const genData = await genR.json().catch(() => ({}));
      if (!genR.ok) return res.status(genR.status).json({ ok: false, error: genData });

      // Extract hashed_token from action_link and verify server-side
      const actionLink = genData.action_link || '';
      const hashedToken = genData.hashed_token || new URL(actionLink).searchParams.get('token');
      if (!hashedToken) return res.status(500).json({ ok: false, error: 'no token in response', genData });

      // Verify token server-side — Supabase responds with 303 + Location header containing session in fragment
      const verR = await fetch(`${SB_URL}/auth/v1/verify?token=${encodeURIComponent(hashedToken)}&type=magiclink&redirect_to=https://platform.infinite-scale.be`, {
        method: 'GET',
        headers: { apikey: SERVICE_KEY },
        redirect: 'manual',
      });
      const location = verR.headers.get('location') || '';
      // Session tokens are in the URL fragment after #
      const fragIdx = location.indexOf('#');
      if (fragIdx === -1) return res.status(500).json({ ok: false, error: 'no fragment in redirect', location, status: verR.status });
      const frag = new URLSearchParams(location.slice(fragIdx + 1));
      const accessToken = frag.get('access_token');
      const refreshToken = frag.get('refresh_token');
      const expiresIn = Number(frag.get('expires_in') || 3600);
      if (!accessToken) return res.status(500).json({ ok: false, error: 'no access_token in fragment', location, frag: location.slice(fragIdx) });
      // Fetch user object to complete the session
      const userR = await fetch(`${SB_URL}/auth/v1/user`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${accessToken}` },
      });
      const userObj = await userR.json().catch(() => ({}));
      const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
      const session = { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, expires_at: expiresAt, token_type: 'bearer', user: userObj };
      return res.status(200).json({ ok: true, session });
    }

    // Regular table read
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const user = await verifyToken(token);
    if (!user || !user.id) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    if (!tbl || !ALLOWED_TABLES.has(tbl)) return res.status(400).json({ ok: false, error: 'table not allowed' });
    const r = await fetch(`${SB_URL}/rest/v1/${tbl}${q || ''}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    });
    const data = await r.json().catch(() => []);
    return res.status(r.status).json(data);
  }

  // POST ?action=fathom_webhook — receive Fathom call data, run CLOSER, update prospect CRM
  if (req.method === 'POST' && (req.query?.action === 'fathom_webhook' || req.query?.action === 'fathom')) {
    const chunks2 = [];
    for await (const chunk of req) chunks2.push(chunk);
    let payload = {};
    try { payload = JSON.parse(Buffer.concat(chunks2).toString('utf8')); } catch {}

    const { transcript, summary, action_items, title, started_at, recording_url, attendee_email, attendee_name, prospect_id } = payload;
    if (!transcript && !summary) return res.status(400).json({ ok: false, error: 'transcript or summary required' });

    // Run CLOSER analysis on transcript (call enhance-contract endpoint internally)
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    let analysis = null;
    if (transcript && ANTHROPIC_KEY) {
      const closerPrompt = `Je bent een sales coach die verkoopgesprekken analyseert met het CLOSER-framework van Alex Hormozi.

Analyseer het volgende transcript en geef een gedetailleerde analyse in het Nederlands (Vlaams).

CLOSER FRAMEWORK:
C - Clarify: Werd de reden van het gesprek helder gesteld? Werden de doelen van de prospect verduidelijkt?
L - Label: Werd het probleem van de prospect gelabeld/benoemd? Voelde de prospect zich begrepen?
O - Overview/Consequence: Werden de gevolgen van niet-handelen duidelijk gemaakt? Werd urgentie gecreeerd?
S - Sell the vacation: Werd de gewenste toekomststaat verkocht (niet het product)? Werd de droom van de prospect aangesproken?
E - Explain away objections: Werden bezwaren proactief weggenomen? Werd de methode van consequence-selling gebruikt?
R - Reinforce: Werd de beslissing van de prospect versterkt? Werden next steps duidelijk afgesproken?

Voor elke sectie geef: wat_er_gebeurde, wat_beter_kon, score /10.
Eindig met: biggest_growth_point (1 zin), score_total (gemiddelde), deal_facts: {prospect, pricing, terms, next_steps}.
next_action_type: één van "second_call","follow_up_call","send_info","meeting","herplan_call","geen_actie","niet_gekwalificeerd"
next_action_date: datum indien vermeld (YYYY-MM-DD), anders null
next_action_notes: korte beschrijving wat er moet gebeuren

Geef ALLEEN geldig JSON terug zonder markdown:
{"c":{"wat_er_gebeurde":"","wat_beter_kon":"","score":7},"l":{"wat_er_gebeurde":"","wat_beter_kon":"","score":6},"o":{"wat_er_gebeurde":"","wat_beter_kon":"","score":5},"s":{"wat_er_gebeurde":"","wat_beter_kon":"","score":7},"e":{"wat_er_gebeurde":"","wat_beter_kon":"","score":6},"r":{"wat_er_gebeurde":"","wat_beter_kon":"","score":8},"biggest_growth_point":"","score_total":6.5,"deal_facts":{"prospect":"","pricing":"","terms":"","next_steps":""},"next_action_type":"second_call","next_action_date":null,"next_action_notes":""}

TRANSCRIPT:\n${transcript}`;
      try {
        const aiR = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4096, messages: [{ role: 'user', content: closerPrompt }] }),
        });
        const aiData = await aiR.json();
        const raw = aiData.content?.[0]?.text || '';
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) analysis = JSON.parse(m[0].replace(/[\x00-\x1F\x7F]/g, c => (c === '\n' || c === '\r' || c === '\t') ? ' ' : ''));
      } catch (_) {}
    }

    // Find or create prospect
    let prospectRow = null;
    if (prospect_id) {
      const rows = await fetch(`${SB_URL}/rest/v1/prospects?id=eq.${encodeURIComponent(prospect_id)}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      }).then(r => r.json()).catch(() => []);
      prospectRow = rows?.[0] || null;
    } else if (attendee_email) {
      const rows = await fetch(`${SB_URL}/rest/v1/prospects?email=eq.${encodeURIComponent(attendee_email)}&order=created_at.desc&limit=1`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      }).then(r => r.json()).catch(() => []);
      prospectRow = rows?.[0] || null;
    }

    // Build update payload
    const actionItemsText = Array.isArray(action_items) ? action_items.join('\n• ') : (action_items || '');
    const updates = {
      ...(analysis ? {
        closer_analysis: { ...analysis, call_date: started_at || new Date().toISOString(), recording_url: recording_url || null, fathom_title: title || null },
        closer_score_total: analysis.score_total || null,
        next_action_type: analysis.next_action_type || null,
        next_action_date: analysis.next_action_date || null,
        next_action_notes: analysis.next_action_notes || null,
      } : {}),
      ...(actionItemsText ? { action_items: actionItemsText } : {}),
      ...(summary ? { fathom_summary: summary } : {}),
      last_call_at: started_at || new Date().toISOString(),
    };

    if (prospectRow) {
      await fetch(`${SB_URL}/rest/v1/prospects?id=eq.${prospectRow.id}`, {
        method: 'PATCH',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(updates),
      });
      return res.status(200).json({ ok: true, prospect_id: prospectRow.id, analysis: !!analysis, score: analysis?.score_total });
    } else {
      // No matching prospect found
      return res.status(200).json({ ok: true, prospect_id: null, analysis: !!analysis, score: analysis?.score_total, warning: 'No prospect matched by email' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  // Verify caller is a logged-in platform user
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const user = await verifyToken(token);
  if (!user || !user.id) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  // Storage upload: detected by x-file-path header
  const filePath = req.headers['x-file-path'];
  if (filePath) {
    // Sanitise the path to prevent path traversal
    const safePath = filePath.replace(/\.\./g, '').replace(/^\/+/, '');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const r = await fetch(`${SB_URL}/storage/v1/object/contracts/${safePath}`, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': req.headers['content-type'] || 'application/pdf' },
      body: buffer,
    });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ ok: false, error: text });
    return res.status(200).json({ ok: true, url: `${SB_URL}/storage/v1/object/public/contracts/${safePath}` });
  }

  // JSON body for DB writes
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  let parsed;
  try { parsed = JSON.parse(rawBody); } catch { return res.status(400).json({ ok: false, error: 'invalid JSON' }); }

  const { method, table, query, body, conflict } = parsed || {};

  if (!table) return res.status(400).json({ ok: false, error: 'table required' });
  if (!ALLOWED_TABLES.has(table)) return res.status(400).json({ ok: false, error: 'table not allowed' });

  const base = `${SB_URL}/rest/v1/${table}`;
  const hdrs = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  let url, fetchMethod, fetchBody;

  if (method === 'patch') {
    url = base + (query || '');
    fetchMethod = 'PATCH';
    let patchBody = body;
    if (table === 'clients' && body && typeof body === 'object') {
      const { phone: _phone, vat: _vat, ...rest } = body;
      patchBody = rest;
    }
    fetchBody = JSON.stringify(patchBody);
  } else if (method === 'post') {
    url = base;
    fetchMethod = 'POST';
    fetchBody = JSON.stringify(body);
  } else if (method === 'upsert') {
    url = conflict ? `${base}?on_conflict=${conflict}` : base;
    fetchMethod = 'POST';
    hdrs['Prefer'] = `resolution=merge-duplicates,return=representation`;
    fetchBody = JSON.stringify(body);
  } else if (method === 'del') {
    url = base + (query || '');
    fetchMethod = 'DELETE';
    delete hdrs['Prefer'];
  } else {
    return res.status(400).json({ ok: false, error: 'unknown method' });
  }

  try {
    const r = await fetch(url, { method: fetchMethod, headers: hdrs, body: fetchBody });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    if (!r.ok) return res.status(200).json({ ok: false, status: r.status, error: data });
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}
