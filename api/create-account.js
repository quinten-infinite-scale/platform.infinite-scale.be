const SB_URL_CONST = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET ?action=auth-redirect&token=HASHED&type=recovery&new=1
  // Exchanges a Supabase hashed_token for a real JWT and redirects to the platform reset-password page.
  if (req.method === 'GET') {
    const { action, token, type = 'recovery', new: isNew } = req.query || {};
    if (action !== 'auth-redirect' || !token) return res.status(400).send('Missing action or token');
    try {
      const verifyUrl = `${SB_URL_CONST}/auth/v1/verify?token=${encodeURIComponent(token)}&type=${type}`;
      const verifyR = await fetch(verifyUrl, { method: 'GET', headers: { apikey: ANON_KEY }, redirect: 'manual' });
      const location = verifyR.headers.get('location') || '';
      const hashIdx = location.indexOf('#');
      if (hashIdx === -1) return res.redirect(302, `https://platform.infinite-scale.be/reset-password?error=link_expired`);
      const params = new URLSearchParams(location.slice(hashIdx + 1));
      const at = params.get('access_token');
      const rt = params.get('refresh_token') || '';
      if (!at) return res.redirect(302, `https://platform.infinite-scale.be/reset-password?error=link_expired`);
      const dest = new URLSearchParams({ access_token: at, refresh_token: rt, type, ...(isNew ? { new: '1' } : {}) });
      return res.redirect(302, `https://platform.infinite-scale.be/reset-password#${dest.toString()}`);
    } catch (err) {
      console.error('auth-redirect crash:', err);
      return res.redirect(302, `https://platform.infinite-scale.be/reset-password?error=server_error`);
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // POST ?action=invite-client — create auth account + send onboarding email (admin auth required)
  if ((req.query?.action || req.body?.action) === 'invite-client') {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    const SERVICE_KEY_IC = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const RESEND_KEY_IC = process.env.RESEND_API_KEY;
    if (!SERVICE_KEY_IC) return res.status(500).json({ error: 'Service key not configured' });
    const authHeader2 = req.headers['authorization'] || '';
    const tok2 = authHeader2.startsWith('Bearer ') ? authHeader2.slice(7) : '';
    if (!tok2) return res.status(401).json({ error: 'Unauthorized' });
    const userR2 = await fetch(`${SB_URL_CONST}/auth/v1/user`, { headers: { apikey: SERVICE_KEY_IC, Authorization: `Bearer ${tok2}` } });
    if (!userR2.ok) return res.status(401).json({ error: 'Unauthorized' });
    const authUser2 = await userR2.json();
    const profileR2 = await fetch(`${SB_URL_CONST}/rest/v1/profiles?id=eq.${authUser2.id}&select=role&limit=1`, { headers: { apikey: SERVICE_KEY_IC, Authorization: `Bearer ${SERVICE_KEY_IC}` } });
    const profiles2 = await profileR2.json();
    if (!profiles2?.[0] || profiles2[0].role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { email: icEmail, name: icName, clientId: icClientId } = req.body || {};
    if (!icEmail) return res.status(400).json({ error: 'email required' });
    const sbH2 = { apikey: SERVICE_KEY_IC, Authorization: `Bearer ${SERVICE_KEY_IC}`, 'Content-Type': 'application/json' };
    let icUserId;
    const cr2 = await fetch(`${SB_URL_CONST}/auth/v1/admin/users`, { method: 'POST', headers: sbH2, body: JSON.stringify({ email: icEmail, email_confirm: true }) });
    const cd2 = await cr2.json();
    if (cr2.ok && cd2.id) { icUserId = cd2.id; }
    else {
      const lr2 = await fetch(`${SB_URL_CONST}/auth/v1/admin/users?email=${encodeURIComponent(icEmail)}`, { headers: { apikey: SERVICE_KEY_IC, Authorization: `Bearer ${SERVICE_KEY_IC}` } });
      icUserId = (await lr2.json())?.users?.[0]?.id;
      if (!icUserId) return res.status(500).json({ error: 'Could not create or find user', detail: cd2 });
    }
    await fetch(`${SB_URL_CONST}/rest/v1/profiles`, { method: 'POST', headers: { ...sbH2, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: icUserId, name: icName || icEmail.split('@')[0], email: icEmail, role: 'client' }) });
    if (icClientId) {
      await fetch(`${SB_URL_CONST}/rest/v1/clients?id=eq.${icClientId}`, { method: 'PATCH', headers: { ...sbH2, Prefer: 'return=minimal' }, body: JSON.stringify({ profile_id: icUserId, email: icEmail }) });
    } else {
      const clR2 = await fetch(`${SB_URL_CONST}/rest/v1/clients?email=eq.${encodeURIComponent(icEmail)}&limit=1`, { headers: sbH2 });
      const cls2 = await clR2.json();
      if (cls2?.[0]?.id) await fetch(`${SB_URL_CONST}/rest/v1/clients?id=eq.${cls2[0].id}`, { method: 'PATCH', headers: { ...sbH2, Prefer: 'return=minimal' }, body: JSON.stringify({ profile_id: icUserId }) });
    }
    let icSetupUrl;
    const icLinkR = await fetch(`${SB_URL_CONST}/auth/v1/admin/generate_link`, { method: 'POST', headers: sbH2, body: JSON.stringify({ type: 'recovery', email: icEmail }) });
    if (icLinkR.ok) { const ld2 = await icLinkR.json(); if (ld2.hashed_token) icSetupUrl = `https://platform.infinite-scale.be/api/create-account?action=auth-redirect&token=${encodeURIComponent(ld2.hashed_token)}&type=recovery&new=1`; }
    if (!icSetupUrl) return res.status(500).json({ error: 'Failed to generate setup link', userId: icUserId });
    if (!RESEND_KEY_IC || RESEND_KEY_IC === 're_placeholder') return res.status(200).json({ ok: true, userId: icUserId, setupUrl: icSetupUrl, emailSent: false });
    const icDisplayName = icName || icEmail.split('@')[0];
    const icHtml = `<div style="background:#0a0e1a;padding:0;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:540px;margin:0 auto;padding:40px 24px;"><div style="margin-bottom:32px;"><span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#67dcdf;font-weight:700;">Infinite Scale</span></div><h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4ff;letter-spacing:-.02em;line-height:1.15;">Welkom, ${icDisplayName}!</h1><p style="margin:0 0 32px;font-size:15px;color:#8090b0;line-height:1.7;">Je account op het Infinite Scale platform is aangemaakt. Klik hieronder om je wachtwoord in te stellen.</p><a href="${icSetupUrl}" style="display:inline-block;padding:15px 36px;border-radius:12px;background:#67dcdf;color:#071314;font-weight:800;font-size:15px;text-decoration:none;letter-spacing:-.01em;">Wachtwoord instellen →</a><div style="margin-top:36px;padding:18px 20px;border-radius:12px;background:#111827;border:1px solid #1f2d3d;"><p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#4a5a7a;letter-spacing:.08em;text-transform:uppercase;">Jouw inloggegevens</p><p style="margin:0 0 4px;font-size:13px;color:#a0b0d0;">Platform: <a href="https://platform.infinite-scale.be" style="color:#67dcdf;text-decoration:none;">platform.infinite-scale.be</a></p><p style="margin:0;font-size:13px;color:#a0b0d0;">E-mail: <strong style="color:#f0f4ff;">${icEmail}</strong></p></div><p style="margin-top:32px;font-size:12px;color:#2d3d55;line-height:1.6;">Deze link is 24 uur geldig. Vragen? Mail naar <a href="mailto:quinten@infinite-scale.be" style="color:#3d5070;text-decoration:none;">quinten@infinite-scale.be</a></p></div></div>`;
    try {
      const er2 = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY_IC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Infinite Scale <platform@infinite-scale.be>', to: [icEmail], subject: 'Welkom bij Infinite Scale — stel je wachtwoord in', html: icHtml }) });
      const ed2 = await er2.json();
      if (!er2.ok) return res.status(200).json({ ok: true, userId: icUserId, emailSent: false, emailError: ed2?.message });
      return res.status(200).json({ ok: true, userId: icUserId, emailSent: true });
    } catch (e2) { return res.status(200).json({ ok: true, userId: icUserId, emailSent: false, emailError: e2.message }); }
  }

  const { email, password, phone, party, party_type, link_only, force_recreate, fix_corrupted, generate_link } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  if (!link_only && !generate_link && !password) return res.status(400).json({ error: 'password required' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' });

  const SB_URL = 'https://database.infinite-scale.be';
  const sbHeaders = {
    'apikey': serviceKey,
    'Authorization': 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
  };

  // generate_link mode: generate a session for an existing user (admin use only)
  if (generate_link) {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'] || '';
    if (!cronSecret || authHeader !== 'Bearer ' + cronSecret) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const lookupR = await fetch(`${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
      headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey },
    });
    const lookupData = await lookupR.json();
    const existingUser = lookupData?.users?.[0];
    if (!existingUser) return res.status(404).json({ error: 'User not found' });
    const linkR = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', email, redirect_to: 'https://platform.infinite-scale.be' }),
    });
    const linkData = await linkR.json();
    const emailOtp = linkData.email_otp;
    const actionLink = linkData.action_link;
    // Use email_otp to exchange for a full session including user object
    if (emailOtp) {
      const verifyR = await fetch(`${SB_URL}/auth/v1/verify`, {
        method: 'POST',
        headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: emailOtp, type: 'magiclink', email }),
      });
      const sessionData = await verifyR.json();
      if (sessionData.access_token) {
        return res.status(200).json({ ok: true, session: sessionData });
      }
    }
    return res.status(200).json({ ok: true, link: actionLink, userId: existingUser.id, debug: { hasOtp: !!emailOtp, linkKeys: Object.keys(linkData) } });
  }

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
