/* Drawer — the route brief: render, open, close, step.
   Note: drawer.js and actions.js call into each other, but only from event handlers — never at load time. */
import { D, FLAG, grp } from '../data.js';
import { $, $$, esc } from '../dom.js';
import { dirSeg, lineChart, profileChart, routeChips, shapeSvg } from './charts.js';
import { corridor, profileData } from './route-data.js';
import { fDate, fGbp, fInt, fMon, fNum, warnIcon } from '../format.js';
import { garLegend, liveStop, mapShow, MH, MP } from '../map/route-map.js';
import { S } from '../state.js';
import { AGE_LIMIT, ALL, opColour, PROP_LABEL } from '../tokens.js';
import { renderAll, syncHash } from '../ui/actions.js';
import { termOf } from '../views/renewals.js';
import { filtered } from '../views/routes-table.js';

function renderDrawer(r){
  const rel = D.relPass(r), pf = r.pf;
  const cpmD = r.cpm && D.netMedianCpm ? (r.cpm / D.netMedianCpm - 1) * 100 : null;
  const opSeries = D.last13.map(p => ({ x:p, y:pf?.operatedPct?.[p] })), relSeries = D.last13.map(p => ({ x:p, y:pf?.reliability?.[p] }));
  const hist = [...r.hist].reverse().filter(a => a.costPerMile > 0).map(a => ({ x:String(a.awardDate).slice(0, 4), y:a.costPerMile }));
  const cr = r.crowd, st = r.status, good = !st || st.status === 'Good Service';
  const idx = filtered().findIndex(x => x.id === r.id), kmPv = r.dailyKm && r.pvr ? r.dailyKm / r.pvr : null;
  $('#drawer').innerHTML = `<div class="dh"><span class="badge">${esc(r.id)}</span><div style="min-width:0"><h3 id="dTitle">${esc(r.from || '—')} ⇄ ${esc(r.to || '—')}</h3>
      <div class="chips" style="margin-top:6px"><span class="chip"><i class="dot" style="background:${opColour(r.op)}"></i>${esc(r.op)}</span><span class="chip">${esc(r.garageName)} (${esc(r.garage)})</span>${r.type && r.type !== 'regular' ? `<span class="chip">${esc(r.type)}</span>` : ''}</div></div>
      <div class="x"><button class="ib" id="dPrev" aria-label="Previous route" ${idx <= 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button><button class="ib" id="dNext" aria-label="Next route" ${idx < 0 || idx >= filtered().length - 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button><button class="ib" id="dClose" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div></div>
    <div class="db">
      <div class="status-line ${good ? 'good' : 'bad'}">${good ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg><span><b>Good service</b> right now</span>' : `${warnIcon}<span><b>${esc(st.status)}</b> — ${esc(String(st.reason ?? '').slice(0, 220))}${String(st.reason ?? '').length > 220 ? '…' : ''}</span>`}</div>
      ${r.flags.length ? `<section><h4>Attention signals</h4><div class="sigs">${r.flags.map(k => `<span class="sig" data-tip="${esc(FLAG[k].long)}">${warnIcon}${esc(FLAG[k].long)}</span>`).join('')}</div></section>` : ''}
      <div class="mini">
        <div><div class="l">Peak vehicles</div><div class="v">${fInt(r.pvr)}</div><div class="s">${r.tvr ? fInt(r.tvr) + ' total' : '&nbsp;'}</div></div>
        <div><div class="l">Fleet age</div><div class="v">${r.age != null ? fNum(r.age, 1) + ' y' : '—'}</div><div class="s">${esc(PROP_LABEL[r.prop] ?? r.prop)}${r.deck ? ' · ' + esc(r.deck) + '-deck' : ''}</div>${r.vOld > 0 ? `<div class="s" style="color:var(--warn-ink)" data-tip="Buses recently seen on this route that were first registered ${AGE_LIMIT - 2}+ years ago">${r.vOld} of ${r.vSeen} reach ${AGE_LIMIT} y by ${D.YEAR + 2}</div>` : ''}</div>
        <div><div class="l">Price</div><div class="v">${r.cpm ? '£' + r.cpm.toFixed(2) : '—'}</div><div class="s">${cpmD != null ? (cpmD >= 0 ? '+' : '−') + Math.abs(cpmD).toFixed(0) + '% vs network' : 'per mile'}</div></div>
        <div><div class="l">Operated</div><div class="v">${r.opPct != null ? r.opPct.toFixed(1) + '%' : '—'}</div><div class="s">${r.opYoY != null ? (r.opYoY >= 0 ? '▲ ' : '▼ ') + Math.abs(r.opYoY).toFixed(1) + ' pts vs last year' : esc(r.opPeriod ?? '')}</div></div>
        <div><div class="l">Reliability</div><div class="v">${r.rel != null ? r.rel.toFixed(r.rel < 10 ? 2 : 1) : '—'}</div><div class="s">${rel == null ? esc(r.relMetric ?? '') : rel ? '✓ meets ' + esc(r.relStd) : '⚠ below ' + esc(r.relStd)} ${rel == null ? '' : '· ' + esc((r.relMetric ?? '').replace(' (mins)', ''))}</div></div>
        <div><div class="l">Peak load</div><div class="v">${cr ? Math.round(cr.peakVC * 100) + '%' : '—'}</div><div class="s">${cr ? esc(cr.band) + ' · ' + esc(String(cr.stopname ?? '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).slice(0, 22)) : '&nbsp;'}</div></div>
      </div>
      <section><h4>Route map</h4>
        <div class="mapbox" id="mapbox">${MP.failed ? `<div class="shape" style="border:0;border-radius:0;height:100%">${shapeSvg(r)}</div>` : '<div id="mapSlot" class="mapslot"></div>'}
          ${MP.failed ? '' : `${garLegend()}<div class="mapui tl">${dirSeg(r)}</div>
          <div class="mapui tr2"><button class="ib float" data-expand="route" aria-label="Open the map full page" data-tip="Open full page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button></div>`}</div>
        ${MP.failed ? '' : `<div class="lyrow">${routeChips()}</div>`}
        <div class="sub" id="mapNote" style="margin-top:8px">${r.km ? fNum(r.km, 0) + ' km · ' : ''}${esc(r.vehicle ?? '')}</div></section>
      <section><h4>Network &amp; productivity</h4>
        <div class="kv"><span>Scheduled weekday distance</span><b>${r.dailyKm ? fInt(r.dailyKm) + ' km' : '—'}${r.trips ? ` <span class="sub" style="font-weight:400">· ${r.trips.outbound + r.trips.inbound} trips</span>` : ''}</b></div>
        <div class="kv"><span>Km per peak vehicle per day</span><b>${kmPv ? fInt(kmPv) : '—'} ${kmPv && D.NET.kmPerPvr ? `<span class="sub" style="font-weight:400">· network ${fInt(D.NET.kmPerPvr)}</span>` : ''}</b></div>
        <div class="kv"><span>Diversion notices, last 30 days</span><b>${r.divDays} <span class="sub" style="font-weight:400">of 30 days</span></b></div>
        <div class="kv"><span>Roadworks on the route now</span><b>${r.works.length}</b></div></section>
      <section><h4>Contract</h4>
        <div class="kv"><span>Current contract</span><b>${fMon(r.cStart)} → ${fMon(r.cEnd)}${(() => { const x = termOf(r); return x ? ` · ${x.t}-yr ${esc(x.kind)}` : ''; })()}</b></div>
        <div class="kv"><span>Annual value (accepted bid)</span><b>${fGbp(r.cur?.acceptedBid)}</b></div>
        <div class="kv"><span>Bids received</span><b>${r.cur?.numberOfTenderers ?? '—'}${r.cur?.lowestBid && r.cur?.acceptedBid ? ` <span class="sub" style="font-weight:400">· accepted ${r.cur.acceptedBid <= r.cur.lowestBid ? 'the lowest' : '+' + ((r.cur.acceptedBid / r.cur.lowestBid - 1) * 100).toFixed(1) + '% over lowest'}</span>` : ''}</b></div>
        ${r.next ? `<div class="kv"><span>Next tender</span><b>issues ${fMon(r.next.issueDate)} · starts ${fMon(r.next.contractStart)}</b></div>` : ''}</section>
      <section><h4>Peak load along the route</h4><div id="profBox"><div class="sub">Loading…</div></div></section>
      <section><h4>Operated mileage · last 13 periods</h4>${lineChart(opSeries, { fmt:v => v.toFixed(1) + '%', ref:r.opMin, refLabel:r.opMin != null ? 'Min ' + r.opMin + '%' : '' })}</section>
      <section><h4>Reliability · ${esc(r.relMetric ?? '—')}</h4>${lineChart(relSeries, { fmt:v => v.toFixed(2), ref:r.relStd, refLabel:r.relStd != null ? 'Std ' + r.relStd : '' })}<div class="sub">${/EWT/.test(r.relMetric ?? '') ? 'Lower is better.' : 'Higher is better.'}</div></section>
      <section><h4>Corridor risk</h4><div id="riskBox"><div class="sub">Loading…</div></div></section>
      <section><h4>Price history · £ per mile at award</h4>${lineChart(hist, { fmt:v => '£' + v.toFixed(2), h:110 })}</section>
      <section><h4>Award history</h4><div class="tl">${r.hist.map(a => { const g = grp(a.operator); return `<div class="it"><i class="dot" style="background:${opColour(g)}"></i><div><div class="t">${esc(a.operator)}${a.operatorChange ? ' <span class="tag blue" style="margin-left:4px">Operator change</span>' : ''}</div><div class="m">${esc(fDate(a.awardDate))} · ${a.numberOfTenderers ?? '?'} bid${a.numberOfTenderers === 1 ? '' : 's'}${a.fromOperator && a.operatorChange ? ' · from ' + esc(a.fromOperator) : ''}</div></div><div class="p">${a.costPerMile ? '£' + a.costPerMile.toFixed(2) : '—'}<div class="m" style="font-weight:400">${fGbp(a.acceptedBid)}/yr</div></div></div>`; }).join('') || '<div class="sub">No award history.</div>'}</div></section>
    </div>`;
  $('#mapSlot')?.replaceWith(MH);
  if(!MP.failed) mapShow(r);
  profileData().then(pd => { const b = $('#profBox'); if(b && S.route === r.id) b.innerHTML = profileChart(pd?.routes?.[r.id]?.loadProfile) + '<div class="sub">Share of capacity used at each stop in the busiest period; the amber line is 80%.</div>'; }).catch(() => { const b = $('#profBox'); if(b) b.innerHTML = '<div class="sub">Load profile unavailable.</div>'; });
  corridor(r).then(c => {
    const b = $('#riskBox'); if(!b || S.route !== r.id) return;
    const sv = c.coll.filter(a => a.severity === 'serious').length, fa = c.coll.filter(a => a.severity === 'fatal').length, low = c.bridges.filter(x => Number.isFinite(x.height_m)).sort((x, y) => x.height_m - y.height_m)[0];
    b.innerHTML = c.ok ? `<div class="mini" style="grid-template-columns:repeat(3,1fr)"><div><div class="l">Collisions</div><div class="v">${c.coll.length}</div><div class="s">${esc(c.period)}, ≤100 m</div></div><div><div class="l">Serious or fatal</div><div class="v">${sv + fa}</div><div class="s">${sv} serious · ${fa} fatal</div></div><div><div class="l">Lowest bridge</div><div class="v">${low ? low.height_m + ' m' : '—'}</div><div class="s">${low ? esc(low.name ?? low.road ?? '') .slice(0, 22) : 'none within 25 m'}</div></div></div>
      <div class="sub" style="margin-top:8px">Bus and coach collisions near the route line, not an operator safety measure. A double-decker needs about 4.4 m.</div>` : '<div class="sub">Collision data unavailable.</div>';
  }).catch(() => { const b = $('#riskBox'); if(b) b.innerHTML = '<div class="sub">Corridor data unavailable.</div>'; });
}
let lastFocus = null;
export function openRoute(id, push = true){
  const r = D.byId.get(id); if(!r) return;
  const inScope = S.garage ? r.garage === S.garage : (S.op === ALL || r.op === S.op);
  if(!inScope){ if(S.garage && r.garage !== S.garage) S.garage = null; if(S.op !== ALL && S.op !== r.op) S.op = r.op; S.q = ''; S.prop = 'all'; S.flags.clear(); S.year = null; renderAll(); }
  if(S.route !== id) S.dir = 'outbound';
  S.route = id; renderDrawer(r);
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('open');
  lastFocus ??= document.activeElement; $('#dClose')?.focus();
  $$('tr.row').forEach(t => t.classList.toggle('sel', t.dataset.r === id));
  if(push) syncHash();
}
export function closeRoute(){
  if(!S.route) return; S.route = null;
  liveStop(); MP.tok++;
  $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('open');
  $$('tr.row.sel').forEach(t => t.classList.remove('sel')); lastFocus?.focus?.(); lastFocus = null; syncHash();
}
export function stepRoute(d){ const l = filtered(), i = l.findIndex(x => x.id === S.route); const n = l[i + d]; if(n) openRoute(n.id); }
