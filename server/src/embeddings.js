// Pluggable embedding service.
// Default: local all-MiniLM-L6-v2 via transformers.js (no API key, ~4ms/text).
// Optional: OpenAI embeddings via EMBEDDING_PROVIDER=openai + OPENAI_API_KEY.
let extractor = null;
let loading = null;

const PROVIDER = process.env.EMBEDDING_PROVIDER || 'local';

async function loadLocal() {
  if (extractor) return extractor;
  if (loading) return loading;
  loading = (async () => {
    const { pipeline } = await import('@xenova/transformers');
    // quiet the progress logs in production
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { progress_callback: () => {} });
    return extractor;
  })();
  return loading;
}

async function embedLocal(texts) {
  const ex = await loadLocal();
  const out = [];
  for (const t of texts) {
    const r = await ex(String(t).slice(0, 2000), { pooling: 'mean', normalize: true });
    out.push(Array.from(r.data));
  }
  return out;
}

async function embedOpenAI(texts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts.map((t) => String(t).slice(0, 8000)) }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status}`);
  const data = await res.json();
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function embed(texts) {
  const arr = Array.isArray(texts) ? texts : [texts];
  if (PROVIDER === 'openai') return embedOpenAI(arr);
  return embedLocal(arr);
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are normalized
}

module.exports = { embed, cosine, PROVIDER };
