/**
 * garage-filter.js — Sidebar "Garage" filter.
 *
 * Two entry points, one selection state (`state.selectedGarage`):
 *
 *   1. Dropdown picker — a searchable combobox in the sidebar listing every
 *      garage that operates ≥1 route, grouped by operator. Picking one filters
 *      the map + Routes tab to that garage's routes — the same outcome as the
 *      operator-drawer "View all routes operated here" CTA, reachable without
 *      first opening a drawer.
 *
 *   2. Drawer CTA — stats.js dispatches `app:garageselected` when the user
 *      presses "View all routes operated here" inside a garage drawer.
 *
 * Both paths render the same selected-garage pill (mirrors the bus-stop filter)
 * and route the routes through `app:selectroutes` (handled by search.js).
 * Clearing — via the pill ×, the search box ×, or global `app:resetall` —
 * funnels through `clearSelection()` so the UX stays unified.
 */

import { state } from './state.js';
import { opColor } from './map.js';

const section   = document.getElementById('garage-sec');
const pill      = document.getElementById('garage-selected');
const box       = document.getElementById('garage-filter-box');
const input     = document.getElementById('garage-filter-input');
const clearBtn  = document.getElementById('garage-filter-clear');
const list      = document.getElementById('garage-filter-list');

// Display order mirrors the Operator filter pills; anything unlisted falls to
// the end alphabetically. Long marketing names collapse to the short label.
const OP_ORDER = ['Arriva', 'First', 'Go-Ahead', 'Metroline', 'Stagecoach London', 'Transport UK', 'Uno'];
const SHORT_OP = { 'Stagecoach London': 'Stagecoach' };
const shortOp  = o => SHORT_OP[o] ?? o ?? 'Other';

// Garage options grouped by operator: [{ operator, garages: [{code,name,routeIds}] }]
let _groups = [];

/**
 * Hand the garage records + per-garage route lists in from ui.js. Builds the
 * operator-grouped option list, keeping only garages that operate ≥1 route
 * (a garage with none is useless as a route filter).
 */
export function setGarageOptions(garages, garageRoutes) {
  const byOp = new Map();
  for (const g of garages ?? []) {
    const routes = garageRoutes?.[g.code] ?? [];
    if (!routes.length) continue;
    const op = g.operator || 'Other';
    if (!byOp.has(op)) byOp.set(op, []);
    byOp.get(op).push({
      code:     g.code,
      name:     g.name || g.code,
      operator: g.operator || null,
      routeIds: routes.map(r => r.routeId),
    });
  }
  _groups = [...byOp.entries()]
    .map(([operator, gs]) => ({
      operator,
      garages: gs.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      const ia = OP_ORDER.indexOf(a.operator), ib = OP_ORDER.indexOf(b.operator);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.operator.localeCompare(b.operator);
    });
}

// ── Dropdown list ─────────────────────────────────────────────────────────────

let _acIndex = -1; // keyboard highlight across the flat option list

function closeList() {
  if (!list) return;
  list.hidden = true;
  list.innerHTML = '';
  _acIndex = -1;
}

function renderList(query) {
  if (!list) return;
  const q = (query ?? '').trim().toLowerCase();
  let html = '';
  for (const grp of _groups) {
    const hits = q
      ? grp.garages.filter(g => g.name.toLowerCase().includes(q) || g.code.toLowerCase().includes(q))
      : grp.garages;
    if (!hits.length) continue;
    html += `<li class="gf-group" role="presentation"><span class="op-dot" style="background:${opColor(grp.operator)}"></span>${escapeHtml(shortOp(grp.operator))}</li>`;
    for (const g of hits) {
      const n = g.routeIds.length;
      html += `<li role="option" aria-selected="false" data-code="${escapeHtml(g.code)}" tabindex="-1">
        <span class="gf-name">${escapeHtml(g.name)}</span>
        <span class="ac-dest">${n} route${n === 1 ? '' : 's'}</span>
      </li>`;
    }
  }
  if (!html) { closeList(); return; }
  list.innerHTML = html;
  list.querySelectorAll('li[role="option"]').forEach(li => {
    li.addEventListener('mousedown', e => { e.preventDefault(); selectGarage(li.dataset.code); });
  });
  _acIndex = -1;
  list.hidden = false;
}

function moveHighlight(delta) {
  if (!list || list.hidden) return;
  const items = [...list.querySelectorAll('li[role="option"]')];
  if (!items.length) return;
  _acIndex = Math.max(0, Math.min(items.length - 1, (_acIndex === -1 && delta > 0 ? -1 : _acIndex) + delta));
  items.forEach((li, i) => li.setAttribute('aria-selected', String(i === _acIndex)));
  items[_acIndex]?.scrollIntoView({ block: 'nearest' });
}

// ── Selection ─────────────────────────────────────────────────────────────────

function findGarage(code) {
  for (const grp of _groups) {
    const g = grp.garages.find(x => x.code === code);
    if (g) return g;
  }
  return null;
}

function selectGarage(code) {
  const g = findGarage(code);
  if (!g) return;
  state.selectedGarage = { code: g.code, name: g.name, operator: g.operator };
  if (input) input.value = '';
  closeList();
  render();
  // Same outcome as the drawer CTA: pill + route selection go hand in hand.
  document.dispatchEvent(new CustomEvent('app:selectroutes', { detail: g.routeIds }));
}

function clearSelection() {
  if (input) input.value = '';
  if (clearBtn) clearBtn.hidden = true;
  closeList();
  if (!state.selectedGarage) { render(); return; }
  state.selectedGarage = null;
  // Ask search.js to drop the committed route pills; it'll also reset the map.
  document.dispatchEvent(new CustomEvent('app:resetall'));
  render();
}

// ── Render ────────────────────────────────────────────────────────────────────
// When a garage is selected we swap the search box for the selection pill;
// clearing brings the box back. The section itself is always visible.

function render() {
  if (!section || !pill) return;
  const g = state.selectedGarage;
  const selected = !!g;
  if (box)  box.hidden  = selected;
  if (pill) pill.hidden = !selected;
  if (!selected) { pill.innerHTML = ''; return; }

  const sub = g.operator ? `<span style="opacity:.65;font-weight:500;margin-left:6px">${escapeHtml(shortOp(g.operator))}</span>` : '';
  pill.innerHTML = `
    <span class="sb-selected-pill-label">${escapeHtml(g.name)}${sub}</span>
    <button type="button" class="sb-selected-pill-x" aria-label="Clear garage selection">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>`;
  pill.querySelector('.sb-selected-pill-x').addEventListener('click', clearSelection);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Event wiring ─────────────────────────────────────────────────────────────

input?.addEventListener('focus', () => renderList(input.value));
input?.addEventListener('input', () => {
  if (clearBtn) clearBtn.hidden = !input.value;
  renderList(input.value);
});
input?.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown')      { e.preventDefault(); if (list?.hidden) renderList(input.value); else moveHighlight(1); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); moveHighlight(-1); }
  else if (e.key === 'Enter') {
    const sel = list?.querySelector('[aria-selected="true"]');
    if (sel) { e.preventDefault(); selectGarage(sel.dataset.code); }
  } else if (e.key === 'Escape')  { closeList(); input.blur(); }
});
clearBtn?.addEventListener('click', () => { clearSelection(); input?.focus(); });

// Close the list on an outside click (mirrors stop-search).
document.addEventListener('click', e => {
  if (!e.target.closest('#garage-filter-box, #garage-filter-list')) closeList();
});

// Drawer CTA path — stats.js sets state.selectedGarage then dispatches this.
document.addEventListener('app:garageselected', render);
document.addEventListener('app:resetall', () => {
  state.selectedGarage = null;
  if (input) input.value = '';
  if (clearBtn) clearBtn.hidden = true;
  closeList();
  render();
});
