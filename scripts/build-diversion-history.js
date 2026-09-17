/**
 * build-diversion-history.js — Rolling archive of bus route diversions.
 *
 * Why: TfL's Unified API only ever serves CURRENT disruptions — once a
 * diversion clears it vanishes from every public feed, so when lost
 * mileage is being explained after a period ends there is no record of
 * what was diverted, when, or why. No reputable public archive exists
 * (checked: London Datastore, bus.data.tfl.gov.uk, third-party live
 * mirrors). This script builds one from data we already collect: every
 * status refresh commits data/api/route-diversions.json (~5-8 snapshots a
 * day), and each snapshot's disruptions carry route, category
 * (PlannedWork / Event = scheduled, RealTime = unscheduled), the stated
 * since/until window, and the full reason text.
 *
 * Modes:
 *   node scripts/build-diversion-history.js          — merge the CURRENT
 *     data/api/route-diversions.json snapshot into the accumulator (run
 *     after fetch-line-status.js in the status workflow and the nightly).
 *   node scripts/build-diversion-history.js --seed   — additionally replay
 *     every historical snapshot of data/api/route-diversions.json from git
 *     (origin/main + HEAD), so the archive starts from the oldest committed
 *     snapshot rather than today. Idempotent — safe to re-run.
 *
 * Identity: a diversion is (route, category, normalised reason text). The
 * same roadworks re-observed across snapshots extends lastSeen/days; any
 * change to the reason text (TfL edits dates in the text when works are
 * extended) starts a new entry — deliberate, since the edit itself is
 * part of the history.
 *
 * Outputs:
 *   data/source/diversion-history.json — the accumulator (force-committed,
 *     grows over time; content-stable write).
 *   data/api/diversion-history.json    — the served view: entries sorted
 *     by lastSeen desc with a per-entry observed-days list, plus summary
 *     counts. `active` = present in the newest merged snapshot.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { sanitizeRecord } from './_lib/sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const SNAP_PATH = path.join(ROOT, 'data', 'api', 'route-diversions.json');
const ACC_PATH  = path.join(ROOT, 'data', 'source', 'diversion-history.json');
const API_PATH  = path.join(ROOT, 'data', 'api', 'diversion-history.json');

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const keyOf = (route, category, reason) =>
  route + '|' + crypto.createHash('sha1').update(category + '|' + norm(reason)).digest('hex').slice(0, 12);

function loadAccumulator() {
  try {
    const j = JSON.parse(fs.readFileSync(ACC_PATH, 'utf8'));
    return { entries: j.entries ?? {}, snapshots: new Set(j.snapshots ?? []) };
  } catch {
    return { entries: {}, snapshots: new Set() };
  }
}

// Merge one route-diversions snapshot (parsed JSON) observed at `seenAt`.
function mergeSnapshot(acc, snap, seenAt) {
  if (!snap?.routes || !seenAt) return 0;
  if (acc.snapshots.has(seenAt)) return 0;           // already merged
  acc.snapshots.add(seenAt);
  const day = seenAt.slice(0, 10);
  let touched = 0;
  for (const [route, rec] of Object.entries(snap.routes)) {
    for (const d of (rec.disruptions ?? [])) {
      const category = norm(d.category) || 'Unknown';
      const reason   = norm(d.reason);
      if (!reason) continue;
      const key = keyOf(route.toUpperCase(), category, reason);
      const e = acc.entries[key] ??= {
        route: route.toUpperCase(),
        category,
        reason,
        since: d.since ?? null,
        until: d.until ?? null,
        firstSeen: seenAt,
        lastSeen: seenAt,
        observations: 0,
        days: [],
      };
      // The stated window can gain precision between snapshots — keep the
      // latest non-null statement.
      if (d.since) e.since = d.since;
      if (d.until) e.until = d.until;
      if (seenAt < e.firstSeen) e.firstSeen = seenAt;
      if (seenAt > e.lastSeen)  e.lastSeen  = seenAt;
      e.observations++;
      if (!e.days.includes(day)) { e.days.push(day); e.days.sort(); }
      touched++;
    }
  }
  return touched;
}

// Replay every committed snapshot of route-diversions.json from git.
function seedFromGit(acc) {
  const refs = ['origin/main', 'HEAD'];
  const seen = new Set();
  let merged = 0, commits = 0;
  for (const ref of refs) {
    let hashes = [];
    try {
      hashes = execFileSync('git', ['log', '--format=%H', ref, '--', 'data/api/route-diversions.json'],
                            { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    } catch { continue; }                            // ref missing (shallow clone)
    for (const h of hashes) {
      if (seen.has(h)) continue;
      seen.add(h);
      let snap;
      try {
        snap = JSON.parse(execFileSync('git', ['show', `${h}:data/api/route-diversions.json`],
                                       { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
      } catch { continue; }
      commits++;
      merged += mergeSnapshot(acc, snap, snap.generatedAt ?? snap.capturedAt ?? null);
    }
  }
  console.log(`  seed: replayed ${commits} committed snapshots from git`);
  return merged;
}

function main() {
  const acc = loadAccumulator();
  const before = Object.keys(acc.entries).length;

  if (process.argv.includes('--seed')) seedFromGit(acc);

  // Always merge the current working snapshot last, and remember which
  // snapshot is newest so `active` reflects it.
  let current = null;
  try { current = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8')); } catch { /* no snapshot */ }
  if (current) mergeSnapshot(acc, current, current.generatedAt ?? null);

  const snapshots = [...acc.snapshots].sort();
  const newest = snapshots[snapshots.length - 1] ?? null;
  const entryList = Object.entries(acc.entries).map(([key, e]) => ({ key, ...e }));
  console.log(`  ${entryList.length} diversion entries (${entryList.length - before >= 0 ? '+' + (entryList.length - before) : entryList.length - before}) across ${snapshots.length} snapshots`);

  // Accumulator (source of truth) — content-stable write.
  const srcPayload = sanitizeRecord({
    generatedAt: new Date().toISOString(),
    snapshots,
    entries: acc.entries,
  });
  const stable = (o) => JSON.stringify({ ...o, generatedAt: null });
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(ACC_PATH, 'utf8')); } catch { /* first run */ }
  if (!prev || stable(prev) !== stable(srcPayload)) {
    fs.mkdirSync(path.dirname(ACC_PATH), { recursive: true });
    fs.writeFileSync(ACC_PATH, JSON.stringify(srcPayload), 'utf8');
  }

  // Served view.
  const served = sanitizeRecord({
    generatedAt: new Date().toISOString(),
    source: 'TfL Unified API /Line/{ids}/Status disruptions, accumulated per status refresh (~5-8 snapshots/day)',
    firstObservedAt: snapshots[0] ?? null,
    lastObservedAt: newest,
    snapshotCount: snapshots.length,
    count: entryList.length,
    entries: entryList
      .map(e => ({
        ...e,
        scheduled: e.category !== 'RealTime',
        active: newest != null && e.lastSeen === newest,
      }))
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.route.localeCompare(b.route)),
  });
  let prevApi = null;
  try { prevApi = JSON.parse(fs.readFileSync(API_PATH, 'utf8')); } catch { /* first run */ }
  if (!prevApi || stable(prevApi) !== stable(served)) {
    fs.writeFileSync(API_PATH, JSON.stringify(served), 'utf8');
  }
  console.log(`  served: ${served.count} entries, ${served.entries.filter(e => e.active).length} active as of ${newest}`);
}

main();
