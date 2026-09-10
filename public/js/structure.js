'use strict';

/* ============================================================
   Structuur-tab: kolommen, indexen, foreign keys, DDL
   ============================================================ */
import { api } from './api.js';
import { el, icon, toast, openModal, confirmModal, copyText, esc } from './util.js';
import { openTab, refreshTab } from './tabs.js';
import { refreshDbNode } from './sidebar.js';
import { openBrowseTab } from './browse.js';

const MYSQL_TYPES = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  'DECIMAL(10,2)', 'FLOAT', 'DOUBLE',
  'VARCHAR(255)', 'CHAR(10)', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'JSON', 'BLOB', 'LONGBLOB', 'ENUM', 'SET', 'BOOLEAN'
];

export function openStructureTab(db, table) {
  openTab({
    id: `structure:${db}.${table}`,
    title: `${table} · structuur`,
    icon: 'settings',
    kind: 'structure',
    params: { db, table },
    render: (pane, tab) => renderStructure(pane, tab)
  });
}

async function renderStructure(pane, tab) {
  const { db, table } = tab.params;
  pane.innerHTML = '';

  const toolbar = el('div', { class: 'toolbar' }, [
    el('span', { class: 'toolbar-title', html: `${icon('settings')} ${esc(db)}.<b>${esc(table)}</b>` }),
    el('button', { class: 'icon-btn', html: icon('refresh'), title: 'Verversen', onclick: () => refreshTab(tab.id) }),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn btn-sm btn-ghost', html: `${icon('table')} Data`, onclick: () => openBrowseTab(db, table) }),
    el('button', { class: 'btn btn-sm btn-ghost', html: `${icon('code')} CREATE-statement`, onclick: () => showDdl() })
  ]);

  const subtabs = el('div', { class: 'subtabs' });
  const body = el('div', { class: 'pane-body' });
  pane.append(toolbar, subtabs, body);

  const views = [
    { id: 'columns', label: 'Kolommen', render: renderColumns },
    { id: 'indexes', label: 'Indexen', render: renderIndexes },
    { id: 'fks', label: 'Foreign keys', render: renderFks },
    { id: 'ddl', label: 'DDL', render: renderDdl }
  ];
  let active = 'columns';

  function renderSubtabs() {
    subtabs.innerHTML = '';
    for (const v of views) {
      const btn = el('button', { class: `subtab${v.id === active ? ' active' : ''}`, text: v.label });
      btn.addEventListener('click', () => { active = v.id; renderSubtabs(); load(); });
      subtabs.append(btn);
    }
  }

  async function load() {
    body.innerHTML = '';
    const spin = el('div', { class: 'loading-overlay' }, [el('div', { class: 'spinner' })]);
    body.append(spin);
    try {
      await views.find(v => v.id === active).render();
    } catch (err) {
      body.innerHTML = '';
      body.append(el('div', { class: 'empty-state', html: `${icon('alert')}<h3>Fout</h3><p>${esc(err.message)}</p>` }));
    }
  }

  async function showDdl() {
    try {
      const r = await api.showCreate(db, table);
      openModal({
        title: `CREATE — ${table}`,
        body: el('pre', { class: 'code-block', text: r.sql }),
        wide: true,
        footer: [el('button', { class: 'btn btn-primary', text: 'Kopieer SQL', onclick: () => copyText(r.sql, 'SQL gekopieerd') })]
      });
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ==================== Kolommen ==================== */
  async function renderColumns() {
    const cols = await api.columns(db, table);
    body.innerHTML = '';

    const bar = el('div', { class: 'toolbar', style: 'border-bottom:none;border-top:1px solid var(--border)' }, [
      el('button', { class: 'btn btn-sm', html: `${icon('plus')} Kolom toevoegen`, onclick: () => columnModal(null, cols) })
    ]);

    const tbl = el('table', { class: 'def' });
    tbl.append(el('thead', {}, [el('tr', {}, [
      el('th', { text: '#' }), el('th', { text: 'Naam' }), el('th', { text: 'Type' }),
      el('th', { text: 'NULL' }), el('th', { text: 'Standaardwaarde' }), el('th', { text: 'Eigenschappen' }),
      el('th', { text: 'Collatie' }), el('th', { text: 'Opmerking' }), el('th', { text: '' })
    ])]));
    const tbody = el('tbody');
    for (const c of cols) {
      const tags = [];
      if (c.key === 'PRI') tags.push('<span class="tag pk">PRIMARY</span>');
      if (c.key === 'UNI') tags.push('<span class="tag uniq">UNIQUE</span>');
      if (c.key === 'MUL') tags.push('<span class="tag idx">INDEX</span>');
      if (c.isNullable === 'NO') tags.push('<span class="tag nn">NOT NULL</span>');
      if (c.extra.includes('auto_increment')) tags.push('<span class="tag ai">AUTO_INCREMENT</span>');
      if (c.extra.includes('on update')) tags.push(`<span class="tag">${esc(c.extra)}</span>`);
      const tr = el('tr', {}, [
        el('td', { class: 'text-muted', text: c.position }),
        el('td', { class: 'mono', html: `<b>${esc(c.name)}</b>` }),
        el('td', { class: 'mono text-cyan', text: c.columnType }),
        el('td', { text: c.isNullable === 'YES' ? 'Ja' : 'Nee' }),
        el('td', { class: 'mono', text: c.defaultValue === null ? (c.isNullable === 'YES' ? 'NULL' : '') : String(c.defaultValue) }),
        el('td', { html: tags.join(' ') }),
        el('td', { class: 'text-muted', text: c.collation || '' }),
        el('td', { class: 'text-muted', text: c.comment || '' }),
        el('td', { style: 'white-space:nowrap;text-align:right' }, [
          el('button', { class: 'icon-btn', html: icon('edit'), title: 'Wijzigen', onclick: () => columnModal(c, cols) }),
          el('button', {
            class: 'icon-btn danger', html: icon('trash'), title: 'Verwijderen', onclick: async () => {
              if (await confirmModal({ title: 'Kolom verwijderen', message: `Kolom <b class="mono">${esc(c.name)}</b> verwijderen uit <b class="mono">${esc(table)}</b>? Data in deze kolom gaat verloren.`, confirmText: 'Verwijderen', danger: true })) {
                try {
                  await api.dropColumn(db, table, c.name);
                  toast('Kolom verwijderd', 'success');
                  refreshTab(tab.id);
                } catch (err) { toast(err.message, 'error', 7000); }
              }
            }
          })
        ])
      ]);
      tbody.append(tr);
    }
    tbl.append(tbody);
    body.append(tbl, bar);
  }

  function columnModal(existing, allCols) {
    const isEdit = !!existing;
    const nameInput = el('input', { type: 'text', value: existing?.name || '', spellcheck: 'false' });
    const typeInput = el('input', { type: 'text', value: existing?.columnType || 'VARCHAR(255)', list: 'mysql-types', spellcheck: 'false' });
    const datalist = el('datalist', { id: 'mysql-types' }, MYSQL_TYPES.map(t => el('option', { value: t })));
    const nullChk = el('input', { type: 'checkbox' });
    nullChk.checked = existing ? existing.isNullable === 'YES' : true;
    const defaultInput = el('input', { type: 'text', value: existing?.defaultValue ?? '', spellcheck: 'false', placeholder: 'bv. 0, CURRENT_TIMESTAMP of tekst' });
    const aiChk = el('input', { type: 'checkbox' });
    aiChk.checked = existing ? existing.extra.includes('auto_increment') : false;
    const pkChk = el('input', { type: 'checkbox' });
    pkChk.checked = existing ? existing.key === 'PRI' : false;
    const commentInput = el('input', { type: 'text', value: existing?.comment || '', spellcheck: 'false' });
    const afterSel = el('select', {}, [el('option', { value: '', text: '— Helemaal achteraan —' }),
      ...allCols.filter(c => c.name !== existing?.name).map(c => el('option', { value: c.name, text: `Na ${c.name}` }))]);

    const body = el('div', {}, [
      datalist,
      el('div', { class: 'form-row-2' }, [
        el('div', { class: 'form-group', style: 'flex:2' }, [el('label', { text: 'Naam' }), nameInput]),
        el('div', { class: 'form-group', style: 'flex:3' }, [el('label', { text: 'Type' }), typeInput])
      ]),
      el('div', { class: 'form-row-2' }, [
        el('div', { class: 'form-group' }, [el('label', { text: 'Standaardwaarde' }), defaultInput]),
        el('div', { class: 'form-group' }, [el('label', { text: 'Opmerking' }), commentInput])
      ]),
      el('div', { class: 'form-row-2', style: 'margin-bottom:14px' }, [
        el('label', { class: 'checkbox' }, [nullChk, el('span', { text: 'NULL toegestaan' })]),
        el('label', { class: 'checkbox' }, [aiChk, el('span', { text: 'AUTO_INCREMENT' })]),
        el('label', { class: 'checkbox' }, [pkChk, el('span', { text: 'Primaire sleutel' })])
      ]),
      isEdit ? '' : el('div', { class: 'form-group' }, [el('label', { text: 'Positie' }), afterSel])
    ]);

    const { close } = openModal({
      title: isEdit ? `Kolom wijzigen — ${existing.name}` : `Kolom toevoegen — ${table}`,
      body,
      footer: [
        el('button', {
          class: 'btn btn-primary', text: isEdit ? 'Opslaan' : 'Toevoegen', onclick: async () => {
            const payload = {
              name: nameInput.value.trim(),
              type: typeInput.value.trim() || 'VARCHAR(255)',
              nullable: nullChk.checked,
              defaultValue: defaultInput.value,
              autoIncrement: aiChk.checked,
              comment: commentInput.value.trim() || undefined,
              after: !isEdit && afterSel.value ? afterSel.value : undefined
            };
            if (!payload.name) { toast('Naam is verplicht', 'error'); return; }
            try {
              if (isEdit) {
                await api.changeColumn(db, table, existing.name, payload);
                // PK-wijziging via aparte ALTER indien nodig
                if (pkChk.checked !== (existing.key === 'PRI')) {
                  await api.query(pkChk.checked
                    ? `ALTER TABLE \`${db}\`.\`${table}\` ADD PRIMARY KEY (\`${payload.name}\`)`
                    : `ALTER TABLE \`${db}\`.\`${table}\` DROP PRIMARY KEY`, db);
                }
              } else {
                await api.addColumn(db, table, payload);
                if (pkChk.checked) await api.query(`ALTER TABLE \`${db}\`.\`${table}\` ADD PRIMARY KEY (\`${payload.name}\`)`, db);
              }
              toast(isEdit ? 'Kolom gewijzigd' : 'Kolom toegevoegd', 'success');
              close();
              refreshTab(tab.id);
            } catch (err) { toast(err.message, 'error', 8000); }
          }
        })
      ]
    });
  }

  /* ==================== Indexen ==================== */
  async function renderIndexes() {
    const idxs = await api.indexes(db, table);
    body.innerHTML = '';

    const bar = el('div', { class: 'toolbar', style: 'border-bottom:none;border-top:1px solid var(--border)' }, [
      el('button', { class: 'btn btn-sm', html: `${icon('plus')} Index toevoegen`, onclick: () => indexModal() })
    ]);

    const grouped = new Map();
    for (const i of idxs) {
      if (!grouped.has(i.name)) grouped.set(i.name, []);
      grouped.get(i.name).push(i);
    }

    const tbl = el('table', { class: 'def' });
    tbl.append(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Naam' }), el('th', { text: 'Kolommen' }), el('th', { text: 'Type' }),
      el('th', { text: 'Uniek' }), el('th', { text: 'Cardinaliteit' }), el('th', { text: '' })
    ])]));
    const tbody = el('tbody');
    for (const [name, parts] of grouped) {
      const first = parts[0];
      const isPk = name === 'PRIMARY';
      tbody.append(el('tr', {}, [
        el('td', { class: 'mono', html: `<b>${esc(name)}</b>` }),
        el('td', { class: 'mono', text: parts.map(p => p.columnName + (p.subPart ? `(${p.subPart})` : '')).join(', ') }),
        el('td', { html: isPk ? '<span class="tag pk">PRIMARY</span>' : `<span class="tag">${esc(first.type)}</span>` }),
        el('td', { text: Number(first.nonUnique) === 0 ? 'Ja' : 'Nee' }),
        el('td', { class: 'text-muted', text: first.cardinality ?? '' }),
        el('td', { style: 'text-align:right' }, [
          isPk ? '' : el('button', {
            class: 'icon-btn danger', html: icon('trash'), title: 'Index verwijderen', onclick: async () => {
              if (await confirmModal({ title: 'Index verwijderen', message: `Index <b class="mono">${esc(name)}</b> verwijderen?`, confirmText: 'Verwijderen', danger: true })) {
                try {
                  await api.dropIndex(db, table, name);
                  toast('Index verwijderd', 'success');
                  refreshTab(tab.id);
                } catch (err) { toast(err.message, 'error'); }
              }
            }
          })
        ])
      ]));
    }
    if (!grouped.size) tbody.append(el('tr', {}, [el('td', { colspan: 6, class: 'text-muted', text: 'Geen indexen' })]));
    tbl.append(tbody);
    body.append(tbl, bar);
  }

  async function indexModal() {
    const cols = await api.columns(db, table);
    const nameInput = el('input', { type: 'text', spellcheck: 'false', placeholder: 'idx_naam' });
    const uniqChk = el('input', { type: 'checkbox' });
    const checks = cols.map(c => {
      const chk = el('input', { type: 'checkbox' });
      return { chk, name: c.name, node: el('label', { class: 'checkbox', style: 'display:inline-flex;margin-right:14px' }, [chk, el('span', { class: 'mono', text: c.name })]) };
    });
    const { close } = openModal({
      title: `Index toevoegen — ${table}`,
      body: el('div', {}, [
        el('div', { class: 'form-row-2' }, [
          el('div', { class: 'form-group', style: 'flex:2' }, [el('label', { text: 'Indexnaam' }), nameInput]),
          el('div', { class: 'form-group', style: 'justify-content:flex-end' }, [el('label', { class: 'checkbox' }, [uniqChk, el('span', { text: 'UNIQUE' })])])
        ]),
        el('div', { class: 'form-group' }, [el('label', { text: 'Kolommen' }), el('div', { style: 'padding:10px;background:var(--bg-1);border:1px solid var(--border);border-radius:7px' }, checks.map(c => c.node))])
      ]),
      footer: [
        el('button', {
          class: 'btn btn-primary', text: 'Toevoegen', onclick: async () => {
            const chosen = checks.filter(c => c.chk.checked).map(c => c.name);
            if (!nameInput.value.trim() || !chosen.length) { toast('Naam en minimaal één kolom vereist', 'error'); return; }
            try {
              await api.addIndex(db, table, { name: nameInput.value.trim(), columns: chosen, unique: uniqChk.checked });
              toast('Index toegevoegd', 'success');
              close();
              refreshTab(tab.id);
            } catch (err) { toast(err.message, 'error', 7000); }
          }
        })
      ]
    });
  }

  /* ==================== Foreign keys ==================== */
  async function renderFks() {
    const fks = await api.foreignKeys(db, table);
    body.innerHTML = '';
    const tbl = el('table', { class: 'def' });
    tbl.append(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Naam' }), el('th', { text: 'Kolom' }), el('th', { text: 'Verwijst naar' }),
      el('th', { text: 'ON UPDATE' }), el('th', { text: 'ON DELETE' })
    ])]));
    const tbody = el('tbody');
    for (const fk of fks) {
      tbody.append(el('tr', {}, [
        el('td', { class: 'mono', html: `<b>${esc(fk.name)}</b>` }),
        el('td', { class: 'mono', text: fk.columnName }),
        el('td', { class: 'mono text-cyan', text: `${fk.refSchema}.${fk.refTable}.${fk.refColumn}` }),
        el('td', { text: fk.onUpdate || '' }),
        el('td', { text: fk.onDelete || '' })
      ]));
    }
    if (!fks.length) tbody.append(el('tr', {}, [el('td', { colspan: 5, class: 'text-muted', text: 'Geen foreign keys' })]));
    tbl.append(tbody);
    body.append(tbl);
  }

  /* ==================== DDL ==================== */
  async function renderDdl() {
    const r = await api.showCreate(db, table);
    body.innerHTML = '';
    body.append(el('div', { class: 'pane-body pad', style: 'overflow:visible' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card-header' }, [
          el('span', { html: `${icon('code')} CREATE-statement` }),
          el('span', { class: 'spacer' }),
          el('button', { class: 'btn btn-sm', html: `${icon('copy')} Kopiëren`, onclick: () => copyText(r.sql, 'SQL gekopieerd') })
        ]),
        el('pre', { class: 'code-block', text: r.sql, style: 'border:none;border-radius:0;max-height:none' })
      ])
    ]));
  }

  renderSubtabs();
  await load();
}
