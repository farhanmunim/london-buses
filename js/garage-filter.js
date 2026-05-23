/**
 * garage-filter.js — Sidebar "Garage" filter.
 *
 * A stackable, intersecting filter (modelled on the bus-stop filter) presented
 * as a native <select> dropdown: garages are grouped under their operator
 * (<optgroup> labels), with operators and garages both in alphabetical order.
 * Picking one sets `state.selectedGarage` (carrying the garage's route ids) and
 * re-runs `applyFilters()`, so it combines with Operator / Route Type /
 * Propulsion / Frequency / Deck and narrows the routes-shown count like every
 * other left-panel filter. The "All garages" option clears it.
 *
 * Two entry points, one selection state:
 *   1. The dropdown here.
 *   2. The garage drawer's "View all routes operated here" CTA — stats.js sets
 *      state.selectedGarage + dispatches `app:garageselected` (we mirror it onto
 *      the <select>) and triggers a filter pass via `app:filterschanged`.
 *
 * Clearing — "All garages", the scoped Clear button (`app:garagecleared`), or
 * global `app:resetall` — funnels through the same path and re-filters.
 */

import { state } from './state.js';
import { applyFilters } from './filters.js';

const select = document.getElementById('garage-filter-select');

const SHORT_OP = { 'Stagecoach London': 'Stagecoach' };
const shortOp  = o => SHORT_OP[o] ?? o ?? 'Other';

// code → garage record (incl. routeIds), for O(1) lookup on change.
const _byCode = new Map();

/**
 * Hand the garage records + per-garage route lists in from ui.js. Builds the
 * grouped <option> list, keeping only garages that operate ≥1 route (a garage
 * with none is useless as a route filter).
 */
export function setGarageOptions(garages, garageRoutes) {
  _byCode.clear();
  const byOp = new Map();
  for (const g of garages ?? []) {
    const routes = garageRoutes?.[g.code] ?? [];
    if (!routes.length) continue;
    const rec = { code: g.code, name: g.name || g.code, operator: g.operator || null, routeIds: routes.map(r => r.routeId) };
    _byCode.set(g.code, rec);
    const op = g.operator || 'Other';
    if (!byOp.has(op)) byOp.set(op, []);
    byOp.get(op).push(rec);
  }
  // Operators alphabetical (by display label); garages alphabetical within each.
  const groups = [...byOp.entries()]
    .map(([operator, gs]) => ({ label: shortOp(operator), garages: gs.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  renderOptions(groups);
}

function renderOptions(groups) {
  if (!select) return;
  const html = ['<option value="">All garages</option>'];
  for (const grp of groups) {
    html.push(`<optgroup label="${escapeHtml(grp.label)}">`);
    for (const g of grp.garages) html.push(`<option value="${escapeHtml(g.code)}">${escapeHtml(g.name)}</option>`);
    html.push('</optgroup>');
  }
  select.innerHTML = html.join('');
  syncToState();
}

// ── Selection ─────────────────────────────────────────────────────────────────

function onChange() {
  const g = _byCode.get(select.value);
  if (!g) { clearSelection(); return; }
  // routeIds ride along on the selection so the filter pipeline can intersect
  // without re-deriving them (mirrors how the stop filter carries its routes).
  state.selectedGarage = { code: g.code, name: g.name, operator: g.operator, routeIds: g.routeIds };
  applyFilters(); // intersect with any other active filters
}

function clearSelection() {
  if (!state.selectedGarage) { syncToState(); return; }
  state.selectedGarage = null;
  syncToState();
  applyFilters(); // scoped clear — leaves other filters untouched
}

// Keep the <select> showing whatever is in state — covers the drawer-CTA path,
// the scoped Clear button, and global reset, all of which mutate the state.
function syncToState() {
  if (!select) return;
  const want = state.selectedGarage?.code ?? '';
  if (select.value !== want) select.value = want;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Event wiring ─────────────────────────────────────────────────────────────

select?.addEventListener('change', onChange);

// Drawer CTA path — stats.js sets state.selectedGarage (with routeIds) and
// dispatches this; filters re-run via its own app:filterschanged. We only
// mirror the selection onto the <select>.
document.addEventListener('app:garageselected', syncToState);
// Scoped clear from the sidebar Clear button — state already nulled by filters.js.
document.addEventListener('app:garagecleared', syncToState);
document.addEventListener('app:resetall', () => { state.selectedGarage = null; syncToState(); });
