/* Route map — the single-route Leaflet map (stops, bridges, hazards, live buses). */
import { D, nextPollS } from '../core/data.js';
import { garagePinIcon } from '../core/incoming.js';
import { addLiveTimer, gone, state } from '../core/nav.js';
import { isDark } from '../core/theme.js';
import { esc, haversineM, nOf } from '../core/utils.js';
import { bindStopPopup, bridgeDiamond, bridgesLayer, busesLayer, currentStreetworks, garageLocOk, garagePopupHtml, incidentLayers, makeCorridor, makeMap, streetworksLayer, trafficOrdersLayer, troItems } from './layers.js';

/* ── Route map ────────────────────────────────────────────────────────── */

export async function initRouteMap(route, m = {}, tok = state.navToken){
  const el = document.getElementById('map');
  if(state.map){ state.map.remove(); state.map = null; }
  state.map = makeMap(el);
  state.map.setView([51.505,-0.118], 11);

  let dir = 'outbound';
  let lineLayer = null, stopsLayer = null, busLayer = null;
  let liveOn = false, stopsOn = false;

  const [ov, stops, garages, metaAll] = await Promise.all([D.overview(), D.stops(), D.garages(), D.meta()]);
  if(gone(tok)) return;
  if(location.hash !== `#/route/${encodeURIComponent(route.name)}` && !decodeURIComponent(location.hash).endsWith('/'+route.name)) return;

  const feats = (ov?.features ?? []).filter(f => (f.properties?.name ?? '').toUpperCase() === route.name.toUpperCase()
    || (f.properties?.routeId ?? '').toUpperCase() === route.name.toUpperCase());
  const stopRec = stops?.[route.name.toLowerCase()] ?? stops?.[route.name] ?? {};

  /* Operating garage pin(s), linked through to the garage page.
     route-meta may list several codes. */
  const codes = String(m.garage ?? '').split(/[^A-Za-z]+/).filter(Boolean).map(c => c.toUpperCase());
  const garagePins = (garages ?? []).filter(g =>
    codes.includes(String(g.code).toUpperCase()) && garageLocOk(g));
  const opMarkers = new Map();
  for(const g of garagePins){
    const mk = L.marker([g.lat, g.lng], { icon: garagePinIcon(g, 34), zIndexOffset: 500 })
      .bindPopup(() => garagePopupHtml(g, metaAll))
      .addTo(state.map);
    opMarkers.set(String(g.code).toUpperCase(), mk);
  }

  /* "Garages" layer — EVERY garage in London as its operator-coloured pin
     Distance to this route,
     measured at the closest stop, is the hover line and a KPI row in the
     click popup — competitor scanning without the per-operator filter. */
  let closestLayer = null, closestOn = false;
  const closestBtn = document.getElementById('closestBtn');
  closestBtn?.addEventListener('click', () => {
    closestOn = !closestOn;
    closestBtn.classList.toggle('on', closestOn);
    if(!closestOn){
      if(closestLayer){ state.map.removeLayer(closestLayer); closestLayer = null; }
      layerNote('garNote');
      return;
    }
    const pts = [...(stopRec.outbound ?? []), ...(stopRec.inbound ?? [])].filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    closestLayer = L.layerGroup();
    // Distances for EVERY located garage — the operating one(s) included, so
    // "nearest" is honest when the route operates from its closest garage.
    const rows = [];
    const all = [];
    for(const g of garages ?? []){
      if(!garageLocOk(g)) continue;
      let d = Infinity, at = null;
      for(const st of pts){ const dm = haversineM(st.lat, st.lng, g.lat, g.lng); if(dm < d){ d = dm; at = st; } }
      const rec = { g, d, at, operating: codes.includes(String(g.code).toUpperCase()) };
      all.push(rec);
      if(!rec.operating) rows.push(rec);   // operating garage already pinned + ringed
    }
    const kv = (l, v) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:20px;padding:5px 0;border-top:1px solid var(--bd)"><span style="color:var(--tx2)">${l}</span><b style="font-family:var(--mono);font-size:12.5px">${v}</b></div>`;
    for(const { g, d, at } of rows){
      const mi = Number.isFinite(d) && at ? (d/1609.344).toFixed(2) : null;
      const mk = L.marker([g.lat, g.lng], { icon: garagePinIcon(g, 26) });
      mk.bindTooltip(`${esc(g.name)} (${esc(g.code)}) · ${esc(g.operator ?? '—')}${mi ? ` · ${mi} mi` : ''}`, { direction:'top' });
      mk.bindPopup(() => garagePopupHtml(g, metaAll, mi
          ? kv(`Distance to route ${esc(route.name)}`, `${mi} mi`) + kv('Measured at', esc(at.name))
          : ''))
        .addTo(closestLayer);
    }
    closestLayer.addTo(state.map);
    layerNote('garNote', `<span>${nOf(rows.length, 'garage')} in operator colours. Hover or tap a pin for its distance to route ${esc(route.name)} and its details.</span>`);
  });
  /* "Low bridges" + "Incidents" layers — whole-London snapshots filtered to
     the route's corridor. Route points are collected once, lazily; distance
     is a bbox prefilter + equirectangular metres with early exit, so 7.5k
     collision records stay cheap to sieve. */
  const nearRoute = makeCorridor(feats);
  const layerNote = (id, html) => {
    document.getElementById(id)?.remove();
    if(html) el.insertAdjacentHTML('afterend', `<div class="legendrow" id="${id}" style="margin-top:8px">${html}</div>`);
  };

  let bridgeLayer = null, bridgeOn = false;
  const bridgeBtn = document.getElementById('bridgeBtn');
  bridgeBtn?.addEventListener('click', async () => {
    bridgeOn = !bridgeOn;
    bridgeBtn.classList.toggle('on', bridgeOn);
    if(!bridgeOn){ if(bridgeLayer){ state.map.removeLayer(bridgeLayer); bridgeLayer = null; } layerNote('bridgeNote'); return; }
    const all = await D.bridges();
    if(gone(tok) || !bridgeOn) return;   // navigated away or toggled off while loading
    const near = (all ?? []).filter(b => Number.isFinite(b.lat) && Number.isFinite(b.lng) && nearRoute(b.lat, b.lng, 300));
    bridgeLayer = bridgesLayer(near);
    const diamond = bridgeDiamond;
    bridgeLayer.addTo(state.map);
    const chip = (c, bc, t) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:10px"><span style="display:inline-block">${diamond(c, bc, 8)}</span>${t}</span>`;
    layerNote('bridgeNote', near.length
      ? `<span>${near.length} height restriction${near.length===1?'':'s'} within 300 m — ${chip('#dc2626','#7f1d1d','&lt; 4.2 m')}${chip('#f59e0b','#92400e','4.2–4.9 m')}${chip('#64748b','#334155','≥ 4.9 m')}</span>`
      : `<span>No recorded height restrictions within 300 m of this route.</span>`);
  });

  let incLayer = null, incOn = false;
  const incBtn = document.getElementById('incBtn');
  incBtn?.addEventListener('click', async () => {
    incOn = !incOn;
    incBtn.classList.toggle('on', incOn);
    if(!incOn){ if(incLayer){ state.map.removeLayer(incLayer); incLayer = null; } layerNote('incNote'); return; }
    const snap = await D.accidents();
    if(gone(tok) || !incOn) return;
    const near = (snap?.accidents ?? []).filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng) && nearRoute(a.lat, a.lng, 150));
    const { heat, grave } = incidentLayers(near);
    incLayer = L.layerGroup([heat, grave]);
    incLayer.addTo(state.map);
    const nf = near.filter(a => a.severity==='fatal').length, ns = near.filter(a => a.severity==='serious').length;
    layerNote('incNote', near.length
      ? `<span>${near.length} bus/coach-involved collision${near.length===1?'':'s'} within 150 m, ${esc(snap.period ?? '2021–2025')} — shown as a density heatmap; <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ea580c;border:1px solid #fff;vertical-align:baseline"></span> serious (${ns}) and <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#111827;border:1px solid #fff;vertical-align:baseline"></span> fatal (${nf}) are individual dots — click one for the record.</span>`
      : `<span>No recorded bus/coach-involved collisions within 150 m of this route, ${esc(snap?.period ?? '2021–2025')}.</span>`);
  });

  /* "Street works" layer — the DfT Street Manager archive (BNG coordinates
     pre-converted to WGS84 by the drain), filtered to current/upcoming
     works within 150 m of the route. Each work draws its stated extent as
     a short line plus a clickable cone-coloured dot. */
  let swLayer = null, swOn = false;
  const swMapBtn = document.getElementById('swMapBtn');
  swMapBtn?.addEventListener('click', async () => {
    swOn = !swOn;
    swMapBtn.classList.toggle('on', swOn);
    if(!swOn){ if(swLayer){ state.map.removeLayer(swLayer); swLayer = null; } layerNote('swNote'); return; }
    const snap = await D.streetworks();
    if(gone(tok) || !swOn) return;
    const current = currentStreetworks(snap);
    const near = current.filter(e => e.coords.some(([la, ln]) => nearRoute(la, ln, 150)));
    swLayer = streetworksLayer(near);
    swLayer.addTo(state.map);
    const dot = c => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};border:1px solid #fff;vertical-align:baseline"></span>`;
    layerNote('swNote', near.length
      ? `<span>${near.length} current or upcoming street work${near.length===1?'':'s'} within 150 m — ${dot('#dc2626')} immediate, ${dot('#ea580c')} major, ${dot('#f59e0b')} standard/minor, ${dot('#64748b')} activity. <a href="#/streetworks" style="color:var(--acc)">all street works ›</a></span>`
      : `<span>No current street works within 150 m of this route in the archive (accumulating since 18 Sep 2026) — <a href="#/streetworks" style="color:var(--acc)">all street works ›</a></span>`);
  });

  /* "Traffic orders" layer — the statutory D-TRO record near this route:
     road closures, bus lanes and gates, banned turns and one-ways, each
     with the order's published diversion route where one exists. Orders
     are pre-joined to routes by the fetcher's 35 m corridor join; a 150 m
     proximity check catches the rest. Coverage grows as authorities
     onboard (publication is mandatory for new orders from autumn 2026). */
  let troLayer = null, troOn = false;
  const troMapBtn = document.getElementById('troMapBtn');
  troMapBtn?.addEventListener('click', async () => {
    troOn = !troOn;
    troMapBtn.classList.toggle('on', troOn);
    if(!troOn){ if(troLayer){ state.map.removeLayer(troLayer); troLayer = null; } layerNote('troNote'); return; }
    const snap = await D.dtro();
    if(gone(tok) || !troOn) return;
    const near = (snap?.orders ?? []).filter(o => o.routes?.includes(route.name)
      || o.provisions?.some(p => p.places?.some(pl => pl.type !== 'diversionRoute' && pl.coords?.some(([la, ln]) => nearRoute(la, ln, 150)))));
    troLayer = trafficOrdersLayer(troItems(near));
    troLayer.addTo(state.map);
    const dot = c => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};border:1px solid #fff;vertical-align:baseline"></span>`;
    const dash = `<span style="display:inline-block;width:14px;height:0;border-top:2.5px dashed #16a34a;vertical-align:middle"></span>`;
    layerNote('troNote', near.length
      ? `<span>${near.length} statutory traffic order${near.length===1?'':'s'} near this route — ${dot('#dc2626')} closure, ${dot('#2563eb')} bus lane/stop, ${dot('#ea580c')} turn/one-way, ${dot('#64748b')} other, ${dash} official diversion route. <a href="#/tro" style="color:var(--acc)">all traffic orders ›</a></span>`
      : `<span>No published traffic regulation orders near this route yet — coverage grows as authorities publish their orders. <a href="#/tro" style="color:var(--acc)">All traffic orders ›</a></span>`);
  });

  // Say why there is no garage pin instead of leaving a silent gap.
  if(!garagePins.length){
    el.insertAdjacentHTML('afterend', `<div class="legendrow" style="margin-top:8px"><span>${codes.length
      ? 'The operating garage isn’t pinned — the dataset only has the operating company’s registered-office postcode for it, not the garage site.'
      : 'No garage is linked to this route yet, so no garage pin is shown.'}</span></div>`);
  }

  function draw(){
    if(lineLayer){ state.map.removeLayer(lineLayer); lineLayer = null; }
    if(stopsLayer){ state.map.removeLayer(stopsLayer); stopsLayer = null; }
    const dnum = dir === 'outbound' ? '1' : '2';
    const dirFeats = feats.filter(f => String(f.properties?.direction) === dnum);
    const use = dirFeats.length ? dirFeats : feats;
    if(use.length){
      lineLayer = L.geoJSON({type:'FeatureCollection',features:use},
        { style:{ color:'#dc2626', weight:5, opacity:.95, lineCap:'round', lineJoin:'round' } }).addTo(state.map);
      try{
        let b = lineLayer.getBounds();
        for(const g of garagePins) b = b.extend([g.lat, g.lng]);
        state.map.fitBounds(b, { padding:[24,24] });
      }catch(e){}
    }
    stopsLayer = L.layerGroup();
    for(const s of (stopRec[dir] ?? [])){
      const mk = L.circleMarker([s.lat, s.lng], { radius:4.5, color:'#dc2626', weight:2, fillColor:isDark()?'#1b1917':'#fff', fillOpacity:1 })
        .addTo(stopsLayer);
      bindStopPopup(mk, s.id, s.name);
    }
    if(stopsOn) stopsLayer.addTo(state.map);
  }
  draw();

  /* stops — toggle chip, same grammar as live buses */
  const stopsBtn = document.getElementById('stopsBtn');
  stopsBtn.addEventListener('click', () => {
    stopsOn = !stopsOn;
    stopsBtn.classList.toggle('on', stopsOn);
    if(!stopsLayer) return;
    if(stopsOn) stopsLayer.addTo(state.map); else state.map.removeLayer(stopsLayer);
  });

  document.getElementById('dirSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    dir = b.dataset.d;
    document.querySelectorAll('#dirSeg button').forEach(x => x.classList.toggle('on', x === b));
    draw();
  });

  /* live buses — opt-in poll every 15 s */
  const liveBtn = document.getElementById('liveBtn');
  async function pollBuses(first){
    if(first) liveBtn.classList.add('loading');
    const [raw, reg] = await Promise.all([D.liveVehicles(route.name), D.vehiclesReg()]);
    if(gone(tok)) return;
    liveBtn.classList.remove('loading');
    busNextIn = raw ? nextPollS(raw, 15) : 8;
    if(!liveOn) return;
    if(!raw && busLayer){ if(busText) busText.textContent = 'reconnecting…'; return; }   // keep last positions
    const rows = (raw?.data ?? []).filter(v => Number.isFinite(v.lat) && Number.isFinite(v.lng));
    if(busLayer){ state.map.removeLayer(busLayer); busLayer = null; }
    busLayer = busesLayer(rows, reg);
    busLayer.addTo(state.map);
    if(first && !rows.length){
      liveBtn.insertAdjacentHTML('afterend', `<span id="noBuses" style="font-size:12px;color:var(--mu);align-self:center;margin-left:8px">No buses tracked right now</span>`);
      setTimeout(() => document.getElementById('noBuses')?.remove(), 4000);
    }
  }
  /* live-surface pattern: 1 s ticker shows 'next update in N s' and fires
     the 15 s re-poll — registered once, gated by the toggle */
  let busNextIn = 0, busTickerOn = false;
  const busNote = document.getElementById('busLiveNote'), busText = document.getElementById('busLiveText');
  liveBtn.addEventListener('click', () => {
    liveOn = !liveOn;
    liveBtn.classList.toggle('on', liveOn);
    if(busNote) busNote.style.display = liveOn ? 'inline-flex' : 'none';
    if(liveOn){
      pollBuses(true); busNextIn = 15;
      if(!busTickerOn){
        busTickerOn = true;
        addLiveTimer(setInterval(() => {
          if(!liveOn || !document.getElementById('map')) return;
          busNextIn -= 1;
          if(busText) busText.textContent = busNextIn > 0 ? `next update in ${busNextIn} s` : 'updating…';
          if(busNextIn <= 0){ busNextIn = 999; pollBuses(false); }   // poll re-anchors
        }, 1000));
      }
    } else if(busLayer){ state.map.removeLayer(busLayer); busLayer = null; }
  });

  /* All handlers are bound — wake the controls up. They ship disabled so a
     click during the data fetch is visibly inert rather than silently
     dropped (the cause of "the bridges toggle doesn't work" on slow
     connections). */
  document.querySelectorAll('.mapctl button[disabled]').forEach(b => b.removeAttribute('disabled'));
}
