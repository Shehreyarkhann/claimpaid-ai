import { useEffect, useState } from 'react';
import { useToast, PageHeader, Skeleton, EmptyState, Stat, Field } from '../components/ui';
import { authFetch, setToken, setRcmToken } from '../auth';

// Stroke icons matching the RCM app's nav style
const ICONS = {
  kbs: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  ),
  keys: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 10-10"/><path d="m15 8 3 3"/>
    </svg>
  ),
  team: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
};

const NAV = [
  { id: 'kbs', label: 'Knowledge Bases', icon: ICONS.kbs },
  { id: 'keys', label: 'API Keys', icon: ICONS.keys },
  { id: 'team', label: 'Team', icon: ICONS.team },
];

export default function Shell({ user, view, setView, children }) {
  const [org, setOrg] = useState(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('cp_ai_sidebar') === 'collapsed'; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    authFetch('/api/auth/me').then((r) => r.json()).then((d) => setOrg(d.org)).catch(() => {});
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      const n = !c;
      try { localStorage.setItem('cp_ai_sidebar', n ? 'collapsed' : 'open'); } catch {}
      return n;
    });
  };
  const signOut = () => { setToken(null); setRcmToken(null); window.location.href = '/ai/app/'; };
  const go = (page) => { setView({ page }); setMobileOpen(false); };

  const brand = (iconOnly) => (
    <div className={`flex items-center ${iconOnly ? 'justify-center' : 'gap-3'} px-1`}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,#D97706,#B45309)' }}>
        <img src="/app/claimpaid-icon.webp" alt="ClaimPaid" className="w-9 h-9 rounded-[10px]" />
      </div>
      {!iconOnly && (
        <div className="min-w-0">
          <div className="text-white font-bold text-[15px] leading-tight">ClaimPaid AI</div>
          <div className="text-stone-400 text-xs truncate">{org?.name || '…'}</div>
        </div>
      )}
    </div>
  );

  const navButtons = (iconOnly) => (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => (
        <button
          key={n.id}
          onClick={() => go(n.id)}
          title={iconOnly ? n.label : undefined}
          className={`flex items-center ${iconOnly ? 'justify-center' : 'gap-3'} px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${view.page === n.id ? 'text-white' : 'text-stone-400 hover:text-white hover:bg-white/5'}`}
          style={view.page === n.id ? { background: 'rgba(217,119,6,.16)', boxShadow: 'inset 0 0 0 1px rgba(217,119,6,.35)' } : {}}
        >
          <span className="shrink-0">{n.icon}</span>
          {!iconOnly && <span className="truncate">{n.label}</span>}
        </button>
      ))}
    </nav>
  );

  const userCard = (iconOnly) => (
    <div className="pt-4 border-t border-white/10">
      {!iconOnly && (
        <a href="https://claimpaid.io" target="_blank" rel="noreferrer" className="block px-2 pb-3 text-xs text-stone-500 hover:text-white">
          Part of <span className="font-semibold text-stone-300">ClaimPaid</span> · <span className="text-emerald-400 font-semibold">RCM Platform →</span>
        </a>
      )}
      <div className={`flex items-center ${iconOnly ? 'justify-center' : 'gap-3'} px-2`}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: 'linear-gradient(135deg,#B45309,#D97706)' }}>
          {(user?.name || 'U')[0].toUpperCase()}
        </div>
        {!iconOnly && (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-semibold truncate">{user?.name}</div>
              <div className="text-stone-500 text-xs capitalize">{user?.role}</div>
            </div>
            <button className="text-stone-500 hover:text-white text-lg" title="Sign out" onClick={signOut}>↪</button>
          </>
        )}
      </div>
      {iconOnly && (
        <button className="w-full mt-3 text-stone-500 hover:text-white text-lg" title="Sign out" onClick={signOut}>↪</button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center gap-3 px-4 py-3" style={{ background: '#17251F' }}>
        <button onClick={() => setMobileOpen(true)} className="text-white text-xl p-1" aria-label="Open menu">☰</button>
        {brand(false)}
      </div>

      {/* Desktop sidebar (collapsible) */}
      <aside className={`hidden md:flex ${collapsed ? 'w-[76px]' : 'w-64'} shrink-0 min-h-screen py-5 flex-col transition-all duration-200 ${collapsed ? 'px-3' : 'px-5'}`} style={{ background: '#17251F' }}>
        <div className="mb-8">
          {brand(collapsed)}
        </div>
        <div className="flex-1">{navButtons(collapsed)}</div>
        <button onClick={toggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="mx-auto my-4 w-8 h-8 rounded-lg flex items-center justify-center text-stone-500 hover:text-white hover:bg-white/10 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
        {userCard(collapsed)}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 p-5 flex flex-col overflow-y-auto" style={{ background: '#17251F' }}>
            <div className="flex items-center justify-between mb-8">
              {brand(false)}
              <button onClick={() => setMobileOpen(false)} className="text-stone-400 hover:text-white text-xl p-1" aria-label="Close menu">✕</button>
            </div>
            <div className="flex-1">{navButtons(false)}</div>
            {userCard(false)}
          </aside>
        </div>
      )}

      <main className="flex-1 min-w-0 p-4 md:p-8 pt-20 md:pt-8 max-w-6xl w-full">{children}</main>
    </div>
  );
}

export function KnowledgeBases({ setView }) {
  const toast = useToast();
  const [kbs, setKbs] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [busy, setBusy] = useState(false);

  const load = () => authFetch('/api/kb').then((r) => r.json()).then((d) => setKbs(d.kbs)).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await authFetch('/api/kb', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowNew(false); setForm({ name: '', description: '' });
      setView({ page: 'kb', kbId: data.kb.id });
      toast.success('Knowledge base created');
    } catch (e2) { toast.error(e2.message); }
    setBusy(false);
  }

  return (
    <div>
      <PageHeader title="Knowledge Bases" subtitle="Each knowledge base is a private collection of documents with its own AI chat."
        actions={[<button key="n" className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>+ New knowledge base</button>]} />
      {kbs === null ? <Skeleton className="h-40" /> :
        kbs.length === 0 ? (
          <EmptyState icon="📚" title="No knowledge bases yet"
            sub="Create your first knowledge base, upload documents, and start asking questions."
            action={<button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>Create one</button>} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {kbs.map((k) => (
              <button key={k.id} onClick={() => setView({ page: 'kb', kbId: k.id })}
                className="card card-pad text-left hover:shadow-lg transition-shadow cursor-pointer">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-bold text-lg text-stone-800">{k.name}</h3>
                  {k.public_enabled ? <span className="badge badge-green">public</span> : <span className="badge badge-slate">private</span>}
                </div>
                {k.description && <p className="text-sm text-stone-500 mb-4 line-clamp-2">{k.description}</p>}
                <div className="flex gap-4 text-sm text-stone-500">
                  <span>📄 <strong className="text-stone-700">{k.doc_count}</strong> docs</span>
                  <span>🧩 <strong className="text-stone-700">{k.chunk_count}</strong> chunks</span>
                  <span>💬 <strong className="text-stone-700">{k.convo_count}</strong> chats</span>
                </div>
              </button>
            ))}
          </div>
        )}
      {showNew && (
        <div className="overlay" onClick={() => setShowNew(false)}>
          <div className="modal p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">New knowledge base</h3>
            <form onSubmit={create}>
              <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Support Handbook" required /></Field>
              <Field label="Description"><textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is this knowledge base about?" /></Field>
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNew(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function ApiKeys() {
  const toast = useToast();
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState(null);
  const load = () => authFetch('/api/keys').then((r) => r.json()).then((d) => setKeys(d.keys)).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);
  async function create() {
    if (!name.trim()) return toast.error('Give the key a name');
    const res = await authFetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error);
    setNewKey(data.key); setName(''); load();
  }
  async function revoke(id) {
    if (!confirm('Revoke this API key?')) return;
    await authFetch(`/api/keys/${id}`, { method: 'DELETE' });
    load(); toast.success('Key revoked');
  }
  return (
    <div>
      <PageHeader title="API Keys" subtitle="Query any knowledge base programmatically — POST /api/v1/query with your key." />
      {newKey && (
        <div className="card card-pad mb-4 border-2" style={{ borderColor: '#D97706' }}>
          <p className="label">Your new key — copy it now, it won't be shown again:</p>
          <code className="block bg-stone-900 text-emerald-300 rounded-xl px-4 py-3 text-sm break-all select-all">{newKey}</code>
          <button className="btn btn-outline btn-sm mt-3" onClick={() => { navigator.clipboard.writeText(newKey); toast.success('Copied'); }}>Copy</button>
        </div>
      )}
      <div className="card card-pad mb-4">
        <div className="flex gap-2">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. website widget" />
          <button className="btn btn-primary btn-sm" onClick={create}>Create key</button>
        </div>
        <p className="hint">Example: <code>curl -X POST /api/v1/query -H "Authorization: Bearer KEY" -d '{"{"}kb_id": 1, "question": "..."{'}}'}</code></p>
      </div>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {(keys || []).map((k) => (
              <tr key={k.id}>
                <td className="font-semibold">{k.name}</td>
                <td><code className="text-xs bg-stone-100 px-2 py-1 rounded">{k.prefix}…</code></td>
                <td className="text-stone-500 text-sm">{k.last_used_at || 'never'}</td>
                <td className="text-stone-500 text-sm">{k.created_at?.slice(0, 10)}</td>
                <td><button className="btn btn-danger btn-sm" onClick={() => revoke(k.id)}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {keys?.length === 0 && <p className="text-center text-stone-400 py-8 text-sm">No API keys yet.</p>}
      </div>
    </div>
  );
}

export function Team({ user }) {
  const toast = useToast();
  const [members, setMembers] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member' });
  const load = () => authFetch('/api/auth/team').then((r) => r.json()).then((d) => setMembers(d.members)).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);
  const canManage = ['owner', 'admin'].includes(user?.role);
  async function invite(e) {
    e.preventDefault();
    const res = await authFetch('/api/auth/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error);
    setForm({ name: '', email: '', password: '', role: 'member' }); load(); toast.success('Teammate added');
  }
  async function remove(id) {
    if (!confirm('Remove this member?')) return;
    const res = await authFetch(`/api/auth/team/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error);
    load();
  }
  return (
    <div>
      <PageHeader title="Team" subtitle="Everyone in your organization shares its knowledge bases." />
      {canManage && (
        <form onSubmit={invite} className="card card-pad mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <input className="input" type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option>
            </select>
          </div>
          <button className="btn btn-primary btn-sm mt-3">Add teammate</button>
        </form>
      )}
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
          <tbody>{(members || []).map((m) => (
            <tr key={m.id}><td className="font-semibold">{m.name}</td><td>{m.email}</td>
              <td><span className="badge badge-violet">{m.role}</span></td>
              <td>{user?.role === 'owner' && m.id !== user.id && <button className="btn btn-ghost btn-sm" onClick={() => remove(m.id)}>Remove</button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
