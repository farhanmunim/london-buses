/**
 * stop-search.js — Bus-stop filter input, autocomplete, and selection pill.
 *
 * When the user selects a stop the `state.selectedStop` is set and the event
 * `app:stopfilterchange` is dispatched. filters.js listens for that event and
 * re-runs the full filter pipeline (so the stop filter composes with operator,
 * route-type, frequency, etc.).
 *
 * Stops data is lazy-loaded from data/stops.json on first input focus to keep
 * the initial page load light (the file is ~6 MB uncompressed, ~1.3 MB gzipped).
 */

import { fetchStopsRegistry } from './api.js';
import {
  state,
  stopSearchInput, stopSearchClear,
  stopAutocompleteList, stopSearchPills,
} from './state.js';

// Sorted array of { id, name, indicator, routeCount, key } built once after
// stops.json loads. `key` is the lowercased name for fast substring matching.
let _stopList = null;
let _loadPromise = null;

async function loadStopsOnce() {
  if (_stopList) return _stopList;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const registry = await fetchStopsRegistry();
    const list = [];
    for (const [id, s] of Object.entries(registry)) {
      const name = s.name ?? '';
      list.push({
        id,
        name,
        indicator:  s.indicator ?? null,
        routeCount: (s.routes ?? []).length,
        key:        name.toLowerCase(),
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    _stopList = list;
    return list;
  })();
  return _loadPromise;
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c])); }

function renderAutocomplete(query) {
  if (!_stopList || !query) { closeAutocomplete(); return; }
  const q = query.toLowerCase();

  const prefix = [];
  const other  = [];
  for (const s of _stopList) {
    const idx = s.key.indexOf(q);
    if (idx === 0) prefix.push(s);
    else if (idx > 0) other.push(s);
    if (prefix.length >= 8) break; // early exit for prefix matches — list is sorted
  }
  const matches = [...prefix, ...other].slice(0, 8);
  if (!matches.length) { closeAutocomplete(); return; }

  const re = new RegExp(`(${escRe(query)})`, 'ig');
  stopAutocompleteList.innerHTML = matches.map(s => {
    const hiName = escHtml(s.name).replace(re, '<mark>$1</mark>');
    const meta = s.indicator ? `Stop ${escHtml(s.indicator)}` : `${s.routeCount} route${s.routeCount === 1 ? '' : 's'}`;
    return `<li role="option" aria-selected="false" data-id="${escHtml(s.id)}" tabindex="-1">
      <span class="ac-id">${hiName}</span>
      <span class="ac-dest">${meta}</span>
    </li>`;
  }).join('');

  stopAutocompleteList.querySelectorAll('li').forEach(li => {
    li.addEventListener('mousedown', e => {
      e.preventDefault();
      selectStop(li.dataset.id);
    });
  });

  stopAutocompleteList.hidden = false;
  stopSearchInput.setAttribute('aria-expanded', 'true');
}

function closeAutocomplete() {
  stopAutocompleteList.hidden = true;
  stopAutocompleteList.innerHTML = '';
  stopSearchInput.setAttribute('aria-expanded', 'false');
}

function selectStop(id) {
  const entry = _stopList?.find(s => s.id === id);
  if (!entry) return;
  state.selectedStop = { id: entry.id, name: entry.name };
  stopSearchInput.value = '';
  closeAutocomplete();
  renderPill();
  updateClearBtn();
  document.dispatchEvent(new CustomEvent('app:stopfilterchange'));
}

function clearStop() {
  if (!state.selectedStop) return;
  state.selectedStop = null;
  renderPill();
  updateClearBtn();
  document.dispatchEvent(new CustomEvent('app:stopfilterchange'));
}

function renderPill() {
  stopSearchPills.innerHTML = '';
  const sel = state.selectedStop;
  if (!sel) { stopSearchPills.hidden = true; return; }

  const pill = document.createElement('span');
  pill.className = 'search-pill';
  pill.dataset.id = sel.id;
  const label = document.createElement('span');
  label.textContent = sel.name;
  const btn = document.createElement('button');
  btn.className = 'search-pill-remove';
  btn.type = 'button';
  btn.setAttribute('aria-label', `Remove stop filter ${sel.name}`);
  btn.innerHTML = '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  btn.addEventListener('click', e => { e.stopPropagation(); clearStop(); });
  pill.append(label, btn);
  stopSearchPills.appendChild(pill);
  stopSearchPills.hidden = false;
}

function updateClearBtn() {
  stopSearchClear.hidden = !stopSearchInput.value && !state.selectedStop;
}

function moveHighlight(delta) {
  const items = [...stopAutocompleteList.querySelectorAll('li')];
  if (!items.length) return;
  const cur  = items.findIndex(li => li.getAttribute('aria-selected') === 'true');
  const next = Math.max(0, Math.min(items.length - 1, (cur === -1 && delta > 0 ? -1 : cur) + delta));
  items.forEach(li => li.setAttribute('aria-selected', 'false'));
  items[next].setAttribute('aria-selected', 'true');
}

// ── Event wiring ─────────────────────────────────────────────────────────────

stopSearchInput.addEventListener('focus', () => {
  // Lazy-load stops on first focus so the 6 MB file doesn't land on every page view.
  loadStopsOnce().catch(err => console.warn('Failed to load stops:', err));
});

stopSearchInput.addEventListener('input', async () => {
  updateClearBtn();
  const q = stopSearchInput.value.trim();
  if (!q) { closeAutocomplete(); return; }
  await loadStopsOnce();
  renderAutocomplete(q);
});

stopSearchInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown')   { e.preventDefault(); moveHighlight(1); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); moveHighlight(-1); }
  else if (e.key === 'Enter')     {
    const sel = stopAutocompleteList.querySelector('[aria-selected="true"]')
              ?? stopAutocompleteList.querySelector('li');
    if (sel) { e.preventDefault(); selectStop(sel.dataset.id); }
  }
  else if (e.key === 'Escape')    { closeAutocomplete(); stopSearchInput.blur(); }
});

stopSearchClear.addEventListener('click', () => {
  if (stopSearchInput.value) { stopSearchInput.value = ''; closeAutocomplete(); }
  clearStop();
  updateClearBtn();
  stopSearchInput.focus();
});

// Close autocomplete when clicking outside the stop-search section
document.addEventListener('click', e => {
  if (!e.target.closest('#stop-search-section')) closeAutocomplete();
});

// Clear-all from the global clear button should wipe the stop filter too
document.addEventListener('app:filterscleared', () => {
  stopSearchInput.value = '';
  clearStop();
  updateClearBtn();
});

// Keep the pill + clear button in sync if another module mutates
// state.selectedStop and dispatches the event.
document.addEventListener('app:stopfilterchange', () => {
  renderPill();
  updateClearBtn();
});
