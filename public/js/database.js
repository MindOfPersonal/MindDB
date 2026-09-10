'use strict';

/* ============================================================
   Database-overzicht in het hoofdscherm
   ============================================================ */
import { api } from './api.js';
import { el, icon, esc, fmtBytes, fmtNum, copyText, setStatus } from './util.js';
import { openTab, refreshTab } from './tabs.js';
import { openBrowseTab } from './browse.js';
import { openStructureTab } from './structure.js';
import { openSqlTab } from './sql.js';
import { openCreateTableModal, openExportModal, openImportModal } from './actions.js';
import { openDatabasePrivilegesModal } from './privileges.js';

export function openDatabaseTab(dbName) {
  openTab({
    id: `db:${dbName}`,
    title: dbName,
    icon: 'database',
    kind: 'database',
    params: { db: dbName },
    render: (pane, tab) => renderDatabase(pane, tab)
  });
}

async function renderDatabase(pane, tab) {
  const { db } = tab.params;
  pane.innerHTML = '';

  const statsWrap = el('div', { class: 'db-tiles' });
  const listWrap = el('div', { class: 'db-table-wrap' });
  const search = el('input', { class: 'filter-input', type: 'text', placeholder: 'Zoek tabel…', spellcheck: 'false' });
  let allTables = [];

  const body = el('div', { class: 'pane-body db-overview' });

  const toolbar = el('div', { class: 'toolbar' }, [
    el('span', { class: 'toolbar-title', html: `${icon('database')} <span class="mono">${esc(db)}</span>` }),
    el('button', { class: 'icon-btn', html: icon('refresh'), title: 'Verversen', onclick: () => refreshTab(tab.id) }),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn btn-sm btn-primary', html: `${icon('plus')} Nieuwe tabel`, onclick: () => openCreateTableModal(db, () => refreshTab(tab.id)) }),
    el('button', { class: 'btn btn-sm', html: `${icon('terminal')} SQL`, onclick: () => openSqlTab(db) }),
    el('button', { class: 'btn btn-sm', html: `${icon('download')} Export`, onclick: () => openExportModal(db) }),
    el('button', { class: 'btn btn-sm', html: `${icon('upload')} Import`, onclick: () => openImportModal(db) }),
    el('button', { class: 'btn btn-sm', html: `${icon('shield')} Rechten`, onclick: () => openDatabasePrivilegesModal(db) })
  ]);

  const listToolbar = el('div', { class: 'db-list-toolbar' }, [
    el('span', { class: 'section-title', style: 'margin:0', html: `${icon('table')} Objecten` }),
    el('span', { class: 'spacer' }),
    search
  ]);

  pane.append(toolbar, body);
  body.append(statsWrap, listToolbar, listWrap);
  search.addEventListener('input', () => renderList(search.value.trim().toLowerCase()));

  async function load() {
    body.querySelectorAll('.loading-overlay').forEach(n => n.remove());
    const spin = el('div', { class: 'loading-overlay' }, [el('div', { class: 'spinner' })]);
    listWrap.innerHTML = '';
    listWrap.append(spin);
    let tables, objects, dbs;
    try {
      [tables, objects, dbs] = await Promise.all([
        api.tables(db),
        api.objects(db).catch(() => ({ routines: [], triggers: [], events: [], views: [] })),
        api.databases().catch(() => [])
      ]);
    } catch (err) {
      listWrap.innerHTML = '';
      listWrap.append(el('div', { class: 'empty-state', html: `${icon('alert')}<h3>Fout</h3><p class="mono">${esc(err.message)}</p>` }));
      return;
    }
    allTables = tables;
    const meta = dbs.find(d => d.name === db) || {};
    renderHero(meta, tables, objects);
    renderStats(meta, tables);
    renderList('');
    setStatus(`${fmtNum(tables.length)} objecten in ${db}`);
  }

  function renderHero(meta, tables, objects) {
    const views = tables.filter(t => t.type === 'VIEW').length;
    const routines = objects.routines.length;
    const hero = el('div', { class: 'db-hero' }, [
      el('div', { class: 'db-hero-icon', html: icon('database') }),
      el('div', { class: 'db-hero-main' }, [
        el('h2', { text: db }),
        el('div', { class: 'db-hero-meta' }, [
          meta.charset ? el('span', { class: 'tag idx', text: meta.charset }) : null,
          meta.collation ? el('span', { class: 'tag', text: meta.collation }) : null,
          el('span', { class: 'tag nn', html: `${fmtNum(tables.length)} objecten` }),
          views ? el('span', { class: 'tag view', html: `${fmtNum(views)} views` }) : null,
          routines ? el('span', { class: 'tag ai', html: `${fmtNum(routines)} routines` }) : null
        ])
      ])
    ]);
    const existing = body.querySelector('.db-hero');
    if (existing) existing.replaceWith(hero); else body.prepend(hero);
  }

  function renderStats(meta, tables) {
    statsWrap.innerHTML = '';
    const views = tables.filter(t => t.type === 'VIEW').length;
    const base = tables.length - views;
    const cards = [
      { label: 'Tabellen', value: fmtNum(base), sub: `${fmtNum(views)} views`, iconName: 'table', color: 'var(--cyan)' },
      { label: 'Totale grootte', value: fmtBytes(meta.size || 0), sub: 'data + index', iconName: 'layers', color: 'var(--accent)' },
      { label: 'Geschatte rijen', value: fmtNum(tables.reduce((s, t) => s + (t.rows || 0), 0)), sub: 'alle tabellen', iconName: 'list', color: 'var(--green)' },
      { label: 'Engine', value: [...new Set(tables.map(t => t.engine).filter(Boolean))].join(', ') || '—', sub: meta.collation || '', iconName: 'cpu', color: 'var(--amber)', small: true }
    ];
    for (const c of cards) {
      statsWrap.append(el('div', { class: 'stat-card' }, [
        el('div', { class: 'stat-icon', style: `background:color-mix(in srgb, ${c.color} 14%, transparent);color:${c.color}`, html: icon(c.iconName) }),
        el('div', { class: 'stat-label', text: c.label }),
        el('div', { class: 'stat-value', style: c.small ? 'font-size:16px;padding-top:4px' : '', text: c.value }),
        el('div', { class: 'stat-sub', text: c.sub })
      ]));
    }
  }

  function renderList(query) {
    listWrap.innerHTML = '';
    let rows = allTables;
    if (query) rows = rows.filter(t => t.name.toLowerCase().includes(query));
    if (!rows.length) {
      listWrap.append(el('div', { class: 'empty-state', html: `${icon('search')}<h3>Geen objecten</h3><p>${query ? 'Geen resultaten voor deze zoekopdracht.' : 'Deze database is leeg.'}</p>` }));
      return;
    }
    const tbl = el('table', { class: 'def db-table' });
    tbl.append(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Naam' }), el('th', { text: 'Type' }), el('th', { text: 'Engine' }),
      el('th', { style: 'text-align:right', text: 'Rijen' }), el('th', { style: 'text-align:right', text: 'Grootte' }),
      el('th', { text: 'Collatie' }), el('th', { text: 'Bijgewerkt' }), el('th', { text: '' })
    ])]));
    const tbody = el('tbody');
    for (const t of rows) {
      const isView = t.type === 'VIEW';
      const tr = el('tr', { class: 'db-row' }, [
        el('td', {}, [el('span', { class: `node-icon ${isView ? 'view' : 'tbl'}`, style: 'display:inline-flex;vertical-align:-2px;margin-right:8px', html: icon(isView ? 'view' : 'table') }),
          el('span', { class: 'mono', html: `<b>${esc(t.name)}</b>` })]),
        el('td', { html: isView ? '<span class="tag view">VIEW</span>' : '<span class="tag">BASE TABLE</span>' }),
        el('td', { class: 'text-muted', text: t.engine || '' }),
        el('td', { class: 'mono', style: 'text-align:right', text: t.rows === null || t.rows === undefined ? '—' : fmtNum(t.rows) }),
        el('td', { class: 'mono', style: 'text-align:right', text: fmtBytes(t.size || 0) }),
        el('td', { class: 'text-muted', text: t.collation || '' }),
        el('td', { class: 'text-muted', text: t.updated ? new Date(t.updated).toLocaleString('nl-NL') : '—' }),
        el('td', { class: 'db-row-actions', style: 'text-align:right;white-space:nowrap' }, [
          el('button', { class: 'icon-btn', html: icon('table'), title: 'Data bekijken', onclick: (e) => { e.stopPropagation(); openBrowseTab(db, t.name, isView); } }),
          !isView ? el('button', { class: 'icon-btn', html: icon('settings'), title: 'Structuur', onclick: (e) => { e.stopPropagation(); openStructureTab(db, t.name); } }) : null,
          el('button', { class: 'icon-btn', html: icon('terminal'), title: 'SELECT uitvoeren', onclick: (e) => { e.stopPropagation(); openSqlTab(db, `SELECT * FROM \`${t.name}\` LIMIT 100;`); } }),
          el('button', { class: 'icon-btn', html: icon('download'), title: 'Exporteren', onclick: (e) => { e.stopPropagation(); openExportModal(db, t.name); } }),
          el('button', { class: 'icon-btn', html: icon('copy'), title: 'Naam kopiëren', onclick: (e) => { e.stopPropagation(); copyText(t.name); } })
        ])
      ]);
      tr.addEventListener('click', () => openBrowseTab(db, t.name, isView));
      tbody.append(tr);
    }
    tbl.append(tbody);
    listWrap.append(tbl);
  }

  await load();
}
