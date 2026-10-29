// Plan limits for the AI service.
// SINGLE SOURCE OF TRUTH: rcm-dashboard/server/src/config/planLimits.js.
// This loader requires that file by path (local dev layout, then the
// production layout) and falls back to an embedded copy only if neither
// resolves — adjust the numbers in the RCM file, not here.
const path = require('path');

const CANDIDATES = [
  // Local dev: ~/workspace/portfolio/{askbase,rcm-dashboard} side by side
  path.join(__dirname, '..', '..', '..', 'rcm-dashboard', 'server', 'src', 'config', 'planLimits.js'),
  '/opt/claimpaid-rcm/server/src/config/planLimits.js',
];

// Embedded fallback — must mirror the RCM file. Last resort only.
const FALLBACK = {
  limitsForPlan(plan) {
    const table = {
      starter: { price: 199, claimsPerMonth: 1000, seats: 5, aiQueriesPerMonth: 100, workspaces: 1 },
      pro: { price: 499, claimsPerMonth: 10000, seats: 15, aiQueriesPerMonth: 2000, workspaces: 3 },
      ai: { price: 99, claimsPerMonth: 0, seats: 5, aiQueriesPerMonth: 1000, workspaces: 1 },
      enterprise: { price: null, claimsPerMonth: null, seats: null, aiQueriesPerMonth: null, workspaces: null },
    };
    const row = table[plan];
    if (row) return { ...row };
    return { price: null, claimsPerMonth: null, seats: null, aiQueriesPerMonth: null, workspaces: null };
  },
};

let _limits = null;
function planLimits() {
  if (_limits) return _limits;
  for (const p of CANDIDATES) {
    try {
      _limits = require(p);
      if (_limits && typeof _limits.limitsForPlan === 'function') return _limits;
    } catch { /* try next */ }
  }
  console.error('[planLimits] RCM planLimits.js not found — using embedded fallback (may be stale).');
  _limits = FALLBACK;
  return _limits;
}

module.exports = { planLimits };
