/* View: operator header + KPIs and the written briefing. */
import { D } from '../data.js';
import { $, esc } from '../dom.js';
import { fDate, fGbp, fInt, fNum, fPct, nOf, warnIcon } from '../format.js';
import { pathD, projector } from '../geometry.js';
import { S, SC } from '../state.js';
import { AGE_LIMIT, ALL, opColour, OPS } from '../tokens.js';

/* ── view: header + KPIs ─────────────────────────────────────────────────── */
const initials = o => o.replace(/London|Bus/g, '').trim().split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const shortOp = o => ({ 'Go-Ahead London':'Go-Ahead', 'Stagecoach London':'Stagecoach', 'Transport UK London Bus':'Transport UK', 'First Bus London':'First', 'Arriva London':'Arriva', 'HCT Group (CT Plus)':'HCT Group' }[o] ?? o);
const rank = (metricFn, op, desc = true) => { const v = OPS.map(o => [o, metricFn(D.ST[o])]).filter(([, x]) => x != null).sort((a, b) => desc ? b[1] - a[1] : a[1] - b[1]); return v.findIndex(([o]) => o === op) + 1; };
const delta = (v, base, { good = null, unit = '%' } = {}) => {
  if(!Number.isFinite(v) || !Number.isFinite(base) || !base) return '';
  const p = (v / base - 1) * 100; const up = p >= 0;
  const cls = good === null ? 'nu' : (up === good ? 'up' : 'dn');
  return `<span class="delta ${cls}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}${unit}</span>`;
};
function spark(series){
  const v = series.filter(Number.isFinite); if(v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), rng = (hi - lo) || 1;
  const pts = series.map((y, i) => Number.isFinite(y) ? [4 + i / (series.length - 1) * 138, 26 - (y - lo) / rng * 20] : null).filter(Boolean);
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 150 30" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Operated mileage, last ${series.length} periods"><path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="var(--accent)" stroke="#fff" stroke-width="2"/></svg>`;
}
function footprint(sc){
  const W = 440, H = 190, P = projector(D.bb, W, H, 12), c = sc.colour;
  const mine = new Set(sc.list.map(r => r.id));
  let ghost = '', own = '';
  for(const [id, cs] of D.lines){ const d = pathD(cs, P); if(mine.has(id)) own += `<path data-r="${esc(id)}" d="${d}" fill="none" stroke="${sc.kind === 'all' ? opColour(D.byId.get(id)?.op) : c}" stroke-width="1" stroke-opacity=".65" stroke-linecap="round" stroke-linejoin="round"/>`; else ghost += `<path d="${d}" fill="none" stroke="#dfe2e8" stroke-width=".7"/>`; }
  const gs = [...new Set(sc.list.map(r => r.garage))].map(code => D.garages.find(g => g.code === code)).filter(g => g && Number.isFinite(g.lat));
  const dots = gs.map(g => { const [x, y] = P(g.lng, g.lat); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2.5 + Math.sqrt(g.pvr || 10) * .32).toFixed(1)}" fill="${sc.kind === 'all' ? opColour(g.operator) : c}" stroke="#fff" stroke-width="2" data-tip="${esc(g.name)} garage\n${esc(g.pvr)} PVR"/>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(sc.name)} route footprint across London">${ghost}${own}${dots}</svg><span class="cap">${sc.st.garages} garage${sc.st.garages === 1 ? '' : 's'} · ${nOf(sc.st.n, 'route')}</span>
    <button class="expand" data-expand="net" aria-label="Open the map full page" data-tip="Open the map full page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button>`;
}
const pctd = (v, base) => Number.isFinite(v) && Number.isFinite(base) && base ? (v / base - 1) * 100 : null;
const dTxt = (p, suffix = '% vs network') => p == null ? '' : `<span class="delta nu">${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(p > -10 && p < 10 ? 1 : 0)}${suffix}</span>`;
function briefing(sc){
  const s = sc.st, r = sc.rec, F = sc.F, N = D.NET, o = sc.name;
  const share = N.pvr ? s.pvr / N.pvr * 100 : null, vshare = N.value ? s.value / N.value * 100 : null;
  const gap = Number.isFinite(s.opPct) && Number.isFinite(N.opPct) && sc.kind !== 'all' ? s.opPct - N.opPct : null;
  const vs = Number.isFinite(s.cpm) && D.netMedianCpm && sc.kind !== 'all' ? ` (${s.cpm >= D.netMedianCpm ? '+' : '−'}${Math.abs(pctd(s.cpm, D.netMedianCpm)).toFixed(1)}% vs network)` : '';
  let pos, comp;
  if(sc.kind === 'all'){
    const mom = OPS.map(x => [x, D.REC[x].won - D.REC[x].lost]).sort((a, b) => b[1] - a[1]), t = r.retained + r.changed;
    pos = `London's bus network is <b>${nOf(s.n, 'route')}</b> run by <b>${nOf(OPS.length, 'operator')}</b> from <b>${s.garages}</b> garages, needing <b>${fInt(s.pvr)}</b> peak vehicles. Contracts are worth about <b>${fGbp(s.value)}</b> a year, at a median <b>£${fNum(s.cpm, 2)}/mile</b>.`;
    comp = `Over five years <b>${r.changed}</b> of <b>${t}</b> re-tenders (${fPct(t ? r.changed / t * 100 : null, 0)}) changed operator. Biggest net gainer: <b>${esc(shortOp(mom[0][0]))}</b> (+${mom[0][1]}); biggest net loser: <b>${esc(shortOp(mom[mom.length - 1][0]))}</b> (${mom[mom.length - 1][1] < 0 ? '−' : '+'}${Math.abs(mom[mom.length - 1][1])}).`;
  } else if(sc.kind === 'garage'){
    const opS = D.ST[sc.op], t = r.retained + r.won, g = sc.g;
    pos = `<b>${esc(o)}</b> (${esc(shortOp(sc.op))}) runs <b>${nOf(s.n, 'route')}</b> with <b>${fInt(s.pvr)}</b> peak vehicles: ${fPct(opS.pvr ? s.pvr / opS.pvr * 100 : null, 1)} of ${esc(shortOp(sc.op))}'s requirement and ${fPct(share, 1)} of London's. Contracts are worth <b>${fGbp(s.value)}</b> a year${Number.isFinite(s.cpm) ? `, median <b>£${fNum(s.cpm, 2)}/mile</b>${vs}` : ''}${g.capacity ? `; licensed for <b>${g.capacity}</b> vehicles (${fPct(g.capacity ? s.pvr / g.capacity * 100 : null, 0)} of that is peak requirement)` : ''}.`;
    const tw = Object.entries(r.wonFrom).sort((a, b) => b[1] - a[1])[0];
    comp = t ? `Of <b>${t}</b> re-tenders on its current routes in five years, <b>${r.retained}</b> were retained by ${esc(shortOp(sc.op))} and <b>${r.won}</b> won from rivals${tw ? ` (mostly from ${esc(tw[0])})` : ''}. Routes lost to rivals are no longer at this garage, so they are not counted.` : 'No re-tenders on its current routes in the last five years.';
  } else {
    const contested = r.retained + r.lost, ret = contested ? r.retained / contested * 100 : null;
    const topLoss = Object.entries(r.lostTo).sort((a, b) => b[1] - a[1])[0], topWin = Object.entries(r.wonFrom).sort((a, b) => b[1] - a[1])[0];
    pos = `${esc(o)} runs <b>${fPct(share, 1)}</b> of London's peak buses (#${rank(x => x.pvr, o)} of ${OPS.length}) and holds <b>${fPct(vshare, 1)}</b> of contract value, at a median <b>£${fNum(s.cpm, 2)}/mile</b>${vs}.`;
    comp = `Kept <b>${fPct(ret, 0)}</b> of its re-tenders over five years and is <b>${r.won - r.lost >= 0 ? '+' : '−'}${Math.abs(r.won - r.lost)}</b> routes net against rivals${topWin ? ` — most wins from ${esc(topWin[0])} (+${topWin[1]})` : ''}${topLoss ? `, most losses to ${esc(topLoss[0])} (−${topLoss[1]})` : ''}.`;
  }
  const L = F.limit, nearly = L.soon + L.at;
  return [
    { k:'Position', t:pos },
    { k:'Renewals', t:s.exp24.length ? `<b>${nOf(s.exp24.length, 'route')}</b> worth <b>${fGbp(s.renewalValue)}</b> a year (${fPct(s.value ? s.renewalValue / s.value * 100 : null, 0)} of the portfolio) reach contract end within 24 months; <b>${s.exp24InProg}</b> already appear in TfL's tender programme.` : 'No contracts end within the next 24 months.' },
    { k:'Competition', t:comp },
    { k:'Delivery', t:`Operated <b>${fPct(s.opPct, 1)}</b> of scheduled mileage${gap != null ? ` (${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(2)} pts vs network)` : ''}; <b>${fPct(100 - (s.relPassPct ?? 0), 0)}</b> of routes miss their reliability standard and <b>${s.attention.length}</b> show three or more attention signals.` },
    { k:'Fleet', t:`<b>${fInt(F.n)}</b> vehicles${sc.kind === 'garage' ? ' seen on its routes' : ''}, average age <b>${fNum(F.avg, 1)} yrs</b>. <b>${fInt(nearly)}</b> (${fPct(L.known ? nearly / L.known * 100 : null, 0)}) reach TfL's ${AGE_LIMIT}-year limit by ${D.YEAR + 2}${L.at ? `, ${fInt(L.over)} already past it` : ''}; <b>${fPct(F.young, 0)}</b> were registered in the last three years and <b>${fPct(s.ze, 0)}</b> of peak vehicles are zero-emission.` },
  ];
}
export function renderHero(){
  const sc = SC(), o = sc.name, s = sc.st, c = sc.colour, F = sc.F, N = D.NET, FN = D.FNET;
  $('#opDot').style.background = S.op === ALL ? '#2a78d6' : opColour(S.op); $('#opName').textContent = S.op;
  $('#gName').textContent = S.garage ? sc.g.name : 'All garages';
  const mono = sc.kind === 'all' ? 'LN' : sc.kind === 'garage' ? sc.code : initials(o);
  const kind = (label, v, d, extra = '', tipText = '') => `<div class="card kpi s2" ${tipText ? `data-info="${esc(tipText)}"` : ''}><div class="l">${label}</div><div class="v">${v}</div>${extra}<div class="d">${d}</div></div>`;
  const sm = (label, v, d, tipText) => `<div class="card kpi sm s2" data-info="${esc(tipText)}"><div class="l">${label}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  const sh = N.pvr ? s.pvr / N.pvr * 100 : null, L = F.limit, nearly = L.soon + L.at;
  const rk = fn => sc.kind === 'op' ? `#${rank(fn, o)} of ${OPS.length}` : sc.kind === 'all' ? `${nOf(OPS.length, 'operator')}` : `${fPct(D.ST[sc.op].pvr ? s.pvr / D.ST[sc.op].pvr * 100 : null, 0)} of ${esc(shortOp(sc.op))}`;
  const opLast = s.opSeries.filter(Number.isFinite), opDelta = opLast.length > 1 ? opLast[opLast.length - 1] - opLast[opLast.length - 2] : null;
  const chips = sc.kind === 'all' ? [[s.n, 'routes'], [s.garages, 'garages'], [OPS.length, 'operators'], [fInt(FN.n), 'vehicles']]
    : sc.kind === 'garage' ? [[s.n, 'routes'], [fInt(s.pvr), 'peak vehicles'], [sc.g.capacity ?? '—', 'licensed capacity']] : [[s.n, 'routes'], [s.garages, 'garages'], [s.companies, 'operating companies'], [fInt(F.n), 'vehicles']];
  $('#hero').innerHTML = `<div class="printhead" hidden>londonbuses.org · Operator Intelligence · ${esc(sc.name)} · data as of ${esc(fDate(D.manifest?.generatedAt ?? new Date().toISOString()))}</div>
    <div class="card hero"><div class="who">
      <div class="mono" style="background:${c}1f;color:${c === '#eda100' ? '#8a5a00' : c}">${esc(mono)}</div>
      <div style="min-width:0"><h1>${esc(o)}</h1>
        <div class="chips">${sc.kind === 'garage' ? `<span class="chip"><i class="dot" style="background:${c}"></i>${esc(sc.op)}</span>` : ''}${chips.map(([n, l]) => `<span class="chip"><b>${n}</b> ${String(n).replace(/,/g, '') === '1' ? l.replace(/ies$/, 'y').replace(/s$/, '') : l}</span>`).join('')}</div>
        <div class="acts"><button class="btn primary" id="exportBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>Export routes</button><button class="btn" id="linkBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg><span id="linkTxt">Copy link</span></button><button class="btn" data-expand="net"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>Open map</button><button class="btn" id="printBtn" data-tip="Print or save this view as a one-page brief"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg>Brief</button>${sc.kind === 'garage' && Number.isFinite(sc.g?.lat) ? `<button class="btn" data-expand="pin" data-tip="Every route within 3 km of this garage, on the map"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.7-6-11a6 6 0 0 1 12 0c0 5.3-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>Catchment</button>` : ''}</div></div>
    </div><div class="foot" id="foot">${footprint(sc)}</div></div>`;
  $('#brief').innerHTML = `<div class="ch"><div><h2><svg class="spk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>Briefing</h2><p>What the data says about ${esc(o)} right now — generated from the figures below</p></div></div>
    <div class="cb"><div class="brief">${briefing(sc).map(b => `<div class="bi"><span class="bk">${b.k}</span><p>${b.t}</p></div>`).join('')}</div></div>`;
  $('#kpis').innerHTML = `
    <div class="card kpi hero-k s4"><div class="l">Est. annual contract value</div>
      <div class="v">${fGbp(s.value)}</div>
      <div class="d">${sc.kind === 'all' ? `<span>${nOf(s.n, 'route')}</span><span>${nOf(OPS.length, 'operator')}</span>` : `<span>${fPct(N.value ? s.value / N.value * 100 : null)} of network contract value</span><span>${rk(x => x.value)}</span>`}</div></div>
    ${sc.kind === 'all' ? kind('Peak vehicles', fInt(s.pvr), `<span>${fInt(FN.n)} registered</span><span>${fNum(NET_SPARE(), 2)}× spare</span>`) : kind('Share of peak buses', `${fPct(sh)}`, `<span>${fInt(s.pvr)} of ${fInt(N.pvr)} PVR</span><span>${rk(x => x.pvr)}</span>`)}
    ${kind('Median price', `${Number.isFinite(s.cpm) ? '£' + s.cpm.toFixed(2) : '—'}<small>/mile</small>`, sc.kind === 'all' ? '<span>network median</span>' : `${delta(s.cpm, D.netMedianCpm)}<span>vs network £${fNum(D.netMedianCpm, 2)}</span>`)}
    ${kind('Fleet age', `${fNum(F.avg, 1)}<small>years</small>`, `<span>${fPct(s.ze, 0)} zero-emission</span>${sc.kind === 'all' ? '' : `<span>network ${fNum(FN.avg, 1)} y</span>`}`, `<div class="agel" data-tip="Registered ${AGE_LIMIT - 2} or more years ago: these reach TfL's ${AGE_LIMIT}-year maximum vehicle age by ${D.YEAR + 2}, or already have.">${warnIcon}${fInt(nearly)} reach the ${AGE_LIMIT}-year limit by ${D.YEAR + 2}</div>`, 'Age is from the fleet register: every registered vehicle, by year of first registration. Zero-emission is the share of peak vehicles.')}
    ${kind('Operated mileage', `${fPct(s.opPct)}`, `${opDelta != null ? `<span class="delta ${opDelta >= 0 ? 'up' : 'dn'}">${opDelta >= 0 ? '▲' : '▼'} ${Math.abs(opDelta).toFixed(2)} pts</span><span>vs prior period</span>` : ''}`, spark(s.opSeries))}`;
  const waD = sc.kind !== 'all' && Number.isFinite(s.waut) && Number.isFinite(N.waut) ? s.waut - N.waut : null;
  $('#kpis2').innerHTML = `
    ${sm('Up for renewal', fGbp(s.renewalValue), `<span>${nOf(s.exp24.length, 'route')} · next 24 mo</span>`, 'Annual value of contracts whose end date falls within 24 months. Routes already in the tender programme: ' + s.exp24InProg)}
    ${sm('Remaining term', `${fNum(s.waut, 1)}<small>yrs</small>`, `${waD != null ? `<span class="delta ${waD >= 0 ? 'up' : 'nu'}">${waD >= 0 ? '▲' : '▼'} ${Math.abs(waD).toFixed(1)} yrs</span><span>vs network</span>` : ''}`, 'Contract-value-weighted average time left on current contracts. Longer means more secure revenue.')}
    ${sm('Value / vehicle', `${Number.isFinite(s.valuePerPvr) ? '£' + Math.round(s.valuePerPvr / 1000) + 'k' : '—'}<small>/yr</small>`, `${sc.kind === 'all' ? '' : dTxt(pctd(s.valuePerPvr, N.valuePerPvr))}`, 'Annual contract value divided by peak vehicle requirement: what each bus the contract needs is paid per year.')}
    ${sm('Km / vehicle', `${fInt(s.kmPerPvr)}<small>km/day</small>`, `${sc.kind === 'all' ? '' : dTxt(pctd(s.kmPerPvr, N.kmPerPvr))}`, 'Scheduled weekday kilometres per peak vehicle: how hard each bus the contract needs is worked. Higher means better vehicle utilisation.')}
    ${sm('Single-bid', `${fPct(s.singleBid, 0)}`, `<span>of ${s.bidN} current contracts</span>${sc.kind === 'all' ? '' : `<span>network ${fPct(N.singleBid, 0)}</span>`}`, 'Share of current contracts that attracted only one bid when tendered: low competition.')}
    ${sm('Ageing out', fInt(nearly), `<span>${fPct(L.known ? nearly / L.known * 100 : null, 0)} of fleet</span><span>${fInt(L.over)} past ${AGE_LIMIT}</span>`, `Vehicles registered ${AGE_LIMIT - 2} or more years ago: they reach TfL's ${AGE_LIMIT}-year maximum vehicle age by ${D.YEAR + 2} (or already have) and need replacing. From the fleet register, by year of first registration.`)}`;
}
const NET_SPARE = () => D.NET.spare;
