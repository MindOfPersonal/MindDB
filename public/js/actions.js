'use strict';

/* ============================================================
   Acties: exporteren, importeren, database/tabel aanmaken,
   object-definities bekijken
   ============================================================ */
import { api } from './api.js';
import { el, icon, toast, openModal, esc, fmtBytes, setStatus } from './util.js';
import { state } from './tabs.js';
import { DB_PRIV_LIST } from './privileges.js';

/* ==================== Export ==================== */
export function openExportModal(dbName, tableName = null) {
  const tables = state.tablesCache.get(dbName) || [];
  const formatSel = el('select', {}, [
    el('option', { value: 'sql', text: 'SQL dump (.sql)' }),
    ...(tableName ? [
      el('option', { value: 'csv', text: 'CSV (.csv)' }),
      el('option', { value: 'json', text: 'JSON (.json)' })
    ] : [])
  ]);
  const tableSel = el('select', {}, [
    el('option', { value: '', text: '— Hele database —' }),
    ...tables.filter(t => t.type !== 'VIEW').map(t => el('option', { value: t.name, text: t.name, selected: t.name === tableName ? '' : undefined }))
  ]);
  const dataChk = el('input', { type: 'checkbox', checked: true });

  const dataRow = el('label', { class: 'checkbox' }, [dataChk, el('span', { text: 'Inclusief data (INSERT-statements)' })]);

  function syncUI() {
    const isSql = formatSel.value === 'sql';
    dataRow.style.display = isSql && !tableSel.value ? '' : 'none';
  }
  formatSel.addEventListener('change', syncUI);
  tableSel.addEventListener('change', syncUI);
  syncUI();

  const { close } = openModal({
    title: `Exporteren — ${dbName}${tableName ? '.' + tableName : ''}`,
    body: el('div', {}, [
      tableName ? '' : el('div', { class: 'form-group' }, [el('label', { text: 'Wat exporteren?' }), tableSel]),
      el('div', { class: 'form-group' }, [el('label', { text: 'Formaat' }), formatSel]),
      dataRow,
      el('p', { class: 'text-muted', style: 'margin-top:12px;font-size:12px', text: 'Het bestand wordt gegenereerd door de server en als download aangeboden.' })
    ]),
    footer: [
      el('button', {
        class: 'btn btn-primary', html: `${icon('download')} Downloaden`, onclick: () => {
          const url = api.exportUrl(dbName, tableSel.value || null, formatSel.value, dataChk.checked);
          const a = el('a', { href: url, download: '' });
          document.body.append(a);
          a.click();
          a.remove();
          toast('Export gestart', 'success');
          close();
        }
      })
    ]
  });
}

/* ==================== Import ==================== */
export function openImportModal(dbName) {
  const fileInput = el('input', { type: 'file', accept: '.sql,.txt', style: 'padding:9px;background:var(--bg-1);border:1px dashed var(--border-strong);border-radius:7px;cursor:pointer' });
  const info = el('p', { class: 'text-muted', style: 'margin-top:10px;font-size:12px', text: 'Selecteer een .sql-bestand. De inhoud wordt op de database uitgevoerd (multiple statements toegestaan).' });
  const progress = el('div', { style: 'display:none;margin-top:10px' }, [el('div', { class: 'spinner' })]);

  const { close } = openModal({
    title: `SQL importeren — ${dbName}`,
    body: el('div', {}, [fileInput, info, progress]),
    footer: [
      el('button', {
        class: 'btn btn-primary', html: `${icon('upload')} Importeren`, onclick: async (e) => {
          const file = fileInput.files[0];
          if (!file) { toast('Selecteer eerst een bestand', 'error'); return; }
          if (file.size > 200 * 1024 * 1024) { toast('Bestand is te groot (max 200 MB)', 'error'); return; }
          const btn = e.currentTarget;
          btn.disabled = true;
          progress.style.display = '';
          try {
            const text = await file.text();
            const r = await api.importSql(dbName, text);
            toast(`Import voltooid (${r.results.length} statement-resultaten)`, 'success');
            setStatus(`Import in ${dbName} voltooid`);
            close();
            const { refreshDbNode } = await import('./sidebar.js');
            refreshDbNode(dbName);
          } catch (err) {
            toast(`Import mislukt: ${err.message}`, 'error', 9000);
          } finally {
            btn.disabled = false;
            progress.style.display = 'none';
          }
        }
      })
    ]
  });
}

/* ==================== Database aanmaken ==================== */
export async function openCreateDatabaseModal(onDone) {
  let charsets = { charsets: [], collations: [] };
  try { charsets = await api.charsets(); } catch { /* optioneel */ }

  const nameInput = el('input', { type: 'text', spellcheck: 'false', placeholder: 'nieuwe_database' });
  const charsetSel = el('select', {}, [
    el('option', { value: '', text: '(serverstandaard)' }),
    ...charsets.charsets.map(c => el('option', { value: c.name, text: c.name, selected: c.name === 'utf8mb4' ? '' : undefined }))
  ]);
  const collSel = el('select', {}, [el('option', { value: '', text: '(standaard)' })]);

  const accessUser = el('input', { type: 'text', spellcheck: 'false', placeholder: 'gebruikersnaam (optioneel)', list: 'cdb-users' });
  const accessHost = el('input', { type: 'text', value: '%', spellcheck: 'false' });
  const userList = el('datalist', { id: 'cdb-users' });
  const accessGrantChk = el('input', { type: 'checkbox' });
  const accessChecks = DB_PRIV_LIST.map(p => {
    const chk = el('input', { type: 'checkbox' });
    return { p, chk, node: el('label', { class: 'checkbox', style: 'display:inline-flex;margin:0 14px 8px 0' }, [chk, el('span', { class: 'mono', text: p })]) };
  });
  try {
    const users = await api.users();
    const seen = new Set();
    for (const u of users) { if (seen.has(u.user)) continue; seen.add(u.user); userList.append(el('option', { value: u.user })); }
  } catch { /* gebruikerslijst optioneel */ }

  function fillCollations() {
    const cs = charsetSel.value;
    collSel.innerHTML = '';
    collSel.append(el('option', { value: '', text: '(standaard)' }));
    for (const c of charsets.collations.filter(x => !cs || x.charset === cs)) {
      collSel.append(el('option', { value: c.name, text: c.name, selected: c.name === 'utf8mb4_unicode_ci' ? '' : undefined }));
    }
  }
  charsetSel.addEventListener('change', fillCollations);
  fillCollations();

  const { close } = openModal({
    title: 'Nieuwe database',
    wide: true,
    body: el('div', {}, [
      userList,
      el('div', { class: 'form-group' }, [el('label', { text: 'Naam' }), nameInput]),
      el('div', { class: 'form-row-2' }, [
        el('div', { class: 'form-group' }, [el('label', { text: 'Character set' }), charsetSel]),
        el('div', { class: 'form-group' }, [el('label', { text: 'Collatie' }), collSel])
      ]),
      el('div', { class: 'section-title', style: 'margin-top:16px', html: `${icon('shield')} Rechten toekennen (optioneel)` }),
      el('div', { class: 'form-row-2' }, [
        el('div', { class: 'form-group' }, [el('label', { text: 'Gebruiker' }), accessUser]),
        el('div', { class: 'form-group' }, [el('label', { text: 'Host' }), accessHost])
      ]),
      el('div', { class: 'form-group' }, [
        el('label', { text: 'Rechten op de nieuwe database' }),
        el('div', { style: 'padding:12px;background:var(--bg-1);border:1px solid var(--border);border-radius:7px' }, accessChecks.map(c => c.node))
      ]),
      el('label', { class: 'checkbox' }, [accessGrantChk, el('span', { text: 'WITH GRANT OPTION' })])
    ]),
    footer: [
      el('button', {
        class: 'btn btn-primary', html: `${icon('plus')} Aanmaken`, onclick: async () => {
          const name = nameInput.value.trim();
          if (!name) { toast('Naam is verplicht', 'error'); return; }
          try {
            await api.createDatabase({ name, charset: charsetSel.value || undefined, collation: collSel.value || undefined });
            const dbUser = accessUser.value.trim();
            const dbPrivs = accessChecks.filter(c => c.chk.checked).map(c => c.p);
            if (dbUser && dbPrivs.length) {
              try {
                await api.grantDbPrivilege(name, { user: dbUser, host: accessHost.value.trim() || '%', privileges: dbPrivs, grantOption: accessGrantChk.checked });
                toast(`Database ${name} aangemaakt en rechten aan ${dbUser} toegekend`, 'success');
              } catch (err) {
                toast(`Database ${name} aangemaakt, maar rechten toekennen mislukte: ${err.message}`, 'error', 9000);
              }
            } else {
              toast(`Database ${name} aangemaakt`, 'success');
            }
            close();
            onDone && onDone();
          } catch (err) { toast(err.message, 'error', 7000); }
        }
      })
    ]
  });
}

/* ==================== Tabel aanmaken ==================== */
export function openCreateTableModal(dbName, onDone) {
  const nameInput = el('input', { type: 'text', spellcheck: 'false', placeholder: 'nieuwe_tabel' });
  const engineSel = el('select', {}, ['InnoDB', 'MyISAM', 'Aria', 'MEMORY', 'CSV', 'ARCHIVE'].map(e2 =>
    el('option', { value: e2, text: e2 })));
  const commentInput = el('input', { type: 'text', spellcheck: 'false', placeholder: '(optioneel)' });

  const TYPE_OPTS = ['INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL(10,2)', 'FLOAT', 'DOUBLE',
    'VARCHAR(255)', 'CHAR(10)', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
    'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'JSON', 'BOOLEAN'];

  const colsWrap = el('div', {});
  const colRows = [];

  function addColRow(preset = {}) {
    const nameI = el('input', { type: 'text', placeholder: 'kolomnaam', value: preset.name || '', spellcheck: 'false', style: 'flex:2' });
    const typeI = el('input', { type: 'text', value: preset.type || 'INT', list: 'ct-types', spellcheck: 'false', style: 'flex:2' });
    const nnC = el('input', { type: 'checkbox', checked: preset.nn !== false });
    const pkC = el('input', { type: 'checkbox', checked: !!preset.pk });
    const aiC = el('input', { type: 'checkbox', checked: !!preset.ai });
    const row = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:8px' }, [
      nameI, typeI,
      el('label', { class: 'checkbox', title: 'NOT NULL', style: 'white-space:nowrap' }, [nnC, el('span', { text: 'NN' })]),
      el('label', { class: 'checkbox', title: 'PRIMARY KEY', style: 'white-space:nowrap' }, [pkC, el('span', { text: 'PK' })]),
      el('label', { class: 'checkbox', title: 'AUTO_INCREMENT', style: 'white-space:nowrap' }, [aiC, el('span', { text: 'AI' })]),
      el('button', { class: 'icon-btn danger', html: icon('x'), title: 'Verwijder rij', onclick: () => { row.remove(); colRows.splice(colRows.indexOf(rec), 1); } })
    ]);
    const rec = { nameI, typeI, nnC, pkC, aiC, row };
    colRows.push(rec);
    colsWrap.append(row);
  }

  addColRow({ name: 'id', type: 'INT', pk: true, ai: true });
  addColRow({ name: '', type: 'VARCHAR(255)', nn: false });

  const { close } = openModal({
    title: `Nieuwe tabel — ${dbName}`,
    wide: true,
    body: el('div', {}, [
      el('div', { class: 'form-row-2' }, [
        el('div', { class: 'form-group', style: 'flex:2' }, [el('label', { text: 'Tabelnaam' }), nameInput]),
        el('div', { class: 'form-group' }, [el('label', { text: 'Engine' }), engineSel]),
        el('div', { class: 'form-group', style: 'flex:2' }, [el('label', { text: 'Opmerking' }), commentInput])
      ]),
      el('div', { class: 'form-group' }, [
        el('label', { text: 'Kolommen' }),
        el('div', { style: 'display:flex;gap:8px;margin-bottom:4px' }, [
          el('span', { class: 'text-muted', style: 'flex:2;font-size:11px', text: 'NAAM' }),
          el('span', { class: 'text-muted', style: 'flex:2;font-size:11px', text: 'TYPE' }),
          el('span', { class: 'text-muted', style: 'font-size:11px;width:118px', text: 'NN / PK / AI' }),
          el('span', { style: 'width:28px' })
        ]),
        el('datalist', { id: 'ct-types' }, TYPE_OPTS.map(t => el('option', { value: t }))),
        colsWrap,
        el('button', { class: 'btn btn-sm btn-ghost', html: `${icon('plus')} Kolom toevoegen`, onclick: () => addColRow({ nn: false }) })
      ])
    ]),
    footer: [
      el('button', {
        class: 'btn btn-primary', html: `${icon('plus')} Tabel aanmaken`, onclick: async () => {
          const name = nameInput.value.trim();
          const columns = colRows.filter(r => r.nameI.value.trim()).map(r => ({
            name: r.nameI.value.trim(),
            type: r.typeI.value.trim() || 'VARCHAR(255)',
            nullable: !r.nnC.checked,
            primary: r.pkC.checked,
            autoIncrement: r.aiC.checked
          }));
          if (!name) { toast('Tabelnaam is verplicht', 'error'); return; }
          if (!columns.length) { toast('Voeg minimaal één kolom toe', 'error'); return; }
          try {
            await api.createTable(dbName, { name, columns, engine: engineSel.value, comment: commentInput.value.trim() || undefined });
            toast(`Tabel ${name} aangemaakt`, 'success');
            close();
            onDone && onDone();
          } catch (err) { toast(err.message, 'error', 8000); }
        }
      })
    ]
  });
}

/* ==================== Object-definitie ==================== */
export async function openObjectSqlModal(dbName, type, name) {
  try {
    const r = await api.objectCreate(dbName, type, name);
    const { openSqlViewModal } = await import('./sidebar.js');
    openSqlViewModal(`${type} — ${name}`, r.sql || '(geen definitie beschikbaar)');
  } catch (err) {
    toast(err.message, 'error', 7000);
  }
}
