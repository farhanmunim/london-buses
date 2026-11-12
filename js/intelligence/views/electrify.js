/* View: electrification tracker — the electric share of peak buses today, where awards already made take it
   by year, and the buses reaching TfL's age limit that must be replaced along the way. */
import { D, TODAY, TODAY_ISO } from '../data.js';
import { $, esc } from '../dom.js';
import { fInt, fPct, nOf, sum } from '../format.js';
import { SC } from '../state.js';
import { AGE_LIMIT, propClass } from '../tokens.js';

const isZero = a => propClass(a?.vehicle?.propulsion) === 'zero' || /electric|hydrogen/i.test(a?.vehicle?.raw ?? '');
export function electrifySeries(sc){
  const y0 = TODAY.getUTCFullYear(), list = sc.list, pvr = sum(list, r => r.pvr);
  const zeroNow = sum(list.filter(r => propClass(r.prop) === 'zero'), r => r.pvr);
  // committed conversions: awards on these routes, not yet started, on electric buses, where the route is not electric yet
  const commits = list.filter(r => propClass(r.prop) !== 'zero' && r.award?.contractStart && r.award.contractStart > TODAY_ISO && isZero(r.award) && (sc.kind !== 'op' || D.grp(r.award.operator) === sc.op))
    .map(r => ({ r, y:+r.award.contractStart.slice(0, 4), pvr:r.award.pvr ?? r.pvr }));
  const F = sc.F, limit = F?.limit;
  const years = Array.from({ length:5 }, (_, i) => y0 + i).map(y => {
    const added = sum(commits.filter(c => c.y <= y), c => c.pvr);
    const row = limit?.rows?.find(x => x.label === String(y));
    return { y, share:pvr ? (zeroNow + added) / pvr * 100 : null, added, routes:commits.filter(c => c.y === y).map(c => c.r.id), ageOut:y === y0 ? (limit?.over ?? 0) + (row?.n ?? 0) : (row?.n ?? 0) };
  });
  return { years, pvr, zeroNow, commits, known:limit?.known ?? 0 };
}
export function renderElectrify(){
  const sc = SC(), { years, pvr, zeroNow, commits, known } = electrifySeries(sc);
  const last = years.at(-1), gain = last.share - years[0].share;
  const maxAge = Math.max(1, ...years.map(y => y.ageOut));
  $('#electrify').innerHTML = `<div class="ch"><div><h2>Electrification</h2><p>Electric peak buses ${sc.kind === 'all' ? 'across London' : 'at ' + esc(sc.name)} today and as awarded contracts convert routes, against the buses reaching ${AGE_LIMIT} years</p></div></div>
    <div class="cb"><div class="rkpis"><div><div class="big">${fPct(years[0].share, 0)}</div><div class="sub">of peak buses electric today · ${fInt(zeroNow)} of ${fInt(pvr)}</div></div><div><div class="big">${fPct(last.share, 0)}</div><div class="sub">by ${last.y} on awards already made${gain > 0 ? ` <span class="delta up">▲ ${gain.toFixed(0)} pts</span>` : ''}</div></div><div><div class="big">${fInt(sum(commits, c => c.pvr))}</div><div class="sub">peak buses switching on ${nOf(commits.length, 'route')} awarded</div></div></div>
      <div class="erows">${years.map(y => `<div class="erow" data-tip="${y.y}\nElectric share: ${fPct(y.share, 1)}${y.routes.length ? '\nConverting: ' + esc(y.routes.join(', ')) : ''}\nBuses reaching ${AGE_LIMIT} years: ${fInt(y.ageOut)}"><span class="ey">${y.y}</span><span class="eshare"><i style="width:${(y.share ?? 0).toFixed(1)}%"></i><b>${fPct(y.share, 0)}</b></span><span class="eage"><i style="width:${(y.ageOut / maxAge * 100).toFixed(0)}%"></i><b>${fInt(y.ageOut)}</b></span></div>`).join('')}</div>
      <div class="legend"><span><i style="background:var(--zero)"></i>Electric share of peak buses</span><span><i style="background:var(--warn)"></i>Buses reaching ${AGE_LIMIT} years that year${known ? ` (of ${fInt(known)} dated)` : ''}</span></div>
      <div class="sub gnote">Conversions count when a route not yet electric has been awarded on electric buses and that contract starts in the year. Tenders not yet awarded are not assumed. Age-outs are from the registered fleet by first-registration year.</div></div>`;
}
