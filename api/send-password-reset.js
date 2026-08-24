/**
 * Password reset endpoint — bulletproof version.
 *
 * Flow (always):
 * 1. Look up user by email via Supabase admin API
 * 2. Generate a random temp password
 * 3. Update the user password via admin API
 * 4. Verify the login actually works with the new password (sign-in test)
 * 5. Only if step 4 passes → send the email via Resend
 * 6. Return ok:true only when all 5 steps succeed
 *
 * We do NOT use Supabase's built-in /auth/v1/recover because that endpoint
 * returns 200 even when SMTP is not configured, silently queuing nothing.
 */

const SB_URL   = 'https://database.infinite-scale.be';
const SB_ANON  = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3ODI0NTQ1MTgsICJleHAiOiAxOTQwMTM0NTE4fQ.E3H9jIqXLe_BrrO7Qf-pWsrXPGXkqMP12ccRw561INQ';
const PLATFORM = 'https://platform.infinite-scale.be';
const FROM     = 'Infinite Scale <platform@infinite-scale.be>';

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  let p = '';
  for (let i = 0; i < 14; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const { email } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Valid email required.' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey  = process.env.RESEND_API_KEY;

  if (!serviceKey) return res.status(500).json({ ok: false, error: 'Server misconfigured (no service key).' });
  if (!resendKey || resendKey === 're_placeholder') return res.status(500).json({ ok: false, error: 'Server misconfigured (no email key).' });

  const sbHeaders = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // Step 1: Look up user via profiles table (reliable — admin email API is unreliable)
  const profileRes = await fetch(
    `${SB_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`,
    { headers: sbHeaders }
  );
  const profiles = await profileRes.json();
  const userId = profiles?.[0]?.id;

  if (!userId) {
    // Don't leak whether the email exists — always respond ok
    console.log('[send-password-reset] email not found (silent):', email);
    return res.status(200).json({ ok: true });
  }

  // Step 2: Generate temp password
  const tempPass = generatePassword();

  // Step 3: Update the user password via admin API
  const updateRes = await fetch(`${SB_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: sbHeaders,
    body: JSON.stringify({ password: tempPass }),
  });

  if (!updateRes.ok) {
    const err = await updateRes.json().catch(() => ({}));
    console.error('[send-password-reset] admin update failed:', err);
    return res.status(500).json({ ok: false, error: 'Password update failed. Try again.' });
  }

  // Step 4: Verify the new password actually works — sign in and confirm access_token
  const verifyRes = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SB_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: tempPass }),
  });
  const verifyData = await verifyRes.json();

  if (!verifyData.access_token) {
    console.error('[send-password-reset] verification sign-in failed for:', email, verifyData);
    return res.status(500).json({ ok: false, error: 'Password was set but could not be verified. Contact admin.' });
  }

  // Step 5: Send branded email — only reached if login was confirmed
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141820;border-radius:16px;overflow:hidden;border:1px solid #2a2e3a;">
      <tr><td style="padding:32px 36px 24px;border-bottom:1px solid #2a2e3a;">
        <span style="font-weight:700;font-size:17px;color:#f5f5f7;font-family:'Segoe UI',system-ui,sans-serif;">Infinite Scale</span>
      </td></tr>
      <tr><td style="padding:32px 36px;">
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#f5f5f7;">Je nieuwe wachtwoord</h1>
        <p style="margin:0 0 24px;font-size:15px;color:#8b909e;line-height:1.6;">
          Hieronder vind je je tijdelijke inloggegevens voor <strong style="color:#c8cdd8;">${email}</strong>.
          Log in en verander je wachtwoord meteen via <strong style="color:#c8cdd8;">Instellingen → Beveiliging</strong>.
        </p>
        <div style="background:#1e2330;border:1px solid #2e3344;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
          <div style="margin-bottom:14px;">
            <div style="font-size:11px;font-weight:700;color:#5b6070;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px;">Email</div>
            <div style="font-size:14px;color:#c8cdd8;font-family:'Courier New',monospace;">${email}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:#5b6070;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px;">Tijdelijk wachtwoord</div>
            <div style="font-size:22px;font-weight:700;color:#2dd4bf;font-family:'Courier New',monospace;letter-spacing:.06em;">${tempPass}</div>
          </div>
        </div>
        <a href="${PLATFORM}" style="display:block;text-align:center;background:#2dd4bf;color:#0a1f1c;font-weight:800;font-size:15px;text-decoration:none;border-radius:11px;padding:14px 24px;margin-bottom:24px;">
          Inloggen op platform →
        </a>
        <p style="margin:0;font-size:13px;color:#5b6070;line-height:1.6;">
          Dit wachtwoord werkt direct — dit is geverifieerd vóór het verzenden van deze e-mail.
          Neem contact op met Quinten als je nog steeds niet kunt inloggen.
        </p>
      </td></tr>
      <tr><td style="padding:20px 36px;border-top:1px solid #2a2e3a;">
        <p style="margin:0;font-size:12px;color:#3e4452;">© 2026 Infinite Scale · platform.infinite-scale.be</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: 'Je nieuwe login — Infinite Scale',
      html,
    }),
  });

  if (!emailRes.ok) {
    const emailErr = await emailRes.json().catch(() => ({}));
    console.error('[send-password-reset] Resend error:', emailErr);
    // Password IS set and verified — but email failed. Log it clearly.
    return res.status(500).json({ ok: false, error: 'Wachtwoord is ingesteld maar e-mail kon niet worden bezorgd. Contacteer admin.' });
  }

  console.log('[send-password-reset] Success — password set & verified & email delivered to:', email);
  return res.status(200).json({ ok: true });
}
