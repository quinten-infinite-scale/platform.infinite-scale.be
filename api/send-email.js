/**
 * Generic email sender via Resend.
 * Called for: contract emails, onboarding emails, invoice reminders, password resets.
 * Body: { to, subject, html, replyTo? }
 * Contract notifications (unauthenticated, from sign.html):
 * Body: { contractNotify: true, type: 'viewed'|'signed', party, contractType, email, signerName?, timestamp }
 * Password reset (unauthenticated, from reset-password.html):
 * Body: { passwordReset: true, email }
 */

const RESEND_KEY = process.env.RESEND_API_KEY;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FROM = 'Infinite Scale <platform@infinite-scale.be>';
const ADMIN_EMAIL = 'quinten@infinite-scale.be';

async function verifyToken(token) {
  if (!token) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + token },
  });
  if (!r.ok) return null;
  return r.json();
}

function buildContractNotifyEmail(body) {
  const { type, party, contractType, email, signerName, timestamp } = body;
  const isSign = type === 'signed';
  const subject = isSign ? `✅ Contract getekend — ${party}` : `👁 Contract bekeken — ${party}`;
  const html = isSign ? `
    <div style="font-family:sans-serif;background:#0f1117;color:#f0f4ff;padding:32px;border-radius:12px;max-width:500px;">
      <p style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#4ade80;font-weight:700;margin:0 0 8px;">Contract ondertekend</p>
      <h2 style="margin:0 0 16px;font-size:20px;">${signerName || party} heeft getekend</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
        <tr><td style="padding:8px 0;color:#5a6a8a;width:110px;">Naam</td><td style="color:#f0f4ff;font-weight:600;">${signerName || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">Partij</td><td style="color:#f0f4ff;font-weight:600;">${party}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">Type</td><td style="color:#f0f4ff;font-weight:600;">${contractType || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">E-mail</td><td style="color:#67dcdf;">${email || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">Tijdstip</td><td style="color:#f0f4ff;">${timestamp || ''}</td></tr>
      </table>
    </div>` : `
    <div style="font-family:sans-serif;background:#0f1117;color:#f0f4ff;padding:32px;border-radius:12px;max-width:500px;">
      <p style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#67dcdf;font-weight:700;margin:0 0 8px;">Contract bekeken</p>
      <h2 style="margin:0 0 16px;font-size:20px;">${party} heeft het contract geopend</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
        <tr><td style="padding:8px 0;color:#5a6a8a;width:110px;">Partij</td><td style="color:#f0f4ff;font-weight:600;">${party}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">Type</td><td style="color:#f0f4ff;font-weight:600;">${contractType || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">E-mail</td><td style="color:#67dcdf;">${email || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">Tijdstip</td><td style="color:#f0f4ff;">${timestamp || ''}</td></tr>
      </table>
      <p style="font-size:12px;color:#5a6a8a;margin:0;">Ze hebben nog niet getekend.</p>
    </div>`;
  return { subject, html };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://platform.infinite-scale.be');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const body = req.body || {};

  // Unauthenticated path: password reset request from reset-password.html
  if (body.passwordReset) {
    const email = (body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: 'email required' });
    if (!SERVICE_KEY) return res.status(500).json({ ok: false, error: 'server config error' });

    // Generate a recovery link via Supabase admin API
    let resetUrl;
    try {
      const r = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'recovery', email }),
      });
      if (!r.ok) {
        // Supabase returns 422 when user not found; return success anyway to avoid email enumeration
        return res.status(200).json({ ok: true });
      }
      const d = await r.json();
      // Route through the platform relay so the link always starts with platform.infinite-scale.be
      // and the hashed_token is exchanged server-side for a real JWT before landing on reset-password.
      const hashedToken = d.hashed_token || '';
      if (hashedToken) {
        resetUrl = `https://platform.infinite-scale.be/api/create-account?action=auth-redirect&token=${encodeURIComponent(hashedToken)}&type=recovery`;
      }
    } catch (err) {
      console.error('generate_link error:', err);
      return res.status(200).json({ ok: false, error: 'Failed to generate reset link' });
    }

    if (!resetUrl) return res.status(200).json({ ok: true }); // silent: user not found

    if (!RESEND_KEY || RESEND_KEY === 're_placeholder') {
      return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not configured' });
    }

    const html = `
      <div style="font-family:sans-serif;background:#0f1117;color:#f0f4ff;padding:32px;border-radius:12px;max-width:500px;">
        <p style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#67dcdf;font-weight:700;margin:0 0 8px;">Infinite Scale</p>
        <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;">Wachtwoord opnieuw instellen</h2>
        <p style="color:#a0b0d0;font-size:14px;margin:0 0 24px;line-height:1.6;">Klik op de knop hieronder om een nieuw wachtwoord in te stellen. Deze link is 1 uur geldig.</p>
        <a href="${resetUrl}" style="display:inline-block;padding:13px 28px;border-radius:10px;background:#67dcdf;color:#0c1a1c;font-weight:800;font-size:14px;text-decoration:none;">Wachtwoord instellen</a>
        <p style="margin-top:24px;font-size:12px;color:#5a6a8a;">Als je dit niet hebt aangevraagd, kan je deze e-mail negeren.</p>
      </div>`;

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [email], subject: 'Wachtwoord opnieuw instellen — Infinite Scale', html }),
      });
      return res.status(200).json(r.ok ? { ok: true } : { ok: false, error: 'Failed to send email' });
    } catch (err) {
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  // Welcome email — fired from reset-password.html after first-time account activation (new=1)
  if (body.welcomeEmail) {
    const at = (body.accessToken || '').trim();
    if (!at || !SERVICE_KEY) return res.status(200).json({ ok: false, error: 'missing params' });
    let userEmail, userId, role, userName;
    try {
      const uR = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${at}` } });
      if (!uR.ok) return res.status(200).json({ ok: false, error: 'invalid token' });
      const u = await uR.json();
      userEmail = u?.email; userId = u?.id;
      if (!userEmail || !userId) return res.status(200).json({ ok: false, error: 'no user data' });
      const pR = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${userId}&select=role,name&limit=1`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
      const profiles = pR.ok ? await pR.json() : [];
      role = profiles?.[0]?.role || 'client';
      userName = profiles?.[0]?.name || userEmail.split('@')[0];
    } catch (err) { return res.status(200).json({ ok: false, error: err.message }); }
    if (!RESEND_KEY || RESEND_KEY === 're_placeholder') return res.status(200).json({ ok: false, error: 'RESEND_API_KEY not configured' });
    const isAgent = role === 'agent';
    const featureRows = isAgent
      ? ['📅 Jouw dagelijkse afspraken en to-do\'s', '📊 Live prestatie-overzicht per week', '🎯 Coaching & feedback van je manager', '💬 WhatsApp-berichten en klantcontact']
      : ['📊 Campagneresultaten per callagent', '📅 Alle geplande en afgehandelde afspraken', '🧾 Facturen en betalingsoverzicht', '💬 Direct contact met je accountmanager'];
    const desc = isAgent
      ? 'Via het platform volg je je afspraken, dagelijkse opdrachten en prestaties — alles op één plek.'
      : 'Via het klantportaal volg je jouw campagneresultaten, afspraken en facturen — volledig transparant en in real-time.';
    const html = `<div style="background:#0a0e1a;padding:0;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:540px;margin:0 auto;padding:40px 24px;"><div style="margin-bottom:28px;"><span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#4ade80;font-weight:700;">Infinite Scale</span></div><h1 style="margin:0 0 10px;font-size:26px;font-weight:700;color:#f0f4ff;letter-spacing:-.02em;line-height:1.2;">Welkom bij Infinite Scale, ${userName}! 🎉</h1><p style="margin:0 0 28px;font-size:15px;color:#8090b0;line-height:1.7;">${desc}</p><div style="margin-bottom:28px;">${featureRows.map(f => `<div style="padding:10px 14px;margin-bottom:6px;border-radius:10px;background:#111827;border:1px solid #1f2d3d;font-size:13.5px;color:#c0d0e8;">${f}</div>`).join('')}</div><a href="https://platform.infinite-scale.be" style="display:inline-block;padding:14px 34px;border-radius:12px;background:#4ade80;color:#071407;font-weight:800;font-size:15px;text-decoration:none;letter-spacing:-.01em;">Naar het platform →</a><p style="margin-top:32px;font-size:12px;color:#2d3d55;line-height:1.6;">Vragen? Mail naar <a href="mailto:quinten@infinite-scale.be" style="color:#3d5070;text-decoration:none;">quinten@infinite-scale.be</a></p></div></div>`;
    try {
      const er = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [userEmail], subject: 'Welkom bij Infinite Scale! 🎉', html }) });
      return res.status(200).json({ ok: er.ok });
    } catch (err) { return res.status(200).json({ ok: false, error: err.message }); }
  }

  // Unauthenticated path: contract view/sign notifications from sign.html
  if (body.contractNotify) {
    if (!body.type || !body.party) return res.status(400).json({ ok: false, error: 'type and party required' });
    if (!RESEND_KEY || RESEND_KEY === 're_placeholder') return res.status(500).json({ ok: false });
    const { subject, html } = buildContractNotifyEmail(body);
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [ADMIN_EMAIL], subject, html }),
      });
      const data = await r.json();
      return res.status(200).json(r.ok ? { ok: true } : { ok: false, error: data });
    } catch (err) {
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  // Authenticated path: all other email sends
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const user = await verifyToken(token);
  if (!user || !user.id) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const { to, subject, html, replyTo } = body;
  if (!to || !subject || !html) {
    return res.status(400).json({ ok: false, error: 'to, subject and html are required' });
  }

  if (!RESEND_KEY || RESEND_KEY === 're_placeholder') {
    return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not configured' });
  }

  try {
    const payload = {
      from: FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    };
    if (replyTo) payload.reply_to = replyTo;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Resend error:', data);
      return res.status(200).json({ ok: false, error: data?.message || JSON.stringify(data) });
    }
    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('send-email crash:', err);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
