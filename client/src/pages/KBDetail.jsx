import { useEffect, useRef, useState } from 'react';
import { useToast, PageHeader, Skeleton, EmptyState, Stat, Field, Modal } from '../components/ui';
import { authFetch } from '../auth';

// ---------- markdown-lite renderer (safe subset) ----------
function renderMd(text, onCite) {
  const lines = String(text || '').split('\n');
  const out = [];
  let listBuf = [];
  const flushList = () => {
    if (listBuf.length) {
      out.push(<ul key={`ul-${out.length}`} className="list-disc ml-5 my-2">{listBuf.map((li, j) => <li key={j}>{li}</li>)}</ul>);
      listBuf = [];
    }
  };
  const inline = (p, key) => {
    const parts = p.split(/(\[\d+\])/g);
    return parts.map((s, i) => {
      const m = s.match(/^\[(\d+)\]$/);
      if (m) return <button key={`${key}-${i}`} className="cite" onClick={() => onCite(Number(m[1]))}>{m[1]}</button>;
      const html = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      return <span key={`${key}-${i}`} dangerouslySetInnerHTML={{ __html: html }} />;
    });
  };
  lines.forEach((line, i) => {
    const t = line.trim();
    const h = t.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      flushList();
      const lvl = h[1].length;
      const cls = lvl === 1 ? 'text-lg' : lvl === 2 ? 'text-base' : 'text-sm';
      out.push(<div key={i} className={`font-bold text-slate-800 mt-3 mb-1 ${cls}`}>{inline(h[2], i)}</div>);
    } else if (/^[-*]\s+/.test(t)) {
      listBuf.push(inline(t.replace(/^[-*]\s+/, ''), i));
    } else if (/^\d+[.)]\s+/.test(t)) {
      flushList();
      out.push(<div key={i} className="my-1">{inline(t, i)}</div>);
    } else if (t === '') {
      flushList();
      out.push(<div key={i} className="h-2" />);
    } else {
      flushList();
      out.push(<div key={i} className="my-1">{inline(t, i)}</div>);
    }
  });
  flushList();
  return out;
}

// ---------- CHAT ----------
function ChatTab({ kb }) {
  const toast = useToast();
  const [convos, setConvos] = useState([]);
  const [convoId, setConvoId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [citeOpen, setCiteOpen] = useState(null);
  const [llmInfo, setLlmInfo] = useState({ llm: false });
  const bottomRef = useRef(null);

  const loadConvos = () => authFetch(`/api/kb/${kb.id}/chat/conversations`).then((r) => r.json())
    .then((d) => { setConvos(d.conversations); setLlmInfo({ llm: d.llm, model: d.model }); })
    .catch((e) => toast.error(e.message));
  useEffect(() => { loadConvos(); }, [kb.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function openConvo(id) {
    const res = await authFetch(`/api/kb/${kb.id}/chat/conversations/${id}`);
    const data = await res.json();
    if (!res.ok) return toast.error(data.error);
    setConvoId(id);
    setMessages(data.conversation.messages);
  }

  function newChat() { setConvoId(null); setMessages([]); }

  async function send(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    const userMsg = { role: 'user', content: text };
    setMessages((m) => [...m, userMsg, { role: 'assistant', content: '', streaming: true, citations: [] }]);
    setStreaming(true);
    try {
      const res = await authFetch(`/api/kb/${kb.id}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation_id: convoId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Chat failed');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const append = (t) => setMessages((m) => {
        const c = [...m]; const last = { ...c[c.length - 1] };
        last.content += t; c[c.length - 1] = last; return c;
      });
      const setMeta = (citations, mode) => setMessages((m) => {
        const c = [...m]; const last = { ...c[c.length - 1] };
        last.citations = citations; last.mode = mode; c[c.length - 1] = last; return c;
      });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop();
        for (const ev of events) {
          const lines = ev.split('\n');
          const type = (lines.find((l) => l.startsWith('event:')) || '').slice(6).trim();
          const dataLine = lines.find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          let data = {};
          try { data = JSON.parse(dataLine.slice(5)); } catch { continue; }
          if (type === 'convo' && data.conversation_id) { setConvoId(data.conversation_id); loadConvos(); }
          else if (type === 'meta') setMeta(data.citations || [], data.mode);
          else if (type === 'token' && data.text) append(data.text);
          else if (type === 'error') throw new Error(data.error);
        }
      }
      setMessages((m) => { const c = [...m]; const last = { ...c[c.length - 1] }; delete last.streaming; c[c.length - 1] = last; return c; });
    } catch (err) {
      setMessages((m) => m.slice(0, -1));
      toast.error(err.message);
    }
    setStreaming(false);
  }

  async function feedback(msgId, fb) {
    await authFetch(`/api/kb/${kb.id}/chat/messages/${msgId}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback: fb }),
    });
    setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, feedback: fb } : x)));
  }

  const openCite = (n) => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.citations?.length);
    const c = last?.citations?.find((x) => x.n === n);
    if (c) setCiteOpen(c);
  };

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 220px)', minHeight: 480 }}>
      <div className="w-60 shrink-0 card p-3 overflow-y-auto hidden md:block">
        <button className="btn btn-outline btn-sm w-full mb-3" onClick={newChat}>+ New chat</button>
        {convos.map((c) => (
          <button key={c.id} onClick={() => openConvo(c.id)}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm mb-1 truncate transition-colors ${convoId === c.id ? 'bg-violet-50 text-violet-900 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>
            💬 {c.title}
          </button>
        ))}
        {convos.length === 0 && <p className="text-xs text-slate-400 px-2">No conversations yet.</p>}
      </div>

      <div className="flex-1 card flex flex-col overflow-hidden">
        {!llmInfo.llm && (
          <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
            ⚡ <strong>Demo mode:</strong> answers are extracted from your documents. Set <code>LLM_API_KEY</code> for full generative answers.
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center py-16">
              <div className="text-5xl mb-4">✨</div>
              <h3 className="font-bold text-lg text-slate-800 mb-2">{kb.welcome_message || `Ask anything about ${kb.name}`}</h3>
              <p className="text-sm text-slate-500 max-w-sm">Answers come with citations — click any [n] to see the exact source passage.</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i}>
              {m.role === 'user' ? (
                <div className="chat-bubble-user">{m.content}</div>
              ) : (
                <div>
                  <div className="chat-bubble-ai prose-chat">
                    {m.content ? renderMd(m.content, openCite) : (
                      <span><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></span>
                    )}
                  </div>
                  {m.citations?.length > 0 && !m.streaming && (
                    <div className="flex items-center gap-2 mt-2 ml-1 flex-wrap">
                      <span className="text-xs text-slate-400">Sources:</span>
                      {m.citations.map((c) => (
                        <button key={c.n} className="cite" onClick={() => setCiteOpen(c)} title={c.filename}>[{c.n}] {c.filename}</button>
                      ))}
                      {m.id && (
                        <span className="ml-2 flex gap-1">
                          <button className={`btn btn-ghost btn-sm !px-2 ${m.feedback === 'up' ? '!text-emerald-600' : ''}`} onClick={() => feedback(m.id, m.feedback === 'up' ? null : 'up')} title="Helpful">👍</button>
                          <button className={`btn btn-ghost btn-sm !px-2 ${m.feedback === 'down' ? '!text-red-600' : ''}`} onClick={() => feedback(m.id, m.feedback === 'down' ? null : 'down')} title="Not helpful">👎</button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={send} className="p-4 border-t border-slate-100 flex gap-2">
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask about ${kb.name}…`} disabled={streaming} />
          <button className="btn btn-primary" disabled={streaming || !input.trim()}>
            {streaming ? '…' : '➤'}
          </button>
        </form>
      </div>

      {citeOpen && (
        <div className="drawer-wrap">
          <div className="drawer-bg" onClick={() => setCiteOpen(null)} />
          <div className="drawer p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <span className="badge badge-violet mb-2">Source [{citeOpen.n}]</span>
                <h3 className="font-bold text-slate-800">{citeOpen.filename}</h3>
                <p className="text-xs text-slate-400">chunk {citeOpen.chunk_index} · relevance {citeOpen.score}</p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setCiteOpen(null)}>✕</button>
            </div>
            <div className="bg-violet-50/60 border border-violet-100 rounded-2xl p-5 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
              {citeOpen.text}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- DOCUMENTS ----------
function DocsTab({ kb }) {
  const toast = useToast();
  const [docs, setDocs] = useState(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  const load = () => authFetch(`/api/kb/${kb.id}/documents`).then((r) => r.json()).then((d) => setDocs(d.documents)).catch((e) => toast.error(e.message));
  useEffect(() => {
    load();
    const t = setInterval(() => { setDocs((d) => (d?.some((x) => x.status === 'processing') ? (load(), d) : d)); }, 3000);
    return () => clearInterval(t);
  }, [kb.id]);

  async function uploadFiles(files) {
    if (!files?.length) return;
    setBusy(true);
    const fd = new FormData();
    [...files].forEach((f) => fd.append('files', f));
    try {
      const res = await authFetch(`/api/kb/${kb.id}/documents/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.ids.length} file(s) queued for processing`);
      load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  async function importUrl(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/kb/${kb.id}/documents/url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUrl(''); toast.success('URL queued for processing'); load();
    } catch (e2) { toast.error(e2.message); }
    setBusy(false);
  }

  async function remove(id) {
    if (!confirm('Delete this document and all its chunks?')) return;
    await authFetch(`/api/kb/${kb.id}/documents/${id}`, { method: 'DELETE' });
    load(); toast.success('Deleted');
  }

  return (
    <div>
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className={`dropzone ${drag ? 'drag' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); uploadFiles(e.dataTransfer.files); }}>
          <div className="text-3xl mb-2">📤</div>
          <p className="font-semibold text-slate-700">{busy ? 'Uploading…' : 'Drop files here or click to upload'}</p>
          <p className="text-xs text-slate-400 mt-1">PDF, DOCX, TXT, MD, CSV — up to 25 MB each</p>
          <input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.docx,.txt,.md,.csv"
            onChange={(e) => uploadFiles(e.target.files)} />
        </div>
        <form onSubmit={importUrl} className="card card-pad">
          <p className="font-semibold text-slate-700 mb-1">🌐 Import from URL</p>
          <p className="text-xs text-slate-400 mb-3">Paste a docs page, help article, or policy URL.</p>
          <div className="flex gap-2">
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            <button className="btn btn-outline btn-sm" disabled={busy}>Import</button>
          </div>
        </form>
      </div>

      <div className="card overflow-hidden">
        <table className="tbl">
          <thead><tr><th>Document</th><th>Source</th><th>Chunks</th><th>Status</th><th>Added</th><th></th></tr></thead>
          <tbody>
            {(docs || []).map((d) => (
              <tr key={d.id}>
                <td className="font-semibold max-w-[280px] truncate" title={d.filename}>{d.filename}</td>
                <td><span className="badge badge-slate">{d.source_type}</span></td>
                <td>{d.chunk_count || '—'}</td>
                <td>
                  {d.status === 'ready' && <span className="badge badge-green">ready</span>}
                  {d.status === 'processing' && <span className="badge badge-amber">processing…</span>}
                  {d.status === 'failed' && <span className="badge badge-red" title={d.error}>failed</span>}
                </td>
                <td className="text-slate-500 text-sm">{d.created_at?.slice(0, 10)}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => remove(d.id)}>🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {docs?.length === 0 && <p className="text-center text-slate-400 py-10 text-sm">No documents yet — upload your first one above.</p>}
        {docs === null && <div className="p-6"><Skeleton className="h-10" /></div>}
      </div>
    </div>
  );
}

// ---------- ANALYTICS ----------
function AnalyticsTab({ kb }) {
  const toast = useToast();
  const [a, setA] = useState(null);
  useEffect(() => {
    authFetch(`/api/kb/${kb.id}/analytics`).then((r) => r.json()).then(setA).catch((e) => toast.error(e.message));
  }, [kb.id]);
  if (!a) return <Skeleton className="h-64" />;
  const maxDay = Math.max(1, ...a.byDay.map((d) => d.c));
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Questions asked" value={a.totalQueries} />
        <Stat label="Helpful votes" value={`${a.thumbsUp} 👍 / ${a.thumbsDown} 👎`} sub={a.thumbsUp + a.thumbsDown ? `${Math.round((a.thumbsUp / (a.thumbsUp + a.thumbsDown)) * 100)}% positive` : 'no votes yet'} />
        <Stat label="No-answer rate" value={`${(a.noAnswerRate * 100).toFixed(1)}%`} sub={`${a.noAnswerCount} unanswered`} />
        <Stat label="Avg response time" value={`${(a.avgLatencyMs / 1000).toFixed(1)}s`} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card card-pad">
          <h3 className="font-bold mb-4">Questions — last 14 days</h3>
          {a.byDay.length === 0 ? <p className="text-sm text-slate-400">No questions yet.</p> : (
            <div className="flex items-end gap-1.5 h-36">
              {a.byDay.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${d.c}`}>
                  <div className="w-full rounded-t-lg" style={{ height: `${Math.max(6, (d.c / maxDay) * 120)}px`, background: 'linear-gradient(180deg,#a78bfa,#7c3aed)' }} />
                  <span className="text-[10px] text-slate-400">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card card-pad">
          <h3 className="font-bold mb-4">Most-cited documents</h3>
          {a.topDocs.length === 0 ? <p className="text-sm text-slate-400">No citations yet.</p> :
            a.topDocs.map((d, i) => (
              <div key={i} className="flex justify-between py-2 border-b border-slate-50 last:border-0 text-sm">
                <span className="truncate font-medium text-slate-700">📄 {d.filename}</span>
                <span className="badge badge-violet ml-2">{d.c} cites</span>
              </div>
            ))}
        </div>
      </div>
      <div className="card card-pad mt-4">
        <h3 className="font-bold mb-3">Recent questions</h3>
        {a.recent.length === 0 ? <p className="text-sm text-slate-400">None yet.</p> :
          a.recent.map((q, i) => (
            <div key={i} className="py-2 border-b border-slate-50 last:border-0 text-sm flex justify-between gap-4">
              <span className="text-slate-700 truncate">💬 {q.content}</span>
              <span className="text-xs text-slate-400 shrink-0">{q.created_at?.slice(0, 16).replace('T', ' ')}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

// ---------- SHARE ----------
function ShareTab({ kb, reload }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const origin = window.location.origin;
  const shareUrl = `${origin}/app/share/${kb.public_slug}`;
  const embedCode = `<script src="${origin}/api/share/widget.js" data-kb="${kb.public_slug}"><\/script>`;

  async function toggle() {
    setSaving(true);
    const res = await authFetch(`/api/kb/${kb.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_enabled: !kb.public_enabled }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error); else { toast.success(data.kb.public_enabled ? 'Public chat enabled' : 'Public chat disabled'); reload(); }
    setSaving(false);
  }

  return (
    <div className="max-w-2xl">
      <div className="card card-pad mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold">🌍 Public chat link</h3>
          <button className={`btn btn-sm ${kb.public_enabled ? 'btn-outline' : 'btn-primary'}`} onClick={toggle} disabled={saving}>
            {kb.public_enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-3">Anyone with the link can chat with this knowledge base — no login required. Great for customer support.</p>
        {kb.public_enabled && (
          <div className="flex gap-2">
            <input className="input" readOnly value={shareUrl} onClick={(e) => e.target.select()} />
            <button className="btn btn-outline btn-sm" onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success('Copied'); }}>Copy</button>
          </div>
        )}
      </div>
      <div className="card card-pad">
        <h3 className="font-bold mb-2">🧩 Embeddable widget</h3>
        <p className="text-sm text-slate-500 mb-3">Drop this on any website for a floating chat bubble powered by this knowledge base.</p>
        <div className="bg-slate-900 rounded-xl p-4 relative">
          <code className="text-emerald-300 text-xs break-all">{embedCode}</code>
        </div>
        <button className="btn btn-outline btn-sm mt-3" onClick={() => { navigator.clipboard.writeText(embedCode); toast.success('Copied'); }}>Copy embed code</button>
      </div>
    </div>
  );
}

// ---------- SETTINGS ----------
function SettingsTab({ kb, reload }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: kb.name, description: kb.description || '', chunk_size: kb.chunk_size,
    chunk_overlap: kb.chunk_overlap, top_k: kb.top_k,
    system_prompt: kb.system_prompt || '', welcome_message: kb.welcome_message || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const res = await authFetch(`/api/kb/${kb.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error); else { toast.success('Saved'); reload(); }
    setBusy(false);
  }

  async function destroy() {
    if (!confirm(`Delete "${kb.name}" and all its documents and chats? This cannot be undone.`)) return;
    await authFetch(`/api/kb/${kb.id}`, { method: 'DELETE' });
    window.location.hash = '';
    window.location.reload();
  }

  return (
    <form onSubmit={save} className="max-w-2xl">
      <div className="card card-pad mb-4">
        <h3 className="font-bold mb-4">General</h3>
        <Field label="Name"><input className="input" value={form.name} onChange={set('name')} required /></Field>
        <Field label="Description"><textarea className="input" rows={2} value={form.description} onChange={set('description')} /></Field>
        <Field label="Welcome message" hint="Shown at the start of a new chat."><input className="input" value={form.welcome_message} onChange={set('welcome_message')} placeholder="Hi! Ask me anything about…" /></Field>
      </div>
      <div className="card card-pad mb-4">
        <h3 className="font-bold mb-4">Retrieval tuning</h3>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Chunk size" hint="chars"><input className="input" type="number" min={200} max={4000} value={form.chunk_size} onChange={set('chunk_size')} /></Field>
          <Field label="Overlap" hint="chars"><input className="input" type="number" min={0} max={1000} value={form.chunk_overlap} onChange={set('chunk_overlap')} /></Field>
          <Field label="Top-K" hint="chunks per answer"><input className="input" type="number" min={1} max={20} value={form.top_k} onChange={set('top_k')} /></Field>
        </div>
        <p className="hint">Applies to documents uploaded after saving.</p>
      </div>
      <div className="card card-pad mb-4">
        <h3 className="font-bold mb-4">AI behavior</h3>
        <Field label="System prompt" hint="Leave blank for the default grounded-answering prompt."><textarea className="input" rows={4} value={form.system_prompt} onChange={set('system_prompt')} placeholder="You are a helpful support agent…" /></Field>
      </div>
      <div className="flex justify-between items-center">
        <button type="button" className="btn btn-danger btn-sm" onClick={destroy}>Delete knowledge base</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}

// ---------- DETAIL WRAPPER ----------
export default function KBDetail({ kbId, setView }) {
  const toast = useToast();
  const [kb, setKb] = useState(null);
  const [tab, setTab] = useState('chat');
  const reload = () => { authFetch(`/api/kb/${kbId}`).then((r) => r.json()).then((d) => setKb(d.kb)).catch((e) => toast.error(e.message)); };
  useEffect(() => { reload(); }, [kbId]);
  if (!kb) return <Skeleton className="h-64" />;

  const tabs = [
    { id: 'chat', label: '💬 Chat' },
    { id: 'docs', label: '📄 Documents' },
    { id: 'analytics', label: '📊 Analytics' },
    { id: 'share', label: '🔗 Share' },
    { id: 'settings', label: '⚙️ Settings' },
  ];
  return (
    <div>
      <button className="btn btn-ghost btn-sm mb-3" onClick={() => setView({ page: 'kbs' })}>← All knowledge bases</button>
      <PageHeader title={kb.name} subtitle={kb.description || `${kb.chunk_count} chunks indexed`}
        actions={kb.public_enabled ? [<span key="p" className="badge badge-green">● public</span>] : []} />
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'chat' && <ChatTab kb={kb} />}
      {tab === 'docs' && <DocsTab kb={kb} />}
      {tab === 'analytics' && <AnalyticsTab kb={kb} />}
      {tab === 'share' && <ShareTab kb={kb} reload={reload} />}
      {tab === 'settings' && <SettingsTab kb={kb} reload={reload} />}
    </div>
  );
}
