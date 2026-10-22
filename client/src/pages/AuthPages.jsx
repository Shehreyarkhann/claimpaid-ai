import { useState } from 'react';
import { getToken, setToken } from '../auth';

export default function AuthPages({ onAuth }) {
  const [mode, setMode] = useState('login'); // login | signup
  const [form, setForm] = useState({ name: '', email: 'demo@askbase.com', orgName: '', password: 'demo1234' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const body = mode === 'login'
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, orgName: form.orgName, password: form.password };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setToken(data.token);
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
          <div className="tabs mb-6">
            <button className={`tab ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>Sign in</button>
            <button className={`tab ${mode === 'signup' ? 'active' : ''}`} onClick={() => setMode('signup')}>Create account</button>
          </div>
          {err && <div className="mb-4 text-sm bg-red-50 text-red-700 border border-red-200 rounded-xl px-4 py-3">{err}</div>}
          <form onSubmit={submit}>
            {mode === 'signup' && (
              <>
                <div className="mb-4"><label className="label">Your name</label>
                  <input className="input" value={form.name} onChange={set('name')} placeholder="Jane Smith" required /></div>
                <div className="mb-4"><label className="label">Organization</label>
                  <input className="input" value={form.orgName} onChange={set('orgName')} placeholder="Acme Inc." required /></div>
              </>
            )}
            <div className="mb-4"><label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" required /></div>
            <div className="mb-6"><label className="label">Password</label>
              <input className="input" type="password" value={form.password} onChange={set('password')} placeholder="••••••••" required /></div>
            <button className="btn btn-primary w-full !py-3" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          {mode === 'login' && (
            <p className="hint text-center mt-4">Demo login is pre-filled — just hit <strong>Sign in</strong> to explore.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function useAuthUser() {
  const [user, setUser] = useState(() => (getToken() ? { pending: true } : null));
  return [user, setUser];
}
