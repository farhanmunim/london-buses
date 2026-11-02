/* Lazy datasets and corridor maths for the route brief. */
import { get } from '../data.js';
import { bounds, KX } from '../geometry.js';

/* ── lazy datasets + corridor maths for the route brief ──────────────────── */
const LZ = {};
const lazy = (k, url) => LZ[k] ??= get(url).catch(e => { delete LZ[k]; throw e; });
export const routeGeo = id => lazy('geo:' + id, `/data/routes/${encodeURIComponent(id)}.geojson`);
export const stopsData = () => lazy('stops', '/data/api/route-stops.json');
export const profileData = () => lazy('profile', '/data/api/crowding-profile.json');
const accData = () => lazy('acc', '/data/api/accidents.json');
const bridgeData = () => lazy('bridges', '/data/api/bridges.json');
export function runsOf(geo, dir){
  const feats = geo?.features ?? [], want = dir === 'outbound' ? '1' : '2';
  const use = feats.filter(f => String(f.properties?.direction) === want); const src = use.length ? use : feats;
  const runs = []; for(const f of src){ const g = f.geometry; if(g?.type === 'LineString') runs.push(g.coordinates); else if(g?.type === 'MultiLineString') runs.push(...g.coordinates); }
  return runs;
}
export const lenKm = runs => runs.reduce((t, run) => { for(let i = 1; i < run.length; i++){ const [x0, y0] = run[i - 1], [x1, y1] = run[i]; t += Math.hypot((x1 - x0) * KX, y1 - y0) * 111.32; } return t; }, 0);
function nearRuns(lon, lat, runs, maxM){
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 111320;
  for(const run of runs) for(let i = 1; i < run.length; i++){
    const ax = (run[i - 1][0] - lon) * kx, ay = (run[i - 1][1] - lat) * ky, bx = (run[i][0] - lon) * kx, by = (run[i][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 ? -(ax * dx + ay * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    if(Math.hypot(ax + t * dx, ay + t * dy) <= maxM) return true;
  }
  return false;
}
const CORR = new Map();
export async function corridor(r){
  if(CORR.has(r.id)) return CORR.get(r.id);
  const [geo, acc, br] = await Promise.all([routeGeo(r.id), accData().catch(() => null), bridgeData().catch(() => null)]);
  const runs = [...runsOf(geo, 'outbound'), ...runsOf(geo, 'inbound')], bb = bounds(runs.length ? runs : [[[0, 0]]]), pad = .002;
  const inBox = (lo, la) => lo >= bb.minLon - pad && lo <= bb.maxLon + pad && la >= bb.minLat - pad && la <= bb.maxLat + pad;
  const coll = (acc?.accidents ?? []).filter(a => inBox(a.lng, a.lat) && nearRuns(a.lng, a.lat, runs, 100));
  const bridges = (br?.bridges ?? []).filter(b => inBox(b.lng, b.lat) && nearRuns(b.lng, b.lat, runs, 25));
  const out = { coll, bridges, period:acc?.period ?? '2021–2025', ok:!!acc };
  CORR.set(r.id, out); return out;
}
