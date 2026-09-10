'use strict';

/* ============================================================
   Paneel-authenticatie: inloggen, registreren, gebruikersbeheer
   ============================================================ */
import { api } from './api.js';
import { el, icon, toast, openModal, confirmModal, esc } from './util.js';

function showError(node, msg) {
  node.textContent = msg || '';
  node.classList.toggle('visible', !!msg);
}

export function initAuth({ onAuthenticated }) {
  const screen = document.getElementById('auth-screen');
  const tabs = [...screen.querySelectorAll('.auth-tab')];
  const loginForm = document.getElementById('auth-login-form');
  const registerForm = document.getElementById('auth-register-form');
  const loginError = document.getElementById('auth-login-error');
  const registerError = document.getElementById('auth-register-error');
  const allowNote = document.getElementById('auth-allow-note');

  function selectTab(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    loginForm.classList.toggle('hidden', name !== 'login');
    registerForm.classList.toggle('hidden', name !== 'register');
    const first = (name === 'login' ? loginForm : registerForm).querySelector('input');
    if (first) setTimeout(() => first.focus(), 50);
  }
  tabs.forEach(t => t.addEventListener('click', () => selectTab(t.dataset.tab)));

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('al-submit');
    btn.disabled = true;
    showError(loginError, '');
    try {
      const { user } = await api.login({
        identifier: document.getElementById('al-identifier').value.trim(),
        password: document.getElementById('al-password').value,
        remember: document.getElementById('al-remember').checked
      });
      screen.classList.add('hidden');
      toast(`Welkom terug, ${user.username}!`, 'success');
      onAuthenticated(user);
    } catch (err) {
      showError(loginError, err.message);
    } finally {
      btn.disabled = false;
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('ar-submit');
    const password = document.getElementById('ar-password').value;
    const confirm = document.getElementById('ar-password2').value;
    if (password !== confirm) { showError(registerError, 'Wachtwoorden komen niet overeen'); return; }
    btn.disabled = true;
    showError(registerError, '');
    try {
      const { user } = await api.register({
        username: document.getElementById('ar-username').value.trim(),
        email: document.getElementById('ar-email').value.trim(),
        password
      });
      screen.classList.add('hidden');
      toast(`Account aangemaakt. Welkom, ${user.username}!`, 'success');
      onAuthenticated(user);
    } catch (err) {
      showError(registerError, err.message);
    } finally {
      btn.disabled = false;
    }
  });

  /* Configuratie: registratie aan/uit */
  api.authConfig().then(cfg => {
    const registerTab = tabs.find(t => t.dataset.tab === 'register');
    if (!cfg.allowRegistration) {
      registerTab.classList.add('hidden');
      if (allowNote) allowNote.classList.add('hidden');
    }
  }).catch(() => {});

  return {
    show() {
      screen.classList.remove('hidden');
      selectTab('login');
      document.getElementById('al-identifier').focus();
    },
    hide() { screen.classList.add('hidden'); }
  };
}

/* ============================================================
   Beheer van paneelgebruikers (admin)
   ============================================================ */
export async function openPanelUsersModal(currentUserId) {
  const body = el('div', {});

  async function reload() {
    body.innerHTML = '';
    body.append(el('div', { class: 'loading-overlay' }, [el('div', { class: 'spinner' })]));
    let users;
    try {
      users = await api.panelUsers();
    } catch (err) {
      body.innerHTML = '';
      body.append(el('div', { class: 'empty-state', html: `${icon('alert')}<h3>Fout</h3><p>${esc(err.message)}</p>` }));
      return;
    }
    body.innerHTML = '';
    const tbl = el('table', { class: 'def' });
    tbl.append(el('thead', {}, [el('tr', {}, [
      el('th', { text: '' }), el('th', { text: 'Gebruiker' }), el('th', { text: 'E-mail' }),
      el('th', { text: 'Rol' }), el('th', { text: 'Aangemaakt' }), el('th', { text: 'Laatste login' }), el('th', { text: '' })
    ])]));
    const tbody = el('tbody');
    for (const u of users) {
      const roleSel = el('select', {}, ['admin', 'user'].map(r =>
        el('option', { value: r, text: r, selected: r === u.role })));
      roleSel.addEventListener('change', async () => {
        try {
          await api.setPanelUserRole(u.id, roleSel.value);
          toast(`Rol van ${u.username} gewijzigd naar ${roleSel.value}`, 'success');
        } catch (err) { toast(err.message, 'error'); reload(); }
      });

      const isSelf = Number(u.id) === Number(currentUserId);
      tbody.append(el('tr', {}, [
        el('td', {}, [el('div', { class: 'user-avatar small', html: esc((u.username || '?').charAt(0).toUpperCase()) })]),
        el('td', { class: 'mono', html: `<b>${esc(u.username)}</b>${isSelf ? ' <span class="tag">jij</span>' : ''}` }),
        el('td', { class: 'text-muted', text: u.email || '—' }),
        el('td', {}, [roleSel]),
        el('td', { class: 'text-muted', text: u.createdAt ? new Date(u.createdAt).toLocaleDateString('nl-NL') : '—' }),
        el('td', { class: 'text-muted', text: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('nl-NL') : 'nooit' }),
        el('td', { style: 'text-align:right' }, [
          isSelf ? '' : el('button', {
            class: 'icon-btn danger', html: icon('trash'), title: 'Gebruiker verwijderen',
            onclick: async () => {
              if (await confirmModal({ title: 'Gebruiker verwijderen', message: `Paneelaccount <b class="mono">${esc(u.username)}</b> verwijderen?`, confirmText: 'Verwijderen', danger: true })) {
                try { await api.deletePanelUser(u.id); toast('Gebruiker verwijderd', 'success'); reload(); }
                catch (err) { toast(err.message, 'error'); }
              }
            }
          })
        ])
      ]));
    }
    tbl.append(tbody);
    body.append(tbl);
  }

  const { close } = openModal({
    title: 'Paneelgebruikers',
    body,
    wide: true,
    footer: [el('button', { class: 'btn btn-ghost', text: 'Sluiten', onclick: () => close() })]
  });

  reload();
}
