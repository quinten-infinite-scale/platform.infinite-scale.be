const SB_URL_SC = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const RESEND_KEY_SC = () => process.env.RESEND_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Service key not configured' });

  // action=onboard-after-sign — called from sign.html when a contract is signed (client or agent)
  if (req.body?.action === 'onboard-after-sign') {
    const { sign_token, email, name, party_type } = req.body || {};
    if (!sign_token || !email) return res.status(400).json({ error: 'sign_token and email required' });
    const sbH = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

    // Load contract for rate/html — needed for both client and agent branches
    const contractR = await fetch(`${SB_URL_SC}/rest/v1/contracts?sign_token=eq.${encodeURIComponent(sign_token)}&select=id,party,party_type,email,type,value,contract_html&limit=1`, { headers: sbH });
    const contracts = await contractR.json();
    const contract = contracts?.[0];
    if (!contract) return res.status(403).json({ error: 'Invalid sign token' });
    const resolvedEmail = (email || contract.email || '').trim().toLowerCase();
    const resolvedName  = name || contract.party || resolvedEmail.split('@')[0];
    const resolvedPartyType = party_type || contract.party_type || 'client';

    // Shared helper: create/find auth user + upsert profile
    const ensureAuthUser = async (role) => {
      let uid;
      const cR = await fetch(`${SB_URL_SC}/auth/v1/admin/users`, { method: 'POST', headers: sbH, body: JSON.stringify({ email: resolvedEmail, email_confirm: true }) });
      const cD = await cR.json();
      if (cR.ok && cD.id) {
        uid = cD.id;
      } else {
        // User already exists — look up by email
        const lR = await fetch(`${SB_URL_SC}/auth/v1/admin/users?email=${encodeURIComponent(resolvedEmail)}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
        const lD = await lR.json();
        uid = lD?.users?.[0]?.id;
        if (!uid) throw new Error('Could not create or find auth user for ' + resolvedEmail);
      }
      await fetch(`${SB_URL_SC}/rest/v1/profiles`, { method: 'POST', headers: { ...sbH, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: uid, name: resolvedName, email: resolvedEmail, role }) });
      return uid;
    };

    // Shared helper: generate setup link via auth-redirect relay
    const genSetupUrl = async () => {
      const lR = await fetch(`${SB_URL_SC}/auth/v1/admin/generate_link`, { method: 'POST', headers: sbH, body: JSON.stringify({ type: 'recovery', email: resolvedEmail }) });
      if (!lR.ok) return null;
      const lD = await lR.json();
      return lD.hashed_token ? `https://platform.infinite-scale.be/api/create-account?action=auth-redirect&token=${encodeURIComponent(lD.hashed_token)}&type=recovery&new=1` : null;
    };

    // Shared helper: send onboarding email via Resend
    const sendOnboardEmail = async (setupUrl, isAgent) => {
      const rKey = RESEND_KEY_SC();
      if (!rKey || rKey === 're_placeholder') return { emailSent: false, warn: 'RESEND_API_KEY not configured' };
      const greeting = isAgent ? `Contract getekend — welkom, ${resolvedName}!` : `Contract getekend — welkom, ${resolvedName}!`;
      const intro1 = isAgent
        ? 'Je contract is succesvol ondertekend. Je agent account op het Infinite Scale platform is aangemaakt.'
        : 'Uw contract is succesvol ondertekend. Uw account op het Infinite Scale platform is aangemaakt.';
      const intro2 = isAgent
        ? 'Klik op de knop hieronder om je wachtwoord in te stellen en direct in te loggen als callagent.'
        : 'Klik op de knop hieronder om uw wachtwoord in te stellen en direct in te loggen.';
      const html = `<div style="background:#0a0e1a;padding:0;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:540px;margin:0 auto;padding:40px 24px;"><div style="margin-bottom:32px;"><span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#4ade80;font-weight:700;">Infinite Scale</span></div><h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4ff;letter-spacing:-.02em;line-height:1.15;">${greeting}</h1><p style="margin:0 0 8px;font-size:15px;color:#8090b0;line-height:1.7;">${intro1}</p><p style="margin:0 0 32px;font-size:15px;color:#8090b0;line-height:1.7;">${intro2}</p><a href="${setupUrl}" style="display:inline-block;padding:15px 36px;border-radius:12px;background:#4ade80;color:#071407;font-weight:800;font-size:15px;text-decoration:none;letter-spacing:-.01em;">Wachtwoord instellen →</a><div style="margin-top:36px;padding:18px 20px;border-radius:12px;background:#111827;border:1px solid #1f2d3d;"><p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#4a5a7a;letter-spacing:.08em;text-transform:uppercase;">Inloggegevens</p><p style="margin:0 0 4px;font-size:13px;color:#a0b0d0;">Platform: <a href="https://platform.infinite-scale.be" style="color:#4ade80;text-decoration:none;">platform.infinite-scale.be</a></p><p style="margin:0;font-size:13px;color:#a0b0d0;">E-mail: <strong style="color:#f0f4ff;">${resolvedEmail}</strong></p></div><p style="margin-top:32px;font-size:12px;color:#2d3d55;line-height:1.6;">Deze link is 24 uur geldig. Vragen? Mail naar <a href="mailto:quinten@infinite-scale.be" style="color:#3d5070;text-decoration:none;">quinten@infinite-scale.be</a></p></div></div>`;
      try {
        const er = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${rKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Infinite Scale <platform@infinite-scale.be>', to: [resolvedEmail], subject: 'Contract getekend — stel je wachtwoord in bij Infinite Scale', html }) });
        const ed = await er.json();
        return er.ok ? { emailSent: true } : { emailSent: false, emailError: ed?.message };
      } catch (e) { return { emailSent: false, emailError: e.message }; }
    };

    try {
      // ── CLIENT branch ────────────────────────────────────────────────────────
      if (resolvedPartyType === 'client') {
        let clientId;
        const existingR = await fetch(`${SB_URL_SC}/rest/v1/clients?email=eq.${encodeURIComponent(resolvedEmail)}&select=id&limit=1`, { headers: sbH });
        const existing = await existingR.json();
        if (existing?.[0]?.id) {
          clientId = existing[0].id;
        } else {
          const allClR = await fetch(`${SB_URL_SC}/rest/v1/clients?select=id`, { headers: sbH });
          const allCl = await allClR.json();
          const maxNum = (allCl || []).reduce((m, c) => { const n = parseInt((c.id || '').replace(/\D/g, ''), 10); return isNaN(n) ? m : Math.max(m, n); }, 0);
          const newClientId = 'c' + (maxNum + 1);
          let rate = contract.value ? Math.round(parseFloat(contract.value)) : 0;
          let setupFee = 0;
          if (contract.contract_html) {
            const text = contract.contract_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
            const rateMatch = text.match(/(?:per\s+(?:gehouden\s+)?afspraak)[^€]*€\s*([\d.,]+)/i) || text.match(/€\s*([\d.,]+)[^€\n]{0,60}(?:per\s+(?:gehouden\s+)?afspraak)/i);
            if (rateMatch) rate = Math.round(parseFloat(rateMatch[1].replace(/\./g, '').replace(',', '.')));
            const setupMatch = text.match(/[Oo]pstartkost[^€]*€\s*([\d.,]+)/i);
            if (setupMatch) setupFee = Math.round(parseFloat(setupMatch[1].replace(/\./g, '').replace(',', '.')));
          }
          if (!rate) rate = 45;
          const today = new Date().toISOString().slice(0, 10);
          const newClientR = await fetch(`${SB_URL_SC}/rest/v1/clients`, { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify({ id: newClientId, name: resolvedName, email: resolvedEmail, type: 'direct', status: 'starting', crm: 'none', crm_on: false, kickoff: today, rate, setup_fee: setupFee || null, contact_person: resolvedName, company: resolvedName, bill_status: 'pending', subclients: [] }) });
          const newCl = await newClientR.json();
          clientId = newCl?.[0]?.id || newClientId;
        }
        const userId = await ensureAuthUser('client');
        await fetch(`${SB_URL_SC}/rest/v1/clients?id=eq.${clientId}`, { method: 'PATCH', headers: { ...sbH, Prefer: 'return=minimal' }, body: JSON.stringify({ profile_id: userId, email: resolvedEmail }) });
        const setupUrl = await genSetupUrl();
        if (!setupUrl) return res.status(500).json({ error: 'Failed to generate setup link', userId, clientId });
        const emailResult = await sendOnboardEmail(setupUrl, false);
        return res.status(200).json({ ok: true, userId, clientId, ...emailResult });
      }

      // ── AGENT branch ─────────────────────────────────────────────────────────
      if (resolvedPartyType === 'agent') {
        let agentId;
        const agLookupR = await fetch(`${SB_URL_SC}/rest/v1/agents?email=eq.${encodeURIComponent(resolvedEmail)}&select=id&limit=1`, { headers: sbH });
        const agLookup = await agLookupR.json();
        if (agLookup?.[0]?.id) {
          agentId = agLookup[0].id;
        } else {
          const allAgR = await fetch(`${SB_URL_SC}/rest/v1/agents?select=id`, { headers: sbH });
          const allAg = await allAgR.json();
          const maxNum = (allAg || []).reduce((m, a) => { const n = parseInt((a.id || '').replace(/\D/g, ''), 10); return isNaN(n) ? m : Math.max(m, n); }, 0);
          agentId = 'a' + (maxNum + 1);
          await fetch(`${SB_URL_SC}/rest/v1/agents`, { method: 'POST', headers: { ...sbH, Prefer: 'return=minimal' }, body: JSON.stringify({ id: agentId, name: resolvedName, email: resolvedEmail, active: true, status: 'signed', working: false, feedback: [], todos: [], lifetime_paid: 0 }) });
        }
        const userId = await ensureAuthUser('agent');
        await fetch(`${SB_URL_SC}/rest/v1/agents?id=eq.${agentId}`, { method: 'PATCH', headers: { ...sbH, Prefer: 'return=minimal' }, body: JSON.stringify({ profile_id: userId, email: resolvedEmail }) });
        const setupUrl = await genSetupUrl();
        if (!setupUrl) return res.status(500).json({ error: 'Failed to generate setup link', userId, agentId });
        const emailResult = await sendOnboardEmail(setupUrl, true);
        return res.status(200).json({ ok: true, userId, agentId, ...emailResult });
      }

      return res.status(200).json({ ok: true, skipped: true, reason: 'unknown party_type: ' + resolvedPartyType });
    } catch (err) {
      console.error('[onboard-after-sign] error:', err);
      return res.status(500).json({ error: err.message || 'Internal error during onboarding' });
    }
  }

  const raw = req.body;
  if (!raw || !raw.id) {
    return res.status(400).json({ error: 'Missing required field: id' });
  }

  // Only pass known columns — ignore any extra form fields the browser may send
  const KNOWN = ['id','party','party_type','type','status','sent','value','email','vat','address','contact','duration','notes','setup_fee','signing_link','sign_token','signed_at','signer_name','signature_image','contract_html'];
  const contract = Object.fromEntries(Object.entries(raw).filter(([k]) => KNOWN.includes(k)));

  // Addendum contracts must be stored as party_type 'agent' (DB check constraint only allows 'client' and 'agent')
  if (contract.party_type === 'addendum') contract.party_type = 'agent';

  const r = await fetch('https://database.infinite-scale.be/rest/v1/contracts', {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(contract),
  });

  if (!r.ok) {
    const err = await r.text();
    console.error('save-contract error:', err);
    return res.status(r.status).json({ error: err });
  }

  return res.status(201).json({ ok: true });
}
