/**
 * fetch-route-performance.js — Per-route EWT / OTP metrics from TfL's QSI PDF
 *
 * Source: http://bus.data.tfl.gov.uk/boroughreports/current-quarter.pdf
 * (the only public per-route bus reliability dataset). Updates every ~4 weeks
 * — TfL operates a 13-period year, so a new PDF appears 12-13× per year.
 *
 * Two metric families are reported, depending on a route's service class:
 *
 *   High-frequency routes (service every ≤12 min) report:
 *     - SWT  Scheduled Waiting Time
 *     - AWT  Actual Waiting Time
 *     - EWT  Excess Waiting Time (= AWT − SWT). Lower is better.
 *
 *   Low-frequency routes (timetabled, less frequent) report:
 *     - On-Time Performance / On-Time Departure %  (higher is better)
 *     - % early / % late / % non-arrival
 *
 * Both report `% scheduled mileage operated`.
 *
 * Output: data/source/route-performance.json
 *   {
 *     generatedAt, sourceUrl, pdfModifiedAt, periodLabel,
 *     periodStart, periodEnd,
 *     routes: { [routeId]: { service_class, ewt_minutes, swt_minutes, …, on_time_percent, … } }
 *   }
 *
 * Also writes data/source/route-performance-raw.txt with the unparsed PDF text
 * (newline-joined, ~150 KB) so the parser can be tweaked without re-fetching.
 *
 * Run: npm run fetch-route-performance
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// pdf-parse pulls in pdfjs internally; ESM import is awkward so we go through CJS.
const pdfParse = require('pdf-parse');

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.resolve(__dirname, '..');
const OUT_PATH     = path.join(ROOT, 'data', 'source', 'route-performance.json');
const RAW_PATH     = path.join(ROOT, 'data', 'source', 'route-performance-raw.txt');
const SOURCE_URL   = 'http://bus.data.tfl.gov.uk/boroughreports/current-quarter.pdf';
const TIMEOUT_MS   = 60_000;
const USER_AGENT   = 'london-buses-map/2.6 (route-performance)';

// ── HTTP fetch with timeout ─────────────────────────────────────────────────
async function fetchPdfBuffer() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SOURCE_URL, {
      signal:  controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`PDF fetch failed: HTTP ${res.status}`);
    const lastMod = res.headers.get('last-modified');
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, lastModified: lastMod ? new Date(lastMod).toISOString() : null };
  } finally {
    clearTimeout(timer);
  }
}

// ── Period parsing ──────────────────────────────────────────────────────────
// PDF cover/header reads "Route Results for London Bus Services Quarter 04 24/25"
// or similar. Map the financial-year quarter to UTC dates (TfL FY runs
// 1 April → 31 March).
function parsePeriod(text) {
  const m = /Quarter\s+0?(\d)\s+(\d{2})\/(\d{2})/i.exec(text);
  if (!m) return { label: null, start: null, end: null };
  const q = parseInt(m[1], 10);
  const fyStart = 2000 + parseInt(m[2], 10);
  const fyEnd   = 2000 + parseInt(m[3], 10);
  // Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar (next calendar year)
  const ranges = {
    1: [`${fyStart}-04-01`, `${fyStart}-06-30`],
    2: [`${fyStart}-07-01`, `${fyStart}-09-30`],
    3: [`${fyStart}-10-01`, `${fyStart}-12-31`],
    4: [`${fyEnd}-01-01`,   `${fyEnd}-03-31`],
  };
  const r = ranges[q];
  return r ? { label: `Q${q} ${m[2]}/${m[3]}`, start: r[0], end: r[1] } : { label: null, start: null, end: null };
}

// ── Row parsing ─────────────────────────────────────────────────────────────
// Excel-exported PDFs render each table row as a single text line of cells
// joined by whitespace. A row starts with a route ID matching a TfL bus-route
// pattern (digits, optional letter prefix, optional letter suffix). Column
// values follow as numbers — possibly negative, with decimals.
//
// We don't try to derive column meaning by position alone — too brittle. We
// detect *which* table we're in by scanning recent header text, then map the
// numeric values into the right column slots accordingly.

const ROUTE_RE   = /^([A-Z]{0,3}\d{1,4}[A-Z]?)\b/;
const NUMERIC_RE = /-?\d+(?:\.\d+)?/g;

function classifyHeader(line) {
  const t = line.toUpperCase();
  // High-frequency tables mention SWT or "excess waiting" or EWT.
  if (/EXCESS\s*WAIT|SWT|AWT|EWT/.test(t)) return 'high-frequency';
  // Low-frequency tables mention "on time", "non-arrival", or OTP / OTD.
  if (/ON\s*TIME|NON.?ARRIV|OTP|OTD|DEPARTING|DEPARTED/.test(t)) return 'low-frequency';
  return null;
}

// Coerce a numeric string to a percent / minutes value, or null if obviously
// junk (e.g. very large numbers that can't be a percentage or wait time).
function num(s, { max = 1000 } = {}) {
  if (s == null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > max)    return null;
  return Math.round(n * 100) / 100;
}

function parseTextToRoutes(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const routes = {};
  let serviceClass = null;

  for (const line of lines) {
    // Update service class on every header-like line so a single PDF that
    // contains both tables (high-freq first, then low-freq) maps each row
    // to the right metrics.
    const cls = classifyHeader(line);
    if (cls) serviceClass = cls;

    const m = ROUTE_RE.exec(line);
    if (!m) continue;
    const routeId = m[1].toUpperCase();
    // Skip lines that LOOK like they start with a route id but are actually
    // section headings ("All routes:", "Total:") or contain alpha noise after.
    const tail = line.slice(m[0].length).trim();
    const numbers = (tail.match(NUMERIC_RE) ?? []).map(Number);
    if (numbers.length < 2) continue;   // need at least two metric values

    // First-occurrence wins so re-parses don't overwrite a richer row with a
    // sparser one elsewhere in the document.
    if (routes[routeId]) continue;

    if (serviceClass === 'high-frequency') {
      // Typical column order in the PDF: SWT, AWT, EWT, % scheduled mileage.
      // We accept whatever shape comes out and map by position; if the
      // upstream layout shifts, raw text is preserved alongside.
      const [swt, awt, ewt, ...rest] = numbers;
      routes[routeId] = {
        service_class:        'high-frequency',
        swt_minutes:          num(swt,  { max: 60 }),
        awt_minutes:          num(awt,  { max: 60 }),
        ewt_minutes:          num(ewt,  { max: 60 }),
        scheduled_mileage_operated_percent: num(rest[rest.length - 1], { max: 100 }),
      };
    } else if (serviceClass === 'low-frequency') {
      // Typical order: % on-time, % early, % late, % non-arrival, % scheduled mileage.
      const [onTime, early, late, nonArr, ...rest] = numbers;
      routes[routeId] = {
        service_class:        'low-frequency',
        on_time_percent:      num(onTime, { max: 100 }),
        early_percent:        num(early,  { max: 100 }),
        late_percent:         num(late,   { max: 100 }),
        non_arrival_percent:  num(nonArr, { max: 100 }),
        scheduled_mileage_operated_percent: num(rest[rest.length - 1], { max: 100 }),
      };
    }
    // serviceClass null means we couldn't tell which table we're in — skip.
    // The raw text dump lets us debug those.
  }

  return routes;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const { buffer, lastModified } = await fetchPdfBuffer();
  console.log(`  ${(buffer.length / 1024).toFixed(0)} KB, last-modified ${lastModified ?? 'unknown'}`);

  const parsed = await pdfParse(buffer);
  const text = parsed.text ?? '';
  console.log(`  Extracted ${text.length} chars across ${parsed.numpages ?? '?'} pages`);

  // Always write the raw text dump so the parser can be iterated on later
  // without re-downloading.
  fs.mkdirSync(path.dirname(RAW_PATH), { recursive: true });
  fs.writeFileSync(RAW_PATH, text, 'utf8');

  const period = parsePeriod(text);
  if (period.label) {
    console.log(`  Period: ${period.label} (${period.start} → ${period.end})`);
  } else {
    console.warn('  Could not detect period label from PDF cover — period_* fields will be null');
  }

  const routes = parseTextToRoutes(text);
  const highFreq = Object.values(routes).filter(r => r.service_class === 'high-frequency').length;
  const lowFreq  = Object.values(routes).filter(r => r.service_class === 'low-frequency').length;
  console.log(`Parsed ${Object.keys(routes).length} routes — high-freq=${highFreq}, low-freq=${lowFreq}`);

  if (Object.keys(routes).length === 0) {
    console.warn('  Zero routes parsed — TfL likely changed PDF format. See route-performance-raw.txt');
  }

  const output = {
    generatedAt:    new Date().toISOString(),
    sourceUrl:      SOURCE_URL,
    pdfModifiedAt:  lastModified,
    periodLabel:    period.label,
    periodStart:    period.start,
    periodEnd:      period.end,
    routeCount:     Object.keys(routes).length,
    routes,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(output), 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
