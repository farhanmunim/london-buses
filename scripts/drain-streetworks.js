/**
 * drain-streetworks.js — Fold Street Manager events from the inbox branch
 * into the committed archive.
 *
 * Counterpart of functions/api/streetworks.js: the Pages Function receives
 * London-filtered Street Manager SNS events and commits each one as
 * inbox/<MessageId>.json on the dedicated `streetworks-inbox` branch (git
 * IS the queue — no external storage). This script (status workflow +
 * nightly) folds those files into the archive, then pushes a commit to the
 * inbox branch that deletes the processed files.
 *
 * Concurrency safety: the deletion commit carries the fetched head's tree
 * minus the processed files and is pushed with --force-with-lease pinned
 * to that head (server-side compare-and-swap) — if a new event lands
 * mid-drain the push is rejected, and we refetch and rebuild (up to 3
 * attempts; on the third rejection the deletions simply wait for the next
 * drain — events are only ever deleted after they are folded, so nothing
 * can be lost). The commit is parentless, so the branch stays at history
 * depth 1 instead of accreting one commit per received event.
 *
 * Requirements: a git remote with push rights to the inbox branch — true
 * in GitHub Actions (the workflow already pushes data commits) and in any
 * local clone with credentials. No inbox branch yet (nothing ever
 * received) is a soft skip.
 *
 * Archive model (schema-tolerant on purpose — Street Manager payload
 * shapes are only fully knowable once real events flow): entries are keyed
 * by the work/permit reference; each keeps the highway authority, first
 * and last event times, a compact event trail [{type, time}], and the
 * LATEST object_data payload verbatim. A corridor join to bus routes (as
 * fetch-roadworks.js does for TIMS) is a follow-up; real payloads carry
 * works_location_coordinates as WKT in British National Grid (EPSG:27700
 * easting/northing), so the join needs an OSGB36→WGS84 conversion first.
 *
 * Outputs:
 *   data/source/streetworks-history.json  (accumulator, force-committed)
 *   data/api/streetworks-history.json     (served view)
 *
 * Run: npm run drain-streetworks
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { sanitizeRecord } from './_lib/sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..');
const ACC_PATH = path.join(ROOT, 'data', 'source', 'streetworks-history.json');
const API_PATH = path.join(ROOT, 'data', 'api', 'streetworks-history.json');
const BRANCH   = 'streetworks-inbox';

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts }).trim();

/* ── OSGB36 grid → WGS84 ────────────────────────────────────────────────
   Street Manager coordinates are WKT in British National Grid (EPSG:27700
   easting/northing). Convert here, once, at drain time, so the archive —
   and the site's map layers — carry plain [lat, lng]. Inverse transverse
   Mercator on Airy 1830, then the standard OSTN-less Helmert shift to
   WGS84 (~5 m accuracy — fine for showing works on a bus-route map). */
function osgbToWgs84(E, N){
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717;
  const lat0 = 49 * Math.PI/180, lon0 = -2 * Math.PI/180, N0 = -100000, E0 = 400000;
  const e2 = 1 - (b*b)/(a*a), n = (a-b)/(a+b), n2 = n*n, n3 = n2*n;
  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a*F0) + lat;
    M = b*F0*((1 + n + 1.25*n2 + 1.25*n3) * (lat - lat0)
      - (3*n + 3*n2 + 2.625*n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0)
      + (1.875*n2 + 1.875*n3) * Math.sin(2*(lat - lat0)) * Math.cos(2*(lat + lat0))
      - (35/24)*n3 * Math.sin(3*(lat - lat0)) * Math.cos(3*(lat + lat0)));
  } while (Math.abs(N - N0 - M) >= 1e-5);
  const sinL = Math.sin(lat), cosL = Math.cos(lat), tanL = Math.tan(lat);
  const nu = a*F0 / Math.sqrt(1 - e2*sinL*sinL);
  const rho = a*F0*(1 - e2) * Math.pow(1 - e2*sinL*sinL, -1.5);
  const eta2 = nu/rho - 1, t2 = tanL*tanL, t4 = t2*t2;
  const dE = E - E0, dE2 = dE*dE;
  const latOS = lat - (tanL/(2*rho*nu))*dE2
    + (tanL/(24*rho*nu**3))*(5 + 3*t2 + eta2 - 9*t2*eta2)*dE2*dE2
    - (tanL/(720*rho*nu**5))*(61 + 90*t2 + 45*t4)*dE2*dE2*dE2;
  const lonOS = lon0 + (dE/(cosL*nu))
    - (dE*dE2/(cosL*6*nu**3))*(nu/rho + 2*t2)
    + (dE*dE2*dE2/(cosL*120*nu**5))*(5 + 28*t2 + 24*t4);
  // Helmert OSGB36 → WGS84 via cartesian coordinates.
  const H = 0, sinP = Math.sin(latOS), cosP = Math.cos(latOS);
  const nu2 = a / Math.sqrt(1 - e2*sinP*sinP);
  let x = (nu2 + H)*cosP*Math.cos(lonOS), y = (nu2 + H)*cosP*Math.sin(lonOS), z = ((1 - e2)*nu2 + H)*sinP;
  const tx = 446.448, ty = -125.157, tz = 542.060, s = -20.4894e-6;
  const rx = 0.1502/3600*Math.PI/180, ry = 0.2470/3600*Math.PI/180, rz = 0.8421/3600*Math.PI/180;
  const x2 = tx + (1+s)*x - rz*y + ry*z, y2 = ty + rz*x + (1+s)*y - rx*z, z2 = tz - ry*x + rx*y + (1+s)*z;
  // Back to geodetic on WGS84.
  const aW = 6378137, e2W = 6.69437999014e-3;
  const p = Math.sqrt(x2*x2 + y2*y2);
  let phi = Math.atan2(z2, p*(1 - e2W)), phi0;
  do {
    phi0 = phi;
    const nuW = aW / Math.sqrt(1 - e2W*Math.sin(phi)*Math.sin(phi));
    phi = Math.atan2(z2 + e2W*nuW*Math.sin(phi), p);
  } while (Math.abs(phi - phi0) > 1e-11);
  return [Math.round(phi*180/Math.PI * 1e5)/1e5, Math.round(Math.atan2(y2, x2)*180/Math.PI * 1e5)/1e5];
}

// WKT (LINESTRING/POINT/POLYGON, BNG) → [[lat,lng],…], null when absent.
function wktToCoords(wkt){
  const nums = String(wkt ?? '').match(/-?\d+(\.\d+)?\s+-?\d+(\.\d+)?/g);
  if (!nums?.length) return null;
  const out = nums.slice(0, 60).map(pair => {           // cap pathological polygons
    const [E, N] = pair.trim().split(/\s+/).map(Number);
    return osgbToWgs84(E, N);
  }).filter(([la, ln]) => la > 49 && la < 56 && ln > -2.5 && ln < 2.5);
  return out.length ? out : null;
}

function loadAcc() {
  try { return JSON.parse(fs.readFileSync(ACC_PATH, 'utf8')).entries ?? {}; }
  catch { return {}; }
}

const stable = (o) => JSON.stringify({ ...o, generatedAt: null });
function writeStable(p, obj) {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* first run */ }
  if (!prev || stable(prev) !== stable(obj)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
  }
}

function fold(entries, row) {
  let inner = {};
  try { inner = JSON.parse(row.message); } catch { /* keep raw below */ }
  const ref = inner.object_reference ?? inner.work_reference_number ?? inner.event_reference ?? row.messageId;
  const time = inner.event_time ?? row.receivedAt;
  const e = entries[ref] ??= {
    ha: row.ha, objectType: inner.object_type ?? null,
    firstEvent: time, lastEvent: time, events: [],
  };
  if (time < e.firstEvent) e.firstEvent = time;
  if (time > e.lastEvent) { e.lastEvent = time; e.latest = inner.object_data ?? inner; }
  e.latest ??= inner.object_data ?? inner;
  e.ha = row.ha ?? e.ha;
  // Same (type, time) already in the trail = a duplicate delivery — SNS
  // redelivery, or this drain's own retry loop refolding files after a
  // rejected deletion push.
  const type = inner.event_type ?? null;
  if (!e.events.some(x => x.type === type && x.time === time)) {
    e.events.push({ type, time });
    e.events.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    if (e.events.length > 200) e.events = e.events.slice(-200); // cap pathological churn
  }
}

// Push a commit deleting `paths` from the inbox branch. The commit is
// PARENTLESS but carries head's tree minus the processed files, and is
// pushed with --force-with-lease pinned to the exact head we folded — an
// atomic compare-and-swap at the server. This keeps the inbox branch at
// history depth 1 forever (at ~thousands of events/day, per-event commits
// would otherwise pile up ~1M commits/year) while losing nothing: an event
// landing mid-drain moves the ref, the lease fails the push, and the
// caller refetches and retries. Uses plumbing only, so the main worktree
// is untouched.
function pushDeletions(head, paths) {
  const env = {
    ...process.env,
    GIT_INDEX_FILE: path.join(ROOT, '.git', 'streetworks-drain-index'),
    // commit-tree needs an ident; in Actions this script runs BEFORE the
    // workflow's own `git config user.*` step, so carry one ourselves
    // (same bot identity the workflow's data commits use).
    GIT_AUTHOR_NAME: 'github-actions[bot]',
    GIT_AUTHOR_EMAIL: 'github-actions[bot]@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'github-actions[bot]',
    GIT_COMMITTER_EMAIL: 'github-actions[bot]@users.noreply.github.com',
  };
  try {
    git(['read-tree', head], { env });
    // Remove in chunks to stay clear of argv limits.
    for (let i = 0; i < paths.length; i += 500) {
      git(['update-index', '--force-remove', '--', ...paths.slice(i, i + 500)], { env });
    }
    const tree = git(['write-tree'], { env });
    const commit = git(['commit-tree', tree, '-m', `drain: fold ${paths.length} streetworks events into archive [CI Skip]`], { env });
    try {
      git(['push', `--force-with-lease=refs/heads/${BRANCH}:${head}`, 'origin', `${commit}:refs/heads/${BRANCH}`]);
      return true;
    } catch { return false; }                       // lease failed — new events landed, retry
  } finally {
    try { fs.unlinkSync(env.GIT_INDEX_FILE); } catch { /* already gone */ }
  }
}

function main() {
  // Fetch the inbox branch; absent = nothing ever received = soft skip.
  try { git(['fetch', 'origin', `${BRANCH}:refs/remotes/origin/${BRANCH}`, '--no-tags']); }
  catch { console.log(`No ${BRANCH} branch on origin (no events received yet) — skipped.`); return; }

  const entries = loadAcc();
  let drainedTotal = 0;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const head = git(['rev-parse', `refs/remotes/origin/${BRANCH}`]);
    const files = git(['ls-tree', '-r', '--name-only', head, '--', 'inbox/'])
      .split('\n').filter(f => f.endsWith('.json'));
    // Breadcrumb log files (function observability) ride along: print the
    // recent ones so delivery problems surface in the workflow log, and
    // delete any older than 48 h with the same commit.
    const logs = git(['ls-tree', '-r', '--name-only', head, '--', 'log/'])
      .split('\n').filter(Boolean);
    const staleLogs = [];
    for (const f of logs) {
      try {
        const j = JSON.parse(git(['show', `${head}:${f}`]));
        const ageH = (Date.now() - Date.parse(j.at)) / 36e5;
        if (ageH < 6) console.log(`  [receiver] ${j.at} ${j.verdict} (${j.type ?? '?'} ${j.topicArn ?? ''})`);
        if (ageH > 48) staleLogs.push(f);
      } catch { staleLogs.push(f); }
    }
    if (!files.length && !staleLogs.length) { console.log('Inbox empty — nothing to drain.'); break; }

    for (const f of files) {
      try { fold(entries, JSON.parse(git(['show', `${head}:${f}`]))); }
      catch { console.warn(`  unreadable inbox file skipped: ${f}`); }
    }
    drainedTotal += files.length;

    if (pushDeletions(head, [...files, ...staleLogs])) break;
    if (attempt === 3) {
      console.log('Inbox deletion push rejected 3× (heavy inflow) — folded anyway; deletions retry next drain.');
      break;
    }
    git(['fetch', 'origin', `${BRANCH}:refs/remotes/origin/${BRANCH}`, '--no-tags', '--force']);
  }

  console.log(`Drained ${drainedTotal} events; archive now holds ${Object.keys(entries).length} works`);
  if (!drainedTotal && !Object.keys(entries).length) return;   // nothing yet — write nothing

  // WGS84 coordinates from the latest payload's BNG WKT — recomputed at
  // every write, so entries archived before this existed backfill too.
  for (const e of Object.values(entries))
    e.coords = wktToCoords(e.latest?.works_location_coordinates ?? e.latest?.activity_coordinates
      ?? e.latest?.section_58_coordinates ?? e.latest?.coordinates) ?? e.coords ?? null;

  const nowIso = new Date().toISOString();
  writeStable(ACC_PATH, sanitizeRecord({ generatedAt: nowIso, entries }));
  const list = Object.entries(entries).map(([ref, e]) => ({ ref, ...e }))
    .sort((a, b) => String(b.lastEvent).localeCompare(String(a.lastEvent)));
  writeStable(API_PATH, sanitizeRecord({
    generatedAt: nowIso,
    source: 'DfT Street Manager open data (SNS → Pages Function → streetworks-inbox branch → this archive), London highway authorities only',
    count: list.length,
    entries: list,
  }));
}

main();
