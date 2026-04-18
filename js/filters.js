/**
 * filters.js — Filter chip handling + clear buttons.
 *
 * Reads the active chips out of #filters-section, feeds them into the map
 * layer (route overview + garage markers), updates the stat counts, and
 * shows/hides the three Clear buttons (route-only, garage-only, global).
 *
 * Side effects on import:
 *   • Installs delegated listener on #filters-section for chip clicks
 *   • Listens for app:filterscleared and app:searchstatechange events
 *   • Wires the two per-section Clear buttons
 */

import { filterOverview, filterGarages, getVisibleRouteProps } from './map.js';
import { state, filtersSection } from './state.js';
import { updateFilterStat, renderOperatorStats } from './stats.js';

// Route filter keys (everything in the main filters block except garageoperator)
const ROUTE_FILTER_KEYS = ['routetype', 'operator', 'frequency', 'deck', 'propulsion'];

function activeSet(key) {
  const chips = [...filtersSection.querySelectorAll(`.chip.active[data-filter="${key}"]`)];
  return chips.length ? new Set(chips.map(c => c.dataset.val)) : null;
}
function buildFilters() {
  return {
    types:           activeSet('routetype'),
    deck:            activeSet('deck'),
    frequency:       activeSet('frequency'),
    operator:        activeSet('operator'),
    propulsion:      activeSet('propulsion'),
    garageOperator:  activeSet('garageoperator'),
  };
}
function anyActive(key) {
  return !!filtersSection.querySelector(`.chip.active[data-filter="${key}"]`);
}
function clearChips(keys) {
  for (const key of keys) {
    filtersSection.querySelectorAll(`.chip.active[data-filter="${key}"]`).forEach(c => {
      c.classList.remove('active');
      c.setAttribute('aria-pressed', 'false');
    });
  }
  applyFilters();
}

export function applyFilters() {
  const filters = buildFilters();
  const { routeCount } = filterOverview(filters);
  filterGarages(filters.garageOperator); // independent of route filters
  updateFilterStat(routeCount);

  const visible = [...getVisibleRouteProps().entries()].map(([id, props]) => ({
    ...props,
    pvr: state.classifications[id]?.pvr ?? null,
  }));
  renderOperatorStats(visible);
  syncClearBtn();
}

// Show/hide Clear buttons:
//   • Section clears — visible only when their own chips have any active
//   • Global Clear-all — visible if any chip active OR a route is searched
function syncClearBtn() {
  const global = document.getElementById('filter-clear-btn');
  const route  = document.getElementById('clear-route-filters-btn');
  const garage = document.getElementById('clear-garage-filters-btn');

  const anyRoute  = ROUTE_FILTER_KEYS.some(anyActive);
  const anyGarage = anyActive('garageoperator');
  const anySearch = !!state.routeId || (document.getElementById('search-input')?.value.trim() ?? '') !== '';
  const anyPill   = !!document.querySelector('#search-pills .search-pill');

  if (route)  route.hidden  = !anyRoute;
  if (garage) garage.hidden = !anyGarage;
  const anyActiveAll = anyRoute || anyGarage || anySearch || anyPill;
  if (global) global.hidden = !anyActiveAll;
  const bar = document.getElementById('filter-bar');
  if (bar) bar.hidden = !anyActiveAll;

  // Count label reads 'filtered routes' / 'filtered garages' only when a
  // filter is actually narrowing the set. At rest it's a plain 'routes' /
  // 'garages' so the word 'filtered' never claims something that isn't true.
  setNoun('route',  anyRoute  ? 'filtered routes'  : 'routes');
  setNoun('garage', anyGarage ? 'filtered garages' : 'garages');
}
function setNoun(scope, text) {
  const el = document.querySelector(`.section-summary-noun[data-stat-noun="${scope}"]`);
  if (el) el.textContent = text;
}

// ── Event wiring ─────────────────────────────────────────────────────────────

filtersSection.addEventListener('click', e => {
  const chip = e.target.closest('.chip[data-filter]');
  if (!chip) return;
  chip.classList.toggle('active');
  chip.setAttribute('aria-pressed', String(chip.classList.contains('active')));
  applyFilters();
});

document.addEventListener('app:filterscleared',    applyFilters);
document.addEventListener('app:searchstatechange', syncClearBtn);

document.getElementById('clear-route-filters-btn')?.addEventListener('click', () => clearChips(ROUTE_FILTER_KEYS));
document.getElementById('clear-garage-filters-btn')?.addEventListener('click', () => clearChips(['garageoperator']));
