/* The route map (MapLibre, loaded on first use). */
import { D } from '../data.js';
import { $, $$, esc } from '../dom.js';
import { shapeSvg } from '../drawer/charts.js';
import { corridor, lenKm, routeGeo, runsOf, stopsData } from '../drawer/route-data.js';
import { fDate, fNum, nOf } from '../format.js';
import { bounds } from '../geometry.js';
import { S, SC } from '../state.js';
import { ALL, opColour, OPS } from '../tokens.js';
import { shortOp } from '../views/hero.js';

/* ── the route map (MapLibre, loaded on first use) ────────────────────────── */
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const LIB = [
  { type:'css', url:'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css', sri:'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK' },
  { type:'js',  url:'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',  sri:'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp' },
];
const loadAsset = a => new Promise((res, rej) => {
  const el = document.createElement(a.type === 'css' ? 'link' : 'script');
  if(a.type === 'css'){ el.rel = 'stylesheet'; el.href = a.url; } else el.src = a.url;
  el.integrity = a.sri; el.crossOrigin = 'anonymous'; el.onload = () => res(); el.onerror = () => rej(new Error('failed to load ' + a.url));
  document.head.appendChild(el);
});
const webglOk = (() => { let v; return () => v ??= (() => { try{ const c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl'); g?.getExtension('WEBGL_lose_context')?.loseContext(); return !!g; }catch(e){ return false; } })(); })();
export const MH = Object.assign(document.createElement('div'), { id:'dmapHost', className:'dmaphost' });   // one persistent host, re-attached on every brief
export const MP = { map:null, ready:null, failed:false, tok:0, markers:[], liveT:null, popup:null };
export const EMPTY = { type:'FeatureCollection', features:[] };
const fc = (pts, props = () => ({})) => ({ type:'FeatureCollection', features:pts.map((p, i) => ({ type:'Feature', properties:props(p, i), geometry:{ type:'Point', coordinates:[p.lng ?? p.lon, p.lat] } })) });
function chevron(){
  const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
  x.lineWidth = 5; x.lineCap = x.lineJoin = 'round'; x.strokeStyle = '#fff'; x.beginPath(); x.moveTo(11, 8); x.lineTo(21, 16); x.lineTo(11, 24); x.stroke();
  return x.getImageData(0, 0, 32, 32);
}
function warnIcon32(){
  const c = document.createElement('canvas'); c.width = c.height = 40; const x = c.getContext('2d');
  x.lineJoin = 'round'; x.lineCap = 'round';
  x.beginPath(); x.moveTo(20, 5); x.lineTo(35, 33); x.lineTo(5, 33); x.closePath();
  x.fillStyle = '#fab219'; x.strokeStyle = '#fff'; x.lineWidth = 5; x.stroke(); x.fill();
  x.strokeStyle = '#101828'; x.lineWidth = 3; x.beginPath(); x.moveTo(20, 15); x.lineTo(20, 24); x.stroke();
  x.fillStyle = '#101828'; x.beginPath(); x.arc(20, 29, 1.8, 0, 7); x.fill();
  return x.getImageData(0, 0, 40, 40);
}
// Positron, retuned: cool pastel land and water that sit behind the dashboard palette, quieter roads and labels
function tuneBasemap(map){
  const set = (id, prop, v) => { try{ if(map.getLayer(id)) map.setPaintProperty(id, prop, v); }catch(e){} };
  set('background', 'background-color', '#f4f6f9');
  set('park', 'fill-color', '#e4eee8'); set('landcover_wood', 'fill-color', '#dce9e1');
  set('water', 'fill-color', '#d3e3f4'); set('waterway', 'line-color', '#c3d9ef');
  set('landuse_residential', 'fill-color', '#f0f2f6'); set('building', 'fill-color', '#e8ebf0');
  for(const id of ['highway_minor', 'highway_path']) set(id, 'line-color', '#e4e8ee');
  for(const id of ['highway_major_casing', 'highway_motorway_casing', 'highway_motorway_bridge_casing', 'tunnel_motorway_casing']) set(id, 'line-color', '#dde1e8');
  for(const id of ['railway', 'railway_transit', 'railway_service']) set(id, 'line-color', '#d8dce4');
  for(const id of ['highway-name-minor', 'highway-name-major', 'highway-name-path']) set(id, 'text-color', '#7a8497');
  for(const id of ['label_other', 'label_village', 'label_town']) set(id, 'text-color', '#475467');
  for(const id of ['label_city', 'label_city_capital', 'label_country_1', 'label_country_2', 'label_country_3', 'label_state']) set(id, 'text-color', '#101828');
  for(const id of ['water_name_point_label', 'water_name_line_label']) set(id, 'text-color', '#6f8fbd');
}
let pulseRaf = null;
function pulse(){
  cancelAnimationFrame(pulseRaf);
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now();
  const step = t => { if(!S.ml.live || !MP.map || !S.route || !MP.map.getLayer('live-halo')) return; const k = ((t - t0) % 1800) / 1800; MP.map.setPaintProperty('live-halo', 'circle-radius', 9 + k * 14); MP.map.setPaintProperty('live-halo', 'circle-opacity', .3 * (1 - k)); pulseRaf = requestAnimationFrame(step); };
  pulseRaf = requestAnimationFrame(step);
}
async function mapBase(container){
  if(!webglOk()) throw new Error('WebGL unavailable');
  await Promise.all(LIB.map(loadAsset)); if(!window.maplibregl) throw new Error('MapLibre unavailable');
  const map = new maplibregl.Map({ container, style:MAP_STYLE, center:[-0.11, 51.51], zoom:10, attributionControl:{ compact:true }, cooperativeGestures:true, fadeDuration:0 });
  map.addControl(new maplibregl.NavigationControl({ showCompass:false }), 'top-right');
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('map style timed out')), 12000); map.once('load', () => { clearTimeout(t); res(); }); });
  tuneBasemap(map);
  map.addImage('chev', chevron(), { pixelRatio:2 }); map.addImage('warn', warnIcon32(), { pixelRatio:2 });
  return map;
}
// popups are built from text nodes (labels are data, never HTML); an optional action adds a button
function popupSay(map, popup, e, title, rows, action){
  const d = document.createElement('div'), b = document.createElement('b'); b.textContent = title; d.append(b);
  rows.filter(Boolean).forEach(t => { const p = document.createElement('div'); p.className = 'pp'; p.textContent = t; d.append(p); });
  if(action){ const a = document.createElement('button'); a.className = 'pbtn'; a.textContent = action.label; a.addEventListener('click', () => { popup.remove(); action.fn(); }); d.append(a); }
  popup.setLngLat(e.lngLat).setDOMContent(d).addTo(map);
}
const garData = skip => fc(D.garages.filter(g => Number.isFinite(g.lat) && g.code !== skip && D.DEPOTS[ALL].some(d => d.code === g.code)), g => ({ name:g.name, code:g.code, op:g.operator, ops:shortOp(g.operator), pvr:g.pvr ?? 0, cap:g.capacity ?? 0, c:opColour(g.operator) }));
const GAR_LABEL = ['format', ['get', 'name'], {}, '\n', {}, ['get', 'ops'], { 'font-scale':.82, 'text-color':'#667085' }];
export const garLegend = () => `<div class="garleg float" ${S.ml.gar ? '' : 'hidden'}>${OPS.map(o => `<span><i class="dot" style="background:${opColour(o)}"></i>${esc(shortOp(o))}</span>`).join('')}</div>`;
// hover card on a garage marker: name, code, operator, size
function garHover(map, layers){
  const pop = new maplibregl.Popup({ closeButton:false, closeOnClick:false, offset:14, className:'hoverpop', maxWidth:'240px' });
  for(const l of layers){
    map.on('mousemove', l, e => { const p = e.features[0].properties; popupSay(map, pop, e, p.name + ' garage', [p.code + ' · ' + p.op, p.pvr + ' peak vehicles' + (+p.cap ? ' · capacity ' + p.cap : '')]); });
    map.on('mouseleave', l, () => pop.remove());
  }
}
function mapEnsure(){
  return MP.ready ??= (async () => {
    const map = await mapBase(MH);
    for(const id of ['route', 'stops', 'works', 'coll', 'bridges', 'live', 'gars']) map.addSource(id, { type:'geojson', data:EMPTY });
    const W = ['interpolate', ['linear'], ['zoom'], 9, 1, 16, 1];   // keep the expression helpers readable
    map.addLayer({ id:'gars', type:'circle', source:'gars', paint:{ 'circle-radius':['interpolate', ['linear'], ['zoom'], 9, 6, 14, ['+', 8, ['*', ['sqrt', ['get', 'pvr']], .4]]], 'circle-color':['get', 'c'], 'circle-stroke-color':'#fff', 'circle-stroke-width':2.6 } });
    map.addLayer({ id:'gars-lbl', type:'symbol', source:'gars', minzoom:9, layout:{ 'text-field':GAR_LABEL, 'text-font':['Noto Sans Regular'], 'text-size':11.5, 'text-offset':[0, 1.3], 'text-anchor':'top' }, paint:{ 'text-color':'#101828', 'text-halo-color':'#fff', 'text-halo-width':1.8 } });
    map.addLayer({ id:'coll', type:'circle', source:'coll', paint:{ 'circle-radius':4.5, 'circle-color':['match', ['get', 'sev'], 'fatal', '#101828', '#eb6834'], 'circle-stroke-color':'#fff', 'circle-stroke-width':1.5, 'circle-opacity':.9 } });
    map.addLayer({ id:'bridges', type:'circle', source:'bridges', paint:{ 'circle-radius':5.5, 'circle-color':['case', ['<', ['get', 'h'], 4.2], '#d03b3b', '#fab219'], 'circle-stroke-color':'#fff', 'circle-stroke-width':2 } });
    map.addLayer({ id:'route-glow', type:'line', source:'route', layout:{ 'line-cap':'round', 'line-join':'round' }, paint:{ 'line-color':'#2a78d6', 'line-opacity':.28, 'line-blur':7, 'line-width':['interpolate', ['linear'], ['zoom'], 9, 9, 16, 22] } });
    map.addLayer({ id:'route-case', type:'line', source:'route', layout:{ 'line-cap':'round', 'line-join':'round' }, paint:{ 'line-color':'#fff', 'line-opacity':.95, 'line-width':['interpolate', ['linear'], ['zoom'], 9, 5, 16, 13] } });
    map.addLayer({ id:'route-line', type:'line', source:'route', layout:{ 'line-cap':'round', 'line-join':'round' }, paint:{ 'line-color':'#2a78d6', 'line-width':['interpolate', ['linear'], ['zoom'], 9, 3, 16, 7.5] } });
    map.addLayer({ id:'route-chev', type:'symbol', source:'route', layout:{ 'symbol-placement':'line', 'symbol-spacing':70, 'icon-image':'chev', 'icon-size':.5, 'icon-allow-overlap':true, 'icon-rotation-alignment':'map' } });
    map.addLayer({ id:'stops', type:'circle', source:'stops', paint:{ 'circle-radius':['interpolate', ['linear'], ['zoom'], 10, ['case', ['get', 'term'], 3.6, 1.8], 15, ['case', ['get', 'term'], 6.5, 4.4]], 'circle-color':'#fff', 'circle-stroke-color':'#2a78d6', 'circle-stroke-width':['case', ['get', 'term'], 2.6, 1.6] } });
    map.addLayer({ id:'works', type:'symbol', source:'works', layout:{ 'icon-image':'warn', 'icon-size':.62, 'icon-allow-overlap':true } });
    map.addLayer({ id:'live-halo', type:'circle', source:'live', paint:{ 'circle-radius':11, 'circle-color':'#2a78d6', 'circle-opacity':.2 } });
    map.addLayer({ id:'live', type:'circle', source:'live', paint:{ 'circle-radius':6.5, 'circle-color':'#101828', 'circle-stroke-color':'#fff', 'circle-stroke-width':2 } });
    map.addLayer({ id:'live-dir', type:'symbol', source:'live', layout:{ 'icon-image':'chev', 'icon-size':.34, 'icon-allow-overlap':true, 'icon-rotate':['-', ['coalesce', ['get', 'bearing'], 90], 90], 'icon-rotation-alignment':'map' } });
    // hover + click popups, built from text nodes (labels are data, never HTML)
    MP.popup = new maplibregl.Popup({ closeButton:false, closeOnClick:true, offset:12, maxWidth:'260px' });
    const say = (e, title, rows) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = title; d.append(b); rows.filter(Boolean).forEach(t => { const p = document.createElement('div'); p.className = 'pp'; p.textContent = t; d.append(p); }); MP.popup.setLngLat(e.lngLat).setDOMContent(d).addTo(map); };
    const on = (layer, fn) => { map.on('mouseenter', layer, () => map.getCanvas().style.cursor = 'pointer'); map.on('mouseleave', layer, () => map.getCanvas().style.cursor = ''); map.on('click', layer, e => fn(e, e.features[0].properties)); };
    on('gars', (e, p) => say(e, p.name + ' garage', [p.code + ' · ' + p.op, p.pvr + ' peak vehicles' + (p.cap ? ' · capacity ' + p.cap : '')]));
    garHover(map, ['gars']);
    on('stops', (e, p) => say(e, p.name, [p.letter ? 'Stop ' + p.letter : '', p.lines ? 'Also served by: ' + p.lines : '']));
    on('works', (e, p) => say(e, p.location, [p.sev + ' · ' + p.status, p.until ? 'Until ' + p.until : '', p.note]));
    on('coll', (e, p) => say(e, (p.sev === 'fatal' ? 'Fatal' : 'Serious') + ' collision', [p.date, p.road]));
    on('bridges', (e, p) => say(e, p.name || 'Height restriction', [p.h ? 'Clearance ' + p.h + ' m' : '', p.kind]));
    on('live', (e, p) => say(e, 'Bus ' + p.reg, [p.dest ? 'To ' + p.dest : '', p.rec ? 'Updated ' + p.rec : '']));
    return map;
  })().catch(e => { MP.failed = true; MP.ready = null; throw e; });
}
const setVis = (map, ids, on) => ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
export function applyLayers(map){
  setVis(map, ['stops'], S.ml.stops); setVis(map, ['works'], S.ml.works); setVis(map, ['coll'], S.ml.coll);
  setVis(map, ['bridges'], S.ml.bridges); setVis(map, ['gars', 'gars-lbl'], S.ml.gar); setVis(map, ['live-halo', 'live', 'live-dir'], S.ml.live);
}
function chipCount(key, n){ $$(`[data-ml="${key}"] .cnt`).forEach(el => el.textContent = n == null ? '' : ' · ' + n); }
export function liveStop(){ clearTimeout(MP.liveT); MP.liveT = null; cancelAnimationFrame(pulseRaf); }
export async function livePoll(r, tok){
  if(!S.ml.live || tok !== MP.tok) return;
  const chip = { classList:{ add:c => $$('[data-ml="live"]').forEach(e => e.classList.add(c)), remove:c => $$('[data-ml="live"]').forEach(e => e.classList.remove(c)) }, setAttribute:(a, v) => $$('[data-ml="live"]').forEach(e => e.setAttribute(a, v)), removeAttribute:a => $$('[data-ml="live"]').forEach(e => e.removeAttribute(a)) };
  try{
    const res = await fetch('/api/live/vehicles?line=' + encodeURIComponent(r.id)); if(!res.ok) throw new Error('feed ' + res.status);
    const j = await res.json(); if(tok !== MP.tok || !S.ml.live) return;
    const rows = (j.data ?? []).filter(v => Number.isFinite(v.lat) && Number.isFinite(v.lng));
    MP.map.getSource('live').setData(fc(rows, v => ({ reg:v.reg, bearing:v.bearing, dest:v.destination, rec:v.recordedAt ? new Date(v.recordedAt).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : '' })));
    chipCount('live', rows.length); chip?.classList.remove('off'); chip?.removeAttribute('title'); pulse();
    MP.liveT = setTimeout(() => livePoll(r, tok), 10000);
  }catch(e){ chipCount('live', null); chip?.classList.add('off'); chip?.classList.add('off'); chip?.setAttribute('title', 'The live feed is not available right now'); }
}
export async function mapShow(r){
  const tok = ++MP.tok; liveStop();
  let map; try{ map = await mapEnsure(); }catch(e){ console.warn('Route map unavailable:', e.message); mapFallback(r); return; }
  if(tok !== MP.tok) return;
  MP.map = map; MH.dataset.state = 'ready'; map.resize(); applyLayers(map);
  for(const id of ['route', 'stops', 'coll', 'bridges', 'live']) map.getSource(id).setData(EMPTY);
  map.getSource('gars').setData(garData(r.garage));
  MP.markers.forEach(m => m.remove()); MP.markers = [];
  for(const [id, prop] of [['route-line', 'line-color'], ['route-glow', 'line-color']]) map.setPaintProperty(id, prop, opColour(r.op));
  map.setPaintProperty('stops', 'circle-stroke-color', opColour(r.op));
  const geo = await routeGeo(r.id).catch(() => null); if(tok !== MP.tok) return;
  const runs = runsOf(geo, S.dir);
  map.getSource('route').setData({ type:'FeatureCollection', features:runs.map(c => ({ type:'Feature', properties:{}, geometry:{ type:'LineString', coordinates:c } })) });
  const all = runs.flat();
  if(all.length){ map.resize(); const bb = bounds([all]); MP.fit = [[bb.minLon, bb.minLat], [bb.maxLon, bb.maxLat]]; map.fitBounds(MP.fit, { padding:{ top:56, bottom:40, left:44, right:56 }, duration:0, maxZoom:15 }); }
  const pin = (txt, bg) => { const el = document.createElement('div'); el.className = 'pin'; el.style.background = bg; el.textContent = txt; return el; };
  if(all.length){
    const last = runs[runs.length - 1], a = runs[0][0], b = last[last.length - 1];
    MP.markers.push(new maplibregl.Marker({ element:pin('A', '#fff') }).setLngLat(a).addTo(map), new maplibregl.Marker({ element:pin('B', opColour(r.op)) }).setLngLat(b).addTo(map));
    MP.markers[0].getElement().style.color = opColour(r.op); MP.markers[0].getElement().style.border = `2.5px solid ${opColour(r.op)}`;
  }
  const g = D.garages.find(x => x.code === r.garage);
  if(g && Number.isFinite(g.lat)){ const el = document.createElement('div'); el.className = 'gpin'; el.title = `${g.name} garage`; el.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10 12 4l9 6"/><path d="M5 9v11h14V9"/></svg>'; const lb = document.createElement('span'); lb.className = 'gpl'; lb.textContent = g.name; el.append(lb); MP.markers.push(new maplibregl.Marker({ element:el }).setLngLat([g.lng, g.lat]).addTo(map)); }
  // roadworks the TIMS feed has joined to this route
  const wk = r.works.filter(w => Number.isFinite(w.lat));
  map.getSource('works').setData(fc(wk, w => ({ location:String(w.location ?? '').replace(/\s*\(.*$/, ''), sev:w.severity, status:w.status, until:w.endDateTime ? fDate(w.endDateTime) : '', note:String(w.currentUpdate ?? w.comments ?? '').slice(0, 140) })));
  chipCount('works', wk.length);
  stopsData().then(sd => {
    if(tok !== MP.tok) return;
    const list = sd?.routes?.[r.id]?.[S.dir] ?? [];
    map.getSource('stops').setData(fc(list, (st, i) => ({ term:i === 0 || i === list.length - 1, name:st.name, letter:st.letter ?? '', lines:(st.lines ?? []).filter(l => l !== r.id).slice(0, 8).join(', ') })));
    chipCount('stops', list.length);
    const km = lenKm(runs); const nm = $('#mapNote'); if(nm) nm.textContent = `${fNum(km, 1)} km · ${nOf(list.length, 'stop')}${list.length > 1 && km ? ` · one every ${Math.round(km * 1000 / (list.length - 1))} m` : ''} · ${S.dir === 'outbound' ? 'towards ' + r.from : 'towards ' + r.to}`;
  }).catch(() => chipCount('stops', null));
  corridor(r).then(c => {
    if(tok !== MP.tok) return;
    map.getSource('coll').setData(fc(c.coll.filter(a => a.severity !== 'slight'), a => ({ sev:a.severity, date:fDate(a.date), road:[a.roadType, a.speedLimit].filter(Boolean).join(' · ') })));
    map.getSource('bridges').setData(fc(c.bridges, b => ({ h:b.height_m ?? null, name:b.name ?? b.road, kind:b.structure_type })));
    chipCount('coll', c.coll.filter(a => a.severity !== 'slight').length); chipCount('bridges', c.bridges.length);
  }).catch(() => {});
  if(S.ml.live) livePoll(r, tok);
}
function mapFallback(r){ const slot = $('#drawer .mapbox'); if(slot) slot.innerHTML = `<div class="shape" style="border:0;border-radius:0">${shapeSvg(r)}</div>`; $('#drawer .mapbar')?.setAttribute('hidden', ''); }

let mapMode = null;
/* Expanded maps are the main site's /map, scoped to this operator, garage or route, in an iframe with no
   header or tab bar — so the layers, garages, live buses and styling are the same everywhere. */
export function mapOpen(kind){
  const fs = $('#mapfs'), body = $('#mfBody'); if(!fs) return;
  const sc = SC(), r = kind === 'route' ? D.byId.get(S.route) : null; if(kind === 'route' && !r) return;
  mapMode = kind; fs.dataset.mode = kind; body.replaceChildren(); fs.hidden = false; document.body.style.overflow = 'hidden';
  $('#mfTitle').textContent = kind === 'route' ? `Route ${r.id}` : kind === 'pin' ? `Catchment · ${sc.name}` : sc.name;
  $('#mfSub').textContent = kind === 'route' ? `${r.from} ⇄ ${r.to} · ${r.op}` : `${nOf(sc.st.n, 'route')} · ${sc.st.garages} garage${sc.st.garages === 1 ? '' : 's'}`;
  const q = new URLSearchParams();
  if(kind === 'route') q.set('routes', r.id);
  else if(kind === 'pin' && sc.kind === 'garage' && Number.isFinite(sc.g?.lat)){ q.set('pin', `${sc.g.lat},${sc.g.lng},3000`); q.set('title', sc.name); }
  else if(sc.kind !== 'all'){ q.set('ids', sc.list.map(x => x.id).join(',')); q.set('title', sc.name); }
  q.set('embed', '1');
  const f = Object.assign(document.createElement('iframe'), { className:'mapframe', title:kind === 'route' ? `Map of route ${r.id}` : `Map of ${sc.name}`, src:'/#/map?' + q });
  body.append(f);
  $('#mfClose').focus();
}
export function mapClose(){
  const fs = $('#mapfs'); if(!fs || fs.hidden) return;
  fs.hidden = true; document.body.style.overflow = '';
  $('#mfBody').replaceChildren(); mapMode = null;
}
