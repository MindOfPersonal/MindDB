'use strict';

/** Kleine fetch-wrapper rond de MindDB API. Gooit Error met server-message bij fouten. */

async function request(method, url, body, raw = false) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (typeof body === 'string') {
      opts.headers['Content-Type'] = 'application/sql';
      opts.body = body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new Error('Kan de MindDB-server niet bereiken');
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.code = data && data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url, body) => body !== undefined ? request('DELETE', url, body) : request('DELETE', url),

  // Authenticatie
  authConfig: () => request('GET', '/api/auth/config'),
  me: () => request('GET', '/api/auth/me'),
  login: (payload) => request('POST', '/api/auth/login', payload),
  register: (payload) => request('POST', '/api/auth/register', payload),
  logout: () => request('POST', '/api/auth/logout'),
  panelUsers: () => request('GET', '/api/auth/users'),
  setPanelUserRole: (id, role) => request('PUT', `/api/auth/users/${id}/role`, { role }),
  deletePanelUser: (id) => request('DELETE', `/api/auth/users/${id}`),

  // Verbinding
  connect: (cfg) => request('POST', '/api/connect', cfg),
  test: (cfg) => request('POST', '/api/test', cfg),
  disconnect: () => request('POST', '/api/disconnect'),
  connection: () => request('GET', '/api/connection'),
  profiles: () => request('GET', '/api/profiles'),
  saveProfile: (p) => request('POST', '/api/profiles', p),
  deleteProfile: (id) => request('DELETE', `/api/profiles/${id}`),

  // Databases & tabellen
  databases: () => request('GET', '/api/databases'),
  createDatabase: (payload) => request('POST', '/api/databases', payload),
  dropDatabase: (name) => request('DELETE', `/api/databases/${encodeURIComponent(name)}`),
  charsets: () => request('GET', '/api/charsets'),
  dbPrivileges: (db) => request('GET', `/api/databases/${enc(db)}/privileges`),
  grantDbPrivilege: (db, payload) => request('POST', `/api/databases/${enc(db)}/privileges`, payload),
  revokeDbPrivilege: (db, user, host) => request('DELETE', `/api/databases/${enc(db)}/privileges/${enc(user)}/${enc(host)}`),
  tables: (db) => request('GET', `/api/databases/${enc(db)}/tables`),
  createTable: (db, payload) => request('POST', `/api/databases/${enc(db)}/tables`, payload),
  dropTable: (db, table, type) => request('DELETE', `/api/databases/${enc(db)}/tables/${enc(table)}?type=${type || 'BASE TABLE'}`),
  truncateTable: (db, table) => request('POST', `/api/databases/${enc(db)}/tables/${enc(table)}/truncate`),
  renameTable: (db, table, newName) => request('POST', `/api/databases/${enc(db)}/tables/${enc(table)}/rename`, { newName }),
  duplicateTable: (db, table, newName, withData) => request('POST', `/api/databases/${enc(db)}/tables/${enc(table)}/duplicate`, { newName, withData }),
  showCreate: (db, table) => request('GET', `/api/databases/${enc(db)}/tables/${enc(table)}/create`),

  // Structuur
  columns: (db, table) => request('GET', `/api/databases/${enc(db)}/tables/${enc(table)}/columns`),
  indexes: (db, table) => request('GET', `/api/databases/${enc(db)}/tables/${enc(table)}/indexes`),
  foreignKeys: (db, table) => request('GET', `/api/databases/${enc(db)}/tables/${enc(table)}/foreign-keys`),
  addColumn: (db, table, col) => request('POST', `/api/databases/${enc(db)}/tables/${enc(table)}/columns`, col),
  changeColumn: (db, table, col, def) => request('PUT', `/api/databases/${enc(db)}/tables/${enc(table)}/columns/${enc(col)}`, def),
  dropColumn: (db, table, col) => request('DELETE', `/api/databases/${enc(db)}/tables/${enc(table)}/columns/${enc(col)}`),
  addIndex: (db, table, idx) => request('POST', `/api/databases/${enc(db)}/tables/${enc(table)}/indexes`, idx),
  dropIndex: (db, table, idx) => request('DELETE', `/api/databases/${enc(db)}/tables/${enc(table)}/indexes/${enc(idx)}`),
  objects: (db) => request('GET', `/api/databases/${enc(db)}/objects`),
  objectCreate: (db, type, name) => request('GET', `/api/databases/${enc(db)}/objects/${enc(type)}/${enc(name)}/create`),
  dropObject: (db, type, name) => request('DELETE', `/api/databases/${enc(db)}/objects/${enc(type)}/${enc(name)}`),

  // Data
  rows: (db, table, params) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
    return request('GET', `/api/databases/${enc(db)}/tables/${enc(table)}/rows?${q}`);
  },
  insertRow: (db, table, data) => request('POST', `/api/databases/${enc(db)}/tables/${enc(table)}/rows`, { data }),
  updateRow: (db, table, data, where) => request('PUT', `/api/databases/${enc(db)}/tables/${enc(table)}/rows`, { data, where }),
  deleteRow: (db, table, where) => request('DELETE', `/api/databases/${enc(db)}/tables/${enc(table)}/rows`, { where }),

  // Query
  query: (sql, database, maxRows) => request('POST', '/api/query', { sql, database, maxRows }),

  // Server
  serverStatus: () => request('GET', '/api/server/status'),
  serverVariables: (scope) => request('GET', `/api/server/variables?scope=${scope || 'global'}`),
  processlist: () => request('GET', '/api/server/processlist'),
  killProcess: (id) => request('POST', `/api/server/kill/${id}`),
  users: () => request('GET', '/api/server/users'),
  userGrants: (user, host) => request('GET', `/api/server/users/${enc(user)}/${enc(host)}/grants`),
  userDatabases: (user, host) => request('GET', `/api/server/users/${enc(user)}/${enc(host)}/db-privileges`),
  createUser: (payload) => request('POST', '/api/server/users', payload),
  dropUser: (user, host) => request('DELETE', `/api/server/users/${enc(user)}/${enc(host)}`),

  // Import
  importSql: (db, sql) => request('POST', `/api/import/${enc(db)}`, sql),

  exportUrl: (db, table, format, withData) => {
    const q = new URLSearchParams({ format });
    if (table) q.set('table', table);
    if (withData === false) q.set('data', 'false');
    return `/api/export/${enc(db)}?${q}`;
  }
};

function enc(s) { return encodeURIComponent(s); }
