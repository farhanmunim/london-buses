/* Operator and garage scope menus. */
import { D } from '../data.js';
import { $, esc } from '../dom.js';
import { fPct, nOf } from '../format.js';
import { S } from '../state.js';
import { ALL, opColour, OPS } from '../tokens.js';
import { shortOp } from '../views/hero.js';

export function menuRender(){
  const row = (o, dot, mt) => `<button role="option" aria-current="${o === S.op}" data-op="${esc(o)}"><i class="dot" style="background:${dot}"></i><span class="nm">${esc(o)}</span><span class="mt">${mt}</span></button>`;
  $('#opMenu').innerHTML = row(ALL, '#2a78d6', `${nOf(D.NET.n, 'route')} · ${nOf(OPS.length, 'operator')}`) + '<div class="msep"></div>' + OPS.map(o => row(o, opColour(o), `${nOf(D.ST[o].n, 'route')} · ${fPct(D.ST[o].pvr / D.NET.pvr * 100, 0)}`)).join('');
  gMenuRender();
}
export function gMenuRender(){
  const q = ($('#gq')?.value ?? '').trim().toLowerCase();
  const rows = D.DEPOTS[S.op].filter(d => !q || `${d.name} ${d.code} ${d.g?.operator ?? ''}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  $('#gList').innerHTML = `<button role="option" aria-current="${!S.garage}" data-gar=""><span class="nm">All garages</span><span class="mt">${D.DEPOTS[S.op].length} · ${S.op === ALL ? 'whole network' : esc(shortOp(S.op))}</span></button>`
    + rows.map(d => `<button role="option" aria-current="${d.code === S.garage}" data-gar="${esc(d.code)}"><i class="dot" style="background:${opColour(d.g?.operator)}"></i><span class="nm">${esc(d.name)} <span class="sub">${esc(d.code)}</span></span><span class="mt">${nOf(d.routes, 'route')} · ${d.pvr} PVR${d.util != null ? ' · ' + Math.round(d.util * 100) + '%' : ''}</span></button>`).join('')
    || '<div class="empty" style="padding:16px">No garages match.</div>';
}
