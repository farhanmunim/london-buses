/* View: market competitiveness — how contested TfL's tenders are: bidders per tender, the share decided on a
   single bid, and how far the winning bid sat below the highest one, by year. */
import { D, TODAY } from '../data.js';
import { $, esc } from '../dom.js';
import { fNum, fPct, nOf } from '../format.js';
import { SC } from '../state.js';

function stats(list){
  const bid = list.filter(a => a.numberOfTenderers > 0);
  const spread = list.filter(a => a.numberOfTenderers > 1 && a.highestBid > 0 && a.acceptedBid > 0 && a.acceptedBid <= a.highestBid).map(a => (a.highestBid - a.acceptedBid) / a.highestBid * 100);
  return { n:list.length, bidders:bid.length ? bid.reduce((s, a) => s + a.numberOfTenderers, 0) / bid.length : null, sole:bid.length ? bid.filter(a => a.numberOfTenderers === 1).length / bid.length * 100 : null, below:spread.length ? spread.reduce((s, v) => s + v, 0) / spread.length : null, bn:bid.length, sn:spread.length };
}
export function renderCompetition(){
  const sc = SC(), y1 = TODAY.getUTCFullYear(), years = Array.from({ length:8 }, (_, i) => y1 - 7 + i);
  const all = D.awards.filter(a => a.awardDate && !a.provisional && a.costPerMile > 0 && a.costPerMile <= 35);
  const mine = sc.kind === 'all' ? null : sc.kind === 'op' ? all.filter(a => D.grp(a.operator) === sc.op) : all.filter(a => String(a.route ?? '').split('/').some(t => sc.ids.has(t.trim().toUpperCase())));
  const rows = years.map(y => ({ y, net:stats(all.filter(a => a.awardDate.startsWith(String(y)))), own:mine ? stats(mine.filter(a => a.awardDate.startsWith(String(y)))) : null }));
  const recent = stats(all.filter(a => a.awardDate >= `${y1 - 1}-01-01`)), before = stats(all.filter(a => a.awardDate >= `${y1 - 3}-01-01` && a.awardDate < `${y1 - 1}-01-01`));
  const trend = (a, b, good) => Number.isFinite(a) && Number.isFinite(b) ? `<span class="delta ${(a >= b) === good ? 'up' : 'dn'}">${a >= b ? '▲' : '▼'} vs ${fNum(b, 1)}</span>` : '';
  const bar = (v, max, cls) => Number.isFinite(v) ? `<span class="cbar ${cls}"><i style="width:${Math.min(100, v / max * 100).toFixed(0)}%"></i><b>${cls === 'bid' ? fNum(v, 1) : fPct(v, 0)}</b></span>` : '<span class="sub">—</span>';
  const own = sc.kind !== 'all';
  $('#competition').innerHTML = `<div class="ch"><div><h2>Market competitiveness</h2><p>How contested TfL’s tenders are${own ? ', London and ' + esc(sc.name) : ''}, by award year</p></div></div>
    <div class="cb"><div class="rkpis"><div><div class="big">${fNum(recent.bidders, 1)}</div><div class="sub">bidders per tender, last 2 years ${trend(recent.bidders, before.bidders, true)}</div></div><div><div class="big">${fPct(recent.sole, 0)}</div><div class="sub">decided on a single bid ${trend(recent.sole, before.sole, false)}</div></div><div><div class="big">${fPct(recent.below, 0)}</div><div class="sub">winning bid below the highest ${trend(recent.below, before.below, true)}</div></div></div>
      <div class="tw"><table class="dt comp"><thead><tr><th>Year</th><th class="r">Awards</th><th>Bidders</th><th>Single bid</th><th>Below top bid</th></tr></thead><tbody>${rows.map(r => `<tr data-tip="${r.y}\nLondon: ${nOf(r.net.n, 'award')}, ${fNum(r.net.bidders, 1)} bidders, ${fPct(r.net.sole, 0)} single-bid, winner ${fPct(r.net.below, 0)} below the top bid${r.own ? `\n${esc(sc.name)}: ${nOf(r.own.n, 'award')}, ${fNum(r.own.bidders, 1)} bidders, ${fPct(r.own.sole, 0)} single-bid, ${fPct(r.own.below, 0)} below` : ''}"><td>${r.y}</td><td class="r num">${r.net.n}${r.own ? ` <span class="sub">· ${r.own.n}</span>` : ''}</td><td>${bar(r.net.bidders, 5, 'bid')}${r.own ? bar(r.own.bidders, 5, 'bid own') : ''}</td><td>${bar(r.net.sole, 100, 'sole')}${r.own ? bar(r.own.sole, 100, 'sole own') : ''}</td><td>${bar(r.net.below, 40, 'below')}${r.own ? bar(r.own.below, 40, 'below own') : ''}</td></tr>`).join('')}</tbody></table></div>
      ${own ? `<div class="legend"><span><i style="background:var(--gray-bar)"></i>London</span><span><i style="background:var(--accent)"></i>${esc(sc.name)}</span></div>` : ''}
      <div class="sub gnote">TfL’s published awards with a price. “Won below top bid” is how far the accepted bid sat below the highest compliant bid, averaged over tenders with two or more bidders: the money left on the table by the market. Provisional awards are excluded.</div></div>`;
}
