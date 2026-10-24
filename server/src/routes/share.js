const express = require('express');
const { db } = require('../db');
const { answerQuestion } = require('../rag');

const router = express.Router();

// Public KB info (for share page / widget bootstrap)
router.get('/kb/:slug', (req, res) => {
  const kb = db.prepare(`
    SELECT k.id, k.name, k.description, k.welcome_message, o.name AS org_name
    FROM knowledge_bases k JOIN orgs o ON o.id = k.org_id
    WHERE k.public_slug = ? AND k.public_enabled = 1
  `).get(req.params.slug);
  if (!kb) return res.status(404).json({ error: 'Not found or not public' });
  res.json({ kb });
});

const HISTORY_WINDOW = `-24 hours`; // chat history surfaces show the last 24h only

function getPublicKb(slug) {
  return db.prepare('SELECT * FROM knowledge_bases WHERE public_slug = ? AND public_enabled = 1').get(slug);
}

function cleanVisitor(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(s) ? s : null;
}

// Public chat history for one anonymous visitor (widget history drawer).
// Only conversations stamped with that visitor id, last 24 hours.
router.get('/kb/:slug/conversations', (req, res) => {
  const kb = getPublicKb(req.params.slug);
  if (!kb) return res.status(404).json({ error: 'Not found or not public' });
  const visitor = cleanVisitor(req.query.visitor_id);
  if (!visitor) return res.status(400).json({ error: 'visitor_id required' });
  const conversations = db.prepare(`
    SELECT c.id, c.title, c.created_at,
      (SELECT COUNT(*) FROM messages m WHERE m.convo_id = c.id) AS msg_count
    FROM conversations c
    WHERE c.kb_id = ? AND c.is_public = 1 AND c.visitor_id = ?
      AND c.created_at >= datetime('now', '${HISTORY_WINDOW}')
    ORDER BY c.created_at DESC LIMIT 30
  `).all(kb.id, visitor);
  res.json({ conversations });
});

router.get('/kb/:slug/conversations/:id', (req, res) => {
  const kb = getPublicKb(req.params.slug);
  if (!kb) return res.status(404).json({ error: 'Not found or not public' });
  const visitor = cleanVisitor(req.query.visitor_id);
  if (!visitor) return res.status(400).json({ error: 'visitor_id required' });
  const convo = db.prepare(`
    SELECT * FROM conversations WHERE id = ? AND kb_id = ? AND is_public = 1 AND visitor_id = ?
      AND created_at >= datetime('now', '${HISTORY_WINDOW}')
  `).get(req.params.id, kb.id, visitor);
  if (!convo) return res.status(404).json({ error: 'Not found' });
  convo.messages = db.prepare('SELECT id, role, content, citations, created_at FROM messages WHERE convo_id = ? ORDER BY id')
    .all(convo.id).map((m) => ({ ...m, citations: JSON.parse(m.citations || '[]') }));
  res.json({ conversation: convo });
});

// Public streaming chat (no login; rate-limit by IP in front of this in production)
router.post('/kb/:slug/chat', async (req, res) => {
  const kb = getPublicKb(req.params.slug);
  if (!kb) return res.status(404).json({ error: 'Not found or not public' });
  const { message, conversation_id } = req.body || {};
  const visitor = cleanVisitor((req.body || {}).visitor_id);
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  const ready = db.prepare(`SELECT COUNT(*) c FROM documents WHERE kb_id = ? AND status = 'ready'`).get(kb.id).c;
  if (!ready) return res.status(400).json({ error: 'This knowledge base has no documents yet' });

  let convoId = conversation_id;
  if (convoId) {
    // Resume only the visitor's own conversation (visitor-stamped rows);
    // legacy rows without a stamp stay resumable only without a visitor id.
    const exists = db.prepare(`SELECT id, visitor_id FROM conversations WHERE id = ? AND kb_id = ? AND is_public = 1
      AND created_at >= datetime('now', '${HISTORY_WINDOW}')`)
      .get(convoId, kb.id);
    if (!exists || (exists.visitor_id && exists.visitor_id !== visitor)) convoId = null;
  }
  if (!convoId) {
    convoId = db.prepare(`
      INSERT INTO conversations (kb_id, org_id, user_id, title, is_public, visitor_id) VALUES (?, ?, NULL, ?, 1, ?)
    `).run(kb.id, kb.org_id, message.trim().slice(0, 60), visitor).lastInsertRowid;
  }
  const history = db.prepare(`SELECT role, content FROM messages WHERE convo_id = ? ORDER BY id DESC LIMIT 8`)
    .all(convoId).reverse();
  db.prepare(`INSERT INTO messages (convo_id, role, content) VALUES (?, 'user', ?)`).run(convoId, message.trim());

  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(`event: convo\ndata: ${JSON.stringify({ conversation_id: convoId })}\n\n`);
  try {
    const { full, citations, latencyMs } = await answerQuestion({ kb, query: message.trim(), history, res });
    db.prepare(`INSERT INTO messages (convo_id, role, content, citations, latency_ms) VALUES (?, 'assistant', ?, ?, ?)`)
      .run(convoId, full, JSON.stringify(citations), latencyMs);
  } catch (e) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(e.message).slice(0, 300) })}\n\n`);
  }
  res.end();
});

// Embeddable widget loader: <script src="https://HOST/api/share/widget.js" data-kb="SLUG"></script>
router.get('/widget.js', (req, res) => {
  res.type('application/javascript');
  res.send(`(function(){
  var s = document.currentScript;
  var slug = s.getAttribute('data-kb');
  var host = new URL(s.src).origin;
  if (!slug) return;
  var btn = document.createElement('button');
  btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  btn.setAttribute('aria-label', 'Chat with us');
  btn.style.cssText = 'position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#8b5cf6,#6d28d9);box-shadow:0 8px 28px rgba(139,92,246,.45);z-index:999998;display:flex;align-items:center;justify-content:center;';
  var frame = document.createElement('iframe');
  frame.src = host + '/app/widget/' + slug;
  frame.style.cssText = 'position:fixed;bottom:100px;right:24px;width:400px;max-width:calc(100vw - 48px);height:560px;max-height:calc(100vh - 140px);border:none;border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.3);z-index:999999;display:none;background:#fff;';
  frame.title = 'AskBase chat';
  btn.onclick = function(){ frame.style.display = frame.style.display === 'none' ? 'block' : 'none'; };
  document.body.appendChild(btn);
  document.body.appendChild(frame);
})();`);
});

module.exports = router;
