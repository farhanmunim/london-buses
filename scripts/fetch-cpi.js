/**
 * fetch-cpi.js — ONS CPI index + CPA escalation rates (CPI-CPA)
 *
 * Pulls the ONS CPI All Items Index (D7BT, 2015=100) monthly series from the
 * public time-series JSON endpoint and derives the contract-escalation rates
 * the TfL contracting world runs on:
 *
 *   yoy[M] = (CPI[M] − CPI[M−12]) / CPI[M−12]
 *   p2p[M] = yoy[M−4] × 0.85          (point-to-point, 4-month publication lag)
 *   ra[M]  = AVG(yoy[M−12] … yoy[M−1]) × 0.85   (rolling average, window ends prior month)
 *
 * Arithmetic replicates the reference implementation (bus-contracts-manager's
 * CpiRateService, PHP bcmath) digit for digit: scale-10 truncating internal
 * maths, half-up rounding to 8 dp at the edge — so the stored values agree
 * with the canonical revenue spreadsheet to the last decimal. BigInt keeps
 * JS floats out of the money path entirely.
 *
 * Writes data/api/cpi-cpa.json:
 *   { generatedAt, source, series, releaseDate, nextRelease, count,
 *     months: [{ month: "2026-07", cpi: "142.9",
 *                yoy: "0.03110465", p2p: "0.02702241", ra: "0.02883061" }] }
 *
 * Sticky: on any fetch/validation failure the existing file stands untouched.
 * ONS publishes monthly (~mid-month); the nightly pipeline picks it up.
 *
 * Run: node scripts/fetch-cpi.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithTimeout, userAgentHeaders } from './_lib/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'api', 'cpi-cpa.json');
const SERIES_URL = 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7bt/mm23/data';
const SCRIPT = 'cpi';

const SERIES_FROM = '2010-01';        // published rows start here (needs 2009 for its YoY)
const RA_WINDOW = 12;                 // RA averages 12 monthly YoY values …
const RA_LAG = 1;                     // … ending at the previous month
const P2P_LAG = 4;                    // P2P applies the YoY from 4 months earlier
const FACTOR_NUM = 85n, FACTOR_DEN = 100n;   // the 85% CPA scaling factor

/* ── bcmath-parity arithmetic ─────────────────────────────────────────────
   Values live as BigInt at scale 10 (1e10 units). bcdiv/bcmul truncate
   toward zero at the working scale; roundHalfUp adds a signed half then
   truncates to scale 8 — exactly the PHP reference. */
const SCALE = 10n ** 10n;

// CPI arrives as a 1-dp string ("142.9") → tenths as BigInt.
const tenths = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n * 10));
};
const truncDiv = (a, b) => a / b;     // BigInt division truncates toward zero — same as bcdiv

// yoy at scale 10: trunc(((cur − prior) × 1e10) / prior); tenths cancel.
const yoyChange = (curT, priorT) => truncDiv((curT - priorT) * SCALE, priorT);
const scaleByFactor = v10 => truncDiv(v10 * FACTOR_NUM, FACTOR_DEN);

// Half-up to 8 dp: ±0.5e-8 (= 50 scale-10 units) then truncate two digits.
const roundHalfUp8 = v10 => truncDiv(v10 + (v10 < 0n ? -50n : 50n), 100n);
const fmt8 = v8 => {
  const neg = v8 < 0n;
  const abs = neg ? -v8 : v8;
  const s = abs.toString().padStart(9, '0');
  return (neg ? '-' : '') + s.slice(0, -8) + '.' + s.slice(-8);
};

const monthKey = d => d.toISOString().slice(0, 7);
const shiftMonths = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return monthKey(d);
};

async function fetchSeries() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchWithTimeout(SERIES_URL, {
        headers: userAgentHeaders(SCRIPT, { Accept: 'application/json' }),
      }, 30_000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }
}

async function main() {
  console.log('Fetching ONS CPI D7BT series...');
  const payload = await fetchSeries();
  const raw = payload?.months;
  if (!Array.isArray(raw)) throw new Error('ONS response missing the "months" array');

  // Parse "2026 MAR" dates; sanity-gate each value like the reference sanitiser.
  const MONTHS = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };
  const index = new Map();   // "YYYY-MM" → tenths BigInt
  for (const e of raw) {
    const m = String(e?.date ?? '').trim().match(/^(\d{4}) ([A-Z]{3})$/);
    const v = Number(String(e?.value ?? '').trim());
    if (!m || !MONTHS[m[2]] || !Number.isFinite(v) || v < 1 || v > 1000) continue;
    index.set(`${m[1]}-${String(MONTHS[m[2]]).padStart(2, '0')}`, tenths(v.toFixed(1)));
  }

  // Validation gate: refuse a thin or stale series — the existing file stands.
  const keys = [...index.keys()].sort();
  const latest = keys[keys.length - 1];
  const ageDays = (Date.now() - Date.parse(latest + '-01')) / 864e5;
  if (keys.length < 150 || ageDays > 92) {
    throw new Error(`Validation failed: ${keys.length} months, latest ${latest} (${Math.round(ageDays)}d old)`);
  }

  const yoy10 = new Map();   // full-precision scale-10 YoY per month (for RA/P2P)
  for (const k of keys) {
    const prior = index.get(shiftMonths(k, -12));
    if (prior != null) yoy10.set(k, yoyChange(index.get(k), prior));
  }

  const months = [];
  for (const k of keys) {
    if (k < SERIES_FROM) continue;
    const yoy = yoy10.get(k);

    const p2pSrc = yoy10.get(shiftMonths(k, -P2P_LAG));
    const p2p = p2pSrc != null ? roundHalfUp8(scaleByFactor(p2pSrc)) : null;

    let ra = null;
    let sum = 0n, complete = true;
    for (let off = RA_WINDOW; off >= RA_LAG; off--) {
      const w = yoy10.get(shiftMonths(k, -off));
      if (w == null) { complete = false; break; }
      sum += w;
    }
    if (complete) ra = roundHalfUp8(scaleByFactor(truncDiv(sum, BigInt(RA_WINDOW))));

    months.push({
      month: k,
      cpi: (Number(index.get(k)) / 10).toFixed(1),
      yoy: yoy != null ? fmt8(roundHalfUp8(yoy)) : null,
      p2p: p2p != null ? fmt8(p2p) : null,
      ra: ra != null ? fmt8(ra) : null,
    });
  }

  // Tamper guard: CPI is not normally revised (ONS policy — corrections are
  // rare, announced events). A historical value that differs from what we
  // have committed is therefore treated as upstream corruption: the run
  // refuses to overwrite and the committed file keeps serving. A genuine,
  // announced ONS correction is accepted by re-running with
  // CPI_ACCEPT_REVISIONS=1. The trailing month is exempt — it is this
  // publication's new row, not history.
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')); } catch { return null; } })();
  if (prev?.months?.length) {
    const prevCpi = new Map(prev.months.map(m => [m.month, m.cpi]));
    const newest = latest;
    const changed = months.filter(m => m.month !== newest && prevCpi.has(m.month) && prevCpi.get(m.month) !== m.cpi);
    if (changed.length && process.env.CPI_ACCEPT_REVISIONS !== '1') {
      for (const m of changed.slice(0, 12)) {
        console.error(`  REVISED: ${m.month} committed=${prevCpi.get(m.month)} upstream=${m.cpi}`);
      }
      throw new Error(`${changed.length} historical CPI value(s) differ from the committed series — refusing to overwrite. `
        + 'If ONS has announced a genuine correction, re-run with CPI_ACCEPT_REVISIONS=1.');
    }
    if (changed.length) console.warn(`  Accepting ${changed.length} upstream revision(s) (CPI_ACCEPT_REVISIONS=1).`);
  }

  const out = {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: 'ONS · CPI All Items Index (D7BT, 2015=100), series mm23',
    series: payload?.description?.title ?? 'CPI INDEX 00: ALL ITEMS 2015=100',
    releaseDate: payload?.description?.releaseDate ?? null,
    nextRelease: payload?.description?.nextRelease ?? null,
    factor: '0.85',
    count: months.length,
    months,
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out) + '\n', 'utf8');
  console.log(`Wrote ${months.length} months (${months[0].month} → ${latest}) → ${OUT_PATH}`);
  console.log(`  latest: CPI ${months[months.length-1].cpi} · yoy ${months[months.length-1].yoy} · p2p ${months[months.length-1].p2p} · ra ${months[months.length-1].ra}`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
