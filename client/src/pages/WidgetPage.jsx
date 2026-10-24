import { useEffect, useRef, useState } from 'react';
import { api } from '../auth.js';

// Anonymous per-browser identity for the public widget: lets a visitor see
// and resume THEIR OWN chats (last 24 hours) without an account. Stored in
// localStorage so history survives closing the tab — sessionStorage (the old
// behavior) lost everything the moment the tab closed.
function getVisitorId() {
  let v = localStorage.getItem('cp-visitor-id');
  if (!v) {
    v = (crypto.randomUUID ? crypto.randomUUID() : `v-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
    localStorage.setItem('cp-visitor-id', v);
  }
  return v;
}

function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(String(ts).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Public chat page: full-page share view, or compact embed widget.
export default function WidgetPage({ slug, embed }) {
  const [kb, setKb] = useState(null);
  const [err, setErr] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [convoId, setConvoId] = useState(null);
  const [convos, setConvos] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const visitorRef = useRef(null);
  if (!visitorRef.current) visitorRef.current = getVisitorId();
  const bottomRef = useRef(null);

  const loadHistory = () => fetch(api(`/api/share/kb/${slug}/conversations?visitor_id=${visitorRef.current}`))
    .then((r) => r.json())
    .then((d) => { if (Array.isArray(d.conversations)) setConvos(d.conversations); })
    .catch(() => {});

  const openConvo = async (id) => {
    setShowHistory(false);
    try {
      const r = await fetch(api(`/api/share/kb/${slug}/conversations/${id}?visitor_id=${visitorRef.current}`));
      const d = await r.json();
      if (!r.ok || !d.conversation) throw new Error('gone');
      setConvoId(d.conversation.id);
      setMessages(d.conversation.messages.map((m) => ({ role: m.role, content: m.content, citations: m.citations || [] })));
      localStorage.setItem(`ab-convo-${slug}`, String(d.conversation.id));
    } catch {
      // Older than 24h or not this visitor's — start fresh instead of erroring.
      newChat();
    }
  };

  function newChat() {
    setConvoId(null);
    setMessages([]);
    setShowHistory(false);
    localStorage.removeItem(`ab-convo-${slug}`);
  }

  useEffect(() => {
    fetch(api(`/api/share/kb/${slug}`)).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error);
      else setKb(d.kb);
    }).catch(() => setErr('Could not load'));
    loadHistory();
    // Restore the most recent conversation so history "holds" across visits.
    const saved = localStorage.getItem(`ab-convo-${slug}`);
    if (saved) openConvo(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true, citations: [] }]);
    setStreaming(true);
    try {
      const res = await fetch(api(`/api/share/kb/${slug}/chat`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation_id: convoId, visitor_id: visitorRef.current }),
      });
      if (!res.ok) throw new Error('Chat failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const append = (t) => setMessages((m) => {
        const c = [...m]; const last = { ...c[c.length - 1] };
        last.content += t; c[c.length - 1] = last; return c;
      });
      let streamError = null;
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
          if (type === 'convo' && data.conversation_id) {
            setConvoId(data.conversation_id);
            localStorage.setItem(`ab-convo-${slug}`, String(data.conversation_id));
          } else if (type === 'meta') {
            setMessages((m) => { const c = [...m]; const l = { ...c[c.length - 1] }; l.citations = data.citations || []; c[c.length - 1] = l; return c; });
          } else if (type === 'token' && data.text) append(data.text);
          else if (type === 'error') streamError = data.error || 'Something went wrong';
        }
      }
      if (streamError) throw new Error(streamError);
      setMessages((m) => { const c = [...m]; const l = { ...c[c.length - 1] }; delete l.streaming; c[c.length - 1] = l; return c; });
      loadHistory();
    } catch (err2) {
      // Never leave a silently empty bubble — say what happened and how to retry.
      setMessages((m) => {
        const c = [...m]; const l = { ...c[c.length - 1] };
        if (l && l.role === 'assistant') {
          l.streaming = false;
          l.content = l.content || '⚠️ I couldn\'t get an answer just now — the assistant may still be warming up. Give it a few seconds and ask again.';
          c[c.length - 1] = l;
        }
        return c;
      });
    }
    setStreaming(false);
  }

  if (err) return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div><div className="text-4xl mb-3">🔒</div><p className="text-slate-500">{err}</p></div>
    </div>
  );
  if (!kb) return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Loading…</div>;

  const wrap = embed ? 'h-screen' : 'min-h-screen';
  return (
    <div className={`${wrap} flex flex-col bg-white relative`}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3" style={{ background: 'linear-gradient(135deg,#0b1120,#1e1b4b)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)' }}>
          <span className="text-white font-black">A</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-white font-bold text-sm truncate">{kb.name}</div>
          <div className="text-violet-200/60 text-xs truncate">{kb.org_name} · AI assistant</div>
        </div>
        <button type="button" onClick={() => setShowHistory((s) => !s)} title="Chat history (last 24 hours)"
          className="text-violet-200/80 hover:text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-white/10 shrink-0">
          🕘 History
        </button>
        <button type="button" onClick={newChat} title="Start a new chat"
          className="text-violet-200/80 hover:text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-white/10 shrink-0">
          ＋ New
        </button>
      </div>

      {showHistory && (
        <div className="absolute left-0 right-0 top-[68px] bottom-0 z-20 bg-white flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="font-semibold text-sm text-slate-800">Your chats — last 24 hours</div>
            <button type="button" className="text-slate-400 hover:text-slate-700 text-lg leading-none" onClick={() => setShowHistory(false)}>✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            <button type="button" onClick={newChat}
              className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100">
              ＋ Start a new chat
            </button>
            {convos.length === 0 && (
              <p className="text-xs text-slate-400 px-2 py-3">No earlier chats in the last 24 hours.</p>
            )}
            {convos.map((c) => (
              <button key={c.id} type="button" onClick={() => openConvo(c.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${convoId === c.id ? 'bg-violet-50 text-violet-900 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>
                <span className="block truncate">💬 {c.title}</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">{fmtWhen(c.created_at)} · {c.msg_count} messages</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!embed && kb.description && <p className="px-5 py-3 text-sm text-slate-500 bg-slate-50 border-b">{kb.description}</p>}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="chat-bubble-ai">
            {kb.welcome_message || `Hi! Ask me anything about ${kb.name}.`}
          </div>
        )}
        {messages.map((m, i) => (
          m.role === 'user'
            ? <div key={i} className="chat-bubble-user !max-w-[85%]">{m.content}</div>
            : <div key={i}>
                <div className="chat-bubble-ai !max-w-[92%]">
                  {m.content || <span><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></span>}
                </div>
                {m.citations?.length > 0 && !m.streaming && (
                  <div className="flex gap-1.5 mt-1.5 ml-1 flex-wrap">
                    {m.citations.map((c) => (
                      <span key={c.n} className="badge badge-violet" title={c.text}>[{c.n}] {c.filename}</span>
                    ))}
                  </div>
                )}
              </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="p-3 border-t border-slate-100 flex gap-2">
        <input className="input !py-2.5" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" disabled={streaming} />
        <button className="btn btn-primary btn-sm !px-4" disabled={streaming || !input.trim()}>➤</button>
      </form>
      <div className="text-center pb-2"><span className="text-[10px] text-slate-300">Powered by ClaimPaid AI</span></div>
    </div>
  );
}
