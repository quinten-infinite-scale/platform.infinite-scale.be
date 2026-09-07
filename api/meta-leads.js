/**
 * /api/meta-leads — Meta Lead Ads webhook receiver
 *
 * GET  ?hub.mode=subscribe  — Meta webhook verification
 * POST X-Hub-Signature-256  — Lead arrival from Meta ads
 *
 * Configure in Meta Events Manager:
 *   Webhook URL:      https://platform.infinite-scale.be/api/meta-leads
 *   Verify token:     value of META_LEADS_VERIFY_TOKEN env var
 *   Subscribed fields: leadgen
 *
 * Leads land in the "meta_ads" pipeline (stage: new_lead).
 */

import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
}
async function sbPost(table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: 'POST', headers: sbHeaders(), body: JSON.stringify(body) });
  return r.json().catch(() => null);
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, sigHeader) {
  const secret = process.env.WHATSAPP_APP_SECRET; // Same Meta app secret
  if (!secret || !sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader)); } catch { return false; }
}

// Extract a field value from Meta's lead field_data array
function field(fieldData, name) {
  const f = (fieldData || []).find(x => x.field_name === name || x.field_name === name.toLowerCase());
  return f?.values?.[0] || '';
}

export default async function handler(req, res) {
  const rawBody = await getRawBody(req);

  // ── GET: Meta webhook verification ──────────────────────────────────────────
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.META_LEADS_VERIFY_TOKEN) {
      console.log('[meta-leads] Webhook verified');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  // ── POST: Lead arrival ───────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const sig = req.headers['x-hub-signature-256'] || '';
    if (!verifySignature(rawBody, sig)) {
      console.warn('[meta-leads] Signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let payload;
    try { payload = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

    console.log('[meta-leads] Received payload:', JSON.stringify(payload).slice(0, 500));

    for (const entry of (payload?.entry || [])) {
      for (const change of (entry?.changes || [])) {
        if (change?.field !== 'leadgen') continue;
        const val = change?.value || {};

        // Fetch lead details from Graph API
        const leadId = val.leadgen_id;
        const adName = val.ad_name || '';
        const adId = String(val.ad_id || '');
        const formId = String(val.form_id || '');
        const pageId = String(val.page_id || '');

        let fieldData = val.field_data || [];
        if (!fieldData.length && leadId) {
          // Fetch full lead details from Graph API
          const token = process.env.WHATSAPP_ACCESS_TOKEN;
          try {
            const gr = await fetch(`https://graph.facebook.com/v19.0/${leadId}?access_token=${token}&fields=field_data,created_time,ad_name,ad_id,form_id`);
            const gd = await gr.json();
            fieldData = gd?.field_data || [];
          } catch(err) {
            console.error('[meta-leads] Graph API fetch failed:', err.message);
          }
        }

        // Map common Meta form field names to our schema
        const company = field(fieldData, 'company_name') || field(fieldData, 'bedrijfsnaam') || field(fieldData, 'company') || '';
        const contact = field(fieldData, 'full_name') || field(fieldData, 'naam') || field(fieldData, 'name') || (field(fieldData, 'first_name') + ' ' + field(fieldData, 'last_name')).trim();
        const email = field(fieldData, 'email') || field(fieldData, 'work_email') || '';
        const phone = field(fieldData, 'phone_number') || field(fieldData, 'telefoonnummer') || field(fieldData, 'phone') || '';

        if (!company && !contact && !email) {
          console.warn('[meta-leads] No usable lead data, skipping');
          continue;
        }

        const row = {
          id: 'p' + Date.now() + Math.floor(Math.random() * 1000),
          pipeline_id: 'meta_ads',
          stage: 'new_lead',
          source: 'Meta forms',
          company: company || contact || 'Unknown',
          contact,
          email,
          phone,
          ad_name: adName,
          lead_id: String(leadId || ''),
          ad_id: adId,
          form_id: formId,
          assigned: '',
          status: 'new',
          notes: '',
          caller_note: '',
        };

        const result = await sbPost('prospects', row);
        console.log('[meta-leads] Inserted prospect:', company || contact, '| result:', JSON.stringify(result)?.slice(0, 200));
      }
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
