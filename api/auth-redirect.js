/**
 * GET /api/auth-redirect?token=HASHED_TOKEN&type=recovery&new=1
 * Exchanges a Supabase hashed_token for a real JWT, then redirects to
 * /reset-password with the JWT in the hash — so emails never show database.infinite-scale.be.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://database.infinite-scale.be';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  const { token, type = 'recovery', new: isNew } = req.query || {};

  if (!token) return res.status(400).send('Missing token');

  try {
    // GET the Supabase verify URL without following redirects — the Location header has the real JWT
    const verifyUrl = `${SB_URL}/auth/v1/verify?token=${encodeURIComponent(token)}&type=${type}`;
    const verifyR = await fetch(verifyUrl, {
      method: 'GET',
      headers: { apikey: ANON_KEY },
      redirect: 'manual',
    });

    const location = verifyR.headers.get('location') || '';

    // Parse access_token and refresh_token from the Location hash
    const hashIdx = location.indexOf('#');
    if (hashIdx === -1) {
      console.error('auth-redirect: no hash in location', location.slice(0, 200));
      return res.redirect(302, `https://platform.infinite-scale.be/reset-password?error=link_expired`);
    }

    const params = new URLSearchParams(location.slice(hashIdx + 1));
    const at = params.get('access_token');
    const rt = params.get('refresh_token') || '';

    if (!at) {
      console.error('auth-redirect: no access_token in location hash', location.slice(0, 200));
      return res.redirect(302, `https://platform.infinite-scale.be/reset-password?error=link_expired`);
    }

    const dest = new URLSearchParams({ access_token: at, refresh_token: rt, type, ...(isNew ? { new: '1' } : {}) });
    return res.redirect(302, `https://platform.infinite-scale.be/reset-password#${dest.toString()}`);
  } catch (err) {
    console.error('auth-redirect crash:', err);
    return res.redirect(302, `https://platform.infinite-scale.be/reset-password?error=server_error`);
  }
}
