import { useEffect, useState } from 'react';
import { useToast, PageHeader, Skeleton, EmptyState, Stat, Field } from '../components/ui';
import { authFetch, setToken } from '../auth';

const NAV = [
  { id: 'kbs', label: 'Knowledge Bases', icon: '📚' },
  { id: 'keys', label: 'API Keys', icon: '🔑' },
  { id: 'team', label: 'Team', icon: '👥' },
];

export default function Shell({ user, view, setView, children }) {
  const [org, setOrg] = useState(null);
  useEffect(() => {
    authFetch('/api/auth/me').then((r) => r.json()).then((d) => setOrg(d.org)).catch(() => {});
  }, []);
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 shrink-0 min-h-screen p-5 flex flex-col" style={{ background: '#0b1120' }}>
        <div className="flex items-center gap-3 mb-8 px-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)' }}>
            <span className="text-white text-lg font-black">A</span>
          </div>
          <div>
            <div className="text-white font-bold text-[15px] leading-tight">ClaimPilot AI</div>
            <div className="text-slate-400 text-xs">{org?.name || '…'}</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setView({ page: n.id })}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-left transition-all ${view.page === n.id ? 'text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
              style={view.page === n.id ? { background: 'rgba(139,92,246,.18)', boxShadow: 'inset 0 0 0 1px rgba(139,92,246,.35)' } : {}}
            >
              <span className="text-base">{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-6 border-t border-white/10">
          <a href="https://claim-pilot.io" target="_blank" rel="noreferrer" className="block px-2 pb-3 text-xs text-slate-500 hover:text-white">
            Part of <span className="font-semibold text-slate-300">ClaimPilot</span> · <span className="text-emerald-400 font-semibold">RCM Platform →</span>
          </a>
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              {(user?.name || 'U')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-semibold truncate">{user?.name}</div>
              <div className="text-slate-500 text-xs capitalize">{user?.role}</div>
            </div>
            <button className="text-slate-500 hover:text-white text-lg" title="Sign out"
              onClick={() => { setToken(null); window.location.reload(); }}>↪</button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-8 max-w-6xl">{children}</main>
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
                  <h3 className="font-bold text-lg text-slate-800">{k.name}</h3>
                  {k.public_enabled ? <span className="badge badge-green">public</span> : <span className="badge badge-slate">private</span>}
                </div>
                {k.description && <p className="text-sm text-slate-500 mb-4 line-clamp-2">{k.description}</p>}
                <div className="flex gap-4 text-sm text-slate-500">
                  <span>📄 <strong className="text-slate-700">{k.doc_count}</strong> docs</span>
                  <span>🧩 <strong className="text-slate-700">{k.chunk_count}</strong> chunks</span>
                  <span>💬 <strong className="text-slate-700">{k.convo_count}</strong> chats</span>
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
        <div className="card card-pad mb-4 border-2" style={{ borderColor: '#8b5cf6' }}>
          <p className="label">Your new key — copy it now, it won't be shown again:</p>
          <code className="block bg-slate-900 text-emerald-300 rounded-xl px-4 py-3 text-sm break-all select-all">{newKey}</code>
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
      <div className="card overflow-hidden">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {(keys || []).map((k) => (
              <tr key={k.id}>
                <td className="font-semibold">{k.name}</td>
                <td><code className="text-xs bg-slate-100 px-2 py-1 rounded">{k.prefix}…</code></td>
                <td className="text-slate-500 text-sm">{k.last_used_at || 'never'}</td>
                <td className="text-slate-500 text-sm">{k.created_at?.slice(0, 10)}</td>
                <td><button className="btn btn-danger btn-sm" onClick={() => revoke(k.id)}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {keys?.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">No API keys yet.</p>}
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
      <div className="card overflow-hidden">
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
