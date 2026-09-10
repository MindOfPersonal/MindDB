'use strict';

/* ============================================================
   Rechten op databaseniveau: toekennen en intrekken per user
   ============================================================ */
import { api } from './api.js';
import { el, icon, toast, openModal, confirmModal, esc } from './util.js';
import { state } from './tabs.js';

export const DB_PRIV_LIST = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'INDEX', 'ALTER',
  'CREATE TEMPORARY TABLES', 'LOCK TABLES', 'CREATE VIEW', 'SHOW VIEW',
  'CREATE ROUTINE', 'ALTER ROUTINE', 'EXECUTE', 'EVENT', 'TRIGGER', 'REFERENCES'
];

function privCheckboxes(preset = []) {
  return DB_PRIV_LIST.map(name => {
    const chk = el('input', { type: 'checkbox', checked: preset.includes(name) });
    return { name, chk, node: el('label', { class: 'checkbox', style: 'display:inline-flex;margin:0 14px 8px 0' }, [chk, el('span', { class: 'mono', text: name })]) };
  });
}

function privTags(privileges, grantOption) {
  const tags = privileges.map(p => `<span class="tag">${esc(p)}</span>`);
  if (grantOption) tags.push('<span class="tag pk">GRANT OPTION</span>');
  return tags.join(' ') || '<span class="text-muted">geen rechten</span>';
}

function privTable(rows, { showDb = false, onRevoke }) {
  const tbl = el('table', { class: 'def' });
  const headers = [...(showDb ? ['Database'] : []), 'Gebruiker', 'Host', 'Rechten', ''];
  tbl.append(el('thead', {}, [el('tr', {}, headers.map(h => el('th', { text: h })))]));
  const tbody = el('tbody');
  for (const row of rows) {
    const cells = [];
    if (showDb) cells.push(el('td', { class: 'mono', html: `<b>${esc(row.db)}</b>` }));
    cells.push(el('td', { class: 'mono', text: row.user }));
    cells.push(el('td', { class: 'mono', text: row.host }));
    cells.push(el('td', { html: privTags(row.privileges, row.grantOption) }));
    cells.push(el('td', { style: 'text-align:right' }, [
      el('button', {
        class: 'icon-btn danger', html: icon('trash'), title: 'Rechten intrekken',
        onclick: () => onRevoke(row)
      })
    ]));
    tbody.append(el('tr', {}, cells));
  }
  tbl.append(tbody);
  return tbl;
}

/* ============================================================
   Rechten per database (vanuit database-contextmenu)
   ============================================================ */
export async function openDatabasePrivilegesModal(dbName) {
  const listWrap = el('div', {});
  const userInput = el('input', { type: 'text', placeholder: 'gebruikersnaam', spellcheck: 'false', list: 'priv-user-list' });
  const hostInput = el('input', { type: 'text', value: '%', spellcheck: 'false' });
  const datalist = el('datalist', { id: 'priv-user-list' });
  const checks = privCheckboxes();
  const grantChk = el('input', { type: 'checkbox' });

  try {
    const users = await api.users();
    const seen = new Set();
    for (const u of users) {
      if (seen.has(u.user)) continue;
      seen.add(u.user);
      datalist.append(el('option', { value: u.user, text: `${u.user}@${u.host}` }));
    }
  } catch { /* gebruikerslijst optioneel */ }

  async function reload() {
    listWrap.innerHTML = '';
    listWrap.append(el('div', { class: 'loading-overlay' }, [el('div', { class: 'spinner' })]));
    let rows;
    try {
      rows = await api.dbPrivileges(dbName);
    } catch (err) {
      listWrap.innerHTML = '';
      listWrap.append(el('div', { class: 'empty-state', html: `${icon('alert')}<h3>Fout</h3><p>${esc(err.message)}</p>` }));
      return;
    }
    listWrap.innerHTML = '';
    if (!rows.length) {
      listWrap.append(el('p', { class: 'text-muted', text: 'Er zijn nog geen specifieke rechten op deze database toegekend.' }));
      return;
    }
    listWrap.append(privTable(rows, {
      onRevoke: async (row) => {
        if (await confirmModal({
          title: 'Rechten intrekken',
          message: `Alle rechten van <b class="mono">${esc(row.user)}@${esc(row.host)}</b> op <b class="mono">${esc(dbName)}</b> intrekken?`,
          confirmText: 'Intrekken', danger: true
        })) {
          try {
            await api.revokeDbPrivilege(dbName, row.user, row.host);
            toast('Rechten ingetrokken', 'success');
            reload();
          } catch (err) { toast(err.message, 'error'); }
        }
      }
    }));
  }

  const body = el('div', {}, [
    el('div', { class: 'section-title', html: `${icon('shield')} Bestaande rechten op <span class="mono">${esc(dbName)}</span>` }),
    listWrap,
    el('div', { class: 'section-title', html: `${icon('plus')} Rechten toekennen` }),
    el('div', { class: 'form-row-2' }, [
      el('div', { class: 'form-group' }, [el('label', { text: 'Gebruiker' }), datalist, userInput]),
      el('div', { class: 'form-group' }, [el('label', { text: 'Host' }), hostInput])
    ]),
    el('div', { class: 'form-group' }, [
      el('label', { text: 'Rechten' }),
      el('div', { style: 'padding:12px;background:var(--bg-1);border:1px solid var(--border);border-radius:7px' }, checks.map(c => c.node))
    ]),
    el('label', { class: 'checkbox', style: 'margin-bottom:14px' }, [grantChk, el('span', { text: 'WITH GRANT OPTION' })]),
    el('button', {
      class: 'btn btn-primary', html: `${icon('check')} Toekennen`,
      onclick: async () => {
        const user = userInput.value.trim();
        const host = hostInput.value.trim() || '%';
        const privileges = checks.filter(c => c.chk.checked).map(c => c.name);
        if (!user) { toast('Gebruikersnaam is verplicht', 'error'); return; }
        if (!privileges.length) { toast('Selecteer minimaal één recht', 'error'); return; }
        try {
          await api.grantDbPrivilege(dbName, { user, host, privileges, grantOption: grantChk.checked });
          toast(`Rechten toegekend aan ${user}@${host}`, 'success');
          reload();
        } catch (err) { toast(err.message, 'error', 8000); }
      }
    })
  ]);

  const { close } = openModal({
    title: `Rechten beheren — ${dbName}`,
    body,
    wide: true,
    footer: [el('button', { class: 'btn btn-ghost', text: 'Sluiten', onclick: () => close() })]
  });

  reload();
}

/* ============================================================
   Database-rechten van één gebruiker (vanuit gebruikersbeheer)
   ============================================================ */
export async function openUserDatabasePrivilegesModal(user, host) {
  const listWrap = el('div', {});
  const globalWrap = el('div', {});
  const dbSel = el('select', {}, [
    el('option', { value: '', text: '— Kies een database —' }),
    ...[...state.databases].sort((a, b) => a.name.localeCompare(b.name)).map(d => el('option', { value: d.name, text: d.name }))
  ]);
  const checks = privCheckboxes();
  const grantChk = el('input', { type: 'checkbox' });

  async function reload() {
    listWrap.innerHTML = '';
    listWrap.append(el('div', { class: 'loading-overlay' }, [el('div', { class: 'spinner' })]));
    let rows;
    try {
      rows = await api.userDatabases(user, host);
    } catch (err) {
      listWrap.innerHTML = '';
      listWrap.append(el('div', { class: 'empty-state', html: `${icon('alert')}<h3>Fout</h3><p>${esc(err.message)}</p>` }));
      return;
    }
    listWrap.innerHTML = '';
    if (!rows.length) {
      listWrap.append(el('p', { class: 'text-muted', text: 'Deze gebruiker heeft geen specifieke database-rechten.' }));
      return;
    }
    listWrap.append(privTable(rows, {
      showDb: true,
      onRevoke: async (row) => {
        if (await confirmModal({
          title: 'Rechten intrekken',
          message: `Alle rechten van <b class="mono">${esc(user)}@${esc(host)}</b> op <b class="mono">${esc(row.db)}</b> intrekken?`,
          confirmText: 'Intrekken', danger: true
        })) {
          try {
            await api.revokeDbPrivilege(row.db, user, host);
            toast('Rechten ingetrokken', 'success');
            reload();
          } catch (err) { toast(err.message, 'error'); }
        }
      }
    }));
  }

  /* Globale rechten tonen */
  api.userGrants(user, host).then(grants => {
    globalWrap.innerHTML = '';
    globalWrap.append(el('pre', { class: 'code-block', text: grants.join('\n\n') || '(geen grants)' }));
  }).catch(err => {
    globalWrap.innerHTML = '';
    globalWrap.append(el('p', { class: 'text-muted', text: err.message }));
  });

  const body = el('div', {}, [
    el('div', { class: 'section-title', html: `${icon('shield')} Globale rechten` }),
    globalWrap,
    el('div', { class: 'section-title', html: `${icon('database')} Database-rechten` }),
    listWrap,
    el('div', { class: 'section-title', html: `${icon('plus')} Rechten toekennen` }),
    el('div', { class: 'form-group' }, [el('label', { text: 'Database' }), dbSel]),
    el('div', { class: 'form-group' }, [
      el('label', { text: 'Rechten' }),
      el('div', { style: 'padding:12px;background:var(--bg-1);border:1px solid var(--border);border-radius:7px' }, checks.map(c => c.node))
    ]),
    el('label', { class: 'checkbox', style: 'margin-bottom:14px' }, [grantChk, el('span', { text: 'WITH GRANT OPTION' })]),
    el('button', {
      class: 'btn btn-primary', html: `${icon('check')} Toekennen`,
      onclick: async () => {
        const db = dbSel.value;
        const privileges = checks.filter(c => c.chk.checked).map(c => c.name);
        if (!db) { toast('Kies een database', 'error'); return; }
        if (!privileges.length) { toast('Selecteer minimaal één recht', 'error'); return; }
        try {
          await api.grantDbPrivilege(db, { user, host, privileges, grantOption: grantChk.checked });
          toast(`Rechten toegekend op ${db}`, 'success');
          reload();
        } catch (err) { toast(err.message, 'error', 8000); }
      }
    })
  ]);

  const { close } = openModal({
    title: `Database-rechten — ${user}@${host}`,
    body,
    wide: true,
    footer: [el('button', { class: 'btn btn-ghost', text: 'Sluiten', onclick: () => close() })]
  });

  reload();
}
