/* View: secured revenue — annual contract value plotted forward: what is secured in each year, what ends in it,
   and what has already been won and starts by then. The shape finance people read at a glance. */
import { D, TODAY } from '../data.js';
import { $, esc } from '../dom.js';
import { fGbp, fPct, nOf, sum } from '../format.js';
import { SC } from '../state.js';

export function revenueSeries(sc){
  const y0 = TODAY.getUTCFullYear(), years = Array.from({ length:8 }, (_, i) => y0 + i);
  const list = sc.list, priced = list.filter(r => r.cur?.acceptedBid > 0 && r.cEnd);
  const unpriced = list.length - priced.length;
  // contracts already won by this scope's operator that have not started (op scope), or any awarded-not-started (all)
  const won = D.routes.filter(r => r.award?.contractStart && r.award.contractStart > TODAY.toISOString().slice(0, 10) && r.award.acceptedBid > 0
    && (sc.kind === 'all' ? true : sc.kind === 'op' ? D.grp(r.award.operator) === sc.op && r.award.operatorChange : sc.ids.has(r.id) && D.grp(r.award.operator) === sc.op));
  const rows = years.map(y => {
    const end = `${y}-12-31`, start = `${y}-01-01`;
    const secured = sum(priced.filter(r => r.cEnd > end), r => r.cur.acceptedBid);
    const ending = sum(priced.filter(r => r.cEnd >= start && r.cEnd <= end), r => r.cur.acceptedBid);
    const gained = sum(won.filter(r => r.award.contractStart <= end && (!r.award.contractEnd || r.award.contractEnd > end)), r => r.award.acceptedBid);
    return { y, secured, ending, gained, total:secured + ending + gained };
  });
  return { rows, unpriced, base:sum(priced, r => r.cur.acceptedBid) };
}

export function renderRevenue(){
  const sc = SC(), { rows, unpriced, base } = revenueSeries(sc);
  const max = Math.max(1, ...rows.map(r => r.total)), H = 150;
  const col = r => { const h = v => (v / max * H).toFixed(1); return `<div class="rcol" data-tip="${r.y}\nSecured: ${fGbp(r.secured)}\nEnding during ${r.y}: ${fGbp(r.ending)}\nAlready won, running by then: ${fGbp(r.gained)}"><div class="rstack" style="height:${H}px"><i class="won" style="height:${h(r.gained)}px"></i><i class="end" style="height:${h(r.ending)}px"></i><i class="sec" style="height:${h(r.secured)}px"></i></div><span class="rv">${fGbp(r.secured + r.gained)}</span><span class="ry">${r.y}</span></div>`; };
  const y2 = rows[2], y4 = rows[4];
  $('#revenue').innerHTML = `<div class="ch"><div><h2>Secured revenue</h2><p>Annual contract value ${sc.kind === 'all' ? 'across London' : 'for ' + esc(sc.name)} by year: still secured, ending that year, and already won</p></div></div>
    <div class="cb"><div class="rkpis"><div><div class="big">${fGbp(base)}</div><div class="sub">a year under current contracts</div></div><div><div class="big">${fPct(base ? (y2.secured + y2.gained) / base * 100 : null, 0)}</div><div class="sub">still running at the end of ${y2.y}</div></div><div><div class="big">${fPct(base ? (y4.secured + y4.gained) / base * 100 : null, 0)}</div><div class="sub">still running at the end of ${y4.y}</div></div></div>
      <div class="rchart" role="img" aria-label="Secured revenue by year">${rows.map(col).join('')}</div>
      <div class="legend"><span><i style="background:var(--seq-5)"></i>Secured</span><span><i style="background:var(--seq-2)"></i>Ends that year</span><span><i style="background:var(--good)"></i>Already won</span></div>
      <div class="sub gnote">Accepted annual bids of current contracts, carried to each contract’s end date. “Already won” is new contracts awarded but not yet started${sc.kind === 'op' ? ' that ' + esc(sc.name) + ' took from another operator' : ''}. Re-tenders of the scope’s own routes are not assumed either way.${unpriced ? ` ${nOf(unpriced, 'route')} without a price or end date are left out.` : ''}</div></div>`;
}
