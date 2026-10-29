// Deploy #100 test (AskBase side): the AI-use quota is an ACCOUNT pool.
// checkAiQuota must sum AskBase queries across every RCM workspace the
// account owns PLUS the agent turns metered in the RCM DB — so usage in
// workspace A blocks chat in workspace B, while a different account is
// unaffected. Runs in-process against throwaway DBs.
// Run: node account-pool-test.cjs   (from the askbase repo root)
const fs = require('fs'); const os = require('os'); const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'askpool100-'));
const AI_DB = path.join(TMP, 'ai.db');
const RCM_DB = path.join(TMP, 'rcm.db');
process.env.ASKBASE_DB_PATH = AI_DB;
process.env.RCM_DB_PATH = RCM_DB;

let passed = 0, failed = 0;
const check = (n, c, x) => { if (c) { passed++; console.log('  ok -', n); } else { failed++; console.log('  FAIL -', n, x !== undefined ? JSON.stringify(x).slice(0, 200) : ''); } };
const MONTH = new Date().toISOString().slice(0, 7);

(function main() {
  const { DatabaseSync } = require('node:sqlite');
  // --- Fixture RCM DB (legacy-shaped: the tables account resolution reads) ---
  const rcm = new DatabaseSync(RCM_DB);
  rcm.exec(`
    CREATE TABLE orgs (id INTEGER PRIMARY KEY, name TEXT, plan TEXT, plan_status TEXT, trial_ends_at TEXT);
    CREATE TABLE user_orgs (user_id INTEGER NOT NULL, org_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'biller',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, org_id));
    CREATE TABLE agent_usage (org_id INTEGER NOT NULL, month TEXT NOT NULL, turns INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (org_id, month));
    INSERT INTO orgs (id, name, plan, plan_status) VALUES (10, 'Ws A', 'pro', 'active'), (11, 'Ws B', 'pro', 'active'), (12, 'Other Account', 'pro', 'active');
    INSERT INTO user_orgs (user_id, org_id, role) VALUES (1, 10, 'owner'), (1, 11, 'owner'), (2, 12, 'owner'), (3, 10, 'biller');
    INSERT INTO agent_usage (org_id, month, turns) VALUES (10, '${MONTH}', 40);
  `);
  rcm.close();

  // --- AskBase usage module against the fixture DBs ---
  const { db, initSchema } = require(path.join(__dirname, 'server', 'src', 'db.js'));
  initSchema(); // the server entrypoint normally runs this
  const usage = require(path.join(__dirname, 'server', 'src', 'usage.js'));
  const ins = db.prepare('INSERT INTO ai_query_usage (rcm_org_id, month, queries) VALUES (?, ?, ?)');
  ins.run(10, MONTH, 30); // workspace A: 30 AskBase queries
  ins.run(11, MONTH, 25); // workspace B: 25 AskBase queries
  ins.run(12, MONTH, 7);  // other account: 7

  check('pooled usage for ws A = 30 + 25 (sibling) + 40 (agent turns in A) = 95',
    usage.aiUsagePooled(10) === 95, usage.aiUsagePooled(10));
  check('pooled usage via ws B is the SAME pool (95)',
    usage.aiUsagePooled(11) === 95, usage.aiUsagePooled(11));
  check('different account unaffected (7)', usage.aiUsagePooled(12) === 7, usage.aiUsagePooled(12));

  const blocked = usage.checkAiQuota(11, 90, 'pro');
  check('chat in ws B blocked by the account pool (95 >= 90)',
    blocked.allowed === false && blocked.used === 95 && blocked.body?.error === 'ai_query_limit_reached', blocked);
  const otherOk = usage.checkAiQuota(12, 90, 'pro');
  check('other account still allowed at the same limit', otherOk.allowed === true && otherOk.used === 7, otherOk);
  const underOk = usage.checkAiQuota(10, 100, 'pro');
  check('pool under a higher limit is allowed', underOk.allowed === true && underOk.used === 95, underOk);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
