/* Data layer — API base URLs, one cached promise per endpoint, TfL live feeds, and the D.* dataset accessors. */
import { esc, title } from './utils.js';

/* The site is a client of its own public API: /api/v1/*.json (docs at /docs#api), generated at deploy time by
   scripts/build-v1.js from the committed datasets. Every response is { meta, data }; get() unwraps `data`, so
   everything downstream sees the same shapes as before.
   TEMPORARY safety net: if /api/v1 is not served (e.g. the Pages build step is not configured yet) we fall back to
   the raw files at /data/api. Remove LEGACY once the API build is confirmed live in production. */
const API = '/api/v1';
const LEGACY = '/data/api';
const TFL = 'https://api.tfl.gov.uk';   // CORS-open, no key needed at browser rates

/* ── Data layer — one cached promise per endpoint ─────────────────────── */
const _cache = new Map();
function get(path){
  if(_cache.has(path)) return _cache.get(path);
  const getJson = url => fetch(url).then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
  const p = getJson(API + path + '.json').then(j => j?.meta?.version === 'v1' && 'data' in j ? j.data : j)
    .catch(() => getJson(LEGACY + path + '.json'))
    .catch(err => { console.warn('data', path, err.message); _cache.delete(path); return null; });
  _cache.set(path, p);
  return p;
}
/* Historical guard from the Atlas era ("Transport UK London Bus (RATP)") —
   the pipeline now canonicalises operator names, this is a no-op safety net. */
const fixOperator = o => o === 'Transport UK London Bus (RATP)' ? 'Transport UK London Bus' : o;
const fixOperatorDeep = d => d == null ? d : JSON.parse(JSON.stringify(d).replaceAll('Transport UK London Bus (RATP)', 'Transport UK London Bus'));
/* Live fetches align with the feed's refresh clock: payloads carry
   capturedAt, and Cache-Control's max-age is CORS-readable — so the next
   poll is scheduled just after the edge copy expires, instead of on our own
   drifting timer. */
function liveGet(url){
  return fetch(url).then(async x => {
    if(!x.ok) return null;
    const j = await x.json();
    const ma = /max-age=(\d+)/.exec(x.headers.get('cache-control') ?? '');
    if(j && typeof j === 'object') j._ttl = ma ? +ma[1] : null;
    return j;
  }).catch(() => null);
}
export function nextPollS(j, fallbackS){
  const ttl = Number.isFinite(j?._ttl) && j._ttl > 0 ? j._ttl : fallbackS;
  const cap = Date.parse(j?.capturedAt ?? '');
  if(!Number.isFinite(cap)) return fallbackS;
  const s = Math.round((cap + ttl*1000 + 1500 - Date.now()) / 1000);
  return Math.max(4, Math.min(ttl + fallbackS, s));   // stale edge → quick retry
}
/* TfL-direct live adapters — wrap TfL's CORS-open responses into the
   { data, capturedAt } envelope the consumers already read. */
const tflLive = (url) => liveGet(url).then(j => {
  if(j == null) return null;
  const arr = Array.isArray(j) ? j : [j];
  return { data: arr, capturedAt: new Date().toISOString(), _ttl: j?._ttl ?? arr?._ttl ?? null };
});
export const D = {
  routes:      () => get('/routes'),
  meta:        () => get('/route-meta').then(d => { const r = d?.routes ?? {}; for(const m of Object.values(r)) if(m?.operator) m.operator = fixOperator(m.operator); return r; }),
  garagesAll:  () => get('/garages').then(d => { const g = d?.garages ?? []; for(const x of g) if(x?.operator) x.operator = fixOperator(x.operator); return g; }),   // every garage on file, for direct links by code
  garages:     () => get('/garages').then(d => { const g = (d?.garages ?? []).filter(x => x?.routes?.length); for(const x of g) if(x?.operator) x.operator = fixOperator(x.operator); return g; }),   // a garage with no current routes is not on the network
  fleet:       () => get('/fleet').then(d => d?.byRoute ?? {}),
  crowding:    () => get('/crowding'),
  crowdProf:   () => get('/crowding-profile').then(d => d?.routes ?? {}),
  tenders:     () => get('/tenders').then(d => fixOperatorDeep(d?.byRoute ?? {})),
  diversions:  () => get('/route-diversions').then(d => d?.routes ?? {}),
  lineStatus:  () => get('/line-status'),
  manifest:    () => get('/manifest'),
  stops:       () => get('/route-stops').then(d => d?.routes ?? {}),      // ~1 MB gz — lazy, route detail only
  overview:    () => get('/routes-overview'),                              // GeoJSON — lazy, map only
  vehiclesReg: () => get('/vehicles').then(d => fixOperatorDeep(d?.byReg ?? {})),
  cpi:         () => get('/cpi-cpa'),
  tendersAll:  () => get('/tenders').then(d => fixOperatorDeep(Object.values(d?.byId ?? {}))),
  programme:   () => get('/tender-programme').then(d => (d?.entries ?? []).map(e => ({ ...e, sourceUrl: d?.sources?.[e.programmeYear] ?? null }))),
  divHistory:  () => get('/diversion-history'),                          // accumulated diversion notices, per status snapshot
  // DfT Street Manager permits/works, London HAs. The file is columnar
  // ({fields, enums, rows} — key names and repetitive categorical values
  // stored once) to keep 20k+ works light; decode back into the object
  // shape the page and map layer consume. Pre-columnar payloads pass through.
  streetworks: () => get('/streetworks-history').then(d => {
    if(!d?.rows || !d?.fields) return d;
    const TOP = new Set(['ref','ha','objectType','firstEvent','lastEvent','lastType','nEvents','coords']);
    const entries = d.rows.map(row => {
      const e = { latest: {} };
      d.fields.forEach((f, i) => {
        let v = row[i];
        if(d.enums?.[f]) v = (v >= 0 ? d.enums[f][v] : null);
        if(v == null) return;
        if(TOP.has(f)) e[f] = v; else e.latest[f] = v;
      });
      return e;
    });
    return { ...d, entries };
  }),
  dtro:        () => get('/dtro'),                                       // DfT D-TRO — statutory traffic regulation orders, bus-relevant, Greater London
  routePerf:   () => get('/route-performance'),                          // TfL QSI + mileage per period — may be absent while its crawler finishes
  schedMiles:  () => get('/scheduled-mileage'),                          // timetable-derived daily km — may be absent while its crawler finishes
  bridges:     () => get('/bridges').then(d => d?.bridges ?? []),        // static snapshot — TfL EPOWR height restrictions
  accidents:   () => get('/accidents').then(d => d ?? null),             // static snapshot — DfT STATS19, bus/coach-involved
  liveStatus:  (r) => tflLive(TFL + '/Line/' + encodeURIComponent(r) + '/Status'),                 // never cached — re-polled
  liveVehicles:(r) => liveGet('/api/live/vehicles?line=' + encodeURIComponent(r)),                 // BODS via our /api/live/vehicles endpoint
  arrivals:    (s) => tflLive(TFL + '/StopPoint/' + encodeURIComponent(s) + '/Arrivals'),          // never cached — polled
};
/* D-TRO regulation types arrive camelCased with a namespace prefix
   ("miscRoadClosure", "kerbsideNoWaiting") or as an authority's off-list id
   ("Barnet_X124") — prettify the former to plain words, keep ids verbatim. */
export const troPretty = t => /_/.test(String(t)) ? String(t)
  : title(String(t).replace(/^(misc|kerbside|bannedMovement|mandatoryDirection|movementOrder|dimension|nonOrderKerbside)/, '').replace(/([a-z])([A-Z])/g, '$1 $2'));
export const plate = (reg, link=true) => reg
  ? (link ? `<a class="plate" href="#/vehicle/${encodeURIComponent(String(reg).toUpperCase())}">${esc(String(reg).toUpperCase())}</a>`
          : `<span class="plate">${esc(String(reg).toUpperCase())}</span>`)
  : '';

/* Stop registry — every unique stop across all routes, derived once from
   route-stops: id → { name, lat, lng, lines:Set }. */
let _stopRegP = null;
export function stopRegistry(){
  return _stopRegP ??= D.stops().then(routes => {
    const reg = new Map();
    for(const [rid, rec] of Object.entries(routes ?? {})){
      for(const d of ['outbound','inbound']){
        for(const s of rec?.[d] ?? []){
          let e = reg.get(s.id);
          if(!e){ e = { id:s.id, name:s.name, lat:s.lat, lng:s.lng, letter:null, lines:new Set() }; reg.set(s.id, e); }
          // Flag letter — present on most entries; "->N"-style values are
          // TfL's unlettered compass markers, not display letters.
          if(!e.letter && s.letter && !String(s.letter).includes('->') && String(s.letter).trim().length <= 3)
            e.letter = String(s.letter).trim();
          for(const l of s.lines ?? []) e.lines.add(l);
          e.lines.add(rid.toUpperCase());
        }
      }
    }
    return reg;
  });
}
