'use strict';

/* ============================================================
   Sidebar: database-boom met tabellen, views, routines, e.d.
   ============================================================ */
import { api } from './api.js';
import { el, icon, toast, contextMenu, confirmModal, openModal, copyText, fmtBytes, fmtNum, debounce, esc } from './util.js';
import { state, refreshTab } from './tabs.js';
import { openBrowseTab } from './browse.js';
import { openStructureTab } from './structure.js';
import { openSqlTab } from './sql.js';
import { openExportModal, openImportModal, openCreateDatabaseModal, openCreateTableModal, openObjectSqlModal } from './actions.js';
import { openDatabasePrivilegesModal } from './privileges.js';
import { openDatabaseTab } from './database.js';

const tree = () => document.getElementById('tree');
const openNodes = new Set();

export async function refreshTree() {
  const node = tree();
  node.innerHTML = '';
  try {
    state.databases = await api.databases();
  } catch (err) {
    node.append(el('div', { class: 'tree-empty', text: err.message }));
    return;
  }
  state.tablesCache.clear();
  renderTree();
}

export function renderTree() {
  const node = tree();
  const filter = document.getElementById('tree-filter').value.trim().toLowerCase();
  node.innerHTML = '';

  /* Server-knooppunt */
  const serverGroup = el('div', { class: 'tree-node' });
  serverGroup.append(treeRow({
    label: state.connection?.config?.host || 'Server',
    iconName: 'server',
    iconCls: 'tbl',
    onToggle: () => toggleNode('__server__', serverGroup, renderServerChildren),
    onClick: () => toggleNode('__server__', serverGroup, renderServerChildren),
    onContext: (e) => serverContextMenu(e)
  }));
  const serverChildren = el('div', { class: 'tree-children' });
  serverGroup.append(serverChildren);
  serverGroup.classList.toggle('open', openNodes.has('__server__'));
  node.append(serverGroup);
  if (openNodes.has('__server__')) renderServerChildren(serverChildren);

  node.append(el('div', { class: 'tree-group-label', text: `Databases (${state.databases.length})` }));

  let visible = state.databases;
  if (filter) visible = state.databases.filter(d => d.name.toLowerCase().includes(filter));

  if (!visible.length) {
    node.append(el('div', { class: 'tree-empty', text: filter ? 'Geen resultaten' : 'Geen databases gevonden' }));
  }
  for (const d of visible) node.append(dbNode(d, filter));
}

function treeRow({ label, iconName, iconCls, badge, onToggle, onClick, onDblClick, onContext }) {
  const row = el('div', { class: 'tree-row' }, [
    onToggle
      ? el('span', { class: 'arrow', html: icon('chevron') })
      : el('span', { class: 'arrow', style: 'visibility:hidden', html: icon('chevron') }),
    el('span', { class: `node-icon ${iconCls || ''}`, html: icon(iconName) }),
    el('span', { class: 'tree-label', text: label }),
    badge !== undefined && badge !== null ? el('span', { class: 'tree-badge', text: String(badge) }) : null
  ]);
  if (onToggle) row.querySelector('.arrow').addEventListener('click', (e) => { e.stopPropagation(); onToggle(); });
  row.addEventListener('click', () => onClick ? onClick() : (onToggle && onToggle()));
  if (onDblClick) row.addEventListener('dblclick', () => onDblClick());
  if (onContext) row.addEventListener('contextmenu', (e) => { e.preventDefault(); onContext(e); });
  return row;
}

function toggleNode(key, groupNode, renderChildren) {
  const children = groupNode.querySelector(':scope > .tree-children');
  if (openNodes.has(key)) {
    openNodes.delete(key);
    groupNode.classList.remove('open');
    children.innerHTML = '';
  } else {
    openNodes.add(key);
    groupNode.classList.add('open');
    renderChildren(children);
  }
}

/* ---------- Server-knooppunt ---------- */
function renderServerChildren(container) {
  container.innerHTML = '';
  const items = [
    { label: 'Dashboard', iconName: 'activity', iconCls: 'event', open: () => import('./dashboard.js').then(m => m.openDashboardTab()) },
    { label: 'Processen', iconName: 'cpu', iconCls: 'routine', open: () => import('./dashboard.js').then(m => m.openProcesslistTab()) },
    { label: 'Variabelen', iconName: 'settings', iconCls: 'tbl', open: () => import('./dashboard.js').then(m => m.openVariablesTab()) },
    { label: 'Gebruikers', iconName: 'users', iconCls: 'view', open: () => import('./dashboard.js').then(m => m.openUsersTab()) }
  ];
  for (const item of items) {
    container.append(treeRow({ label: item.label, iconName: item.iconName, iconCls: item.iconCls, onClick: () => item.open() }));
  }
}

function serverContextMenu(e) {
  contextMenu(e.clientX, e.clientY, [
    { label: 'Dashboard', icon: 'activity', onClick: () => import('./dashboard.js').then(m => m.openDashboardTab()) },
    { label: 'Nieuwe query', icon: 'terminal', onClick: () => openSqlTab() },
    '-',
    { label: 'Nieuwe database…', icon: 'plus', onClick: () => openCreateDatabaseModal(refreshTree) },
    { label: 'Ververs databases', icon: 'refresh', onClick: refreshTree }
  ]);
}

/* ---------- Database-knooppunt ---------- */
function dbNode(d, filter) {
  const key = `db:${d.name}`;
  const group = el('div', { class: 'tree-node db' });
  const row = treeRow({
    label: d.name,
    iconName: 'database',
    badge: d.tables,
    onToggle: () => toggleNode(key, group, (c) => renderDbChildren(c, d.name, filter)),
    onClick: () => {
      if (!openNodes.has(key)) toggleNode(key, group, (c) => renderDbChildren(c, d.name, filter));
      openDatabaseTab(d.name);
    },
    onDblClick: () => openSqlTab(d.name),
    onContext: (e) => dbContextMenu(e, d)
  });
  row.querySelector('.tree-label').title = `${d.name} · ${fmtBytes(d.size)} · ${d.collation || ''}`;
  group.append(row);
  const children = el('div', { class: 'tree-children' });
  group.append(children);
  group.classList.toggle('open', openNodes.has(key) || !!filter);
  if (openNodes.has(key) || filter) renderDbChildren(children, d.name, filter);
  return group;
}

async function renderDbChildren(container, dbName, filter) {
  container.innerHTML = '';
  const loading = el('div', { class: 'tree-empty', text: 'Laden…' });
  container.append(loading);
  let tables, objects;
  try {
    [tables, objects] = await Promise.all([
      api.tables(dbName),
      api.objects(dbName).catch(() => ({ routines: [], triggers: [], events: [], views: [] }))
    ]);
  } catch (err) {
    loading.textContent = err.message;
    return;
  }
  state.tablesCache.set(dbName, tables);
  container.innerHTML = '';

  let shown = tables;
  if (filter) shown = tables.filter(t => t.name.toLowerCase().includes(filter));

  const baseTables = shown.filter(t => t.type !== 'VIEW');
  const views = shown.filter(t => t.type === 'VIEW');

  if (baseTables.length) container.append(el('div', { class: 'tree-group-label', text: `Tabellen (${baseTables.length})` }));
  for (const t of baseTables) container.append(tableNode(dbName, t));

  if (views.length) container.append(el('div', { class: 'tree-group-label', text: `Views (${views.length})` }));
  for (const v of views) container.append(tableNode(dbName, v));

  if (!filter) {
    if (objects.routines.length) {
      container.append(el('div', { class: 'tree-group-label', text: `Routines (${objects.routines.length})` }));
      for (const r of objects.routines) container.append(objectNode(dbName, r, r.type === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION'));
    }
    if (objects.triggers.length) {
      container.append(el('div', { class: 'tree-group-label', text: `Triggers (${objects.triggers.length})` }));
      for (const t of objects.triggers) container.append(objectNode(dbName, t, 'TRIGGER'));
    }
    if (objects.events.length) {
      container.append(el('div', { class: 'tree-group-label', text: `Events (${objects.events.length})` }));
      for (const ev of objects.events) container.append(objectNode(dbName, ev, 'EVENT'));
    }
  }

  if (!container.children.length) {
    container.append(el('div', { class: 'tree-empty', text: filter ? 'Geen tabellen gevonden' : 'Lege database' }));
  }
}

function tableNode(dbName, t) {
  const isView = t.type === 'VIEW';
  return treeRow({
    label: t.name,
    iconName: isView ? 'view' : 'table',
    iconCls: isView ? 'view' : 'tbl',
    badge: !isView && t.rows !== null ? fmtNum(t.rows) : null,
    onClick: () => openBrowseTab(dbName, t.name, isView),
    onContext: (e) => tableContextMenu(e, dbName, t)
  });
}

function objectNode(dbName, obj, type) {
  const iconMap = { PROCEDURE: 'function', FUNCTION: 'function', TRIGGER: 'trigger', EVENT: 'event' };
  const clsMap = { PROCEDURE: 'routine', FUNCTION: 'routine', TRIGGER: 'trigger', EVENT: 'event' };
  return treeRow({
    label: obj.name,
    iconName: iconMap[type],
    iconCls: clsMap[type],
    onClick: () => openObjectSqlModal(dbName, type, obj.name),
    onContext: (e) => contextMenu(e.clientX, e.clientY, [
      { label: 'Definitie bekijken', icon: 'code', onClick: () => openObjectSqlModal(dbName, type, obj.name) },
      { label: 'Naam kopiëren', icon: 'copy', onClick: () => copyText(obj.name) },
      '-',
      {
        label: 'Verwijderen', icon: 'trash', danger: true, onClick: async () => {
          if (await confirmModal({ title: `${type} verwijderen`, message: `Weet je zeker dat je <b class="mono">${esc(obj.name)}</b> wilt verwijderen?`, confirmText: 'Verwijderen', danger: true })) {
            try {
              await api.dropObject(dbName, type, obj.name);
              toast('Verwijderd', 'success');
              refreshDbNode(dbName);
            } catch (err) { toast(err.message, 'error'); }
          }
        }
      }
    ])
  });
}

/* ---------- Contextmenu's ---------- */
function dbContextMenu(e, d) {
  contextMenu(e.clientX, e.clientY, [
    { label: 'Openen in hoofdscherm', icon: 'database', onClick: () => openDatabaseTab(d.name) },
    { label: 'Nieuwe query op database', icon: 'terminal', onClick: () => openSqlTab(d.name) },
    { label: 'Nieuwe tabel…', icon: 'plus', onClick: () => openCreateTableModal(d.name, () => refreshDbNode(d.name)) },
    '-',
    { label: 'Exporteren (SQL dump)…', icon: 'download', onClick: () => openExportModal(d.name) },
    { label: 'Importeren (SQL)…', icon: 'upload', onClick: () => openImportModal(d.name) },
    '-',
    { label: 'Rechten beheren…', icon: 'shield', onClick: () => openDatabasePrivilegesModal(d.name) },
    '-',
    { label: 'Naam kopiëren', icon: 'copy', onClick: () => copyText(d.name) },
    { label: 'Ververs', icon: 'refresh', onClick: () => refreshDbNode(d.name) },
    '-',
    {
      label: 'Database verwijderen…', icon: 'trash', danger: true, onClick: async () => {
        const ok = await confirmModal({
          title: 'Database verwijderen',
          message: `Dit verwijdert database <b class="mono">${esc(d.name)}</b> met <b>alle data</b> permanent.<br>Dit kan niet ongedaan worden gemaakt!`,
          confirmText: 'Definitief verwijderen', danger: true
        });
        if (!ok) return;
        try {
          await api.dropDatabase(d.name);
          toast(`Database ${d.name} verwijderd`, 'success');
          refreshTree();
        } catch (err) { toast(err.message, 'error'); }
      }
    }
  ]);
}

function tableContextMenu(e, dbName, t) {
  const isView = t.type === 'VIEW';
  contextMenu(e.clientX, e.clientY, [
    { label: 'Data bekijken', icon: 'table', onClick: () => openBrowseTab(dbName, t.name, isView) },
    { label: 'Structuur bekijken', icon: 'settings', onClick: () => openStructureTab(dbName, t.name) },
    { label: 'SELECT in query-editor', icon: 'terminal', onClick: () => openSqlTab(dbName, `SELECT * FROM \`${t.name}\` LIMIT 100;`) },
    '-',
    { label: 'Exporteren…', icon: 'download', onClick: () => openExportModal(dbName, t.name) },
    { label: 'CREATE-statement', icon: 'code', onClick: () => showCreateModal(dbName, t.name) },
    '-',
    !isView ? { label: 'Dupliceren…', icon: 'copy', onClick: () => duplicateTableModal(dbName, t) } : null,
    !isView ? { label: 'Hernoemen…', icon: 'edit', onClick: () => renameTableModal(dbName, t) } : null,
    !isView ? {
      label: 'Legen (TRUNCATE)…', icon: 'alert', danger: true, onClick: async () => {
        if (await confirmModal({ title: 'Tabel legen', message: `Alle rijen in <b class="mono">${esc(t.name)}</b> worden verwijderd. Doorgaan?`, confirmText: 'Tabel legen', danger: true })) {
          try {
            await api.truncateTable(dbName, t.name);
            toast('Tabel geleegd', 'success');
            refreshDbNode(dbName);
          } catch (err) { toast(err.message, 'error'); }
        }
      }
    } : null,
    '-',
    {
      label: `${isView ? 'View' : 'Tabel'} verwijderen…`, icon: 'trash', danger: true, onClick: async () => {
        if (await confirmModal({ title: 'Verwijderen', message: `<b class="mono">${esc(t.name)}</b> definitief verwijderen?`, confirmText: 'Verwijderen', danger: true })) {
          try {
            await api.dropTable(dbName, t.name, t.type);
            toast('Verwijderd', 'success');
            refreshDbNode(dbName);
          } catch (err) { toast(err.message, 'error'); }
        }
      }
    }
  ].filter(Boolean));
}

/* ---------- Kleine modals ---------- */
export async function showCreateModal(dbName, tableName) {
  try {
    const r = await api.showCreate(dbName, tableName);
    openSqlViewModal(`CREATE — ${tableName}`, r.sql);
  } catch (err) { toast(err.message, 'error'); }
}

export function openSqlViewModal(title, sql) {
  openModal({
    title,
    body: el('pre', { class: 'code-block', text: sql }),
    wide: true,
    footer: [el('button', { class: 'btn btn-primary', text: 'Kopieer SQL', onclick: () => copyText(sql, 'SQL gekopieerd') })]
  });
}

function renameTableModal(dbName, t) {
  const input = el('input', { type: 'text', value: t.name, spellcheck: 'false' });
  const { close } = openModal({
    title: `Tabel hernoemen — ${t.name}`,
    body: el('div', { class: 'form-group' }, [el('label', { text: 'Nieuwe naam' }), input]),
    footer: [
      el('button', {
        class: 'btn btn-primary', text: 'Hernoemen', onclick: async () => {
          const newName = input.value.trim();
          if (!newName) return;
          try {
            await api.renameTable(dbName, t.name, newName);
            toast('Tabel hernoemd', 'success');
            close();
            refreshDbNode(dbName);
          } catch (err) { toast(err.message, 'error'); }
        }
      })
    ]
  });
}

function duplicateTableModal(dbName, t) {
  const input = el('input', { type: 'text', value: `${t.name}_kopie`, spellcheck: 'false' });
  const dataChk = el('input', { type: 'checkbox', checked: true });
  const { close } = openModal({
    title: `Tabel dupliceren — ${t.name}`,
    body: el('div', {}, [
      el('div', { class: 'form-group' }, [el('label', { text: 'Naam van de kopie' }), input]),
      el('label', { class: 'checkbox' }, [dataChk, el('span', { text: 'Inclusief data' })])
    ]),
    footer: [
      el('button', {
        class: 'btn btn-primary', text: 'Dupliceren', onclick: async () => {
          const newName = input.value.trim();
          if (!newName) return;
          try {
            await api.duplicateTable(dbName, t.name, newName, dataChk.checked);
            toast('Tabel gedupliceerd', 'success');
            close();
            refreshDbNode(dbName);
          } catch (err) { toast(err.message, 'error'); }
        }
      })
    ]
  });
}

/* Vernieuw een databasetak + openstaande tabs van die database */
export async function refreshDbNode(dbName) {
  state.tablesCache.delete(dbName);
  const wasOpen = new Set(openNodes);
  await refreshTree();
  wasOpen.forEach(k => openNodes.add(k));
  renderTree();
  for (const t of state.openTabs) {
    if ((t.kind === 'browse' || t.kind === 'structure' || t.kind === 'database') && t.params.db === dbName) refreshTab(t.id);
  }
}

/* ---------- Filter & refresh-knop ---------- */
export function initSidebar() {
  document.getElementById('tree-filter').addEventListener('input', debounce(renderTree, 200));
  document.getElementById('btn-refresh-tree').addEventListener('click', refreshTree);
}
