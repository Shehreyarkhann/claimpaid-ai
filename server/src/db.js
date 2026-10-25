const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(process.env.ASKBASE_DB_PATH || path.join(__dirname, '..', 'askbase.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function columnExists(table, col) {
  return db.prepare(`SELECT name FROM pragma_table_info(?) WHERE name = ?`).get(table, col);
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orgs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(email)
    );
    CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      chunk_size INTEGER NOT NULL DEFAULT 1000,
      chunk_overlap INTEGER NOT NULL DEFAULT 200,
      top_k INTEGER NOT NULL DEFAULT 5,
      system_prompt TEXT DEFAULT '',
      welcome_message TEXT DEFAULT '',
      public_enabled INTEGER NOT NULL DEFAULT 0,
      public_slug TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kb_org ON knowledge_bases(org_id);

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kb_id INTEGER NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      filename TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'upload',
      source_url TEXT,
      mime TEXT,
      char_count INTEGER DEFAULT 0,
      chunk_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'processing',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_docs_kb ON documents(kb_id);

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      kb_id INTEGER NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_kb ON chunks(kb_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kb_id INTEGER NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      user_id INTEGER REFERENCES users(id),
      title TEXT DEFAULT 'New conversation',
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_convo_kb ON conversations(kb_id);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      convo_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations TEXT DEFAULT '[]',
      feedback TEXT,
      latency_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_msg_convo ON messages(convo_id);

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      prefix TEXT NOT NULL,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_apikey_org ON api_keys(org_id);

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kb_id INTEGER NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      type TEXT NOT NULL DEFAULT 'sitemap',
      url TEXT NOT NULL,
      crawl_limit INTEGER NOT NULL DEFAULT 50,
      last_run_at TEXT,
      last_status TEXT,
      last_found INTEGER DEFAULT 0,
      last_new INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sources_kb ON sources(kb_id);
  `);
  // lightweight migrations for existing DBs
  try { db.exec(`ALTER TABLE knowledge_bases ADD COLUMN web_fallback INTEGER NOT NULL DEFAULT 0`); } catch {}
  // Widget (public) conversations are grouped per anonymous visitor so the
  // embed can offer history/switching without accounts — the visitor id is a
  // random token the widget keeps in localStorage, never personal data.
  try { db.exec(`ALTER TABLE conversations ADD COLUMN visitor_id TEXT`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_convo_visitor ON conversations(kb_id, visitor_id, created_at)`); } catch {}
  try { db.exec(`ALTER TABLE documents ADD COLUMN content_hash TEXT`); } catch {}
  try { db.exec(`ALTER TABLE orgs ADD COLUMN rcm_org_id INTEGER`); } catch {}
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_rcm_org ON orgs(rcm_org_id)`); } catch {}
  // Per-RCM-org, per-month AI query counter (plan quota enforcement)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_query_usage (
      rcm_org_id INTEGER NOT NULL,
      month TEXT NOT NULL, -- 'YYYY-MM', UTC calendar month
      queries INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (rcm_org_id, month)
    );
  `);

  // ---- Market-launch cleanup v2 (deploy #53) ----
  // Removes the pre-launch AI demo data. #52's version died on a wrong
  // column name (messages.convo_id) wherever the demo KB had conversations
  // and never completed in production. v2: FK suspended for the wipe
  // (orgDelete pattern); junk = the 'Demo Company' org plus every AI org
  // linked to a pre-launch RCM org (rcm_org_id 1-4: Demo Billing Co., abc,
  // asd, AB Recoveries — deleted by the RCM cleanup in #52). The public
  // Payer Policy Handbook KB is MOVED to the founder's AI org first,
  // wherever it currently sits — the landing widget and every RCM
  // floating chat point at its slug.
  db.exec(`CREATE TABLE IF NOT EXISTS data_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  if (!db.prepare('SELECT name FROM data_migrations WHERE name = ?').get('demo-cleanup-53')) {
   try {
    db.exec('PRAGMA foreign_keys = OFF');
    const home = db.prepare("SELECT o.id FROM orgs o JOIN users u ON u.org_id = o.id WHERE u.email = 'shehreyarkhann@outlook.com'").get()
      || db.prepare('SELECT id FROM orgs WHERE rcm_org_id = 12').get();
    const junk = db.prepare(
      "SELECT id FROM orgs WHERE (name = 'Demo Company' AND rcm_org_id IS NULL) OR rcm_org_id IN (1, 2, 3, 4)"
    ).all().map((r) => r.id).filter((id) => !home || id !== home.id);
    const handbook = junk.length
      ? db.prepare(`SELECT id, org_id FROM knowledge_bases WHERE public_slug = 'payer-policy-handbook' AND org_id IN (${junk.join(',')})`).get()
      : null;
    let keepOrg = null;
    if (handbook && home) {
      db.prepare('UPDATE knowledge_bases SET org_id = ? WHERE id = ?').run(home.id, handbook.id);
      db.prepare('UPDATE documents SET org_id = ? WHERE kb_id = ?').run(home.id, handbook.id);
      db.prepare('UPDATE chunks SET org_id = ? WHERE kb_id = ?').run(home.id, handbook.id);
      console.log(`[migration] demo-cleanup-53: public handbook KB ${handbook.id} moved to org ${home.id}`);
    } else if (handbook) {
      // No founder org found (unexpected in production): keep the host org
      // as a user-less public-KB host rather than breaking the live widget.
      keepOrg = handbook.org_id;
      db.prepare("UPDATE orgs SET name = 'ClaimPaid Public' WHERE id = ?").run(keepOrg);
      console.log('[migration] demo-cleanup-53: handbook home org not found — host org renamed, users removed');
    }
    const orgTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
      .filter((t) => { try { return db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'org_id'); } catch { return false; } });
    for (const oid of junk) {
      const kbIds = db.prepare('SELECT id FROM knowledge_bases WHERE org_id = ?').all(oid).map((r) => r.id)
        .filter((id) => !handbook || id !== handbook.id);
      for (const kbId of kbIds) {
        const convoIds = db.prepare('SELECT id FROM conversations WHERE kb_id = ?').all(kbId).map((r) => r.id);
        for (const cid of convoIds) db.prepare('DELETE FROM messages WHERE convo_id = ?').run(cid);
        db.prepare('DELETE FROM conversations WHERE kb_id = ?').run(kbId);
        db.prepare('DELETE FROM chunks WHERE kb_id = ?').run(kbId);
        db.prepare('DELETE FROM documents WHERE kb_id = ?').run(kbId);
        db.prepare('DELETE FROM sources WHERE kb_id = ?').run(kbId);
        db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(kbId);
      }
      if (oid === keepOrg) {
        // The generic sweep would gut the kept handbook KB (its documents,
        // chunks and conversations still carry this org_id) — purge only
        // the org's keys and users; the KB loop above handled the rest.
        db.prepare('DELETE FROM api_keys WHERE org_id = ?').run(oid);
        db.prepare('DELETE FROM users WHERE org_id = ?').run(oid);
        continue;
      }
      for (const t of orgTables) db.prepare(`DELETE FROM ${t} WHERE org_id = ?`).run(oid);
      db.prepare('DELETE FROM users WHERE org_id = ?').run(oid);
      db.prepare('DELETE FROM orgs WHERE id = ?').run(oid);
    }
    db.prepare("DELETE FROM users WHERE email = 'demo@askbase.com'").run();
    db.prepare("INSERT INTO data_migrations (name) VALUES ('demo-cleanup-53')").run();
    console.log(`[migration] demo-cleanup-53: removed AI junk orgs [${junk.filter((id) => id !== keepOrg).join(', ')}]`);
   } catch (e) {
    console.error('[migration] demo-cleanup-53 FAILED (will retry next boot):', e.message);
   } finally {
    try { db.exec('PRAGMA foreign_keys = ON'); } catch {}
   }
  }
}

module.exports = { db, initSchema, columnExists };
