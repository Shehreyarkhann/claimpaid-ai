const jwt = require('jsonwebtoken');
const { db } = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(user) {
  return jwt.sign(
    { id: user.id, org_id: user.org_id, role: user.role, email: user.email, name: user.name },
    SECRET,
    { expiresIn: '7d' }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = payload;
    req.orgId = payload.org_id;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid session' });
  }
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
