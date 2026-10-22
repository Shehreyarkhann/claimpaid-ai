const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { signToken, authRequired } = require('../auth');

const router = express.Router();

router.post('/signup', (req, res) => {
  const { name, email, orgName, password } = req.body || {};
  if (!name?.trim() || !email?.trim() || !orgName?.trim() || !password || password.length < 8) {
    return res.status(400).json({ error: 'Name, email, organization, and a password (8+ chars) are required' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (exists) return res.status(400).json({ error: 'An account with this email already exists' });

  const orgId = db.prepare('INSERT INTO orgs (name) VALUES (?)').run(orgName.trim()).lastInsertRowid;
  const hash = bcrypt.hashSync(password, 10);
  const userId = db.prepare('INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run(orgId, name.trim(), email.trim().toLowerCase(), hash, 'owner').lastInsertRowid;
  const user = db.prepare('SELECT id, org_id, name, email, role FROM users WHERE id = ?').get(userId);
  res.json({ token: signToken(user), user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const safe = { id: user.id, org_id: user.org_id, name: user.name, email: user.email, role: user.role };
  res.json({ token: signToken(safe), user: safe });
});

router.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT id, org_id, name, email, role FROM users WHERE id = ?').get(req.user.id);
  const org = db.prepare('SELECT id, name FROM orgs WHERE id = ?').get(req.orgId);
  res.json({ user, org, plan: req.plan || null, plan_status: req.plan_status || null, products: req.products || { rcm: true, ai: true } });
});

// Team management (owner/admin)
router.get('/team', authRequired, (req, res) => {
  const members = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE org_id = ? ORDER BY created_at').all(req.orgId);
  res.json({ members });
});

router.post('/team', authRequired, (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only owners and admins can invite' });
  const { name, email, password, role } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    return res.status(400).json({ error: 'Name, email, and password (8+ chars) required' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (exists) return res.status(400).json({ error: 'Email already in use' });
  const safeRole = ['admin', 'member', 'viewer'].includes(role) ? role : 'member';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run(req.orgId, name.trim(), email.trim().toLowerCase(), hash, safeRole);
  res.json({ ok: true });
});

router.delete('/team/:id', authRequired, (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only owners can remove members' });
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot remove yourself' });
  db.prepare('DELETE FROM users WHERE id = ? AND org_id = ?').run(req.params.id, req.orgId);
  res.json({ ok: true });
});

module.exports = router;
