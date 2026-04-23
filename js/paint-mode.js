/**
 * paint-mode.js — "Colour routes by" segmented control.
 *
 * Two copies of the control live in the DOM (sidebar section + floating map
 * bar). Any click on a `[data-paint]` element switches the map's paint mode
 * and keeps both copies in visual sync. Persists to localStorage.
 */

import { setPaintMode } from './map.js';

const KEY = 'paint-mode';
const stored  = localStorage.getItem(KEY);
const initial = stored === 'type' ? 'type' : 'operator';

function apply(mode) {
  setPaintMode(mode);
  try { localStorage.setItem(KEY, mode); } catch (_) {}
  document.querySelectorAll('[data-paint]').forEach(b => {
    const on = b.dataset.paint === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

apply(initial);

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-paint]');
  if (!btn) return;
  apply(btn.dataset.paint);
});
