import { useState } from 'react';
import { api, setToken, setRcmToken, getToken } from '../auth';

export default function AuthPages({ onAuth }) {
  const [mode, setMode] = useState('login'); // login | signup
  const [form, setForm] = useState({ name: '', orgName: '', email: 'demo@askbase.com', password: 'demo1234' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function signin(e) {
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
      // 2) Fall back to the ClaimPaid (RCM) account — one login for both apps.
      //    RCM Pro (AI included) credentials work here; RCM Starter does not include AI.
      res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) throw new Error(data.error || 'Invalid email or password');
      setRcmToken(data.token);
      onAuth(data.user);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  async function signup(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      // Create the ClaimPaid account with the AI plan — one account, AI-only access.
      const res = await fetch('/api/auth/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, orgName: form.orgName, email: form.email, password: form.password, plan: 'ai' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) throw new Error(data.error || 'Could not create your account');
      setRcmToken(data.token);
      // Start the 1-month free trial of ClaimPaid AI ($99/mo after)
      try {
        const co = await fetch('/api/billing/checkout', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
          body: JSON.stringify({ plan: 'ai', trial: true }),
        });
        const cod = await co.json().catch(() => ({}));
        if (co.ok && cod.url) { window.location.href = cod.url; return; }
      } catch { /* fall through to the app on checkout failure */ }
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
          <p className="text-violet-200/70 text-sm mt-2">Private AI answers from your documents</p>
        </div>
        <div className="card card-pad">
          <div className="tabs mb-6">
            <button className={`tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setErr(''); }}>Sign in</button>
            <button className={`tab ${mode === 'signup' ? 'active' : ''}`} onClick={() => { setMode('signup'); setErr(''); }}>Create account</button>
          </div>
          {err && <div className="mb-4 text-sm bg-red-50 text-red-700 border border-red-200 rounded-xl px-4 py-3">{err}</div>}
          {mode === 'login' ? (
            <form onSubmit={signin}>
              <div className="mb-4"><label className="label">Email</label>
                <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" required /></div>
              <div className="mb-6"><label className="label">Password</label>
                <input className="input" type="password" value={form.password} onChange={set('password')} placeholder="••••••••" required /></div>
              <button className="btn btn-primary w-full !py-3" disabled={busy}>
                {busy ? 'Please wait…' : 'Sign in'}
              </button>
              <p className="hint text-center mt-4">Demo login is pre-filled — just hit <strong>Sign in</strong> to explore.<br />RCM Pro credentials work here too.</p>
            </form>
          ) : (
            <form onSubmit={signup}>
              <div className="mb-4"><label className="label">Your name</label>
                <input className="input" value={form.name} onChange={set('name')} placeholder="Jane Smith" required /></div>
              <div className="mb-4"><label className="label">Organization</label>
                <input className="input" value={form.orgName} onChange={set('orgName')} placeholder="Acme Billing Co." required /></div>
              <div className="mb-4"><label className="label">Email</label>
                <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" required /></div>
              <div className="mb-6"><label className="label">Password</label>
                <input className="input" type="password" value={form.password} onChange={set('password')} placeholder="8+ characters" required minLength={8} /></div>
              <button className="btn btn-primary w-full !py-3" disabled={busy}>
                {busy ? 'Creating your account…' : 'Start 1 month free'}
              </button>
              <p className="hint text-center mt-4">$99/mo after trial · Cancel anytime · Your documents never leave our servers</p>
            </form>
          )}
        </div>
        <p className="text-center mt-6 text-xs text-violet-200/50">
          <a href="/" className="hover:text-violet-200">← Back to claimpaid.io</a>
        </p>
      </div>
    </div>
  );
}

export function useAuthUser() {
  const [user, setUser] = useState(() => (getToken() ? { pending: true } : null));
  return [user, setUser];
}
