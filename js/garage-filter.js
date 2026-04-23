/**
 * garage-filter.js — Sidebar pill that mirrors the bus-stop selection pattern
 * but for garage-scope filters triggered by the operator-drawer CTA.
 *
 * When the user presses "View all routes operated here" inside a garage
 * drawer, stats.js dispatches `app:garageselected` with `{ code, name,
 * operator }`. We render a pill in the "Garage" sidebar section and expose
 * a close-X that wipes the selection + routes (same effect as Clear all but
 * scoped by intent).
 *
 * Global reset (`app:resetall`) and the ×-on-pill path both funnel through
 * `clearSelection()` so the UX stays unified.
 */

import { state } from './state.js';

const section   = document.getElementById('garage-sec');
const pill      = document.getElementById('garage-selected');

function render() {
  if (!section || !pill) return;
  const g = state.selectedGarage;
  if (!g) {
    section.hidden = true;
    pill.hidden = true;
    pill.innerHTML = '';
    return;
  }
  section.hidden = false;
  pill.hidden = false;
  const sub = g.operator ? `<span style="opacity:.65;font-weight:500;margin-left:6px">${escapeHtml(g.operator)}</span>` : '';
  pill.innerHTML = `
    <span class="sb-selected-pill-label">${escapeHtml(g.name)}${sub}</span>
    <button type="button" class="sb-selected-pill-x" aria-label="Clear garage selection">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>`;
  pill.querySelector('.sb-selected-pill-x').addEventListener('click', clearSelection);
}

function clearSelection() {
  if (!state.selectedGarage) return;
  state.selectedGarage = null;
  // Ask search.js to drop the committed route pills; it'll also reset the map.
  document.dispatchEvent(new CustomEvent('app:resetall'));
  render();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Event wiring ─────────────────────────────────────────────────────────────
document.addEventListener('app:garageselected', render);
document.addEventListener('app:resetall',       () => { state.selectedGarage = null; render(); });
