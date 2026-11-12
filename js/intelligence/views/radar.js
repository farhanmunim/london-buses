/* View: bid radar — every tender in TfL's programme that has not started yet, with the garages that sit within
   reach of the route, by operator. That is the "who can realistically bid for this" question. */
import { D, TODAY_ISO } from '../data.js';
import { $, esc } from '../dom.js';
import { fDate, fInt, nOf } from '../format.js';
import { distToLine, fKm } from '../geo.js';
import { S, SC } from '../state.js';
import { opColour } from '../tokens.js';
import { shortOp } from './hero.js';

const tok = s => String(s ?? '').split('/').map(x => x.trim().toUpperCase()).filter(Boolean);
const cache = new Map();
/* garages within `km` of the route's line, nearest first: [{ g, d }] */
export function reach(routeId, km){
  const key = routeId + '|' + km; if(cache.has(key)) return cache.get(key);
  const line = D.lines.get(routeId), out = [];
  if(line) for(const g of D.garages){
    if(!Number.isFinite(g.lat)) continue;
    const d = distToLine(g.lat, g.lng, line); if(d <= km * 1000) out.push({ g, d });
  }
  out.sort((a, b) => a.d - b.d); cache.set(key, out); return out;
}
export function upcomingTenders(){
  const seen = new Set(), out = [];
  for(const e of [...D.prog].filter(e => e.contractStart && e.contractStart >= TODAY_ISO).sort((a, b) => (a.issueDate ?? a.contractStart).localeCompare(b.issueDate ?? b.contractStart))){
    const ids = tok(e.route).filter(t => D.byId.has(t)); if(!ids.length) continue;
    const k = ids.join('/'); if(seen.has(k)) continue; seen.add(k);
    const rs = ids.map(id => D.byId.get(id)), lead = rs.sort((a, b) => b.pvr - a.pvr)[0];
    // an award already made for this start is not an open opportunity any more
    const awarded = lead.hist.find(a => a.contractStart && Math.abs(Date.parse(a.contractStart) - Date.parse(e.contractStart)) < 150 * 864e5);
    out.push({ e, ids, rs, lead, pvr:rs.reduce((s, r) => s + (r.pvr || 0), 0), awarded });
  }
  return out;
}

export function renderRadar(){
  const sc = SC(), km = S.radarKm ?? 5, all = upcomingTenders();
  const mineIds = new Set(sc.list.map(r => r.id)), myGar = sc.kind === 'garage' ? new Set([sc.code]) : sc.kind === 'op' ? new Set(D.garages.filter(g => D.grp(g.operator) === sc.op).map(g => g.code)) : null;
  // rows: everything at network level; for an operator or garage, the tenders it defends plus those within reach of its garages
  const rows = all.map(t => {
    const near = reach(t.lead.id, km), defend = t.ids.some(id => mineIds.has(id));
    const attack = myGar ? near.some(x => myGar.has(x.g.code)) : false;
    return { ...t, near, defend, attack };
  }).filter(t => sc.kind === 'all' || t.defend || t.attack);
  const open = rows.filter(t => !t.awarded), done = rows.filter(t => t.awarded);
  const shown = S.radarAll ? open : open.slice(0, 12);
  const byOp = near => { const m = new Map(); for(const { g, d } of near){ const o = D.grp(g.operator) === 'Other' ? g.operator : D.grp(g.operator); const x = m.get(o) ?? m.set(o, { o, n:0, d:Infinity, head:0 }).get(o); x.n++; x.d = Math.min(x.d, d); x.head += Math.max(0, (g.capacity ?? 0) - (g.pvr ?? 0)); } return [...m.values()].sort((a, b) => a.d - b.d); };
  const row = t => {
    const ops = byOp(t.near), inc = t.lead.op;
    return `<tr class="rr ${t.defend ? 'defend' : ''}" data-r="${esc(t.lead.id)}"><td><span class="badge">${esc(t.e.route)}</span>${sc.kind !== 'all' ? `<span class="tag ${t.defend ? 'warn' : 'blue'}" style="margin-left:6px">${t.defend ? 'Defend' : 'Attack'}</span>` : ''}<div class="sub">${esc(t.lead.from)} ⇄ ${esc(t.lead.to)}</div></td>
      <td><i class="dot" style="background:${opColour(inc)}"></i> ${esc(shortOp(inc))}<div class="sub">${esc(t.lead.garageName ?? '')}</div></td>
      <td class="r num">${fInt(t.pvr)}</td><td class="r num">${t.lead.cpm ? '£' + t.lead.cpm.toFixed(2) : '—'}</td>
      <td><b>${esc(fDate(t.e.issueDate))}</b><div class="sub">returns ${esc(fDate(t.e.returnDate))}</div></td><td><b>${esc(fDate(t.e.contractStart))}</b><div class="sub">${esc(t.e.vehicleType ?? '')}${t.e.twoYearExtension ? ' · +2 yr option' : ''}</div></td>
      <td class="reach">${ops.length ? ops.map(x => `<span class="rc ${x.o === inc ? 'inc' : ''}" data-tip="${esc(x.o)}\n${nOf(x.n, 'garage')} within ${km} km · nearest ${fKm(x.d)}\nSpare licensed capacity: ${fInt(x.head)} buses${x.o === inc ? '\nIncumbent' : ''}"><i class="dot" style="background:${opColour(x.o)}"></i>${esc(shortOp(x.o))} <b>${x.n}</b>${x.head >= t.pvr ? '' : ' <small title="Less spare capacity than the route needs">tight</small>'}</span>`).join('') : '<span class="sub">No garage within ' + km + ' km</span>'}</td></tr>`;
  };
  $('#radar').innerHTML = `<div class="ch"><div><h2>Bid radar</h2><p>${sc.kind === 'all' ? `${nOf(open.length, 'tender')} in TfL’s programme not yet awarded` : `${nOf(open.length, 'upcoming tender')} ${esc(shortOp(sc.op))} ${sc.kind === 'garage' ? 'could bid for from ' + esc(sc.g.name) : 'defends or could attack'}`}, with the operators whose garages sit within ${km} km of each route</p></div>
      <div class="ctl"><div class="seg" role="group" aria-label="Reach"><button class="${km === 3 ? 'on' : ''}" data-radar-km="3">3 km</button><button class="${km === 5 ? 'on' : ''}" data-radar-km="5">5 km</button><button class="${km === 8 ? 'on' : ''}" data-radar-km="8">8 km</button></div></div></div>
    <div class="cb">${open.length ? `<div class="tw"><table class="dt radar"><thead><tr><th>Route</th><th>Incumbent</th><th class="r">PVR</th><th class="r">£/mile</th><th>Tender issued</th><th>New contract</th><th>Operators within ${km} km · garages</th></tr></thead><tbody>${shown.map(row).join('')}</tbody></table></div>
      ${open.length > shown.length ? `<div class="more"><button class="btn" data-radar-all="1">Show all ${open.length}</button></div>` : ''}` : '<div class="sub">No upcoming tenders in this scope.</div>'}
      ${done.length ? `<div class="sub" style="margin-top:10px">${nOf(done.length, 'tender')} in this list already awarded and not shown${sc.kind === 'all' ? '' : ' here'}; they appear in the renewal calendar as awarded.</div>` : ''}
      <div class="sub gnote">Reach is the distance from a garage to the nearest point of the route. A spare-capacity figure is the garage’s licensed capacity less its peak requirement today; “tight” means the operator’s nearby garages have less spare capacity than the route needs. Click a row for the route.</div></div>`;
}
