/* View: market position. */
import { D } from '../data.js';
import { $, esc } from '../dom.js';
import { fDate, fGbp, fInt, fNum, fPct } from '../format.js';
import { S } from '../state.js';
import { ALL, opColour, OPS } from '../tokens.js';

/* ── view: market position ───────────────────────────────────────────────── */
const METRICS = {
  pvr:  { label:'Peak vehicles', f:s => s.pvr,   show:(s) => `${fInt(s.pvr)} · ${fPct(s.pvr / D.NET.pvr * 100, 0)}`, desc:true },
  val:  { label:'Contract value', f:s => s.value, show:(s) => `${fGbp(s.value)} · ${fPct(s.value / D.NET.value * 100, 0)}`, desc:true },
  ze:   { label:'Zero-emission', f:s => s.ze,    show:(s) => fPct(s.ze, 1), desc:true },
  lim:  { label:'Ageing out', f:s => { const F = D.FLEET[s.opKey]; return F?.limit.known ? (F.limit.soon + F.limit.at) / F.limit.known * 100 : null; }, show:(s) => fPct((D.FLEET[s.opKey].limit.soon + D.FLEET[s.opKey].limit.at) / D.FLEET[s.opKey].limit.known * 100, 0) + ' of fleet', desc:true },
  age:  { label:'Fleet age', f:s => s.age,       show:(s) => `${fNum(s.age, 1)} yrs`, desc:false },
};
export function renderMarket(){
  const m = METRICS[S.metric];
  const rows = OPS.map(o => ({ o, s:D.ST[o], v:m.f(D.ST[o]) })).filter(r => Number.isFinite(r.v)).sort((a, b) => m.desc ? b.v - a.v : a.v - b.v);
  const max = Math.max(...rows.map(r => r.v)) || 1;
  const body = S.mView === 'table'
    ? `<table class="dt"><thead><tr><th>Operator</th><th class="r">${esc(m.label)}</th><th class="r">Routes</th><th class="r">PVR</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.o)}</td><td class="r">${esc(m.show(r.s))}</td><td class="r">${r.s.n}</td><td class="r">${fInt(r.s.pvr)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="mrows">${rows.map(r => `<button class="mrow ${r.o === S.op ? 'sel' : ''}" data-op="${esc(r.o)}" data-tip="${esc(r.o)}\n${esc(m.label)}: ${esc(m.show(r.s))}\nClick to open">
        <span class="nm"><i class="dot" style="background:${opColour(r.o)}"></i><span>${esc(r.o)}</span></span><span class="tr"><i style="width:${(r.v / max * 100).toFixed(1)}%"></i></span><span class="vv">${esc(m.show(r.s))}</span></button>`).join('')}</div>`;
  $('#market').innerHTML = `<div class="ch"><div><h2>Market position</h2><p>${S.op === ALL ? 'The contracted operators compared' : esc(S.op) + ' against the other contracted operators'}${m.desc ? '' : ' (youngest first)'}</p></div>
      <div class="ctl"><div class="seg" role="group" aria-label="View"><button class="${S.mView === 'chart' ? 'on' : ''}" data-mview="chart">Chart</button><button class="${S.mView === 'table' ? 'on' : ''}" data-mview="table">Table</button></div></div>
      <div class="row2"><div class="seg" role="group" aria-label="Metric">${Object.entries(METRICS).map(([k, v]) => `<button class="${k === S.metric ? 'on' : ''}" data-metric="${k}">${v.label}</button>`).join('')}</div></div></div>
    <div class="cb">${body}${D.INCOMING.length ? `<div class="incnote">${D.INCOMING.map(x => `<span><b>${esc(x.op)}</b> is new to the network: awarded ${x.routes.length === 1 ? 'route ' : 'routes '}${esc(x.routes.slice(0, 6).join(', '))}${x.routes.length > 6 ? '…' : ''}${x.provisional ? ' (provisional)' : ''}${x.start ? ', starting ' + esc(fDate(x.start)) : ''}. It joins this list once it runs a route.</span>`).join('')}</div>` : ''}</div>`;
}
