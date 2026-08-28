/**
 * GET /api/whatsapp/send-reminders
 *
 * Vercel Cron: runs every 30 minutes (see vercel.json).
 * Selects appointments that need a WhatsApp reminder and sends them.
 *
 * Idempotency: reminder_sent_at is SET on the appointment row BEFORE the
 * WhatsApp send returns. A second run of this cron cannot catch the same row
 * because the WHERE filter requires reminder_sent_at IS NULL.
 *
 * Auth: Bearer CRON_SECRET
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
  await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify(body),
  });
}

async function sbInsert(table, body) {
  await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(body),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ ok: false, error: 'Service key not configured' });

  // Load all active templates (keyed by client_id) so we can match per appointment
  const tplRows = await sbGet('client_whatsapp_templates?active=eq.true').catch(() => []);
  if (!Array.isArray(tplRows) || tplRows.length === 0) {
    return res.status(200).json({ ok: true, sent: 0, reason: 'No active templates configured' });
  }
  const tplByClient = {};
  for (const t of tplRows) tplByClient[t.client_id] = t;

  // Find appointments that:
  //   - have a confirmation sent
  //   - have not yet had a reminder sent
  //   - are not cancelled or no_show
  //   - have a future date_appt
  // We fetch ALL matching appointments and filter by reminder window client-side
  // because reminder_hours_before varies per client.
  const now = new Date();
  const nowIso = now.toISOString();

  // date_appt must be in the future — use a wide window (next 7 days) as a DB-side filter
  // and narrow further per client's reminder_hours_before after fetching.
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const apptRows = await sbGet(
    `appointments?confirmation_sent_at=not.is.null&reminder_sent_at=is.null` +
    `&date_appt=gt.${nowIso}&date_appt=lt.${inSevenDays}` +
    `&status=not.in.(cancel,no_show)` +
    `&select=id,client_id,sub_client_id,lead_name,phone,date_appt`
  ).catch(() => []);

  if (!Array.isArray(apptRows) || apptRows.length === 0) {
    return res.status(200).json({ ok: true, sent: 0, reason: 'No appointments due for reminder' });
  }

  const results = [];

  for (const appt of apptRows) {
    const tpl = tplByClient[appt.client_id];
    if (!tpl) {
      console.warn(`[wa-reminders] No template for client_id=${appt.client_id}, appt=${appt.id}`);
      results.push({ id: appt.id, skipped: 'no_template' });
      continue;
    }

    const apptTime = new Date(appt.date_appt);
    const hoursUntil = (apptTime - now) / (1000 * 60 * 60);

    if (hoursUntil > tpl.reminder_hours_before) {
      // Not yet within reminder window
      continue;
    }

    // IDEMPOTENCY: Set reminder_sent_at FIRST so a concurrent run cannot pick up the same row
    const sentAt = new Date().toISOString();
    await sbPatch('appointments', `?id=eq.${appt.id}`, { reminder_sent_at: sentAt })
      .catch(err => console.error(`[wa-reminders] Failed to mark reminder_sent_at for ${appt.id}:`, err));

    // Build variables for the reminder template
    let variables = [];
    if (tpl.template_name !== 'hello_world') {
      const dateStr = appt.date_appt ? appt.date_appt.slice(0, 10) : '';
      const timeStr = appt.date_appt && appt.date_appt.includes('T') ? appt.date_appt.slice(11, 16) : '';
      variables = [appt.lead_name || '', dateStr, timeStr].filter(Boolean).map(v => ({ type: 'text', text: String(v) }));
    }

    const { ok, messageId, error, normalizedPhone } = await sendWhatsAppTemplate(
      appt.phone,
      tpl.template_name,
      tpl.template_language,
      variables,
    );

    // Log the attempt
    await sbInsert('whatsapp_messages', {
      appointment_id: appt.id,
      client_id: appt.client_id,
      phone: normalizedPhone || appt.phone || '',
      direction: 'outbound',
      message_type: 'reminder',
      template_name: tpl.template_name,
      whatsapp_message_id: messageId || null,
      status: ok ? 'sent' : 'failed',
      status_updated_at: sentAt,
      content: null,
      raw_payload: null,
    }).catch(err => console.error(`[wa-reminders] Failed to insert whatsapp_messages for ${appt.id}:`, err));

    if (!ok) {
      console.error(`[wa-reminders] Send failed for appt ${appt.id}:`, error);
      results.push({ id: appt.id, ok: false, error });
    } else {
      console.log(`[wa-reminders] Sent reminder for appt ${appt.id}, messageId=${messageId}`);
      results.push({ id: appt.id, ok: true, messageId });
    }
  }

  return res.status(200).json({ ok: true, sent: results.filter(r => r.ok).length, results });
}
