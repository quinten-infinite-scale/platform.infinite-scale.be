/**
 * /api/meta-oauth — Meta OAuth flow + Graph API proxy
 *
 * GET ?action=login_url                → returns the OAuth dialog URL to redirect the user to
 * GET ?action=callback&code=...        → exchanges code for long-lived token, stores in platform_settings
 * GET ?action=status                   → returns connection status (connected account info)
 * GET ?action=pages                    → lists pages the connected account manages
 * GET ?action=forms&page_id=...        → lists lead forms on a page
 * GET ?action=subscribe&page_id=...    → subscribes a page to leadgen webhook events
 * GET ?action=disconnect               → removes stored tokens
 *
 * Env vars required:
 *   META_APP_ID              — from Meta App Dashboard
 *   META_APP_SECRET          — from Meta App Dashboard
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_PLATFORM_URL — e.g. https://platform.infinite-scale.be (for redirect URI)
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || 'https://platform.infinite-scale.be';
const REDIRECT_URI = `${PLATFORM_URL}/api/meta-oauth?action=callback`;

const SCOPES = [
  'pages_show_list',
  'leads_retrieval',
  'pages_manage_ads',
  'pages_manage_metadata',
  'pages_read_engagement',
  'business_management',
].join(',');

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
}

async function getSetting(key) {
  const r = await fetch(`${SB_URL}/rest/v1/platform_settings?key=eq.${encodeURIComponent(key)}&select=value`, { headers: sbHeaders() });
  const rows = r.ok ? await r.json().catch(() => []) : [];
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
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

// Exchange a short-lived code for a long-lived user access token
async function exchangeCodeForToken(code) {
  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  // First: get short-lived token
  const shortR = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`
  );
  if (!shortR.ok) throw new Error(`Token exchange failed: ${await shortR.text()}`);
  const shortData = await shortR.json();
  const shortToken = shortData.access_token;

  // Exchange for long-lived token (60 days)
  const longR = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`
  );
  if (!longR.ok) throw new Error(`Long-lived token exchange failed: ${await longR.text()}`);
  const longData = await longR.json();

  // Get the user's basic info
  const meR = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${longData.access_token}`);
  const meData = meR.ok ? await meR.json().catch(() => ({})) : {};

  return { token: longData.access_token, expires_in: longData.expires_in, user_id: meData.id, user_name: meData.name };
}

// Get a page-level access token (never expires) from user token
async function getPageTokens(userToken) {
  const r = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${userToken}`);
  if (!r.ok) throw new Error(`pages fetch failed: ${r.status}`);
  const data = await r.json();
  return (data.data || []).map(p => ({ id: p.id, name: p.name, access_token: p.access_token }));
}

// Subscribe a page to leadgen webhook events
async function subscribePageToLeadgen(pageId, pageToken) {
  const appId = process.env.META_APP_ID;
  const r = await fetch(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscribed_fields: ['leadgen'], access_token: pageToken }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', PLATFORM_URL);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, code, page_id } = req.query || {};

  // OAuth callback — called by Facebook, no user JWT (browser redirect)
  if (action === 'callback') {
    const state = req.query.state || '';
    const error = req.query.error;

    if (error) {
      // Redirect back to settings with error
      return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_error=${encodeURIComponent(req.query.error_description || error)}`);
    }

    if (!code) return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_error=no_code`);

    try {
      const tokenData = await exchangeCodeForToken(code);
      const pages = await getPageTokens(tokenData.token);

      // Store user token and per-page tokens
      const pageTokenMap = Object.fromEntries(pages.map(p => [p.id, p.access_token]));
      const accountInfo = {
        user_id: tokenData.user_id,
        user_name: tokenData.user_name,
        token: tokenData.token,
        expires_in: tokenData.expires_in,
        connected_at: new Date().toISOString(),
        pages: pages.map(p => ({ id: p.id, name: p.name })),
      };

      await Promise.all([
        saveSetting('meta_account', accountInfo),
        saveSetting('meta_page_tokens', pageTokenMap),
      ]);

      // Auto-subscribe all pages to leadgen webhooks
      await Promise.all(pages.map(p => subscribePageToLeadgen(p.id, p.access_token).catch(() => {})));

      return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_connected=1`);
    } catch (err) {
      console.error('[meta-oauth] callback error:', err);
      return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_error=${encodeURIComponent(err.message)}`);
    }
  }

  // All other actions require an authenticated admin JWT
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

  return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
}
