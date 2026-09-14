/**
 * Unauthenticated endpoint for contract view/sign notifications.
 * Called from sign.html (public page, no user session).
 * Only ever sends to the hardcoded admin email — no user-supplied recipient.
 */

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = 'Infinite Scale <platform@infinite-scale.be>';
const ADMIN_EMAIL = 'quinten@infinite-scale.be';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://platform.infinite-scale.be');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const { type, party, contractType, email, signerName, timestamp } = req.body || {};
  if (!type || !party) return res.status(400).json({ ok: false, error: 'type and party required' });

  if (!RESEND_KEY || RESEND_KEY === 're_placeholder') {
    return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not configured' });
  }

  const isSign = type === 'signed';
  const subject = isSign
    ? `✅ Contract getekend — ${party}`
    : `👁 Contract bekeken — ${party}`;

  const html = isSign ? `
    <div style="font-family:sans-serif;background:#0f1117;color:#f0f4ff;padding:32px;border-radius:12px;max-width:500px;">
      <p style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#4ade80;font-weight:700;margin:0 0 8px;">Contract ondertekend</p>
      <h2 style="margin:0 0 16px;font-size:20px;">${signerName || party} heeft getekend</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
        <tr><td style="padding:8px 0;color:#5a6a8a;width:110px;">Naam</td><td style="color:#f0f4ff;font-weight:600;">${signerName || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">Partij</td><td style="color:#f0f4ff;font-weight:600;">${party}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">Type</td><td style="color:#f0f4ff;font-weight:600;">${contractType || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">E-mail</td><td style="color:#67dcdf;">${email || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">Tijdstip</td><td style="color:#f0f4ff;">${timestamp || new Date().toLocaleString('nl-BE')}</td></tr>
      </table>
    </div>` : `
    <div style="font-family:sans-serif;background:#0f1117;color:#f0f4ff;padding:32px;border-radius:12px;max-width:500px;">
      <p style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#67dcdf;font-weight:700;margin:0 0 8px;">Contract bekeken</p>
      <h2 style="margin:0 0 16px;font-size:20px;">${party} heeft het contract geopend</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
        <tr><td style="padding:8px 0;color:#5a6a8a;width:110px;">Partij</td><td style="color:#f0f4ff;font-weight:600;">${party}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">Type</td><td style="color:#f0f4ff;font-weight:600;">${contractType || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">E-mail</td><td style="color:#67dcdf;">${email || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#5a6a8a;">Tijdstip</td><td style="color:#f0f4ff;">${timestamp || new Date().toLocaleString('nl-BE')}</td></tr>
      </table>
      <p style="font-size:12px;color:#5a6a8a;margin:0;">Ze hebben nog niet getekend.</p>
    </div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [ADMIN_EMAIL], subject, html }),
    });
    const body = await r.json();
    if (!r.ok) return res.status(502).json({ ok: false, error: body });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
