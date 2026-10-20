// Demo seed: org + owner + KB + sample docs (ingested on first boot).
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { signToken } = require('./auth');
const { chunkText } = require('./ingest');
const { embed } = require('./embeddings');

module.exports = function seed() {
  const existing = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (existing > 0) return;

  const orgId = db.prepare('INSERT INTO orgs (name) VALUES (?)').run('Demo Company').lastInsertRowid;
  const hash = bcrypt.hashSync('demo1234', 10);
  db.prepare(`INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'owner')`)
    .run(orgId, 'Demo Owner', 'demo@askbase.com', hash);

  const kbId = db.prepare(`
    INSERT INTO knowledge_bases (org_id, name, description, welcome_message, public_enabled, public_slug)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(
    orgId,
    'Northwind Support Handbook',
    'Customer support knowledge base: plans, billing, troubleshooting.',
    'Hi! Ask me anything about Northwind plans, billing, or troubleshooting.',
    'demo-northwind'
  ).lastInsertRowid;

  const dir = path.join(__dirname, 'seed-docs');
  const insertChunk = db.prepare(`
    INSERT INTO chunks (doc_id, kb_id, org_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf-8');
    const docId = db.prepare(`
      INSERT INTO documents (kb_id, org_id, filename, source_type, mime, status) VALUES (?, ?, ?, 'upload', 'text/markdown', 'processing')
    `).run(kbId, orgId, file).lastInsertRowid;
    const pieces = chunkText(text, 1000, 200);
    (async () => {
      try {
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
        db.prepare(`UPDATE documents SET status='ready', char_count=?, chunk_count=? WHERE id=?`)
          .run(text.length, pieces.length, docId);
        console.log(`seeded doc ${file}: ${pieces.length} chunks`);
      } catch (e) {
        db.prepare(`UPDATE documents SET status='failed', error=? WHERE id=?`).run(String(e.message).slice(0, 300), docId);
      }
    })();
  }
  console.log('AskBase demo seeded: demo@askbase.com / demo1234');
};
