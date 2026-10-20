const KEY = 'askbase_token';

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
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    setToken(null);
    window.location.href = '/app/';
    throw new Error('Session expired — please sign in again');
  }
  return res;
}
