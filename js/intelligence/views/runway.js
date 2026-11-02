/* View: contract runway. */
import { plusMonths, TODAY, TODAY_ISO } from '../data.js';
import { $, esc } from '../dom.js';
import { fInt, fMon, fPct, nOf, sum } from '../format.js';
import { S, SC } from '../state.js';

/* ── view: contract runway ───────────────────────────────────────────────── */
function runwayBuckets(){
  const y0 = TODAY.getUTCFullYear(), all = SC().st.list, list = all.filter(r => r.cEnd && r.cEnd >= TODAY_ISO);
  const b = []; for(let y = y0; y <= y0 + 9; y++) b.push({ label:String(y), year:y, rs:[] });
  b.push({ label:`${y0 + 10}+`, year:'later', rs:[] });
  for(const r of list){ const y = +r.cEnd.slice(0, 4); (b[Math.min(y - y0, 10)] ?? b[10]).rs.push(r); }
  const limit = plusMonths(24);
  for(const x of b) x.near = x.rs.some(r => r.cEnd <= limit) && x.year !== 'later';
  const ended = all.filter(r => r.cEnd && r.cEnd < TODAY_ISO);
  return { b, ended, undated:all.filter(r => !r.cEnd).length };
}
export function renderRunway(){
  const { b, ended, undated } = runwayBuckets(); const val = x => S.rwMetric === 'pvr' ? sum(x.rs, r => r.pvr) : x.rs.length;
  const max = Math.max(1, ...b.map(val)); const s = SC().st;
  const next4 = [...s.list].filter(r => r.cEnd && r.cEnd >= TODAY_ISO).sort((a, b) => a.cEnd.localeCompare(b.cEnd) || b.pvr - a.pvr).slice(0, 4);
  const body = S.rwView === 'table'
    ? `<table class="dt"><thead><tr><th>Contracts ending</th><th class="r">Routes</th><th class="r">PVR</th></tr></thead><tbody>${b.map(x => `<tr><td>${x.label}</td><td class="r">${x.rs.length}</td><td class="r">${fInt(sum(x.rs, r => r.pvr))}</td></tr>`).join('')}</tbody></table>`
    : `<div class="cols" role="group" aria-label="Contracts ending by year">${b.map(x => `<button class="colw ${x.near ? 'near' : ''} ${S.year === x.year ? 'sel' : ''}" data-year="${x.year}" aria-label="${esc(x.label)}: ${nOf(x.rs.length, 'route')}" data-tip="${esc(x.label)}\n${nOf(x.rs.length, 'route')} · ${fInt(sum(x.rs, r => r.pvr))} PVR${x.rs.length ? '\nLargest: ' + esc([...x.rs].sort((p, q) => q.pvr - p.pvr).slice(0, 5).map(r => r.id).join(', ')) + '\nClick to filter the table' : ''}"><span class="n">${val(x) || ''}</span><span class="b" style="height:${(val(x) / max * 100).toFixed(1)}%"></span></button>`).join('')}</div>
       <div class="xl">${b.map(x => `<span>${x.label}</span>`).join('')}</div>
       <div class="legend"><span><i style="background:var(--seq-5)"></i>Ends within 24 months</span><span><i style="background:var(--seq-2)"></i>Later</span></div>
       ${next4.length ? `<h4 style="margin:18px 0 6px;font-size:12px;color:var(--ink-3);font-weight:600">Next to expire</h4>${next4.map(r => `<button class="nx" data-r="${esc(r.id)}"><span class="badge" style="height:22px;min-width:38px;font-size:11.5px">${esc(r.id)}</span><span class="cor">${esc(r.from)} <span class="sub">⇄</span> ${esc(r.to)}</span><span class="sub" style="margin-left:auto;white-space:nowrap">${fInt(r.pvr)} PVR</span><b style="min-width:76px;text-align:right;font-weight:600">${fMon(r.cEnd)}</b></button>`).join('')}` : ''}`;
  $('#runway').innerHTML = `<div class="ch"><div><h2>Contract runway</h2><p><b style="color:var(--ink)">${s.exp24.length}</b> routes (${fInt(sum(s.exp24, r => r.pvr))} PVR, ${fPct(s.pvr ? sum(s.exp24, r => r.pvr) / s.pvr * 100 : null, 0)} of the portfolio) end within 24 months${ended.length ? ` · ${ended.length} past their end date` : ''}${undated ? ` · ${undated} undated` : ''}</p></div>
      <div class="ctl"><div class="seg" role="group" aria-label="Measure"><button class="${S.rwMetric === 'routes' ? 'on' : ''}" data-rw="routes">Routes</button><button class="${S.rwMetric === 'pvr' ? 'on' : ''}" data-rw="pvr">PVR</button></div>
      <div class="seg" role="group" aria-label="View"><button class="${S.rwView === 'chart' ? 'on' : ''}" data-rwview="chart">Chart</button><button class="${S.rwView === 'table' ? 'on' : ''}" data-rwview="table">Table</button></div></div></div>
    <div class="cb">${body}</div>`;
}
