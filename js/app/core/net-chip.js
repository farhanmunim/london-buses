/* Network status chip (topbar, desktop). */
import { D } from './data.js';
import { nOf } from './utils.js';

/* ── Network status chip (topbar, desktop) ────────────────────────────── */
D.lineStatus().then(ls => {
  const s = ls?.summary; if(!s) return;
  const chip = document.getElementById('netChip');
  document.getElementById('netChipText').textContent =
    s.disrupted ? `${s.good}/${s.total} on good service` : `All ${nOf(s.total, 'route')} on good service`;
  chip.classList.toggle('bad', s.disrupted > 0);
  chip.hidden = false;
});
