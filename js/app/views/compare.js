/* View: Compare — several routes side by side, one column each, the key facts in rows. Opened from the Routes
   page's Compare mode or from the map with two or more routes focused (#/compare/25,88,N38?from=map). */
import { D } from '../core/data.js';
import { gone, routesViewState, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { cmpRoute, downloadCsv, esc, fmtDate, num, opColor, stripTags, title, TYPE_LABEL } from '../core/utils.js';

const MAX = 8;
const today = () => new Date().toISOString().slice(0, 10);
const gbp = v => !num(v) ? null : v >= 1e6 ? '£' + (v / 1e6).toFixed(1) + 'm' : '£' + Math.round(v / 1e3) + 'k';
const pct = (v, d = 1) => num(v) != null ? v.toFixed(d) + '%' : null;

export function parseCompare(arg){
  const [list, qs] = String(arg ?? '').split('?');
  const from = new URLSearchParams(qs ?? '').get('from');
  const ids = [...new Set(list.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, MAX);
  return { ids, from };
}
export const compareHref = (ids, from) => '#/compare/' + ids.map(encodeURIComponent).join(',') + (from ? '?from=' + from : '');

/* One route's facts, from every dataset the route page reads. */
function facts(id, d){
  const m = d.meta[id] ?? {}, tn = d.tenders[id] ?? [], t0 = today();
  const cur = tn.find(a => a.contractStart && a.contractStart <= t0) ?? tn[0] ?? null;
  const next = tn[0] && tn[0] !== cur && tn[0].contractStart && tn[0].contractStart > t0 ? tn[0] : null;
  const fl = d.fleet[id], cr = d.crowding?.routes?.[id], pf = d.perf?.routes?.[id], periods = d.perf?.periods ?? [];
  const latest = obj => { for(let i = periods.length - 1; i >= 0; i--){ const v = obj?.[periods[i]]; if(Number.isFinite(v)) return { v, p:periods[i] }; } return null; };
  const op = latest(pf?.operatedPct), rel = latest(pf?.reliability), ewt = /EWT/.test(pf?.reliabilityMetric ?? '');
  const dest = d.dest?.[id];
  const short = x => String(x?.destination ?? '').replace(/,.*$/, '').trim();
  const prog = d.prog.filter(e => String(e.route).toUpperCase().split('/').some(t => t.trim() === id) && e.contractStart && e.contractStart >= t0).sort((a, b) => a.contractStart.localeCompare(b.contractStart))[0];
  const status = d.status.find(r => r.route === id);
  const miles = num(cur?.contractedMilesPA) ?? (num(cur?.acceptedBid) && num(cur?.costPerMile) ? cur.acceptedBid / cur.costPerMile : null);
  return {
    id, type: m.type ?? d.types[id] ?? 'regular', operator: m.operator ?? null,
    corridor: dest ? `${short(dest.outbound)} ⇄ ${short(dest.inbound)}` : null,
    typeLabel: TYPE_LABEL[m.type ?? d.types[id]] ?? null, lengthKm: num(m.lengthKm), frequency: m.frequency ? title(m.frequency) + ' frequency' : null,
    vehicle: m.fleet ? stripTags(m.fleet) : null, propulsion: m.propulsion ? title(m.propulsion) : null, deck: m.deck ? title(m.deck) + ' deck' : null,
    garage: m.garageName ? `${m.garageName} (${m.garage})` : m.garage ?? null, company: m.company ? stripTags(String(m.company).replace(/<br\s*\/?>/gi, ' · ')) : null, pvr: num(m.pvr), tvr: num(m.tvr),
    fleetN: num(fl?.count), fleetAge: num(fl?.avgAgeYears), rare: fl?.rare?.length ?? 0,
    cStart: m.contractStart ?? cur?.contractStart ?? null, cEnd: m.contractEnd ?? cur?.contractEnd ?? null, term: num(cur?.termYearsStated ?? cur?.termYears),
    cpm: num(cur?.costPerMile), bid: num(cur?.acceptedBid), miles: num(miles), bids: num(cur?.numberOfTenderers), awarded: cur?.awardDate ?? null,
    nextAward: next ? `${fmtDate(next.awardDate)} → ${next.operator ?? '?'}` : null, nextTender: prog ? `${fmtDate(prog.issueDate) ?? 'tbc'} · starts ${fmtDate(prog.contractStart)}` : null,
    opPct: op?.v ?? null, opPeriod: op?.p ?? null, opMin: num(pf?.operatedMinStandard), rel: rel?.v ?? null, relStd: num(pf?.reliabilityMinStandard), ewt,
    peakVC: num(cr?.peakVC), status: status?.status ?? null,
  };
}

/* The rows of the table: label, group, value getter, and for numbers which way is "best". */
const ROWS = [
  ['Service', 'Corridor', f => f.corridor], ['Service', 'Type', f => f.typeLabel], ['Service', 'Length', f => f.lengthKm != null ? f.lengthKm + ' km' : null, 'num'],
  ['Service', 'Frequency', f => f.frequency], ['Service', 'Vehicle', f => f.vehicle], ['Service', 'Power', f => f.propulsion], ['Service', 'Deck', f => f.deck],
  ['Operation', 'Operator', f => f.operator], ['Operation', 'Company', f => f.company], ['Operation', 'Garage', f => f.garage],
  ['Operation', 'Peak vehicles (PVR)', f => f.pvr, 'num'], ['Operation', 'Total vehicles (TVR)', f => f.tvr, 'num'],
  ['Operation', 'Buses seen (14 days)', f => f.fleetN, 'num'], ['Operation', 'Average bus age', f => f.fleetAge != null ? f.fleetAge.toFixed(1) + ' yrs' : null, 'low', f => f.fleetAge],
  ['Operation', 'Service now', f => f.status],
  ['Contract', 'Contract start', f => fmtDate(f.cStart)], ['Contract', 'Contract end', f => fmtDate(f.cEnd)], ['Contract', 'Term', f => f.term != null ? f.term + ' yrs' : null],
  ['Contract', 'Cost per mile', f => f.cpm != null ? '£' + f.cpm.toFixed(2) : null, 'low', f => f.cpm], ['Contract', 'Annual value', f => gbp(f.bid), 'num', f => f.bid],
  ['Contract', 'Contracted miles / yr', f => f.miles != null ? Math.round(f.miles).toLocaleString('en-GB') : null, 'num', f => f.miles],
  ['Contract', 'Bids received', f => f.bids, 'high', f => f.bids], ['Contract', 'Awarded on', f => fmtDate(f.awarded)],
  ['Contract', 'Next contract awarded', f => f.nextAward], ['Contract', 'Next tender', f => f.nextTender],
  ['Performance', 'Operated mileage', f => f.opPct != null ? pct(f.opPct) + (f.opMin != null ? ` <small>min ${pct(f.opMin)}</small>` : '') : null, 'high', f => f.opPct],
  ['Performance', 'Reliability', f => f.rel != null ? (f.ewt ? f.rel.toFixed(2) + ' min EWT' : pct(f.rel) + ' on time') + (f.relStd != null ? ` <small>std ${f.ewt ? f.relStd : pct(f.relStd)}</small>` : '') : null, 'rel', f => f.rel],
  ['Performance', 'Peak load', f => f.peakVC != null ? Math.round(f.peakVC * 100) + '% of capacity' : null, 'low', f => f.peakVC],
];

export async function renderCompare(arg){
  const tok = state.navToken, { ids, from } = parseCompare(arg);
  const back = from === 'map' ? { href: '#/map?routes=' + ids.map(encodeURIComponent).join(','), label: '‹ Back to the map' } : { href: '#/', label: '‹ Routes' };
  main.innerHTML = `<a class="backrow" href="${back.href}">${back.label}</a><div class="skel" style="height:220px"></div>`;
  const [routes, meta, tenders, fleet, crowding, perf, prog, status, dest] = await Promise.all([
    D.routes(), D.meta(), D.tenders(), D.fleet(), D.crowding().catch(() => null), D.routePerf().catch(() => null), D.programme().catch(() => []), D.lineStatus().catch(() => null), D.destinations().catch(() => ({})) ]);
  if(gone(tok)) return;
  const known = new Map((routes ?? []).map(r => [r.name.toUpperCase(), r.name]));
  const types = Object.fromEntries((routes ?? []).map(r => [r.name.toUpperCase(), r.type]));
  const valid = ids.filter(id => known.has(id)).map(id => known.get(id));
  const d = { meta, tenders, fleet, crowding, perf, prog, status: status?.rows ?? [], dest, types };
  const cols = valid.map(id => facts(id, d));
  routesViewState.compare = new Set(valid);
  const head = `
    <a class="backrow" href="${back.href}">${back.label}</a>
    <div class="cmp-head">
      <div><h1 style="margin:0;font-size:22px;letter-spacing:-.02em">Routes side by side</h1><div class="sub2">${cols.length ? `${cols.length} route${cols.length === 1 ? '' : 's'} side by side · up to ${MAX}` : 'Pick routes to compare'}</div></div>
      <div class="cmp-tools">
        <form class="search cmp-add" id="cmpAdd" autocomplete="off"><input id="cmpQ" placeholder="Add a route, e.g. 88" aria-label="Add a route" inputmode="search" enterkeyhint="done"></form>
        <button class="livebtn" id="cmpCsv" ${cols.length ? '' : 'disabled'}>Export CSV</button>
        <button class="reset" id="cmpClear" ${cols.length ? '' : 'hidden'}>Clear</button>
      </div>
    </div>`;
  if(!cols.length){ main.innerHTML = head + `<div class="empty">No routes selected. Add one above, or open <a href="#/">Routes</a>, press <b>Multiselect</b> and tick the routes you want.</div>`; wire(); return; }
  // best-value marks per numeric row (low = lower is better, high = higher, rel = depends on the metric)
  const best = new Map();
  for(const [, label, , kind, raw] of ROWS){
    if(!kind || kind === 'num' || !raw) continue;
    const vals = cols.map(raw).map(v => num(v));
    const live = vals.filter(v => v != null); if(live.length < 2 || new Set(live).size < 2) continue;
    const dir = kind === 'high' ? 'high' : kind === 'low' ? 'low' : (cols.every(c => c.ewt) ? 'low' : cols.every(c => !c.ewt) ? 'high' : null);
    if(!dir) continue;
    const target = dir === 'high' ? Math.max(...live) : Math.min(...live);
    best.set(label, vals.map(v => v === target));
  }
  let group = '';
  const body = ROWS.map(([g, label, get, kind]) => {
    const vals = cols.map(get);
    if(vals.every(v => v == null || v === '')) return '';
    const gh = g !== group ? (group = g, `<tr class="cmp-g"><th colspan="${cols.length + 1}">${g}</th></tr>`) : '';
    const marks = best.get(label);
    return gh + `<tr><th scope="row">${esc(label)}</th>${vals.map((v, i) => `<td class="${kind ? 'num' : ''} ${marks?.[i] ? 'best' : ''}">${v == null || v === '' ? '<span class="mu">—</span>' : (typeof v === 'string' && /<small>/.test(v) ? v : esc(String(v)))}</td>`).join('')}</tr>`;
  }).join('');
  main.innerHTML = head + `
    <div class="cmp-wrap"><table class="cmp" aria-label="Route comparison"><thead><tr><th scope="col" class="cmp-corner"></th>${cols.map(c => `<th scope="col"><div class="cmp-col"><a class="rnum ${esc(c.type)}" href="#/route/${encodeURIComponent(c.id)}" title="Open route ${esc(c.id)}">${esc(c.id)}</a><span class="cmp-op" style="color:${opColor(c.operator)}">${esc((c.operator ?? '').replace(' London', ''))}</span><button class="cmp-x" data-rm="${esc(c.id)}" aria-label="Remove ${esc(c.id)}">×</button></div></th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>
    <div class="legendrow" style="margin-top:8px"><span class="best-key"></span> best of the set, where lower or higher is clearly better (cost per mile, bus age, bids received, operated mileage, reliability, peak load). Tap a route number to open its page.</div>`;
  wire();

  function wire(){
    const go = next => { routesViewState.compare = new Set(next); location.hash = compareHref(next, from); };
    document.getElementById('cmpAdd')?.addEventListener('submit', e => {
      e.preventDefault();
      const v = document.getElementById('cmpQ').value.trim().toUpperCase(); if(!v) return;
      if(!known.has(v)){ document.getElementById('cmpQ').setCustomValidity(`No route ${v}`); document.getElementById('cmpQ').reportValidity(); setTimeout(() => document.getElementById('cmpQ')?.setCustomValidity(''), 1500); return; }
      if(valid.length >= MAX){ alert(`Up to ${MAX} routes at a time.`); return; }
      go([...new Set([...valid, known.get(v)])]);
    });
    main.addEventListener('click', e => {
      const rm = e.target.closest('[data-rm]'); if(rm){ go(valid.filter(x => x !== rm.dataset.rm)); return; }
      if(e.target.closest('#cmpClear')){ go([]); return; }
      if(e.target.closest('#cmpCsv')){
        const rows = [['field', ...cols.map(c => c.id)], ...ROWS.map(([g, label, get]) => [`${g}: ${label}`, ...cols.map(c => { const v = get(c); return v == null ? '' : String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); })])];
        downloadCsv(`compare-${cols.map(c => c.id).join('-').toLowerCase()}.csv`, rows);
      }
    }, { once: false });
  }
}
