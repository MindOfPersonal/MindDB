'use strict';

/* ============================================================
   Loginscherm: profielen + verbindingsformulier
   ============================================================ */
import { api } from './api.js';
import { el, icon, toast } from './util.js';

export function initLogin({ onConnected }) {
  const screen = document.getElementById('login-screen');
  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');
  const saveChk = document.getElementById('lf-save');
  const nameInput = document.getElementById('lf-name');

  saveChk.addEventListener('change', () => { nameInput.disabled = !saveChk.checked; if (saveChk.checked) nameInput.focus(); });

  function showError(msg) {
    errorBox.textContent = msg || '';
    errorBox.classList.toggle('visible', !!msg);
  }

  function readForm() {
    return {
      host: document.getElementById('lf-host').value.trim(),
      port: parseInt(document.getElementById('lf-port').value) || 3306,
      user: document.getElementById('lf-user').value.trim(),
      password: document.getElementById('lf-password').value,
      database: document.getElementById('lf-database').value.trim(),
      name: nameInput.value.trim()
    };
  }

  function fillForm(p) {
    document.getElementById('lf-host').value = p.host || 'localhost';
    document.getElementById('lf-port').value = p.port || 3306;
    document.getElementById('lf-user').value = p.user || 'root';
    document.getElementById('lf-database').value = p.database || '';
    document.getElementById('lf-password').value = '';
    document.getElementById('lf-password').placeholder = p.hasPassword ? '(opgeslagen wachtwoord)' : '••••••••';
    form.dataset.profileId = p.id || '';
    showError('');
  }

  async function renderProfiles() {
    const wrap = document.getElementById('login-profiles');
    let profiles = [];
    try { profiles = await api.profiles(); } catch { /* server net gestart */ }
    wrap.innerHTML = '';
    if (!profiles.length) return;

    wrap.append(el('div', { class: 'login-divider', text: 'Opgeslagen verbindingen' }));
    for (const p of profiles) {
      const item = el('div', { class: 'profile-item' }, [
        el('span', { class: 'profile-dot', style: p.color ? `background:${p.color}` : '' }),
        el('div', { class: 'profile-meta' }, [
          el('div', { class: 'profile-name', text: p.name }),
          el('div', { class: 'profile-sub', text: `${p.user}@${p.host}:${p.port}${p.database ? ' · ' + p.database : ''}` })
        ]),
        el('button', {
          class: 'icon-btn danger profile-del', html: icon('trash'), title: 'Profiel verwijderen',
          onclick: async (e) => {
            e.stopPropagation();
            await api.deleteProfile(p.id);
            renderProfiles();
            toast('Profiel verwijderd', 'success');
          }
        })
      ]);
      item.addEventListener('click', () => fillForm(p));
      item.addEventListener('dblclick', () => { fillForm(p); form.requestSubmit(); });
      wrap.append(item);
    }
    wrap.append(el('div', { class: 'login-divider', text: 'Nieuwe verbinding' }));
  }

  document.getElementById('btn-test').addEventListener('click', async () => {
    const btn = document.getElementById('btn-test');
    btn.classList.add('loading');
    showError('');
    try {
      const cfg = readForm();
      const r = await api.test({ ...cfg, profileId: form.dataset.profileId });
      toast(`Verbinding OK — ${r.server.version}`, 'success');
    } catch (err) {
      showError(err.message);
    } finally {
      btn.classList.remove('loading');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-connect');
    btn.classList.add('loading');
    showError('');
    const cfg = readForm();
    try {
      // Sla eerst profiel op (indien gewenst) zodat we een id hebben
      let profileId = form.dataset.profileId || undefined;
      if (saveChk.checked) {
        const r = await api.saveProfile({ ...cfg, id: profileId });
        profileId = r.id;
      }
      const result = await api.connect({ ...cfg, profileId });
      toast(`Verbonden met ${result.config.host} (${result.server.version})`, 'success');
      onConnected(result);
    } catch (err) {
      showError(err.message);
    } finally {
      btn.classList.remove('loading');
    }
  });

  renderProfiles();

  return {
    show() { screen.classList.remove('hidden'); renderProfiles(); },
    hide() { screen.classList.add('hidden'); }
  };
}
