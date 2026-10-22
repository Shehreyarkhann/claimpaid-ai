const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { authRequired, loadKb } = require('../auth');
const { requireAiAccess } = require('../plans');
const { extractText, extractUrl, chunkText } = require('../ingest');
const { embed } = require('../embeddings');

const router = express.Router({ mergeParams: true });
router.use(authRequired, requireAiAccess, loadKb);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const ok = /pdf|word|text|markdown/i.test(file.mimetype) ||
      /\.(pdf|docx|txt|md|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only PDF, DOCX, TXT, MD, CSV files are supported'), ok);
  },
});

// List documents
router.get('/', (req, res) => {
  const docs = db.prepare(`
    SELECT id, filename, source_type, source_url, mime, char_count, chunk_count, status, error, created_at
    FROM documents WHERE kb_id = ? ORDER BY created_at DESC
  `).all(req.kb.id);
  res.json({ documents: docs });
});

// Upload files
router.post('/upload', upload.array('files', 10), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files received' });
  const created = [];
  for (const f of req.files) {
    const id = db.prepare(`
      INSERT INTO documents (kb_id, org_id, filename, source_type, mime, status)
      VALUES (?, ?, ?, 'upload', ?, 'processing')
    `).run(req.kb.id, req.orgId, f.originalname, f.mimetype).lastInsertRowid;
    created.push(id);
    processDocument(id, { buffer: f.buffer, mime: f.mimetype, filename: f.originalname }).catch(() => {});
  }
  res.json({ ok: true, ids: created });
});

// Import from URL
router.post('/url', async (req, res) => {
  const { url } = req.body || {};
  if (!url?.trim()) return res.status(400).json({ error: 'URL is required' });
  const id = db.prepare(`
    INSERT INTO documents (kb_id, org_id, filename, source_type, source_url, status)
    VALUES (?, ?, ?, 'url', ?, 'processing')
  `).run(req.kb.id, req.orgId, url.trim(), url.trim()).lastInsertRowid;
  processDocument(id, { url: url.trim() }).catch(() => {});
  res.json({ ok: true, id });
});

// Delete document (cascades chunks)
router.delete('/:docId', (req, res) => {
  const doc = db.prepare('SELECT id FROM documents WHERE id = ? AND kb_id = ?').get(req.params.docId, req.kb.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  res.json({ ok: true });
});

// Retry failed document
router.post('/:docId/retry', async (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND kb_id = ?').get(req.params.docId, req.kb.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  db.prepare(`UPDATE documents SET status = 'processing', error = NULL WHERE id = ?`).run(doc.id);
  db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(doc.id);
  // re-ingest requires the original source — only URL docs can retry without re-upload
  if (doc.source_type === 'url') {
    processDocument(doc.id, { url: doc.source_url }).catch(() => {});
    res.json({ ok: true });
  } else {
    db.prepare(`UPDATE documents SET status = 'failed', error = 'Re-upload the file to retry' WHERE id = ?`).run(doc.id);
    res.json({ ok: true, note: 're-upload required' });
  }
});

// --- background ingestion ---
async function processDocument(docId, source) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  if (!doc) return;
  const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(doc.kb_id);
  try {
    let text;
    if (source.url) text = await extractUrl(source.url);
    else text = await extractText(source.buffer, source.mime, source.filename);
    if (!text || text.length < 20) throw new Error('No readable text found in this document');

    const pieces = chunkText(text, kb.chunk_size, kb.chunk_overlap);
    if (!pieces.length) throw new Error('Could not split document into chunks');

    // embed in batches of 16
    const BATCH = 16;
    const insert = db.prepare(`
      INSERT INTO chunks (doc_id, kb_id, org_id, chunk_index, text, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    let idx = 0;
    for (let i = 0; i < pieces.length; i += BATCH) {
      const batch = pieces.slice(i, i + BATCH);
      const vecs = await embed(batch);
      db.exec('BEGIN');
      try {
        batch.forEach((text, j) => {
          insert.run(docId, kb.id, doc.org_id, idx++, text, JSON.stringify(vecs[j]));
        });
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    db.prepare(`UPDATE documents SET status = 'ready', char_count = ?, chunk_count = ?, error = NULL WHERE id = ?`)
      .run(text.length, pieces.length, docId);
  } catch (e) {
    db.prepare(`UPDATE documents SET status = 'failed', error = ? WHERE id = ?`)
      .run(String(e.message).slice(0, 500), docId);
  }
}

module.exports = router;
