import { useState } from 'react';
import { api, setToken, setRcmToken, getToken } from '../auth';

export default function AuthPages({ onAuth }) {
  const [form, setForm] = useState({ email: 'demo@askbase.com', password: 'demo1234' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const body = { email: form.email, password: form.password };
      // 1) Try the AI account first (legacy AI users + demo)
      let res = await fetch(api('/api/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        setToken(data.token);
        onAuth(data.user);
        return;
      }
      // 2) Fall back to the ClaimPaid (RCM) account — one login for both apps
      res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) throw new Error(data.error || 'Invalid email or password');
      setRcmToken(data.token);
      onAuth(data.user);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg,#0b1120 0%,#1e1b4b 60%,#312e81 100%)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)', boxShadow: '0 8px 30px rgba(139,92,246,.5)' }}>
            <span className="text-white text-2xl font-black">A</span>
          </div>
          <h1 className="text-white text-3xl font-black tracking-tight">ClaimPaid AI</h1>
          <p className="text-violet-200/70 text-sm mt-2">AI answers from your documents</p>
        </div>
        <div className="card card-pad">
          {err && <div className="mb-4 text-sm bg-red-50 text-red-700 border border-red-200 rounded-xl px-4 py-3">{err}</div>}
          <form onSubmit={submit}>
            <div className="mb-4"><label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" required /></div>
            <div className="mb-6"><label className="label">Password</label>
              <input className="input" type="password" value={form.password} onChange={set('password')} placeholder="••••••••" required /></div>
            <button className="btn btn-primary w-full !py-3" disabled={busy}>
              {busy ? 'Please wait…' : 'Sign in'}
            </button>
          </form>
          <p className="hint text-center mt-4">Demo login is pre-filled — just hit <strong>Sign in</strong> to explore.</p>
          <div className="text-center mt-4 pt-4 border-t border-slate-200">
            <p className="text-sm text-slate-500 mb-2">New to ClaimPaid AI?</p>
            <a href="/app/?plan=ai&trial=1" className="btn btn-outline w-full !py-2.5">Create account — start 1 month free</a>
            <p className="hint mt-2">One account for ClaimPaid RCM + AI · $99/mo after trial</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useAuthUser() {
  const [user, setUser] = useState(() => (getToken() ? { pending: true } : null));
  return [user, setUser];
}
