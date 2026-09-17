/**
 * fetch-roadworks.js — Live roadworks affecting bus routes + rolling history.
 *
 * Source: TfL Unified API /Road/all/Disruption — the TIMS feed from TfL's
 * 24/7 traffic control centre (same data as the London Datastore "live
 * traffic disruptions"). Free, keyless, updated ~5-minutely. Carries every
 * disruption TfL is managing: Works (utility / TfL / borough /
 * collaborative), hazards, network delays — with point geometry, severity,
 * status, stated start/end and running commentary. ~120-130 live at any
 * time, the large majority Works.
 *
 * Coverage note (documented, not hidden): TIMS covers the TfL Road Network
 * plus whatever else the control centre is actively managing — it is NOT
 * the statutory record of every hole in every borough road. That record is
 * DfT Street Manager open data (free registration + credentialed pull API)
 * — see data.md for the upgrade path. TIMS is the best keyless live source
 * and catches nearly everything big enough to divert a bus.
 *
 * Route join: each disruption point is matched to every route whose
 * geometry passes within JOIN_METRES of it (bbox prefilter via
 * data/api/route-bboxes.json, then exact point-to-segment distance on
 * data/routes/<id>.geojson). That turns "roadworks somewhere" into
 * "roadworks on the 53's corridor" — the thing that explains a diversion
 * or lost mileage.
 *
 * Outputs:
 *   data/api/roadworks.json            — current snapshot, route-joined.
 *   data/source/roadworks-history.json — rolling archive (same accumulate
 *     pattern as diversion-history: identity = TIMS id; first/last seen,
 *     observed days, latest fields). Force-committed.
 *   data/api/roadworks-history.json    — served view of the archive.
 *
 * Run: npm run fetch-roadworks   (add --seed to replay committed snapshots
 * of data/api/roadworks.json from git once history exists)
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { fetchWithTimeout, userAgentHeaders } from './_lib/http.js';
import { sanitizeRecord } from './_lib/sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const API_SNAP  = path.join(ROOT, 'data', 'api', 'roadworks.json');
const ACC_PATH  = path.join(ROOT, 'data', 'source', 'roadworks-history.json');
const API_HIST  = path.join(ROOT, 'data', 'api', 'roadworks-history.json');
const SCRIPT    = 'roadworks';
const JOIN_METRES = 30;

// ── Geometry: point-to-route distance ───────────────────────────────────────
// Equirectangular metres — fine at 30 m tolerances over London.
const M_PER_DEG_LAT = 111_320;
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180);

function pointSegDistM(px, py, ax, ay, bx, by, kx) {
  // scale lon by kx (m/deg), lat by M_PER_DEG_LAT
  const P = [px * kx, py * M_PER_DEG_LAT], A = [ax * kx, ay * M_PER_DEG_LAT], B = [bx * kx, by * M_PER_DEG_LAT];
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = A[0] + t * dx, qy = A[1] + t * dy;
  return Math.hypot(P[0] - qx, P[1] - qy);
}

function loadRouteGeometries() {
  const bboxes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'api', 'route-bboxes.json'), 'utf8')).routes;
  const geoms = new Map();
  for (const id of Object.keys(bboxes)) {
    try {
      const gj = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'routes', `${id}.geojson`), 'utf8'));
      const runs = [];
      for (const f of (gj.features ?? [])) {
        const g = f.geometry;
        if (g?.type === 'LineString') runs.push(g.coordinates);
        else if (g?.type === 'MultiLineString') runs.push(...g.coordinates);
      }
      if (runs.length) geoms.set(id, { bbox: bboxes[id], runs });
    } catch { /* no geometry for this route */ }
  }
  return geoms;
}

function routesNear(lon, lat, geoms) {
  const pad = JOIN_METRES * 1.5;
  const kx = mPerDegLon(lat);
  const dLon = pad / kx, dLat = pad / M_PER_DEG_LAT;
  const hits = [];
  for (const [id, { bbox, runs }] of geoms) {
    // bbox = [w, s, e, n] (already padded upstream, but re-pad for safety)
    const [w, s, e, n] = Array.isArray(bbox) ? bbox : [bbox.w, bbox.s, bbox.e, bbox.n];
    if (lon < w - dLon || lon > e + dLon || lat < s - dLat || lat > n + dLat) continue;
    let best = Infinity;
    for (const run of runs) {
      for (let i = 1; i < run.length && best > JOIN_METRES; i++) {
        const d = pointSegDistM(lon, lat, run[i - 1][0], run[i - 1][1], run[i][0], run[i][1], kx);
        if (d < best) best = d;
      }
      if (best <= JOIN_METRES) break;
    }
    if (best <= JOIN_METRES) hits.push(id);
  }
  return hits.sort();
}

// ── Fetch + shape ───────────────────────────────────────────────────────────
async function fetchDisruptions() {
  const res = await fetchWithTimeout('https://api.tfl.gov.uk/Road/all/Disruption', { headers: userAgentHeaders(SCRIPT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim() || null;

function shape(d, geoms) {
  let lon = null, lat = null;
  try { [lon, lat] = JSON.parse(d.point); } catch { /* no point */ }
  return {
    id: d.id,
    category: norm(d.category),
    subCategory: norm(d.subCategory),
    severity: norm(d.severity),
    status: norm(d.status),
    location: norm(d.location),
    comments: norm(d.comments),
    currentUpdate: norm(d.currentUpdate),
    startDateTime: d.startDateTime ?? null,
    endDateTime: d.endDateTime ?? null,
    lastModifiedTime: d.lastModifiedTime ?? null,
    hasClosures: d.hasClosures === true || d.hasClosures === 'True',
    isProvisional: d.isProvisional === true || d.isProvisional === 'True',
    lon, lat,
    routes: (lon != null && lat != null) ? routesNear(lon, lat, geoms) : [],
  };
}

// ── History accumulator (same pattern as build-diversion-history.js) ───────
function loadAcc() {
  try {
    const j = JSON.parse(fs.readFileSync(ACC_PATH, 'utf8'));
    return { entries: j.entries ?? {}, snapshots: new Set(j.snapshots ?? []) };
  } catch { return { entries: {}, snapshots: new Set() }; }
}

function mergeSnapshot(acc, items, seenAt) {
  if (!seenAt || acc.snapshots.has(seenAt)) return;
  acc.snapshots.add(seenAt);
  const day = seenAt.slice(0, 10);
  for (const d of items) {
    const e = acc.entries[d.id] ??= {
      firstSeen: seenAt, lastSeen: seenAt, observations: 0, days: [],
    };
    // Keep the latest statement of every descriptive field.
    Object.assign(e, {
      category: d.category, subCategory: d.subCategory, severity: d.severity,
      status: d.status, location: d.location, comments: d.comments,
      startDateTime: d.startDateTime, endDateTime: d.endDateTime,
      hasClosures: d.hasClosures, lon: d.lon, lat: d.lat, routes: d.routes,
    });
    if (seenAt < e.firstSeen) e.firstSeen = seenAt;
    if (seenAt > e.lastSeen)  e.lastSeen  = seenAt;
    e.observations++;
    if (!e.days.includes(day)) { e.days.push(day); e.days.sort(); }
  }
}

function seedFromGit(acc, geoms) {
  const seen = new Set();
  let commits = 0;
  for (const ref of ['origin/main', 'HEAD']) {
    let hashes = [];
    try {
      hashes = execFileSync('git', ['log', '--format=%H', ref, '--', 'data/api/roadworks.json'],
                            { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    } catch { continue; }
    for (const h of hashes) {
      if (seen.has(h)) continue;
      seen.add(h);
      try {
        const snap = JSON.parse(execFileSync('git', ['show', `${h}:data/api/roadworks.json`],
                                             { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
        mergeSnapshot(acc, snap.disruptions ?? [], snap.generatedAt ?? null);
        commits++;
      } catch { /* unreadable snapshot */ }
    }
  }
  console.log(`  seed: replayed ${commits} committed snapshots from git`);
}

const stable = (o) => JSON.stringify({ ...o, generatedAt: null });
function writeStable(p, obj) {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* first run */ }
  if (!prev || stable(prev) !== stable(obj)) fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
}

async function main() {
  const geoms = loadRouteGeometries();
  console.log(`  ${geoms.size} route geometries loaded for the corridor join`);
  const raw = await fetchDisruptions();
  const nowIso = new Date().toISOString();
  const disruptions = raw.map(d => shape(d, geoms))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const withRoutes = disruptions.filter(d => d.routes.length);
  console.log(`  ${disruptions.length} live disruptions (${disruptions.filter(d => d.category === 'Works').length} works), ${withRoutes.length} within ${JOIN_METRES} m of a bus route`);

  writeStable(API_SNAP, sanitizeRecord({
    generatedAt: nowIso,
    source: 'TfL Unified API /Road/all/Disruption (TIMS)',
    joinMetres: JOIN_METRES,
    count: disruptions.length,
    disruptions,
  }));

  const acc = loadAcc();
  if (process.argv.includes('--seed')) seedFromGit(acc, geoms);
  mergeSnapshot(acc, disruptions, nowIso);
  const snapshots = [...acc.snapshots].sort();
  const newest = snapshots[snapshots.length - 1] ?? null;

  writeStable(ACC_PATH, sanitizeRecord({ generatedAt: nowIso, snapshots, entries: acc.entries }));
  const entryList = Object.entries(acc.entries).map(([id, e]) => ({
    id, ...e, active: newest != null && e.lastSeen === newest,
  })).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || String(a.id).localeCompare(String(b.id)));
  writeStable(API_HIST, sanitizeRecord({
    generatedAt: nowIso,
    source: 'TfL /Road/all/Disruption (TIMS), accumulated per status refresh',
    firstObservedAt: snapshots[0] ?? null,
    lastObservedAt: newest,
    snapshotCount: snapshots.length,
    count: entryList.length,
    entries: entryList,
  }));
  console.log(`  history: ${entryList.length} entries across ${snapshots.length} snapshots`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
