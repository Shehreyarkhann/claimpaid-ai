const express = require('express');
const { db } = require('../db');
const { authRequired, loadKb } = require('../auth');
const { requireAiAccess } = require('../plans');
const { answerQuestion, llmEnabled, LLM_MODEL, providerLabel } = require('../rag');
const { resolveAiLimit, checkAiQuota, recordAiQuery } = require('../usage');

const router = express.Router({ mergeParams: true });
router.use(authRequired, requireAiAccess, loadKb);

// List conversations — chat history shows the last 24 hours only
router.get('/conversations', (req, res) => {
  const convos = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.convo_id = c.id) AS msg_count
    FROM conversations c WHERE c.kb_id = ? AND c.user_id = ?
      AND c.created_at >= datetime('now', '-24 hours')
    ORDER BY c.created_at DESC LIMIT 50
  `).all(req.kb.id, req.user.id);
  res.json({ conversations: convos, llm: llmEnabled(), model: llmEnabled() ? LLM_MODEL : null, provider: providerLabel() });
});

// Get conversation with messages (same 24h window as the list)
router.get('/conversations/:id', (req, res) => {
  const convo = db.prepare(`SELECT * FROM conversations WHERE id = ? AND kb_id = ? AND user_id = ?
      AND created_at >= datetime('now', '-24 hours')`)
    .get(req.params.id, req.kb.id, req.user.id);
  if (!convo) return res.status(404).json({ error: 'Not found' });
  convo.messages = db.prepare('SELECT id, role, content, citations, feedback, created_at FROM messages WHERE convo_id = ? ORDER BY id')
    .all(convo.id).map((m) => ({ ...m, citations: JSON.parse(m.citations || '[]') }));
  res.json({ conversation: convo });
});

// Delete conversation
router.delete('/conversations/:id', (req, res) => {
  db.prepare('DELETE FROM conversations WHERE id = ? AND kb_id = ? AND user_id = ?')
    .run(req.params.id, req.kb.id, req.user.id);
  res.json({ ok: true });
});

// Feedback on a message
router.post('/messages/:id/feedback', (req, res) => {
  const { feedback } = req.body || {};
  if (!['up', 'down', null].includes(feedback)) return res.status(400).json({ error: 'Invalid feedback' });
  const msg = db.prepare(`
    SELECT m.id FROM messages m
    JOIN conversations c ON c.id = m.convo_id
    WHERE m.id = ? AND c.kb_id = ?
  `).get(req.params.id, req.kb.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE messages SET feedback = ? WHERE id = ?').run(feedback, msg.id);
  res.json({ ok: true });
});

// --- Streaming chat (SSE) ---
router.post('/', async (req, res) => {
  const { message, conversation_id } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  const ready = db.prepare(`SELECT COUNT(*) c FROM documents WHERE kb_id = ? AND status = 'ready'`).get(req.kb.id).c;
  if (!ready) return res.status(400).json({ error: 'Add at least one document to the knowledge base first' });

  // Plan quota: one metered AI query per accepted chat message, counted per
  // RCM org per UTC calendar month. Over quota => 402 with an upgrade path.
  const limit = resolveAiLimit(req);
  const quota = checkAiQuota(req.rcmOrgId, limit, req.plan);
  if (!quota.allowed) return res.status(402).json(quota.body);
  if (req.rcmOrgId && limit !== null && limit !== undefined) recordAiQuery(req.rcmOrgId);

  let convoId = conversation_id;
  if (convoId) {
    const exists = db.prepare(`SELECT id FROM conversations WHERE id = ? AND kb_id = ? AND user_id = ?
      AND created_at >= datetime('now', '-24 hours')`)
      .get(convoId, req.kb.id, req.user.id);
    if (!exists) convoId = null;
  }
  if (!convoId) {
    const title = message.trim().slice(0, 60);
    convoId = db.prepare(`
      INSERT INTO conversations (kb_id, org_id, user_id, title) VALUES (?, ?, ?, ?)
    `).run(req.kb.id, req.orgId, req.user.id, title).lastInsertRowid;
  }

  const history = db.prepare(`SELECT role, content FROM messages WHERE convo_id = ? ORDER BY id DESC LIMIT 8`)
    .all(convoId).reverse();

  db.prepare(`INSERT INTO messages (convo_id, role, content) VALUES (?, 'user', ?)`)
    .run(convoId, message.trim());

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: convo\ndata: ${JSON.stringify({ conversation_id: convoId })}\n\n`);

  try {
    const { full, citations, mode, latencyMs } = await answerQuestion({
      kb: req.kb, query: message.trim(), history, res,
    });
    db.prepare(`INSERT INTO messages (convo_id, role, content, citations, latency_ms) VALUES (?, 'assistant', ?, ?, ?)`)
      .run(convoId, full, JSON.stringify(citations), latencyMs);
  } catch (e) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(e.message).slice(0, 300) })}\n\n`);
  }
  res.end();
});

module.exports = router;
