/**
 * Generic email sender via Resend.
 * Called for: contract emails, onboarding emails, invoice reminders.
 * Body: { to, subject, html, replyTo? }
 */

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = 'Infinite Scale <platform@infinite-scale.be>';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const { to, subject, html, replyTo } = req.body || {};
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
