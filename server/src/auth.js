const jwt = require('jsonwebtoken');
const { db } = require('./db');
const { getRcmPlan } = require('./plans');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
// RCM-issued tokens (same domain, shared localStorage) are accepted so one
// subscription governs both apps. Set RCM_JWT_SECRET to the RCM service's JWT_SECRET.
const RCM_SECRET = process.env.RCM_JWT_SECRET || '';

function signToken(user) {
  return jwt.sign(
    { id: user.id, org_id: user.org_id, role: user.role, email: user.email, name: user.name },
    SECRET,
    { expiresIn: '7d' }
  );
}

// Ensure an AI-side org exists for an RCM org (links by rcm_org_id), and an
// AI-side user row for the RCM user (KBs, conversations and API keys are keyed
// off AI org/user ids).
function ensureRcmIdentity(rcmUser, rcmOrgId) {
  let org = db.prepare('SELECT * FROM orgs WHERE rcm_org_id = ?').get(rcmOrgId);
  if (!org) {
    // Pull the org name from the RCM db when available
    let name = 'My Organization';
    try {
      const { DatabaseSync } = require('node:sqlite');
      const path = require('path');
      const rcmPath = process.env.RCM_DB_PATH || path.join('/opt/claimpaid-rcm/server', 'rcm.db');
      const rdb = new DatabaseSync(rcmPath, { readOnly: true });
      const r = rdb.prepare('SELECT name FROM orgs WHERE id = ?').get(rcmOrgId);
      if (r?.name) name = r.name;
      rdb.close();
    } catch { /* keep default name */ }
    const id = Number(db.prepare('INSERT INTO orgs (name, rcm_org_id) VALUES (?, ?)').run(name, rcmOrgId).lastInsertRowid);
    org = db.prepare('SELECT * FROM orgs WHERE id = ?').get(id);
  }
  const email = (rcmUser.email || '').toLowerCase();
  let user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  if (!user && email) {
    const role = rcmUser.role === 'owner' ? 'owner' : 'member';
    const id = Number(db.prepare(
      'INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)'
    ).run(org.id, rcmUser.name || email, email, 'rcm-sso', role).lastInsertRowid);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  } else if (user && user.org_id !== org.id) {
    // User moved workspaces in RCM — keep their AI identity in the right org
    db.prepare('UPDATE users SET org_id = ? WHERE id = ?').run(org.id, user.id);
    user.org_id = org.id;
  }
  return { user, org };
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  // 1) Legacy AI-issued token
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.org_id) {
      req.user = payload;
      req.orgId = payload.org_id;
      req.rcmOrgId = null;
      // Legacy AI orgs have no RCM subscription — grandfather full access
      req.plan = null;
      req.products = { rcm: true, ai: true };
      return next();
    }
  } catch { /* fall through to RCM token */ }

  // 2) RCM-issued token (shared localStorage on claimpaid.io)
  if (RCM_SECRET) {
    try {
      const payload = jwt.verify(token, RCM_SECRET);
      if (payload.sub && payload.org) {
        const { user, org } = ensureRcmIdentity(
          { email: payload.email, name: payload.name, role: payload.role },
          payload.org
        );
        const { plan, plan_status, products } = getRcmPlan(payload.org);
        req.user = { id: user.id, org_id: org.id, role: user.role, email: user.email, name: user.name };
        req.orgId = org.id;
        req.rcmOrgId = payload.org;
        req.plan = plan;
        req.plan_status = plan_status;
        req.products = products;
        return next();
      }
    } catch { /* invalid */ }
  }

  return res.status(401).json({ error: 'Invalid session' });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Load the KB and verify it belongs to the caller's org
function loadKb(req, res, next) {
  const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ? AND org_id = ?')
    .get(req.params.kbId, req.orgId);
  if (!kb) return res.status(404).json({ error: 'Knowledge base not found' });
  req.kb = kb;
  next();
}

module.exports = { signToken, authRequired, requireRole, loadKb, SECRET };
