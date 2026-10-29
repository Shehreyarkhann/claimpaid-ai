// Product access for the AI service, resolved from the RCM subscription.
// The AI service reads the RCM org's plan from the RCM SQLite database (read-only)
// so a single subscription governs both apps. Fully local — no external calls.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const RCM_DB_PATH = process.env.RCM_DB_PATH || path.join('/opt/claimpaid-rcm/server', 'rcm.db');

let _rcmDb = null;
function rcmDb() {
  if (_rcmDb) return _rcmDb;
  try {
    _rcmDb = new DatabaseSync(RCM_DB_PATH, { readOnly: true });
    return _rcmDb;
  } catch {
    return null;
  }
}

// Which products a plan unlocks. Mirrors rcm-dashboard/server/src/routes/billing.js.
// trial / null / unknown => full access (trial evaluates everything, legacy orgs grandfathered).
function productsForPlan(plan) {
  switch (plan) {
    case 'starter': return { rcm: true, ai: false };
    case 'pro': return { rcm: true, ai: true };
    case 'ai': return { rcm: false, ai: true };
    case 'enterprise': return { rcm: true, ai: true };
    default: return { rcm: true, ai: true };
  }
}

// Products honoring status, mirroring the RCM server's productsForOrg
// (deploy #61): an expired trial unlocks nothing; a subscription canceled
// DURING the trial keeps its products until the trial end date.
function productsForOrg(org) {
  const raw = org.plan_status || 'trialing';
  if (raw === 'trialing' && org.trial_ends_at && new Date(org.trial_ends_at).getTime() <= Date.now()) {
    return { rcm: false, ai: false };
  }
  if (raw === 'canceled') {
    if (org.trial_ends_at && new Date(org.trial_ends_at).getTime() > Date.now()) {
      return productsForPlan(org.plan);
    }
    return { rcm: false, ai: false };
  }
  return productsForPlan(org.plan);
}

// Look up the RCM org's plan. Returns { plan, plan_status, products }.
// Unknown org or unreadable DB => grandfathered full access (never lock out by accident).
function getRcmPlan(rcmOrgId) {
  const db = rcmDb();
  if (!db || !rcmOrgId) return { plan: null, plan_status: null, products: { rcm: true, ai: true } };
  try {
    const org = db.prepare('SELECT plan, plan_status, trial_ends_at FROM orgs WHERE id = ?').get(rcmOrgId);
    if (!org) return { plan: null, plan_status: null, products: { rcm: true, ai: true } };
    return { plan: org.plan || null, plan_status: org.plan_status || null, products: productsForOrg(org) };
  } catch {
    return { plan: null, plan_status: null, products: { rcm: true, ai: true } };
  }
}

// Deploy #100 (account pools): the RCM org ids that share one account —
// every org whose 'owner' is the same account holder as rcmOrgId's owner
// (the earliest owner member). Mirrors rcm-dashboard/server/src/account.js.
// Falls back to just [rcmOrgId] whenever the RCM DB can't answer.
function accountRcmOrgIds(rcmOrgId) {
  const db = rcmDb();
  if (!db || !rcmOrgId) return rcmOrgId ? [rcmOrgId] : [];
  try {
    const owner = db.prepare(
      "SELECT user_id FROM user_orgs WHERE org_id = ? AND role = 'owner' ORDER BY created_at ASC, user_id ASC LIMIT 1",
    ).get(rcmOrgId);
    if (!owner) return [rcmOrgId];
    const ids = db.prepare(
      "SELECT org_id FROM user_orgs WHERE user_id = ? AND role = 'owner' ORDER BY org_id ASC",
    ).all(owner.user_id).map((r) => r.org_id);
    return ids.length ? ids : [rcmOrgId];
  } catch {
    return [rcmOrgId];
  }
}

// Agent turns metered in the RCM DB (agent_usage) for one org + month —
// part of the merged AI-use pool the RCM side reports (deploy #89/#100).
function agentTurnsThisMonth(rcmOrgId, monthKey) {
  const db = rcmDb();
  if (!db || !rcmOrgId) return 0;
  try {
    const row = db.prepare('SELECT turns FROM agent_usage WHERE org_id = ? AND month = ?').get(rcmOrgId, monthKey);
    return row ? row.turns : 0;
  } catch {
    return 0; // agent_usage may not exist yet on older RCM DBs
  }
}

// Block plans that don't include the AI product (e.g. RCM-Starter-only subscribers).
// Must run after authRequired (which attaches req.products).
function requireAiAccess(req, res, next) {
  if (req.products && req.products.ai === false) {
    return res.status(403).json({
      error: "Your RCM Starter plan doesn't include ClaimPaid AI. Upgrade to RCM Pro + AI to unlock it.",
      upgrade: true,
    });
  }
  next();
}

module.exports = { productsForPlan, getRcmPlan, requireAiAccess, accountRcmOrgIds, agentTurnsThisMonth, rcmDb };
