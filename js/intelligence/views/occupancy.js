/* View: depot occupancy forecast — each garage's peak requirement against its licensed capacity today and as
   awarded contracts start: routes won arrive, routes lost leave, PVR changes land. Arrivals from won routes are
   placed at the winner's nearest garage to the route, which is an estimate and is said so. */
import { D, TODAY, TODAY_ISO } from '../data.js';
import { $, esc } from '../dom.js';
import { fDate, fInt, fPct } from '../format.js';
import { distToLine } from '../geo.js';
import { SC } from '../state.js';
import { opColour } from '../tokens.js';
import { shortOp } from './hero.js';

const MONTHS = 36;
let EVENTS = null;
/* PVR changes by garage and month, from awards whose contract has not started yet */
function events(){
  if(EVENTS) return EVENTS;
  const ev = [];
  for(const r of D.routes){
    const a = r.award; if(!a?.contractStart || a.contractStart <= TODAY_ISO) continue;
    const m = Math.min(MONTHS, Math.max(0, Math.round((Date.parse(a.contractStart) - TODAY.getTime()) / 2.6298e9)));
    const newPvr = a.pvr ?? r.pvr, winner = D.grp(a.operator);
    if(a.operatorChange){
      ev.push({ garage:r.garage, m, delta:-(r.pvr || 0), route:r.id, why:`leaves for ${shortOp(winner)}` });
      const line = D.lines.get(r.id), cands = D.garages.filter(g => D.grp(g.operator) === winner && Number.isFinite(g.lat));
      const nearest = line && cands.length ? cands.map(g => ({ g, d:distToLine(g.lat, g.lng, line) })).sort((x, y) => x.d - y.d)[0]?.g : null;
      if(nearest) ev.push({ garage:nearest.code, m, delta:newPvr || 0, route:r.id, why:`arrives from ${shortOp(r.op)} (nearest ${shortOp(winner)} garage, estimate)`, est:true });
    } else if(newPvr && newPvr !== r.pvr) ev.push({ garage:r.garage, m, delta:newPvr - r.pvr, route:r.id, why:`PVR ${r.pvr} → ${newPvr} on re-award` });
  }
  return EVENTS = ev;
}
export function projection(code, pvr0){
  const series = Array.from({ length:MONTHS + 1 }, () => 0);
  const mine = events().filter(e => e.garage === code);
  for(const e of mine) for(let m = e.m; m <= MONTHS; m++) series[m] += e.delta;
  return { series:series.map(v => (pvr0 || 0) + v), changes:mine.sort((a, b) => a.m - b.m) };
}

export function renderOccupancy(){
  const sc = SC();
  const rows = sc.depots.map(d => {
    const { series, changes } = projection(d.code, d.pvr), cap = d.capacity;
    const at = m => series[Math.min(m, MONTHS)], pct = v => cap ? v / cap * 100 : null;
    const peak = Math.max(...series);
    return { ...d, series, changes, now:pct(d.pvr), y1:pct(at(12)), y3:pct(at(36)), peak:pct(peak), peakAt:series.indexOf(peak), op:d.g?.operator ?? sc.op };
  }).sort((a, b) => (b.peak ?? -1) - (a.peak ?? -1));
  const shown = sc.kind === 'all' ? rows.filter(r => r.capacity).slice(0, 15) : rows;
  const bar = (p, cls = '') => p == null ? '<span class="sub">no licence figure</span>' : `<span class="occ ${p > 100 ? 'over' : p > 90 ? 'hot' : ''} ${cls}"><i style="--w:${Math.min(100, p).toFixed(0)}%"></i><b>${fPct(p, 0)}</b></span>`;
  const spark = r => { const v = r.series, cap = r.capacity || Math.max(...v) || 1, W = 120, H = 26; const pts = v.map((y, i) => `${(i / MONTHS * W).toFixed(1)},${(H - Math.min(1.15, y / cap) / 1.15 * H).toFixed(1)}`); const capY = (H - 1 / 1.15 * H).toFixed(1); return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="occspark" aria-hidden="true"><line x1="0" x2="${W}" y1="${capY}" y2="${capY}" stroke="var(--crit)" stroke-dasharray="2 3" stroke-width="1"/><polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.6"/></svg>`; };
  const tip = r => `${r.name} (${r.code})\nNow ${fInt(r.pvr)} of ${r.capacity ?? '?'} licensed\n` + (r.changes.length ? r.changes.slice(0, 6).map(c => `${c.delta > 0 ? '+' : ''}${c.delta} · route ${c.route} ${c.why} · ${fDate(new Date(TODAY.getTime() + c.m * 2.6298e9).toISOString())}`).join('\n') + (r.changes.length > 6 ? `\n… ${r.changes.length - 6} more` : '') : 'No awarded changes in the next 36 months');
  const over = rows.filter(r => r.peak > 100).length, hot = rows.filter(r => r.peak > 90 && r.peak <= 100).length;
  $('#occupancy').innerHTML = `<div class="ch"><div><h2>Depot occupancy forecast</h2><p>${sc.kind === 'all' ? 'The garages closest to their licensed limit over the next 36 months' : sc.kind === 'garage' ? `${esc(sc.name)} against its licensed capacity, today and as awarded contracts start` : `${esc(sc.name)}’s garages against their licensed capacity, today and as awarded contracts start`}${over ? ` · <b style="color:var(--crit)">${over} over capacity</b>` : ''}${hot ? ` · ${hot} above 90%` : ''}</p></div></div>
    <div class="cb">${shown.length ? `<div class="tw"><table class="dt occt"><thead><tr><th>Garage</th><th class="r">PVR / licence</th><th>Now</th><th>In 12 months</th><th>In 36 months</th><th>Projection</th></tr></thead><tbody>${shown.map(r => `<tr class="orow" data-gar="${esc(r.code)}" data-tip="${esc(tip(r))}"><td><i class="dot" style="background:${opColour(r.op)}"></i> <b>${esc(r.name)}</b> <span class="sub">${esc(r.code)}${sc.kind === 'all' ? ' · ' + esc(shortOp(r.op)) : ''}</span></td><td class="r num">${fInt(r.pvr)} / ${r.capacity ?? '—'}</td><td>${bar(r.now)}</td><td>${bar(r.y1)}</td><td>${bar(r.y3)}</td><td>${r.capacity ? spark(r) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="sub">No garages in this scope.</div>'}
      <div class="sub gnote">Peak vehicle requirement ÷ licensed operating-centre capacity (spares excluded). Changes come from awards already made: a route lost leaves its garage when the new contract starts, a route won is placed at the winner’s nearest garage to the route (an estimate), and PVR changes on re-award are applied. Hover a row for the changes; click it to scope to that garage.</div></div>`;
}
