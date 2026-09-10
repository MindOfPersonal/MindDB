'use strict';

/* ============================================================
   Paneel-authenticatie routes
   ============================================================ */
const express = require('express');
const auth = require('../auth');
const db = require('../db');

const router = express.Router();
const asyncH = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function startSession(req, user, remember) {
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  req.session.email = user.email || '';
  req.session.cookie.maxAge = remember ? 30 * 24 * 3600 * 1000 : auth.sessionTtl;
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Alleen beheerders mogen dit' });
  }
  next();
}

router.get('/config', (req, res) => {
  res.json({ allowRegistration: auth.allowRegistration });
});

router.get('/me', asyncH(async (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ user: null });
  const user = await auth.getUser(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }
  res.json({ user });
}));

router.post('/register', asyncH(async (req, res) => {
  const { username, email, password } = req.body || {};
  const user = await auth.register({ username: String(username || '').trim(), email: String(email || '').trim(), password });
  startSession(req, user, true);
  res.json({ ok: true, user });
}));

router.post('/login', asyncH(async (req, res) => {
  const { identifier, username, email, password, remember } = req.body || {};
  const id = identifier || username || email;
  const user = await auth.login({ identifier: String(id || '').trim(), password });
  startSession(req, user, !!remember);
  res.json({ ok: true, user });
}));

router.post('/logout', (req, res) => {
  const sid = req.sessionID;
  db.disconnect(sid).catch(() => {}).finally(() => {
    req.session.destroy(() => res.json({ ok: true }));
  });
});

/* ---- Beheer: paneelgebruikers (admin) ---- */
router.get('/users', requireAuth, requireAdmin, asyncH(async (req, res) => {
  res.json(await auth.listUsers());
}));

router.put('/users/:id/role', requireAuth, requireAdmin, asyncH(async (req, res) => {
  const { role } = req.body || {};
  await auth.setRole(req.params.id, String(role || ''));
  res.json({ ok: true });
}));

router.delete('/users/:id', requireAuth, requireAdmin, asyncH(async (req, res) => {
  await auth.deleteUser(req.params.id, req.session.userId);
  res.json({ ok: true });
}));

module.exports = router;
