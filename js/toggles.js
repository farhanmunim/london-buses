/**
 * toggles.js — Topbar show/hide toggles for Routes + Garages.
 *
 * Uses a tiny helper (wirePairedToggle) so the same logical toggle can drive
 * more than one button copy (e.g. topbar + in-panel). All copies stay in
 * sync on click, reflect the same aria-pressed / .active state, flip their
 * "Show/Hide <noun>" label via data-noun, and persist to localStorage.
 */

import { setRoutesVisible, setGaragesVisible } from './map.js';

function wirePairedToggle({ ids, storageKey, defaultOn, apply }) {
  const buttons = ids.map(id => document.getElementById(id)).filter(Boolean);
  if (!buttons.length) return;
  const stored = localStorage.getItem(storageKey);
  const on = stored === null ? defaultOn : stored === '1';
  const setAll = (state) => {
    for (const b of buttons) {
      b.setAttribute('aria-pressed', String(state));
      b.classList.toggle('active', state);
      const noun  = b.dataset.noun;
      const label = b.querySelector('.toggle-label');
      if (noun && label) label.textContent = `${state ? 'Hide' : 'Show'} ${noun}`;
    }
    apply(state);
    localStorage.setItem(storageKey, state ? '1' : '0');
  };
  setAll(on);
  for (const b of buttons) b.addEventListener('click', () => setAll(!(b.getAttribute('aria-pressed') === 'true')));
}

wirePairedToggle({
  ids:        ['toggle-routes-btn',  'toggle-routes-btn-side'],
  storageKey: 'routes-visible',
  defaultOn:  true,
  apply:      setRoutesVisible,
});
wirePairedToggle({
  ids:        ['toggle-garages-btn', 'toggle-garages-btn-side'],
  storageKey: 'garages-visible',
  defaultOn:  true,
  apply:      setGaragesVisible,
});
