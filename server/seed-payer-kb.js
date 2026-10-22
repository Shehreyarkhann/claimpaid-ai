// Seeds the "Payer Policy Handbook" KB into the existing demo org.
// Idempotent: skips if the KB already exists.
const fs = require('fs');
const path = require('path');
const { db } = require('./src/db');
const { chunkText } = require('./src/ingest');
const { embed } = require('./src/embeddings');

async function main() {
  const org = db.prepare("SELECT id FROM orgs WHERE name = 'Demo Company'").get();
  if (!org) { console.error('Demo org not found'); process.exit(1); }

  let kb = db.prepare("SELECT id FROM knowledge_bases WHERE public_slug = 'payer-policy-handbook'").get();
  if (kb) { console.log('Payer Policy Handbook already seeded (id ' + kb.id + ')'); process.exit(0); }

  const kbId = db.prepare(`
    INSERT INTO knowledge_bases (org_id, name, description, system_prompt, welcome_message, public_enabled, public_slug)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(
    org.id,
    'Payer Policy Handbook',
    'Timely filing limits, appeal windows, and denial reason codes for major US payers.',
    'You are a billing assistant for a medical billing company. Answer questions about payer policies, timely filing limits, appeal windows, and denial reason codes. Always cite the specific document and section. If you do not know, say so.',
    'Hi! Ask me anything about payer timely-filing limits, appeal windows, or denial codes.',
    'payer-policy-handbook'
  ).lastInsertRowid;
  console.log('Created KB id', kbId);

  const insertChunk = db.prepare(
    'INSERT INTO chunks (doc_id, kb_id, org_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const files = ['payer-01-timely-filing.md', 'payer-02-appeals.md', 'payer-03-denial-codes.md'];
  for (const file of files) {
    const text = fs.readFileSync(path.join(__dirname, 'src/seed-docs', file), 'utf-8');
    const docId = db.prepare(
      "INSERT INTO documents (kb_id, org_id, filename, source_type, mime, status) VALUES (?, ?, ?, 'upload', 'text/markdown', 'processing')"
    ).run(kbId, org.id, file).lastInsertRowid;
    const pieces = chunkText(text, 1000, 200);
    let idx = 0;
    for (let i = 0; i < pieces.length; i += 8) {
      const batch = pieces.slice(i, i + 8);
      const vecs = await embed(batch);
      db.exec('BEGIN');
      try {
        batch.forEach((t, j) => insertChunk.run(docId, kbId, org.id, idx++, t, JSON.stringify(vecs[j])));
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    db.prepare("UPDATE documents SET status = 'ready' WHERE id = ?").run(docId);
    console.log(`Ingested ${file}: ${pieces.length} chunks`);
  }
  console.log('DONE — Payer Policy Handbook ready at slug payer-policy-handbook');
}

main().catch((e) => { console.error(e); process.exit(1); });
