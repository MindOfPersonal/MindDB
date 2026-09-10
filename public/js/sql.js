'use strict';

/* ============================================================
   SQL-tab: query-editor (CodeMirror), resultaten, historie
   ============================================================ */
import { api } from './api.js';
import { el, icon, toast, setStatus, fmtNum, fmtMs, esc, copyText, isNumericType } from './util.js';
import { openTab, state, renameTab } from './tabs.js';

let editorCounter = 0;
const HISTORY_KEY = 'minddb.history';

export function openSqlTab(db = null, sql = '') {
  const tab = openTab({
    id: null, // elke SQL-tab is uniek
    title: 'Query',
    icon: 'terminal',
    kind: 'sql',
    params: { db: db || state.currentDb || null, sql },
    render: (pane, t) => renderSql(pane, t)
  });
  return tab;
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function pushHistory(sql, db) {
  const list = loadHistory();
  list.unshift({ sql, db, at: new Date().toISOString() });
  while (list.length > 50) list.pop();
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* vol */ }
}

async function renderSql(pane, tab) {
  const { db, sql } = tab.params;
  editorCounter++;
  const editorId = `cm-${editorCounter}`;

  pane.innerHTML = '';

  /* ---------- Toolbar ---------- */
  const dbSelect = el('select', { style: 'min-width:150px' });
  dbSelect.append(el('option', { value: '', text: '(geen database)' }));
  for (const d of state.databases) {
    dbSelect.append(el('option', { value: d.name, text: d.name, selected: d.name === db ? '' : undefined }));
  }
  dbSelect.addEventListener('change', () => { tab.params.db = dbSelect.value || null; state.currentDb = dbSelect.value || null; });

  const btnRun = el('button', { class: 'btn btn-sm btn-primary', html: `${icon('play')} Uitvoeren`, title: 'Ctrl+Enter' });
  const btnFormat = el('button', { class: 'btn btn-sm btn-ghost', html: `${icon('code')} Format`, title: 'Simpele SQL-opmaak' });
  const btnHistory = el('button', { class: 'btn btn-sm btn-ghost', html: `${icon('history')} Historie` });
  const btnClear = el('button', { class: 'btn btn-sm btn-ghost', html: `${icon('trash')} Leegmaken` });

  const toolbar = el('div', { class: 'toolbar' }, [
    el('span', { class: 'toolbar-title', html: `${icon('terminal')} SQL` }),
    dbSelect,
    el('span', { class: 'sep' }),
    btnRun,
    btnFormat,
    btnHistory,
    btnClear,
    el('span', { class: 'spacer' }),
    el('span', { class: 'text-muted', html: '<kbd>Ctrl</kbd>+<kbd>Enter</kbd> uitvoeren · <kbd>Ctrl</kbd>+<kbd>Spatie</kbd> autocomplete' })
  ]);

  /* ---------- Editor + resultaten ---------- */
  const editorWrap = el('div', { class: 'sql-editor-wrap' });
  const splitter = el('div', { class: 'sql-splitter' });
  const resultsWrap = el('div', { class: 'sql-results' });
  pane.append(toolbar, editorWrap, splitter, resultsWrap);

  resultsWrap.append(el('div', {
    class: 'empty-state',
    html: `${icon('terminal')}<h3>Schrijf een query</h3><p>Meerdere statements gescheiden door <span class="mono">;</span> worden ondersteund. Selecteer een deel van de query om alleen dat deel uit te voeren.</p>`
  }));

  /* CodeMirror initialiseren (vanaf CDN) */
  let cm = null;
  const textarea = el('textarea', { id: editorId, spellcheck: 'false' });
  textarea.value = sql || '';
  editorWrap.append(textarea);

  if (window.CodeMirror) {
    cm = window.CodeMirror.fromTextArea(textarea, {
      mode: 'text/x-mariadb',
      theme: 'material-darker',
      lineNumbers: true,
      indentWithTabs: false,
      smartIndent: true,
      extraKeys: {
        'Ctrl-Enter': () => run(),
        'Ctrl-Space': 'autocomplete'
      }
    });
    cm.setSize('100%', '100%');
    if (!sql) cm.focus();
    buildHintTables();
  }

  async function buildHintTables() {
    if (!cm || !window.CodeMirror) return;
    try {
      const tables = {};
      for (const d of state.databases.slice(0, 20)) {
        const ts = state.tablesCache.get(d.name) || await api.tables(d.name).catch(() => []);
        tables[d.name] = ts.map(t => t.name);
        for (const t of ts) tables[`${d.name}.${t.name}`] = [];
      }
      cm.setOption('hintOptions', { tables });
    } catch { /* hints zijn optioneel */ }
  }

  function getSql() {
    if (!cm) return textarea.value;
    const sel = cm.getSelection();
    return (sel && sel.trim()) ? sel : cm.getValue();
  }

  btnRun.addEventListener('click', run);
  btnClear.addEventListener('click', () => { if (cm) cm.setValue(''); else textarea.value = ''; });
  btnFormat.addEventListener('click', () => {
    const cur = cm ? cm.getValue() : textarea.value;
    const formatted = simpleFormat(cur);
    if (cm) cm.setValue(formatted); else textarea.value = formatted;
  });
  btnHistory.addEventListener('click', showHistory);

  /* Splitter drag */
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = editorWrap.offsetHeight;
    const move = (ev) => {
      const h = Math.max(80, Math.min(pane.offsetHeight - 150, startH + ev.clientY - startY));
      editorWrap.style.height = h + 'px';
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  /* ---------- Uitvoeren ---------- */
  let running = false;
  async function run() {
    if (running) return;
    const sqlText = getSql().trim();
    if (!sqlText) { toast('Geen SQL om uit te voeren', 'info'); return; }
    running = true;
    btnRun.disabled = true;
    btnRun.innerHTML = '<span class="spinner" style="width:13px;height:13px;border-width:2px"></span> Uitvoeren…';
    const t0 = performance.now();
    try {
      const r = await api.query(sqlText, tab.params.db || undefined, 1000);
      pushHistory(sqlText, tab.params.db);
      renderResults(r);
      setStatus(`Query uitgevoerd in ${fmtMs(r.durationMs)}`);
    } catch (err) {
      resultsWrap.innerHTML = '';
      resultsWrap.append(el('div', { class: 'empty-state', html: `${icon('alert')}<h3>Query mislukt</h3><p class="mono" style="max-width:700px">${esc(err.message)}${err.code ? ` · ${esc(err.code)}` : ''}</p>` }));
      setStatus('Query mislukt');
    } finally {
      running = false;
      btnRun.disabled = false;
      btnRun.innerHTML = `${icon('play')} Uitvoeren`;
    }
  }

  function renderResults(r) {
    resultsWrap.innerHTML = '';
    const bar = el('div', { class: 'sql-results-bar' }, [
      el('span', { html: `${icon('clock')} ${fmtMs(r.durationMs)}` }),
      el('span', { class: 'text-muted', text: `${r.results.length} resultaatset(s)` })
    ]);
    const pills = el('span', { style: 'display:flex;gap:6px;flex-wrap:wrap' });
    const bodyWrap = el('div', { style: 'position:relative' });
    resultsWrap.append(bar, bodyWrap);

    let activeResult = 0;
    function show(i) {
      activeResult = i;
      pills.querySelectorAll('.result-pill').forEach((p, j) => p.classList.toggle('active', j === i));
      bodyWrap.innerHTML = '';
      const res = r.results[i];
      if (res.type === 'ok') {
        bodyWrap.append(el('div', { class: 'empty-state', html: `${icon('check')}<h3 class="text-green">Uitgevoerd</h3><p>${res.affectedRows} rij(en) aangepast${res.insertId && res.insertId !== '0' ? ` · insert id ${esc(res.insertId)}` : ''}${res.info ? '<br>' + esc(res.info) : ''}</p>` }));
      } else {
        if (res.truncated) {
          bodyWrap.append(el('div', { class: 'sql-results-bar', html: `<span class="text-amber">${icon('alert')} Alleen de eerste ${fmtNum(res.rows.length)} van ${fmtNum(res.rowCount)} rijen worden getoond</span>` }));
        }
        bodyWrap.append(resultTable(res));
      }
      pills.childNodes.forEach((p, j) => p.classList.toggle('active', j === i));
    }

    r.results.forEach((res, i) => {
      const label = res.type === 'ok' ? `✓ ${res.affectedRows}` : `${res.rowCount} rijen`;
      const pill = el('span', { class: `result-pill${i === 0 ? ' active' : ''}`, text: `#${i + 1} · ${label}` });
      pill.addEventListener('click', () => show(i));
      pills.append(pill);
    });
    bar.append(pills, el('span', { class: 'spacer' }));
    const firstRows = r.results.find(x => x.type === 'rows');
    if (firstRows) {
      bar.append(el('button', { class: 'btn btn-sm btn-ghost', html: `${icon('copy')} Kopieer CSV`, onclick: () => copyText(toCsv(r.results[activeResult].columns, r.results[activeResult].rows), 'CSV gekopieerd') }));
    }
    show(0);
  }

  function resultTable(res) {
    const tbl = el('table', { class: 'grid' });
    const headRow = el('tr');
    headRow.append(el('th', { class: 'rownum', text: '#' }));
    for (const c of res.columns) headRow.append(el('th', { text: c }));
    tbl.append(el('thead', {}, [headRow]));
    const tbody = el('tbody');
    res.rows.forEach((row, i) => {
      const tr = el('tr');
      tr.append(el('td', { class: 'rownum', text: String(i + 1) }));
      for (const c of res.columns) {
        const v = row[c];
        const isNum = typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v));
        tr.append(el('td', {
          class: `${v === null ? 'null' : ''} ${isNum && v !== null ? 'num' : ''}`.trim(),
          text: v === null ? 'NULL' : (typeof v === 'object' ? JSON.stringify(v) : String(v)),
          title: v !== null && String(v).length > 120 ? String(v).slice(0, 2000) : undefined
        }));
      }
      tbody.append(tr);
    });
    tbl.append(tbody);
    return tbl;
  }

  function toCsv(cols, rows) {
    const escCsv = v => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(','), ...rows.map(r => cols.map(c => escCsv(r[c])).join(','))].join('\n');
  }

  function simpleFormat(s) {
    const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'JOIN', 'ON', 'UNION', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE'];
    let out = ' ' + s.replace(/\s+/g, ' ').trim();
    for (const kw of keywords) {
      out = out.replace(new RegExp(`\\s${kw.replace(' ', '\\s')}\\s`, 'gi'), `\n${kw} `);
    }
    return out.trim();
  }

  function showHistory() {
    import('./util.js').then(({ openModal }) => {
      const list = loadHistory();
      const body = el('div', {});
      if (!list.length) {
        body.append(el('p', { class: 'text-muted', text: 'Nog geen queries uitgevoerd.' }));
      }
      for (const h of list) {
        const item = el('div', { class: 'profile-item', style: 'margin-bottom:7px' }, [
          el('div', { class: 'profile-meta' }, [
            el('div', { class: 'mono', text: h.sql.length > 120 ? h.sql.slice(0, 120) + '…' : h.sql, style: 'font-size:12px' }),
            el('div', { class: 'profile-sub', text: `${h.db || '(geen db)'} · ${new Date(h.at).toLocaleString('nl-NL')}` })
          ])
        ]);
        item.addEventListener('click', () => {
          if (cm) cm.setValue(h.sql); else textarea.value = h.sql;
          if (h.db) { dbSelect.value = h.db; tab.params.db = h.db; }
          close();
        });
        body.append(item);
      }
      const { close } = openModal({ title: 'Query-historie', body, wide: true });
    });
  }

  renameTab(tab.id, tab.params.db ? `Query · ${tab.params.db}` : 'Query');
}
