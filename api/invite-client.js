/**
 * POST /api/invite-client
 * Creates a client auth account and sends a branded onboarding email with a password setup link.
 * Body: { email, name, clientId? }
 * Auth: admin bearer token required
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = 'Infinite Scale <platform@infinite-scale.be>';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://platform.infinite-scale.be');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Service key not configured' });

  // Require admin auth
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const userR = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userR.ok) return res.status(401).json({ error: 'Unauthorized' });
  const authUser = await userR.json();
  const profileR = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${authUser.id}&select=role&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const profiles = await profileR.json();
  if (!profiles?.[0] || profiles[0].role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { email, name, clientId } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  const sbH = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

  // Step 1: Create auth user (or find existing)
  let userId;
  const createR = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: sbH,
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const createData = await createR.json();
  if (createR.ok && createData.id) {
    userId = createData.id;
  } else {
    // Already exists — find by email
    const lookupR = await fetch(`${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const lookupData = await lookupR.json();
    userId = lookupData?.users?.[0]?.id;
    if (!userId) return res.status(500).json({ error: 'Could not create or find user', detail: createData });
  }

  // Step 2: Upsert profile with role=client
  await fetch(`${SB_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...sbH, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: userId, name: name || email.split('@')[0], email, role: 'client' }),
  });

  // Step 3: Link clients row by clientId or email
  if (clientId) {
    await fetch(`${SB_URL}/rest/v1/clients?id=eq.${clientId}`, {
      method: 'PATCH',
      headers: { ...sbH, Prefer: 'return=minimal' },
      body: JSON.stringify({ profile_id: userId, email }),
    });
  } else {
    const clR = await fetch(`${SB_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}&limit=1`, { headers: sbH });
    const cls = await clR.json();
    if (cls?.[0]?.id) {
      await fetch(`${SB_URL}/rest/v1/clients?id=eq.${cls[0].id}`, {
        method: 'PATCH',
        headers: { ...sbH, Prefer: 'return=minimal' },
        body: JSON.stringify({ profile_id: userId }),
      });
    }
  }

  // Step 4: Generate password setup link via platform redirect (never exposes database.infinite-scale.be)
  let setupUrl;
  const linkR = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: sbH,
    body: JSON.stringify({ type: 'recovery', email }),
  });
  if (linkR.ok) {
    const linkData = await linkR.json();
    const hashedToken = linkData.hashed_token;
    if (hashedToken) {
      setupUrl = `https://platform.infinite-scale.be/api/auth-redirect?token=${encodeURIComponent(hashedToken)}&type=recovery&new=1`;
    }
  }

  if (!setupUrl) {
    console.error('Failed to generate setup link for', email);
    return res.status(500).json({ error: 'Failed to generate setup link', userId });
  }

  // Step 5: Send branded welcome email via Resend
  if (!RESEND_KEY || RESEND_KEY === 're_placeholder') {
    return res.status(200).json({ ok: true, userId, setupUrl, emailSent: false, warn: 'RESEND_API_KEY not configured' });
  }

  const displayName = name || email.split('@')[0];
  const html = `
<div style="background:#0a0e1a;padding:0;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:540px;margin:0 auto;padding:40px 24px;">
    <!-- Logo -->
    <div style="margin-bottom:32px;">
      <span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#67dcdf;font-weight:700;">Infinite Scale</span>
    </div>
    <!-- Heading -->
    <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4ff;letter-spacing:-.02em;line-height:1.15;">Welkom, ${displayName}!</h1>
    <p style="margin:0 0 32px;font-size:15px;color:#8090b0;line-height:1.7;">Je account op het Infinite Scale platform is aangemaakt. Klik op de knop hieronder om je wachtwoord in te stellen en direct aan de slag te gaan.</p>
    <!-- CTA -->
    <a href="${setupUrl}" style="display:inline-block;padding:15px 36px;border-radius:12px;background:#67dcdf;color:#071314;font-weight:800;font-size:15px;text-decoration:none;letter-spacing:-.01em;">Wachtwoord instellen →</a>
    <!-- Info box -->
    <div style="margin-top:36px;padding:18px 20px;border-radius:12px;background:#111827;border:1px solid #1f2d3d;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#4a5a7a;letter-spacing:.08em;text-transform:uppercase;">Jouw inloggegevens</p>
      <p style="margin:0 0 4px;font-size:13px;color:#a0b0d0;">Platform: <a href="https://platform.infinite-scale.be" style="color:#67dcdf;text-decoration:none;">platform.infinite-scale.be</a></p>
      <p style="margin:0;font-size:13px;color:#a0b0d0;">E-mail: <strong style="color:#f0f4ff;">${email}</strong></p>
    </div>
    <!-- Footer -->
    <p style="margin-top:32px;font-size:12px;color:#2d3d55;line-height:1.6;">Deze link is 24 uur geldig. Vragen? Stuur een mail naar <a href="mailto:quinten@infinite-scale.be" style="color:#3d5070;text-decoration:none;">quinten@infinite-scale.be</a></p>
  </div>
</div>`;

  try {
    const emailR = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: 'Welkom bij Infinite Scale — stel je wachtwoord in',
        html,
      }),
    });
    const emailData = await emailR.json();
    if (!emailR.ok) {
      console.error('Resend error:', emailData);
      return res.status(200).json({ ok: true, userId, emailSent: false, emailError: emailData?.message });
    }
    return res.status(200).json({ ok: true, userId, emailSent: true });
  } catch (err) {
    console.error('invite-client email crash:', err);
    return res.status(200).json({ ok: true, userId, emailSent: false, emailError: err.message });
  }
}
