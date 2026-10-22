const KEY = 'askbase_token';

// API base path — '/ai' when served behind the claimpaid.io reverse proxy,
// '' for standalone / local dev. Baked in at build time via VITE_API_BASE.
export const API_BASE = import.meta.env.VITE_API_BASE || '';
export const api = (p) => `${API_BASE}${p}`;

export function getToken() {
  return localStorage.getItem(KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(KEY, t);
  else localStorage.removeItem(KEY);
}
export async function authFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const fullUrl = url.startsWith('/api/') ? api(url) : url;
  const res = await fetch(fullUrl, { ...opts, headers });
  if (res.status === 401) {
    setToken(null);
    window.location.href = `${API_BASE}/app/`;
    throw new Error('Session expired — please sign in again');
  }
  return res;
}
