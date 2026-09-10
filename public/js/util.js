'use strict';

/* ============================================================
   Gedeelde UI-utilities: iconen, formatters, toast, modal, menu
   ============================================================ */

/* ---------- SVG iconen (feather-stijl) ---------- */
const ICON_PATHS = {
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/>',
  view: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  function: '<path d="M4 17c4-10 12-10 16 0"/><circle cx="12" cy="9" r="2"/>',
  trigger: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  event: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  chevron: '<polyline points="9 18 15 12 9 6"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  kill: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
};

export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ICON_PATHS.info}</svg>`;
}

/* ---------- HTML helpers ---------- */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  const boolProps = ['checked', 'disabled', 'selected', 'readonly', 'multiple', 'required', 'autofocus'];
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (typeof v === 'boolean' && boolProps.includes(k)) node[k] = v;
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Formatters ---------- */
export function fmtBytes(n) {
  n = Number(n) || 0;
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log2(Math.abs(n)) / 10));
  return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

export function fmtNum(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('nl-NL');
}

export function fmtUptime(sec) {
  sec = Number(sec) || 0;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}u ${m}m`;
  if (h > 0) return `${h}u ${m}m`;
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function fmtMs(ms) {
  if (ms >= 1000) return (ms / 1000).toFixed(2) + ' s';
  return Math.round(ms) + ' ms';
}

export function isNumericType(t) {
  return /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|real|bit|year)/i.test(t || '');
}

export function isTextType(t) {
  return /^(char|varchar|text|tinytext|mediumtext|longtext|enum|set|json)/i.test(t || '');
}

/* ---------- Statusbalk ---------- */
export function setStatus(msg) {
  const node = document.getElementById('status-msg');
  if (node) node.textContent = msg || '';
}

/* ---------- Toasts ---------- */
export function toast(message, type = 'info', timeout = 4200) {
  const root = document.getElementById('toast-root');
  const icons = { success: 'check', error: 'alert', info: 'info' };
  const node = el('div', { class: `toast ${type}`, html: `${icon(icons[type] || 'info')}<span class="toast-msg">${esc(message)}</span>` });
  root.append(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 260);
  }, timeout);
}

/* ---------- Modal ---------- */
export function openModal({ title, body, footer, wide, onClose }) {
  const root = document.getElementById('modal-root');
  const overlay = el('div', { class: 'modal-overlay' });
  const modal = el('div', { class: `modal${wide ? ' wide' : ''}` });
  const closeBtn = el('button', { class: 'icon-btn', html: icon('x'), title: 'Sluiten' });
  const close = () => { overlay.remove(); onClose && onClose(); };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  const escHandler = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  modal.append(
    el('div', { class: 'modal-header' }, [el('h3', { text: title }), closeBtn]),
    el('div', { class: 'modal-body' }, [body]),
    footer ? el('div', { class: 'modal-footer' }, footer) : ''
  );
  overlay.append(modal);
  root.append(overlay);
  const firstInput = modal.querySelector('input:not([disabled]), textarea, select');
  if (firstInput) setTimeout(() => firstInput.focus(), 60);
  return { close, modal };
}

export function confirmModal({ title, message, confirmText = 'Bevestigen', danger = false }) {
  return new Promise(resolve => {
    const { close } = openModal({
      title,
      body: el('p', { html: message, style: 'color:var(--text-2);line-height:1.6' }),
      footer: [
        el('button', { class: 'btn btn-ghost', text: 'Annuleren', onclick: () => { close(); resolve(false); } }),
        el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmText, onclick: () => { close(); resolve(true); } })
      ]
    });
  });
}

/* ---------- Contextmenu ---------- */
let openCtx = null;
export function contextMenu(x, y, items) {
  closeContextMenu();
  const root = document.getElementById('ctx-root');
  const menu = el('div', { class: 'ctx-menu' });
  for (const item of items) {
    if (item === '-') { menu.append(el('div', { class: 'ctx-sep' })); continue; }
    menu.append(el('button', {
      class: `ctx-item${item.danger ? ' danger' : ''}`,
      html: `${item.icon ? icon(item.icon) : '<span style="width:14px"></span>'}<span>${esc(item.label)}</span>`,
      onclick: () => { closeContextMenu(); item.onClick && item.onClick(); }
    }));
  }
  root.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - rect.height - 8) + 'px';
  openCtx = menu;
  setTimeout(() => {
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEsc);
  });
}
function closeOnOutside(e) { if (openCtx && !openCtx.contains(e.target)) closeContextMenu(); }
function closeOnEsc(e) { if (e.key === 'Escape') closeContextMenu(); }
export function closeContextMenu() {
  if (openCtx) openCtx.remove();
  openCtx = null;
  document.removeEventListener('mousedown', closeOnOutside);
  document.removeEventListener('keydown', closeOnEsc);
}

/* ---------- Laad-indicator ---------- */
export function withLoading(container, promise) {
  const overlay = el('div', { class: 'loading-overlay' }, [el('div', { class: 'spinner' })]);
  container.style.position = 'relative';
  container.append(overlay);
  return promise.finally(() => overlay.remove());
}

/* ---------- Kleine helpers ---------- */
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export async function copyText(text, label = 'Gekopieerd naar klembord') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'success', 2000);
  } catch {
    toast('Kopiëren mislukt', 'error');
  }
}

export function emptyState(iconName, title, text) {
  return el('div', { class: 'empty-state', html: `${icon(iconName)}<h3>${esc(title)}</h3><p>${esc(text)}</p>` });
}
