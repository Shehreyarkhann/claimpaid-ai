// AI-assisted medical coding endpoint (service-to-service).
//
// Called by the RCM server — never directly by browsers. The RCM server signs
// a short-lived JWT with its own JWT_SECRET (which the AI service holds as
// RCM_JWT_SECRET for SSO), so no new shared secret is needed.
//
// POST /api/v1/code-assist  { note_text, code_library: [{code, type, description}] }
//   -> { suggestions: [{code, type, confidence, evidence, rationale}], model }
//
// Human-in-the-loop guarantee: the model only SUGGESTS codes. The RCM server
// constrains suggestions to its curated library and requires a human to accept
// each code before anything touches a claim. This endpoint never writes data.
const express = require('express');
const jwt = require('jsonwebtoken');
const { RCM_SECRET } = require('../auth');
const { getRcmPlan } = require('../plans');
const { llmEnabled, LLM_BASE, LLM_MODEL } = require('../rag');

const router = express.Router();

// Verify the call came from the RCM server: short-lived JWT signed with the
// RCM service's JWT_SECRET, payload { service: 'claimpaid-rcm', org }.
function rcmServiceAuth(req, res, next) {
  const token = req.headers['x-service-token'];
  if (!token) return res.status(401).json({ error: 'Service token required' });
  if (!RCM_SECRET) return res.status(503).json({ error: 'RCM service auth not configured' });
  try {
    const payload = jwt.verify(token, RCM_SECRET);
    if (payload.service !== 'claimpaid-rcm' || !payload.org) {
      return res.status(401).json({ error: 'Invalid service token' });
    }
    req.rcmOrgId = payload.org;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired service token' });
  }
  // Plan gate: code-assist is an AI product feature
  try {
    const { products } = getRcmPlan(req.rcmOrgId);
    if (products.ai === false) {
      return res.status(403).json({ error: "This organization's plan doesn't include ClaimPaid AI.", upgrade: true });
    }
  } catch { /* grandfather on lookup failure */ }
  next();
}

const SYSTEM_PROMPT =
  'You are a medical coding assistant for ClaimPaid. Read the clinical note and suggest CPT and ICD-10 codes ONLY from the provided code library.\n' +
  'STRICT RULES:\n' +
  '1. Suggest ONLY codes that appear verbatim in the CODE LIBRARY. Never invent, guess, alter, or combine codes.\n' +
  '2. Each suggestion: "code" (exact library code), "type" ("CPT" or "ICD10"), "confidence" (0.0-1.0), "evidence" (a SHORT quote copied CHARACTER-FOR-CHARACTER from the note — same words, same spelling), "rationale" (one sentence). The server verifies every evidence quote against the note; a quote that is not found verbatim is flagged and the suggestion is downgraded. If you cannot quote the exact words from the note, DO NOT suggest the code.\n' +
  '3. ICD-10 codes: only for diagnoses, problems, or symptoms DOCUMENTED in the note. Never code suspected, possible, or ruled-out conditions.\n' +
  '4. CPT codes: only for procedures, services, and visit complexity DOCUMENTED in the note.\n' +
  '5. If the note is ambiguous, use LOW confidence (0.5 or less) and say so in the rationale. Never overstate.\n' +
  '6. Output STRICT JSON ONLY — no markdown fences, no commentary, no extra keys:\n' +
  '{"suggestions":[{"code":"99213","type":"CPT","confidence":0.9,"evidence":"...","rationale":"..."}]}\n' +
  '7. ABSTAIN when unsupported: if no library code is backed by an exact quote from the note, return {"suggestions":[]}. Suggesting nothing is a correct, preferred outcome over a weakly supported code. Fewer, well-grounded suggestions always beat more, speculative ones.';

function sanitizeSuggestion(s) {
  if (!s || typeof s !== 'object') return null;
  const code = String(s.code || '').trim().toUpperCase();
  const type = String(s.type || '').trim().toUpperCase();
  const confidence = Number(s.confidence);
  if (!code || (type !== 'CPT' && type !== 'ICD10')) return null;
  return {
    code,
    type,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    evidence: String(s.evidence || '').slice(0, 500),
    rationale: String(s.rationale || '').slice(0, 500),
  };
}

function extractJson(text) {
  // Strip markdown fences if the model added them despite instructions
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object in model output');
  return JSON.parse(t.slice(start, end + 1));
}

router.post('/code-assist', rcmServiceAuth, async (req, res) => {
  const { note_text, code_library } = req.body || {};
  if (typeof note_text !== 'string' || !note_text.trim()) {
    return res.status(400).json({ error: 'note_text is required' });
  }
  if (note_text.length > 30000) {
    return res.status(400).json({ error: 'note_text exceeds 30000 characters' });
  }
  if (!Array.isArray(code_library) || code_library.length === 0) {
    return res.status(400).json({ error: 'code_library (non-empty array) is required' });
  }
  if (!llmEnabled()) {
    return res.status(503).json({ error: 'LLM is not configured on the AI service' });
  }

  const libraryText = code_library
    .map((c) => `${c.code} [${c.type}] — ${c.description}`)
    .join('\n');

  try {
    const upstream = await fetch(`${LLM_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 180s cap matches the chat pipeline: qwen2.5:3b on 2 vCPU can take 60-90s
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({
        model: LLM_MODEL,
        stream: false,
        temperature: 0.2, // low temp: coding suggestions should be conservative, not creative
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `CODE LIBRARY:\n${libraryText}\n\nCLINICAL NOTE:\n${note_text.trim()}\n\nReturn strict JSON only.`,
          },
        ],
      }),
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: `LLM request failed: ${upstream.status}` });
    }
    const data = await upstream.json();
    const content = data.choices?.[0]?.message?.content || '';
    let parsed;
    try {
      parsed = extractJson(content);
    } catch {
      return res.status(502).json({ error: 'LLM returned unparseable output' });
    }
    if (!parsed || !Array.isArray(parsed.suggestions)) {
      return res.status(502).json({ error: 'LLM output missing suggestions array' });
    }
    const suggestions = parsed.suggestions.map(sanitizeSuggestion).filter(Boolean).slice(0, 25);
    res.json({ suggestions, model: LLM_MODEL });
  } catch (e) {
    const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
    return res.status(502).json({ error: timeout ? 'LLM request timed out' : `Code-assist failed: ${e.message}` });
  }
});

module.exports = router;
// Shared with routes/kbsearch.js — one service-to-service auth pattern for
// every /api/v1 endpoint the RCM server calls.
module.exports.rcmServiceAuth = rcmServiceAuth;
