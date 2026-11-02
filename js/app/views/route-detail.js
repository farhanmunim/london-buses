/* View: Route detail — facts, fleet, tenders, status, with the £/mile tender-history chart. */
import { D, plate } from '../core/data.js';
import { incWhen } from '../core/incoming.js';
import { addLiveTimer, gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { esc, fmtDate, monthYear, nOf, num, opColor, stripTags, title, tvrOf, TYPE_LABEL } from '../core/utils.js';
import { pickStatus } from '../map/layers.js';
import { initRouteMap } from '../map/route-map.js';

/* ════════════════════ ROUTE DETAIL ════════════════════ */
export async function renderRouteDetail(name){
  const tok = state.navToken;
  const id = String(name ?? '').toUpperCase();
  main.innerHTML = `
    <a class="backrow" href="#/">‹ All routes</a>
    <div id="dhead"><div class="skel" style="height:46px;width:70%"></div></div>
    <div id="dstatus"></div>
    <div id="dfacts" class="facts">${'<div class="skel" style="height:52px"></div>'.repeat(6)}</div>
    <div class="section"><div class="section-h">Map</div><div id="map"></div>
      <div class="mapctl">
        <div class="seg" id="dirSeg"><button data-d="outbound" class="on" disabled>Outbound</button><button data-d="inbound" disabled>Inbound</button></div>
        <button class="livebtn iconb" id="stopsBtn" disabled style="margin-left:auto" title="Stops" aria-label="Stops"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg></button>
        <button class="livebtn iconb" id="liveBtn" disabled title="Live buses" aria-label="Live buses"><span class="spin"></span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="4" width="14" height="13" rx="2"/><line x1="5" y1="10" x2="19" y2="10"/><circle cx="9" cy="14" r=".8" fill="currentColor"/><circle cx="15" cy="14" r=".8" fill="currentColor"/></svg></button>
        <button class="livebtn iconb" id="closestBtn" disabled title="Garages" aria-label="Garages"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10 12 4l9 6"/><path d="M5 9v11h14V9"/></svg></button>
        <button class="livebtn iconb" id="bridgeBtn" disabled title="Low bridges" aria-label="Low bridges"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 18v-7"/><path d="M21 18v-7"/><path d="M3 13c3-4 15-4 18 0"/><path d="M2 18h20"/></svg></button>
        <button class="livebtn iconb" id="incBtn" disabled title="Incidents" aria-label="Incidents"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20Z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg></button>
        <button class="livebtn iconb" id="swMapBtn" disabled title="Street works" aria-label="Street works"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 4h-3L6 20h12z"/><path d="M9.2 10h5.6M7.9 15h8.2"/><path d="M4 20h16"/></svg></button>
        <button class="livebtn iconb" id="troMapBtn" disabled title="Traffic orders" aria-label="Traffic orders"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg></button>
        <span id="busLiveNote" style="display:none;align-items:center;gap:7px;font-size:12px;color:var(--mu)"><span class="livechip"><i class="pulse"></i>LIVE</span><span id="busLiveText"></span></span>
      </div>
      <div id="divnNote"></div>
    </div>
    <div id="dsections"></div>`;

  const [routes, meta] = await Promise.all([D.routes(), D.meta()]);
  if(gone(tok)) return;
  const route = routes?.find(r => r.name.toUpperCase() === id);
  const m = meta?.[route?.name] ?? meta?.[id] ?? {};
  if(!route){
    main.innerHTML = `<a class="backrow" href="#/">‹ All routes</a><div class="empty">${routes?.length
      ? `Route “${esc(id)}” isn’t in the current TfL network.`
      : 'The stop directory is unreachable right now — try again shortly.'}</div>`;
    return;
  }

  /* header */
  document.getElementById('dhead').outerHTML = `
    <div class="dhead">
      <span class="dnum ${esc(route.type)}">${esc(route.name)}</span>
      <div class="dtitle">
        <h1 id="dTermini">${esc(m.operator ?? 'London bus route')}</h1>
        <div class="sub2">${[
          TYPE_LABEL[route.type] ? esc(TYPE_LABEL[route.type]) : null,
          m.operator ? `<a href="#/operator/${encodeURIComponent(m.operator)}" style="color:var(--acc);font-weight:500">${esc(m.operator)}</a>` : null,
          m.garageName ? `<a href="#/garage/${encodeURIComponent(String(m.garage).split(/[^A-Za-z]/)[0])}" style="color:var(--acc);font-weight:500">${esc(m.garageName)} (${esc(m.garage)})</a>` : null,
        ].filter(Boolean).join(' · ')}</div>
      </div>
    </div>`;

  /* a changeover already awarded: who takes the route over and when (provisional awards say so) */
  D.incoming().then(inc => {
    const i = inc.byRoute.get(route.name); if(!i || gone(tok)) return;
    const el = document.getElementById('dstatus'); if(!el) return;
    el.insertAdjacentHTML('beforebegin', `<div class="changenote" role="note"><b>Changing operator:</b> <a href="#/operator/${encodeURIComponent(i.op)}" style="color:var(--acc);font-weight:600">${esc(i.op)}</a> has been awarded this route${i.from ? ` (now run by ${esc(i.from)})` : ''}, ${esc(incWhen(i))}.${i.provisional ? ' Provisional — community-reported, not yet in TfL’s published results.' : ''}</div>`);
  });

  /* live status — seconds-fresh feed, snapshot fallback, silently
     re-polled every 60 s so the banner tracks reality while the page
     stays open */
  async function refreshStatus(){
    const raw = await D.liveStatus(route.name);
    if(gone(tok)) return;   // navigated away (another route detail has its own #dstatus)
    const host = document.getElementById('dstatus');
    if(!host) return;   // navigated away
    let st = pickStatus(route.name, raw?.data?.[0]?.lineStatuses);
    if(!st){
      const snap = await D.lineStatus();
      if(gone(tok)) return;
      const row = snap?.rows?.find(r => r.route === route.name);
      if(row) st = { status: row.status, reason: row.reason || null, severity: row.severity };
    }
    if(!st) return;
    const good = st.severity === 10;
    host.innerHTML = `
      <div class="statusline ${good?'':'bad'}"><span class="dot"></span>
        <div><b>${esc(st.status ?? (good?'Good Service':'Disruption'))}</b>
        ${st.reason && !good ? `<div class="reason">${esc(st.reason)}</div>` : ''}</div>
      </div>`;
  }
  refreshStatus();
  addLiveTimer(setInterval(refreshStatus, 60000));

  /* fact tiles */
  const facts = [];
  facts.push(['PVR', m.pvr ?? '—'], ['TVR', tvrOf(m.pvr) ?? '—']);
  if(num(m.lengthKm)) facts.push(['Length', m.lengthKm + ' km']);
  facts.push(['Type', TYPE_LABEL[route.type] ?? route.type]);
  if(m.propulsion) facts.push(['Power', title(m.propulsion)]);
  if(m.fleet) facts.push(['Vehicle', stripTags(m.fleet)]);
  document.getElementById('dfacts').innerHTML =
    facts.slice(0,6).map(([l,v]) => `<div class="fact"><div class="l">${l}</div><div class="v" title="${esc(v)}">${esc(v).replace(/\//g, '/<wbr>')}</div></div>`).join('')
    + `<div class="fact"><div class="l">Deck</div><div class="v" id="deckVal">${
      /* Seed from the rostered-vehicle fleet code (DD/SD markers) so routes with
         no recent DVLA observations (school runs, PVR 1) still get a verdict;
         the observed-vehicle count overwrites this when a sample exists. */
      /\b(?:DD|ZEDD|HDD)\b/.test(m.fleet ?? '') ? 'Double deck'
        : /\b(?:SD|ZESD|HSD)\b/.test(m.fleet ?? '') ? 'Single deck' : '—'}</div></div>`;

  /* diversion note */
  D.diversions().then(divs => {
    if(gone(tok)) return;
    const dv = divs?.[route.name];
    if(!dv?.reasons?.length && !dv?.disruptions?.length) return;
    const reason = dv.disruptions?.[0]?.reason ?? '';
    const until = fmtDate(dv.until);
    document.getElementById('divnNote').innerHTML = `
      <div class="divn-note"><span aria-hidden="true">⚠️</span>
        <div><b>Diversion in effect${until ? ` until ${until}` : ''}.</b> ${esc(reason)}</div>
      </div>`;
  });

  /* the rest of the page */
  buildRouteSections(route, m, tok);

  /* map — lazy heavy payloads */
  initRouteMap(route, m, tok);

  /* termini in header once stops arrive */
  D.stops().then(stops => {
    if(gone(tok) || !document.getElementById('dTermini')) return;
    const rec = stops?.[route.name.toLowerCase()] ?? stops?.[route.name];
    const out = rec?.outbound ?? [];
    if(out.length >= 2){
      // TfL stop names occasionally carry sort-hack prefixes (".Russell Square")
      const clean = n => String(n ?? '').replace(/^[.\s#>]+/, '');
      document.getElementById('dTermini').textContent = `${clean(out[0].name)} → ${clean(out[out.length-1].name)}`;
    }
  });
}


async function buildRouteSections(route, m, tok){
  const el = document.getElementById('dsections');
  const frag = [];

  /* Performance */

  /* Crowding */
  const cr = await D.crowding();
  if(gone(tok)) return;
  const crRec = cr?.routes?.[route.name];
  if(crRec && num(crRec.peakVC)){
    const bandLabel = cr.bands?.find(b => b.key === crRec.band)?.label ?? title(crRec.band ?? '');
    const days = ['Weekday','Saturday','Sunday'].map(d => {
      const v = crRec.byDay?.[d]?.vc;
      return num(v) ? `<div><span class="k">${d}</span><span class="v mono">${Math.round(v*100)}% of capacity</span></div>` : '';
    }).join('');
    frag.push(`<div class="section"><div class="section-h">Crowding · ${esc(cr.year ?? '')}</div>
      <div class="card"><div class="kv">
        <div><span class="k">Peak load</span><span class="v"><b>${esc(bandLabel)}</b> · <span class="mono">${Math.round(crRec.peakVC*100)}%</span> of capacity</span></div>
        ${crRec.stopname ? `<div><span class="k">Busiest at</span><span class="v">${esc(title(crRec.stopname))}${crRec.time?` · ${esc(String(crRec.time).slice(0,5))}`:''}</span></div>` : ''}
        ${days}
      </div><div id="crowdProf"></div></div></div>`);
  }

  /* Fleet */
  const fl = (await D.fleet())?.[route.name];
  if(gone(tok)) return;
  if(fl && (fl.count > 0 || m.fleet)){
    const rows = [];
    if(m.fleet) rows.push(`<div><span class="k">Rostered vehicle</span><span class="v">${esc(stripTags(m.fleet))}</span></div>`);
    if(fl.count > 0) rows.push(`<div><span class="k">Observed in last sample</span><span class="v mono">${nOf(fl.count, 'vehicle')}</span></div>`);
    if(num(fl.avgAgeYears)) rows.push(`<div><span class="k">Average age</span><span class="v mono">${fl.avgAgeYears.toFixed(1)} years</span></div>`);
    if(fl.makes?.length) rows.push(`<div><span class="k">Makes</span><span class="v">${fl.makes.map(x=>`${esc(title(x.make))} (${x.n})`).join(', ')}</span></div>`);
    if(fl.regs?.length) rows.push(`<div id="deckRow"><span class="k">Deck</span><span class="v">—</span></div>`);
    if(fl.regs?.length){
      const shown = fl.regs.slice(0, 24);
      const hidden = fl.regs.slice(shown.length);
      rows.push(`<div><span class="k">Registrations</span><span class="v" style="display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-end">${shown.map(r => plate(r)).join('')}${hidden.length
        ? `<span id="regMore" hidden style="display:contents">${hidden.map(r => plate(r)).join('')}</span><button id="regMoreBtn" style="color:var(--acc);font-weight:600;font-size:12px;align-self:center">+${hidden.length} more</button>`
        : ''}</span></div>`);
    }
    if(rows.length) frag.push(`<div class="section"><div class="section-h">Fleet</div><div class="card"><div class="kv">${rows.join('')}</div></div></div>`);
  }

  /* Contract & tendering — latest and previous awards as individual lines */
  const tn = (await D.tenders())?.[route.name] ?? [];
  if(gone(tok)) return;
  const latest = tn[0], prev = tn[1];
  const rows = [];
  if(m.operator)   rows.push(`<div><span class="k">Operator</span><span class="v"><a href="#/operator/${encodeURIComponent(m.operator)}" style="color:var(--acc);font-weight:500">${esc(m.operator)}</a></span></div>`);
  if(m.company)    rows.push(`<div><span class="k">Company</span><span class="v">${esc(stripTags(m.company))}</span></div>`);
  if(m.contractStart) rows.push(`<div><span class="k">Contract start</span><span class="v mono">${esc(monthYear(m.contractStart) ?? m.contractStart)}</span></div>`);
  if(m.contractEnd)   rows.push(`<div><span class="k">Contract end</span><span class="v mono">${esc(monthYear(m.contractEnd) ?? m.contractEnd)}</span></div>`);
  const awardRows = (a) => {
    const r = [];
    if(a.awardDate) r.push(`<div><span class="k">Awarded on</span><span class="v mono">${esc(fmtDate(a.awardDate) ?? a.awardDate)}</span></div>`);
    if(a.operator)  r.push(`<div><span class="k">Awarded to</span><span class="v">${esc(a.operator)}</span></div>`);
    if(num(a.costPerMile))  r.push(`<div><span class="k">Cost per mile</span><span class="v mono">£${a.costPerMile.toFixed(2)}</span></div>`);
    if(num(a.acceptedBid))  r.push(`<div><span class="k">Accepted bid</span><span class="v mono">£${a.acceptedBid.toLocaleString('en-GB')}/yr</span></div>`);
    if(num(a.lowestBid))    r.push(`<div><span class="k">Lowest bid</span><span class="v mono">£${a.lowestBid.toLocaleString('en-GB')}/yr</span></div>`);
    if(num(a.highestBid))   r.push(`<div><span class="k">Highest bid</span><span class="v mono">£${a.highestBid.toLocaleString('en-GB')}/yr</span></div>`);
    const miPA = num(a.contractedMilesPA) ?? (num(a.acceptedBid) && num(a.costPerMile) && a.costPerMile > 0 ? Math.round(a.acceptedBid/a.costPerMile) : null);
    if(miPA != null)
      r.push(`<div><span class="k">Contracted miles</span><span class="v mono">${miPA.toLocaleString('en-GB')} mi/yr</span></div>`);
    if(num(a.numberOfTenderers)) r.push(`<div><span class="k">Bids received</span><span class="v mono">${a.numberOfTenderers}</span></div>`);
    const jb = a.jb;
    r.push(`<div><span class="k">Joint bid</span><span class="v">${jb?.isJoint ? 'Yes' + (jb.partners?.length ? ' · with ' + jb.partners.map(esc).join(', ') : '') : 'No'}</span></div>`);
    const v = a.vehicle;
    if(v && (v.basis || v.propulsion || v.deck)){
      const bits = [v.basis, v.propulsion, v.deck ? v.deck + '-deck' : null, v.euro ? 'Euro ' + v.euro : null].filter(Boolean);
      r.push(`<div><span class="k">Awarded vehicle</span><span class="v">${esc(bits.join(' · '))}</span></div>`);
    }
    if(num(a.tranche)) r.push(`<div><span class="k">Tranche</span><span class="v mono">${a.tranche}</span></div>`);
    return r;
  };
  /* Upcoming-tender flag: the route appears in the tendering programme
     with a contract start still ahead. */
  try {
    const today = new Date().toISOString().slice(0, 10);
    const prog = await D.programme();
    if(gone(tok)) return;
    const upcoming = prog
      .filter(e => String(e.route).toUpperCase().split('/').some(t => t.trim() === route.name.toUpperCase())
        && e.contractStart && e.contractStart >= today)
      .sort((a, b) => String(a.contractStart).localeCompare(String(b.contractStart)))[0];
    if(upcoming){
      const bits = [
        fmtDate(upcoming.issueDate) ? `tenders issued ${fmtDate(upcoming.issueDate)}` : null,
        fmtDate(upcoming.returnDate) ? `returns ${fmtDate(upcoming.returnDate)}` : null,
        upcoming.awardEstimated ? `award estimated ${esc(upcoming.awardEstimated)}` : null,
        fmtDate(upcoming.contractStart) ? `new contract starts <b>${fmtDate(upcoming.contractStart)}</b>` : null,
        upcoming.vehicleType ? esc(upcoming.vehicleType) : null,
        upcoming.twoYearExtension ? '+2 yr option' : null,
      ].filter(Boolean).join(' · ');
      frag.push(`<div class="divn-note" style="margin-top:14px"><span aria-hidden="true">📋</span>
        <div><b>Coming up for tender</b> — ${upcoming.programmeYear ? `${esc(upcoming.programmeYear.replace(/^(\d{4})-\d{2}(\d{2})$/, '$1/$2'))} programme` : 'tendering programme'}${upcoming.tranche ? `, tranche ${esc(upcoming.tranche)}` : ''}: ${bits}. <a href="#/tender/programme" style="color:inherit;text-decoration:underline">Tendering programme ›</a></div>
      </div>`);
    }
  } catch(e) { /* programme is enrichment — never fatal */ }

  frag.push(cpmChartHtml(route.name, tn));
  if(rows.length || latest){
    frag.push(`<div class="section"><div class="section-h">Current contract</div><div class="card"><div class="kv">${rows.join('')}${latest ? awardRows(latest).join('') : ''}</div></div></div>`);
  }
  if(prev){
    const opChanged = prev.operator && latest?.operator && prev.operator !== latest.operator;
    frag.push(`<div class="section"><div class="section-h">Previous award${opChanged ? ' · operator change' : ''}</div>
      <div class="card"><div class="kv">${awardRows(prev).join('')}</div></div></div>`);
  }

  el.innerHTML = frag.join('');

  /* Deck type from the observed vehicles — the registry knows each bus.
     Registered AFTER the innerHTML write above: with a cache-warm vehicles
     promise the callback fires on the next microtask, and #deckRow only
     exists once the Fleet card is in the DOM (registering earlier left the
     row stuck at "—" on every cache-warm visit). */
  if(fl?.regs?.length){
    D.vehiclesReg().then(reg => {
      if(gone(tok)) return;
      const decks = fl.regs.map(r => reg?.[r]?.deck).filter(Boolean);
      if(!decks.length) return;
      const dd = decks.filter(d => d === 'double').length, sd = decks.length - dd;
      const dv = document.getElementById('deckVal');
      if(dv) dv.textContent = dd && sd ? `Mixed · ${dd} DD / ${sd} SD` : dd ? 'Double deck' : 'Single deck';
      const kv = document.getElementById('deckRow');
      if(kv) kv.querySelector('.v').textContent = dd && sd ? `Mixed — ${dd} double, ${sd} single` : dd ? `Double deck (${dd})` : `Single deck (${sd})`;
    });
  }

  /* £/mile chart hover/focus tooltip (delegated; works on touch via tap) */
  const cw = el.querySelector('.cpmwrap');
  if(cw){
    const tipEl = cw.querySelector('.cpm-tip');
    const show = h => {
      tipEl.innerHTML = h.dataset.cpmtip;
      tipEl.hidden = false;
      const x = Math.min(Math.max(parseFloat(h.dataset.x), 14), 86);
      tipEl.style.left = x + '%';
      tipEl.style.top = `calc(${h.dataset.y}% - 12px)`;
    };
    cw.addEventListener('pointerover', e => { const h = e.target.closest('.cpm-hit'); if(h) show(h); });
    cw.addEventListener('pointerout',  e => { if(e.target.closest('.cpm-hit')) tipEl.hidden = true; });
    cw.addEventListener('focusin',  e => { const h = e.target.closest('.cpm-hit'); if(h) show(h); });
    cw.addEventListener('focusout', e => { if(e.target.closest('.cpm-hit')) tipEl.hidden = true; });
  }
  document.getElementById('regMoreBtn')?.addEventListener('click', e => {
    document.getElementById('regMore').hidden = false;
    e.currentTarget.remove();
  });

  /* crowding profile (lazy) */
  if(document.getElementById('crowdProf')){
    D.crowdProf().then(cp => {
      if(gone(tok) || !document.getElementById('crowdProf')) return;
      const prof = cp?.[route.name]?.loadProfile;
      if(!prof || prof.length < 5) return;
      const bars = prof.map(p =>
        `<div class="${p.vc>=0.8?'hi':''}" style="height:${Math.max(4, Math.round(Math.min(p.vc,1.2)/1.2*100))}%" title="${esc(title(p.name))} · ${Math.round(p.vc*100)}%"></div>`).join('');
      document.getElementById('crowdProf').innerHTML =
        `<div style="padding:10px 14px;border-top:1px solid var(--bd)">
          <div class="bars">${bars}</div>
          <div class="legendrow"><span>Load along the route (peak direction)</span><span><i style="background:var(--acc)"></i>Crowded stop (≥80%)</span></div>
        </div>`;
    });
  }
}

/* £/mile tender history — a STEP chart: the awarded price holds until the
   next award, so the line runs flat and jumps at each new contract (a
   diagonal would invent growth that never happened). Steps wear the colour
   of the incumbent operator, so an operator change reads as the colour
   break at the riser; markers sit at award dates with a surface ring.
   Values are NOT CPI-indexed (deliberate — nominal £ as awarded). */
function cpmChartHtml(routeName, awards){
  const pts = (awards ?? [])
    .filter(a => Number.isFinite(a.costPerMile) && a.costPerMile > 0 && a.awardDate && Number.isFinite(Date.parse(a.awardDate)))
    .map(a => ({ t: Date.parse(a.awardDate), a }))
    .sort((p,q) => p.t - q.t);
  if(pts.length < 2) return '';
  // Chart-local colours: brand colour where one exists; operators outside
  // the brand palette get DISTINCT fallback shades in order of appearance
  // (two unknowns sharing one grey would hide an operator change).
  const FALLBACKS = ['#475569', '#a16207', '#be185d', '#0e7490', '#4d7c0f'];
  const colorOf = (() => {
    const assigned = new Map(); let fi = 0;
    return o => {
      if(!o) return '#57534e';
      if(assigned.has(o)) return assigned.get(o);
      const c = opColor(o);
      const col = c !== '#57534e' ? c : FALLBACKS[fi++ % FALLBACKS.length];
      assigned.set(o, col);
      return col;
    };
  })();
  const W = 640, H = 180, L = 40, R = 14, T = 12, B = 24;
  const tEnd = pts[pts.length-1].t;
  const t0 = pts[0].t;
  const vs = pts.map(p => p.a.costPerMile);

  // clean y ticks: pick a round step (0.5/1/2/5…) covering the value range
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const span = (hi - lo) || hi * 0.2;
  const step = [0.2,0.25,0.5,1,2,2.5,5,10,20,50][[0.2,0.25,0.5,1,2,2.5,5,10,20,50].findIndex(st => span / st <= 4)] ?? 50;
  const v0 = Math.floor(lo / step) * step;
  const v1 = Math.ceil(hi / step) * step + (hi === Math.ceil(hi / step) * step ? 0 : 0);
  const yticks = [];
  for(let v = v0; v <= v1 + 1e-9; v += step) yticks.push(v);
  const X = t => L + (t - t0) / (tEnd - t0 || 1) * (W - L - R);
  const Y = v => T + (1 - (v - v0) / ((v1 - v0) || 1)) * (H - T - B);
  const money = v => '£' + (step < 1 ? v.toFixed(2) : v.toFixed(0));

  // x ticks: first year, last year, up to 3 between
  const y0 = new Date(t0).getUTCFullYear(), yN = new Date(tEnd).getUTCFullYear();
  const ystep = Math.max(1, Math.ceil((yN - y0) / 4));
  const xticks = [];
  for(let y = y0; y <= yN; y += ystep) xticks.push(y);

  // line segments between consecutive awards; each wears the colour of the
  // operator holding the contract through that interval (the earlier award).
  const segs = [];
  for(let i = 1; i < pts.length; i++){
    const from = pts[i-1], to = pts[i];
    segs.push(`<line x1="${X(from.t).toFixed(1)}" y1="${Y(from.a.costPerMile).toFixed(1)}" x2="${X(to.t).toFixed(1)}" y2="${Y(to.a.costPerMile).toFixed(1)}" stroke="${colorOf(from.a.operator)}" stroke-width="2" stroke-linecap="round"/>`);
  }
  const dots = pts.map(p =>
    `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.a.costPerMile).toFixed(1)}" r="4" fill="${colorOf(p.a.operator)}" stroke="var(--surf)" stroke-width="2" pointer-events="none"/>`).join('');
  // Invisible, generous hit targets carry the tooltip payload — native SVG
  // <title> is too unreliable (and absent on touch) to be the hover layer.
  const hits = pts.map((p, i) => {
    const changed = i > 0 && pts[i-1].a.operator && p.a.operator && pts[i-1].a.operator !== p.a.operator;
    const html = `<b>£${p.a.costPerMile.toFixed(2)}/mile</b> · ${esc(fmtDate(p.a.awardDate) ?? p.a.awardDate)}<br>${esc(p.a.operator ?? 'Unknown operator')}`
      + (Number.isFinite(p.a.acceptedBid) ? `<br>Accepted bid £${p.a.acceptedBid.toLocaleString('en-GB')}/yr` : '')
      + (changed ? `<br><span style="color:var(--acc);font-weight:600">Operator change</span> — from ${esc(pts[i-1].a.operator)}` : '');
    return `<circle class="cpm-hit" cx="${X(p.t).toFixed(1)}" cy="${Y(p.a.costPerMile).toFixed(1)}" r="14" fill="transparent" style="cursor:pointer" data-x="${(X(p.t)/W*100).toFixed(2)}" data-y="${(Y(p.a.costPerMile)/H*100).toFixed(2)}" data-cpmtip="${esc(html)}" tabindex="0" role="img" aria-label="${esc(fmtDate(p.a.awardDate) ?? '')} £${p.a.costPerMile.toFixed(2)} per mile, ${esc(p.a.operator ?? '')}"/>`;
  }).join('');

  // end label: the price currently in force, at the line's end (selective)
  const last = pts[pts.length-1];
  const endLabel = `<text x="${(W - R).toFixed(1)}" y="${(Y(last.a.costPerMile) - 7).toFixed(1)}" text-anchor="end" font-size="10.5" font-weight="600" fill="var(--tx)" font-family="var(--mono)">£${last.a.costPerMile.toFixed(2)}</text>`;

  const ops = [...new Set(pts.map(p => p.a.operator).filter(Boolean))];
  const legend = ops.map(o => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;color:var(--tx2)"><i style="width:10px;height:2px;border-radius:1px;background:${colorOf(o)};display:inline-block"></i>${esc(o)}</span>`).join('');

  return `<div class="section"><div class="section-h">Cost per mile · every award</div>
    <div class="card" style="padding:14px 10px 8px">
      <div class="cpmwrap">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Awarded cost per mile at each tender award for route ${esc(routeName)}">
        ${yticks.map(v => `<g><line x1="${L}" y1="${Y(v).toFixed(1)}" x2="${W-R}" y2="${Y(v).toFixed(1)}" stroke="var(--bd)" stroke-width="1"/><text x="${L-6}" y="${(Y(v)+3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="var(--mu)" font-family="var(--mono)">${money(v)}</text></g>`).join('')}
        ${xticks.map(y => { const x = X(Date.UTC(y,0,1)); return x >= L - 1 && x <= W - R + 1 ? `<text x="${x.toFixed(1)}" y="${H-7}" text-anchor="middle" font-size="9.5" fill="var(--mu)" font-family="var(--mono)">${y}</text>` : ''; }).join('')}
        ${segs.join('')}${dots}${endLabel}
        ${hits}
      </svg>
      <div class="cpm-tip" hidden></div>
      </div>
      <div class="legendrow" style="padding:7px 8px 3px;flex-wrap:wrap">${legend}</div>
    </div>
    <div class="legendrow" style="margin-top:7px"><span>Nominal £/mile at each award (not indexed against <a href="#/cpi" style="color:var(--acc)">CPI-CPA</a>) — a colour change marks an operator change; hover a dot for the award. ${pts.length} priced awards, ${y0}–${new Date(pts[pts.length-1].t).getUTCFullYear()}.</span></div>
  </div>`;
}
