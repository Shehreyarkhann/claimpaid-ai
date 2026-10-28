'use strict';
// POST /api/v1/kb-search — retrieval-only search over the Payer Policy
// Handbook, for the ClaimPaid RCM server's in-app agent (search_handbook
// tool). Authenticated with the SAME service JWT as /api/v1/code-assist
// (rcmServiceAuth: x-service-token, {service:'claimpaid-rcm', org} signed
// with RCM_JWT_SECRET, plus the RCM plan gate).
//
// Scope: ONLY the handbook — the knowledge_bases row whose public_slug is
// 'payer-policy-handbook' (the 'ClaimPaid Public' org's published KB).
// Returns raw chunks [{ text, source, score }] — no generation, no chat
// machinery. Retrieval is the existing RAG path (rag.retrieve over the
// KB's ready documents), exactly as chat uses it.
const express = require('express');
const { db } = require('../db');
const { retrieve } = require('../rag');
const { rcmServiceAuth } = require('./codeassist');

const router = express.Router();

const HANDBOOK_SLUG = 'payer-policy-handbook';

router.post('/kb-search', rcmServiceAuth, async (req, res) => {
  const { query, limit } = req.body || {};
  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query (string) is required' });
  }
  if (query.length > 500) {
    return res.status(400).json({ error: 'query must be 500 characters or fewer' });
  }
  const kb = db.prepare('SELECT * FROM knowledge_bases WHERE public_slug = ?').get(HANDBOOK_SLUG);
  if (!kb) {
    return res.status(404).json({ error: 'Payer Policy Handbook knowledge base not found' });
  }
  const topK = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 10) : undefined;
  try {
    const chunks = await retrieve(kb, query.trim(), topK);
    res.json({
      kb: kb.name,
      chunks: chunks.map((c) => ({
        text: c.text,
        source: c.filename,
        score: typeof c.score === 'number' ? Number(c.score.toFixed(3)) : c.score,
      })),
    });
  } catch (e) {
    console.error('[kb-search] retrieval failed:', e.message);
    res.status(502).json({ error: `Handbook search failed: ${e.message}` });
  }
});

module.exports = router;
