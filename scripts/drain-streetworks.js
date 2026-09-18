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
  const env = { ...process.env, GIT_INDEX_FILE: path.join(ROOT, '.git', 'streetworks-drain-index') };
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
