/* View: Vehicle — fleet-number lookup and live position. */
import { D, nextPollS, plate, stopRegistry } from '../core/data.js';
import { addLiveTimer, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { isDark } from '../core/theme.js';
import { esc, title } from '../core/utils.js';
import { bindStopPopup, busIcon, makeMap } from '../map/layers.js';

/* ════════════════════ VEHICLE ════════════════════ */
export async function renderVehicleDetail(regArg){
  const tok = state.navToken;
  const [regPart, qs] = String(regArg ?? '').split('?');
  const ctx = new URLSearchParams(qs ?? '');
  const ctxStop = ctx.get('stop'), ctxLine = ctx.get('line');
  const R = String(regPart ?? '').toUpperCase();
  main.innerHTML = `<button class="backrow" id="vBack" style="background:none;border:none;cursor:pointer">‹ Back</button><div class="skel" style="height:140px"></div>`;
  document.getElementById('vBack')?.addEventListener('click', () => history.back());
  const v = (await D.vehiclesReg())?.[R] ?? null;
  if(tok !== state.navToken) return;   // note: `gone` is a local boolean in this view
  const facts = [];
  if(v?.make) facts.push(['Make', title(v.make)]);
  if(v?.body) facts.push(['Body', v.body]);
  if(v?.year) facts.push(['Year', v.year]);
  if(v?.propulsion) facts.push(['Power', title(v.propulsion)]);
  if(v?.deck) facts.push(['Deck', title(v.deck)]);
  if(v?.fleetCode) facts.push(['Fleet code', v.fleetCode]);
  main.innerHTML = `
    <a class="backrow" href="#/">‹ Routes</a>
    <div class="dhead">
      <span class="avatar" style="width:46px;height:46px;border-radius:12px;background:#1c1917">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fc0" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="14" rx="2"/><line x1="4" y1="10" x2="20" y2="10"/><circle cx="8.5" cy="14.5" r=".9" fill="#fc0"/><circle cx="15.5" cy="14.5" r=".9" fill="#fc0"/></svg>
      </span>
      <div class="dtitle">
        <h1 style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">${plate(R,false)}${v?.operator ? `<a href="#/operator/${encodeURIComponent(v.operator)}" style="font-size:14px;font-weight:600;color:var(--acc)">${esc(v.operator)}</a>` : ''}</h1>
        <div class="sub2">${v ? 'From the vehicle register' : 'Not in the current vehicle register — it may not have been observed recently.'}</div>
      </div>
    </div>
    ${facts.length ? `<div class="facts" style="margin-top:14px">${facts.map(([l,val]) =>
      `<div class="fact"><div class="l">${l}</div><div class="v" title="${esc(val)}">${esc(val)}</div></div>`).join('')}</div>` : ''}
    ${v?.routes?.length ? `<div class="section"><div class="section-h">Observed on</div>
      <div class="card"><div class="chiprow">${v.routes.map(r => `<a class="rchip" href="#/route/${encodeURIComponent(r)}">${esc(r)}</a>`).join('')}</div></div></div>` : ''}
    <div class="section" id="vLiveSec" hidden><div class="section-h">Live location</div>
      <div id="map" style="height:260px"></div>
      <div class="legendrow" style="margin-top:7px"><span id="vLiveNote">Looking for this bus in the live feed…</span></div>
    </div>
    `;
  initVehicleLiveMap(R, v, ctxLine, ctxStop, tok);
}

/* Vehicle live-location map — find the bus in the live GPS feed (trying the
   arrival-context line first, then every route the register has seen it on),
   then draw it against its route's line and, when the user arrived from a
   stop's arrivals board, that stop. Polls every 15 s while the page is open. */
async function initVehicleLiveMap(R, v, ctxLine, ctxStop, tok = state.navToken){
  const sec = document.getElementById('vLiveSec');
  const candidates = [...new Set([ctxLine, ...(v?.routes ?? [])].filter(Boolean).map(x => String(x).toUpperCase()))];
  if(!sec || !candidates.length) return;
  sec.hidden = false;

  let lastFeed = null, feedOk = false;
  async function findBus(){
    for(const line of candidates){
      const raw = await D.liveVehicles(line);
      if(raw){ lastFeed = raw; feedOk = true; }
      const hit = (raw?.data ?? []).find(x => String(x.reg ?? '').toUpperCase() === R
        && Number.isFinite(x.lat) && Number.isFinite(x.lng));
      if(hit) return hit;
    }
    return null;
  }

  const first = await findBus();
  if(tok !== state.navToken || !document.getElementById('vLiveSec')) return;   // navigated away
  const note = document.getElementById('vLiveNote');
  if(!first){
    document.getElementById('map').remove();
    if(note) note.textContent = 'Not in the live GPS feed right now — it may not be in service.';
    return;
  }

  if(state.map){ state.map.remove(); state.map = null; }
  state.map = makeMap(document.getElementById('map'));
  state.map.setView([first.lat, first.lng], 14);   // layers need a live projection before they're added

  const line = String(first.publishedLine ?? ctxLine ?? candidates[0]).toUpperCase();
  D.overview().then(ov => {
    if(tok !== state.navToken || !state.map) return;   // never paint this vehicle's line onto the next view's map
    const feats = (ov?.features ?? []).filter(f => (f.properties?.name ?? '').toUpperCase() === line);
    if(feats.length) L.geoJSON({type:'FeatureCollection',features:feats},
      { style:{ color:'#dc2626', weight:4, opacity:.6, lineCap:'round', lineJoin:'round' } }).addTo(state.map);
  });

  let stopLL = null;
  if(ctxStop){
    const reg = await stopRegistry();     // cached — the user came through the stops flow
    if(tok !== state.navToken) return;
    const s = reg?.get(ctxStop);
    if(s && state.map){
      stopLL = [s.lat, s.lng];
      bindStopPopup(L.circleMarker(stopLL, { radius:7, color:isDark()?'#f0eeec':'#1c1917', weight:2.5, fillColor:isDark()?'#1b1917':'#fff', fillOpacity:1 }), ctxStop, s.name)
        .addTo(state.map);
    }
  }

  let busMarker = null;
  function drawBus(b){
    const icon = busIcon(b.bearing);
    if(busMarker){ busMarker.setLatLng([b.lat, b.lng]); busMarker.setIcon(icon); }
    else busMarker = L.marker([b.lat, b.lng], { icon })
      .bindPopup(`${plate(R, false)}<br>${esc(b.destination ? 'to ' + title(b.destination) : '')}`)
      .addTo(state.map);
  }
  const noteText = extra => {
    if(note) note.innerHTML = `<span class="livechip"><i class="pulse"></i>LIVE</span> · on route ${esc(line)} · ${extra}`;
  };
  drawBus(first);
  let b = L.latLngBounds([[first.lat, first.lng]]);
  if(stopLL) b = b.extend(stopLL);
  state.map.fitBounds(b.pad(0.35), { maxZoom: 15 });

  /* live-surface pattern: per-second countdown, 15 s re-poll */
  let nextIn = 15, gone = false;
  noteText('next update in 15 s');
  addLiveTimer(setInterval(async () => {
    if(!document.getElementById('vLiveSec')) return;
    nextIn -= 1;
    if(!gone) noteText(nextIn > 0 ? `next update in ${nextIn} s` : 'updating…');
    if(nextIn <= 0){
      nextIn = 999;
      feedOk = false;
      const cur = await findBus();
      nextIn = feedOk ? nextPollS(lastFeed, 15) : 8;
      if(!document.getElementById('vLiveSec')) return;
      if(cur){ gone = false; drawBus(cur); noteText(`next update in ${nextIn} s`); }
      else if(!feedOk){ if(!gone) noteText('reconnecting…'); }   // feed down ≠ bus gone
      else { gone = true; if(note) note.textContent = 'The bus has left the live feed — it may have completed its trip.'; }
    }
  }, 1000));
}
