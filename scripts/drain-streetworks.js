/**
 * drain-streetworks.js — Fold Street Manager events from D1 into the repo.
 *
 * Counterpart of functions/api/streetworks.js: the Pages Function receives
 * London-filtered Street Manager SNS events and queues them in a D1 table;
 * this script (status workflow + nightly) drains that queue through the
 * Cloudflare REST API into the committed archive, then deletes the drained
 * rows — the same git-as-database pattern as every other dataset here.
 *
 * Archive model (schema-tolerant on purpose — Street Manager payload
 * shapes are only fully knowable once real events flow): entries are keyed
 * by the work/permit reference; each keeps the highway authority, first and
 * last event times, a compact event trail [{type, time}], and the LATEST
 * object_data payload verbatim. A corridor join to bus routes (as
 * fetch-roadworks.js does for TIMS) is a follow-up once real coordinate
 * fields are observed.
 *
 * Config (GitHub Actions secrets → env):
 *   CF_ACCOUNT_ID        — Cloudflare account id
 *   CF_API_TOKEN         — API token with D1:edit on the account
 *   STREETWORKS_D1_ID    — the D1 database uuid bound as STREETWORKS_DB
 * Missing config is a SOFT SKIP (exit 0 with a note) so the pipeline works
 * before registration/setup is done.
 *
 * Outputs:
 *   data/source/streetworks-history.json  (accumulator, force-committed)
 *   data/api/streetworks-history.json     (served view)
 *
 * Run: npm run drain-streetworks
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithTimeout, userAgentHeaders } from './_lib/http.js';
import { sanitizeRecord } from './_lib/sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..');
const ACC_PATH = path.join(ROOT, 'data', 'source', 'streetworks-history.json');
const API_PATH = path.join(ROOT, 'data', 'api', 'streetworks-history.json');
const SCRIPT   = 'drain-streetworks';
const BATCH    = 500;

const { CF_ACCOUNT_ID, CF_API_TOKEN, STREETWORKS_D1_ID } = process.env;

async function d1(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${STREETWORKS_D1_ID}/query`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { ...userAgentHeaders(SCRIPT), 'authorization': `Bearer ${CF_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const j = await res.json();
  if (!res.ok || j.success === false) throw new Error(`D1 API: ${res.status} ${JSON.stringify(j.errors ?? j).slice(0, 200)}`);
  return j.result?.[0]?.results ?? [];
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
  const ref = inner.object_reference ?? inner.work_reference_number ?? inner.event_reference ?? row.id;
  const time = inner.event_time ?? row.received_at;
  const e = entries[ref] ??= {
    ha: row.ha, objectType: inner.object_type ?? null,
    firstEvent: time, lastEvent: time, events: [],
  };
  if (time < e.firstEvent) e.firstEvent = time;
  if (time > e.lastEvent) { e.lastEvent = time; e.latest = inner.object_data ?? inner; }
  e.latest ??= inner.object_data ?? inner;
  e.ha = row.ha ?? e.ha;
  e.events.push({ type: inner.event_type ?? null, time });
  e.events.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  if (e.events.length > 200) e.events = e.events.slice(-200);   // cap pathological churn
}

async function main() {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !STREETWORKS_D1_ID) {
    console.log('Street Manager drain not configured (CF_ACCOUNT_ID / CF_API_TOKEN / STREETWORKS_D1_ID) — skipped.');
    return;
  }
  const entries = loadAcc();
  let drained = 0;
  while (true) {
    let rows;
    try { rows = await d1(`SELECT id, received_at, topic, ha, message FROM events ORDER BY received_at LIMIT ${BATCH}`); }
    catch (err) {
      if (/no such table/i.test(err.message)) { console.log('No events table yet (no events received) — nothing to drain.'); break; }
      throw err;
    }
    if (!rows.length) break;
    for (const row of rows) fold(entries, row);
    const ids = rows.map(r => r.id);
    await d1(`DELETE FROM events WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    drained += rows.length;
    if (rows.length < BATCH) break;
  }
  console.log(`Drained ${drained} events; archive now holds ${Object.keys(entries).length} works`);
  if (!drained && !Object.keys(entries).length) return;   // nothing yet — write nothing

  const nowIso = new Date().toISOString();
  writeStable(ACC_PATH, sanitizeRecord({ generatedAt: nowIso, entries }));
  const list = Object.entries(entries).map(([ref, e]) => ({ ref, ...e }))
    .sort((a, b) => String(b.lastEvent).localeCompare(String(a.lastEvent)));
  writeStable(API_PATH, sanitizeRecord({
    generatedAt: nowIso,
    source: 'DfT Street Manager open data (SNS → Pages Function → D1 → this archive), London highway authorities only',
    count: list.length,
    entries: list,
  }));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
