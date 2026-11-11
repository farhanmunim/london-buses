/**
 * fetch-lots-tenders.js — Contract terms from LOTS award bulletins (supplementary).
 *
 * Source: the London Omnibus Traction Society news page, "Bus News" category,
 * all periods — one POST returns the whole history (the site dates from
 * March 2024; award posts start February 2025):
 *
 *   POST https://www.lots.org.uk/news.php
 *        lots_pick_news_category=Bus News & lots_pick_news_period=all
 *
 * Why this exists: LOTS writes the CONTRACT LENGTH in words on every award
 * ("… for 7 years starting on 09/10/2027"), which neither TfL's results
 * register nor the community wiki carries. Our term is otherwise inferred
 * (end − start, with the end decoded from londonbusroutes.net's contract
 * code), and ~40% of awards since 2025 have no term at all. A stated term
 * is what tells a 3-year bridging contract from a full 7-year one — the
 * difference between a route coming back to market early and one that is
 * not. Cross-checked against our data on first run: every one of the ~130
 * award lines matched an award we already hold (TfL or provisional), so
 * this feed adds fields, not rows — but it is also kept as a last-resort
 * provisional source should the wiki fall silent (build-api.js decides).
 *
 * Two sentence styles appear and both are parsed:
 *   "150 awarded to Blue Triangle using new electric double decks (PVR 15)
 *    for 7 years starting on 09/10/2027. Currently operated by Arriva London North."
 *   "310 re-awarded to Stagecoach East London using new electric double-decks
 *    for 7 years starting on 5th September 2026. PVR 7."
 * plus variants: "148(24hr)", "SL15 New route awarded …", "PVR 2 + 1
 * crosslinked from route 624", "Contract start date tba".
 *
 * Output: data/source/lots-tenders.json (content-stable write)
 *   { generatedAt, source, count, unparsed, entries: [
 *       { posted, route_id, awarded_operator, previous_operator, re_award,
 *         new_route, vehicles, pvr, term_years, contract_start } ] }
 *
 * Courtesy: one request per run; the hourly tender workflow is the only
 * caller. LOTS_HTML_FILE=<path> parses a saved page instead (tests, offline).
 *
 * Run: npm run fetch-lots-tenders  /  node scripts/fetch-lots-tenders.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithTimeout, userAgentHeaders } from './_lib/http.js';
import { sanitizeRecord } from './_lib/sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_PATH  = path.join(ROOT, 'data', 'source', 'lots-tenders.json');
const SCRIPT    = 'lots-tenders';
const URL_      = 'https://www.lots.org.uk/news.php';

const MONTHS = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const clean = s => String(s ?? '').replace(/\s+/g, ' ').replace(/[.,;:\s]+$/, '').trim();

/* One award sentence → entry, or null when it is not an award line. */
export function parseLine(line, posted) {
  const t = String(line).replace(/\s+/g, ' ').trim();
  if (!/\bawarded to\b/i.test(t)) return null;
  const head = /^((?:[A-Z]{0,3}\d+[A-Z]?|[A-Z]{1,3}\d*)(?:\s*\/\s*(?:[A-Z]{0,3}\d+[A-Z]?|[A-Z]{1,3}\d*))*)\s*(?:\((?:24\s*h(?:ou)?rs?)\))?\s*(?:\(24 hour\))?/i.exec(t);
  // "awarded to OP using …", "awarded to OP (was PREV) with …", "awarded to OP, …"
  const op = /\bawarded to (.+?)(?: \((?:was|previously|formerly) ([^)]+)\))?(?= (?:using|with) \b| for [\d.]+ years?\b| starting\b|[.,]| \(PVR\b|$)/i.exec(t);
  if (!head || !op) return { unparsed: t.slice(0, 200), posted };
  const route = head[1].replace(/\s+/g, '').toUpperCase();
  const veh = /\b(?:using|with) (.+?)(?= \(PVR\b| for [\d.]+ years?\b| starting\b|\.(?: |$)|$)/i.exec(t);
  const pvr = /\(PVR\)? ?(\d+)/i.exec(t) ?? /\bPVR (\d+)\b/i.exec(t);
  const yrs = /\bfor ([\d.]+) years?\b/i.exec(t);
  let start = null;
  const d1 = /\bstarting(?: on)? (\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(t);
  const d2 = /\bstarting(?: on)? (\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]+) (\d{4})/i.exec(t);
  if (d1) start = iso(d1[3], +d1[2], +d1[1]);
  else if (d2 && MONTHS[d2[2].toLowerCase()]) start = iso(d2[3], MONTHS[d2[2].toLowerCase()], +d2[1]);
  const from = /\bCurrently operated by ([^.]+?)\.?(?: |$)/i.exec(t) ?? (op[2] ? [null, op[2]] : null);
  return {
    posted,
    route_id: route,
    awarded_operator: clean(op[1]),
    previous_operator: from ? clean(from[1]) : null,
    re_award: /\bre-awarded\b/i.test(t),
    new_route: /\bnew route\b/i.test(t),
    vehicles: veh ? clean(veh[1]) : null,
    pvr: pvr ? Number(pvr[1]) : null,
    term_years: yrs ? Number(yrs[1]) : null,
    contract_start: start,
  };
}

/* The whole news page → award entries (+ lines that looked like awards but did not parse). */
export function parsePage(html) {
  const entries = [], unparsed = [];
  for (const sec of String(html).split('<div class="detail-section">').slice(1)) {
    const d = /<strong>\w{3} (\d{1,2})\w{2} (\w+) (\d{4})<\/strong>/.exec(sec);
    if (!d || !MONTHS[d[2].toLowerCase()]) continue;
    const posted = iso(d[3], MONTHS[d[2].toLowerCase()], +d[1]);
    const text = sec.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
    for (const line of text.split('\n')) {
      const e = parseLine(line, posted);
      if (!e) continue;
      if (e.unparsed) unparsed.push(e); else entries.push(e);
    }
  }
  return { entries, unparsed };
}

async function fetchPage() {
  if (process.env.LOTS_HTML_FILE) return fs.readFileSync(process.env.LOTS_HTML_FILE, 'utf8');
  const body = new URLSearchParams({ lots_pick_news_category: 'Bus News', lots_pick_news_period: 'all', lots_news_search: '' });
  const res = await fetchWithTimeout(URL_, { method: 'POST', body, headers: { ...userAgentHeaders(SCRIPT), 'content-type': 'application/x-www-form-urlencoded' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  let html;
  try { html = await fetchPage(); }
  catch (err) {
    // Soft fail: keep last-known-good — a down or reshaped site must not wipe the feed.
    console.log(`LOTS fetch failed (${err.message}) — keeping the existing file (last known good).`);
    return;
  }
  const { entries, unparsed } = parsePage(html);
  if (!entries.length) { console.log('No award lines parsed — keeping the existing file (last known good).'); return; }
  entries.sort((a, b) => a.posted.localeCompare(b.posted) || a.route_id.localeCompare(b.route_id));
  for (const u of unparsed.slice(0, 5)) console.log(`  unparsed: ${u.unparsed.slice(0, 120)}`);

  const payload = sanitizeRecord({
    generatedAt: new Date().toISOString(),
    source: 'London Omnibus Traction Society — lots.org.uk news (Bus News), award bulletins',
    count: entries.length,
    unparsed: unparsed.length,
    entries,
  });
  const stable = (o) => JSON.stringify({ ...o, generatedAt: null });
  let unchanged = false;
  if (fs.existsSync(OUT_PATH)) {
    try { unchanged = stable(JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))) === stable(payload); } catch { /* rewrite */ }
  }
  if (unchanged) console.log(`${entries.length} award lines (${unparsed.length} unparsed) — unchanged, not rewriting`);
  else {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(payload), 'utf8');
    console.log(`Wrote ${entries.length} award lines (${unparsed.length} unparsed) to ${OUT_PATH}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(err => { console.error('Fatal:', err); process.exit(1); });
