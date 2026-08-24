export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, phone, party, party_type, link_only, force_recreate, fix_corrupted } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  if (!link_only && !password) return res.status(400).json({ error: 'password required' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' });

  const SB_URL = 'https://database.infinite-scale.be';
  const sbHeaders = {
    'apikey': serviceKey,
    'Authorization': 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
  };

  // link_only mode: just look up existing user and link to client/agent record, no account creation
  if (link_only) {
    const lookupR = await fetch(`${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
      headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey },
    });
    const lookupData = await lookupR.json();
    const existingUser = lookupData?.users?.[0];
    if (!existingUser) return res.status(200).json({ ok: true, linked: false });
    const uid = existingUser.id;
    const role = party_type === 'agent' ? 'agent' : 'client';
    await fetch(`${SB_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: uid, name: party || existingUser.email, email, role }),
    });
    if (role === 'client') {
      const cl = await (await fetch(`${SB_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}&limit=1`, { headers: sbHeaders })).json();
      if (cl && cl.length > 0) await fetch(`${SB_URL}/rest/v1/clients?id=eq.${cl[0].id}`, { method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=minimal' }, body: JSON.stringify({ profile_id: uid }) });
    } else {
      const ag = await (await fetch(`${SB_URL}/rest/v1/agents?email=eq.${encodeURIComponent(email)}&limit=1`, { headers: sbHeaders })).json();
      if (ag && ag.length > 0) await fetch(`${SB_URL}/rest/v1/agents?id=eq.${ag[0].id}`, { method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=minimal' }, body: JSON.stringify({ profile_id: uid }) });
    }
    return res.status(200).json({ ok: true, linked: true, id: uid });
  }

  const svcHdrNoType = { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey };

  // fix_corrupted: full nuke-and-recreate — nullifies FKs, deletes profile, deletes auth user, rebuilds fresh
  if (fix_corrupted) {
    const profileR = await fetch(`${SB_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, { headers: sbHeaders });
    const profiles = await profileR.json();
    const oldId = profiles?.[0]?.id;
    const log = [];
    if (oldId) {
      // Nullify FK references so profile row can be deleted
      await fetch(`${SB_URL}/rest/v1/clients?profile_id=eq.${oldId}`, { method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=minimal' }, body: JSON.stringify({ profile_id: null }) });
      await fetch(`${SB_URL}/rest/v1/agents?profile_id=eq.${oldId}`, { method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=minimal' }, body: JSON.stringify({ profile_id: null }) });
      // Delete profile row
      const dp = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${oldId}`, { method: 'DELETE', headers: { ...svcHdrNoType, 'Prefer': 'return=minimal' } });
      log.push({ delete_profile: dp.status });
      // Delete auth user (no Content-Type — avoids header mismatch on DELETE)
      const da = await fetch(`${SB_URL}/auth/v1/admin/users/${oldId}`, { method: 'DELETE', headers: svcHdrNoType });
      const daText = await da.text();
      log.push({ delete_auth: da.status, body: daText.slice(0, 100) });
    }
    // Create fresh auth user
    const cr = await fetch(`${SB_URL}/auth/v1/admin/users`, { method: 'POST', headers: sbHeaders, body: JSON.stringify({ email, password, email_confirm: true }) });
    const crData = await cr.json();
    const newId = crData?.id;
    log.push({ create_auth: cr.status, newId, err: crData?.msg || crData?.message });
    if (!newId) return res.status(500).json({ ok: false, log, error: 'Failed to create fresh auth user' });
    // Upsert profile
    await fetch(`${SB_URL}/rest/v1/profiles`, { method: 'POST', headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: newId, email, name: party || 'Rick Hoekstra', role: 'client' }) });
    // Re-link clients record
    const cl = await (await fetch(`${SB_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}&limit=1`, { headers: sbHeaders })).json();
    if (cl?.[0]?.id) {
      await fetch(`${SB_URL}/rest/v1/clients?id=eq.${cl[0].id}`, { method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=minimal' }, body: JSON.stringify({ profile_id: newId }) });
      log.push({ relink_client: cl[0].id });
    }
    // Test sign-in
    const SB_ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3ODI0NTQ1MTgsICJleHAiOiAxOTQwMTM0NTE4fQ.E3H9jIqXLe_BrrO7Qf-pWsrXPGXkqMP12ccRw561INQ';
    const sv = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'apikey': SB_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const svData = await sv.json();
    const works = !!svData?.access_token;
    log.push({ test_signin: sv.status, works, err: svData?.error_description });
    return res.status(200).json({ ok: works, newId, log });
  }

  // force_recreate: delete the corrupted auth user then recreate fresh
  if (force_recreate) {
    const profileR = await fetch(`${SB_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, { headers: sbHeaders });
    const profiles = await profileR.json();
    const oldId = profiles?.[0]?.id;
    if (oldId) {
      await fetch(`${SB_URL}/auth/v1/admin/users/${oldId}`, { method: 'DELETE', headers: svcHdrNoType });
    }
  }

  // Create user via admin API — auto-confirmed, no confirmation email needed
  const r = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: phone ? { phone } : {},
    }),
  });

  const json = await r.json();

  let userId;
  if (!r.ok) {
    // Account creation failed — look up existing user via profiles table (reliable, unlike admin email API)
    const profileR = await fetch(`${SB_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&limit=1&select=id`, {
      headers: sbHeaders,
    });
    const profiles = await profileR.json();
    userId = profiles?.[0]?.id;
    if (!userId) {
      // Truly doesn't exist — return original error
      const msg = json?.msg || json?.message || JSON.stringify(json);
      return res.status(r.status).json({ error: msg });
    }
    // Existing user found — update password and ensure email is confirmed
    await fetch(`${SB_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: sbHeaders,
      body: JSON.stringify({ password, email_confirm: true }),
    });
  } else {
    userId = json.id;
  }

  // Determine role from party_type
  const role = party_type === 'agent' ? 'agent' : 'client';

  // UPSERT the profile — overrides any default 'agent' role set by DB trigger
  await fetch(`${SB_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: userId, name: party || '', email, role }),
  });

  // Link to existing client/agent record by email so get_client_id / get_agent_id work
  if (role === 'client') {
    const lookup = await fetch(`${SB_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}&limit=1`, {
      headers: sbHeaders,
    });
    const clients = await lookup.json();
    if (clients && clients.length > 0) {
      await fetch(`${SB_URL}/rest/v1/clients?id=eq.${clients[0].id}`, {
        method: 'PATCH',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ profile_id: userId }),
      });
    }
  } else if (role === 'agent') {
    const lookup = await fetch(`${SB_URL}/rest/v1/agents?email=eq.${encodeURIComponent(email)}&limit=1`, {
      headers: sbHeaders,
    });
    const agents = await lookup.json();
    if (agents && agents.length > 0) {
      // Existing agent row — just link profile_id
      await fetch(`${SB_URL}/rest/v1/agents?id=eq.${agents[0].id}`, {
        method: 'PATCH',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ profile_id: userId }),
      });
    } else {
      // No agent row yet — auto-create one from contract data so dashboard works immediately
      const allAgents = await (await fetch(`${SB_URL}/rest/v1/agents?select=id`, { headers: sbHeaders })).json();
      const maxNum = (allAgents || []).reduce((m, a) => {
        const n = parseInt((a.id || '').replace(/\D/g, ''), 10);
        return isNaN(n) ? m : Math.max(m, n);
      }, 0);
      const newAgentId = 'a' + (maxNum + 1);
      await fetch(`${SB_URL}/rest/v1/agents`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          id: newAgentId,
          name: party || email.split('@')[0],
          email,
          phone: phone || '',
          active: true,
          status: 'signed',
          profile_id: userId,
          working: false,
          feedback: [],
          todos: [],
          lifetime_paid: 0,
        }),
      });
    }
  }

  return res.status(200).json({ ok: true, id: userId });
}
