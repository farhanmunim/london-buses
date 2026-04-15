/**
 * paint-mode.js — "Colour routes by" segmented control.
 *
 * Two options: `type` (default) and `operator`. State is persisted to
 * localStorage as `paint-mode` so the user's preference survives reloads.
 */

import { setPaintMode } from './map.js';

const STORAGE_KEY = 'paint-mode';
const container = document.querySelector('.paint-mode__buttons');
if (container) {
  const stored = localStorage.getItem(STORAGE_KEY);
  const initial = stored === 'operator' ? 'operator' : 'type';

  function apply(mode) {
    setPaintMode(mode);
    localStorage.setItem(STORAGE_KEY, mode);
    container.querySelectorAll('.paint-mode__btn').forEach(b => {
      const isActive = b.dataset.mode === mode;
      b.classList.toggle('is-active', isActive);
      b.setAttribute('aria-pressed', String(isActive));
    });
  }

  apply(initial);

  container.addEventListener('click', e => {
    const btn = e.target.closest('.paint-mode__btn');
    if (!btn) return;
    apply(btn.dataset.mode);
  });
}
