/**
 * POST /api/whatsapp/send-confirmation
 *
 * Called client-side immediately after a successful appointment insert (fire-and-forget).
 * Looks up the WhatsApp template for the appointment's client, sends a confirmation
 * to the lead's phone number, and logs the attempt in whatsapp_messages.
 *
 * Auth: Bearer CRON_SECRET (reuses the same secret as cron routes)
 *
 * Body: { appointmentId, clientId, leadName, phone, dateAppt }
 */

import { sendWhatsAppTemplate } from './send.js';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  return r.json();
}

async function sbPatch(table, query, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify(body),
  });
  return r.json();
}

async function sbInsert(table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(body),
  });
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  // Accept either CRON_SECRET (server-to-server) or a valid Supabase user JWT (browser)
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!auth) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const isCron = auth === process.env.CRON_SECRET;
  if (!isCron) {
    // Validate the Supabase JWT by calling the /auth/v1/user endpoint
    const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${auth}` },
    }).catch(() => null);
    if (!userRes || !userRes.ok) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const { appointmentId, clientId, leadName, phone, dateAppt } = req.body || {};
  if (!appointmentId || !clientId) {
    return res.status(400).json({ ok: false, error: 'appointmentId and clientId required' });
  }

  // Guard: don't re-send if confirmation already sent for this appointment
  const apptRows = await sbGet(`appointments?id=eq.${appointmentId}&select=id,confirmation_sent_at`).catch(() => []);
  const appt = Array.isArray(apptRows) ? apptRows[0] : null;
  if (appt?.confirmation_sent_at) {
    console.log(`[wa-confirm] Skipping ${appointmentId} — confirmation_sent_at already set`);
    return res.status(200).json({ ok: false, reason: 'already_sent' });
  }

  // Look up the client's WhatsApp template config
  const templates = await sbGet(`client_whatsapp_templates?client_id=eq.${clientId}&active=eq.true&limit=1`).catch(() => []);
  const tpl = Array.isArray(templates) ? templates[0] : null;
  if (!tpl) {
    console.warn(`[wa-confirm] No active template for client_id=${clientId} — skipping send`);
    return res.status(200).json({ ok: false, reason: 'no_template' });
  }

  // Build template variables: [leadName, date, time]
  // For hello_world (test template) there are no variables — variables will be empty.
  // For production templates, adjust the variable list to match the template's placeholders.
  let variables = [];
  if (tpl.template_name !== 'hello_world') {
    const dateStr = dateAppt ? dateAppt.slice(0, 10) : '';
    const timeStr = dateAppt && dateAppt.includes('T') ? dateAppt.slice(11, 16) : '';
    variables = [leadName || '', dateStr, timeStr].filter(Boolean).map(v => ({ type: 'text', text: String(v) }));
  }

  const { ok, messageId, error, normalizedPhone } = await sendWhatsAppTemplate(
    phone,
    tpl.template_name,
    tpl.template_language,
    variables,
  );

  const now = new Date().toISOString();

  // Log the attempt in whatsapp_messages regardless of success/failure
  await sbInsert('whatsapp_messages', {
    appointment_id: appointmentId,
    client_id: clientId,
    phone: normalizedPhone || phone || '',
    direction: 'outbound',
    message_type: 'confirmation',
    template_name: tpl.template_name,
    whatsapp_message_id: messageId || null,
    status: ok ? 'sent' : 'failed',
    status_updated_at: now,
    content: null,
    raw_payload: null,
  }).catch(err => console.error('[wa-confirm] Failed to insert whatsapp_messages:', err));

  if (!ok) {
    console.error(`[wa-confirm] Send failed for appt ${appointmentId}:`, error);
    return res.status(200).json({ ok: false, reason: 'send_failed', error });
  }

  // Mark confirmation_sent_at on the appointment
  await sbPatch('appointments', `?id=eq.${appointmentId}`, { confirmation_sent_at: now })
    .catch(err => console.error('[wa-confirm] Failed to set confirmation_sent_at:', err));

  console.log(`[wa-confirm] Sent confirmation for appt ${appointmentId}, messageId=${messageId}`);
  return res.status(200).json({ ok: true, messageId });
}
