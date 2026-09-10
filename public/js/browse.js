'use strict';

/* ============================================================
   Data-browser: tabeldata bekijken, filteren, sorteren,
   inline bewerken, rijen toevoegen/verwijderen
   ============================================================ */
import { api } from './api.js';
import { el, icon, toast, setStatus, fmtNum, esc, isNumericType, copyText } from './util.js';
import { openTab } from './tabs.js';
import { openStructureTab } from './structure.js';
import { openExportModal } from './actions.js';

export function openBrowseTab(db, table, isView = false) {
  openTab({
    id: `browse:${db}.${table}`,
    title: `${table}`,
    icon: isView ? 'view' : 'table',
    kind: 'browse',
    params: { db, table, isView },
    render: (pane, tab) => renderBrowse(pane, tab)
  });
}

async function renderBrowse(pane, tab) {
  const { db, table, isView } = tab.params;
  const st = {
    page: 1, pageSize: 50, sort: null, dir: 'ASC', where: '',
    columns: [], rows: [], total: 0, selected: new Set(),
    dirty: new Map() // rowIdx -> Map(col -> value)
  };

  pane.innerHTML = '';

  /* ---------- Toolbar ---------- */
  const filterInput = el('input', {
    class: 'filter-input', type: 'text', spellcheck: 'false',
    placeholder: 'WHERE-voorwaarde, bv.  status = "actief" AND id > 10',
    value: st.where
  });
  filterInput.title = 'Voer een WHERE-conditie in (zonder het woord WHERE) en druk op Enter';
  filterInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { st.where = filterInput.value.trim(); st.page = 1; load(); }
    if (e.key === 'Escape') { filterInput.value = ''; st.where = ''; st.page = 1; load(); }
  });

  const btnInsert = el('button', { class: 'btn btn-sm', html: `${icon('plus')} Rij toevoegen`, onclick: () => insertRowModal() });
  const btnDelete = el('button', { class: 'btn btn-sm btn-danger', html: `${icon('trash')} Verwijderen`, disabled: true, onclick: () => deleteSelected() });
  const btnSave = el('button', { class: 'btn btn-sm btn-primary', html: `${icon('check')} Wijzigingen opslaan`, disabled: true, onclick: () => saveChanges() });
  const btnStruct = el('button', { class: 'btn btn-sm btn-ghost', html: `${icon('settings')} Structuur`, onclick: () => openStructureTab(db, table) });
  const btnExport = el('button', { class: 'btn btn-sm btn-ghost', html: `${icon('download')} Export`, onclick: () => openExportModal(db, table) });

  const toolbar = el('div', { class: 'toolbar' }, [
    el('span', { class: 'toolbar-title', html: `${icon(isView ? 'view' : 'table')} ${esc(db)}.<b>${esc(table)}</b>` }),
    el('button', { class: 'icon-btn', html: icon('refresh'), title: 'Verversen', onclick: () => load() }),
    el('span', { class: 'sep' }),
    filterInput,
    el('span', { class: 'spacer' }),
    ...(isView ? [btnExport] : [btnInsert, btnDelete, btnSave, el('span', { class: 'sep' }), btnStruct, btnExport])
  ]);

  /* ---------- Grid + pager ---------- */
  const gridWrap = el('div', { class: 'grid-wrap' });
  const pager = el('div', { class: 'pager' });
  pane.append(toolbar, gridWrap, pager);

  const pkColumns = () => st.columns.filter(c => c.key === 'PRI').map(c => c.name);

  async function load() {
    gridWrap.innerHTML = '';
    const spinner = el('div', { class: 'loading-overlay' }, [el('div', { class: 'spinner' })]);
    gridWrap.append(spinner);
    try {
      const data = await api.rows(db, table, {
        page: st.page, pageSize: st.pageSize,
        sort: st.sort || undefined, dir: st.dir, where: st.where || undefined
      });
      st.columns = data.columns;
      st.rows = data.rows;
      st.total = data.total;
      st.selected.clear();
      st.dirty.clear();
      renderGrid();
      renderPager();
      setStatus(`${fmtNum(st.total)} rijen in ${db}.${table}`);
    } catch (err) {
      gridWrap.innerHTML = '';
      gridWrap.append(el('div', { class: 'empty-state', html: `${icon('alert')}<h3>Fout bij laden</h3><p class="mono">${esc(err.message)}</p>` }));
      setStatus('');
    }
  }

  function renderGrid() {
    gridWrap.innerHTML = '';
    btnDelete.disabled = st.selected.size === 0 || isView;
    updateSaveBtn();

    if (!st.rows.length) {
      gridWrap.append(el('div', { class: 'empty-state', html: `${icon('search')}<h3>Geen rijen</h3><p>${st.where ? 'Geen resultaten voor deze filter. Pas de WHERE-voorwaarde aan.' : 'Deze tabel is leeg.'}</p>` }));
      return;
    }

    const tableEl = el('table', { class: 'grid' });
    const thead = el('thead');
    const headRow = el('tr');
    headRow.append(el('th', { class: 'rownum', text: '#' }));
    for (const col of st.columns) {
      const th = el('th', { class: col.key === 'PRI' ? 'pk' : '' });
      const inner = el('span', { class: 'th-inner' }, [
        el('span', { class: 'col-name', text: col.name }),
        el('span', { class: 'col-type', text: shortType(col.columnType) }),
        st.sort === col.name ? el('span', { class: 'sort-ind', text: st.dir === 'ASC' ? '▲' : '▼' }) : null
      ]);
      th.append(inner);
      th.title = `${col.name} · ${col.columnType}${col.isNullable === 'YES' ? ' · NULL' : ' · NOT NULL'} — klik om te sorteren`;
      th.addEventListener('click', () => {
        if (st.sort === col.name) {
          st.dir = st.dir === 'ASC' ? 'DESC' : 'ASC';
        } else { st.sort = col.name; st.dir = 'ASC'; }
        load();
      });
      headRow.append(th);
    }
    thead.append(headRow);

    const tbody = el('tbody');
    st.rows.forEach((row, idx) => {
      const tr = el('tr');
      const rowNum = el('td', { class: 'rownum', text: String((st.page - 1) * st.pageSize + idx + 1) });
      tr.append(rowNum);
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.cell-val') || e.target.closest('input') || isView) return;
        if (st.selected.has(idx)) st.selected.delete(idx); else st.selected.add(idx);
        tr.classList.toggle('selected');
        btnDelete.disabled = st.selected.size === 0;
      });

      for (const col of st.columns) {
        const val = displayValue(row, col, idx);
        const td = el('td', {
          class: [val === null ? 'null' : '', isNumericType(col.dataType) ? 'num' : '', dirtyClass(idx, col.name)].join(' ').trim()
        });
        const span = el('span', { class: 'cell-val', text: formatCell(val) });
        if (val !== null && String(val).length > 120) span.title = String(val).slice(0, 2000);
        td.append(span);
        if (!isView) {
          td.addEventListener('dblclick', () => startEdit(td, idx, col));
          td.title = 'Dubbelklik om te bewerken';
        }
        tr.append(td);
      }
      tbody.append(tr);
    });
    tableEl.append(thead, tbody);
    gridWrap.append(tableEl);
  }

  function displayValue(row, col, idx) {
    const changes = st.dirty.get(idx);
    if (changes && changes.has(col.name)) return changes.get(col.name);
    return row[col.name];
  }
  function dirtyClass(idx, col) {
    const changes = st.dirty.get(idx);
    return changes && changes.has(col) ? 'modified' : '';
  }
  function updateSaveBtn() {
    let count = 0;
    st.dirty.forEach(m => count += m.size);
    btnSave.disabled = count === 0;
    btnSave.innerHTML = `${icon('check')} Wijzigingen opslaan${count ? ` (${count})` : ''}`;
  }

  function startEdit(td, idx, col) {
    if (td.classList.contains('editing')) return;
    const current = displayValue(st.rows[idx], col, idx);
    td.classList.add('editing');
    td.innerHTML = '';
    const input = el('input', { type: 'text', value: current === null ? '' : String(current) });
    input.placeholder = 'NULL';
    td.append(input);
    input.focus();
    input.select();

    let done = false;
    const commit = () => {
      if (done) return; done = true;
      let newVal = input.value;
      if (newVal === '' && (current === null || col.isNullable === 'YES')) newVal = null;
      td.classList.remove('editing');
      if (newVal === current || (newVal === null && current === null)) { renderGrid(); return; }
      if (!st.dirty.has(idx)) st.dirty.set(idx, new Map());
      st.dirty.get(idx).set(col.name, newVal);
      renderGrid();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { commit(); }
      if (e.key === 'Escape') { done = true; renderGrid(); }
    });
  }

  function pkWhere(row) {
    const pk = pkColumns();
    if (!pk.length) return null;
    const where = {};
    for (const k of pk) where[k] = row[k];
    return where;
  }

  async function saveChanges() {
    const errors = [];
    let saved = 0;
    for (const [idx, changes] of st.dirty) {
      const row = st.rows[idx];
      let where = pkWhere(row);
      if (!where) {
        // Geen PK: gebruik originele rijwaarden als identiteit
        where = {};
        for (const c of st.columns) where[c.name] = row[c.name];
      }
      const data = {};
      changes.forEach((v, k) => data[k] = v);
      try {
        await api.updateRow(db, table, data, where);
        changes.forEach((v, k) => row[k] = v);
        saved++;
      } catch (err) {
        errors.push(`Rij ${idx + 1}: ${err.message}`);
      }
    }
    st.dirty.clear();
    renderGrid();
    if (errors.length) toast(errors.join(' · '), 'error', 8000);
    if (saved) toast(`${saved} rij(en) bijgewerkt`, 'success');
  }

  async function deleteSelected() {
    const idxs = [...st.selected];
    const { confirmModal } = await import('./util.js');
    const ok = await confirmModal({
      title: 'Rijen verwijderen',
      message: `Weet je zeker dat je <b>${idxs.length}</b> rij(en) wilt verwijderen uit <b class="mono">${esc(table)}</b>?`,
      confirmText: 'Verwijderen', danger: true
    });
    if (!ok) return;
    let deleted = 0; const errors = [];
    for (const idx of idxs) {
      const row = st.rows[idx];
      const where = pkWhere(row) || Object.fromEntries(st.columns.map(c => [c.name, row[c.name]]));
      try {
        await api.deleteRow(db, table, where);
        deleted++;
      } catch (err) { errors.push(err.message); }
    }
    if (deleted) toast(`${deleted} rij(en) verwijderd`, 'success');
    if (errors.length) toast(errors[0], 'error');
    load();
  }

  /* ---------- Rij invoegen ---------- */
  function insertRowModal() {
    import('./util.js').then(({ openModal }) => {
      const inputs = new Map();
      const grid = el('div', {});
      for (const col of st.columns) {
        const input = el('input', {
          type: 'text', spellcheck: 'false',
          placeholder: `${col.columnType}${col.extra.includes('auto_increment') ? ' · AUTO_INCREMENT (leeg = auto)' : col.isNullable === 'YES' ? ' · NULL toegestaan' : ''}`
        });
        if (col.defaultValue !== null && col.defaultValue !== undefined) input.value = String(col.defaultValue);
        inputs.set(col.name, { input, col });
        grid.append(el('div', { class: 'form-group', style: 'margin-bottom:10px' }, [
          el('label', { html: `${esc(col.name)} <span class="label-hint mono">${esc(shortType(col.columnType))}</span>` }),
          input
        ]));
      }
      const { close } = openModal({
        title: `Nieuwe rij — ${table}`,
        body: grid,
        wide: false,
        footer: [
          el('button', {
            class: 'btn btn-primary', html: `${icon('plus')} Invoegen`, onclick: async () => {
              const data = {};
              for (const [name, { input, col }] of inputs) {
                const v = input.value;
                if (v === '' && (col.extra.includes('auto_increment') || col.isNullable === 'YES')) continue;
                data[name] = v === '' ? null : v;
              }
              try {
                await api.insertRow(db, table, data);
                toast('Rij toegevoegd', 'success');
                close();
                load();
              } catch (err) { toast(err.message, 'error', 7000); }
            }
          })
        ]
      });
    });
  }

  /* ---------- Pager ---------- */
  function renderPager() {
    const pages = Math.max(1, Math.ceil(st.total / st.pageSize));
    pager.innerHTML = '';
    const sizeSel = el('select', {}, [25, 50, 100, 250, 500].map(n =>
      el('option', { value: n, text: `${n} / pagina`, selected: n === st.pageSize ? '' : undefined })));
    sizeSel.addEventListener('change', () => { st.pageSize = parseInt(sizeSel.value); st.page = 1; load(); });

    const btnPrev = el('button', { class: 'btn btn-sm', text: '‹ Vorige', disabled: st.page <= 1, onclick: () => { st.page--; load(); } });
    const btnNext = el('button', { class: 'btn btn-sm', text: 'Volgende ›', disabled: st.page >= pages, onclick: () => { st.page++; load(); } });
    const pageInput = el('input', { type: 'number', value: st.page, min: 1, max: pages, style: 'width:70px;padding:5px 8px;font-size:12.5px' });
    pageInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { st.page = Math.min(pages, Math.max(1, parseInt(pageInput.value) || 1)); load(); }
    });

    pager.append(
      sizeSel,
      el('span', { class: 'pager-info', html: `<b>${fmtNum(st.total)}</b> rijen` }),
      el('span', { class: 'spacer' }),
      btnPrev,
      el('span', { html: `Pagina ` }),
      pageInput,
      el('span', { text: `van ${fmtNum(pages)}` }),
      btnNext
    );
  }

  function formatCell(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  function shortType(t) {
    return String(t || '').replace(/unsigned/g, 'u').replace(/zerofill/g, 'z').trim();
  }

  await load();
}
