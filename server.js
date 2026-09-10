'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const apiRoutes = require('./src/routes/api');
const authRoutes = require('./src/routes/auth');
const auth = require('./src/auth');
const db = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3005;
const HOST = process.env.HOST || '127.0.0.1';

/* Sessie-secret: persistent lokaal bestand zodat herstarts sessies behouden */
function getSessionSecret() {
  const dir = path.join(__dirname, 'data');
  const file = path.join(dir, '.session-secret');
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

/* Middleware: vereist een ingelogde paneelgebruiker */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Niet ingelogd. Log eerst in op het paneel.' });
  }
  next();
}

app.disable('x-powered-by');
app.use(express.json({ limit: '64mb' }));
app.use(express.text({ type: ['application/sql', 'text/plain'], limit: '256mb' }));

app.use(session({
  name: 'minddb.sid',
  secret: getSessionSecret(),
  store: auth.createSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 }
}));

/* Publiek: health + authenticatie */
app.get('/api/health', (req, res) => res.json({ ok: true, name: 'MindDB', version: require('./package.json').version }));
app.use('/api/auth', authRoutes);

/* Beschermd: alle overige API-routes */
app.use('/api', requireAuth, apiRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'API-route niet gevonden' }));

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

/* Foutafhandeling: mysql-fouten netjes doorgeven */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.code && String(err.code).startsWith('ER_') ? 400 : 500);
  const message = err.sqlMessage || err.message || 'Onbekende serverfout';
  if (status >= 500) console.error('[MindDB]', err);
  res.status(status).json({ error: message, code: err.code, sqlState: err.sqlState });
});

/* Bij afsluiten: pools netjes sluiten */
async function shutdown() {
  console.log('\n[MindDB] Afsluiten...');
  try { await db.disconnectAll(); } catch { /* negeren */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async function start() {
  try {
    await auth.init();
  } catch (err) {
    console.error('\n[MindDB] Kan de paneel-database niet initialiseren.');
    console.error(`         ${err.sqlMessage || err.message}`);
    console.error('         Controleer DB_HOST/DB_PORT/DB_USER/DB_PASS en PANEL_DB in .env\n');
    process.exit(1);
  }

  app.listen(PORT, HOST, () => {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────┐');
    console.log('  │              M i n d D B                    │');
    console.log('  │   Modern MariaDB beheerpanel                │');
    console.log('  └─────────────────────────────────────────────┘');
    console.log('');
    console.log(`  → Open in je browser:  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`  → Paneel-database:     ${process.env.PANEL_DB || 'minddb_panel'}`);
    console.log('');
  });
})();
