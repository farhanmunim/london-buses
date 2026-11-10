/* Data — loads data/api/*.json and builds the roll-ups every view reads (D). */
import { median, sum } from './format.js';
import { AGE_LIMIT, ALL, brandRoot, CLASS, opColour, OPS, propClass } from './tokens.js';

export function setData(v){ D = v; }

/* ── data ────────────────────────────────────────────────────────────────── */
/* Reads the public API (/api/v1, { meta, data } envelope) and returns `data`. */
export const get = p => fetch(p).then(r => r.ok ? r.json() : Promise.reject(new Error(p + ' → ' + r.status)))
  .then(j => j?.meta?.version === 'v1' && 'data' in j ? j.data : j);
const opt = p => get(p).catch(() => null);
export let D;                                   // everything below hangs off this
export const TODAY = new Date(); export const TODAY_ISO = TODAY.toISOString().slice(0, 10);
export const plusMonths = n => { const d = new Date(TODAY); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };

export const grp = name => {                    // tender-form names → the 8 contracted groups
  const n = String(name ?? '').toLowerCase();
  if(!n || n === '?' ) return null;
  if(n.includes('stagecoach')) return 'Stagecoach London';
  if(n.startsWith('first')) return 'First Bus London';
  if(n.includes('arriva')) return 'Arriva London';
  if(n.includes('go-ahead')) return 'Go-Ahead London';
  if(n.includes('metroline')) return 'Metroline';
  if(n.includes('transport uk') || n.includes('abellio')) return 'Transport UK London Bus';
  if(n === 'uno') return 'Uno';
  if(n.includes('falcon')) return 'Falcon Coaches';
  // any other operator the route data already lists (a new entrant) is its own group, by name
  const own = OPS.find(o => brandRoot(o) === brandRoot(n));
  if(own) return own;
  return 'Other';
};
// a rival in the head-to-head: the eight groups keep their names; anyone else is named, not lumped
const rival = name => { const g = grp(name); if(g !== 'Other') return g; const n = String(name).trim(); return /ct plus|hct/i.test(n) ? 'HCT Group (CT Plus)' : n; };

export async function load(){
  const [meta, tenders] = await Promise.all([get('/api/v1/route-meta.json'), get('/api/v1/tenders.json')]);
  const [fleet, garages, prog, perf, sched, crowd, status, dest, overview, manifest, vehicles, cpi, divhist, works] = await Promise.all([
    opt('/api/v1/fleet.json'), opt('/api/v1/garages.json'), opt('/api/v1/tender-programme.json'),
    opt('/api/v1/route-performance.json'), opt('/api/v1/scheduled-mileage.json'), opt('/api/v1/crowding.json'),
    opt('/api/v1/line-status.json'), opt('/api/v1/route-destinations.json'), opt('/api/v1/routes-overview.json'),
    opt('/api/v1/manifest.json'), opt('/api/v1/vehicles.json'), opt('/api/v1/cpi-cpa.json'),
    opt('/api/v1/diversion-history.json'), opt('/api/v1/roadworks.json'),
  ]);
  return { meta:meta.routes, tenders, fleet:fleet?.byRoute ?? {}, garages:(garages?.garages ?? []).filter(g => g.routes?.length), prog:prog?.entries ?? [],
           perf, sched:sched?.routes ?? {}, crowd:crowd?.routes ?? {}, status:status?.rows ?? [], dest:dest?.routes ?? dest ?? {},
           overview, manifest, veh:vehicles?.byReg ?? {}, cpi:cpi?.months ?? [], divhist:divhist?.entries ?? [], works:works?.disruptions ?? [] };
}

export const FLAG = {
  rel:{ label:'Reliability', long:'Reliability is more than 10% worse than the contractual standard' },
  op: { label:'Mileage',     long:'Operated mileage is more than 2 points below the contractual minimum' },
  end:{ label:'Contract <12 mo', long:'Contract ends within 12 months' },
  load:{ label:'Crowded',    long:'Peak load is at or above 80% of capacity' },
  dis:{ label:'Disrupted',   long:'Disrupted right now' },
  age:{ label:'Old fleet',   long:'Average fleet age is over 12 years' },
};
const prevYear = p => String(p).replace(/(\d{2})\/(\d{2})$/, (m, a, b) => `${String(+a - 1).padStart(2, '0')}/${String(+b - 1).padStart(2, '0')}`);
const yrsLeft = r => r.cEnd ? Math.max(0, (Date.parse(r.cEnd) - TODAY.getTime()) / 3.15576e10) : null;

export function build(raw){
  // The operator list is read from the data: the eight established groups keep their order and colours, and any
  // other operator running a route (a new entrant such as Go Bus) is added, largest first.
  { const n = {}; for(const m of Object.values(raw.meta)) if(m.operator) n[m.operator] = (n[m.operator] ?? 0) + 1;
    for(const o of Object.keys(n).filter(o => !OPS.includes(o)).sort((a, b) => n[b] - n[a] || a.localeCompare(b))) OPS.push(o); }
  const periods = raw.perf?.periods ?? [];
  const last13 = periods.slice(-13);
  const statusBy = new Map(raw.status.map(r => [r.route, r]));
  const worksBy = new Map();
  for(const w of raw.works) for(const rid of w.routes ?? []) (worksBy.get(rid) ?? worksBy.set(rid, []).get(rid)).push(w);
  const d30 = new Date(TODAY.getTime() - 30 * 864e5).toISOString().slice(0, 10), divDays = new Map();
  for(const e of raw.divhist) for(const day of e.days ?? []) if(day >= d30) (divDays.get(e.route) ?? divDays.set(e.route, new Set()).get(e.route)).add(day);
  // earliest still-future programme entry per route token
  const progBy = new Map();
  for(const e of [...raw.prog].filter(e => e.contractStart >= TODAY_ISO).sort((a, b) => a.contractStart.localeCompare(b.contractStart)))
    for(const t of String(e.route).split('/').map(x => x.trim())) if(!progBy.has(t)) progBy.set(t, e);
  // route geometry (direction 1 preferred), for glyphs and the footprint
  const lines = new Map();
  for(const f of raw.overview?.features ?? []){
    const id = f.properties?.routeId; if(!id) continue;
    const g = f.geometry; const coords = g?.type === 'LineString' ? g.coordinates : g?.type === 'MultiLineString' ? g.coordinates.flat() : null;
    if(!coords?.length) continue;
    if(!lines.has(id) || String(f.properties.direction) === '1') lines.set(id, coords);
  }
  const short = x => String(x?.destination ?? '').replace(/,.*$/, '').trim();
  const routes = [];
  for(const [id, m] of Object.entries(raw.meta)){
    const hist = [...(raw.tenders.byRoute?.[id] ?? [])].sort((a, b) => String(b.awardDate).localeCompare(String(a.awardDate)));
    const cur = hist.find(a => a.contractStart && a.contractStart <= TODAY_ISO) ?? hist[0] ?? null;
    const fl = raw.fleet[id]; const pf = raw.perf?.routes?.[id];
    const latest = obj => { for(let i = periods.length - 1; i >= 0; i--){ const v = obj?.[periods[i]]; if(Number.isFinite(v)) return { v, p:periods[i], i }; } return null; };
    const op = latest(pf?.operatedPct), rel = latest(pf?.reliability);
    const prevOp = op ? (() => { for(let i = op.i - 1; i >= 0; i--){ const v = pf.operatedPct[periods[i]]; if(Number.isFinite(v)) return v; } return null; })() : null;
    const opLY = op ? pf?.operatedPct?.[prevYear(op.p)] : null;
    const d = raw.dest[id], dk = raw.sched[id]?.dailyKm ?? null;
    routes.push({
      id, op:m.operator, company:m.company, garage:m.garage, garageName:m.garageName, pvr:m.pvr ?? 0, tvr:m.tvr, vehicle:m.fleet,
      prop:m.propulsion ?? 'diesel', deck:m.deck, freq:m.frequency, km:m.lengthKm, type:m.type,
      cStart:m.contractStart ?? null, cEnd:m.contractEnd ?? null,
      from:short(d?.outbound), to:short(d?.inbound),
      age:fl?.avgAgeYears ?? null, fleetN:fl?.count ?? 0, makes:fl?.makes ?? [],
      cur, hist, bids:cur?.numberOfTenderers > 0 ? cur.numberOfTenderers : null,
      cpm:cur?.costPerMile > 0 ? cur.costPerMile : null,
      opPct:op?.v ?? null, opPeriod:op?.p ?? null, opPrev:prevOp, opMin:pf?.operatedMinStandard ?? null,
      opLY:Number.isFinite(opLY) ? opLY : null, opYoY:op && Number.isFinite(opLY) ? op.v - opLY : null,
      rel:rel?.v ?? null, relMetric:pf?.reliabilityMetric ?? null, relStd:pf?.reliabilityMinStandard ?? null, pf,
      dailyKm:dk?.weekday ?? null, dk, trips:raw.sched[id]?.trips?.weekday ?? null, periodKm:dk ? 20 * (dk.weekday || 0) + 4 * (dk.saturday || 0) + 4 * (dk.sunday || 0) : null,
      crowd:raw.crowd[id] ?? null, status:statusBy.get(id) ?? null,
      next:progBy.get(id) ?? progBy.get(id.replace(/^N/, '')) ?? null,
      works:worksBy.get(id) ?? [], divDays:divDays.get(id)?.size ?? 0,
    });
  }
  for(const r of routes){
    // just awarded: the latest award was made in the last 9 months, or its contract has not started yet
    const a = r.hist[0];
    r.award = a?.awardDate && (a.awardDate >= plusMonths(-9) || (a.contractStart && a.contractStart > TODAY_ISO)) ? a : null;
    // in the programme: a future tender that is not simply the contract we just awarded
    const n = r.next, same = n && r.award?.contractStart && Math.abs(Date.parse(n.contractStart) - Date.parse(r.award.contractStart)) < 150 * 864e5;
    r.pipe = n && !same ? n : null;
  }
  const byId = new Map(routes.map(r => [r.id, r]));
  const YEAR = TODAY.getUTCFullYear();
  const vlist = Object.values(raw.veh);
  const vAges = new Map();                                           // route → ages of the registered vehicles seen on it
  for(const v of vlist) if(v.year) for(const rid of v.routes ?? []) (vAges.get(rid) ?? vAges.set(rid, []).get(rid)).push(YEAR - v.year);
  for(const r of routes){
    const a = vAges.get(r.id) ?? [];
    r.vSeen = a.length; r.vOld = a.filter(x => x >= AGE_LIMIT - 2).length; r.vOver = a.filter(x => x >= AGE_LIMIT).length;
  }
  const netMedianCpm = median(routes.map(r => r.cpm));
  // operators awarded routes but not yet running any (derived from the awards, like the main site's Operators page)
  const INCOMING = (() => {
    const by = new Map(), running = new Set(routes.map(r => brandRoot(r.op))), cut = plusMonths(-18);
    for(const r of routes){
      const a = r.hist[0]; if(!a?.operator || a.operatorChange !== true || brandRoot(a.operator) === brandRoot(r.op)) continue;
      if(!a.provisional && a.awardDate < cut) continue; if(a.contractStart && a.contractStart <= TODAY_ISO) continue;
      const x = by.get(a.operator) ?? by.set(a.operator, { op:a.operator, routes:[], pvr:0, provisional:false, start:null }).get(a.operator);
      x.routes.push(r.id); x.pvr += r.pvr ?? 0; x.provisional ||= !!a.provisional; const st = a.contractStart ?? r.cEnd; if(st && (!x.start || st < x.start)) x.start = st;
    }
    return [...by.values()].filter(x => !running.has(brandRoot(x.op)));
  })();
  // re-tender benchmark: the median £/mile of awards made in the last 24 months, and each route's contracted miles re-priced at it
  const recent = Object.values(raw.tenders.byId ?? {}).filter(a => a.awardDate >= plusMonths(-24) && a.costPerMile > 0);
  const bench = { cpm:median(recent.map(a => a.costPerMile)), n:recent.length };
  for(const r of routes){
    const a = r.cur;
    r.milesPA = Number.isFinite(a?.contractedMilesPA) ? a.contractedMilesPA : (a?.acceptedBid > 0 && a?.costPerMile > 0 ? a.acceptedBid / a.costPerMile : null);
    r.fcValue = r.milesPA && bench.cpm ? r.milesPA * bench.cpm : null;
  }
  const relPass = r => r.rel != null && r.relStd != null ? (/EWT/.test(r.relMetric) ? r.rel <= r.relStd : r.rel >= r.relStd) : null;

  // attention signals — transparent rules, each one a fact the data can state
  for(const r of routes){
    const f = [];
    // material misses only: most routes sit a little under their standards, so a bare miss is the norm, not a signal
    if(relPass(r) === false && Math.abs(r.rel - r.relStd) / r.relStd >= 0.10) f.push('rel');
    if(r.opPct != null && r.opMin != null && r.opPct < r.opMin - 2) f.push('op');
    if(r.cEnd && r.cEnd >= TODAY_ISO && r.cEnd <= plusMonths(12)) f.push('end');
    if(r.crowd?.peakVC >= 0.8) f.push('load');
    if(r.status && r.status.status !== 'Good Service') f.push('dis');
    if((r.age != null && r.age > 12) || (r.vSeen >= 3 && r.vOld / r.vSeen >= 0.4)) f.push('age');
    r.flags = f;
  }

  // the fleet register: every registered vehicle, grouped to its parent brand
  const BANDS = [[0, 2, '0–2'], [3, 5, '3–5'], [6, 8, '6–8'], [9, 11, '9–11'], [12, 99, '12+']];
  const mkFleet = vs => {
    const aged = vs.filter(v => v.year); const ages = aged.map(v => YEAR - v.year);
    return {
      n:vs.length, avg:ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null,
      ze:vs.length ? vs.filter(v => propClass(v.propulsion) === 'zero').length / vs.length * 100 : null,
      young:ages.length ? ages.filter(a => a <= 3).length / ages.length * 100 : null,
      old:ages.length ? ages.filter(a => a >= 12).length / ages.length * 100 : null,
      oldest:aged.length ? Math.min(...aged.map(v => v.year)) : null,
      hist:BANDS.map(([lo, hi, label]) => ({ label, n:ages.filter(a => a >= lo && a <= hi).length })),
      // exposure to the 14-year limit: buses reach it in (registration year + 14)
      limit:(() => { const c = n => ages.filter(x => x === n).length, over = ages.filter(x => x > AGE_LIMIT).length, y0 = c(AGE_LIMIT), y1 = c(AGE_LIMIT - 1), y2 = c(AGE_LIMIT - 2), y3 = c(AGE_LIMIT - 3);
        return { at:over + y0, over, soon:y1 + y2, within36:over + y0 + y1 + y2 + y3, rows:[{ label:`Past ${AGE_LIMIT}`, n:over }, { label:String(YEAR), n:y0 }, { label:String(YEAR + 1), n:y1 }, { label:String(YEAR + 2), n:y2 }, { label:String(YEAR + 3), n:y3 }], known:ages.length }; })(),
      makes:(() => { const c = {}; for(const v of vs) if(v.make) c[v.make] = (c[v.make] ?? 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3); })(),
      mix:Object.fromEntries(Object.keys(CLASS).map(k => [k, vs.length ? vs.filter(v => propClass(v.propulsion) === k).length / vs.length * 100 : 0])),
    };
  };
  const FLEET = Object.fromEntries(OPS.map(o => [o, mkFleet(vlist.filter(v => grp(v.operator) === o))]));
  const FNET = mkFleet(vlist.filter(v => OPS.includes(grp(v.operator))));

  const agg = list => {
    const pvr = sum(list, r => r.pvr);
    const aged = list.filter(r => r.age != null && r.fleetN > 0);
    const w = r => r.dailyKm ?? r.pvr ?? 1;
    const opd = list.filter(r => r.opPct != null);
    const series = last13.map(p => { const rs = list.filter(r => Number.isFinite(r.pf?.operatedPct?.[p])); const t = sum(rs, w); return t ? sum(rs, r => r.pf.operatedPct[p] * w(r)) / t : null; });
    const rp = list.map(relPass).filter(v => v != null);
    const priced = list.filter(r => r.cur?.acceptedBid > 0), wv = priced.filter(r => yrsLeft(r) != null);
    const both = list.filter(r => r.opPct != null && r.opLY != null);
    const exp24 = list.filter(r => r.cEnd && r.cEnd >= TODAY_ISO && r.cEnd <= plusMonths(24));
    const bidded = list.filter(r => r.bids);
    return {
      list, n:list.length, pvr,
      value:sum(list, r => r.cur?.acceptedBid),
      cpm:median(list.map(r => r.cpm)),
      age:aged.length ? sum(aged, r => r.age * r.fleetN) / sum(aged, r => r.fleetN) : null,
      ze:pvr ? sum(list.filter(r => propClass(r.prop) === 'zero'), r => r.pvr) / pvr * 100 : null,
      dd:pvr ? sum(list.filter(r => r.deck === 'double'), r => r.pvr) / pvr * 100 : null,
      mix:Object.fromEntries(Object.keys(CLASS).map(k => [k, pvr ? sum(list.filter(r => propClass(r.prop) === k), r => r.pvr) / pvr * 100 : 0])),
      opPct:opd.length ? sum(opd, r => r.opPct * w(r)) / sum(opd, w) : null,
      opSeries:series,
      yoy:both.length ? sum(both, r => (r.opPct - r.opLY) * w(r)) / sum(both, w) : null,
      lostKm:sum(list.filter(r => r.periodKm && r.opPct != null), r => r.periodKm * (1 - r.opPct / 100)),
      relPassPct:rp.length ? rp.filter(Boolean).length / rp.length * 100 : null, relN:rp.length,
      crowded:list.filter(r => r.crowd?.peakVC >= 0.8).length,
      disrupted:list.filter(r => r.status && r.status.status !== 'Good Service').length,
      attention:list.filter(r => r.flags.length >= 3),
      exp24, renewalValue:sum(exp24, r => r.cur?.acceptedBid), exp24InProg:exp24.filter(r => r.next).length,
      waut:wv.length ? sum(wv, r => r.cur.acceptedBid * yrsLeft(r)) / sum(wv, r => r.cur.acceptedBid) : null,
      valuePerPvr:(() => { const l = priced.filter(r => r.pvr > 0); return l.length ? sum(l, r => r.cur.acceptedBid) / sum(l, r => r.pvr) : null; })(),
      kmPerPvr:(() => { const l = list.filter(r => r.dailyKm && r.pvr > 0); return l.length ? sum(l, r => r.dailyKm) / sum(l, r => r.pvr) : null; })(),
      singleBid:bidded.length ? bidded.filter(r => r.bids === 1).length / bidded.length * 100 : null, bidN:bidded.length,
      garages:new Set(list.map(r => r.garage)).size,
      companies:new Set(list.map(r => r.company).filter(Boolean)).size,
    };
  };
  const ST = Object.fromEntries(OPS.map(o => [o, agg(routes.filter(r => r.op === o))]));
  for(const o of OPS) ST[o].opKey = o;
  const NET = agg(routes);
  for(const o of OPS) ST[o].spare = ST[o].pvr ? FLEET[o].n / ST[o].pvr : null;
  NET.spare = NET.pvr ? FNET.n / NET.pvr : null;

  // tender record and head-to-head, five years
  const from5 = plusMonths(-60);
  const REC = Object.fromEntries(OPS.map(o => [o, { retained:0, lost:0, won:0, wonFrom:{}, lostTo:{} }]));
  REC[ALL] = { retained:0, changed:0, wonFrom:{}, lostTo:{}, won:0, lost:0, network:true };
  for(const a of Object.values(raw.tenders.byId ?? {})){
    if(!a.awardDate || a.awardDate < from5) continue;
    const g = rival(a.operator), f = rival(a.fromOperator);
    if(!grp(a.operator) || !grp(a.fromOperator)) continue;
    if(g === f){ REC[ALL].retained++; if(REC[g]) REC[g].retained++; }
    else {
      REC[ALL].changed++;
      if(REC[f]){ REC[f].lost++; REC[f].lostTo[g] = (REC[f].lostTo[g] ?? 0) + 1; }
      if(REC[g]){ REC[g].won++; REC[g].wonFrom[f] = (REC[g].wonFrom[f] ?? 0) + 1; }
    }
  }

  // award price per mile by year, nominal and in today's money (CPI-deflated)
  const cpiBy = new Map(raw.cpi.map(m => [m.month, +m.cpi])), cpiNow = +raw.cpi.at(-1)?.cpi || null;
  const PY0 = 2015, PY1 = TODAY.getUTCFullYear(), PPTS = [];
  for(const a of Object.values(raw.tenders.byId ?? {})){
    if(!a.awardDate || !(a.costPerMile > 0) || a.costPerMile > 35) continue;   // above £35/mile is school/special work or a data slip, and would swamp the median
    const y = +a.awardDate.slice(0, 4); if(y < PY0 || y > PY1) continue;
    const f = cpiBy.get(a.awardDate.slice(0, 7));
    PPTS.push({ y, v:a.costPerMile, real:f && cpiNow ? a.costPerMile * cpiNow / f : null, g:grp(a.operator), tok:String(a.route ?? '').split('/').map(t => t.trim()) });
  }
  const PRICE = { years:Array.from({ length:PY1 - PY0 + 1 }, (_, i) => PY0 + i), cpiNow };
  PRICE.series = (pred, real, minOwn = 4) => PRICE.years.map(y => {
    const at = PPTS.filter(p => p.y === y), pick = arr => arr.map(x => real ? x.real : x.v).filter(Number.isFinite);
    const n = pick(at), o = pred ? pick(at.filter(pred)) : null;
    return { x:String(y), net:n.length >= 10 ? median(n) : null, op:o && o.length >= minOwn ? median(o) : null, nn:n.length, on:o?.length ?? 0 };
  });

  // zero-emission price gap: every priced award of the last five years whose vehicle basis TfL stated ("awarded on new
  // electrics", "existing hybrids"…). One point per award; the view splits them electric vs diesel/hybrid and by whether
  // the route changed hands, so the same awards feed the head-to-head and the gap chart.
  const GAP = [], lastCpi = raw.cpi.at(-1)?.month ?? '';
  for(const a of Object.values(raw.tenders.byId ?? {})){
    if(!a.awardDate || a.awardDate < from5 || !(a.costPerMile > 0) || a.costPerMile > 35) continue;
    const p = a.vehicle?.propulsion; if(!p || !grp(a.operator)) continue;
    const f = cpiBy.get(a.awardDate.slice(0, 7)), k = f && cpiNow ? cpiNow / f : (a.awardDate.slice(0, 7) > lastCpi ? 1 : null);   // newer than the last CPI print: today's money already
    const w = rival(a.operator), fr = grp(a.fromOperator) ? rival(a.fromOperator) : null;
    GAP.push({ ev:propClass(p) === 'zero', prop:p, basis:a.vehicle?.basis ?? null, g:grp(a.operator), w, fr, same:fr ? fr === w : null,
               v:a.costPerMile, real:k ? a.costPerMile * k : null, k, bid:a.acceptedBid > 0 ? a.acceptedBid : null, miles:a.contractedMilesPA > 0 ? a.contractedMilesPA : null,
               tok:String(a.route ?? '').split('/').map(t => t.trim()), route:a.route, date:a.awardDate });
  }

  // depots: peak vehicles against licensed operating-centre capacity
  const gByCode = new Map(raw.garages.map(g => [g.code, g]));
  const mkDepots = list => {
    const by = {}; for(const r of list) (by[r.garage] ??= { code:r.garage, name:r.garageName, pvr:0, routes:0 }), by[r.garage].pvr += r.pvr, by[r.garage].routes++;
    return Object.values(by).map(d => { const g = gByCode.get(d.code); return { ...d, capacity:g?.capacity ?? null, util:g?.capacity ? d.pvr / g.capacity : null, g }; }).sort((a, b) => b.pvr - a.pvr);
  };
  const DEPOTS = Object.fromEntries(OPS.map(o => [o, mkDepots(ST[o].list)])); DEPOTS[ALL] = mkDepots(routes);
  ST[ALL] = NET; FLEET[ALL] = FNET;

  // scopes: the whole network, one operator, or one garage. Every card reads its numbers from the current scope.
  const gcache = new Map();
  const garageScope = code => {
    if(gcache.has(code)) return gcache.get(code);
    const g = gByCode.get(code), list = routes.filter(r => r.garage === code); if(!g || !list.length) return null;
    const cnt = {}; for(const r of list) cnt[r.op] = (cnt[r.op] ?? 0) + r.pvr; const op = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
    const ids = new Set(list.map(r => r.id)), tok = x => String(x ?? '').split('/').map(t => t.trim());
    const st = agg(list), F = mkFleet(vlist.filter(v => grp(v.operator) === op && (v.routes ?? []).some(x => ids.has(x))));
    st.spare = null;
    const rec = { retained:0, won:0, lost:null, wonFrom:{}, lostTo:{}, partial:true };
    for(const a of Object.values(raw.tenders.byId ?? {})){
      if(!a.awardDate || a.awardDate < from5 || !tok(a.route).some(t => ids.has(t)) || !grp(a.operator) || !grp(a.fromOperator)) continue;
      const w = rival(a.operator), f = rival(a.fromOperator); if(w !== op) continue;
      if(f === w) rec.retained++; else { rec.won++; rec.wonFrom[f] = (rec.wonFrom[f] ?? 0) + 1; }
    }
    const sc = { kind:'garage', key:'g:' + code, name:`${g.name} garage`, code, g, op, st, F, rec, depots:mkDepots(list), colour:opColour(op), ids, list };
    gcache.set(code, sc); return sc;
  };
  const scope = (op, gar) => {
    if(gar){ const g = garageScope(gar); if(g) return g; }
    if(op === ALL) return { kind:'all', key:ALL, name:ALL, op:ALL, st:NET, F:FNET, rec:REC[ALL], depots:DEPOTS[ALL], colour:'#2a78d6', list:NET.list };
    return { kind:'op', key:op, name:op, op, st:ST[op], F:FLEET[op], rec:REC[op], depots:DEPOTS[op], colour:opColour(op), list:ST[op].list };
  };
  return { routes, byId, bench, INCOMING, ST, NET, REC, FLEET, FNET, PRICE, GAP, DEPOTS, scope, garageScope, YEAR, latestPeriod:periods.at(-1) ?? null, netMedianCpm, relPass, last13, lines, periods, worksBy };
}
