/**
 * fetch-line-status.js — Service status + diversion register (TfL)
 *
 * One call to /Line/Mode/bus/Status?detail=true covers every bus route and
 * feeds two served files:
 *
 *   data/api/line-status.json — the status board:
 *     { capturedAt, summary: { total, good, disrupted },
 *       rows: [{ route, status, reason, severity }] }
 *
 *   data/api/route-diversions.json — routes whose disruption text describes
 *   a diversion:
 *     { generatedAt, count, upcomingFreeze: [], routes: { "1": {
 *         id, status, severity, disruptions: [{ reason, category, since, until }],
 *         since, until, detectedAt, geometryStatus: "none",
 *         baselineSource: null, missedStops: {}, addedStops: {},
 *         diversionSegments: {}, bypassedSegments: {} } } }
 *
 *   The geometry fields are structural stubs: the GPS-trace diversion
 *   geometry the Atlas pipeline derived needed 24/7 fleet observation,
 *   which this project has retired. The front-ends treat
 *   geometryStatus !== 'published' as "no overlay" and still show the
 *   diversion notice from `disruptions`.
 *
 * Run: node scripts/fetch-line-status.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from './_lib/env.js';
import { fetchWithTimeout, userAgentHeaders } from './_lib/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'data', 'api');
const STATUS_PATH = path.join(API_DIR, 'line-status.json');
const DIVERSIONS_PATH = path.join(API_DIR, 'route-diversions.json');
const SCRIPT = 'line-status';

loadEnv();
const API_KEY = process.env.BUS_API_KEY ?? '';

async function fetchJson(url, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { headers: userAgentHeaders(SCRIPT) }, 60_000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }
}

async function main() {
  const url = `https://api.tfl.gov.uk/Line/Mode/bus/Status?detail=true${API_KEY ? `&app_key=${API_KEY}` : ''}`;
  console.log('Fetching bus line statuses from TfL...');
  const lines = await fetchJson(url);
  if (!Array.isArray(lines) || lines.length < 400) {
    console.error(`Validation failed: ${Array.isArray(lines) ? lines.length : 'non-array'} lines (need ≥400) — nothing written`);
    process.exit(1);
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const rows = [];
  const diversions = {};

  for (const line of lines) {
    const route = String(line?.name ?? line?.id ?? '').toUpperCase();
    if (!route) continue;
    const statuses = line?.lineStatuses ?? [];
    // Worst status leads the board (TfL severity: lower = worse, 10 = good).
    const worst = statuses.slice().sort((a, b) => (a?.statusSeverity ?? 10) - (b?.statusSeverity ?? 10))[0] ?? {};
    const severity = Number.isFinite(worst.statusSeverity) ? worst.statusSeverity : 10;
    rows.push({
      route,
      status: worst.statusSeverityDescription ?? 'Good Service',
      reason: String(worst.reason ?? '').trim(),
      severity,
    });

    // Diversion register: any non-good status whose text describes a diversion.
    const disruptions = [];
    let since = null, until = null;
    for (const st of statuses) {
      if ((st?.statusSeverity ?? 10) === 10) continue;
      const reason = String(st?.reason ?? st?.disruption?.description ?? '').trim();
      if (!/diver(sion|ted)/i.test(reason)) continue;
      const vp = (st?.validityPeriods ?? [])[0] ?? {};
      disruptions.push({
        reason,
        category: st?.disruption?.categoryDescription ?? st?.disruption?.category ?? null,
        since: vp.fromDate ?? st?.disruption?.created ?? null,
        until: vp.toDate ?? null,
      });
      since ??= vp.fromDate ?? st?.disruption?.created ?? null;
      if (vp.toDate && (!until || vp.toDate > until)) until = vp.toDate;
    }
    if (disruptions.length) {
      diversions[route] = {
        id: route,
        status: worst.statusSeverityDescription ?? 'Special Service',
        severity,
        disruptions,
        since,
        until,
        detectedAt: now,
        geometryStatus: 'none',
        baselineSource: null,
        missedStops: {},
        addedStops: {},
        diversionSegments: {},
        bypassedSegments: {},
      };
    }
  }

  rows.sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }));
  const good = rows.filter(r => r.severity === 10).length;

  // Diversion detectedAt is sticky — a diversion already on the register
  // keeps its original detection time instead of resetting every run.
  try {
    const prev = JSON.parse(fs.readFileSync(DIVERSIONS_PATH, 'utf8'))?.routes ?? {};
    for (const [route, rec] of Object.entries(diversions)) {
      if (prev[route]?.detectedAt) rec.detectedAt = prev[route].detectedAt;
    }
  } catch { /* cold start */ }

  fs.mkdirSync(API_DIR, { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify({
    capturedAt: now,
    summary: { total: rows.length, good, disrupted: rows.length - good },
    rows,
  }) + '\n', 'utf8');

  const sorted = Object.fromEntries(Object.keys(diversions).sort().map(k => [k, diversions[k]]));
  fs.writeFileSync(DIVERSIONS_PATH, JSON.stringify({
    generatedAt: now,
    count: Object.keys(sorted).length,
    upcomingFreeze: [],
    routes: sorted,
  }) + '\n', 'utf8');

  // Keep the served manifest's freshness rows truthful between full
  // build-api runs — intraday refreshes only touch these two datasets.
  const manifestPath = path.join(API_DIR, 'manifest.json');
  try {
    const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const [key, rowsN] of [['line-status', rows.length], ['route-diversions', Object.keys(sorted).length]]) {
      if (mf?.datasets?.[key]) Object.assign(mf.datasets[key], { fetchedAt: now, status: 'ok', rows: rowsN });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(mf) + '\n', 'utf8');
  } catch { /* no manifest yet — build-api owns creating it */ }

  console.log(`Wrote ${rows.length} rows (${rows.length - good} disrupted) → ${STATUS_PATH}`);
  console.log(`Wrote ${Object.keys(sorted).length} diversions → ${DIVERSIONS_PATH}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
