/**
 * fetch-frequencies.js — Per-route headway cache by time band
 *
 * Simplified port of RouteMapster's build_frequency_cache.py. For each bus line
 * calls /Line/{id}/Timetable/{firstStopId} (both directions), then derives the
 * average headway (minutes between buses) in each band:
 *   peak_am   07:00-10:00 weekday
 *   peak_pm   16:00-19:00 weekday
 *   offpeak   10:00-16:00 weekday (falls back to 19:00-22:00 if interpeak empty)
 *   overnight 00:00-05:00 weekday (0 means no service)
 *   weekend   09:00-19:00 saturday
 *
 * Output: data/frequencies.json
 *   { "1": { "peak_am": 6.5, "peak_pm": 6.5, "offpeak": 6.5, "overnight": 0, "weekend": 5.0 } }
 *
 * Run: npm run fetch-frequencies
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_PATH = path.join(DATA_DIR, 'frequencies.json');
const BASE_URL = 'https://api.tfl.gov.uk';

try {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}
const API_KEY = process.env.BUS_API_KEY ?? '';

function apiUrl(ep) {
  return `${BASE_URL}${ep}${API_KEY ? `${ep.includes('?') ? '&' : '?'}app_key=${API_KEY}` : ''}`;
}

async function fetchJson(url, retries = 4) {
  for (let i = 1; i <= retries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      if (i === retries) return null;
      await new Promise(r => setTimeout(r, i * 800));
    }
  }
}

function round1(v) { return Math.round(v * 10) / 10; }

// Expand a TfL "schedule" day-type into a set of minute-of-day departure times.
// The timetable endpoint returns structure: timetable.routes[*].schedules[*]
//   with name ("Monday - Friday"/"Saturday"/"Sunday"), knownJourneys[*]{hour,minute}
function journeysFor(timetable, dayType) {
  const out = [];
  for (const rt of (timetable?.timetable?.routes ?? [])) {
    for (const sch of (rt.schedules ?? [])) {
      const name = (sch.name ?? '').toLowerCase();
      const match = dayType === 'weekday' ? /monday|weekday/.test(name) && !/saturday|sunday/.test(name)
                  : dayType === 'saturday' ? /saturday/.test(name)
                  : /sunday/.test(name);
      if (!match) continue;
      for (const j of (sch.knownJourneys ?? [])) {
        const h = Number(j.hour), m = Number(j.minute);
        if (Number.isFinite(h) && Number.isFinite(m)) out.push(h * 60 + m);
      }
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

// Compute mean headway in minutes within [startMin, endMin). Returns null when <2 departures.
function headwayInBand(mins, startMin, endMin) {
  // Support wrap-past-midnight bands
  const inBand = (t) => startMin <= endMin
    ? t >= startMin && t < endMin
    : t >= startMin || t < endMin;
  const band = mins.filter(inBand);
  if (band.length < 2) return null;
  const diffs = [];
  for (let i = 1; i < band.length; i++) {
    let d = band[i] - band[i - 1];
    if (d <= 0) d += 1440;
    if (d > 0 && d <= 120) diffs.push(d);
  }
  if (!diffs.length) return null;
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return round1(mean);
}

async function main() {
  console.log('Fetching bus lines...');
  const lines = await fetchJson(apiUrl('/Line/Mode/bus'));
  const ids = [...new Set((lines ?? []).map(l => String(l.id).toUpperCase()))].sort();
  console.log(`  ${ids.length} routes`);

  const out = {};
  let done = 0;

  // Limited concurrency to respect rate limits (~300/min under 500 cap).
  const CONC = 4, MIN_INTERVAL = Math.ceil(60_000 / 300);
  let nextSlot = Date.now();
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= ids.length) break;
      const now = Date.now();
      const wait = nextSlot - now;
      nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      const id = ids[i];
      try {
        // First: find a stop id on this line
        const seq = await fetchJson(apiUrl(`/Line/${encodeURIComponent(id)}/Route/Sequence/outbound?excludeCrowding=true`));
        const stops = seq?.stopPointSequences?.[0]?.stopPoint ?? [];
        const stopId = stops[0]?.id ?? stops[0]?.stationId;
        if (!stopId) { done++; continue; }
        const tt = await fetchJson(apiUrl(`/Line/${encodeURIComponent(id)}/Timetable/${encodeURIComponent(stopId)}`));
        if (!tt) { done++; continue; }

        const weekday = journeysFor(tt, 'weekday');
        const saturday = journeysFor(tt, 'saturday');

        const peak_am   = headwayInBand(weekday, 7 * 60, 10 * 60) ?? 0;
        const peak_pm   = headwayInBand(weekday, 16 * 60, 19 * 60) ?? 0;
        let offpeak = headwayInBand(weekday, 10 * 60, 16 * 60);
        if (offpeak == null) offpeak = headwayInBand(weekday, 19 * 60, 22 * 60) ?? 0;
        const overnight = headwayInBand(weekday, 0,        5 * 60)  ?? 0;
        const weekend   = headwayInBand(saturday, 9 * 60,  19 * 60) ?? 0;

        out[id] = { peak_am, peak_pm, offpeak, overnight, weekend };
      } catch (err) {
        // skip
      }
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${ids.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  // ── Fallback pass: for any route still missing frequencies, scrape the
  //    matching londonbusroutes.net/times/<id>.htm page. The page contains
  //    HHMM departure columns per stop; we take the first time-row and compute
  //    headways using the same bands as the primary pass.
  const missingIds = ids.filter(id => !out[id]);
  if (missingIds.length) {
    console.log(`  ${missingIds.length} routes missing frequencies — trying londonbusroutes.net fallback`);
    // Build href map from routes.htm so N-prefixed routes resolve to their
    // correct filename (e.g. N1 → times/N001.htm).
    let hrefMap = {};
    try {
      const routesHtml = await (await fetch('http://www.londonbusroutes.net/routes.htm', {
        headers: { 'User-Agent': 'london-buses-map/2.0 (personal project)' },
      })).text();
      const re = /<a\s+name=["']?[MN]([A-Z0-9]+)["']?\s+href=["']?([^"'>]+)["']?>([^<]+)<\/a>/gi;
      let mm;
      while ((mm = re.exec(routesHtml)) !== null) {
        const rid = (mm[3] || mm[1]).trim().toUpperCase();
        if (!hrefMap[rid]) hrefMap[rid] = mm[2].trim();
      }
    } catch (err) {
      console.warn(`  routes.htm href map unavailable (${err.message})`);
    }

    let filled = 0;
    for (const id of missingIds) {
      const href = hrefMap[id] || `times/${id}.htm`;
      const url = `http://www.londonbusroutes.net/${href}`;
      try {
        await new Promise(r => setTimeout(r, 250)); // polite pacing
        const res = await fetch(url, { headers: { 'User-Agent': 'london-buses-map/2.0 (personal project)' } });
        if (!res.ok) continue;
        const html = await res.text();
        const preBlocks = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map(m => m[1]);
        if (!preBlocks.length) continue;

        // Each <pre> is one day-type timetable; the site usually orders them
        // Mon-Fri / Sat / Sun. Detect via nearby headings (<h2>/<h3>/<b>)
        // before each <pre>, or fall back to block index.
        const dayTypeOrder = ['weekday', 'saturday', 'sunday'];
        const dayTables = {};
        // Find surrounding labels: split html before each <pre>
        const splitRe = /<pre[^>]*>/i;
        const preBlocksWithCtx = [];
        let cursor = 0, idx = 0;
        const preIter = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
        let pm;
        while ((pm = preIter.exec(html)) !== null) {
          const before = html.slice(cursor, pm.index).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
          cursor = pm.index + pm[0].length;
          // Use only the tail (just before the <pre>) and prefer explicit
          // heading patterns like "XX Mondays to Fridays towards ..."
          const tail = before.slice(-180);
          let dayType = null;
          if (/mondays?\s+to\s+fridays?|mon\s*-\s*fri|weekdays?/.test(tail)) dayType = 'weekday';
          else if (/saturdays?/.test(tail)) dayType = 'saturday';
          else if (/sundays?/.test(tail)) dayType = 'sunday';
          if (!dayType) dayType = dayTypeOrder[Math.min(idx, 2)];
          preBlocksWithCtx.push({ dayType, block: pm[1] });
          idx++;
        }

        for (const { dayType, block } of preBlocksWithCtx) {
          if (dayTables[dayType]) continue; // keep first occurrence
          const lines = block.split(/\r?\n/)
            .map(l => l.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' '))
            .filter(l => l.trim());
          // Find first row with at least 3 HHMM tokens
          const timeLine = lines.find(l => (l.match(/\b[0-2]\d[0-5]\d\b/g) || []).length >= 3);
          if (!timeLine) continue;
          const times = (timeLine.match(/\b[0-2]\d[0-5]\d\b/g) || [])
            .map(t => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(2), 10));
          dayTables[dayType] = times.sort((a, b) => a - b);
        }

        const weekday  = dayTables.weekday  || [];
        const saturday = dayTables.saturday || [];

        const peak_am   = headwayInBand(weekday, 7 * 60, 10 * 60) ?? 0;
        const peak_pm   = headwayInBand(weekday, 16 * 60, 19 * 60) ?? 0;
        let offpeak     = headwayInBand(weekday, 10 * 60, 16 * 60);
        if (offpeak == null) offpeak = headwayInBand(weekday, 19 * 60, 22 * 60) ?? 0;
        const overnight = headwayInBand(weekday, 0, 5 * 60) ?? 0;
        const weekend   = headwayInBand(saturday, 9 * 60, 19 * 60) ?? 0;

        if (peak_am || peak_pm || offpeak || overnight || weekend) {
          out[id] = { peak_am, peak_pm, offpeak, overnight, weekend };
          filled++;
        }
      } catch (err) {
        // ignore individual failures
      }
    }
    console.log(`  timetable fallback filled ${filled}/${missingIds.length}`);
  }

  const sorted = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(sorted), 'utf8');
  console.log(`Wrote ${Object.keys(sorted).length} routes to ${OUT_PATH}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
