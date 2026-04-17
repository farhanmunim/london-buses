/**
 * toggles.js — Topbar show/hide toggles for Routes + Garages.
 *
 * Uses a tiny helper (wirePairedToggle) so the same logical toggle can drive
 * more than one button copy (e.g. topbar + in-panel). All copies stay in
 * sync on click, reflect the same aria-pressed / .active state, flip their
 * "Show/Hide <noun>" label via data-noun, and persist to localStorage.
 *
 * The routes toggle additionally listens for map-driven visibility changes —
 * when the user searches a route, the map auto-hides the faint context
 * overlay and dispatches `map:routesvisibilitychange` so the button reflects
 * the new state without persisting it.
 */

import { setRoutesVisible, setGaragesVisible, isRouteActive } from './map.js';

function wirePairedToggle({ ids, storageKey, defaultOn, apply, syncEvent, persistWhen }) {
  const buttons = ids.map(id => document.getElementById(id)).filter(Boolean);
  if (!buttons.length) return;
  const stored = localStorage.getItem(storageKey);
  const on = stored === null ? defaultOn : stored === '1';
  const updateUI = (state) => {
    for (const b of buttons) {
      b.setAttribute('aria-pressed', String(state));
      b.classList.toggle('active', state);
      const noun  = b.dataset.noun;
      const label = b.querySelector('.toggle-label');
      if (noun && label) label.textContent = `${state ? 'Hide' : 'Show'} ${noun}`;
    }
  };
  const setAll = (state) => {
    apply(state);
    updateUI(state);
    if (!persistWhen || persistWhen()) localStorage.setItem(storageKey, state ? '1' : '0');
  };
  setAll(on);
  for (const b of buttons) b.addEventListener('click', () => setAll(!(b.getAttribute('aria-pressed') === 'true')));
  if (syncEvent) document.addEventListener(syncEvent, (e) => updateUI(!!e.detail));
}

wirePairedToggle({
  ids:         ['toggle-routes-btn',  'toggle-routes-btn-side'],
  storageKey:  'routes-visible',
  defaultOn:   true,
  apply:       setRoutesVisible,
  syncEvent:   'map:routesvisibilitychange',
  persistWhen: () => !isRouteActive(),
});
wirePairedToggle({
  ids:        ['toggle-garages-btn', 'toggle-garages-btn-side'],
  storageKey: 'garages-visible',
  defaultOn:  true,
  apply:      setGaragesVisible,
});
