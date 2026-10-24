// Ensures the "Payer Policy Handbook" KB exists for an org.
// Called when a new RCM-linked org is provisioned so every AI user gets the
// showcase knowledge base. Idempotent per org. Runs in the background —
// embeddings take ~30-60s and must not block auth.
const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const { chunkText } = require('./ingest');
const { embed } = require('./embeddings');

const SEED_FILES = ['payer-01-timely-filing.md', 'payer-02-appeals.md', 'payer-03-denial-codes.md'];

async function ensureHandbookKb(orgId) {
  try {
    // Idempotent per org by name. The public slug is globally unique and stays
    // with whichever org claimed it first (the public demo link); later orgs
    // get a private copy (NULL slug). Previously the global slug caused a
    // UNIQUE violation so org #2+ never received the handbook at all.
    const existing = db.prepare(
      'SELECT id FROM knowledge_bases WHERE org_id = ? AND name = ?'
    ).get(orgId, 'Payer Policy Handbook');
    if (existing) return existing.id;

    const slugTaken = db.prepare(
      'SELECT id FROM knowledge_bases WHERE public_slug = ?'
    ).get('payer-policy-handbook');
    const slug = slugTaken ? null : 'payer-policy-handbook';

    const kbId = Number(db.prepare(`
      INSERT INTO knowledge_bases (org_id, name, description, system_prompt, welcome_message, public_enabled, public_slug)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      orgId,
      'Payer Policy Handbook',
      'Timely filing limits, appeal windows, and denial reason codes for major US payers.',
      'You are a billing assistant for a medical billing company. Answer questions about payer policies, timely filing limits, appeal windows, and denial reason codes. Always cite the specific document and section. If you do not know, say so.',
      'Hi! Ask me anything about payer timely-filing limits, appeal windows, or denial codes.',
      slug ? 1 : 0,
      slug
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
    console.log(`Seeded Payer Policy Handbook for org ${orgId} (kb ${kbId})`);
    return kbId;
  } catch (e) {
    console.error('ensureHandbookKb failed:', e.message);
    return null;
  }
}

module.exports = { ensureHandbookKb };
