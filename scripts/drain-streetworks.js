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
import { wktToCoords } from './_lib/osgb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..');
const ACC_PATH = path.join(ROOT, 'data', 'source', 'streetworks-history.json');
const API_PATH = path.join(ROOT, 'data', 'api', 'streetworks-history.json');
const BRANCH   = 'streetworks-inbox';

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts }).trim();


// The full accumulator lives ON THE INBOX BRANCH (archive/…), not on
// main: at ~2k London events/day it crossed Cloudflare Pages' 25 MB
// per-file limit within a week of go-live and silently failed every
// deployment (2026-09-23 → -29). The inbox branch is never deployed, so
// it can hold the archive at any size; main only carries the compact
// served view. The old data/source copy remains readable as a one-time
// migration fallback.
const ARCHIVE_BRANCH = 'streetworks-archive';
const ARCHIVE_FILE = 'streetworks-history.json';
function loadAcc() {
  try {
    git(['fetch', 'origin', `${ARCHIVE_BRANCH}:refs/remotes/origin/${ARCHIVE_BRANCH}`, '--no-tags', '--force']);
    return JSON.parse(git(['show', `refs/remotes/origin/${ARCHIVE_BRANCH}:${ARCHIVE_FILE}`])).entries ?? {};
  } catch { /* branch has no archive yet — fall through to migration */ }
  try { return JSON.parse(fs.readFileSync(ACC_PATH, 'utf8')).entries ?? {}; }
  catch { return {}; }
}

// The archive branch has exactly one writer (this drain), so a plain
// parentless force push is race-free and keeps it at history depth 1.
function pushArchive(archiveJson, env) {
  const tmp = path.join(ROOT, '.git', 'streetworks-archive-tmp.json');
  fs.writeFileSync(tmp, archiveJson, 'utf8');
  const blob = git(['hash-object', '-w', tmp]);
  fs.unlinkSync(tmp);
  git(['read-tree', '--empty'], { env });
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},${ARCHIVE_FILE}`], { env });
  const tree = git(['write-tree'], { env });
  const commit = git(['commit-tree', tree, '-m', 'drain: streetworks archive snapshot [CI Skip]'], { env });
  git(['push', '--force', 'origin', `${commit}:refs/heads/${ARCHIVE_BRANCH}`]);
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

// Rolling archive: a work that ended more than 90 days ago (and has gone
// quiet) leaves the accumulator, or it grows without bound at ~2k London
// events/day.
function pruneEnded(entries) {
  const PRUNE = new Date(Date.now() - 90 * 864e5).toISOString();
  for (const [ref, e] of Object.entries(entries)) {
    const l = e.latest ?? {};
    const end = l.actual_end_date_time ?? l.proposed_end_date ?? l.end_date;
    if (end && end < PRUNE && String(e.lastEvent ?? '') < PRUNE) delete entries[ref];
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
function pushDeletions(paths) {
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
    // Folding a big backlog takes minutes, and events land every few
    // seconds — so the commit is built against a FRESH head each attempt,
    // keeping whatever arrived mid-fold, and only the paths we actually
    // processed are removed. With the archive on its own branch this
    // commit is tiny, so each attempt's fetch→tree→push window is around
    // a second; 20 attempts reliably finds a gap in the event stream.
    for (let attempt = 1; attempt <= 20; attempt++) {
      git(['fetch', 'origin', `${BRANCH}:refs/remotes/origin/${BRANCH}`, '--no-tags', '--force']);
      const head = git(['rev-parse', `refs/remotes/origin/${BRANCH}`]);
      git(['read-tree', head], { env });
      for (let i = 0; i < paths.length; i += 500) {
        git(['rm', '--cached', '--ignore-unmatch', '--quiet', '--', ...paths.slice(i, i + 500)], { env });
      }
      const tree = git(['write-tree'], { env });
      const commit = git(['commit-tree', tree, '-m', `drain: remove ${paths.length} folded streetworks events [CI Skip]`], { env });
      try {
        git(['push', `--force-with-lease=refs/heads/${BRANCH}:${head}`, 'origin', `${commit}:refs/heads/${BRANCH}`]);
        return true;
      } catch { /* lease failed — an event landed in the window; go again */ }
    }
    return false;
  } finally {
    try { fs.unlinkSync(env.GIT_INDEX_FILE); } catch { /* already gone */ }
  }
}

function main() {
  // Fetch the inbox branch; absent = nothing ever received = soft skip.
  try { git(['fetch', 'origin', `${BRANCH}:refs/remotes/origin/${BRANCH}`, '--no-tags']); }
  catch { console.log(`No ${BRANCH} branch on origin (no events received yet) — skipped.`); return; }

  const entries = loadAcc();
  let drainedTotal = 0, archivePushed = false;

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

  for (const f of files) {
    try { fold(entries, JSON.parse(git(['show', `${head}:${f}`]))); }
    catch { console.warn(`  unreadable inbox file skipped: ${f}`); }
  }
  drainedTotal = files.length;

  // WGS84 coordinates from the latest payload's BNG WKT — recomputed
  // before serialising, so the branch archive and served view agree.
  for (const e of Object.values(entries))
    e.coords = wktToCoords(e.latest?.works_location_coordinates ?? e.latest?.activity_coordinates
      ?? e.latest?.section_58_coordinates ?? e.latest?.coordinates) ?? e.coords ?? null;

  pruneEnded(entries);
  const archiveJson = JSON.stringify(sanitizeRecord({ generatedAt: new Date().toISOString(), entries }));
  let branchArchive = null;
  try { branchArchive = git(['show', `refs/remotes/origin/${ARCHIVE_BRANCH}:${ARCHIVE_FILE}`]); } catch { /* absent */ }
  const archiveMoved = branchArchive == null
    || JSON.stringify({ ...JSON.parse(branchArchive), generatedAt: null }) !== JSON.stringify({ ...JSON.parse(archiveJson), generatedAt: null });

  const identEnv = {
    ...process.env,
    GIT_INDEX_FILE: path.join(ROOT, '.git', 'streetworks-archive-index'),
    GIT_AUTHOR_NAME: 'github-actions[bot]',
    GIT_AUTHOR_EMAIL: 'github-actions[bot]@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'github-actions[bot]',
    GIT_COMMITTER_EMAIL: 'github-actions[bot]@users.noreply.github.com',
  };
  if (archiveMoved) {
    try { pushArchive(archiveJson, identEnv); archivePushed = true; }
    catch (e) { console.error(`archive push failed: ${String(e.message).slice(0, 200)}`); }
    finally { try { fs.unlinkSync(identEnv.GIT_INDEX_FILE); } catch { /* gone */ } }
  } else { archivePushed = true; }

  if (!files.length && !staleLogs.length) {
    console.log('Inbox empty — nothing to delete.');
  } else if (!pushDeletions([...files, ...staleLogs])) {
    console.log('Inbox deletion push rejected 20× (heavy inflow) — folded anyway; deletions retry next drain.');
  }

  console.log(`Drained ${drainedTotal} events; archive now holds ${Object.keys(entries).length} works`);
  if (!drainedTotal && !Object.keys(entries).length) return;   // nothing yet — write nothing

  if (!archivePushed && drainedTotal)
    console.log('Note: archive update not pushed this run (lease contention) — refolded next drain.');

  const nowIso = new Date().toISOString();

  // Served view: the full archive crossed 20k works (~40 MB with verbatim
  // payloads) within a week of go-live — far too heavy for the browser.
  // Serve a compact projection (only the fields the Street works page and
  // the route-map layer read) of CURRENT works: window still open, or ended
  // / last heard from within the last 14 days. The complete archive stays
  // in data/source for analysis.
  const CUTOFF = new Date(Date.now() - 14 * 864e5).toISOString();
  const KEEP = ['work_reference_number', 'street_name', 'town', 'area_name',
    'promoter_organisation', 'highway_authority', 'work_category',
    'traffic_management_type', 'work_status', 'permit_status',
    'is_traffic_sensitive', 'activity_type', 'activity_name',
    'activity_location_type', 'activity_location_description',
    'proposed_start_date', 'proposed_end_date',
    'actual_start_date_time', 'actual_end_date_time', 'start_date', 'end_date'];
  const list = Object.entries(entries).map(([ref, e]) => ({ ref, ...e }))
    .filter(e => {
      const l = e.latest ?? {};
      const end = l.actual_end_date_time ?? l.proposed_end_date ?? l.end_date;
      return (!end || end >= CUTOFF) && String(e.lastEvent ?? '') >= '2026';
    })
    .map(e => ({
      ref: e.ref, ha: e.ha, objectType: e.objectType,
      firstEvent: e.firstEvent, lastEvent: e.lastEvent,
      lastType: (e.events ?? [])[e.events.length - 1]?.type ?? null,
      nEvents: (e.events ?? []).length,
      coords: e.coords ? e.coords.filter((_, i, a) => a.length <= 12 || i % Math.ceil(a.length / 12) === 0) : null,
      latest: Object.fromEntries(KEEP.filter(k => e.latest?.[k] != null)
        .map(k => [k, typeof e.latest[k] === 'string' ? e.latest[k].slice(0, 140) : e.latest[k]])),
    }))
    .sort((a, b) => String(b.lastEvent).localeCompare(String(a.lastEvent)));

  // Columnar encoding: at 20k+ rows the object form spends nearly half its
  // bytes repeating key names, and the categorical columns (borough,
  // promoter, category, status…) repeat a handful of values thousands of
  // times. Emit {fields, enums, rows}: each row is an array in field order,
  // and enum-listed columns store an index into their value table (-1 =
  // null). The app's data layer (D.streetworks) decodes this back into the
  // object shape the page and map layer consume — change one, change both.
  const FIELDS = ['ref', 'ha', 'objectType', 'firstEvent', 'lastEvent', 'lastType', 'nEvents', 'coords', ...KEEP];
  const ENUM_COLS = new Set(['ha', 'objectType', 'lastType', 'town', 'area_name',
    'promoter_organisation', 'highway_authority', 'work_category',
    'traffic_management_type', 'work_status', 'permit_status',
    'is_traffic_sensitive', 'activity_type', 'activity_location_type']);
  const enums = {}, enumIdx = {};
  for (const c of ENUM_COLS) { enums[c] = []; enumIdx[c] = new Map(); }
  const enc = (col, v) => {
    if (v == null) return ENUM_COLS.has(col) ? -1 : null;
    if (!ENUM_COLS.has(col)) return v;
    let i = enumIdx[col].get(v);
    if (i === undefined) { i = enums[col].length; enums[col].push(v); enumIdx[col].set(v, i); }
    return i;
  };
  const rows = list.map(e => FIELDS.map(f =>
    enc(f, f in e ? e[f] : (e.latest?.[f] ?? null))));
  writeStable(API_PATH, sanitizeRecord({
    generatedAt: nowIso,
    source: 'DfT Street Manager open data (SNS → Pages Function → streetworks-inbox branch → this archive), London highway authorities only',
    note: 'Current and recently-ended works (14-day window), columnar-encoded; the complete archive lives in data/source/streetworks-history.json.',
    totalArchived: Object.keys(entries).length,
    count: rows.length,
    fields: FIELDS,
    enums,
    rows,
  }));
}

main();
