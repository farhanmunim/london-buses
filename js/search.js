/**
 * search.js — Search input, autocomplete, and multi-route pill system
 */

import {
  fetchRouteGeoJson, fetchStopsForRoute,
  fetchRouteDestinations, fetchRouteClassification,
} from './api.js';

import { renderRoute, renderMultiRoute, clearRoute, resetMapView } from './map.js';
import { showRouteDetail, showDefaultState, showStatus, hideStatus } from './route-detail.js';

import {
  state, pillIds,
  searchInput, searchClear, autocompleteList, searchPills,
} from './state.js';

// ── Search ────────────────────────────────────────────────────────────────────

export async function doSearch(rawId) {
  const id = rawId.trim().toUpperCase();
  if (!id) return;
  if (id === state.routeId) { closeAutocomplete(); return; }

  closeAutocomplete();
  showStatus('Loading route…', 'loading');
  clearRoute();
  showDefaultState();

  try {
    const [geojson, stops, destinations, classification] = await Promise.all([
      fetchRouteGeoJson(id),
      fetchStopsForRoute(id),
      fetchRouteDestinations(id),
      fetchRouteClassification(id),
    ]);

    state.routeId       = id;
    state.routeGeoJson  = geojson;
    state.stopsFeatures = stops;
    state.direction     = '1';

    renderRoute(geojson, stops, '1');
    showRouteDetail(id, geojson, stops, destinations, classification);
    hideStatus();
  } catch (err) {
    const is404 = err.message.includes('404') || err.message.includes('HTTP 4');
    showStatus(is404 ? `Route "${id}" not found` : 'Something went wrong', 'error');
    console.error(err);
    state.routeId = null;
  }
}

// ── Pill (multi-route) system ──────────────────────────────────────────────────

export function commitPill(id) {
  if (!id || pillIds.has(id)) { searchInput.value = ''; updateSearchClear(); return; }

  // Switching from single-route → multi-route: fold current route into first pill
  if (state.routeId && !pillIds.size) {
    pillIds.add(state.routeId);
    state.routeId       = null;
    state.routeGeoJson  = null;
    state.stopsFeatures = null;
  }

  pillIds.add(id);
  searchInput.value = '';
  searchInput.placeholder = 'Add another route…';
  updateSearchClear();
  renderPillsDOM();
  applyMultiRoute();
}

export function removePill(id) {
  pillIds.delete(id);
  renderPillsDOM();
  if (pillIds.size === 0) exitMultiRoute();
  else applyMultiRoute();
}

export function clearAll() {
  pillIds.clear();
  renderPillsDOM();
  clearRoute();
  resetMapView();
  state.routeId       = null;
  state.routeGeoJson  = null;
  state.stopsFeatures = null;
  state.direction     = '1';
  searchInput.value = '';
  searchInput.placeholder = 'Search a route or click the map…';
  closeAutocomplete();
  updateSearchClear();
  showDefaultState();
}

export function updateSearchClear() {
  searchClear.hidden = !searchInput.value && pillIds.size === 0;
  document.dispatchEvent(new CustomEvent('app:searchstatechange'));
}

function renderPillsDOM() {
  searchPills.innerHTML = '';

  for (const id of pillIds) {
    const pill  = document.createElement('span');
    pill.className  = 'search-pill';
    pill.dataset.id = id;

    const label = document.createElement('span');
    label.textContent = id;

    const btn = document.createElement('button');
    btn.className = 'search-pill-remove';
    btn.type = 'button';
    btn.setAttribute('aria-label', `Remove route ${id}`);
    btn.innerHTML = '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    btn.addEventListener('click', e => { e.stopPropagation(); removePill(id); });

    pill.append(label, btn);
    searchPills.appendChild(pill);
  }

  searchPills.hidden = pillIds.size === 0;
}

function applyMultiRoute() {
  clearRoute();
  showDefaultState();
  renderMultiRoute([...pillIds]);
}

function exitMultiRoute() {
  clearRoute();
  searchInput.placeholder = 'Search a route or click the map…';
  updateSearchClear();
  showDefaultState();
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

export function renderAutocomplete(query) {
  if (!query || !state.routeIndex.length) { closeAutocomplete(); return; }
  const q = query.toUpperCase();
  const prefix = state.routeIndex.filter(id => id.startsWith(q));
  const other  = state.routeIndex.filter(id => !id.startsWith(q) && id.includes(q));
  const matches = [...prefix, ...other].slice(0, 8);

  if (!matches.length) { closeAutocomplete(); return; }

  autocompleteList.innerHTML = matches.map(id => {
    const hiId = id.replace(new RegExp(`(${escRe(q)})`, 'i'), '<mark>$1</mark>');
    const dest = state.destinations[id];
    const hint = dest?.outbound?.destination ?? dest?.inbound?.destination ?? '';
    return `<li role="option" aria-selected="false" data-value="${id}" tabindex="-1">
      <span class="ac-id">${hiId}</span>
      ${hint ? `<span class="ac-dest">${hint}</span>` : ''}
    </li>`;
  }).join('');

  autocompleteList.querySelectorAll('li').forEach(li => {
    li.addEventListener('mousedown', e => {
      e.preventDefault();
      closeAutocomplete();
      if (pillIds.size > 0) {
        commitPill(li.dataset.value);
      } else {
        searchInput.value = li.dataset.value;
        updateSearchClear();
        doSearch(li.dataset.value);
      }
    });
  });

  autocompleteList.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}

export function closeAutocomplete() {
  autocompleteList.hidden = true;
  autocompleteList.innerHTML = '';
  searchInput.setAttribute('aria-expanded', 'false');
}

function moveHighlight(delta) {
  const items = [...autocompleteList.querySelectorAll('li')];
  if (!items.length) return;
  const cur  = items.findIndex(li => li.getAttribute('aria-selected') === 'true');
  const next = Math.max(0, Math.min(items.length - 1, (cur === -1 && delta > 0 ? -1 : cur) + delta));
  items.forEach(li => li.setAttribute('aria-selected', 'false'));
  items[next].setAttribute('aria-selected', 'true');
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── Event listeners ───────────────────────────────────────────────────────────

searchInput.addEventListener('input', () => {
  updateSearchClear();
  renderAutocomplete(searchInput.value.trim());
});

searchInput.addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === ',') {
    const v = searchInput.value.trim().toUpperCase();
    if (v) { e.preventDefault(); closeAutocomplete(); commitPill(v); }

  } else if (e.key === 'Enter') {
    const sel = autocompleteList.querySelector('[aria-selected="true"]');
    const id  = (sel ? sel.dataset.value : searchInput.value).trim().toUpperCase();
    closeAutocomplete();
    if (pillIds.size > 0) { if (id) commitPill(id); }
    else doSearch(id);

  } else if (e.key === 'Backspace' && !searchInput.value && pillIds.size > 0) {
    removePill([...pillIds].at(-1));

  } else if (e.key === 'ArrowDown') { e.preventDefault(); moveHighlight(1); }
  else if (e.key === 'ArrowUp')     { e.preventDefault(); moveHighlight(-1); }
  else if (e.key === 'Escape')      { closeAutocomplete(); searchInput.blur(); }
});

searchClear.addEventListener('click', () => {
  if (pillIds.size > 0 || state.routeId) clearAll();
  else { searchInput.value = ''; closeAutocomplete(); updateSearchClear(); }
  searchInput.focus();
});

// Close autocomplete when clicking outside the search section
document.addEventListener('click', e => {
  if (!e.target.closest('#search-section')) closeAutocomplete();
});

// Route chip click from the map identify popup
document.addEventListener('map:routeclick', e => {
  const id = e.detail;
  if (pillIds.size > 0) commitPill(id);
  else { searchInput.value = id; updateSearchClear(); doSearch(id); }
});
