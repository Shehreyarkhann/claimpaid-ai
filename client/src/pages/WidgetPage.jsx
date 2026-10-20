import { useEffect, useRef, useState } from 'react';

// Public chat page: full-page share view, or compact embed widget.
export default function WidgetPage({ slug, embed }) {
  const [kb, setKb] = useState(null);
  const [err, setErr] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [convoId, setConvoId] = useState(() => sessionStorage.getItem(`ab-convo-${slug}`) || null);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch(`/api/share/kb/${slug}`).then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error);
      else setKb(d.kb);
    }).catch(() => setErr('Could not load'));
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
      const res = await fetch(`/api/share/kb/${slug}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation_id: convoId }),
      });
      if (!res.ok) throw new Error('Chat failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const append = (t) => setMessages((m) => {
        const c = [...m]; const last = { ...c[c.length - 1] };
        last.content += t; c[c.length - 1] = last; return c;
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
          if (type === 'convo' && data.conversation_id) {
            setConvoId(data.conversation_id);
            sessionStorage.setItem(`ab-convo-${slug}`, data.conversation_id);
          } else if (type === 'meta') {
            setMessages((m) => { const c = [...m]; const l = { ...c[c.length - 1] }; l.citations = data.citations || []; c[c.length - 1] = l; return c; });
          } else if (type === 'token' && data.text) append(data.text);
          else if (type === 'error') throw new Error(data.error);
        }
      }
      setMessages((m) => { const c = [...m]; const l = { ...c[c.length - 1] }; delete l.streaming; c[c.length - 1] = l; return c; });
    } catch (err2) {
      setMessages((m) => m.slice(0, -1));
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
    <div className={`${wrap} flex flex-col bg-white`}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3" style={{ background: 'linear-gradient(135deg,#0b1120,#1e1b4b)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)' }}>
          <span className="text-white font-black">A</span>
        </div>
        <div className="min-w-0">
          <div className="text-white font-bold text-sm truncate">{kb.name}</div>
          <div className="text-violet-200/60 text-xs truncate">{kb.org_name} · AI assistant</div>
        </div>
      </div>
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
      <div className="text-center pb-2"><span className="text-[10px] text-slate-300">Powered by AskBase</span></div>
    </div>
  );
}
