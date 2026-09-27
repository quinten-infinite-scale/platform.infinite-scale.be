/**
 * /api/webhook-meta — Meta (Facebook/Instagram) Lead Ads webhook receiver
 *
 * GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=... → webhook verification
 * POST → receive leadgen event, respond 200 immediately, process async
 *
 * Env vars required:
 *   META_WEBHOOK_VERIFY_TOKEN   — arbitrary string you set when registering the webhook
 *   META_APP_SECRET             — from your Meta App → Settings → Basic
 *   SUPABASE_SERVICE_ROLE_KEY   — already present
 *
 * The full lead data is fetched from the Graph API using the Page Access Token
 * stored in platform_settings under key 'meta_page_tokens' (a JSON object
 * { page_id: access_token }).
 */

import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
}

async function sbGet(table, qs = '') {
  const r = await fetch(`${SB_URL}/rest/v1/${table}${qs}`, { headers: sbHeaders() });
  return r.ok ? r.json().catch(() => []) : [];
}

async function sbUpsert(table, conflict, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
  return r.ok;
}

async function sbInsert(table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  return r.ok;
}

async function sbPatch(table, qs, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}${qs}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  return r.ok;
}

function uid() {
  return 'ml' + Date.now() + Math.random().toString(36).slice(2, 6);
}

// Verify Facebook's X-Hub-Signature-256 header
function verifySignature(rawBody, signature) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return true; // skip if not configured
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

// Fetch full lead data from Graph API
async function fetchLeadData(leadgenId, pageAccessToken) {
  const url = `https://graph.facebook.com/v19.0/${leadgenId}?fields=field_data,ad_id,form_id,created_time&access_token=${pageAccessToken}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Graph API ${r.status}: ${await r.text()}`);
  return r.json();
}

// Ingest one lead entry
async function processLead(entry) {
  const { leadgen_id, page_id, form_id } = entry;
  const logId = uid();
  const baseLog = { id: logId, leadgen_id, page_id, form_id: form_id || '', raw_payload: entry };

  // 1. Dedupe — if this leadgen_id already processed, skip
  const existing = await sbGet('meta_lead_log', `?leadgen_id=eq.${encodeURIComponent(leadgen_id)}&select=id,status`);
  if (existing && existing.length > 0) {
    console.log(`[webhook-meta] dedupe: ${leadgen_id} already processed`);
    return;
  }

  // 2. Load page access tokens from settings
  const settingRows = await sbGet('platform_settings', `?key=eq.meta_page_tokens&select=value`);
  const tokenMap = (() => {
    try { return JSON.parse(settingRows?.[0]?.value || '{}'); } catch(_) { return {}; }
  })();
  const pageToken = tokenMap[page_id];

  if (!pageToken) {
    console.error(`[webhook-meta] no page token for page ${page_id}`);
    await sbInsert('meta_lead_log', { ...baseLog, status: 'failed', error: `No access token for page ${page_id}`, processed_at: new Date().toISOString() });
    return;
  }

  // 3. Fetch full lead data
  let leadData;
  try {
    leadData = await fetchLeadData(leadgen_id, pageToken);
  } catch (err) {
    console.error(`[webhook-meta] graph fetch failed: ${err.message}`);
    await sbInsert('meta_lead_log', { ...baseLog, status: 'failed', error: err.message, processed_at: new Date().toISOString() });
    return;
  }

  // Flatten field_data into a simple { key: value } object
  const fields = {};
  for (const fd of (leadData.field_data || [])) {
    fields[fd.name] = Array.isArray(fd.values) ? fd.values[0] : fd.values;
  }

  // 4. Find the best mapping (exact form match first, then page wildcard)
  const mappingRows = await sbGet('meta_lead_mappings',
    `?facebook_page_id=eq.${encodeURIComponent(page_id)}&active=eq.true&order=facebook_form_id.desc.nullslast`
  );
  const mapping = mappingRows.find(m => m.facebook_form_id === form_id)
    || mappingRows.find(m => !m.facebook_form_id);

  const pipelineId  = mapping?.target_pipeline_id || 'meta_ads';
  const stageId     = mapping?.target_stage_id    || 'nieuwe_leads';
  const ownerId     = mapping?.owner_id            || null;
  const fieldMap    = (() => { try { return typeof mapping?.field_map === 'string' ? JSON.parse(mapping.field_map) : (mapping?.field_map || {}); } catch(_) { return {}; } })();
  const mappingId   = mapping?.id || null;
  const status      = mapping ? 'success' : 'unmapped';

  // 5. Map fields to CRM prospect fields
  // Built-in Facebook standard question names → our CRM fields
  const DEFAULT_FIELD_MAP = {
    full_name:    'contact',
    email:        'email',
    phone_number: 'phone',
    company_name: 'company',
  };
  const effectiveMap = { ...DEFAULT_FIELD_MAP, ...fieldMap };

  const prospectFields = {
    pipeline_id: pipelineId,
    stage: stageId,
    lead_id: leadgen_id,
    form_id: form_id || '',
    ad_id: leadData.ad_id || '',
    source: 'Meta forms',
    created_at: new Date().toISOString(),
  };

  if (ownerId) prospectFields.assigned = ownerId;

  // Map known fields
  for (const [fbKey, crmKey] of Object.entries(effectiveMap)) {
    if (fields[fbKey] !== undefined) prospectFields[crmKey] = fields[fbKey];
  }

  // Dump unmapped fields into notes so nothing is lost
  const unmappedPairs = Object.entries(fields)
    .filter(([k]) => !effectiveMap[k])
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  if (unmappedPairs) {
    prospectFields.notes = (prospectFields.notes ? prospectFields.notes + '\n\n' : '') + 'Meta form fields:\n' + unmappedPairs;
  }

  // Fall back to a name from any field containing "name"
  if (!prospectFields.contact) {
    const nameEntry = Object.entries(fields).find(([k]) => k.includes('name'));
    if (nameEntry) prospectFields.contact = nameEntry[1];
  }

  // 6. Create prospect (dedupe by leadgen_id just in case)
  const prospectId = 'p' + Date.now() + Math.random().toString(36).slice(2, 5);
  prospectFields.id = prospectId;

  await sbInsert('prospects', prospectFields);

  // 7. Log the ingestion
  await sbInsert('meta_lead_log', {
    ...baseLog,
    mapping_id: mappingId,
    prospect_id: prospectId,
    status,
    processed_at: new Date().toISOString(),
  });

  console.log(`[webhook-meta] ${status}: leadgen ${leadgen_id} → prospect ${prospectId} in ${pipelineId}/${stageId}`);
}

export default async function handler(req, res) {
  // Webhook verification (GET)
  if (req.method === 'GET') {
    const mode  = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode === 'subscribe' && token === expected) {
      console.log('[webhook-meta] webhook verified');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verification failed');
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Read raw body for signature verification
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  // Verify signature
  const sig = req.headers['x-hub-signature-256'] || '';
  if (!verifySignature(rawBody, sig)) {
    console.error('[webhook-meta] invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let body;
  try { body = JSON.parse(rawBody.toString('utf8')); } catch { return res.status(400).end(); }

  // Respond 200 immediately — Facebook times out at ~15s and retries
  res.status(200).json({ ok: true });

  // Process all leadgen changes asynchronously
  for (const pageEntry of (body.entry || [])) {
    for (const change of (pageEntry.changes || [])) {
      if (change.field !== 'leadgen') continue;
      const v = change.value || {};
      const lead = {
        leadgen_id: v.leadgen_id || String(v.lead_id || ''),
        page_id: v.page_id || pageEntry.id || '',
        form_id: v.form_id || '',
        ad_id: v.ad_id || '',
      };
      if (!lead.leadgen_id) continue;
      processLead(lead).catch(err => console.error('[webhook-meta] processLead error:', err));
    }
  }
}
