const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { authRequired } = require('../auth');
const { retrieve } = require('../rag');

const router = express.Router();

// ---- management (org auth) ----
router.get('/', authRequired, (req, res) => {
  const keys = db.prepare(`
    SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE org_id = ? ORDER BY created_at DESC
  `).all(req.orgId);
  res.json({ keys });
});

router.post('/', authRequired, (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const raw = 'ask_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const id = db.prepare(`INSERT INTO api_keys (org_id, name, key_hash, prefix) VALUES (?, ?, ?, ?)`)
    .run(req.orgId, name.trim(), hash, raw.slice(0, 8)).lastInsertRowid;
  // raw key is shown ONCE
  res.json({ id, key: raw, prefix: raw.slice(0, 8) });
});

router.delete('/:id', authRequired, (req, res) => {
  db.prepare('DELETE FROM api_keys WHERE id = ? AND org_id = ?').run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// ---- developer API (key auth) ----
function keyAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const raw = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!raw) return res.status(401).json({ error: 'API key required' });
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const key = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hash);
  if (!key) return res.status(401).json({ error: 'Invalid API key' });
  db.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?').run(key.id);
  req.orgId = key.org_id;
  next();
}

// POST /api/v1/query  { kb_id, question, top_k? } -> { answer, citations, mode }
const v1 = express.Router();
v1.post('/query', keyAuth, async (req, res) => {
  const { kb_id, question, top_k } = req.body || {};
  if (!kb_id || !question?.trim()) return res.status(400).json({ error: 'kb_id and question are required' });
  const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ? AND org_id = ?').get(kb_id, req.orgId);
  if (!kb) return res.status(404).json({ error: 'Knowledge base not found' });

  const chunks = await retrieve(kb, question.trim(), top_k || kb.top_k);
  const citations = chunks.map((c, i) => ({
    n: i + 1, filename: c.filename, chunk_index: c.chunk_index,
    text: c.text.slice(0, 500), score: +c.score.toFixed(3),
  }));
  // extractive answer (non-streaming); use /app chat for LLM streaming
  const answer = chunks.length
    ? chunks.slice(0, 4).map((c, i) => `${c.text.trim()}\n[${i + 1}]`).join('\n\n')
    : 'No relevant information found in this knowledge base.';
  res.json({ answer, citations, mode: chunks.length ? 'extractive' : 'none' });
});

module.exports = router;
module.exports.v1 = v1;
