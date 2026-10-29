// AI query quota enforcement for the AI service (askbase).
// Counts KB-chat queries per rcm_org_id per UTC calendar month in the
// ai_query_usage table. Limits resolve from the RCM JWT claims first
// (embedded by the RCM app at login), falling back to the RCM planLimits file.
// Limits refresh when the user re-logs-in (RCM tokens live 7 days).
const { db } = require('./db');
const { planLimits } = require('./planLimits');
const { accountRcmOrgIds, agentTurnsThisMonth } = require('./plans');

const UPGRADE_PATH = '/app/billing';

function monthKeyUtc(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Resolve the effective AI-query limit for a request.
// null = unlimited (enterprise or grandfathered legacy), 0 = AI not included.
function resolveAiLimit(req) {
  if (req.limits && typeof req.limits.aiQueriesPerMonth !== 'undefined') {
    return req.limits.aiQueriesPerMonth;
  }
  return planLimits().limitsForPlan(req.plan).aiQueriesPerMonth;
}

function aiUsage(rcmOrgId, now = new Date()) {
  if (!rcmOrgId) return 0;
  const row = db.prepare('SELECT queries FROM ai_query_usage WHERE rcm_org_id = ? AND month = ?')
    .get(rcmOrgId, monthKeyUtc(now));
  return row ? row.queries : 0;
}

// ACCOUNT-POOLED AI usage (deploy #100): the plan's AI-use limit applies to
// the sum across every RCM workspace the account owns — AskBase queries
// (this DB, keyed per rcm_org_id) PLUS agent turns metered in the RCM DB —
// mirroring the RCM side's merged total, so neither app can spend past the
// pool through the other.
function aiUsagePooled(rcmOrgId, now = new Date()) {
  if (!rcmOrgId) return 0;
  const mk = monthKeyUtc(now);
  return accountRcmOrgIds(rcmOrgId).reduce(
    (sum, id) => sum + aiUsage(id, now) + agentTurnsThisMonth(id, mk), 0,
  );
}

function recordAiQuery(rcmOrgId) {
  if (!rcmOrgId) return;
  db.prepare(`
    INSERT INTO ai_query_usage (rcm_org_id, month, queries) VALUES (?, ?, 1)
    ON CONFLICT (rcm_org_id, month) DO UPDATE SET queries = queries + 1
  `).run(rcmOrgId, monthKeyUtc());
}

// Synchronous quota check. Returns { allowed, used, limit, body }.
// `used` is the ACCOUNT pool total (deploy #100): every workspace of the
// account draws on the same AI-use allowance. Grandfathered AI-issued
// tokens (no rcmOrgId) and unlimited plans are always allowed.
function checkAiQuota(rcmOrgId, limit, plan) {
  if (!rcmOrgId || limit === null || limit === undefined) return { allowed: true, used: aiUsagePooled(rcmOrgId), limit };
  const used = aiUsagePooled(rcmOrgId);
  if (used >= limit) {
    const planLabel = { starter: 'RCM Starter', pro: 'RCM Pro + AI', ai: 'ClaimPaid AI', enterprise: 'Enterprise' }[plan] || 'your';
    return {
      allowed: false, used, limit,
      body: {
        error: 'ai_query_limit_reached',
        plan: plan || 'trial',
        planLabel,
        limit,
        used,
        upgrade: UPGRADE_PATH,
        message: `You've hit your ${planLabel} plan limit (${used} of ${limit} AI queries used this month). Upgrade to keep asking without interruption.`,
      },
    };
  }
  return { allowed: true, used, limit };
}

// Express middleware form — runs after authRequired (needs req.rcmOrgId /
// req.limits / req.plan). Counts the query when the quota passes.
function aiQuotaMiddleware(req, res, next) {
  try {
    const limit = resolveAiLimit(req);
    const q = checkAiQuota(req.rcmOrgId, limit, req.plan);
    if (!q.allowed) return res.status(402).json(q.body);
    if (limit !== null && limit !== undefined && req.rcmOrgId) recordAiQuery(req.rcmOrgId);
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { monthKeyUtc, resolveAiLimit, aiUsage, aiUsagePooled, recordAiQuery, checkAiQuota, aiQuotaMiddleware };
