// Supabase client wrapper
const SB = (() => {
  const url = window.SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY;

  const headers = (extra = {}) => ({
    'apikey': key,
    'Content-Type': 'application/json',
    ...extra,
  });

  const authHeaders = (token) => headers({
    'Authorization': `Bearer ${token}`,
  });

  let _session = null;

  async function _refreshIfNeeded() {
    if (!_session) return false;
    const expiresAt = _session.expires_at; // unix seconds
    const nowSec = Math.floor(Date.now() / 1000);
    // Refresh if token expires in less than 5 minutes
    if (expiresAt && nowSec < expiresAt - 300) return true;
    if (!_session.refresh_token) return false;
    const r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ refresh_token: _session.refresh_token }),
    });
    if (!r.ok) { _session = null; localStorage.removeItem('is_session'); return false; }
    const d = await r.json();
    if (d.access_token) { _saveSession(d); return true; }
    return false;
  }

  function _saveSession(d) {
    if (!d.expires_at && d.expires_in) {
      d.expires_at = Math.floor(Date.now() / 1000) + d.expires_in;
    }
    _session = d;
    localStorage.setItem('is_session', JSON.stringify(d));
  }

  async function signIn(email, password) {
    const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (d.access_token) _saveSession(d);
    return d;
  }

  async function signOut() {
    if (_session) {
      await fetch(`${url}/auth/v1/logout`, {
        method: 'POST',
        headers: authHeaders(_session.access_token),
      });
    }
    _session = null;
    localStorage.removeItem('is_session');
  }

  function loadSession() {
    try {
      const saved = localStorage.getItem('is_session');
      if (saved) _session = JSON.parse(saved);
    } catch (e) {}
    return _session;
  }

  function getSession() { return _session; }

  async function get(table, query = '') {
    if (!await _refreshIfNeeded()) return [];
    const r = await fetch(`${url}/rest/v1/${table}${query}`, {
      headers: authHeaders(_session.access_token),
    });
    if (!r.ok) return [];
    return r.json();
  }

  async function _serverWrite(payload) {
    if (!_session?.access_token) return null;
    const r = await fetch('/api/db-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _session.access_token },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!j.ok) console.error('db-write error:', j.error, payload);
    return j.ok ? j.data : null;
  }

  async function post(table, body) {
    return _serverWrite({ method: 'post', table, body });
  }

  async function patch(table, query, body) {
    return _serverWrite({ method: 'patch', table, query, body });
  }

  async function del(table, query) {
    return _serverWrite({ method: 'del', table, query });
  }

  async function rpc(fn, params = {}) {
    if (!await _refreshIfNeeded()) return null;
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: authHeaders(_session.access_token),
      body: JSON.stringify(params),
    });
    if (!r.ok) return null;
    return r.json();
  }

  async function upsert(table, onConflict, body) {
    const result = await _serverWrite({ method: 'upsert', table, conflict: onConflict, body });
    return result !== null;
  }

  async function updateAuth(fields) {
    if (!_session) return null;
    const r = await fetch(`${url}/auth/v1/user`, {
      method: 'PUT',
      headers: authHeaders(_session.access_token),
      body: JSON.stringify(fields),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.access_token) { _saveSession({ ..._session, ...d }); }
    return d;
  }

  return { signIn, signOut, loadSession, getSession, get, post, patch, del, rpc, upsert, updateAuth };
})();
