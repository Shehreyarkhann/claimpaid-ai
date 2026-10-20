const express = require('express');
const { db } = require('../db');
const { authRequired, loadKb } = require('../auth');
const { chunkText } = require('../ingest');
const { embed } = require('../embeddings');

const router = express.Router({ mergeParams: true });
router.use(authRequired, loadKb);

// --- "Teach it": one click turns an unanswered question into permanent knowledge ---
router.post('/teach', async (req, res) => {
  const { question, answer } = req.body || {};
  if (!question?.trim() || !answer?.trim()) {
    return res.status(400).json({ error: 'Question and answer are both required' });
  }
  const kb = req.kb;

  // one living document per KB holds everything the team has taught it
  let doc = db.prepare(`SELECT * FROM documents WHERE kb_id = ? AND source_type = 'learned'`).get(kb.id);
  let existing = '';
  if (!doc) {
    const id = db.prepare(`
      INSERT INTO documents (kb_id, org_id, filename, source_type, mime, status)
      VALUES (?, ?, ?, 'learned', 'text/markdown', 'processing')
    `).run(kb.id, req.orgId, '💡 Learned answers').lastInsertRowid;
    doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  } else {
    const chunks = db.prepare(`SELECT text FROM chunks WHERE doc_id = ? ORDER BY chunk_index`).all(doc.id);
    existing = chunks.map((c) => c.text).join('\n\n');
  }

  const entry = `## Q: ${question.trim()}\n\n${answer.trim()}\n`;
  const fullText = existing ? `${existing}\n\n${entry}` : `# Learned answers\n\nTaught by the ${kb.name} team.\n\n${entry}`;

  // re-embed the whole doc (simple + always consistent)
  db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(doc.id);
  const pieces = chunkText(fullText, kb.chunk_size, kb.chunk_overlap);
  const insert = db.prepare(`INSERT INTO chunks (doc_id, kb_id, org_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?, ?)`);
  let idx = 0;
  for (let i = 0; i < pieces.length; i += 16) {
    const batch = pieces.slice(i, i + 16);
    const vecs = await embed(batch);
    db.exec('BEGIN');
    try {
      batch.forEach((t, j) => insert.run(doc.id, kb.id, req.orgId, idx++, t, JSON.stringify(vecs[j])));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  db.prepare(`UPDATE documents SET status='ready', char_count=?, chunk_count=? WHERE id=?`)
    .run(fullText.length, pieces.length, doc.id);

  res.json({ ok: true, chunks: pieces.length });
});

// --- Insights: what the KB doesn't know yet, and what's gathering dust ---
router.get('/insights', (req, res) => {
  const kb = req.kb;

  // unanswered questions: user messages whose assistant reply has no citations
  const rows = db.prepare(`
    SELECT m.id, m.content, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.convo_id
    WHERE c.kb_id = ? AND m.role = 'user'
      AND EXISTS (
        SELECT 1 FROM messages a
        WHERE a.convo_id = m.convo_id AND a.role = 'assistant'
          AND a.id > m.id AND (a.citations = '[]' OR a.citations IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM messages newer
            WHERE newer.convo_id = m.convo_id AND newer.role = 'user' AND newer.id > m.id AND newer.id < a.id
          )
      )
    ORDER BY m.id DESC LIMIT 100
  `).all(kb.id);

  // group near-duplicates: normalize + cluster by shared distinctive words
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const groups = [];
  for (const r of rows) {
    const n = norm(r.content);
    const words = new Set(n.split(' ').filter((w) => w.length > 3));
    let g = groups.find((g) => {
      const inter = [...words].filter((w) => g.words.has(w)).length;
      return inter >= 3 && inter / Math.max(words.size, g.words.size) > 0.4;
    });
    if (!g) { g = { question: r.content, count: 0, words, latest: r.created_at, ids: [] }; groups.push(g); }
    g.count++;
    g.ids.push(r.id);
    if (r.created_at > g.latest) { g.latest = r.created_at; g.question = r.content; }
  }
  groups.sort((a, b) => b.count - a.count);
  const unanswered = groups.slice(0, 20).map((g) => ({ question: g.question, count: g.count, latest: g.latest }));

  // dead content: docs with zero citations in the last 30 days
  let deadDocs = [];
  try {
    deadDocs = db.prepare(`
      SELECT d.id, d.filename, d.chunk_count,
        (SELECT COUNT(*) FROM messages m
         JOIN conversations c ON c.id = m.convo_id,
         json_each(m.citations)
         WHERE c.kb_id = ? AND m.role = 'assistant'
           AND (json_each.value ->> '$.doc_id') = d.id
           AND m.created_at >= date('now', '-30 days')) AS cites
      FROM documents d WHERE d.kb_id = ? AND d.status = 'ready'
      HAVING cites = 0 ORDER BY d.created_at LIMIT 10
    `).all(kb.id, kb.id);
  } catch {}

  // learned answers doc stats
  const learned = db.prepare(`SELECT chunk_count FROM documents WHERE kb_id = ? AND source_type = 'learned'`).get(kb.id);

  res.json({
    unanswered,
    unansweredTotal: rows.length,
    deadDocs,
    learnedChunks: learned?.chunk_count || 0,
  });
});

module.exports = router;
