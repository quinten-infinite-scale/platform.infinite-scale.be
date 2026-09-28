/**
 * /api/meta-callback — OAuth redirect target for Meta (Facebook) login
 *
 * Facebook redirects here after the user completes the OAuth dialog.
 * This handler exchanges the code for tokens and saves them, then redirects
 * back to the platform settings page.
 *
 * The redirect URI registered in the Meta App Dashboard must be:
 *   https://platform.infinite-scale.be/api/meta-callback
 */

import crypto from 'crypto';

export const config = { api: { bodyParser: true } };

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || 'https://platform.infinite-scale.be';
const REDIRECT_URI = `${PLATFORM_URL}/api/meta-callback`;

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
}

async function saveSetting(key, value) {
  const r = await fetch(`${SB_URL}/rest/v1/platform_settings?on_conflict=key`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value: typeof value === 'string' ? value : JSON.stringify(value) }),
  });
  return r.ok;
}

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
  await fetch(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscribed_fields: ['leadgen'], access_token: pageToken }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { code, error, error_description } = req.query || {};

  if (error) {
    console.warn('[meta-callback] OAuth error:', error, error_description);
    return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_error=${encodeURIComponent(error_description || error)}`);
  }

  if (!code) return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_error=no_code`);

  try {
    const tokenData = await exchangeCodeForToken(code);
    const pages = await getPageTokens(tokenData.token);
    const pageTokenMap = Object.fromEntries(pages.map(p => [p.id, p.access_token]));
    await Promise.all([
      saveSetting('meta_account', {
        user_id: tokenData.user_id,
        user_name: tokenData.user_name,
        token: tokenData.token,
        expires_in: tokenData.expires_in,
        connected_at: new Date().toISOString(),
        pages: pages.map(p => ({ id: p.id, name: p.name })),
      }),
      saveSetting('meta_page_tokens', pageTokenMap),
    ]);
    await Promise.all(pages.map(p => subscribePageToLeadgen(p.id, p.access_token).catch(() => {})));
    console.log(`[meta-callback] Connected as ${tokenData.user_name}, ${pages.length} page(s)`);
    return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_connected=1`);
  } catch (err) {
    console.error('[meta-callback] error:', err);
    return res.redirect(302, `${PLATFORM_URL}/?route=settings&meta_error=${encodeURIComponent(err.message)}`);
  }
}
