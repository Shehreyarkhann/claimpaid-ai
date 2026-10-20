const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { authRequired, loadKb } = require('../auth');

const router = express.Router();
router.use(authRequired);

// List KBs with doc/chunk counts
router.get('/', (req, res) => {
  const kbs = db.prepare(`
    SELECT k.*,
      (SELECT COUNT(*) FROM documents d WHERE d.kb_id = k.id) AS doc_count,
      (SELECT COUNT(*) FROM chunks c WHERE c.kb_id = k.id) AS chunk_count,
      (SELECT COUNT(*) FROM conversations cv WHERE cv.kb_id = k.id) AS convo_count
    FROM knowledge_bases k WHERE k.org_id = ? ORDER BY k.created_at DESC
  `).all(req.orgId);
  res.json({ kbs });
});

// Create KB
router.post('/', (req, res) => {
  const { name, description } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const slug = crypto.randomBytes(8).toString('hex');
  const id = db.prepare(`
    INSERT INTO knowledge_bases (org_id, name, description, public_slug)
    VALUES (?, ?, ?, ?)
  `).run(req.orgId, name.trim(), (description || '').trim(), slug).lastInsertRowid;
  res.json({ kb: db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(id) });
});

// Get one KB
router.get('/:kbId', loadKb, (req, res) => {
  const kb = { ...req.kb };
  kb.doc_count = db.prepare('SELECT COUNT(*) c FROM documents WHERE kb_id = ?').get(kb.id).c;
  kb.chunk_count = db.prepare('SELECT COUNT(*) c FROM chunks WHERE kb_id = ?').get(kb.id).c;
  res.json({ kb });
});

// Update KB settings
router.put('/:kbId', loadKb, (req, res) => {
  const { name, description, chunk_size, chunk_overlap, top_k, system_prompt, welcome_message, public_enabled, web_fallback } = req.body || {};
  const kb = req.kb;
  db.prepare(`
    UPDATE knowledge_bases SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      chunk_size = COALESCE(?, chunk_size),
      chunk_overlap = COALESCE(?, chunk_overlap),
      top_k = COALESCE(?, top_k),
      system_prompt = COALESCE(?, system_prompt),
      welcome_message = COALESCE(?, welcome_message),
      public_enabled = COALESCE(?, public_enabled),
      web_fallback = COALESCE(?, web_fallback)
    WHERE id = ?
  `).run(
    name?.trim() || null, description ?? null,
    chunk_size ? Math.min(4000, Math.max(200, Number(chunk_size))) : null,
    chunk_overlap != null ? Math.min(1000, Math.max(0, Number(chunk_overlap))) : null,
    top_k ? Math.min(20, Math.max(1, Number(top_k))) : null,
    system_prompt ?? null, welcome_message ?? null,
    public_enabled != null ? (public_enabled ? 1 : 0) : null,
    web_fallback != null ? (web_fallback ? 1 : 0) : null,
    kb.id
  );
  res.json({ kb: db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(kb.id) });
});

// Delete KB
router.delete('/:kbId', loadKb, (req, res) => {
  db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(req.kb.id);
  res.json({ ok: true });
});

module.exports = router;
