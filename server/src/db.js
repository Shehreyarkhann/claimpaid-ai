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
}

module.exports = { db, initSchema, columnExists };
