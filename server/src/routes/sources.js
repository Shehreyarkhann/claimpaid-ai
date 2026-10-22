const express = require('express');
const { db } = require('../db');
const { authRequired, loadKb } = require('../auth');
const { requireAiAccess } = require('../plans');
const { runSource } = require('../crawler');

const router = express.Router({ mergeParams: true });
router.use(authRequired, requireAiAccess, loadKb);

// List auto-ingest sources
router.get('/', (req, res) => {
  const sources = db.prepare(`SELECT * FROM sources WHERE kb_id = ? ORDER BY created_at DESC`).all(req.kb.id);
  res.json({ sources });
});

// Add a source (sitemap URL or single page)
router.post('/', async (req, res) => {
  const { url, type } = req.body || {};
  if (!url?.trim()) return res.status(400).json({ error: 'URL is required' });
  let u;
  try { u = new URL(url.trim()); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(u.protocol)) return res.status(400).json({ error: 'Only http(s) URLs' });
  const sourceType = type === 'page' ? 'page' : 'sitemap';
  const id = db.prepare(`
    INSERT INTO sources (kb_id, org_id, type, url) VALUES (?, ?, ?, ?)
  `).run(req.kb.id, req.orgId, sourceType, u.toString()).lastInsertRowid;
  // run immediately in the background so the user sees results fast
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  runSource(source).catch(() => {});
  res.json({ ok: true, id });
});

// Run a source now
router.post('/:id/run', async (req, res) => {
  const source = db.prepare('SELECT * FROM sources WHERE id = ? AND kb_id = ?').get(req.params.id, req.kb.id);
  if (!source) return res.status(404).json({ error: 'Not found' });
  const result = await runSource(source);
  res.json({ ok: true, result });
});

// Delete a source (keeps already-ingested documents)
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM sources WHERE id = ? AND kb_id = ?').run(req.params.id, req.kb.id);
  res.json({ ok: true });
});

module.exports = router;
