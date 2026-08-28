/**
 * /api/whatsapp/webhook
 *
 * GET  — Meta webhook verification handshake
 * POST — Receives delivery status updates and inbound messages from Meta
 *
 * Env vars required:
 *   WHATSAPP_VERIFY_TOKEN   — arbitrary secret you set in Meta App Dashboard > Webhooks
 *   WHATSAPP_APP_SECRET     — Meta App Secret (used to verify X-Hub-Signature-256)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import crypto from 'crypto';

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

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  return r.json();
}

/**
 * Verify Meta's X-Hub-Signature-256 header.
 * Returns true if the payload matches the signature.
 */
function verifySignature(rawBody, signatureHeader) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return false; // If secret not configured, reject all
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

export const config = {
  api: {
    bodyParser: false, // We need raw body for signature verification
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  // --- GET: Meta verification handshake ---
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log('[wa-webhook] Webhook verified');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  // --- POST: Incoming events from Meta ---
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-hub-signature-256'] || '';

  if (!verifySignature(rawBody, signature)) {
    console.warn('[wa-webhook] Signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const now = new Date().toISOString();

  // Meta sends an array of entry objects, each with changes
  const entries = payload?.entry || [];
  for (const entry of entries) {
    const changes = entry?.changes || [];
    for (const change of changes) {
      const value = change?.value || {};

      // --- Delivery/read status updates ---
      const statuses = value?.statuses || [];
      for (const s of statuses) {
        const waMessageId = s?.id;
        const newStatus = s?.status; // 'sent' | 'delivered' | 'read' | 'failed'
        if (!waMessageId || !newStatus) continue;

        await sbPatch(
          'whatsapp_messages',
          `?whatsapp_message_id=eq.${encodeURIComponent(waMessageId)}`,
          { status: newStatus, status_updated_at: now }
        ).catch(err => console.error('[wa-webhook] Failed to update status:', err));
      }

      // --- Inbound messages from leads ---
      const messages = value?.messages || [];
      const contacts = value?.contacts || [];
      for (const msg of messages) {
        const fromPhone = msg?.from;     // E.164 without +
        const waMessageId = msg?.id;
        const msgType = msg?.type;       // 'text', 'audio', 'image', etc.
        const content = msgType === 'text' ? (msg?.text?.body || '') : `[${msgType}]`;
        const contactName = contacts.find(c => c.wa_id === fromPhone)?.profile?.name || null;

        // Try to find the most recent appointment for this phone number
        let appointmentId = null;
        let clientId = null;
        if (fromPhone) {
          // Search with and without leading + since phone may be stored in various formats
          const apptRows = await sbGet(
            `appointments?phone=ilike.*${fromPhone.slice(-8)}*&select=id,client_id&order=created_at.desc&limit=1`
          ).catch(() => []);
          const appt = Array.isArray(apptRows) ? apptRows[0] : null;
          if (appt) {
            appointmentId = appt.id;
            clientId = appt.client_id;
          }
        }

        await sbInsert('whatsapp_messages', {
          appointment_id: appointmentId,
          client_id: clientId,
          phone: fromPhone ? '+' + fromPhone : '',
          direction: 'inbound',
          message_type: 'reply',
          template_name: null,
          whatsapp_message_id: waMessageId || null,
          status: 'received',
          status_updated_at: now,
          content,
          raw_payload: msg,
        }).catch(err => console.error('[wa-webhook] Failed to insert inbound message:', err));

        console.log(`[wa-webhook] Inbound reply from ${fromPhone}, linked to appt=${appointmentId}`);
      }
    }
  }

  // Meta requires a 200 OK quickly, otherwise it retries
  return res.status(200).json({ ok: true });
}
