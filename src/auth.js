'use strict';

/* ============================================================
   Paneel-authenticatie: accounts en sessies in MariaDB
   ============================================================ */
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const session = require('express-session');

const PANEL_DB = process.env.PANEL_DB || 'minddb_panel';
const ALLOW_REGISTRATION = String(process.env.ALLOW_REGISTRATION ?? 'true') !== 'false';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_TTL = Number(process.env.SESSION_TTL_HOURS || 12) * 3600 * 1000;

let pool = null;

function baseConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4'
  };
}

async function init() {
  const bootstrap = await mysql.createConnection(baseConfig());
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${PANEL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await bootstrap.end();
  }

  pool = mysql.createPool({ ...baseConfig(), database: PANEL_DB });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      email VARCHAR(190) NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','user') NOT NULL DEFAULT 'user',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid VARCHAR(128) NOT NULL PRIMARY KEY,
      sess MEDIUMTEXT NOT NULL,
      expires BIGINT NOT NULL,
      INDEX idx_sessions_expires (expires)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await cleanupSessions();
  const timer = setInterval(cleanupSessions, 15 * 60 * 1000);
  if (timer.unref) timer.unref();
}

async function cleanupSessions() {
  if (!pool) return;
  try { await pool.query('DELETE FROM sessions WHERE expires < ?', [Date.now()]); } catch { /* negeren */ }
}

/* ------------------------------------------------------------------ */
/* Wachtwoorden                                                        */
/* ------------------------------------------------------------------ */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  try {
    const [, N, r, p, saltB64, keyB64] = stored.split('$');
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const key = crypto.scryptSync(password, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, email: row.email || '', role: row.role, createdAt: row.created_at, lastLoginAt: row.last_login_at };
}

/* ------------------------------------------------------------------ */
/* Validatie                                                           */
/* ------------------------------------------------------------------ */
function validateIdentity({ username, email, password }) {
  if (!username || !/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
    return 'Gebruikersnaam moet 3-64 tekens zijn (letters, cijfers, . _ -)';
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Ongeldig e-mailadres';
  }
  if (!password || password.length < 8) {
    return 'Wachtwoord moet minimaal 8 tekens zijn';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */
async function countUsers() {
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM users');
  return Number(rows[0].n);
}

async function register({ username, email, password }) {
  if (!ALLOW_REGISTRATION) {
    const err = new Error('Registratie is uitgeschakeld');
    err.status = 403;
    throw err;
  }
  const invalid = validateIdentity({ username, email, password });
  if (invalid) {
    const err = new Error(invalid);
    err.status = 400;
    throw err;
  }
  const role = (await countUsers()) === 0 ? 'admin' : 'user';
  let result;
  try {
    [result] = await pool.query(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email || null, hashPassword(password), role]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      const err = new Error('Gebruikersnaam of e-mailadres bestaat al');
      err.status = 409;
      throw err;
    }
    throw e;
  }
  const user = await getUser(result.insertId);
  return user;
}

async function login({ identifier, password }) {
  if (!identifier || !password) {
    const err = new Error('Gebruikersnaam en wachtwoord zijn verplicht');
    err.status = 400;
    throw err;
  }
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1', [identifier, identifier]);
  const row = rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    const err = new Error('Onjuiste gebruikersnaam of wachtwoord');
    err.status = 401;
    throw err;
  }
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [row.id]);
  return publicUser(row);
}

async function getUser(id) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return publicUser(rows[0]);
}

async function getUserRow(id) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function listUsers() {
  const [rows] = await pool.query('SELECT * FROM users ORDER BY created_at');
  return rows.map(publicUser);
}

async function deleteUser(id, currentUserId) {
  if (Number(id) === Number(currentUserId)) {
    const err = new Error('Je kunt je eigen account niet verwijderen');
    err.status = 400;
    throw err;
  }
  await pool.query('DELETE FROM users WHERE id = ?', [id]);
}

async function setRole(id, role) {
  if (!['admin', 'user'].includes(role)) {
    const err = new Error('Ongeldige rol');
    err.status = 400;
    throw err;
  }
  await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
}

/* ------------------------------------------------------------------ */
/* Sessie-store in MariaDB                                             */
/* ------------------------------------------------------------------ */
class PanelSessionStore extends session.Store {
  get(sid, cb) {
    pool.query('SELECT sess, expires FROM sessions WHERE sid = ?', [sid])
      .then(([rows]) => {
        if (!rows.length) return cb(null, null);
        if (Number(rows[0].expires) < Date.now()) {
          return this.destroy(sid, () => cb(null, null));
        }
        let data = null;
        try { data = JSON.parse(rows[0].sess); } catch { return cb(null, null); }
        cb(null, data);
      })
      .catch(cb);
  }

  set(sid, sess, cb) {
    const expires = sessionExpiry(sess);
    pool.query(
      'INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE sess = VALUES(sess), expires = VALUES(expires)',
      [sid, JSON.stringify(sess), expires])
      .then(() => cb(null)).catch(cb);
  }

  touch(sid, sess, cb) {
    pool.query('UPDATE sessions SET expires = ? WHERE sid = ?', [sessionExpiry(sess), sid])
      .then(() => cb(null)).catch(cb);
  }

  destroy(sid, cb) {
    pool.query('DELETE FROM sessions WHERE sid = ?', [sid])
      .then(() => cb(null)).catch(cb);
  }
}

function sessionExpiry(sess) {
  if (sess && sess.cookie && sess.cookie.expires) return new Date(sess.cookie.expires).getTime();
  return Date.now() + SESSION_TTL;
}

function createSessionStore() {
  return new PanelSessionStore();
}

module.exports = {
  init,
  register,
  login,
  getUser,
  getUserRow,
  listUsers,
  deleteUser,
  setRole,
  countUsers,
  createSessionStore,
  publicUser,
  allowRegistration: ALLOW_REGISTRATION,
  sessionTtl: SESSION_TTL
};
