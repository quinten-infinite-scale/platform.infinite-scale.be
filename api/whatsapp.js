/**
 * /api/whatsapp — consolidated WhatsApp dispatcher (Hobby plan: counts as 1 function)
 *
 * Routes:
 *   GET  ?hub.mode=subscribe  — Meta webhook verification handshake
 *   GET  (no hub.mode)        — Send reminders cron  [Bearer CRON_SECRET]
 *   POST X-Hub-Signature-256  — Meta inbound webhook (delivery status + replies)
 *   POST (no signature)       — Send confirmation    [Bearer CRON_SECRET or Supabase JWT]
 */

import crypto from 'crypto';
import { sendWhatsAppTemplate } from '../lib/whatsapp.js';

// Disable body parser so we can read raw body for Meta signature verification
export const config = { api: { bodyParser: false } };

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
  await fetch(`${SB_URL}/rest/v1/${table}${query}`, { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(body) });
}
async function sbInsert(table, body) {
  await fetch(`${SB_URL}/rest/v1/${table}`, { method: 'POST', headers: sbHeaders(), body: JSON.stringify(body) });
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifyMetaSignature(rawBody, signatureHeader) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader)); } catch { return false; }
}

// ─── GET handler ─────────────────────────────────────────────────────────────

async function handleGet(req, res) {
  // Meta hub challenge
  if (req.query['hub.mode']) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log('[wa] Webhook verified');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  // Reminders cron
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const tplRows = await sbGet('client_whatsapp_templates?active=eq.true').catch(() => []);
  if (!Array.isArray(tplRows) || tplRows.length === 0) {
    return res.status(200).json({ ok: true, sent: 0, reason: 'No active templates configured' });
  }
  const tplByClient = {};
  for (const t of tplRows) tplByClient[t.client_id] = t;

  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  const apptRows = await sbGet(
    `appointments?confirmation_sent_at=not.is.null&reminder_sent_at=is.null` +
    `&date_appt=gt.${nowIso}&date_appt=lt.${inSevenDays}` +
    `&status=not.in.(cancel,no_show)` +
    `&select=id,client_id,lead_name,phone,date_appt`
  ).catch(() => []);

  if (!Array.isArray(apptRows) || apptRows.length === 0) {
    return res.status(200).json({ ok: true, sent: 0, reason: 'No appointments due for reminder' });
  }

  const results = [];
  for (const appt of apptRows) {
    const tpl = tplByClient[appt.client_id];
    if (!tpl) { results.push({ id: appt.id, skipped: 'no_template' }); continue; }

    const hoursUntil = (new Date(appt.date_appt) - now) / (1000 * 60 * 60);
    if (hoursUntil > tpl.reminder_hours_before) continue;

    const sentAt = new Date().toISOString();
    await sbPatch('appointments', `?id=eq.${appt.id}`, { reminder_sent_at: sentAt }).catch(() => {});

    let variables = [];
    if (tpl.template_name !== 'hello_world') {
      const dateStr = appt.date_appt ? appt.date_appt.slice(0, 10) : '';
      const timeStr = appt.date_appt?.includes('T') ? appt.date_appt.slice(11, 16) : '';
      variables = [appt.lead_name || '', dateStr, timeStr].filter(Boolean).map(v => ({ type: 'text', text: String(v) }));
    }

    const { ok, messageId, error, normalizedPhone } = await sendWhatsAppTemplate(appt.phone, tpl.template_name, tpl.template_language, variables);

    await sbInsert('whatsapp_messages', {
      appointment_id: appt.id, client_id: appt.client_id,
      phone: normalizedPhone || appt.phone || '', direction: 'outbound', message_type: 'reminder',
      template_name: tpl.template_name, whatsapp_message_id: messageId || null,
      status: ok ? 'sent' : 'failed', status_updated_at: sentAt, content: null, raw_payload: null,
    }).catch(() => {});

    results.push({ id: appt.id, ok, messageId, error });
  }

  return res.status(200).json({ ok: true, sent: results.filter(r => r.ok).length, results });
}

// ─── POST handler ─────────────────────────────────────────────────────────────

async function handlePost(req, res, rawBody) {
  const signature = req.headers['x-hub-signature-256'] || '';

  // Meta inbound webhook
  if (signature) {
    if (!verifyMetaSignature(rawBody, signature)) {
      console.warn('[wa] Signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    let payload;
    try { payload = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

    const now = new Date().toISOString();
    for (const entry of (payload?.entry || [])) {
      for (const change of (entry?.changes || [])) {
        const value = change?.value || {};

        for (const s of (value?.statuses || [])) {
          if (!s?.id || !s?.status) continue;
          await sbPatch('whatsapp_messages', `?whatsapp_message_id=eq.${encodeURIComponent(s.id)}`, { status: s.status, status_updated_at: now }).catch(() => {});
        }

        const contacts = value?.contacts || [];
        for (const msg of (value?.messages || [])) {
          const fromPhone = msg?.from;
          const content = msg?.type === 'text' ? (msg?.text?.body || '') : `[${msg?.type}]`;
          let appointmentId = null, clientId = null;
          if (fromPhone) {
            const apptRows = await sbGet(`appointments?phone=ilike.*${fromPhone.slice(-8)}*&select=id,client_id&order=created_at.desc&limit=1`).catch(() => []);
            const appt = Array.isArray(apptRows) ? apptRows[0] : null;
            if (appt) { appointmentId = appt.id; clientId = appt.client_id; }
          }
          await sbInsert('whatsapp_messages', {
            appointment_id: appointmentId, client_id: clientId,
            phone: fromPhone ? '+' + fromPhone : '', direction: 'inbound', message_type: 'reply',
            template_name: null, whatsapp_message_id: msg?.id || null,
            status: 'received', status_updated_at: now, content, raw_payload: msg,
          }).catch(() => {});
          console.log(`[wa] Inbound from ${fromPhone}, appt=${appointmentId}`);
        }
      }
    }
    return res.status(200).json({ ok: true });
  }

  // Send confirmation
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!auth) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const isCron = auth === process.env.CRON_SECRET;
  if (!isCron) {
    const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${auth}` },
    }).catch(() => null);
    if (!userRes || !userRes.ok) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  let body;
  try { body = JSON.parse(rawBody); } catch { return res.status(400).json({ ok: false, error: 'Invalid JSON' }); }

  // Free-text reply (admin typing back to a lead)
  if (body?.type === 'reply') {
    const { phone, text } = body;
    if (!phone || !text) return res.status(400).json({ ok: false, error: 'phone and text required' });
    const { normalizePhone } = await import('../lib/whatsapp.js');
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return res.status(400).json({ ok: false, error: 'Invalid phone number' });

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!accessToken || !phoneNumberId) return res.status(500).json({ ok: false, error: 'WhatsApp not configured' });

    const waRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizedPhone.replace('+', ''), type: 'text', text: { body: text } }),
    });
    const waData = await waRes.json().catch(() => ({}));
    if (!waRes.ok) return res.status(200).json({ ok: false, error: waData?.error?.message || JSON.stringify(waData) });

    const messageId = waData?.messages?.[0]?.id || null;
    const now = new Date().toISOString();
    await sbInsert('whatsapp_messages', {
      phone: normalizedPhone, direction: 'outbound', message_type: 'reply',
      content: text, whatsapp_message_id: messageId || null,
      status: 'sent', status_updated_at: now, template_name: null, raw_payload: null,
      appointment_id: null, client_id: null,
    }).catch(() => {});
    return res.status(200).json({ ok: true, messageId });
  }

  const { appointmentId, clientId, leadName, phone, dateAppt } = body || {};
  if (!appointmentId || !clientId) return res.status(400).json({ ok: false, error: 'appointmentId and clientId required' });

  const apptRows = await sbGet(`appointments?id=eq.${appointmentId}&select=id,confirmation_sent_at`).catch(() => []);
  const appt = Array.isArray(apptRows) ? apptRows[0] : null;
  if (appt?.confirmation_sent_at) return res.status(200).json({ ok: false, reason: 'already_sent' });

  const templates = await sbGet(`client_whatsapp_templates?client_id=eq.${clientId}&active=eq.true&limit=1`).catch(() => []);
  const tpl = Array.isArray(templates) ? templates[0] : null;
  if (!tpl) return res.status(200).json({ ok: false, reason: 'no_template' });

  let variables = [];
  if (tpl.template_name !== 'hello_world') {
    const dateStr = dateAppt ? dateAppt.slice(0, 10) : '';
    const timeStr = dateAppt?.includes('T') ? dateAppt.slice(11, 16) : '';
    variables = [leadName || '', dateStr, timeStr].filter(Boolean).map(v => ({ type: 'text', text: String(v) }));
  }

  const { ok, messageId, error, normalizedPhone } = await sendWhatsAppTemplate(phone, tpl.template_name, tpl.template_language, variables);
  const now = new Date().toISOString();

  await sbInsert('whatsapp_messages', {
    appointment_id: appointmentId, client_id: clientId,
    phone: normalizedPhone || phone || '', direction: 'outbound', message_type: 'confirmation',
    template_name: tpl.template_name, whatsapp_message_id: messageId || null,
    status: ok ? 'sent' : 'failed', status_updated_at: now, content: null, raw_payload: null,
  }).catch(() => {});

  if (!ok) return res.status(200).json({ ok: false, reason: 'send_failed', error });

  await sbPatch('appointments', `?id=eq.${appointmentId}`, { confirmation_sent_at: now }).catch(() => {});
  return res.status(200).json({ ok: true, messageId });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const rawBody = await getRawBody(req);
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res, rawBody);
  return res.status(405).end();
}
