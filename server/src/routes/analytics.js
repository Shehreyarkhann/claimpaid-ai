const express = require('express');
const { db } = require('../db');
const { authRequired, loadKb } = require('../auth');
const { requireAiAccess } = require('../plans');

const router = express.Router({ mergeParams: true });
router.use(authRequired, requireAiAccess, loadKb);

router.get('/', (req, res) => {
  const kb = req.kb;

  const totalQueries = db.prepare(`
    SELECT COUNT(*) c FROM messages m
    JOIN conversations c2 ON c2.id = m.convo_id
    WHERE c2.kb_id = ? AND m.role = 'user'
  `).get(kb.id).c;

  const feedback = db.prepare(`
    SELECT m.feedback, COUNT(*) c FROM messages m
    JOIN conversations c2 ON c2.id = m.convo_id
    WHERE c2.kb_id = ? AND m.role = 'assistant' AND m.feedback IS NOT NULL
    GROUP BY m.feedback
  `).all(kb.id);
  const up = feedback.find((f) => f.feedback === 'up')?.c || 0;
  const down = feedback.find((f) => f.feedback === 'down')?.c || 0;

  const noAnswer = db.prepare(`
    SELECT COUNT(*) c FROM messages m
    JOIN conversations c2 ON c2.id = m.convo_id
    WHERE c2.kb_id = ? AND m.role = 'assistant' AND m.citations = '[]'
  `).get(kb.id).c;

  const byDay = db.prepare(`
    SELECT substr(m.created_at, 1, 10) AS day, COUNT(*) c FROM messages m
    JOIN conversations c2 ON c2.id = m.convo_id
    WHERE c2.kb_id = ? AND m.role = 'user' AND m.created_at >= date('now', '-14 days')
    GROUP BY day ORDER BY day
  `).all(kb.id);

  const avgLatency = db.prepare(`
    SELECT AVG(m.latency_ms) avg FROM messages m
    JOIN conversations c2 ON c2.id = m.convo_id
    WHERE c2.kb_id = ? AND m.role = 'assistant' AND m.latency_ms IS NOT NULL
  `).get(kb.id).avg;

  // most-cited documents
  let topDocs = [];
  try {
    topDocs = db.prepare(`
      SELECT d.filename, COUNT(*) c FROM messages m
      JOIN conversations c2 ON c2.id = m.convo_id,
      json_each(m.citations)
      JOIN documents d ON d.id = json_each.value ->> '$.doc_id'
      WHERE c2.kb_id = ? AND m.role = 'assistant'
      GROUP BY d.id ORDER BY c DESC LIMIT 5
    `).all(kb.id);
  } catch { topDocs = []; }

  // recent questions
  const recent = db.prepare(`
    SELECT m.content, m.created_at FROM messages m
    JOIN conversations c2 ON c2.id = m.convo_id
    WHERE c2.kb_id = ? AND m.role = 'user'
    ORDER BY m.id DESC LIMIT 10
  `).all(kb.id);

  res.json({
    totalQueries, thumbsUp: up, thumbsDown: down,
    noAnswerCount: noAnswer,
    noAnswerRate: totalQueries ? +(noAnswer / totalQueries).toFixed(3) : 0,
    byDay, avgLatencyMs: Math.round(avgLatency || 0),
    topDocs, recent,
  });
});

module.exports = router;
