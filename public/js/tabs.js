'use strict';

/* ============================================================
   Tabbeheer: centrale store + tabbar + panes
   ============================================================ */
import { el, icon } from './util.js';

export const state = {
  connected: false,
  connection: null,       // { config, server }
  databases: [],          // [{name, tables, size, ...}]
  tablesCache: new Map(), // db -> tables[]
  openTabs: [],           // [{id, title, icon, kind, params, render, el}]
  activeTab: null,
  currentDb: null         // laatst geselecteerde database (voor SQL-tab)
};

const listeners = new Set();
export function onStateChange(fn) { listeners.add(fn); }
function emit() { listeners.forEach(fn => fn(state)); }

let tabSeq = 0;

export function openTab({ id, title, icon: iconName, kind, params = {}, render }) {
  const existing = state.openTabs.find(t => t.id === id);
  if (existing) { activateTab(id); return existing; }
  const tab = { id: id || `tab-${++tabSeq}`, title, icon: iconName, kind, params, render, pane: null };
  state.openTabs.push(tab);
  renderTabbar();
  activateTab(tab.id);
  emit();
  return tab;
}

export function closeTab(id) {
  const idx = state.openTabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  const tab = state.openTabs[idx];
  if (tab.pane) tab.pane.remove();
  tab.onClose && tab.onClose();
  state.openTabs.splice(idx, 1);
  if (state.activeTab === id) {
    const next = state.openTabs[Math.min(idx, state.openTabs.length - 1)];
    state.activeTab = next ? next.id : null;
  }
  renderTabbar();
  renderPanes();
  emit();
}

export function activateTab(id) {
  state.activeTab = id;
  const tab = state.openTabs.find(t => t.id === id);
  if (tab && !tab.pane) mountPane(tab);
  renderTabbar();
  renderPanes();
  emit();
  window.dispatchEvent(new Event('minddb:tab-open'));
}

export function getTab(id) { return state.openTabs.find(t => t.id === id); }

export function renameTab(id, title) {
  const tab = getTab(id);
  if (tab) { tab.title = title; renderTabbar(); }
}

function mountPane(tab) {
  const content = document.getElementById('tab-content');
  const pane = el('div', { class: 'tab-pane', 'data-tab': tab.id });
  tab.pane = pane;
  content.append(pane);
  Promise.resolve(tab.render(pane, tab)).catch(err => {
    pane.innerHTML = '';
    pane.append(el('div', { class: 'empty-state', html: `<h3>Fout bij laden</h3><p>${err.message}</p>` }));
  });
}

function renderTabbar() {
  const bar = document.getElementById('tabbar');
  bar.innerHTML = '';
  for (const tab of state.openTabs) {
    const node = el('div', { class: `tab${tab.id === state.activeTab ? ' active' : ''}`, title: tab.title }, [
      el('span', { html: icon(tab.icon || 'table', 'tab-icon') }),
      el('span', { text: tab.title }),
      el('button', {
        class: 'tab-close', html: '×', title: 'Sluiten',
        onclick: (e) => { e.stopPropagation(); closeTab(tab.id); }
      })
    ]);
    node.addEventListener('click', () => activateTab(tab.id));
    node.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } });
    bar.append(node);
  }
}

function renderPanes() {
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.dataset.tab === state.activeTab);
  });
}

export function resetTabs() {
  for (const t of [...state.openTabs]) closeTab(t.id);
}

/* Vernieuw de actieve tab (bijv. na structurele wijziging) */
export function refreshTab(id) {
  const tab = getTab(id || state.activeTab);
  if (!tab || !tab.pane) return;
  tab.pane.innerHTML = '';
  Promise.resolve(tab.render(tab.pane, tab)).catch(err => {
    tab.pane.append(el('div', { class: 'empty-state', html: `<h3>Fout bij laden</h3><p>${err.message}</p>` }));
  });
}
