'use strict';

/* ============================================================
   MindDB — bootstrap & app-shell
   ============================================================ */
import { api } from './api.js';
import { el, icon, toast, setStatus } from './util.js';
import { state, openTab, resetTabs } from './tabs.js';
import { initLogin } from './login.js';
import { initAuth, openPanelUsersModal } from './auth.js';
import { initSidebar, refreshTree, renderTree } from './sidebar.js';
import { openSqlTab } from './sql.js';
import { openDashboardTab } from './dashboard.js';

const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
let currentUser = null;

/* ---------- Welkom-tab ---------- */
export function openWelcomeTab() {
  openTab({
    id: 'welcome',
    title: 'Welkom',
    icon: 'database',
    kind: 'welcome',
    params: {},
    render: (pane) => {
      pane.append(el('div', { class: 'welcome' }, [
        el('div', { class: 'welcome-logo', html: icon('database') }),
        el('h2', { text: currentUser ? `Welkom, ${currentUser.username}` : 'Welkom bij MindDB' }),
        el('p', { text: 'Kies links een database of tabel om data te bekijken, open een query-tab om SQL uit te voeren, of bekijk het serverdashboard.' }),
        el('div', { class: 'shortcut-grid' }, [
          el('div', { class: 'shortcut', html: '<kbd>Ctrl</kbd> + <kbd>Enter</kbd> query uitvoeren' }),
          el('div', { class: 'shortcut', html: '<kbd>Ctrl</kbd> + <kbd>Spatie</kbd> autocomplete' }),
          el('div', { class: 'shortcut', html: '<kbd>Esc</kbd> filter wissen' }),
          el('div', { class: 'shortcut', html: 'dubbelklik op cel om te bewerken' })
        ]),
        el('div', { style: 'display:flex;gap:10px;margin-top:28px' }, [
          el('button', { class: 'btn btn-primary', html: `${icon('terminal')} Nieuwe query`, onclick: () => openSqlTab() }),
          el('button', { class: 'btn', html: `${icon('activity')} Dashboard`, onclick: () => openDashboardTab() })
        ])
      ]));
    }
  });
}

/* ---------- Paneelgebruiker in de UI ---------- */
function setUser(user) {
  currentUser = user;
  const avatar = document.getElementById('user-avatar');
  const name = document.getElementById('user-name');
  const role = document.getElementById('user-role');
  const adminBtn = document.getElementById('btn-panel-users');
  if (!user) {
    avatar.textContent = '?';
    name.textContent = '—';
    role.textContent = '';
    adminBtn.hidden = true;
    return;
  }
  avatar.textContent = (user.username || '?').charAt(0).toUpperCase();
  name.textContent = user.username;
  role.textContent = user.role === 'admin' ? 'Beheerder' : 'Gebruiker';
  adminBtn.hidden = user.role !== 'admin';
}

/* ---------- Verbonden ---------- */
function onConnected(result) {
  state.connected = true;
  state.connection = { config: result.config, server: result.server };
  loginScreen.classList.add('hidden');
  app.classList.remove('hidden');

  const chip = document.getElementById('conn-chip');
  chip.textContent = `${result.config.user}@${result.config.host}:${result.config.port}`;
  chip.title = `${result.server.version} · verbonden sinds ${new Date().toLocaleTimeString('nl-NL')}`;
  const mobileConn = document.getElementById('mobile-conn');
  if (mobileConn) mobileConn.textContent = `${result.config.user}@${result.config.host}`;

  document.getElementById('status-conn').innerHTML =
    `<b>${result.config.user}@${result.config.host}</b> · ${result.server.version}`;

  resetTabs();
  openWelcomeTab();
  refreshTree();
  setStatus('Verbonden');
}

/* ---------- Verbinding verbreken ---------- */
async function disconnect(showLogin = true) {
  try { await api.disconnect(); } catch { /* negeren */ }
  state.connected = false;
  state.connection = null;
  state.databases = [];
  state.tablesCache.clear();
  resetTabs();
  app.classList.add('hidden');
  if (showLogin) loginScreen.classList.remove('hidden');
  else loginScreen.classList.add('hidden');
  const mobileConn = document.getElementById('mobile-conn');
  if (mobileConn) mobileConn.textContent = '';
  setStatus('');
}

/* ---------- Sidebar breedte ---------- */
function initResizer() {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.getElementById('sidebar');
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizer.classList.add('active');
    const startX = e.clientX;
    const startW = sidebar.offsetWidth;
    const move = (ev) => {
      const w = Math.min(520, Math.max(180, startW + ev.clientX - startX));
      sidebar.style.width = w + 'px';
    };
    const up = () => {
      resizer.classList.remove('active');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

/* ---------- Knoppen ---------- */
document.getElementById('btn-disconnect').addEventListener('click', async () => {
  const { confirmModal } = await import('./util.js');
  if (await confirmModal({ title: 'Verbinding verbreken', message: 'Weet je zeker dat je de verbinding wilt sluiten?', confirmText: 'Verbreken' })) {
    disconnect();
    toast('Verbinding verbroken', 'info');
  }
});
document.getElementById('btn-new-query').addEventListener('click', () => openSqlTab());
document.getElementById('btn-logout').addEventListener('click', async () => {
  const { confirmModal } = await import('./util.js');
  if (!await confirmModal({ title: 'Uitloggen', message: 'Weet je zeker dat je wilt uitloggen?', confirmText: 'Uitloggen', danger: true })) return;
  await disconnect(false);
  try { await api.logout(); } catch { /* negeren */ }
  setUser(null);
  auth.show();
  toast('Uitgelogd', 'info');
});
document.getElementById('btn-panel-users').addEventListener('click', () => {
  openPanelUsersModal(currentUser && currentUser.id);
});

/* ---------- Mobiele navigatie ---------- */
const sidebarEl = document.getElementById('sidebar');
const navBackdrop = document.getElementById('nav-backdrop');
function openNav() { sidebarEl.classList.add('open'); navBackdrop.classList.add('show'); }
function closeNav() { sidebarEl.classList.remove('open'); navBackdrop.classList.remove('show'); }
document.getElementById('btn-menu').addEventListener('click', () => {
  if (sidebarEl.classList.contains('open')) closeNav(); else openNav();
});
navBackdrop.addEventListener('click', closeNav);
window.addEventListener('minddb:tab-open', closeNav);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
window.addEventListener('resize', () => { if (window.innerWidth > 820) closeNav(); });

/* ---------- Start ---------- */
const login = initLogin({ onConnected });
const auth = initAuth({ onAuthenticated: (user) => { setUser(user); startConnectFlow(); } });
initSidebar();
initResizer();

async function startConnectFlow() {
  auth.hide();
  loginScreen.classList.add('hidden');
  try {
    const conn = await api.connection();
    if (conn.connected) {
      onConnected({ config: conn.config, server: conn.server });
      return;
    }
  } catch { /* nog niet verbonden */ }
  login.show();
}

(async function boot() {
  try {
    const { user } = await api.me();
    if (user) {
      setUser(user);
      startConnectFlow();
      return;
    }
  } catch { /* server onbereikbaar */ }
  auth.show();
})();
