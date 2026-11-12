/* View: performance at risk — reliability against standard turned into pounds using TfL's Quality Incentive
   Contract scale: for high-frequency routes each 0.1 min of excess wait better than the standard earns 1.5% of
   the contract price and each 0.1 min worse costs 1%; for low-frequency routes the same per 2 percentage points
   of on-time running; bonuses cap at +15%, deductions at −10%. Indicative, from the latest published period. */
import { D } from '../data.js';
import { $, esc } from '../dom.js';
import { fGbp, fNum, fPct, nOf, sum } from '../format.js';
import { SC } from '../state.js';

export function qicOf(r){
  if(!(r.cur?.acceptedBid > 0) || r.rel == null || r.relStd == null) return null;
  const ewt = /EWT/.test(r.relMetric);
  const steps = ewt ? (r.relStd - r.rel) / 0.1 : (r.rel - r.relStd) / 2;          // positive = better than standard
  const pct = steps >= 0 ? Math.min(15, steps * 1.5) : Math.max(-10, steps * 1.0);
  return { pct, gbp:r.cur.acceptedBid * pct / 100, steps, ewt };
}
export function renderQic(){
  const sc = SC(), rows = sc.list.map(r => ({ r, q:qicOf(r) })).filter(x => x.q), bonus = rows.filter(x => x.q.gbp > 0), pen = rows.filter(x => x.q.gbp < 0);
  const tb = sum(bonus, x => x.q.gbp), tp = sum(pen, x => x.q.gbp), net = tb + tp, value = sum(rows, x => x.r.cur.acceptedBid);
  const top = [...rows].sort((a, b) => Math.abs(b.q.gbp) - Math.abs(a.q.gbp)).slice(0, 6);
  const maxAbs = Math.max(1, ...top.map(x => Math.abs(x.q.gbp)));
  $('#qic').innerHTML = `<div class="ch"><div><h2>Performance at risk</h2><p>Reliability turned into pounds with TfL’s quality incentive scale, latest period${D.latestPeriod ? ' (' + esc(D.latestPeriod) + ')' : ''}</p></div></div>
    <div class="cb"><div class="rkpis"><div><div class="big ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${fGbp(Math.abs(net))}</div><div class="sub">net a year · ${fPct(value ? net / value * 100 : null, 1)} of contract value</div></div><div><div class="big pos">+${fGbp(tb)}</div><div class="sub">bonus on ${nOf(bonus.length, 'route')}</div></div><div><div class="big neg">−${fGbp(Math.abs(tp))}</div><div class="sub">deduction on ${nOf(pen.length, 'route')}</div></div></div>
      ${top.length ? `<div class="hh hhead qh"><span></span><span class="l">◂ Deduction</span><span class="r">Bonus ▸</span><span class="n">a year</span></div>${top.map(({ r, q }) => `<button type="button" class="hh qr" data-r="${esc(r.id)}" data-tip="Route ${esc(r.id)} · ${esc(r.from)} ⇄ ${esc(r.to)}\n${q.ewt ? 'EWT ' + fNum(r.rel, 2) + ' min vs standard ' + fNum(r.relStd, 2) : 'On time ' + fNum(r.rel, 1) + '% vs standard ' + fNum(r.relStd, 1) + '%'}\n${q.pct >= 0 ? '+' : ''}${fNum(q.pct, 1)}% of ${fGbp(r.cur.acceptedBid)} a year"><span class="nm"><span class="badge">${esc(r.id)}</span></span><span class="l">${q.gbp < 0 ? `<i style="width:${(Math.abs(q.gbp) / maxAbs * 100).toFixed(0)}%"></i>` : ''}</span><span class="r">${q.gbp > 0 ? `<i style="width:${(q.gbp / maxAbs * 100).toFixed(0)}%"></i>` : ''}</span><span class="n ${q.gbp >= 0 ? 'pos' : 'neg'}">${q.gbp >= 0 ? '+' : '−'}${fGbp(Math.abs(q.gbp))}</span></button>`).join('')}` : '<div class="sub">No routes with both a price and a reliability figure.</div>'}
      <div class="sub gnote">Indicative only: TfL’s published scale (1.5% of contract price per 0.1 min of excess wait or 2 points of on-time running better than standard, 1% per step worse, capped at +15% and −10%) applied to the latest period’s figure. Actual payments use the contract year and TfL’s own calculation.</div></div>`;
}
