'use strict';

/* ============================================================
   Dashboard & serverbeheer: status, processen, variabelen,
   gebruikers en rechten
   ============================================================ */
import { api } from './api.js';
import { el, icon, toast, setStatus, fmtNum, fmtBytes, fmtUptime, esc, openModal, confirmModal, debounce, copyText } from './util.js';
import { openTab, state } from './tabs.js';
import { openUserDatabasePrivilegesModal, DB_PRIV_LIST } from './privileges.js';

/* ============================================================ DASHBOARD */
export function openDashboardTab() {
  openTab({
    id: 'dashboard',
    title: 'Dashboard',
    icon: 'activity',
    kind: 'dashboard',
    params: {},
    render: renderDashboard
  });
}

async function renderDashboard(pane) {
  pane.innerHTML = '';
  const body = el('div', { class: 'pane-body pad' });
  pane.append(el('div', { class: 'toolbar' }, [
    el('span', { class: 'toolbar-title', html: `${icon('activity')} Serverdashboard` }),
    el('button', { class: 'icon-btn', html: icon('refresh'), title: 'Verversen', onclick: () => load() })
  ]), body);

  async function load() {
    body.innerHTML = '';
    const spin = el('div', { class: 'loading-overlay' }, [el('div', { class: 'spinner' })]);
    body.append(spin);
    let s;
    try {
      s = await api.serverStatus();
    } catch (err) {
      body.innerHTML = '';
      body.append(el('div', { class: 'empty-state', html: `${icon('alert')}<h3>Fout</h3><p>${esc(err.message)}</p>` }));
      return;
    }
    body.innerHTML = '';

    const connPct = s.maxConnections ? Math.min(100, Math.round(s.threadsConnected / s.maxConnections * 100)) : 0;

    const cards = [
      { label: 'Uptime', value: fmtUptime(s.uptime), sub: s.info.version, iconName: 'clock', color: 'var(--accent)', bg: 'var(--accent-soft)' },
      { label: 'Verbindingen', value: `${fmtNum(s.threadsConnected)} / ${fmtNum(s.maxConnections)}`, sub: `${fmtNum(s.connections)} totaal · ${fmtNum(s.abortedConnects)} afgebroken`, iconName: 'link', color: 'var(--cyan)', bg: 'var(--cyan-soft)', pct: connPct },
      { label: 'Queries', value: fmtNum(s.questions), sub: `gem. ${s.queriesPerSecondAvg} /s`, iconName: 'zap', color: 'var(--green)', bg: 'var(--green-soft)' },
      { label: 'Threads actief', value: fmtNum(s.threadsRunning), sub: 'queries op dit moment', iconName: 'cpu', color: 'var(--amber)', bg: 'var(--amber-soft)' },
      { label: 'Trage queries', value: fmtNum(s.slowQueries), sub: 'slow queries', iconName: 'alert', color: 'var(--red)', bg: 'var(--red-soft)' },
      { label: 'Data ontvangen', value: fmtBytes(s.bytesReceived), sub: `verzonden: ${fmtBytes(s.bytesSent)}`, iconName: 'download', color: 'var(--purple)', bg: 'rgba(192,132,252,.14)' },
      { label: 'InnoDB buffer pool', value: fmtBytes(s.innodbBufferPoolSize), sub: `${fmtNum(s.openTables)} open tabellen`, iconName: 'layers', color: 'var(--accent)', bg: 'var(--accent-soft)' },
      { label: 'Host', value: s.info.hostname || '—', sub: `poort ${s.info.port}`, iconName: 'server', color: 'var(--cyan)', bg: 'var(--cyan-soft)', small: true }
    ];

    const grid = el('div', { class: 'dash-grid' });
    for (const c of cards) {
      grid.append(el('div', { class: 'stat-card' }, [
        el('div', { class: 'stat-icon', style: `background:${c.bg};color:${c.color}`, html: icon(c.iconName) }),
        el('div', { class: 'stat-label', text: c.label }),
        el('div', { class: 'stat-value', text: c.value, style: c.small ? 'font-size:16px;padding-top:4px' : '' }),
        el('div', { class: 'stat-sub', text: c.sub }),
        c.pct !== undefined ? el('div', { class: 'progress' }, [el('div', { style: `width:${c.pct}%` })]) : null
      ]));
    }

    body.append(
      el('div', { class: 'section-title', html: `${icon('activity')} Status` }),
      grid,
      el('div', { class: 'section-title', html: `${icon('server')} Serverinformatie` }),
      el('div', { class: 'card' }, [el('table', { class: 'kv-table' }, [
        kvRow('Versie', `${s.info.versionComment || ''} ${s.info.version}`),
        kvRow('Hostname', s.info.hostname),
        kvRow('Poort', s.info.port),
        kvRow('Data directory', s.info.datadir),
        kvRow('Socket / pipe', s.info.socket),
        kvRow('Ingelogd als', s.info.currentUser)
      ])]),
      el('div', { class: 'section-title', html: `${icon('database')} Databases` }),
      renderDbSizes()
    );
    setStatus(`Server: ${s.info.version} · uptime ${fmtUptime(s.uptime)}`);
  }

  function kvRow(k, v) {
    return el('tr', {}, [el('td', { text: k }), el('td', { class: 'mono', text: v ?? '—' })]);
  }

  function renderDbSizes() {
    const max = Math.max(1, ...state.databases.map(d => d.size || 0));
    const card = el('div', { class: 'card' });
    const tbl = el('table', { class: 'def' });
    tbl.append(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Database' }), el('th', { text: 'Tabellen' }), el('th', { text: 'Grootte', style: 'width:35%' }), el('th', { text: 'Collatie' })
    ])]));
    const tbody = el('tbody');
    for (const d of [...state.databases].sort((a, b) => (b.size || 0) - (a.size || 0))) {
      const pct = Math.round((d.size || 0) / max * 100);
      tbody.append(el('tr', {}, [
        el('td', { class: 'mono', html: `<b>${esc(d.name)}</b>` }),
        el('td', { text: fmtNum(d.tables) }),
        el('td', {}, [
          el('div', { style: 'display:flex;align-items:center;gap:10px' }, [
            el('div', { class: 'progress', style: 'flex:1;margin:0' }, [el('div', { style: `width:${pct}%` })]),
            el('span', { class: 'text-muted mono', text: fmtBytes(d.size), style: 'min-width:70px;text-align:right' })
          ])
        ]),
        el('td', { class: 'text-muted', text: d.collation || '' })
      ]));
    }
    tbl.append(tbody);
    card.append(tbl);
    return card;
  }

  await load();
}

/* ============================================================ PROCESSEN */
export function openProcesslistTab() {
  openTab({
    id: 'processes',
    title: 'Processen',
    icon: 'cpu',
    kind: 'processes',
    params: {},
    render: renderProcesslist
  });
}

async function renderProcesslist(pane, tab) {
  pane.innerHTML = '';
  let timer = null;
  const autoChk = el('input', { type: 'checkbox', checked: true });
  const body = el('div', { class: 'pane-body' });

  pane.append(el('div', { class: 'toolbar' }, [
    el('span', { class: 'toolbar-title', html: `${icon('cpu')} Processlijst` }),
    el('button', { class: 'icon-btn', html: icon('refresh'), title: 'Verversen', onclick: () => load() }),
    el('span', { class: 'spacer' }),
    el('label', { class: 'checkbox' }, [autoChk, el('span', { text: 'Automatisch verversen (3s)' })])
  ]), body);

  tab.onClose = () => { if (timer) clearInterval(timer); };

  async function load() {
    let rows;
    try {
      rows = await api.processlist();
    } catch (err) {
      body.innerHTML = '';
      body.append(el('div', { class: 'empty-state', html: `${icon('alert')}<h3>Fout</h3><p>${esc(err.message)}</p>` }));
      return;
    }
    body.innerHTML = '';
    const tbl = el('table', { class: 'def' });
    tbl.append(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'ID' }), el('th', { text: 'Gebruiker' }), el('th', { text: 'Host' }), el('th', { text: 'Database' }),
      el('th', { text: 'Commando' }), el('th', { text: 'Tijd' }), el('th', { text: 'Status' }), el('th', { text: 'Query' }), el('th', { text: '' })
    ])]));
    const tbody = el('tbody');
    for (const p of rows) {
      const sleeping = p.command === 'Sleep';
      tbody.append(el('tr', { style: sleeping ? 'opacity:.55' : '' }, [
        el('td', { class: 'mono', text: p.id }),
        el('td', { text: p.user }),
        el('td', { class: 'mono text-muted', text: p.host || '' }),
        el('td', { class: 'mono', text: p.db || '' }),
        el('td', { html: sleeping ? `<span class="tag">${p.command}</span>` : `<span class="tag uniq">${esc(p.command)}</span>` }),
        el('td', { class: p.time > 60 ? 'text-red' : p.time > 10 ? 'text-amber' : '', text: `${p.time}s` }),
        el('td', { class: 'text-muted', text: p.state || '' }),
        el('td', {
          class: 'mono', style: 'max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
          text: p.info || '', title: p.info || ''
        }),
        el('td', { style: 'text-align:right' }, [
          el('button', {
            class: 'icon-btn danger', html: icon('kill'), title: 'Proces beëindigen (KILL)', onclick: async () => {
              if (await confirmModal({ title: 'Proces beëindigen', message: `Proces <b class="mono">${p.id}</b> (${esc(p.user)}) killen?`, confirmText: 'Kill', danger: true })) {
                try {
                  await api.killProcess(p.id);
                  toast(`Proces ${p.id} beëindigd`, 'success');
                  load();
                } catch (err) { toast(err.message, 'error'); }
              }
            }
          })
        ])
      ]));
    }
    tbl.append(tbody);
    body.append(tbl);
    setStatus(`${rows.length} processen`);
  }

  autoChk.addEventListener('change', () => {
    if (autoChk.checked) timer = setInterval(load, 3000);
    else if (timer) { clearInterval(timer); timer = null; }
  });
  timer = setInterval(load, 3000);
  await load();
}

/* ============================================================ VARIABELEN */
export function openVariablesTab() {
  openTab({
    id: 'variables',
    title: 'Variabelen',
    icon: 'settings',
    kind: 'variables',
    params: {},
    render: renderVariables
  });
}

async function renderVariables(pane) {
  pane.innerHTML = '';
  let all = [];
  const search = el('input', { class: 'filter-input', type: 'text', placeholder: 'Zoek variabele…', spellcheck: 'false' });
  const scopeSel = el('select', {}, [
    el('option', { value: 'global', text: 'GLOBAL' }),
    el('option', { value: 'session', text: 'SESSION' })
  ]);
  const body = el('div', { class: 'pane-body' });
  const countSpan = el('span', { class: 'text-muted' });

  pane.append(el('div', { class: 'toolbar' }, [
    el('span', { class: 'toolbar-title', html: `${icon('settings')} Servervariabelen` }),
    scopeSel,
    search,
    el('span', { class: 'spacer' }),
    countSpan
  ]), body);

  async function load() {
    body.innerHTML = '';
    body.append(el('div', { class: 'loading-overlay' }, [el('div', { class: 'spinner' })]));
    try {
      all = await api.serverVariables(scopeSel.value);
    } catch (err) {
      body.innerHTML = '';
      body.append(el('div', { class: 'empty-state', html: `${icon('alert')}<h3>Fout</h3><p>${esc(err.message)}</p>` }));
      return;
    }
    render();
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const rows = q ? all.filter(v => v.name.toLowerCase().includes(q) || String(v.value).toLowerCase().includes(q)) : all;
    countSpan.textContent = `${fmtNum(rows.length)} van ${fmtNum(all.length)} variabelen`;
    body.innerHTML = '';
    const tbl = el('table', { class: 'def' });
    tbl.append(el('thead', {}, [el('tr', {}, [el('th', { text: 'Variabele', style: 'width:340px' }), el('th', { text: 'Waarde' })])]));
    const tbody = el('tbody');
    for (const v of rows) {
      tbody.append(el('tr', {}, [
        el('td', { class: 'mono text-cyan', text: v.name }),
        el('td', { class: 'mono', style: 'word-break:break-all;white-space:normal', text: v.value === null || v.value === '' ? '(leeg)' : String(v.value) })
      ]));
    }
    if (!rows.length) tbody.append(el('tr', {}, [el('td', { colspan: 2, class: 'text-muted', text: 'Geen variabelen gevonden' })]));
    tbl.append(tbody);
    body.append(tbl);
  }

  search.addEventListener('input', debounce(render, 150));
  scopeSel.addEventListener('change', load);
  await load();
}

/* ============================================================ GEBRUIKERS */
export function openUsersTab() {
  openTab({
    id: 'users',
    title: 'Gebruikers',
    icon: 'users',
    kind: 'users',
    params: {},
    render: renderUsers
  });
}

async function renderUsers(pane, tab) {
  pane.innerHTML = '';
  const body = el('div', { class: 'pane-body' });
  pane.append(el('div', { class: 'toolbar' }, [
    el('span', { class: 'toolbar-title', html: `${icon('users')} Gebruikersbeheer` }),
    el('button', { class: 'icon-btn', html: icon('refresh'), title: 'Verversen', onclick: () => load() }),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn btn-sm btn-primary', html: `${icon('plus')} Nieuwe gebruiker`, onclick: () => createUserModal() })
  ]), body);

  async function load() {
    body.innerHTML = '';
    body.append(el('div', { class: 'loading-overlay' }, [el('div', { class: 'spinner' })]));
    let users;
    try {
      users = await api.users();
    } catch (err) {
      body.innerHTML = '';
      body.append(el('div', { class: 'empty-state', html: `${icon('alert')}<h3>Geen toegang</h3><p>${esc(err.message)}<br>Je hebt mogelijk geen rechten op <span class="mono">mysql.user</span>.</p>` }));
      return;
    }
    body.innerHTML = '';
    const tbl = el('table', { class: 'def' });
    tbl.append(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Gebruiker' }), el('th', { text: 'Host' }), el('th', { text: 'Globale rechten' }), el('th', { text: 'Plugin' }), el('th', { text: '' })
    ])]));
    const tbody = el('tbody');
    for (const u of users) {
      const privs = [];
      if (u.superPriv === 'Y') privs.push('<span class="tag ai">SUPER</span>');
      if (u.grantPriv === 'Y') privs.push('<span class="tag pk">GRANT</span>');
      if (u.selectPriv === 'Y') privs.push('<span class="tag">SELECT</span>');
      if (u.insertPriv === 'Y') privs.push('<span class="tag">INSERT</span>');
      if (u.updatePriv === 'Y') privs.push('<span class="tag">UPDATE</span>');
      if (u.deletePriv === 'Y') privs.push('<span class="tag">DELETE</span>');
      if (u.createPriv === 'Y') privs.push('<span class="tag">CREATE</span>');
      if (u.dropPriv === 'Y') privs.push('<span class="tag">DROP</span>');
      if (u.accountLocked === 'Y') privs.push('<span class="tag ai">LOCKED</span>');

      tbody.append(el('tr', {}, [
        el('td', { class: 'mono', html: `<b>${esc(u.user)}</b>` }),
        el('td', { class: 'mono', text: u.host }),
        el('td', { html: privs.join(' ') || '<span class="text-muted">geen globale rechten</span>' }),
        el('td', { class: 'text-muted mono', text: u.plugin || '' }),
        el('td', { style: 'white-space:nowrap;text-align:right' }, [
          el('button', {
            class: 'icon-btn', html: icon('database'), title: 'Database-rechten beheren', onclick: () => openUserDatabasePrivilegesModal(u.user, u.host)
          }),
          el('button', {
            class: 'icon-btn', html: icon('shield'), title: 'Grants bekijken', onclick: async () => {
              try {
                const grants = await api.userGrants(u.user, u.host);
                openModal({
                  title: `Grants — ${u.user}@${u.host}`,
                  body: el('pre', { class: 'code-block', text: grants.join('\n\n') || '(geen grants)' }),
                  wide: true,
                  footer: [el('button', { class: 'btn btn-primary', text: 'Kopiëren', onclick: () => copyText(grants.join('\n'), 'Grants gekopieerd') })]
                });
              } catch (err) { toast(err.message, 'error'); }
            }
          }),
          el('button', {
            class: 'icon-btn danger', html: icon('trash'), title: 'Gebruiker verwijderen', onclick: async () => {
              if (await confirmModal({ title: 'Gebruiker verwijderen', message: `Gebruiker <b class="mono">${esc(u.user)}@${esc(u.host)}</b> definitief verwijderen?`, confirmText: 'Verwijderen', danger: true })) {
                try {
                  await api.dropUser(u.user, u.host);
                  toast('Gebruiker verwijderd', 'success');
                  load();
                } catch (err) { toast(err.message, 'error', 7000); }
              }
            }
          })
        ])
      ]));
    }
    tbl.append(tbody);
    body.append(tbl);
    setStatus(`${users.length} gebruikers`);
  }

  function createUserModal() {
    const userInput = el('input', { type: 'text', spellcheck: 'false', placeholder: 'gebruikersnaam' });
    const hostInput = el('input', { type: 'text', value: '%', spellcheck: 'false' });
    const passInput = el('input', { type: 'password', placeholder: 'wachtwoord' });
    const grantChk = el('input', { type: 'checkbox' });
    const dbSel = el('select', {}, [
      el('option', { value: '', text: '— Geen database-rechten —' }),
      ...[...state.databases].sort((a, b) => a.name.localeCompare(b.name)).map(d => el('option', { value: d.name, text: d.name }))
    ]);
    const dbGrantChk = el('input', { type: 'checkbox' });
    const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'INDEX', 'CREATE VIEW', 'SHOW VIEW', 'TRIGGER', 'EVENT', 'EXECUTE', 'CREATE ROUTINE', 'ALTER ROUTINE', 'REFERENCES', 'ALL PRIVILEGES'];
    const checks = PRIVS.map(p => {
      const chk = el('input', { type: 'checkbox' });
      return { p, chk, node: el('label', { class: 'checkbox', style: 'display:inline-flex;margin:0 14px 8px 0' }, [chk, el('span', { class: 'mono', text: p })]) };
    });
    const dbChecks = DB_PRIV_LIST.map(p => {
      const chk = el('input', { type: 'checkbox' });
      return { p, chk, node: el('label', { class: 'checkbox', style: 'display:inline-flex;margin:0 14px 8px 0' }, [chk, el('span', { class: 'mono', text: p })]) };
    });
    const { close } = openModal({
      title: 'Nieuwe gebruiker aanmaken',
      body: el('div', {}, [
        el('div', { class: 'form-row-2' }, [
          el('div', { class: 'form-group' }, [el('label', { text: 'Gebruikersnaam' }), userInput]),
          el('div', { class: 'form-group' }, [el('label', { text: 'Host' }), hostInput])
        ]),
        el('div', { class: 'form-group' }, [el('label', { text: 'Wachtwoord' }), passInput]),
        el('div', { class: 'form-group' }, [
          el('label', { text: 'Rechten (globaal, *.*)' }),
          el('div', { style: 'padding:12px;background:var(--bg-1);border:1px solid var(--border);border-radius:7px' }, checks.map(c => c.node))
        ]),
        el('label', { class: 'checkbox' }, [grantChk, el('span', { text: 'WITH GRANT OPTION' })]),
        el('div', { class: 'section-title', style: 'margin-top:16px', html: `${icon('database')} Database-rechten (optioneel)` }),
        el('div', { class: 'form-group' }, [el('label', { text: 'Database' }), dbSel]),
        el('div', { class: 'form-group' }, [
          el('label', { text: 'Rechten op die database' }),
          el('div', { style: 'padding:12px;background:var(--bg-1);border:1px solid var(--border);border-radius:7px' }, dbChecks.map(c => c.node))
        ]),
        el('label', { class: 'checkbox' }, [dbGrantChk, el('span', { text: 'WITH GRANT OPTION op database' })])
      ]),
      footer: [
        el('button', {
          class: 'btn btn-primary', text: 'Aanmaken', onclick: async () => {
            if (!userInput.value.trim() || !hostInput.value.trim()) { toast('Gebruiker en host zijn verplicht', 'error'); return; }
            const db = dbSel.value;
            try {
              await api.createUser({
                user: userInput.value.trim(),
                host: hostInput.value.trim(),
                password: passInput.value,
                privileges: checks.filter(c => c.chk.checked).map(c => c.p),
                grantOption: grantChk.checked,
                database: db || undefined,
                dbPrivileges: db ? dbChecks.filter(c => c.chk.checked).map(c => c.p) : [],
                dbGrantOption: dbGrantChk.checked
              });
              toast('Gebruiker aangemaakt', 'success');
              close();
              load();
            } catch (err) { toast(err.message, 'error', 8000); }
          }
        })
      ]
    });
  }

  await load();
}
