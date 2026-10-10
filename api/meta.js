/**
 * /api/meta — Meta (Facebook/Instagram) Lead Ads: webhook + OAuth + Graph API proxy
 *
 * GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=... → webhook verification
 * GET  ?action=login_url          → OAuth dialog URL
 * GET  ?action=callback&code=...  → OAuth code exchange (browser redirect, no JWT)
 * GET  ?action=status             → connection status
 * GET  ?action=pages              → list managed pages
 * GET  ?action=forms&page_id=...  → list lead forms on a page
 * GET  ?action=subscribe&page_id=... → subscribe page to leadgen webhook
 * GET  ?action=disconnect         → remove stored tokens
 * POST → webhook event (leadgen), respond 200 immediately, process async
 *
 * Env vars required:
 *   META_APP_ID              META_APP_SECRET
 *   META_WEBHOOK_VERIFY_TOKEN
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_PLATFORM_URL — e.g. https://platform.infinite-scale.be
 */

import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || 'https://platform.infinite-scale.be';
const REDIRECT_URI = `${PLATFORM_URL}/api/meta-callback`;

const SCOPES = [
  'pages_show_list',
  'leads_retrieval',
  'pages_manage_ads',
  'pages_manage_metadata',
  'pages_read_engagement',
  'business_management',
].join(',');

// ── Supabase helpers ──────────────────────────────────────────────────────────

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
}

async function sbGet(table, qs = '') {
  const r = await fetch(`${SB_URL}/rest/v1/${table}${qs}`, { headers: sbHeaders() });
  return r.ok ? r.json().catch(() => []) : [];
}

async function sbInsert(table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  return r.ok;
}

async function getSetting(key) {
  const rows = await sbGet('platform_settings', `?key=eq.${encodeURIComponent(key)}&select=value`);
  const raw = rows?.[0]?.value;
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch(_) { return raw; }
}

async function saveSetting(key, value) {
  const r = await fetch(`${SB_URL}/rest/v1/platform_settings?on_conflict=key`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value: typeof value === 'string' ? value : JSON.stringify(value) }),
  });
  return r.ok;
}

async function verifyAdminToken(req) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json().catch(() => null) : null;
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────

async function exchangeCodeForToken(code) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const shortR = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`
  );
  if (!shortR.ok) throw new Error(`Token exchange failed: ${await shortR.text()}`);
  const { access_token: shortToken } = await shortR.json();

  const longR = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`
  );
  if (!longR.ok) throw new Error(`Long-lived token exchange failed: ${await longR.text()}`);
  const longData = await longR.json();

  const meR = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${longData.access_token}`);
  const meData = meR.ok ? await meR.json().catch(() => ({})) : {};
  return { token: longData.access_token, expires_in: longData.expires_in, user_id: meData.id, user_name: meData.name };
}

async function getPageTokens(userToken) {
  const r = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${userToken}`);
  if (!r.ok) throw new Error(`pages fetch failed: ${r.status}`);
  const data = await r.json();
  return (data.data || []).map(p => ({ id: p.id, name: p.name, access_token: p.access_token }));
}

async function subscribePageToLeadgen(pageId, pageToken) {
  const r = await fetch(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscribed_fields: ['leadgen'], access_token: pageToken }),
  });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

// ── Webhook helpers ───────────────────────────────────────────────────────────

function verifySignature(rawBody, signature) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return true;
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch(_) { return false; }
}

async function fetchLeadData(leadgenId, pageAccessToken) {
  const r = await fetch(`https://graph.facebook.com/v19.0/${leadgenId}?fields=field_data,ad_id,form_id,created_time&access_token=${pageAccessToken}`);
  if (!r.ok) throw new Error(`Graph API ${r.status}: ${await r.text()}`);
  return r.json();
}

async function processLead(entry) {
  const { leadgen_id, page_id, form_id } = entry;
  const logId = 'ml' + Date.now() + Math.random().toString(36).slice(2, 6);
  const baseLog = { id: logId, leadgen_id, page_id, form_id: form_id || '', raw_payload: entry };

  const existing = await sbGet('meta_lead_log', `?leadgen_id=eq.${encodeURIComponent(leadgen_id)}&select=id,status`);
  if (existing && existing.length > 0) return;

  const settingRows = await sbGet('platform_settings', `?key=eq.meta_page_tokens&select=value`);
  const tokenMap = (() => { try { return JSON.parse(settingRows?.[0]?.value || '{}'); } catch(_) { return {}; } })();
  const pageToken = tokenMap[page_id];
  if (!pageToken) {
    await sbInsert('meta_lead_log', { ...baseLog, status: 'failed', error: `No access token for page ${page_id}`, processed_at: new Date().toISOString() });
    return;
  }

  let leadData;
  try { leadData = await fetchLeadData(leadgen_id, pageToken); }
  catch (err) {
    await sbInsert('meta_lead_log', { ...baseLog, status: 'failed', error: err.message, processed_at: new Date().toISOString() });
    return;
  }

  const fields = {};
  for (const fd of (leadData.field_data || [])) fields[fd.name] = Array.isArray(fd.values) ? fd.values[0] : fd.values;

  const mappingRows = await sbGet('meta_lead_mappings', `?facebook_page_id=eq.${encodeURIComponent(page_id)}&active=eq.true&order=facebook_form_id.desc.nullslast`);
  const mapping = mappingRows.find(m => m.facebook_form_id === form_id) || mappingRows.find(m => !m.facebook_form_id);

  const pipelineId = mapping?.target_pipeline_id || 'meta_ads';
  const stageId    = mapping?.target_stage_id    || 'new_lead';
  const ownerId    = mapping?.owner_id            || null;
  const fieldMap   = (() => { try { return typeof mapping?.field_map === 'string' ? JSON.parse(mapping.field_map) : (mapping?.field_map || {}); } catch(_) { return {}; } })();
  const mappingId  = mapping?.id || null;
  const status     = mapping ? 'success' : 'unmapped';

  const DEFAULT_FIELD_MAP = {
    full_name: 'contact',
    email: 'email',
    phone_number: 'phone',
    phone: 'phone',
    company_name: 'company',
    'is_je_sales-agenda_momenteel_voldoende_gevuld_met_b2b-afspraken?': 'form_agenda_vol',
    'heb_je_nu_de_capaciteit_(sales_team)_om_nieuwe_afspraken_effectief_te_lopen?': 'form_capaciteit',
    'wat_is_de_gemiddelde_waarde_van_een_deal_bij_jullie?': 'form_deal_waarde',
    'hoeveel_extra_afspraken_wil_je_per_week?': 'form_afspraken_pw',
  };
  const effectiveMap = { ...DEFAULT_FIELD_MAP, ...fieldMap };

  const prospectFields = {
    pipeline_id: pipelineId, stage: stageId,
    lead_id: leadgen_id, form_id: form_id || '', ad_id: leadData.ad_id || '',
    lead_source: 'Meta Ads', source: 'Meta forms', created_at: new Date().toISOString(),
  };
  if (ownerId) prospectFields.assigned = ownerId;

  for (const [fbKey, crmKey] of Object.entries(effectiveMap)) {
    if (fields[fbKey] !== undefined) prospectFields[crmKey] = fields[fbKey];
  }

  const unmappedPairs = Object.entries(fields).filter(([k]) => !effectiveMap[k]).map(([k, v]) => `${k}: ${v}`).join('\n');
  if (unmappedPairs) prospectFields.notes = (prospectFields.notes ? prospectFields.notes + '\n\n' : '') + 'Meta form fields:\n' + unmappedPairs;

  if (!prospectFields.contact) {
    const nameEntry = Object.entries(fields).find(([k]) => k.includes('name'));
    if (nameEntry) prospectFields.contact = nameEntry[1];
  }

  const prospectId = 'p' + Date.now() + Math.random().toString(36).slice(2, 5);
  prospectFields.id = prospectId;
  await sbInsert('prospects', prospectFields);
  await sbInsert('meta_lead_log', { ...baseLog, mapping_id: mappingId, prospect_id: prospectId, status, processed_at: new Date().toISOString() });
  console.log(`[meta] ${status}: leadgen ${leadgen_id} → prospect ${prospectId} in ${pipelineId}/${stageId}`);
  // Push notification to admin so the bell lights up instantly
  const leadName = prospectFields.contact || prospectFields.company || 'Onbekend';
  const leadCo = prospectFields.company ? ` (${prospectFields.company})` : '';
  await sbInsert('notifications', {
    id: 'n' + Date.now() + Math.random().toString(36).slice(2, 5),
    target_role: 'admin',
    text: `🎯 Nieuwe Meta Ads lead: ${leadName}${leadCo}`,
    kind: 'lead',
    read: false,
    time: new Date().toISOString().slice(0, 16).replace('T', ' '),
    meta: JSON.stringify({ route: 'prospect_crm', pipeline: pipelineId }),
  }).catch(() => {});

  // Email notification to admin
  const resendKey = process.env.RESEND_API_KEY || 're_UoW1atGD_56JJUPBHaP8dYjmbbzB28JZw';
  const phone = prospectFields.phone ? `<br>📞 ${prospectFields.phone}` : '';
  const email = prospectFields.email ? `<br>📧 ${prospectFields.email}` : '';
  fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Infinite Scale Platform <noreply@infinite-scale.be>',
      to: ['quinten@infinite-scale.be', 'senne.db@infinite-scale.be'],
      subject: `🎯 Nieuwe Meta Ads lead: ${leadName}${leadCo}`,
      html: `<p><strong>Nieuwe lead via Meta Ads</strong></p>
<p>👤 ${leadName}${leadCo}${phone}${email}</p>
<p>Pipeline: ${pipelineId} | Stage: ${stageId}</p>
<p><a href="https://platform.infinite-scale.be">Open Prospect CRM →</a></p>`,
    }),
  }).catch(() => {});
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', PLATFORM_URL);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Webhook POST ────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);

    // setup_token action — admin POST to store a user access token
    if (req.query?.action === 'setup_token') {
      const adminUser = await verifyAdminToken(req);
      if (!adminUser) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      let body2;
      try { body2 = JSON.parse(rawBody.toString('utf8')); } catch { body2 = {}; }
      const shortToken = body2.user_token;
      if (!shortToken) return res.status(400).json({ ok: false, error: 'user_token required in body' });
      try {
        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        const longR = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(shortToken)}`);
        if (!longR.ok) {
          const err2 = await longR.json().catch(() => ({}));
          return res.status(400).json({ ok: false, error: 'Token exchange failed', details: err2 });
        }
        const longData2 = await longR.json();
        const meR2 = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${longData2.access_token}`);
        const meData2 = meR2.ok ? await meR2.json().catch(() => ({})) : {};
        const pages2 = await getPageTokens(longData2.access_token);
        const pageTokenMap2 = Object.fromEntries(pages2.map(p => [p.id, p.access_token]));
        await Promise.all([
          saveSetting('meta_account', { user_id: meData2.id, user_name: meData2.name, token: longData2.access_token, expires_in: longData2.expires_in, connected_at: new Date().toISOString(), pages: pages2.map(p => ({ id: p.id, name: p.name })) }),
          saveSetting('meta_page_tokens', pageTokenMap2),
        ]);
        await Promise.all(pages2.map(p => subscribePageToLeadgen(p.id, p.access_token).catch(() => {})));
        return res.status(200).json({ ok: true, user_name: meData2.name, pages: pages2.map(p => ({ id: p.id, name: p.name })) });
      } catch (err2) {
        return res.status(500).json({ ok: false, error: err2.message });
      }
    }

    const sig = req.headers['x-hub-signature-256'] || '';
    if (!verifySignature(rawBody, sig)) return res.status(401).json({ error: 'Invalid signature' });

    let body;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch { return res.status(400).end(); }

    // Collect leads before responding so we can await them after
    const leads = [];
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
        if (lead.leadgen_id) leads.push(lead);
      }
    }

    res.status(200).json({ ok: true });

    // Await processing to keep the serverless function alive until done
    await Promise.all(leads.map(lead => processLead(lead).catch(err => console.error('[meta] processLead error:', err))));
    return;
  }

  if (req.method !== 'GET') return res.status(405).end();

  const { action, code, page_id } = req.query || {};

  // ── Webhook hub verification ────────────────────────────────────────────────
  if (req.query['hub.mode']) {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expected  = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode === 'subscribe' && token === expected) return res.status(200).send(challenge);
    return res.status(403).send('Verification failed');
  }

  // ── OAuth callback — browser redirect, no JWT ───────────────────────────────
  if (action === 'callback') {
    const error = req.query.error;
    if (error) return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_error=${encodeURIComponent(req.query.error_description || error)}`);
    if (!code) return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_error=no_code`);
    try {
      const tokenData = await exchangeCodeForToken(code);
      const pages = await getPageTokens(tokenData.token);
      const pageTokenMap = Object.fromEntries(pages.map(p => [p.id, p.access_token]));
      await Promise.all([
        saveSetting('meta_account', { user_id: tokenData.user_id, user_name: tokenData.user_name, token: tokenData.token, expires_in: tokenData.expires_in, connected_at: new Date().toISOString(), pages: pages.map(p => ({ id: p.id, name: p.name })) }),
        saveSetting('meta_page_tokens', pageTokenMap),
      ]);
      await Promise.all(pages.map(p => subscribePageToLeadgen(p.id, p.access_token).catch(() => {})));
      return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_connected=1`);
    } catch (err) {
      console.error('[meta] callback error:', err);
      return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_error=${encodeURIComponent(err.message)}`);
    }
  }

  // ── Cron action — re-subscribe all known pages (called by Vercel cron) ───────
  if (action === 'resubscribe') {
    const auth = req.headers['authorization'] || '';
    const cronSecret = process.env.CRON_SECRET;
    const isValidCron = cronSecret && auth === `Bearer ${cronSecret}`;
    const isValidQuery = req.query.secret && req.query.secret === cronSecret;
    if (!isValidCron && !isValidQuery) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const tokenMap = await getSetting('meta_page_tokens');
    if (!tokenMap) return res.status(200).json({ ok: true, message: 'no pages configured' });
    const results = await Promise.all(
      Object.entries(tokenMap).map(([pid, tok]) =>
        subscribePageToLeadgen(pid, tok).then(r => ({ page_id: pid, ...r })).catch(e => ({ page_id: pid, ok: false, error: e.message }))
      )
    );
    console.log('[meta] resubscribe cron:', results);
    return res.status(200).json({ ok: true, results });
  }

  // ── Admin actions — require JWT ─────────────────────────────────────────────
  const user = await verifyAdminToken(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  if (action === 'login_url') {
    const appId = process.env.META_APP_ID;
    if (!appId) return res.status(500).json({ ok: false, error: 'META_APP_ID not configured' });
    const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&response_type=code`;
    return res.status(200).json({ ok: true, url });
  }

  if (action === 'status') {
    const account = await getSetting('meta_account');
    if (!account) return res.status(200).json({ ok: true, connected: false });
    return res.status(200).json({ ok: true, connected: true, user_name: account.user_name, connected_at: account.connected_at, pages: account.pages || [] });
  }

  if (action === 'pages') {
    const account = await getSetting('meta_account');
    if (!account) return res.status(200).json({ ok: true, pages: [] });
    return res.status(200).json({ ok: true, pages: account.pages || [] });
  }

  if (action === 'forms') {
    if (!page_id) return res.status(400).json({ ok: false, error: 'page_id required' });
    const tokenMap = await getSetting('meta_page_tokens');
    const pageToken = tokenMap?.[page_id];
    if (!pageToken) return res.status(400).json({ ok: false, error: 'no token for this page' });
    const r = await fetch(`https://graph.facebook.com/v19.0/${page_id}/leadgen_forms?fields=id,name,status&limit=100&access_token=${pageToken}`);
    if (!r.ok) return res.status(200).json({ ok: false, error: `Graph API ${r.status}`, forms: [] });
    const data = await r.json().catch(() => ({ data: [] }));
    return res.status(200).json({ ok: true, forms: (data.data || []).map(f => ({ id: f.id, name: f.name, status: f.status })) });
  }

  if (action === 'subscribe') {
    if (!page_id) return res.status(400).json({ ok: false, error: 'page_id required' });
    const tokenMap = await getSetting('meta_page_tokens');
    const pageToken = tokenMap?.[page_id];
    if (!pageToken) return res.status(400).json({ ok: false, error: 'no token for this page' });
    const result = await subscribePageToLeadgen(page_id, pageToken);
    return res.status(200).json({ ok: result.ok, ...result.data });
  }

  if (action === 'disconnect') {
    await Promise.all([saveSetting('meta_account', null), saveSetting('meta_page_tokens', {})]);
    return res.status(200).json({ ok: true });
  }

  if (action === 'register_webhook') {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) return res.status(500).json({ ok: false, error: 'META_APP_ID or META_APP_SECRET not configured' });
    const appToken = `${appId}|${appSecret}`;
    const callbackUrl = `${PLATFORM_URL}/api/meta`;
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'infinitescale2026';
    const subUrl = `https://graph.facebook.com/v19.0/${appId}/subscriptions`;
    const body = new URLSearchParams({
      object: 'page',
      callback_url: callbackUrl,
      verify_token: verifyToken,
      fields: 'leadgen',
      access_token: appToken,
    });
    const r = await fetch(subUrl, { method: 'POST', body });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(400).json({ ok: false, error: 'Meta API error', details: data });
    console.log('[meta] register_webhook result:', data);
    return res.status(200).json({ ok: true, callback_url: callbackUrl, result: data });
  }

  if (action === 'test_lead') {
    // Creates a fake test lead prospect without calling the Meta Graph API
    const pageId = page_id || '789414644246156';
    const mappingRows = await sbGet('meta_lead_mappings', `?facebook_page_id=eq.${encodeURIComponent(pageId)}&active=eq.true&order=facebook_form_id.desc.nullslast`);
    const mapping = mappingRows[0] || null;
    const pipelineId = mapping?.target_pipeline_id || 'meta_ads';
    const stageId    = mapping?.target_stage_id    || 'new_lead';
    const ownerId    = mapping?.owner_id            || null;
    const mappingId  = mapping?.id || null;
    const testLeadgenId = 'test_' + Date.now();
    const prospectId = 'p' + Date.now() + 'test';
    const prospectFields = {
      id: prospectId,
      pipeline_id: pipelineId,
      stage: stageId,
      contact: 'Test Lead (Meta)',
      email: 'test@meta-lead.be',
      phone: '+32 499 000 000',
      company: 'Test Bedrijf BV',
      source: 'Meta Ads',
      notes: '[TEST LEAD] Aangemaakt via test_lead action om webhook flow te testen.',
    };
    if (ownerId) prospectFields.assigned = ownerId;
    await sbInsert('prospects', prospectFields);
    await sbInsert('meta_lead_log', {
      id: 'log_' + Date.now(),
      leadgen_id: testLeadgenId,
      page_id: pageId,
      form_id: 'test_form',
      raw_payload: { test: true },
      mapping_id: mappingId,
      prospect_id: prospectId,
      status: 'success',
      processed_at: new Date().toISOString(),
    });
    return res.status(200).json({ ok: true, prospect_id: prospectId, pipeline_id: pipelineId, stage: stageId, mapping_used: !!mapping });
  }

  if (action === 'sync_forms') {
    const pid = page_id || '789414644246156';
    const tokenMap = await getSetting('meta_page_tokens');
    const pageToken = tokenMap?.[pid];
    if (!pageToken) return res.status(400).json({ ok: false, error: 'No page token — reconnect Meta' });

    // Ensure form_name column exists
    try {
      await fetch(`${SB_URL}/pg/query`, {
        method: 'POST',
        headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: "ALTER TABLE meta_lead_mappings ADD COLUMN IF NOT EXISTS form_name TEXT DEFAULT NULL" }),
      });
    } catch(_) {}

    const formsR = await fetch(`https://graph.facebook.com/v19.0/${pid}/leadgen_forms?fields=id,name,status&limit=100&access_token=${pageToken}`);
    if (!formsR.ok) return res.status(200).json({ ok: false, error: `Graph API ${formsR.status}` });
    const formsData = await formsR.json().catch(() => ({ data: [] }));
    const activeForms = (formsData.data || []).filter(f => f.status === 'ACTIVE');

    const LABEL_TO_CRM = {
      'agenda': 'form_agenda_vol', 'gevuld': 'form_agenda_vol',
      'capaciteit': 'form_capaciteit', 'sales team': 'form_capaciteit',
      'waarde': 'form_deal_waarde', 'deal': 'form_deal_waarde',
      'afspraken': 'form_afspraken_pw', 'per week': 'form_afspraken_pw',
      'sector': 'form_sector', 'bouw': 'form_sector',
      'website': 'form_website', 'url': 'form_website',
      'bedrijfsnaam': 'company', 'company': 'company',
    };

    const synced = [];
    for (const form of activeForms) {
      // Fetch questions for this form
      let fieldMap = {};
      try {
        const qR = await fetch(`https://graph.facebook.com/v19.0/${form.id}?fields=questions&access_token=${pageToken}`);
        if (qR.ok) {
          const qData = await qR.json().catch(() => ({}));
          for (const q of (qData.questions || [])) {
            const key = q.key;
            const label = (q.label || '').toLowerCase();
            if (key === 'full_name') fieldMap[key] = 'contact';
            else if (key === 'email') fieldMap[key] = 'email';
            else if (key === 'phone_number' || key === 'phone') fieldMap[key] = 'phone';
            else if (key === 'company_name') fieldMap[key] = 'company';
            else {
              for (const [kw, crmField] of Object.entries(LABEL_TO_CRM)) {
                if (label.includes(kw)) { fieldMap[key] = crmField; break; }
              }
            }
          }
        }
      } catch(_) {}

      const mappingId = `map_${pid}_${form.id}`;
      const row = {
        id: mappingId,
        facebook_page_id: pid,
        facebook_form_id: form.id,
        form_name: form.name,
        target_pipeline_id: 'meta_ads',
        target_stage_id: 'new_lead',
        active: true,
        field_map: JSON.stringify(fieldMap),
      };

      const upsertR = await fetch(`${SB_URL}/rest/v1/meta_lead_mappings?on_conflict=id`, {
        method: 'POST',
        headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      });
      synced.push({ id: mappingId, form_id: form.id, form_name: form.name, ok: upsertR.ok });
    }

    return res.status(200).json({ ok: true, synced: synced.length, forms: synced });
  }

  return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
}
