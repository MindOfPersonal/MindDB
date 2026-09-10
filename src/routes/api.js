'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const asyncH = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function pool(req) { return db.getPool(req.sessionID); }

function escId(name) {
  // Verwerk db.tabel notatie veilig
  return String(name).split('.').map(part => db.escapeId(part)).join('.');
}

function requireConnection(req, res, next) {
  if (!db.getEntry(req.sessionID)) {
    return res.status(401).json({ error: 'Niet verbonden. Maak eerst verbinding met een server.' });
  }
  next();
}

/** Database-specifieke rechten: API-naam -> kolom in mysql.db */
const DB_PRIVS = {
  SELECT: 'Select_priv',
  INSERT: 'Insert_priv',
  UPDATE: 'Update_priv',
  DELETE: 'Delete_priv',
  CREATE: 'Create_priv',
  DROP: 'Drop_priv',
  INDEX: 'Index_priv',
  ALTER: 'Alter_priv',
  'CREATE TEMPORARY TABLES': 'Create_tmp_table_priv',
  'LOCK TABLES': 'Lock_tables_priv',
  'CREATE VIEW': 'Create_view_priv',
  'SHOW VIEW': 'Show_view_priv',
  'CREATE ROUTINE': 'Create_routine_priv',
  'ALTER ROUTINE': 'Alter_routine_priv',
  EXECUTE: 'Execute_priv',
  EVENT: 'Event_priv',
  TRIGGER: 'Trigger_priv',
  REFERENCES: 'References_priv'
};

function dbPrivilegeList(row) {
  const privileges = Object.entries(DB_PRIVS)
    .filter(([, col]) => row[col] === 'Y')
    .map(([name]) => name);
  return { user: row.user, host: row.host, privileges, grantOption: row.Grant_priv === 'Y' };
}

/** Normaliseert mysql2 resultaat (ook multipleStatements) naar een uniform antwoord. */
function isHeader(r) {
  return !!(r && r.constructor && r.constructor.name === 'ResultSetHeader');
}

function normalizeResult(result, maxRows = 1000) {
  if (Array.isArray(result)) {
    // Meerdere statements: array van resultaatsets (rijen-array of ResultSetHeader)
    if (result.length > 0 && (Array.isArray(result[0]) || isHeader(result[0]))) {
      return result.map(r => singleResult(r, maxRows));
    }
    // Enkel SELECT-resultaat: array van rij-objecten
    return [singleResult(result, maxRows)];
  }
  // Enkel niet-SELECT statement: ResultSetHeader
  return [singleResult(result, maxRows)];
}

function singleResult(r, maxRows) {
  if (Array.isArray(r)) {
    const truncated = r.length > maxRows;
    return {
      type: 'rows',
      columns: r.length > 0 ? Object.keys(r[0]) : [],
      rows: r.slice(0, maxRows),
      rowCount: r.length,
      truncated
    };
  }
  return {
    type: 'ok',
    affectedRows: r.affectedRows ?? 0,
    insertId: r.insertId !== undefined ? String(r.insertId) : undefined,
    changedRows: r.changedRows ?? 0,
    info: r.info || '',
    warningStatus: r.warningStatus ?? 0
  };
}

/* ================================================================== */
/* Verbinding & profielen                                              */
/* ================================================================== */
router.post('/connect', asyncH(async (req, res) => {
  const { host, port, user, password, database, profileId } = req.body || {};
  let cfg = { host, port, user, password, database };
  if (profileId) {
    const p = db.getProfile(profileId);
    if (!p) return res.status(404).json({ error: 'Profiel niet gevonden' });
    cfg = { host: p.host, port: p.port, user: p.user, database: p.database, password: password || p.password };
  }
  if (!cfg.host || !cfg.user) return res.status(400).json({ error: 'Host en gebruiker zijn verplicht' });
  const info = await db.connect(req.sessionID, cfg);
  res.json({ ok: true, server: info, config: db.getEntry(req.sessionID).config });
}));

router.post('/disconnect', asyncH(async (req, res) => {
  await db.disconnect(req.sessionID);
  res.json({ ok: true });
}));

router.get('/connection', (req, res) => {
  const entry = db.getEntry(req.sessionID);
  if (!entry) return res.json({ connected: false });
  res.json({
    connected: true,
    config: entry.config,
    server: entry.serverInfo,
    connectedAt: entry.connectedAt
  });
});

router.post('/test', asyncH(async (req, res) => {
  const { host, port, user, password, database, profileId } = req.body || {};
  let cfg = { host, port, user, password, database };
  if (profileId) {
    const p = db.getProfile(profileId);
    if (!p) return res.status(404).json({ error: 'Profiel niet gevonden' });
    cfg = { host: p.host, port: p.port, user: p.user, database: p.database, password: password || p.password };
  }
  if (!cfg.host || !cfg.user) return res.status(400).json({ error: 'Host en gebruiker zijn verplicht' });
  const info = await db.testConnection(cfg);
  res.json({ ok: true, server: info });
}));

router.get('/profiles', (req, res) => res.json(db.listProfiles()));

router.post('/profiles', (req, res) => {
  const { id, name, host, port, user, password, database, color } = req.body || {};
  if (!host || !user) return res.status(400).json({ error: 'Host en gebruiker zijn verplicht' });
  const newId = db.upsertProfile({ id, name, host, port, user, password, database, color });
  res.json({ ok: true, id: newId });
});

router.delete('/profiles/:id', (req, res) => {
  db.deleteProfile(req.params.id);
  res.json({ ok: true });
});

/* ================================================================== */
/* Databases                                                           */
/* ================================================================== */
router.get('/databases', requireConnection, asyncH(async (req, res) => {
  const [rows] = await pool(req).query(`
    SELECT s.SCHEMA_NAME AS name, s.DEFAULT_CHARACTER_SET_NAME AS charset,
           s.DEFAULT_COLLATION_NAME AS collation,
           COUNT(t.TABLE_NAME) AS tables,
           COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) AS size
    FROM information_schema.SCHEMATA s
    LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
    GROUP BY s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME
    ORDER BY s.SCHEMA_NAME`);
  res.json(rows);
}));

router.post('/databases', requireConnection, asyncH(async (req, res) => {
  const { name, charset, collation } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Naam is verplicht' });
  let sql = `CREATE DATABASE ${escId(name)}`;
  if (charset) sql += ` CHARACTER SET ${db.escapeId(charset)}`;
  if (collation) sql += ` COLLATE ${db.escapeId(collation)}`;
  await pool(req).query(sql);
  res.json({ ok: true });
}));

router.delete('/databases/:db', requireConnection, asyncH(async (req, res) => {
  await pool(req).query(`DROP DATABASE ${escId(req.params.db)}`);
  res.json({ ok: true });
}));

router.get('/charsets', requireConnection, asyncH(async (req, res) => {
  const [charsets] = await pool(req).query('SELECT CHARACTER_SET_NAME AS name, DESCRIPTION AS description FROM information_schema.CHARACTER_SETS ORDER BY CHARACTER_SET_NAME');
  const [collations] = await pool(req).query('SELECT COLLATION_NAME AS name, CHARACTER_SET_NAME AS charset FROM information_schema.COLLATIONS ORDER BY COLLATION_NAME');
  res.json({ charsets, collations });
}));

/* ================================================================== */
/* Rechten op databaseniveau                                           */
/* ================================================================== */
router.get('/databases/:db/privileges', requireConnection, asyncH(async (req, res) => {
  const cols = Object.values(DB_PRIVS).join(', ');
  const [rows] = await pool(req).query(
    `SELECT User AS \`user\`, Host AS \`host\`, ${cols}, Grant_priv
     FROM mysql.db WHERE Db = ? ORDER BY User, Host`, [req.params.db]);
  res.json(rows.map(dbPrivilegeList));
}));

router.post('/databases/:db/privileges', requireConnection, asyncH(async (req, res) => {
  const { user, host, privileges, grantOption } = req.body || {};
  if (!user || !host) return res.status(400).json({ error: 'Gebruiker en host zijn verplicht' });
  const allowed = Object.keys(DB_PRIVS);
  const privs = (Array.isArray(privileges) ? privileges : [])
    .map(x => String(x).toUpperCase())
    .filter(x => allowed.includes(x));
  if (!privs.length) return res.status(400).json({ error: 'Selecteer minimaal één recht' });
  const sql = `GRANT ${privs.join(', ')} ON ${escId(req.params.db)}.* TO ?@?${grantOption ? ' WITH GRANT OPTION' : ''}`;
  await pool(req).query(sql, [user, host]);
  res.json({ ok: true });
}));

router.delete('/databases/:db/privileges/:user/:host', requireConnection, asyncH(async (req, res) => {
  const p = pool(req);
  const { user, host } = req.params;
  const cols = Object.values(DB_PRIVS).join(', ');
  const [rows] = await p.query(
    `SELECT ${cols}, Grant_priv FROM mysql.db WHERE Db = ? AND User = ? AND Host = ?`,
    [req.params.db, user, host]);
  if (!rows.length) return res.json({ ok: true });
  const info = dbPrivilegeList({ ...rows[0], user, host });
  const target = `${escId(req.params.db)}.*`;
  if (info.grantOption) {
    try { await p.query(`REVOKE GRANT OPTION ON ${target} FROM ?@?`, [user, host]); } catch { /* negeren */ }
  }
  if (info.privileges.length) {
    try {
      await p.query(`REVOKE ${info.privileges.join(', ')} ON ${target} FROM ?@?`, [user, host]);
    } catch (err) {
      if (err.code !== 'ER_NONEXISTING_GRANT' && err.code !== 'ER_NO_SUCH_USER') throw err;
    }
  }
  res.json({ ok: true });
}));

/* ================================================================== */
/* Tabellen & objecten                                                 */
/* ================================================================== */
router.get('/databases/:db/tables', requireConnection, asyncH(async (req, res) => {
  const [rows] = await pool(req).query(`
    SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_ROWS AS \`rows\`,
           DATA_LENGTH AS dataLength, INDEX_LENGTH AS indexLength,
           (DATA_LENGTH + INDEX_LENGTH) AS size, TABLE_COLLATION AS collation,
           AUTO_INCREMENT AS autoIncrement, CREATE_TIME AS created, UPDATE_TIME AS updated,
           TABLE_COMMENT AS comment
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ?
    ORDER BY TABLE_TYPE, TABLE_NAME`, [req.params.db]);
  res.json(rows.map(r => ({ ...r, rows: r.rows !== null ? Number(r.rows) : null, size: Number(r.size) })));
}));

router.post('/databases/:db/tables', requireConnection, asyncH(async (req, res) => {
  const { name, columns, engine, charset, collation, comment } = req.body || {};
  if (!name || !Array.isArray(columns) || columns.length === 0) {
    return res.status(400).json({ error: 'Naam en minimaal één kolom zijn verplicht' });
  }
  const defs = columns.map(c => columnDefSql(c));
  const pk = columns.filter(c => c.primary).map(c => escId(c.name));
  if (pk.length) defs.push(`PRIMARY KEY (${pk.join(', ')})`);
  let sql = `CREATE TABLE ${escId(req.params.db)}.${escId(name)} (\n  ${defs.join(',\n  ')}\n)`;
  sql += ` ENGINE=${engine || 'InnoDB'}`;
  if (charset) sql += ` DEFAULT CHARSET=${db.escapeId(charset)}`;
  if (collation) sql += ` COLLATE=${db.escapeId(collation)}`;
  if (comment) sql += ` COMMENT=${pool(req).escape(comment)}`;
  await pool(req).query(sql);
  res.json({ ok: true });
}));

router.delete('/databases/:db/tables/:table', requireConnection, asyncH(async (req, res) => {
  const { type } = req.query;
  const kw = type === 'VIEW' ? 'VIEW' : 'TABLE';
  await pool(req).query(`DROP ${kw} ${escId(req.params.db)}.${escId(req.params.table)}`);
  res.json({ ok: true });
}));

router.post('/databases/:db/tables/:table/truncate', requireConnection, asyncH(async (req, res) => {
  await pool(req).query(`TRUNCATE TABLE ${escId(req.params.db)}.${escId(req.params.table)}`);
  res.json({ ok: true });
}));

router.post('/databases/:db/tables/:table/rename', requireConnection, asyncH(async (req, res) => {
  const { newName } = req.body || {};
  if (!newName) return res.status(400).json({ error: 'Nieuwe naam is verplicht' });
  await pool(req).query(`RENAME TABLE ${escId(req.params.db)}.${escId(req.params.table)} TO ${escId(req.params.db)}.${escId(newName)}`);
  res.json({ ok: true });
}));

router.post('/databases/:db/tables/:table/duplicate', requireConnection, asyncH(async (req, res) => {
  const { newName, withData } = req.body || {};
  if (!newName) return res.status(400).json({ error: 'Nieuwe naam is verplicht' });
  const p = pool(req);
  await p.query(`CREATE TABLE ${escId(req.params.db)}.${escId(newName)} LIKE ${escId(req.params.db)}.${escId(req.params.table)}`);
  if (withData) {
    await p.query(`INSERT INTO ${escId(req.params.db)}.${escId(newName)} SELECT * FROM ${escId(req.params.db)}.${escId(req.params.table)}`);
  }
  res.json({ ok: true });
}));

router.get('/databases/:db/tables/:table/create', requireConnection, asyncH(async (req, res) => {
  const [rows] = await pool(req).query(`SHOW CREATE TABLE ${escId(req.params.db)}.${escId(req.params.table)}`);
  const row = rows[0];
  res.json({ sql: row['Create Table'] || row['Create View'] || Object.values(row)[1] });
}));

/* ================================================================== */
/* Structuur                                                           */
/* ================================================================== */
router.get('/databases/:db/tables/:table/columns', requireConnection, asyncH(async (req, res) => {
  const [rows] = await pool(req).query(`
    SELECT COLUMN_NAME AS name, COLUMN_TYPE AS columnType, DATA_TYPE AS dataType,
           IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS defaultValue,
           COLUMN_KEY AS \`key\`, EXTRA AS extra, CHARACTER_SET_NAME AS charset,
           COLLATION_NAME AS collation, COLUMN_COMMENT AS comment,
           NUMERIC_PRECISION AS numPrecision, NUMERIC_SCALE AS numScale,
           CHARACTER_MAXIMUM_LENGTH AS maxLength, ORDINAL_POSITION AS position
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION`, [req.params.db, req.params.table]);
  res.json(rows);
}));

router.get('/databases/:db/tables/:table/indexes', requireConnection, asyncH(async (req, res) => {
  const [rows] = await pool(req).query(`
    SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName,
           SEQ_IN_INDEX AS seq, INDEX_TYPE AS type, CARDINALITY AS cardinality,
           SUB_PART AS subPart, NULLABLE AS nullable
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [req.params.db, req.params.table]);
  res.json(rows);
}));

router.get('/databases/:db/tables/:table/foreign-keys', requireConnection, asyncH(async (req, res) => {
  const [rows] = await pool(req).query(`
    SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName,
           k.REFERENCED_TABLE_SCHEMA AS refSchema, k.REFERENCED_TABLE_NAME AS refTable,
           k.REFERENCED_COLUMN_NAME AS refColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, [req.params.db, req.params.table]);
  res.json(rows);
}));

router.post('/databases/:db/tables/:table/columns', requireConnection, asyncH(async (req, res) => {
  const c = req.body || {};
  if (!c.name) return res.status(400).json({ error: 'Kolomnaam is verplicht' });
  let sql = `ALTER TABLE ${escId(req.params.db)}.${escId(req.params.table)} ADD COLUMN ${columnDefSql(c)}`;
  if (c.after) sql += ` AFTER ${escId(c.after)}`;
  else if (c.first) sql += ' FIRST';
  await pool(req).query(sql);
  res.json({ ok: true });
}));

router.put('/databases/:db/tables/:table/columns/:col', requireConnection, asyncH(async (req, res) => {
  const c = req.body || {};
  if (!c.name) return res.status(400).json({ error: 'Kolomnaam is verplicht' });
  const sql = `ALTER TABLE ${escId(req.params.db)}.${escId(req.params.table)} CHANGE COLUMN ${escId(req.params.col)} ${columnDefSql(c)}`;
  await pool(req).query(sql);
  res.json({ ok: true });
}));

router.delete('/databases/:db/tables/:table/columns/:col', requireConnection, asyncH(async (req, res) => {
  await pool(req).query(`ALTER TABLE ${escId(req.params.db)}.${escId(req.params.table)} DROP COLUMN ${escId(req.params.col)}`);
  res.json({ ok: true });
}));

router.post('/databases/:db/tables/:table/indexes', requireConnection, asyncH(async (req, res) => {
  const { name, columns, unique } = req.body || {};
  if (!name || !Array.isArray(columns) || !columns.length) {
    return res.status(400).json({ error: 'Naam en kolommen zijn verplicht' });
  }
  const cols = columns.map(c => escId(c)).join(', ');
  const sql = `ALTER TABLE ${escId(req.params.db)}.${escId(req.params.table)} ADD ${unique ? 'UNIQUE ' : ''}INDEX ${escId(name)} (${cols})`;
  await pool(req).query(sql);
  res.json({ ok: true });
}));

router.delete('/databases/:db/tables/:table/indexes/:idx', requireConnection, asyncH(async (req, res) => {
  await pool(req).query(`ALTER TABLE ${escId(req.params.db)}.${escId(req.params.table)} DROP INDEX ${escId(req.params.idx)}`);
  res.json({ ok: true });
}));

function columnDefSql(c) {
  let def = `${escId(c.name)} ${c.type || 'VARCHAR(255)'}`;
  if (c.charset) def += ` CHARACTER SET ${db.escapeId(c.charset)}`;
  if (c.collation) def += ` COLLATE ${db.escapeId(c.collation)}`;
  def += c.nullable === false ? ' NOT NULL' : ' NULL';
  if (c.defaultValue !== undefined && c.defaultValue !== null && c.defaultValue !== '') {
    if (/^(CURRENT_TIMESTAMP|NULL|TRUE|FALSE|now\(\)|curdate\(\)|curtime\(\))$/i.test(String(c.defaultValue))) {
      def += ` DEFAULT ${c.defaultValue}`;
    } else {
      def += ` DEFAULT '${String(c.defaultValue).replace(/'/g, "''")}'`;
    }
  } else if (c.defaultNull) {
    def += ' DEFAULT NULL';
  }
  if (c.autoIncrement) def += ' AUTO_INCREMENT';
  if (c.onUpdate) def += ` ON UPDATE ${c.onUpdate}`;
  if (c.comment) def += ` COMMENT '${String(c.comment).replace(/'/g, "''")}'`;
  return def;
}

/* ================================================================== */
/* Routines, triggers, events, views                                   */
/* ================================================================== */
router.get('/databases/:db/objects', requireConnection, asyncH(async (req, res) => {
  const p = pool(req);
  const d = req.params.db;
  const [[routines], [triggers], [events], [views]] = await Promise.all([
    p.query(`SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type, DTD_IDENTIFIER AS returns, CREATED AS created, ROUTINE_COMMENT AS comment
             FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE, ROUTINE_NAME`, [d]),
    p.query(`SELECT TRIGGER_NAME AS name, EVENT_MANIPULATION AS event, EVENT_OBJECT_TABLE AS tableName, ACTION_TIMING AS timing, CREATED AS created
             FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME`, [d]),
    p.query(`SELECT EVENT_NAME AS name, EVENT_TYPE AS type, INTERVAL_VALUE AS intervalValue, INTERVAL_FIELD AS intervalField,
                    EXECUTE_AT AS executeAt, STATUS AS status
             FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME`, [d]).catch(() => [[]]),
    p.query(`SELECT TABLE_NAME AS name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, [d])
  ]);
  res.json({ routines, triggers, events, views });
}));

router.get('/databases/:db/objects/:type/:name/create', requireConnection, asyncH(async (req, res) => {
  const { type, name } = req.params;
  const p = pool(req);
  const map = {
    PROCEDURE: ['SHOW CREATE PROCEDURE', 'Create Procedure'],
    FUNCTION: ['SHOW CREATE FUNCTION', 'Create Function'],
    TRIGGER: ['SHOW CREATE TRIGGER', 'SQL Original Statement'],
    EVENT: ['SHOW CREATE EVENT', 'Create Event'],
    VIEW: ['SHOW CREATE VIEW', 'Create View']
  };
  const t = map[String(type).toUpperCase()];
  if (!t) return res.status(400).json({ error: 'Onbekend type' });
  const full = type.toUpperCase() === 'TRIGGER' || type.toUpperCase() === 'EVENT'
    ? `${escId(req.params.db)}.${escId(name)}` : `${escId(req.params.db)}.${escId(name)}`;
  const [rows] = await p.query(`${t[0]} ${full}`);
  res.json({ sql: rows[0][t[1]] || '' });
}));

router.delete('/databases/:db/objects/:type/:name', requireConnection, asyncH(async (req, res) => {
  const { type, name } = req.params;
  const t = String(type).toUpperCase();
  if (!['PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT', 'VIEW'].includes(t)) {
    return res.status(400).json({ error: 'Onbekend type' });
  }
  await pool(req).query(`DROP ${t} IF EXISTS ${escId(req.params.db)}.${escId(name)}`);
  res.json({ ok: true });
}));

/* ================================================================== */
/* Data browsen / bewerken                                             */
/* ================================================================== */
router.get('/databases/:db/tables/:table/rows', requireConnection, asyncH(async (req, res) => {
  const p = pool(req);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(1000, Math.max(1, parseInt(req.query.pageSize) || 50));
  const sort = req.query.sort ? String(req.query.sort) : null;
  const dir = String(req.query.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const where = req.query.where ? String(req.query.where).trim() : '';

  let sql = `SELECT * FROM ${escId(req.params.db)}.${escId(req.params.table)}`;
  let countSql = `SELECT COUNT(*) AS total FROM ${escId(req.params.db)}.${escId(req.params.table)}`;
  if (where) {
    sql += ` WHERE ${where}`;
    countSql += ` WHERE ${where}`;
  }
  if (sort) sql += ` ORDER BY ${escId(sort)} ${dir}`;
  sql += ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

  const [[rows], [countRows], [columns]] = await Promise.all([
    p.query(sql),
    p.query(countSql),
    p.query(`SELECT COLUMN_NAME AS name, COLUMN_TYPE AS columnType, DATA_TYPE AS dataType, COLUMN_KEY AS \`key\`, EXTRA AS extra, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS defaultValue
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [req.params.db, req.params.table])
  ]);
  res.json({
    columns,
    rows,
    total: Number(countRows[0].total),
    page,
    pageSize
  });
}));

router.post('/databases/:db/tables/:table/rows', requireConnection, asyncH(async (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Geen data' });
  const keys = Object.keys(data);
  if (!keys.length) return res.status(400).json({ error: 'Geen data' });
  const cols = keys.map(escId).join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map(k => data[k]);
  const [result] = await pool(req).query(
    `INSERT INTO ${escId(req.params.db)}.${escId(req.params.table)} (${cols}) VALUES (${placeholders})`, values);
  res.json({ ok: true, insertId: result.insertId !== undefined ? String(result.insertId) : undefined, affectedRows: result.affectedRows });
}));

router.put('/databases/:db/tables/:table/rows', requireConnection, asyncH(async (req, res) => {
  const { data, where } = req.body || {};
  if (!data || !where || !Object.keys(where).length) {
    return res.status(400).json({ error: 'Data en where (primaire sleutel) zijn verplicht' });
  }
  const setKeys = Object.keys(data);
  const setClause = setKeys.map(k => `${escId(k)} = ?`).join(', ');
  const whereKeys = Object.keys(where);
  const whereClause = whereKeys.map(k => where[k] === null ? `${escId(k)} IS NULL` : `${escId(k)} = ?`).join(' AND ');
  const values = [...setKeys.map(k => data[k]), ...whereKeys.filter(k => where[k] !== null).map(k => where[k])];
  const [result] = await pool(req).query(
    `UPDATE ${escId(req.params.db)}.${escId(req.params.table)} SET ${setClause} WHERE ${whereClause} LIMIT 1`, values);
  res.json({ ok: true, affectedRows: result.affectedRows });
}));

router.delete('/databases/:db/tables/:table/rows', requireConnection, asyncH(async (req, res) => {
  const { where } = req.body || {};
  if (!where || !Object.keys(where).length) {
    return res.status(400).json({ error: 'Where (primaire sleutel) is verplicht' });
  }
  const keys = Object.keys(where);
  const clause = keys.map(k => where[k] === null ? `${escId(k)} IS NULL` : `${escId(k)} = ?`).join(' AND ');
  const values = keys.filter(k => where[k] !== null).map(k => where[k]);
  const [result] = await pool(req).query(
    `DELETE FROM ${escId(req.params.db)}.${escId(req.params.table)} WHERE ${clause} LIMIT 1`, values);
  res.json({ ok: true, affectedRows: result.affectedRows });
}));

/* ================================================================== */
/* SQL query uitvoeren                                                 */
/* ================================================================== */
router.post('/query', requireConnection, asyncH(async (req, res) => {
  const { sql, database, maxRows } = req.body || {};
  if (!sql || !String(sql).trim()) return res.status(400).json({ error: 'Geen SQL opgegeven' });
  const p = pool(req);
  const started = process.hrtime.bigint();
  let result;
  if (database) {
    const conn = await p.getConnection();
    try {
      await conn.changeUser({ database });
      [result] = await conn.query(sql);
    } finally {
      conn.release();
    }
  } else {
    [result] = await p.query(sql);
  }
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  res.json({
    results: normalizeResult(result, Math.min(5000, maxRows || 1000)),
    durationMs: Math.round(durationMs * 10) / 10
  });
}));

/* ================================================================== */
/* Server: status, variabelen, processen, gebruikers                   */
/* ================================================================== */
router.get('/server/status', requireConnection, asyncH(async (req, res) => {
  const p = pool(req);
  const [[status], [vars], [info]] = await Promise.all([
    p.query('SHOW GLOBAL STATUS'),
    p.query('SHOW GLOBAL VARIABLES'),
    p.query(`SELECT VERSION() AS version, @@hostname AS hostname, @@port AS port,
             @@datadir AS datadir, @@socket AS socket, CURRENT_USER() AS currentUser,
             @@version_comment AS versionComment`)
  ]);
  const statusMap = {};
  for (const r of status) statusMap[r.Variable_name] = r.Value;
  res.json({
    info: info[0],
    uptime: Number(statusMap.Uptime || 0),
    threadsConnected: Number(statusMap.Threads_connected || 0),
    threadsRunning: Number(statusMap.Threads_running || 0),
    questions: Number(statusMap.Questions || 0),
    slowQueries: Number(statusMap.Slow_queries || 0),
    connections: Number(statusMap.Connections || 0),
    maxConnections: Number((vars.find(v => v.Variable_name === 'max_connections') || {}).Value || 0),
    bytesReceived: Number(statusMap.Bytes_received || 0),
    bytesSent: Number(statusMap.Bytes_sent || 0),
    innodbBufferPoolSize: Number((vars.find(v => v.Variable_name === 'innodb_buffer_pool_size') || {}).Value || 0),
    abortedConnects: Number(statusMap.Aborted_connects || 0),
    openTables: Number(statusMap.Open_tables || 0),
    queriesPerSecondAvg: statusMap.Uptime > 0 ? Math.round((Number(statusMap.Questions || 0) / Number(statusMap.Uptime)) * 100) / 100 : 0
  });
}));

router.get('/server/variables', requireConnection, asyncH(async (req, res) => {
  const scope = String(req.query.scope).toLowerCase() === 'session' ? 'SESSION' : 'GLOBAL';
  const [rows] = await pool(req).query(`SHOW ${scope} VARIABLES`);
  res.json(rows.map(r => ({ name: r.Variable_name, value: r.Value })));
}));

router.get('/server/processlist', requireConnection, asyncH(async (req, res) => {
  const [rows] = await pool(req).query('SHOW FULL PROCESSLIST');
  res.json(rows.map(r => ({
    id: r.Id, user: r.User, host: r.Host, db: r.db, command: r.Command,
    time: r.Time, state: r.State, info: r.Info, progress: r.Progress
  })));
}));

router.post('/server/kill/:id', requireConnection, asyncH(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ongeldig proces id' });
  await pool(req).query(`KILL ${id}`);
  res.json({ ok: true });
}));

router.get('/server/users', requireConnection, asyncH(async (req, res) => {
  const [rows] = await pool(req).query(`
    SELECT User AS user, Host AS host, Select_priv AS selectPriv, Insert_priv AS insertPriv,
           Update_priv AS updatePriv, Delete_priv AS deletePriv, Create_priv AS createPriv,
           Drop_priv AS dropPriv, Grant_priv AS grantPriv, Super_priv AS superPriv,
           plugin AS plugin, account_locked AS accountLocked, password_expired AS passwordExpired
    FROM mysql.user ORDER BY User, Host`).catch(async () => {
    const [fallback] = await pool(req).query('SELECT User AS user, Host AS host FROM mysql.user ORDER BY User, Host');
    return [fallback];
  });
  res.json(rows);
}));

router.get('/server/users/:user/:host/grants', requireConnection, asyncH(async (req, res) => {
  const [rows] = await pool(req).query(`SHOW GRANTS FOR ?@?`, [req.params.user, req.params.host]);
  const key = rows.length ? Object.keys(rows[0])[0] : null;
  res.json(rows.map(r => r[key]));
}));

router.get('/server/users/:user/:host/db-privileges', requireConnection, asyncH(async (req, res) => {
  const cols = Object.values(DB_PRIVS).join(', ');
  const [rows] = await pool(req).query(
    `SELECT Db AS \`db\`, ${cols}, Grant_priv FROM mysql.db WHERE User = ? AND Host = ? ORDER BY Db`,
    [req.params.user, req.params.host]);
  res.json(rows.map(r => ({ db: r.db, ...dbPrivilegeList({ ...r, user: req.params.user, host: req.params.host }) })));
}));

router.post('/server/users', requireConnection, asyncH(async (req, res) => {
  const { user, host, password, privileges, grantOption, database, dbPrivileges, dbGrantOption } = req.body || {};
  if (!user || !host) return res.status(400).json({ error: 'Gebruiker en host zijn verplicht' });
  const p = pool(req);
  await p.query(`CREATE USER ?@? IDENTIFIED BY ?`, [user, host, password || '']);
  if (Array.isArray(privileges) && privileges.length) {
    const allowed = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'INDEX', 'CREATE VIEW', 'SHOW VIEW', 'TRIGGER', 'EVENT', 'EXECUTE', 'REFERENCES', 'LOCK TABLES', 'CREATE ROUTINE', 'ALTER ROUTINE', 'RELOAD', 'PROCESS', 'SUPER', 'ALL PRIVILEGES'];
    const privs = privileges.filter(x => allowed.includes(x.toUpperCase())).map(x => x.toUpperCase());
    if (privs.length) {
      await p.query(`GRANT ${privs.join(', ')} ON *.* TO ?@? ${grantOption ? 'WITH GRANT OPTION' : ''}`, [user, host]);
    }
  }
  if (database && Array.isArray(dbPrivileges) && dbPrivileges.length) {
    const allowed = Object.keys(DB_PRIVS);
    const privs = dbPrivileges.map(x => String(x).toUpperCase()).filter(x => allowed.includes(x));
    if (privs.length) {
      await p.query(`GRANT ${privs.join(', ')} ON ${escId(database)}.* TO ?@?${dbGrantOption ? ' WITH GRANT OPTION' : ''}`, [user, host]);
    }
  }
  res.json({ ok: true });
}));

router.delete('/server/users/:user/:host', requireConnection, asyncH(async (req, res) => {
  await pool(req).query('DROP USER ?@?', [req.params.user, req.params.host]);
  res.json({ ok: true });
}));

/* ================================================================== */
/* Export & import                                                     */
/* ================================================================== */
router.get('/export/:db', requireConnection, asyncH(async (req, res) => {
  const format = String(req.query.format || 'sql').toLowerCase();
  const table = req.query.table ? String(req.query.table) : null;
  const withData = req.query.data !== 'false';
  const p = pool(req);
  const dbName = req.params.db;

  let tables;
  if (table) {
    tables = [{ name: table, type: 'BASE TABLE' }];
  } else {
    const [rows] = await p.query(
      'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME', [dbName]);
    tables = rows;
  }

  if (format === 'json' || format === 'csv') {
    if (!table) return res.status(400).json({ error: 'Voor JSON/CSV export is een tabel vereist' });
    const [rows] = await p.query(`SELECT * FROM ${escId(dbName)}.${escId(table)}`);
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${dbName}.${table}.json"`);
      return res.send(JSON.stringify(rows, null, 2));
    }
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${dbName}.${table}.csv"`);
    return res.send(csv);
  }

  // SQL dump
  const lines = [];
  lines.push('-- MindDB SQL Dump');
  lines.push(`-- Database: ${dbName}`);
  lines.push(`-- Gegenereerd: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('SET FOREIGN_KEY_CHECKS=0;');
  lines.push('SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";');
  lines.push('');
  if (!table) {
    lines.push(`CREATE DATABASE IF NOT EXISTS ${escId(dbName)};`);
    lines.push(`USE ${escId(dbName)};`);
    lines.push('');
  }
  for (const t of tables) {
    const [createRows] = await p.query(`SHOW CREATE TABLE ${escId(dbName)}.${escId(t.name)}`);
    const createSql = createRows[0]['Create Table'] || createRows[0]['Create View'];
    lines.push(`-- --------------------------------------------------------`);
    lines.push(`-- ${t.type === 'VIEW' ? 'View' : 'Tabel'}: ${t.name}`);
    lines.push(`-- --------------------------------------------------------`);
    if (t.type !== 'VIEW') lines.push(`DROP TABLE IF EXISTS ${escId(t.name)};`);
    lines.push(createSql + ';');
    lines.push('');
    if (withData && t.type !== 'VIEW') {
      const [dataRows] = await p.query(`SELECT * FROM ${escId(dbName)}.${escId(t.name)}`);
      if (dataRows.length) {
        const cols = Object.keys(dataRows[0]).map(escId).join(', ');
        const chunkSize = 200;
        for (let i = 0; i < dataRows.length; i += chunkSize) {
          const chunk = dataRows.slice(i, i + chunkSize);
          const values = chunk.map(r => '(' + Object.values(r).map(v => p.escape(v)).join(', ') + ')').join(',\n');
          lines.push(`INSERT INTO ${escId(t.name)} (${cols}) VALUES\n${values};`);
        }
        lines.push('');
      }
    }
  }
  lines.push('SET FOREIGN_KEY_CHECKS=1;');
  const sql = lines.join('\n');
  res.setHeader('Content-Type', 'application/sql; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${dbName}${table ? '.' + table : ''}.sql"`);
  res.send(sql);
}));

router.post('/import/:db', requireConnection, asyncH(async (req, res) => {
  const sql = req.body;
  if (!sql || !String(sql).trim()) return res.status(400).json({ error: 'Geen SQL ontvangen' });
  const p = pool(req);
  const conn = await p.getConnection();
  try {
    await conn.changeUser({ database: req.params.db });
    const [result] = await conn.query(String(sql));
    res.json({ ok: true, results: normalizeResult(result, 10) });
  } finally {
    conn.release();
  }
}));

module.exports = router;
