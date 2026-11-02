/* Command palette. */
import { D } from '../data.js';
import { $, esc } from '../dom.js';
import { openRoute } from '../drawer/drawer.js';
import { natKey, nOf } from '../format.js';
import { ALL, opColour, OPS } from '../tokens.js';
import { setGarage, setOp } from './actions.js';
import { shortOp } from '../views/hero.js';

export function setPalIdx(v){ palIdx = v; }

/* ── command palette & menus ─────────────────────────────────────────────── */
export let palIdx = 0, palItems = [];
export function palRender(){
  const q = $('#palIn').value.trim().toLowerCase();
  const ops = [ALL, ...OPS].filter(o => !q || o.toLowerCase().includes(q) || (o === ALL && 'network london'.includes(q))).slice(0, 9).map(o => ({ t:'op', o }));
  const gars = q ? D.garages.filter(g => D.DEPOTS[ALL].some(d => d.code === g.code) && `${g.name} ${g.code} garage`.toLowerCase().includes(q)).slice(0, 5).map(g => ({ t:'gar', g })) : [];
  const rs = q ? D.routes.filter(r => r.id.toLowerCase().startsWith(q) || `${r.from} ${r.to}`.toLowerCase().includes(q)).sort((a, b) => (b.id.toLowerCase() === q) - (a.id.toLowerCase() === q) || natKey(a.id).localeCompare(natKey(b.id))).slice(0, 8).map(r => ({ t:'route', r })) : [];
  palItems = [...ops, ...gars, ...rs]; palIdx = Math.min(palIdx, Math.max(0, palItems.length - 1));
  let html = '', g = '';
  palItems.forEach((it, i) => {
    if(it.t !== g){ g = it.t; html += `<li class="grp">${g === 'op' ? 'Scope' : g === 'gar' ? 'Garages' : 'Routes'}</li>`; }
    html += it.t === 'op'
      ? `<li><button data-pi="${i}" class="${i === palIdx ? 'act' : ''}"><i class="dot" style="background:${it.o === ALL ? '#2a78d6' : opColour(it.o)}"></i><b style="font-weight:550">${esc(it.o)}</b><span class="sub" style="margin-left:auto">${nOf(D.ST[it.o].n, 'route')}</span></button></li>`
      : it.t === 'gar' ? `<li><button data-pi="${i}" class="${i === palIdx ? 'act' : ''}"><i class="dot" style="background:${opColour(it.g.operator)}"></i><b style="font-weight:550">${esc(it.g.name)}</b><span class="sub">${esc(it.g.code)}</span><span class="sub" style="margin-left:auto">${esc(shortOp(it.g.operator))}</span></button></li>`
      : `<li><button data-pi="${i}" class="${i === palIdx ? 'act' : ''}"><span class="badge" style="height:22px;min-width:36px;font-size:11.5px">${esc(it.r.id)}</span><span>${esc(it.r.from)} ⇄ ${esc(it.r.to)}</span><span class="sub" style="margin-left:auto">${esc(it.r.op)}</span></button></li>`;
  });
  $('#palList').innerHTML = html || '<li class="empty">No matches</li>';
  $('#palList .act')?.scrollIntoView({ block:'nearest' });
}
export function palOpen(){ $('#pal').hidden = false; $('#palIn').value = ''; palIdx = 0; palRender(); $('#palIn').focus(); }
export function palClose(){ $('#pal').hidden = true; }
export function palPick(i){ const it = palItems[i]; if(!it) return; palClose(); if(it.t === 'op') setOp(it.o); else if(it.t === 'gar') setGarage(it.g.code); else openRoute(it.r.id); }
