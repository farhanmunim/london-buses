/* Map layers shared by the route view, the network map and the garage/vehicle maps — basemap, hazards, street works, traffic orders, live buses, popups. */
import { D, plate, troPretty } from '../core/data.js';
import { isDark } from '../core/theme.js';
import { cmpRoute, esc, fmtDate, num, title, tvrOf } from '../core/utils.js';

/* ── Map layers shared by the route view and the network map ───────────────
   Each builder takes the already-selected records and returns a Leaflet layer, so both views
   draw identical markers and popups. Only the selection differs (a route's corridor vs the
   viewport). */

/* Corridor test for a set of route features: "is this point within maxM metres of the route line?"
   Distance is measured to the line SEGMENTS, not just its vertices — the overview geometry is
   simplified, with vertices hundreds of metres apart, so a vertex test missed over half of what
   really lies on the route. A bbox prefilter keeps 7.5k collision records cheap to sieve.
   Returns near(lat, lng, maxM). */
export function makeCorridor(feats){
  const KLAT = 111320, KLNG = 69400;   // metres per degree at ~51.5°N
  let segs = null, w, s, e, n;
  const build = () => {
    segs = []; w = Infinity; s = Infinity; e = -Infinity; n = -Infinity;
    for(const f of feats){
      const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
      for(const line of lines) for(let i = 1; i < line.length; i++){
        const ax = line[i-1][0] * KLNG, ay = line[i-1][1] * KLAT, dx = line[i][0] * KLNG - ax, dy = line[i][1] * KLAT - ay;
        segs.push({ ax, ay, dx, dy, len2: dx*dx + dy*dy });
      }
      for(const line of lines) for(const [lng, lat] of line){ if(lng<w)w=lng; if(lat<s)s=lat; if(lng>e)e=lng; if(lat>n)n=lat; }
    }
  };
  return (lat, lng, maxM) => {
    if(!segs) build();
    const pad = maxM / 78000;   // ≈ degrees of longitude at London's latitude (the tighter axis)
    if(lng < w - pad || lng > e + pad || lat < s - pad || lat > n + pad) return false;
    const px = lng * KLNG, py = lat * KLAT, r2 = maxM * maxM;
    for(const g of segs){
      const t = g.len2 ? Math.max(0, Math.min(1, ((px - g.ax) * g.dx + (py - g.ay) * g.dy) / g.len2)) : 0;
      const qx = px - (g.ax + t * g.dx), qy = py - (g.ay + t * g.dy);
      if(qx*qx + qy*qy <= r2) return true;
    }
    return false;
  };
}
export const bridgeDiamond = (c, bc, sz=10) => `<div style="width:${sz}px;height:${sz}px;background:${c};border:1.5px solid #fff;outline:1px solid ${bc}40;transform:rotate(45deg);border-radius:2px;box-shadow:0 1px 2.5px rgba(0,0,0,.28)"></div>`;
export function bridgesLayer(near){
  const layer = L.layerGroup();
  const prow = (l, v) => v == null || v === '' ? '' : `<div style="display:flex;justify-content:space-between;align-items:center;gap:18px;padding:4px 0;border-top:1px solid var(--bd)"><span style="color:var(--tx2)">${l}</span><b style="font-family:var(--mono);font-size:12px">${v}</b></div>`;
  // Height bands against a ~4.4 m double-decker: below DD height + margin
  // is red, tight clearance amber, comfortable clearance calm slate.
  const bridgeBand = h => !Number.isFinite(h)
    ? { c:'#94a3b8', bc:'#475569', label:'Height not recorded' }
    : h < 4.2 ? { c:'#dc2626', bc:'#7f1d1d', label:'Very low — below double-deck clearance' }
    : h < 4.9 ? { c:'#f59e0b', bc:'#92400e', label:'Low — tight for double-deckers' }
    :           { c:'#64748b', bc:'#334155', label:'Clears double-deckers' };
  const diamond = bridgeDiamond;
  for(const b of near){
    const h = Number.isFinite(b.height_m) ? `${b.height_m} m` : null;
    const band = bridgeBand(b.height_m);
    L.marker([b.lat, b.lng], { icon: L.divIcon({ className:'', html: diamond(band.c, band.bc), iconSize:[10,10], iconAnchor:[5,5] }) })
      .bindTooltip(`${esc(b.name ?? b.road ?? 'Height restriction')}${h ? ' · ' + h : ''}`, { direction:'top' })
      .bindPopup(() => `<div style="min-width:190px"><b style="font-size:13px">${esc(b.name ?? b.road ?? 'Height restriction')}</b>
        <div style="color:var(--tx2);margin:1px 0 7px">${esc(title(b.structure_type ?? 'structure'))} · <span style="color:${band.c === '#94a3b8' ? 'var(--tx2)' : band.c};font-weight:600">${band.label}</span></div>
        ${prow('Height', h ?? '—')}${prow('Signed', b.height_imperial ? esc(b.height_imperial) : null)}${prow('Road', b.road && b.road !== b.name ? esc(b.road) : null)}${prow('Borough', b.borough ? esc(b.borough) : null)}</div>`)
      .addTo(layer);
  }
  return layer;
}

const SEV = { fatal:{ c:'#111827', r:6, label:'Fatal' }, serious:{ c:'#ea580c', r:5, label:'Serious' }, slight:{ c:'#f59e0b', r:3.5, label:'Slight' } };
/* Collisions: density as a heat layer (all severities, weighted), with clickable markers for the grave ones —
   serious and fatal stay clickable for the full record. */
const WEIGHT = { slight:.35, serious:.75, fatal:1 };
export function incidentHeat(near){
  const group = L.layerGroup();
  if(L.heatLayer){
    L.heatLayer(near.map(a => [a.lat, a.lng, WEIGHT[a.severity] ?? .35]), {
      radius: 16, blur: 14, maxZoom: 16, max: 2, minOpacity: .22,
      gradient: { .25:'#fcd34d', .5:'#f59e0b', .75:'#ea580c', 1:'#b91c1c' },
    }).addTo(group);
  }
  return group;
}
export function incidentGrave(near){
  const group = L.layerGroup();
  const canvas = L.canvas({ padding:.5 });
  const arow = (l, v) => v == null || v === '' ? '' : `<div style="display:flex;justify-content:space-between;align-items:center;gap:18px;padding:4px 0;border-top:1px solid var(--bd)"><span style="color:var(--tx2)">${l}</span><b style="font-family:var(--mono);font-size:12px">${v}</b></div>`;
  const grave = near.filter(a => a.severity === 'serious' || a.severity === 'fatal');
  grave.sort((a,b) => (a.severity==='serious'?0:1) - (b.severity==='serious'?0:1));   // fatal drawn last, on top
  for(const a of grave){
    const sv = SEV[a.severity] ?? SEV.slight;
    L.circleMarker([a.lat, a.lng], { renderer: canvas, radius: sv.r - 1, color:'#fff', weight:1.25, fillColor: sv.c, fillOpacity:.92 })
      .bindTooltip(`${sv.label} collision · ${fmtDate(a.date) ?? esc(a.date ?? '')}`, { direction:'top' })
      .bindPopup(() => `<div style="min-width:190px"><b style="font-size:13px;color:${sv.c === '#111827' ? 'var(--tx)' : sv.c}">${sv.label} collision</b>
        <div style="color:var(--tx2);margin:1px 0 7px">${esc(fmtDate(a.date) ?? a.date ?? '')}${a.day ? ` (${esc(a.day)})` : ''}${a.timeBand ? ` · ${esc(a.timeBand)}` : ''}</div>
        ${arow('Casualties', a.casualties)}${arow('Vehicles', a.vehicles)}${arow('Road type', a.roadType ? esc(a.roadType) : null)}${arow('Speed limit', a.speedLimit ? esc(a.speedLimit) : null)}${arow('Junction', a.junction ? esc(a.junction) : null)}${arow('Light', a.light ? esc(a.light) : null)}${arow('Weather', a.weather ? esc(a.weather) : null)}${arow('Surface', a.roadSurface ? esc(a.roadSurface) : null)}
        <div style="font-size:10px;color:var(--mu);margin-top:7px">Bus/coach-involved</div></div>`)
      .addTo(group);
  }
  return group;
}
export const incidentLayers = near => ({ heat: incidentHeat(near), grave: incidentGrave(near) });
/* Street Manager works that are current or upcoming (finished more than 3 days ago, or completed, are dropped). */
export function currentStreetworks(snap){
  const cutoff = new Date(Date.now() - 3 * 864e5).toISOString();
  return (snap?.entries ?? []).filter(e => {
    if(!e.coords?.length) return false;
    const l = e.latest ?? {};
    const end = l.actual_end_date_time ?? l.proposed_end_date ?? l.end_date;
    return (!end || end >= cutoff) && l.work_status !== 'Works completed';
  });
}
/* Street Manager works: each draws its stated extent as a short line plus a clickable dot coloured by category. */
export function streetworksLayer(near){
  const layer = L.layerGroup();
  const swBand = c => c === 'Immediate' || String(c ?? '').startsWith('Immediate')
    ? { c:'#dc2626', label:'Immediate' } : c === 'Major' ? { c:'#ea580c', label:'Major' }
    : c ? { c:'#f59e0b', label:c } : { c:'#64748b', label:'Notified activity' };
  const srow = (l, v) => v == null || v === '' || v === '—' ? '' : `<div style="display:flex;justify-content:space-between;align-items:center;gap:18px;padding:4px 0;border-top:1px solid var(--bd)"><span style="color:var(--tx2)">${l}</span><b style="font-family:var(--mono);font-size:12px;text-align:right">${v}</b></div>`;
  for(const e of near){
    const l = e.latest ?? {};
    const band = swBand(l.work_category ?? (l.activity_type ? null : l.work_category));
    const start = l.actual_start_date_time ?? l.proposed_start_date ?? l.start_date;
    const end = l.actual_end_date_time ?? l.proposed_end_date ?? l.end_date;
    if(e.coords.length > 1)
      L.polyline(e.coords, { color: band.c, weight: 5, opacity: .55 }).addTo(layer);
    L.circleMarker(e.coords[0], { radius: 5.5, color:'#fff', weight: 1.5, fillColor: band.c, fillOpacity: .95 })
      .bindTooltip(`${esc(title(l.street_name ?? '') || 'Street work')} · ${esc(band.label)}${l.promoter_organisation ? ' · ' + esc(title(l.promoter_organisation)) : ''}`, { direction:'top' })
      .bindPopup(() => `<div style="min-width:200px"><b style="font-size:13px">${esc(title(l.street_name ?? '') || 'Street work')}</b>
        <div style="color:var(--tx2);margin:1px 0 7px"><span style="color:${band.c};font-weight:600">${esc(band.label)}</span>${l.activity_name ? ' · ' + esc(l.activity_name) : ''}</div>
        ${srow('Promoter', l.promoter_organisation ? esc(title(l.promoter_organisation)) : null)}${srow('Authority', esc(e.ha ?? ''))}${srow('Traffic', l.traffic_management_type ? esc(l.traffic_management_type) : null)}${srow('Status', l.work_status ? esc(l.work_status) : null)}${srow('Window', `${fmtDate(start) ?? '—'} → ${fmtDate(end) ?? '—'}`)}
        <div style="font-size:10px;color:var(--mu);margin-top:7px">${esc(e.ref)}</div></div>`)
      .addTo(layer);
  }
  return layer;
}

/* D-TRO orders: closures, bus lanes/gates, banned turns, with each order's published diversion. Items are one order × provision × place. */
const troKind = ts => ts.some(t => /RoadClosure|LaneClosure|PedestrianZone|ProhibitedAccess|SuspensionOf/.test(t)) ? { c:'#dc2626', label:'Closure / access' }
  : ts.some(t => /^miscBus|Busway|BusStop/.test(t)) ? { c:'#2563eb', label:'Bus lane / stop' }
  : ts.some(t => /^bannedMovement|^mandatoryDirection/.test(t)) ? { c:'#ea580c', label:'Turn / one-way' }
  : { c:'#64748b', label:'Other order' };
export function trafficOrdersLayer(items){
  const layer = L.layerGroup();
  const trow = (l, v) => v == null || v === '' ? '' : `<div style="display:flex;justify-content:space-between;align-items:center;gap:18px;padding:4px 0;border-top:1px solid var(--bd)"><span style="color:var(--tx2)">${l}</span><b style="font-family:var(--mono);font-size:12px;text-align:right;max-width:170px">${v}</b></div>`;
  for(const { o, p, pl } of items){
    if(!pl.coords?.length) continue;
    const band = troKind(p.regulationTypes ?? []);
    const popup = () => `<div style="min-width:210px"><b style="font-size:13px">${esc(o.troName ?? 'Traffic regulation order')}</b>
      <div style="color:var(--tx2);margin:1px 0 7px"><span style="color:${band.c};font-weight:600">${esc(band.label)}</span>${p.description ? ' · ' + esc(p.description) : ''}</div>
      ${trow('Regulations', esc((p.regulationTypes ?? []).map(troPretty).join(', ') || '—'))}${trow('Authority', esc(title(o.traName ?? '') || o.tra || '—'))}${trow('Window', `${fmtDate(p.start) ?? '—'} → ${fmtDate(p.end) ?? '—'}`)}${trow('Action', p.actionType ? esc(p.actionType) : null)}
      <div style="font-size:10px;color:var(--mu);margin-top:7px">Statutory order</div></div>`;
    if(pl.type === 'diversionRoute'){
      if(pl.coords.length > 1)
        L.polyline(pl.coords, { color:'#16a34a', weight: 4, opacity: .8, dashArray: '7 6' })
          .bindTooltip(`Official diversion${pl.description ? ' · ' + esc(pl.description) : ''}`, { direction:'top', sticky:true })
          .bindPopup(popup).addTo(layer);
      continue;
    }
    if(pl.coords.length > 1)
      L.polyline(pl.coords, { color: band.c, weight: 5, opacity: .55 }).addTo(layer);
    L.circleMarker(pl.coords[0], { radius: 5.5, color:'#fff', weight: 1.5, fillColor: band.c, fillOpacity: .95 })
      .bindTooltip(`${esc(o.troName ?? 'Traffic order')} · ${esc(band.label)}`, { direction:'top' })
      .bindPopup(popup).addTo(layer);
  }
  return layer;
}
export const troItems = orders => orders.flatMap(o => (o.provisions ?? []).flatMap(p => (p.places ?? []).map(pl => ({ o, p, pl }))));

/* Live bus marker, as on the Intelligence map: dark dot with a white ring, a white chevron pointing along the
   bearing and a soft pulsing halo. The dark fill keeps it distinct from every route-line colour. */
export function busIcon(bearing){
  const arrow = Number.isFinite(bearing)
    ? `<svg viewBox="0 0 24 24" style="transform:rotate(${bearing - 90}deg)"><path d="M9 6l7 6-7 6" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>` : '';
  return L.divIcon({ className:'lb-bus', iconSize:[28,28], iconAnchor:[14,14], html:`<div class="lb-dot"><i>${arrow}</i></div>` });
}
export function busesLayer(rows, reg){
  const layer = L.layerGroup();
  for(const v of rows){
    const icon = busIcon(v.bearing);
    const rec = v.reg ? reg?.[String(v.reg).toUpperCase()] : null;
    const bits = [rec?.make ? title(rec.make) : null, rec?.body ?? null, rec?.year ?? null, rec?.propulsion ? title(rec.propulsion) : null].filter(Boolean).join(' · ');
    L.marker([v.lat, v.lng], { icon })
      .bindPopup(`${v._route ? `<b>Route ${esc(v._route)}</b><br>` : ''}${v.reg ? plate(v.reg) : '<b>Bus</b>'}<br>${esc(v.destination ? 'to ' + title(v.destination) : '')}${bits?`<br><span style="color:var(--tx2)">${esc(bits)}</span>`:''}${v.reg?`<br><a href="#/vehicle/${encodeURIComponent(String(v.reg).toUpperCase())}" style="color:var(--acc);font-weight:600">Vehicle details ›</a>`:''}`)
      .addTo(layer);
  }
  return layer;
}

/* Layer buttons for the network map — the same icons as the route view's. */
export const LAYER_UI = [
  { k:'garages', label:'Garages', icon:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10 12 4l9 6"/><path d="M5 9v11h14V9"/></svg>` },
  { k:'stops', label:'Stops', icon:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg>` },
  { k:'live', label:'Live buses', icon:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="4" width="14" height="13" rx="2"/><line x1="5" y1="10" x2="19" y2="10"/><circle cx="9" cy="14" r=".8" fill="currentColor"/><circle cx="15" cy="14" r=".8" fill="currentColor"/></svg>` },
  { k:'bridges', label:'Low bridges', icon:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 18v-7"/><path d="M21 18v-7"/><path d="M3 13c3-4 15-4 18 0"/><path d="M2 18h20"/></svg>` },
  { k:'inc', label:'Incidents', icon:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20Z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>` },
  { k:'sw', label:'Street works', icon:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 4h-3L6 20h12z"/><path d="M9.2 10h5.6M7.9 15h8.2"/><path d="M4 20h16"/></svg>` },
  { k:'tro', label:'Traffic orders', icon:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>` },
];
/* Stop pin popup: name, the next three buses (fetched when the popup opens), then a link to the full board. */
export function bindStopPopup(marker, id, name, extra = ''){
  const dueText = ms => ms <= 30000 ? 'Due' : `${Math.round(ms/60000)} min`;
  const box = document.createElement('div');
  box.style.minWidth = '190px';
  box.innerHTML = `<b>${esc(name)}</b>${extra}<div class="sp-arr" style="margin:6px 0 4px;font-size:12.5px;color:var(--tx2)">Loading arrivals…</div><a href="#/stop/${encodeURIComponent(id)}" style="color:var(--acc);font-weight:600">See all live arrivals ›</a>`;
  const list = box.querySelector('.sp-arr');
  let tok = 0;
  marker.bindPopup(box);
  marker.on('popupopen', async e => {
    const my = ++tok;
    const raw = await D.arrivals(id);
    if(my !== tok) return;
    const t0 = Date.now();
    const rows = (raw?.data ?? []).filter(a => Number.isFinite(a.timeToStation))
      .map(a => ({ ...a, dueAt: Number.isFinite(Date.parse(a.expectedArrival)) ? Date.parse(a.expectedArrival) : t0 + a.timeToStation * 1000 }))
      .sort((a, b) => a.dueAt - b.dueAt).slice(0, 3);
    list.innerHTML = rows.length
      ? rows.map(a => `<div style="display:flex;align-items:center;gap:8px;padding:2px 0"><span class="rchip" style="min-height:0;padding:1px 7px;font-size:11.5px">${esc(a.lineName ?? '')}</span><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.destinationName ? title(a.destinationName) : '')}</span><b style="font-family:var(--mono);color:var(--tx)">${dueText(a.dueAt - Date.now())}</b></div>`).join('')
      : (raw ? 'No buses predicted right now.' : 'Arrivals unavailable right now.');
    e.popup.update();
  });
  return marker;
}
/* Garage popup used by every map pin: headline numbers, every route as a
   tappable chip, and the detail link. */
export function garagePopupHtml(g, meta, extraRows = ''){
  const tvr = tvrOf(g.pvr);
  // Same utilisation definition as the garage detail page: PVR ÷ capacity.
  const util = num(g.utilisation) ?? (num(g.pvr) && num(g.capacity) ? g.pvr / g.capacity : null);
  const props = (g.routes ?? []).map(r => meta?.[r]?.propulsion).filter(Boolean);
  const ev = props.length ? Math.round(props.filter(p => p === 'electric' || p === 'hydrogen').length / props.length * 100) + '%' : '—';
  const row = (l, v) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:20px;padding:5px 0;border-top:1px solid var(--bd)"><span style="color:var(--tx2)">${l}</span><b style="font-family:var(--mono);font-size:12.5px">${v}</b></div>`;
  const chips = [...(g.routes ?? [])].sort(cmpRoute).map(r =>
    `<a href="#/route/${encodeURIComponent(r)}" style="background:var(--surf2);color:var(--tx);border-radius:6px;padding:1px 6px;font-family:var(--mono);font-weight:600;font-size:10.5px">${esc(r)}</a>`).join('');
  return `<div style="min-width:212px"><b style="font-size:13.5px">${esc(g.name)} (${esc(g.code)})</b>
    <div style="color:var(--tx2);margin:1px 0 8px">${esc(g.operator ?? '')}</div>
    ${row('PVR', g.pvr ?? '—')}${row('TVR', tvr ?? '—')}${row('Capacity', g.capacity ?? '—')}${util != null ? row('Utilisation', `<span title="PVR ÷ capacity">${Math.round(util*100)}%</span>`) : ''}${row('Zero-emission', ev)}${row('Routes operated', (g.routes ?? []).length)}${extraRows}
    <div style="font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mu);margin:9px 0 5px">Routes operated</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;max-width:250px;margin-bottom:9px">${chips}</div>
    <a href="#/garage/${encodeURIComponent(g.code)}" style="color:var(--acc);font-weight:600">Garage details ›</a></div>`;
}

/* A garage is pinnable only when the dataset has its real site location. When
   postcodeSource is "company" the lat/lng is the operating company's
   registered office — pinning that as the garage would be wrong data. */
export const garageLocOk = g => Number.isFinite(g?.lat) && Number.isFinite(g?.lng) && g.postcodeSource !== 'company';

/* Base map for every map view.

   Light theme: OpenFreeMap "Bright" — free vector tiles, no account, no key,
   no usage cap — drawn by MapLibre GL through the maplibre-gl-leaflet bridge,
   so every Leaflet layer in the app (routes, markers, heatmap, popups) is
   untouched. The style is split across two GL layers to keep the app's label
   rule: everything except symbols sits in the tile pane, and a labels-only
   layer sits in its own pane ABOVE the route lines (z420, below markers) —
   exactly one set of place/road names, never buried under thick polylines.

   Dark theme (OpenFreeMap has no dark style) and ANY vector failure — library
   blocked or offline, no WebGL, style or tiles unreachable — use CARTO raster
   tiles instead: a label-free basemap plus its matching labels-only tiles in
   that same z420 pane. CARTO basemaps require an API key since 2026-08 (free
   tier: 5M tiles/month in exchange for CARTO + OSM attribution, shown in the ⓘ credit control).
   The MapLibre files are fetched lazily (first map, or idle after load), never
   on pages without a map. After a vector failure the session sticks to CARTO
   for 5 minutes rather than retrying on every map. */
const CARTO_KEY = 'cb1_2fm5_1_26615b0300555b1070348b74';
const VEC = {
  style: 'https://tiles.openfreemap.org/styles/bright',
  assets: [
    { type:'css', url:'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css', sri:'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK' },
    { type:'js',  url:'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',  sri:'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp' },
    { type:'js',  url:'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js', sri:'sha384-tXYNKOHx4T02jMP7YYCtBxPIv1B5gaA5mcVPBzqMp6d7VzWzxJgI2aWF/nJLrQdS' },
  ],
  downUntil: 0,
};
const loadAsset = a => new Promise((res, rej) => {
  const el = document.createElement(a.type === 'css' ? 'link' : 'script');
  if(a.type === 'css'){ el.rel = 'stylesheet'; el.href = a.url; } else el.src = a.url;
  el.integrity = a.sri; el.crossOrigin = 'anonymous';
  el.onload = () => res(); el.onerror = () => rej(new Error('failed to load ' + a.url));
  document.head.appendChild(el);
});
let _vecLib = null;
export const vectorLib = () => _vecLib ??= (async () => {
  const [css, lib, bridge] = VEC.assets;
  await Promise.all([loadAsset(css), loadAsset(lib)]);
  await loadAsset(bridge);                               // the bridge needs window.maplibregl
  if(!window.maplibregl || !L.maplibreGL) throw new Error('MapLibre bridge unavailable');
})().catch(e => { _vecLib = null; throw e; });
let _vecStyles = null;
export const vectorStyles = () => _vecStyles ??= (async () => {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try{
    const r = await fetch(VEC.style, { signal: ctl.signal });
    if(!r.ok) throw new Error('style HTTP ' + r.status);
    const s = await r.json();
    if(!Array.isArray(s?.layers)) throw new Error('unexpected style payload');
    return {
      base:   { ...structuredClone(s), layers: s.layers.filter(l => l.type !== 'symbol').map(l => structuredClone(l)) },
      labels: { ...structuredClone(s), layers: s.layers.filter(l => l.type === 'symbol').map(l => structuredClone(l)) },
    };
  } finally { clearTimeout(t); }
})().catch(e => { _vecStyles = null; throw e; });
let _webgl;
export const webglOk = () => _webgl ??= (() => {
  try{
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  }catch(e){ return false; }
})();

/* Credit control: a small ⓘ button that expands the credit text on click (the
   same collapsed pattern MapLibre and Leaflet's own compact controls use),
   instead of a permanent line across the map. The text stays one click away on
   every map, and the About page lists every source in full. Closes on a map
   click, a drag/zoom, or Escape. */
const AttribControl = window.L ? L.Control.extend({
  options: { position:'bottomright' },
  onAdd(map){
    const box = L.DomUtil.create('div', 'lb-attr leaflet-control');
    box.innerHTML = '<button type="button" class="lb-attr-btn" aria-label="Map credits" aria-expanded="false">i</button><div class="lb-attr-txt" role="note" hidden></div>';
    const btn = box.querySelector('button'), txt = this._txt = box.querySelector('.lb-attr-txt');
    const set = open => { txt.hidden = !open; box.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', () => set(txt.hidden));
    box.addEventListener('keydown', e => { if(e.key === 'Escape'){ set(false); btn.focus(); } });
    map.on('click movestart zoomstart', () => set(false));
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    return box;
  },
  setHtml(html){ if(this._txt) this._txt.innerHTML = html; },
}) : null;
const ATTRIB = {
  carto: '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" rel="noopener" target="_blank">CARTO</a>',
  ofm:   '<a href="https://openfreemap.org" rel="noopener" target="_blank">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/" rel="noopener" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">OpenStreetMap</a>',
};
function setBasemap(map, kind){
  map.getContainer().dataset.basemap = kind;             // 'loading' | 'vector' | 'carto' (also read by tests)
  const key = kind === 'carto' ? 'carto' : 'ofm';
  map._attrib.setHtml(ATTRIB[key]);
}
const labelsPane = map => {
  const p = map.getPane('placelabels') || map.createPane('placelabels');
  p.style.zIndex = 420;
  p.style.pointerEvents = 'none';
  return p;
};
function cartoTiles(map){
  const style = isDark() ? 'dark' : 'voyager';
  L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/${style}_nolabels/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`, { maxZoom:19 }).addTo(map);
  labelsPane(map);
  L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/${style}_only_labels/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`, { maxZoom:19, pane:'placelabels' }).addTo(map);
  setBasemap(map, 'carto');
}
function baseTiles(map){
  if(isDark() || Date.now() < VEC.downUntil || !webglOk()) return cartoTiles(map);
  setBasemap(map, 'loading');
  let gone = false, fell = false, loaded = false, layers = [];
  map.once('unload', () => { gone = true; });              // view navigated away mid-setup
  const fallback = why => {
    if(gone || fell) return;
    fell = true;
    VEC.downUntil = Date.now() + 5 * 60e3;
    console.warn('Vector basemap unavailable — using CARTO:', why?.message ?? why);
    for(const l of layers){ try{ map.removeLayer(l); }catch(e){} try{ l.getContainer?.()?.remove(); }catch(e){} }
    layers = [];
    cartoTiles(map);
  };
  Promise.all([vectorLib(), vectorStyles()]).then(([, st]) => {
    if(gone || fell) return;
    labelsPane(map);
    const add = (style, pane) => {
      const l = L.maplibreGL({ style, pane, attributionControl:false, fadeDuration:0 });
      layers.push(l); l.addTo(map); return l;
    };
    const gl = add(st.base, 'tilePane').getMaplibreMap();
    add(st.labels, 'placelabels');
    const timer = setTimeout(() => { if(!loaded) fallback(new Error('timed out loading style/tiles')); }, 12000);
    let errs = 0;
    gl.once('load', () => { loaded = true; clearTimeout(timer); if(!gone && !fell) setBasemap(map, 'vector'); });
    gl.on('error', e => { if(!loaded && ++errs >= 4){ clearTimeout(timer); fallback(e?.error); } });
  }).catch(fallback);
}
/* Every map view is built through this one constructor — same options, same
   credit control, same basemap logic — so the mini maps stay
   consistent by construction rather than by review. */
export function makeMap(el){
  // The map library comes from a CDN; if it is blocked or slow, every page that does not draw a map still works.
  if(!window.L){
    el.innerHTML = '<div class="empty" style="margin:16px;max-width:420px">The map could not load — the map library was blocked or is offline. Check your connection or any content blocker, then reload.</div>';
    throw new Error('map library unavailable');
  }
  // maxZoom is explicit: a vector basemap has no tile layer to imply one.
  const map = L.map(el, { zoomControl:false, preferCanvas:true, attributionControl:false, maxZoom:19 });
  // Credit for whichever basemap is active (a condition of both free tiers), one click away.
  map._attrib = new AttribControl().addTo(map);
  baseTiles(map);
  return map;
}

/* TfL publishes several notices per line, sometimes another route's. Count
   only notices whose validity window covers now (isNow is unreliable), take
   the worst, and among equals prefer prose naming this route. */
export function pickStatus(name, statuses){
  if(!statuses?.length) return null;
  const now = Date.now();
  const active = statuses.filter(ls => {
    if(ls.statusSeverity === 10) return true;
    const vps = ls.validityPeriods;
    if(!vps?.length) return true;
    return vps.some(vp => {
      const f = vp.fromDate ? Date.parse(vp.fromDate) : NaN, t = vp.toDate ? Date.parse(vp.toDate) : NaN;
      return (isNaN(f) || f <= now) && (isNaN(t) || t >= now);
    });
  });
  if(!active.length) return { status:'Good Service', reason:null, severity:10 };
  const mentions = ls => {
    const r = ls.reason ?? '';
    if(new RegExp('\\broutes?\\b[^.:]*\\b'+name+'\\b','i').test(r)) return 2;
    if(new RegExp('\\b'+name+'\\b','i').test(r)) return 1;
    return 0;
  };
  const pick = active.map((ls,i)=>({ls,i,sev:ls.statusSeverity ?? 10,m:mentions(ls)}))
    .sort((a,b)=>a.sev-b.sev || b.m-a.m || a.i-b.i)[0].ls;
  return { status:pick.statusSeverityDescription ?? null, reason:pick.reason ?? null, severity:pick.statusSeverity ?? null };
}
