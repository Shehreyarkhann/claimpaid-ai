// RAG pipeline: retrieve relevant chunks, then answer with citations.
// LLM mode: OpenAI-compatible chat completions (streaming SSE passthrough).
// Demo mode (no LLM_API_KEY): extractive answer assembled from top chunks.
const { db } = require('./db');
const { embed, cosine } = require('./embeddings');

const LLM_BASE = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const LLM_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const llmEnabled = () => !!LLM_KEY;

const MIN_SCORE = 0.28; // below this, chunks are not considered relevant

async function retrieve(kb, query, topK) {
  const [qvec] = await embed(query);
  const rows = db.prepare('SELECT c.id, c.text, c.embedding, c.chunk_index, d.filename FROM chunks c JOIN documents d ON d.id = c.doc_id WHERE c.kb_id = ?').all(kb.id);
  const scored = [];
  for (const r of rows) {
    let emb;
    try { emb = JSON.parse(r.embedding); } catch { continue; }
    if (!Array.isArray(emb) || emb.length !== qvec.length) continue;
    const score = cosine(qvec, emb);
    if (score >= MIN_SCORE) scored.push({ ...r, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK || kb.top_k || 5);
}

function buildPrompt(kb, query, chunks, history = []) {
  const context = chunks
    .map((c, i) => `[${i + 1}] (from "${c.filename}")\n${c.text}`)
    .join('\n\n');
  const hist = history.slice(-6).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
  const system = kb.system_prompt?.trim() ||
    'You are a helpful assistant that answers questions using ONLY the provided document excerpts. ' +
    'Cite every factual claim with [n] markers matching the excerpts. ' +
    'If the excerpts do not contain the answer, say you do not have enough information — never invent facts.';
  return {
    system,
    user: `${hist ? `Conversation so far:\n${hist}\n\n` : ''}Document excerpts:\n${context}\n\nQuestion: ${query}\n\nAnswer concisely with [n] citations.`,
  };
}

// Stream tokens from an OpenAI-compatible SSE endpoint into our res
async function streamLlm(res, kb, query, chunks, history, citations) {
  const { system, user } = buildPrompt(kb, query, chunks, history);
  const upstream = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      stream: true,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!upstream.ok || !upstream.body) {
    throw new Error(`LLM request failed: ${upstream.status}`);
  }
  res.write(`event: meta\ndata: ${JSON.stringify({ citations, mode: 'llm', model: LLM_MODEL })}\n\n`);

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          res.write(`event: token\ndata: ${JSON.stringify({ text: delta })}\n\n`);
        }
      } catch { /* partial chunk */ }
    }
  }
  return full;
}

// Demo mode: no LLM key — assemble an extractive answer from the top chunks
async function streamExtractive(res, kb, query, chunks, citations) {
  res.write(`event: meta\ndata: ${JSON.stringify({ citations, mode: 'demo' })}\n\n`);
  const parts = [
    `Based on your documents, here's what I found:\n\n`,
    ...chunks.slice(0, 4).map((c, i) => `${c.text.trim()}\n[${i + 1}]`),
  ];
  const full = parts.join('\n\n');
  // stream it in word groups so the UI animates like a real response
  const words = full.split(/(\s+)/);
  let out = '';
  for (let i = 0; i < words.length; i += 6) {
    const piece = words.slice(i, i + 6).join('');
    out += piece;
    res.write(`event: token\ndata: ${JSON.stringify({ text: piece })}\n\n`);
    await new Promise((r) => setTimeout(r, 24));
  }
  return out;
}

async function answerQuestion({ kb, query, history = [], res }) {
  const t0 = Date.now();
  const chunks = await retrieve(kb, query, kb.top_k);
  const citations = chunks.map((c, i) => ({
    n: i + 1,
    doc_id: c.doc_id,
    filename: c.filename,
    chunk_index: c.chunk_index,
    text: c.text.slice(0, 600),
    score: +c.score.toFixed(3),
  }));

  let full = '';
  let mode = 'demo';
  if (chunks.length === 0) {
    mode = 'none';
    res.write(`event: meta\ndata: ${JSON.stringify({ citations: [], mode })}\n\n`);
    full = `I couldn't find anything in your documents about that. Try rephrasing the question, or add documents that cover this topic to the knowledge base.`;
    res.write(`event: token\ndata: ${JSON.stringify({ text: full })}\n\n`);
  } else if (llmEnabled()) {
    mode = 'llm';
    full = await streamLlm(res, kb, query, chunks, history, citations);
  } else {
    full = await streamExtractive(res, kb, query, chunks, citations);
  }
  res.write(`event: done\ndata: ${JSON.stringify({ mode })}\n\n`);
  return { full, citations, mode, latencyMs: Date.now() - t0 };
}

module.exports = { retrieve, answerQuestion, llmEnabled, LLM_MODEL };
