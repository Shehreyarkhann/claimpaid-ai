// RAG pipeline: retrieve relevant chunks, then answer with citations.
// LLM mode: OpenAI-compatible chat completions (streaming SSE passthrough).
// Demo mode (no LLM configured): extractive answer assembled from top chunks.
const { db } = require('./db');
const { embed, cosine } = require('./embeddings');

// Named provider presets. LLM_PROVIDER picks one; LLM_BASE_URL/LLM_MODEL/LLM_API_KEY override.
const PRESETS = {
  demo:     { base: null, model: null },
  openai:   { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  groq:     { base: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant' },
  together: { base: 'https://api.together.xyz/v1', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo' },
  ollama:   { base: 'http://localhost:11434/v1', model: 'qwen2.5:3b-instruct' }, // fully offline
  lmstudio: { base: 'http://localhost:1234/v1', model: 'local-model' },    // fully offline
};
const PROVIDER = (process.env.LLM_PROVIDER || '').toLowerCase();
const preset = PRESETS[PROVIDER] || {};
const LLM_BASE = (process.env.LLM_BASE_URL || preset.base || '').replace(/\/$/, '');
const LLM_MODEL = process.env.LLM_MODEL || preset.model || 'gpt-4o-mini';
const LLM_KEY = process.env.LLM_API_KEY || '';
// Ollama/LM Studio don't need keys — enabled when a base URL is set
const llmEnabled = () => !!LLM_BASE && (PROVIDER === 'ollama' || PROVIDER === 'lmstudio' || !!LLM_KEY);
const providerLabel = () => {
  if (!llmEnabled()) return 'demo (extractive)';
  if (PROVIDER && PRESETS[PROVIDER]) return `${PROVIDER} (${LLM_MODEL})`;
  return `custom (${LLM_MODEL})`;
};

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

function buildPrompt(kb, query, chunks, history = [], webUsed = false, generalKnowledge = false) {
  const context = chunks
    .map((c, i) => `[${i + 1}] (from "${c.filename}")\n${c.text}`)
    .join('\n\n');
  const hist = history.slice(-10).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');

  const persona =
    'You are ClaimPaid AI — a sharp, friendly, genuinely helpful assistant. You are conversational, not robotic: ' +
    'warm greetings get warm replies, jokes get a light touch, and you never answer a simple "hi" with a lecture. ' +
    'You have two sources of knowledge, and you are always clear about which you are using:\n' +
    '1. THE USER\'S DOCUMENTS (reference excerpts below, when present) — this is your superpower. Ground factual claims in them and cite with [n] markers.\n' +
    '2. YOUR OWN GENERAL KNOWLEDGE (your training) — use it freely for greetings, small talk, explanations, reasoning, math, writing help, and general questions. ' +
    'When answering from general knowledge rather than their documents, you may say so naturally ("from what I know generally…", "this isn\'t in your documents, but…").\n' +
    'CONVERSATION: you remember this conversation. "What about Cigna?" after discussing Aetna means Cigna\'s timely filing limit. ' +
    '"Why?" refers to your last answer. Never ask the user to repeat themselves — use the history.\n' +
    'STYLE: write like a smart colleague over chat. Short paragraphs, bullets and bold for structure when it helps, never walls of text. ' +
    'Be thorough when the question deserves it; be brief when it doesn\'t. A greeting gets one or two sentences, not an essay.\n' +
    'HONESTY: if you genuinely don\'t know something, say so and suggest how to find out. For high-stakes facts (medical, legal, financial specifics), ' +
    'note that they should verify against an authoritative source. Never invent citations, document names, or statistics.\n' +
    'You run entirely on the customer\'s own servers — their documents never leave their infrastructure.';

  const system = webUsed
    ? persona + '\nThe excerpts below come from WEB SEARCH RESULTS, not the user\'s documents — say so when relevant. ' +
      'Write a clear, natural answer in your own words. Cite factual claims with [n] markers matching the excerpts.'
    : generalKnowledge
    ? persona + '\nNo reference excerpts this time — answer from your general knowledge, conversationally. ' +
      'If the question touches the user\'s domain (their documents\' topic), you can note that their documents might have the authoritative answer and offer to check if they upload them.'
    : (kb.system_prompt?.trim() || persona) +
      '\n\nAnswer the question in your own words: synthesize what the excerpts say into a clear, well-organized, genuinely helpful response. ' +
      'Write like a knowledgeable colleague — short paragraphs, bullet or numbered lists for steps, comparisons and details, bold for key terms and figures. ' +
      'Be thorough: if the excerpts contain related details the user would care about (deadlines, exceptions, consequences, next steps), include them — don\'t give a one-sentence answer when a fuller explanation is warranted. ' +
      'Do NOT copy-paste passages from the excerpts; explain and summarize. ' +
      'CRITICAL — NEVER CONFLATE: each excerpt is labeled with its source (payer, document, section). Different payers have DIFFERENT limits and rules. ' +
      'When asked about a specific payer, find THAT payer\'s excerpt and report ONLY its figure — never apply one payer\'s number to another, ' +
      'even if they were discussed together. If the excerpts don\'t name the requested payer, say so instead of guessing. ' +
      'Ground every factual claim in the excerpts and cite it with [n] markers matching the excerpt numbers.';

  const user = generalKnowledge
    ? `${hist ? `Conversation so far:\n${hist}\n\n` : ''}User: ${query}\n\n(Answer from your general knowledge — no document excerpts available.)`
    : `${hist ? `Conversation so far:\n${hist}\n\n` : ''}Reference excerpts:\n${context}\n\nQuestion: ${query}\n\nWrite a clear, complete answer in your own words with [n] citations.`;
  return { system, user };
}

// Stream tokens from an OpenAI-compatible SSE endpoint into our res
async function streamLlm(res, kb, query, chunks, history, citations, webUsed = false, generalKnowledge = false) {
  const { system, user } = buildPrompt(kb, query, chunks, history, webUsed, generalKnowledge);
  const upstream = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(LLM_KEY ? { Authorization: `Bearer ${LLM_KEY}` } : {}),
    },
    // 3 min cap: qwen2.5:3b on 2 vCPU can take 60-90s; never hang forever
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify({
      model: LLM_MODEL,
      stream: true,
      temperature: 0.4,
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
async function streamExtractive(res, kb, query, chunks, citations, webUsed = false) {
  res.write(`event: meta\ndata: ${JSON.stringify({ citations, mode: webUsed ? 'demo+web' : 'demo' })}\n\n`);
  const parts = [
    webUsed
      ? `Your documents didn't cover this, so here's what I found on the web:\n\n`
      : `Based on your documents, here's what I found:\n\n`,
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
  // Follow-up queries ("what about Cigna?") are useless for retrieval on their own —
  // expand with recent user messages so the embedding carries the actual topic.
  let retrievalQuery = query;
  const prevUserMsgs = history.filter((m) => m.role === 'user').slice(-2).map((m) => m.content);
  if (prevUserMsgs.length && query.trim().split(/\s+/).length < 10) {
    retrievalQuery = prevUserMsgs.join(' ') + ' ' + query;
  }
  let chunks = await retrieve(kb, retrievalQuery, kb.top_k);
  let webUsed = false;

  // Autopilot web fallback: docs don't have it → ask the internet (opt-in per KB)
  if (chunks.length === 0 && kb.web_fallback && process.env.BRAVE_API_KEY) {
    try {
      chunks = await webSearch(query, kb.top_k);
      webUsed = chunks.length > 0;
    } catch (e) { /* web search failed: fall through to no-answer */ }
  }

  const citations = chunks.map((c, i) => ({
    n: i + 1,
    doc_id: c.doc_id || null,
    filename: c.filename,
    chunk_index: c.chunk_index,
    text: c.text.slice(0, 600),
    score: c.score != null ? +c.score.toFixed(3) : null,
    web: !!c.web,
    url: c.url || null,
  }));

  let full = '';
  let mode = 'demo';
  if (chunks.length === 0 && llmEnabled()) {
    // No document hits — answer from the model's own general knowledge instead of playing dumb.
    // The prompt makes clear which knowledge source is being used.
    mode = 'llm-general';
    res.write(`event: meta\ndata: ${JSON.stringify({ citations: [], mode, model: LLM_MODEL })}\n\n`);
    full = await streamLlm(res, kb, query, [], history, [], webUsed, true);
  } else if (chunks.length === 0) {
    mode = 'none';
    res.write(`event: meta\ndata: ${JSON.stringify({ citations: [], mode })}\n\n`);
    full = `I couldn't find anything in your documents about that. Try rephrasing the question, or add documents that cover this topic to the knowledge base.`;
    res.write(`event: token\ndata: ${JSON.stringify({ text: full })}\n\n`);
  } else if (llmEnabled()) {
    mode = webUsed ? 'llm+web' : 'llm';
    full = await streamLlm(res, kb, query, chunks, history, citations, webUsed);
  } else {
    mode = webUsed ? 'demo+web' : 'demo';
    full = await streamExtractive(res, kb, query, chunks, citations, webUsed);
  }
  res.write(`event: done\ndata: ${JSON.stringify({ mode })}\n\n`);
  return { full, citations, mode, latencyMs: Date.now() - t0 };
}

// Brave Search fallback — clearly-labeled web results when docs don't have the answer
async function webSearch(query, topK = 5) {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${topK}`, {
    headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);
  const data = await res.json();
  const results = (data.web?.results || []).slice(0, topK);
  return results.map((r, i) => {
    let domain = '';
    try { domain = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
    return {
      id: `web-${i}`,
      doc_id: null,
      filename: `🌐 ${domain || 'web'}`,
      chunk_index: i,
      text: `${r.title}\n\n${r.description || ''}`,
      score: null,
      web: true,
      url: r.url,
    };
  });
}

module.exports = { retrieve, answerQuestion, llmEnabled, LLM_MODEL, LLM_BASE, providerLabel, PROVIDER };
