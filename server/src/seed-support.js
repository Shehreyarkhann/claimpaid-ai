// Ensures the "ClaimPaid Support Guide" KB exists for an org.
// Product, billing, security, and troubleshooting knowledge so the AI chat can
// answer support questions. Called when a new RCM-linked org is provisioned and
// backfilled for existing orgs at boot. Idempotent per org. Runs in the
// background — embeddings take ~30-60s and must not block auth.
const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const { chunkText } = require('./ingest');
const { embed } = require('./embeddings');

const SEED_FILES = [
  'support-01-plans-trial.md',
  'support-02-billing.md',
  'support-03-features.md',
  'support-04-security.md',
  'support-05-help.md',
];

const SYSTEM_PROMPT = `You are the ClaimPaid support assistant. Answer questions about ClaimPaid plans, pricing, billing, features, security, and troubleshooting using the knowledge base. Always cite the specific document. If the answer is not in the knowledge base, say so plainly and direct the user to support@claimpaid.io (we reply within one business day). Never invent pricing, limits, features, integrations, or compliance claims. Never claim HIPAA certification.`;

async function ensureSupportKb(orgId) {
  try {
    // Idempotent per org by name. public_slug stays NULL: slugs are globally
    // unique and reserved for public share links, while this KB is seeded
    // privately per org (a global slug would UNIQUE-violate on the 2nd org).
    const existing = db.prepare(
      'SELECT id FROM knowledge_bases WHERE org_id = ? AND name = ?'
    ).get(orgId, 'ClaimPaid Support Guide');
    if (existing) return existing.id;

    const kbId = Number(db.prepare(`
      INSERT INTO knowledge_bases (org_id, name, description, system_prompt, welcome_message, public_enabled, public_slug)
      VALUES (?, ?, ?, ?, ?, 0, NULL)
    `).run(
      orgId,
      'ClaimPaid Support Guide',
      'Plans, billing, features, security, and troubleshooting for ClaimPaid.',
      SYSTEM_PROMPT,
      'Hi! Ask me anything about ClaimPaid — plans, billing, features, or troubleshooting.'
    ).lastInsertRowid);

    const insertChunk = db.prepare(
      'INSERT INTO chunks (doc_id, kb_id, org_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const file of SEED_FILES) {
      const text = fs.readFileSync(path.join(__dirname, 'seed-docs', file), 'utf-8');
      const docId = Number(db.prepare(
        "INSERT INTO documents (kb_id, org_id, filename, source_type, mime, status) VALUES (?, ?, ?, 'upload', 'text/markdown', 'processing')"
      ).run(kbId, orgId, file).lastInsertRowid);
      const pieces = chunkText(text, 1000, 200);
      let idx = 0;
      for (let i = 0; i < pieces.length; i += 8) {
        const batch = pieces.slice(i, i + 8);
        const vecs = await embed(batch);
        db.exec('BEGIN');
        try {
          batch.forEach((t, j) => insertChunk.run(docId, kbId, orgId, idx++, t, JSON.stringify(vecs[j])));
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
      db.prepare("UPDATE documents SET status = 'ready' WHERE id = ?").run(docId);
    }
    console.log(`Seeded ClaimPaid Support Guide for org ${orgId} (kb ${kbId})`);
    return kbId;
  } catch (e) {
    console.error('ensureSupportKb failed:', e.message);
    return null;
  }
}

module.exports = { ensureSupportKb };
