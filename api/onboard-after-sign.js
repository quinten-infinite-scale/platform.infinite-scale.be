/**
 * POST /api/onboard-after-sign
 * Called from sign.html immediately after a contract is signed.
 * Verified by sign_token — no admin auth required.
 * For client contracts: creates clients row (if not exists), creates auth user,
 * links profile_id, generates password setup link, sends branded invite email.
 * Body: { sign_token, email, name, party_type }
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = 'Infinite Scale <platform@infinite-scale.be>';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Service key not configured' });

  const { sign_token, email, name, party_type } = req.body || {};
  if (!sign_token || !email) return res.status(400).json({ error: 'sign_token and email required' });

  const sbH = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

  // Step 1: Verify sign_token against DB
  const contractR = await fetch(`${SB_URL}/rest/v1/contracts?sign_token=eq.${encodeURIComponent(sign_token)}&select=id,party,party_type,email,type,value&limit=1`, { headers: sbH });
  const contracts = await contractR.json();
  const contract = contracts?.[0];
  if (!contract) return res.status(403).json({ error: 'Invalid sign token' });

  const resolvedEmail = email || contract.email;
  const resolvedName = name || contract.party || resolvedEmail.split('@')[0];
  const resolvedPartyType = party_type || contract.party_type || 'client';

  // Only auto-onboard client contracts (not agents — they go through separate agent flow)
  if (resolvedPartyType !== 'client') {
    return res.status(200).json({ ok: true, skipped: true, reason: 'agent contracts handled separately' });
  }

  // Step 2: Create clients row if not already exists (match by email)
  let clientId;
  const existingR = await fetch(`${SB_URL}/rest/v1/clients?email=eq.${encodeURIComponent(resolvedEmail)}&select=id&limit=1`, { headers: sbH });
  const existing = await existingR.json();
  if (existing?.[0]?.id) {
    clientId = existing[0].id;
  } else {
    // Auto-generate a client ID
    const allClR = await fetch(`${SB_URL}/rest/v1/clients?select=id`, { headers: sbH });
    const allCl = await allClR.json();
    const maxNum = (allCl || []).reduce((m, c) => {
      const n = parseInt((c.id || '').replace(/\D/g, ''), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    const newClientId = 'c' + (maxNum + 1);
    const rate = contract.value ? Math.round(parseFloat(contract.value)) : 45;
    const today = new Date().toISOString().slice(0, 10);
    const newClientR = await fetch(`${SB_URL}/rest/v1/clients`, {
      method: 'POST',
      headers: { ...sbH, Prefer: 'return=representation' },
      body: JSON.stringify({
        id: newClientId,
        name: resolvedName,
        email: resolvedEmail,
        type: 'direct',
        status: 'starting',
        crm: 'none',
        crm_on: false,
        kickoff: today,
        rate,
        contact_person: resolvedName,
        company: resolvedName,
        bill_status: 'pending',
        subclients: [],
      }),
    });
    const newCl = await newClientR.json();
    clientId = newCl?.[0]?.id || newClientId;
  }

  // Step 3: Create or find Supabase auth user
  let userId;
  const createR = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: sbH,
    body: JSON.stringify({ email: resolvedEmail, email_confirm: true }),
  });
  const createData = await createR.json();
  if (createR.ok && createData.id) {
    userId = createData.id;
  } else {
    const lookupR = await fetch(`${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(resolvedEmail)}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const lookupData = await lookupR.json();
    userId = lookupData?.users?.[0]?.id;
    if (!userId) {
      console.error('Could not create/find auth user for', resolvedEmail, createData);
      return res.status(500).json({ error: 'Could not create auth user' });
    }
  }

  // Step 4: Upsert profile with role=client
  await fetch(`${SB_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...sbH, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: userId, name: resolvedName, email: resolvedEmail, role: 'client' }),
  });

  // Step 5: Link clients row to auth user
  await fetch(`${SB_URL}/rest/v1/clients?id=eq.${clientId}`, {
    method: 'PATCH',
    headers: { ...sbH, Prefer: 'return=minimal' },
    body: JSON.stringify({ profile_id: userId, email: resolvedEmail }),
  });

  // Step 6: Generate password setup link
  let setupUrl;
  const linkR = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: sbH,
    body: JSON.stringify({ type: 'recovery', email: resolvedEmail, redirect_to: 'https://platform.infinite-scale.be/reset-password' }),
  });
  if (linkR.ok) {
    const linkData = await linkR.json();
    const actionLink = linkData.action_link || '';
    const hashMatch = actionLink.match(/[?#](.+)$/);
    if (hashMatch) {
      const params = new URLSearchParams(hashMatch[1]);
      const at = params.get('access_token') || params.get('token');
      const rt = params.get('refresh_token') || '';
      if (at) {
        setupUrl = `https://platform.infinite-scale.be/reset-password#access_token=${at}&refresh_token=${rt}&type=recovery&new=1`;
      }
    }
    if (!setupUrl && linkR.hashed_token) {
      setupUrl = `${SB_URL}/auth/v1/verify?token=${linkR.hashed_token}&type=recovery&redirect_to=https://platform.infinite-scale.be/reset-password`;
    }
  }

  if (!setupUrl) {
    console.error('Failed to generate setup link for', resolvedEmail);
    return res.status(500).json({ error: 'Failed to generate setup link', userId, clientId });
  }

  // Step 7: Send branded invite email via Resend
  if (!RESEND_KEY || RESEND_KEY === 're_placeholder') {
    return res.status(200).json({ ok: true, userId, clientId, setupUrl, emailSent: false, warn: 'RESEND_API_KEY not configured' });
  }

  const html = `
<div style="background:#0a0e1a;padding:0;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:540px;margin:0 auto;padding:40px 24px;">
    <div style="margin-bottom:32px;">
      <span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#4ade80;font-weight:700;">Infinite Scale</span>
    </div>
    <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4ff;letter-spacing:-.02em;line-height:1.15;">Contract getekend — welkom, ${resolvedName}!</h1>
    <p style="margin:0 0 8px;font-size:15px;color:#8090b0;line-height:1.7;">Uw contract is succesvol ondertekend. Uw account op het Infinite Scale platform is aangemaakt.</p>
    <p style="margin:0 0 32px;font-size:15px;color:#8090b0;line-height:1.7;">Klik op de knop hieronder om uw wachtwoord in te stellen en direct in te loggen.</p>
    <a href="${setupUrl}" style="display:inline-block;padding:15px 36px;border-radius:12px;background:#4ade80;color:#071407;font-weight:800;font-size:15px;text-decoration:none;letter-spacing:-.01em;">Wachtwoord instellen →</a>
    <div style="margin-top:36px;padding:18px 20px;border-radius:12px;background:#111827;border:1px solid #1f2d3d;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#4a5a7a;letter-spacing:.08em;text-transform:uppercase;">Jouw inloggegevens</p>
      <p style="margin:0 0 4px;font-size:13px;color:#a0b0d0;">Platform: <a href="https://platform.infinite-scale.be" style="color:#4ade80;text-decoration:none;">platform.infinite-scale.be</a></p>
      <p style="margin:0;font-size:13px;color:#a0b0d0;">E-mail: <strong style="color:#f0f4ff;">${resolvedEmail}</strong></p>
    </div>
    <p style="margin-top:32px;font-size:12px;color:#2d3d55;line-height:1.6;">Deze link is 24 uur geldig. Vragen? Mail naar <a href="mailto:quinten@infinite-scale.be" style="color:#3d5070;text-decoration:none;">quinten@infinite-scale.be</a></p>
  </div>
</div>`;

  try {
    const emailR = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [resolvedEmail],
        subject: 'Contract getekend — stel uw wachtwoord in bij Infinite Scale',
        html,
      }),
    });
    const emailData = await emailR.json();
    if (!emailR.ok) {
      console.error('Resend error:', emailData);
      return res.status(200).json({ ok: true, userId, clientId, emailSent: false, emailError: emailData?.message });
    }
    return res.status(200).json({ ok: true, userId, clientId, emailSent: true });
  } catch (err) {
    console.error('onboard-after-sign email crash:', err);
    return res.status(200).json({ ok: true, userId, clientId, emailSent: false, emailError: err.message });
  }
}
