/* View: fleet register, depots and quality. */
import { D, FLAG } from '../data.js';
import { $, esc } from '../dom.js';
import { fInt, fNum, fPct, nOf, sum, warnIcon } from '../format.js';
import { SC } from '../state.js';
import { AGE_LIMIT, CLASS, opColour, OPS } from '../tokens.js';
import { shortOp } from './hero.js';
import { renderH2H, renderPrice, renderRecord } from './record.js';

/* ── view: fleet register / depots / quality ─────────────────────────────── */
function renderFleet(){
  const sc = SC(), F = sc.F, N = D.FNET, s = sc.st, mixOrder = ['diesel', 'hybrid', 'zero'], maxH = Math.max(1, ...F.hist.map(h => h.n));
  const ramp = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];
  $('#fleet').innerHTML = `<div class="ch"><div><h2>Fleet register</h2><p>${fInt(F.n)} ${sc.kind === 'garage' ? 'registered vehicles seen on its routes' : 'registered vehicles · ' + fNum(s.spare, 2) + '× its peak requirement'}</p></div></div>
    <div class="cb"><div class="sub" style="margin-bottom:6px">Peak vehicles by propulsion</div><div class="stack" role="img" aria-label="Propulsion mix">${mixOrder.map(k => s.mix[k] > 0 ? `<i style="width:${s.mix[k]}%;background:${CLASS[k].c}" data-tip="${CLASS[k].label}\n${fPct(s.mix[k])} of peak vehicles"></i>` : '').join('')}</div>
      <div class="legend">${mixOrder.map(k => `<span><i style="background:${CLASS[k].c}"></i>${CLASS[k].label} <b style="color:var(--ink)">${fPct(s.mix[k], 0)}</b></span>`).join('')}</div>
      <h4 class="mh">Age profile · years since first registration</h4>
      <div class="hist" role="img" aria-label="Vehicle age profile">${F.hist.map((h, i) => `<div class="hc" data-tip="${h.label} years\n${fInt(h.n)} vehicles (${fPct(F.n ? h.n / F.n * 100 : null, 0)})"><span class="n">${h.n ? fInt(h.n) : ''}</span><span class="b" style="height:${h.n / maxH * 100}%;background:${ramp[i]}"></span><span class="x">${h.label}</span></div>`).join('')}</div>
      <div style="margin-top:12px"><div class="kv"><span>Average age</span><b>${fNum(F.avg, 1)} yrs <span class="sub" style="font-weight:400">· network ${fNum(N.avg, 1)}</span></b></div>
      <div class="kv"><span>Registered in the last 3 years</span><b>${fPct(F.young, 0)}</b></div><div class="kv"><span>12 years or older</span><b>${fPct(F.old, 0)}</b></div></div>
      <h4 class="mh">Most common makes</h4>
      ${F.makes.map(([n, c]) => `<div class="kv mk"><span>${esc(n.length <= 4 ? n : n.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase()))}</span><span class="meter" style="height:6px"><i style="width:${c / (F.makes[0]?.[1] || 1) * 100}%"></i></span><b>${Math.round(c / F.n * 100)}%</b></div>`).join('')}</div>`;
}
function renderDepots(){
  const sc = SC(); if(sc.kind === 'garage') return renderGarageCard(sc);
  const rows = sc.depots, total = sum(rows, d => d.pvr), top = rows[0];
  const shown = rows.slice(0, 6), withCap = rows.filter(d => d.util != null);
  $('#depots').innerHTML = `<div class="ch"><div><h2>Depots</h2><p>Peak vehicles against licensed capacity</p></div></div>
    <div class="cb">${top ? `<div class="big">${fPct(total ? top.pvr / total * 100 : null, 0)}</div><div class="sub" style="margin:2px 0 12px">of peak vehicles run from ${sc.kind === 'all' ? 'the largest depot' : 'its largest depot'}, ${esc(top.name)}</div>` : ''}
      ${shown.map(d => { const u = d.util, sev = u == null ? '' : u > 1 ? 'crit' : u >= .9 ? 'warn' : '';
        return `<div class="dp" data-tip="${esc(d.name)} (${esc(d.code)})\n${d.pvr} peak vehicles · ${nOf(d.routes, 'route')}${d.capacity ? '\nLicensed capacity ' + d.capacity : '\nCapacity not published'}"><span class="nm">${esc(d.name)}<span class="sub"> ${esc(d.code)}</span></span>
          <span class="meter ${sev}"><i style="width:${u == null ? 0 : Math.min(100, u * 100)}%"></i></span><span class="u">${u == null ? '—' : Math.round(u * 100) + '%'}</span><span class="fl">${sev === 'crit' ? `<span class="flag">${warnIcon}Over</span>` : sev === 'warn' ? `<span class="flag">${warnIcon}Tight</span>` : ''}</span></div>`; }).join('')}
      ${rows.length > 6 ? `<div class="sub" style="margin-top:6px">+ ${rows.length - 6} more depots</div>` : ''}
      <div class="sub" style="margin-top:10px">${withCap.length} of ${rows.length} depots have a published licence capacity. Peak vehicles exclude spares, so utilisation is a floor.</div></div>`;
}
function renderGarageCard(sc){
  const g = sc.g, s = sc.st, util = g.capacity ? s.pvr / g.capacity : null, sev = util == null ? '' : util > 1 ? 'crit' : util >= .9 ? 'warn' : '';
  const rs = [...sc.list].sort((a, b) => b.pvr - a.pvr);
  $('#depots').innerHTML = `<div class="ch"><div><h2>Garage</h2><p>${esc(g.name)} (${esc(g.code)}) · ${esc(g.postcode ?? '')}</p></div></div>
    <div class="cb"><div class="big">${util == null ? '—' : Math.round(util * 100) + '%'}</div><div class="sub" style="margin:2px 0 10px">${g.capacity ? `peak vehicles (${s.pvr}) against licensed capacity (${g.capacity})` : 'licensed capacity not published'}</div>
      <div class="meter ${sev}"><i style="width:${util == null ? 0 : Math.min(100, util * 100)}%"></i></div>
      <h4 class="mh">Routes by peak vehicles</h4>
      ${rs.slice(0, 6).map(r => `<button class="nx" data-r="${esc(r.id)}"><span class="badge" style="height:22px;min-width:38px;font-size:11.5px">${esc(r.id)}</span><span class="cor">${esc(r.from)} <span class="sub">⇄</span> ${esc(r.to)}</span><b style="font-weight:600">${r.pvr}</b></button>`).join('')}
      ${rs.length > 6 ? `<div class="sub" style="margin-top:6px">+ ${rs.length - 6} more routes</div>` : ''}</div>`;
}
function renderQuality(){
  const sc = SC(), s = sc.st, N = D.NET;
  const gap = sc.kind !== 'all' && Number.isFinite(s.opPct) && Number.isFinite(N.opPct) ? s.opPct - N.opPct : null;
  const worst = [...s.list].filter(r => r.opPct != null).sort((a, b) => a.opPct - b.opPct).slice(0, 3);
  $('#quality').innerHTML = `<div class="ch"><div><h2>Service quality</h2><p>TfL's latest reported period</p></div></div>
    <div class="cb"><div class="big">${fPct(s.opPct)}</div><div class="sub" style="margin:2px 0 10px">of scheduled mileage operated${gap != null ? ` · ${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(2)} pts vs network` : ''}</div>
      <div class="meter" data-tip="Operated mileage ${fPct(s.opPct, 2)}"><i style="width:${Math.max(0, Math.min(100, (s.opPct - 80) / 20 * 100))}%"></i></div><div class="sub" style="display:flex;justify-content:space-between;margin-top:3px"><span>80%</span><span>100%</span></div>
      <div style="margin-top:10px"><div class="kv"><span>Same period last year</span><b>${s.yoy != null ? `<span class="delta ${s.yoy >= 0 ? 'up' : 'dn'}">${s.yoy >= 0 ? '▲' : '▼'} ${Math.abs(s.yoy).toFixed(2)} pts</span>` : '—'}</b></div>
      <div class="kv"><span>Est. mileage lost per period</span><b>${fInt(s.lostKm)} km</b></div>
      <div class="kv"><span>Routes meeting reliability standard</span><b>${fPct(s.relPassPct, 0)}</b></div>
      <div class="kv"><span>Routes at ≥80% of capacity at peak</span><b>${s.crowded}</b></div>
      <div class="kv"><span>Disrupted right now</span><b>${s.disrupted} <span class="sub" style="font-weight:400">of ${s.n}</span></b></div></div>
      ${worst.length ? `<h4 class="mh">Lowest operated mileage</h4>${worst.map(r => `<button class="nx" data-r="${esc(r.id)}"><span class="badge" style="height:22px;min-width:38px;font-size:11.5px">${esc(r.id)}</span><span class="cor">${esc(r.from)} <span class="sub">⇄</span> ${esc(r.to)}</span><b style="font-weight:600">${r.opPct.toFixed(1)}%</b></button>`).join('')}` : ''}</div>`;
}
function renderWatch(){
  const s = SC().st, list = [...s.attention].sort((a, b) => b.flags.length - a.flags.length || b.pvr - a.pvr);
  const chips = r => r.flags.map(k => `<span class="sig" data-tip="${esc(FLAG[k].long)}">${warnIcon}${esc(FLAG[k].label)}</span>`).join('');
  $('#watch').innerHTML = `<div class="ch"><div><h2><svg class="spk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>Needs attention</h2>
      <p>${list.length} of ${nOf(s.n, 'route')} show three or more signals from: materially poor reliability or mileage, contract ending within a year, crowding, disruption, an ageing fleet</p></div>
      <div class="ctl"><button class="btn" id="watchAll">View all in table</button></div></div>
    <div class="cb"><div class="wl">${list.slice(0, 8).map(r => `<button class="nx wr" data-r="${esc(r.id)}"><span class="badge" style="height:24px;min-width:40px;font-size:12px">${esc(r.id)}</span>
      <span class="wm"><span class="cor">${esc(r.from)} <span class="sub">⇄</span> ${esc(r.to)}</span><span class="sigs">${chips(r)}</span></span><span class="sub" style="white-space:nowrap">${fInt(r.pvr)} PVR</span></button>`).join('') || '<div class="empty">No routes with three or more signals.</div>'}</div></div>`;
}
function renderAgeOut(){
  const sc = SC(), F = sc.F, L = F.limit, nearly = L.soon + L.at, maxN = Math.max(1, ...L.rows.map(x => x.n));
  const ramp = ['var(--seq-5)', 'var(--seq-4)', 'var(--seq-3)', 'var(--seq-2)', 'var(--seq-1)'];
  const bars = `<div class="ao-bars" role="img" aria-label="Buses reaching the ${AGE_LIMIT}-year limit by year">${L.rows.map((x, i) => `<div class="ao-b" data-tip="${i === 0 ? `Registered more than ${AGE_LIMIT} years ago: ${fInt(x.n)} buses` : `${fInt(x.n)} buses reach ${AGE_LIMIT} years in ${x.label}`}"><span class="n">${x.n ? fInt(x.n) : ''}</span><span class="bar" style="height:${x.n / maxN * 100}%;background:${ramp[i]}"></span><span class="x">${i === 0 ? `Past ${AGE_LIMIT}` : x.label}</span></div>`).join('')}</div>`;
  // who is most exposed: operators (network), garages (operator) or routes (garage)
  let side = '', sideTitle = '';
  const bar = (name, n, tot, click) => `<div class="kv ao-row" ${click ?? ''}><span class="nm">${name}</span><span class="meter" style="height:6px"><i style="width:${tot ? Math.min(100, n / tot * 100) : 0}%"></i></span><b>${tot ? Math.round(n / tot * 100) + '%' : '—'}</b></div>`;
  if(sc.kind === 'all'){
    sideTitle = 'Share of fleet ageing out, by operator';
    side = OPS.map(o => { const f = D.FLEET[o].limit; return { o, p:f.known ? (f.soon + f.at) / f.known : -1, n:f.soon + f.at, k:f.known }; }).filter(x => x.p >= 0).sort((a, b) => b.p - a.p)
      .map(x => bar(`<i class="dot" style="background:${opColour(x.o)}"></i>${esc(shortOp(x.o))} <span class="sub">${fInt(x.n)}</span>`, x.n, x.k, `data-op="${esc(x.o)}" role="button" tabindex="0"`)).join('');
  } else if(sc.kind === 'op'){
    sideTitle = 'Garages with the most ageing vehicles seen on their routes';
    side = D.DEPOTS[sc.op].map(d => D.garageScope(d.code)).filter(Boolean).map(g => ({ g, f:g.F.limit })).filter(x => x.f.known >= 8).map(x => ({ ...x, n:x.f.soon + x.f.at, p:(x.f.soon + x.f.at) / x.f.known })).sort((a, b) => b.p - a.p).slice(0, 6)
      .map(x => bar(`${esc(x.g.g.name)} <span class="sub">${esc(x.g.code)} · ${fInt(x.n)}</span>`, x.n, x.f.known, `data-gar="${esc(x.g.code)}" role="button" tabindex="0"`)).join('');
  }
  const routes = [...sc.st.list].filter(r => r.vSeen >= 3 && r.vOld > 0).sort((a, b) => b.vOld / b.vSeen - a.vOld / a.vSeen || b.vOld - a.vOld).slice(0, 6);
  $('#ageout').innerHTML = `<div class="ch"><div><h2>Replacement runway</h2><p>Buses reaching TfL's ${AGE_LIMIT}-year maximum age, by year of first registration + ${AGE_LIMIT}</p></div></div>
    <div class="cb"><div class="ao"><div><div class="aohead"><div class="big">${fInt(nearly)}</div><div class="sub">buses (${fPct(L.known ? nearly / L.known * 100 : null, 0)} of the ${fInt(L.known)} with a known year) reach the limit by ${D.YEAR + 2}<br>${fInt(L.over)} are past ${AGE_LIMIT}, ${fInt(L.rows[1].n)} reach it this year · ${fInt(L.within36)} by ${D.YEAR + 3}</div></div>${bars}</div>
      <div>${side ? `<h4 class="mh" style="margin-top:0">${sideTitle}</h4>${side}` : `<h4 class="mh" style="margin-top:0">Where it bites</h4><div class="sub">Ageing vehicles run on the routes listed alongside.</div>`}</div>
      <div><h4 class="mh" style="margin-top:0">Routes with the most ageing vehicles</h4>${routes.map(r => `<button class="nx" data-r="${esc(r.id)}"><span class="badge" style="height:22px;min-width:38px;font-size:11.5px">${esc(r.id)}</span><span class="cor">${esc(r.from)} <span class="sub">⇄</span> ${esc(r.to)}</span><span class="sub" style="white-space:nowrap">${r.vOld} of ${r.vSeen}</span></button>`).join('') || '<div class="sub">No routes with several ageing vehicles.</div>'}</div></div>
      <div class="sub" style="margin-top:10px">Ages come from the registration year of each vehicle in the fleet register, so a bus reaches ${AGE_LIMIT} in the calendar year ${AGE_LIMIT} years after its first registration. Buses past the limit may be on approved extensions, in reserve or re-bodied: the register dates the chassis. Per-route counts are vehicles recently seen on that route.</div></div>`;
}
export function renderCards(){ renderRecord(); renderH2H(); renderPrice(); renderFleet(); renderDepots(); renderQuality(); renderAgeOut(); renderWatch(); }
