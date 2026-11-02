/* Tooltip box — shown on hover (desktop) or tap (touch) for elements carrying data-tip. */
import { esc } from './utils.js';

/* ── Tooltip box — shown on hover (desktop) or tap (touch) for elements carrying data-tip ── */
const tipbox = document.createElement('div');
tipbox.className = 'tipbox';
document.body.appendChild(tipbox);
let tipTarget = null;
function showTip(el){
  const raw = el.dataset.tip ?? '';
  const lines = raw.split('\n');
  tipbox.innerHTML = lines.map((l,i) => i === 0 && lines.length > 1 && !l.startsWith('Source:')
    ? `<div style="margin-bottom:3px">${esc(l)}</div>` : `<div class="src">${esc(l)}</div>`).join('');
  const r = el.getBoundingClientRect();
  tipbox.classList.add('show');
  const w = tipbox.offsetWidth, h = tipbox.offsetHeight;
  let x = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let y = r.top - h - 8; if(y < 8) y = r.bottom + 8;
  tipbox.style.left = x + 'px'; tipbox.style.top = y + 'px';
  tipTarget = el;
}
function hideTip(){ tipbox.classList.remove('show'); tipTarget = null; }
document.addEventListener('mouseover', e => { const t = e.target.closest('[data-tip]'); if(t && t !== tipTarget) showTip(t); });
document.addEventListener('mouseout',  e => { if(e.target.closest('[data-tip]')) hideTip(); });
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tip]');
  if(t){ if(t.closest('a,button') === null){ e.preventDefault(); } tipTarget === t ? hideTip() : showTip(t); }
  else hideTip();
}, true);
window.addEventListener('scroll', hideTip, { passive:true });
