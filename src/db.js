'use strict';

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROFILES_FILE = path.join(__dirname, '..', 'data', 'profiles.json');
const SECRET_FILE = path.join(__dirname, '..', 'data', '.secret');

/* ------------------------------------------------------------------ */
/* Sleutel voor versleuteling van opgeslagen wachtwoorden              */
/* ------------------------------------------------------------------ */
function getSecret() {
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE);
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

function encrypt(text) {
  if (!text) return '';
  const key = getSecret();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payload) {
  if (!payload) return '';
  try {
    const key = getSecret();
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 16);
    const tag = raw.subarray(16, 32);
    const data = raw.subarray(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Profielen (opgeslagen verbindingen)                                 */
/* ------------------------------------------------------------------ */
function loadProfiles() {
  try {
    if (!fs.existsSync(PROFILES_FILE)) return [];
    const list = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveProfiles(list) {
  fs.mkdirSync(path.dirname(PROFILES_FILE), { recursive: true });
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(list, null, 2));
}

function listProfiles() {
  return loadProfiles().map(p => ({
    id: p.id,
    name: p.name,
    host: p.host,
    port: p.port,
    user: p.user,
    database: p.database || '',
    color: p.color || '',
    hasPassword: !!p.password
  }));
}

function getProfile(id) {
  const p = loadProfiles().find(x => x.id === id);
  if (!p) return null;
  return { ...p, password: decrypt(p.password) };
}

function upsertProfile(profile) {
  const list = loadProfiles();
  const idx = list.findIndex(x => x.id === profile.id);
  const record = {
    id: profile.id || crypto.randomUUID(),
    name: profile.name || `${profile.user}@${profile.host}`,
    host: profile.host,
    port: Number(profile.port) || 3306,
    user: profile.user,
    password: profile.password ? encrypt(profile.password) : (idx >= 0 ? list[idx].password : ''),
    database: profile.database || '',
    color: profile.color || ''
  };
  if (idx >= 0) list[idx] = record; else list.push(record);
  saveProfiles(list);
  return record.id;
}

function deleteProfile(id) {
  saveProfiles(loadProfiles().filter(x => x.id !== id));
}

/* ------------------------------------------------------------------ */
/* Verbindingen (per sessie één pool)                                  */
/* ------------------------------------------------------------------ */
const pools = new Map(); // sessionId -> { pool, config, serverInfo }

async function testConnection(cfg) {
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: Number(cfg.port) || 3306,
    user: cfg.user,
    password: cfg.password || '',
    database: cfg.database || undefined,
    connectTimeout: 8000,
    multipleStatements: true
  });
  const [rows] = await conn.query('SELECT VERSION() AS version, CURRENT_USER() AS currentUser');
  await conn.end();
  return rows[0];
}

async function connect(sessionId, cfg) {
  await disconnect(sessionId);
  const pool = mysql.createPool({
    host: cfg.host,
    port: Number(cfg.port) || 3306,
    user: cfg.user,
    password: cfg.password || '',
    database: cfg.database || undefined,
    connectionLimit: 5,
    multipleStatements: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    namedPlaceholders: false,
    charset: 'utf8mb4'
  });
  const [rows] = await pool.query('SELECT VERSION() AS version, CURRENT_USER() AS currentUser, @@hostname AS hostname');
  pools.set(sessionId, {
    pool,
    config: { host: cfg.host, port: Number(cfg.port) || 3306, user: cfg.user, database: cfg.database || '' },
    serverInfo: rows[0],
    connectedAt: new Date()
  });
  return rows[0];
}

async function disconnect(sessionId) {
  const entry = pools.get(sessionId);
  if (entry) {
    pools.delete(sessionId);
    try { await entry.pool.end(); } catch { /* negeren */ }
  }
}

function getEntry(sessionId) {
  return pools.get(sessionId) || null;
}

async function disconnectAll() {
  const ids = [...pools.keys()];
  await Promise.all(ids.map(id => disconnect(id)));
}

function getPool(sessionId) {
  const entry = pools.get(sessionId);
  if (!entry) {
    const err = new Error('Niet verbonden. Maak eerst verbinding met een server.');
    err.status = 401;
    throw err;
  }
  return entry.pool;
}

module.exports = {
  testConnection,
  connect,
  disconnect,
  disconnectAll,
  getEntry,
  getPool,
  listProfiles,
  getProfile,
  upsertProfile,
  deleteProfile,
  escapeId: mysql.escapeId
};
