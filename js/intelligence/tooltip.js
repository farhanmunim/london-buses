/* Tooltip (text only — labels are data, never HTML). */
import { $ } from './dom.js';

/* ── tooltip (text only — labels are data, never HTML) ───────────────────── */
const tip = $('#tip');
export function tipShow(text, x, y){
  tip.replaceChildren();
  String(text).split('\n').forEach((line, i) => { const n = document.createElement(i === 0 ? 'b' : 'span'); n.textContent = (i ? '\n' : '') + line; tip.append(n); });
  tip.classList.add('on');
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x + 12)) + 'px';
  tip.style.top  = Math.max(8, Math.min(innerHeight - r.height - 8, y + 14)) + 'px';
}
export const tipHide = () => tip.classList.remove('on');
document.addEventListener('pointermove', e => { const t = e.target.closest?.('[data-tip]'); t ? tipShow(t.dataset.tip, e.clientX, e.clientY) : tipHide(); });
document.addEventListener('pointerleave', tipHide, true);
document.addEventListener('focusin', e => { const t = e.target.closest?.('[data-tip]'); if(t){ const r = t.getBoundingClientRect(); tipShow(t.dataset.tip, r.left + r.width / 2, r.top - 34); } });
document.addEventListener('focusout', tipHide);
addEventListener('scroll', tipHide, { passive:true });
