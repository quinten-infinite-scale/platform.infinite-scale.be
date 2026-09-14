/**
 * Generic email sender via Resend.
 * Called for: contract emails, onboarding emails, invoice reminders.
 * Body: { to, subject, html, replyTo? }
 * Contract notifications (unauthenticated, from sign.html):
 * Body: { contractNotify: true, type: 'viewed'|'signed', party, contractType, email, signerName?, timestamp }
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
