/**
 * fetch-fandom-tenders.js — Community-reported tender awards (supplementary).
 *
 * Source: london-bus-routes.fandom.com "Tender Results <year>" pages, read
 * through the MediaWiki API (the plain pages sit behind a Cloudflare
 * challenge; api.php does not):
 *
 *   https://london-bus-routes.fandom.com/api.php?action=parse&page=Tender_Results_<YYYY>&prop=wikitext&format=json
 *
 * Why this exists: TfL's own results register (13923/13796.aspx) publishes
 * award pages on a lag that has stretched to months (last new btID
 * 2026-04-22 as of 2026-09), while the wiki tracks the weekly award
 * bulletins as they land. A 229-row cross-check against our TfL-scraped
 * awards measured 100% agreement on the winning operator
 * (parent-normalised), ~99% on award date and accepted bid, with the
 * transcription slips confined to the lowest/highest-bid columns — good
 * enough to surface as clearly-flagged PROVISIONAL awards until TfL's page
 * appears, at which point the TfL record wins and the provisional row
 * drops out (dedupe happens in build-api.js, not here).
 *
 * Trust tiers (from the cross-check): route, new operator, award date,
 * current operator, PVR and vehicle spec are reliable; accepted bid is
 * carried but flagged; lowest/highest bid, cost-per-mile and bidder count
 * are NOT carried — that's where the wiki's typos live.
 *
 * Page structure: one `== D Month YYYY ==` section per bulletin date, each
 * holding an operator table (route | current op | new op | PVR | vehicles)
 * and usually a bid table (route | bidders | winner | accepted | lowest |
 * highest | £/mile), both using rowspan for joint awards.
 *
 * Output: data/source/fandom-tenders.json (content-stable write)
 *   { generatedAt, source, pages, count, entries: [
 *       { award_date, route_id, current_operator, awarded_operator,
 *         pvr, vehicles, accepted_bid, source_page } ] }
 *
 * Run: npm run fetch-fandom-tenders  /  node scripts/fetch-fandom-tenders.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithTimeout, userAgentHeaders } from './_lib/http.js';
import { sanitizeRecord } from './_lib/sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_PATH  = path.join(ROOT, 'data', 'source', 'fandom-tenders.json');
const SCRIPT    = 'fandom-tenders';
const API       = (page) =>
  `https://london-bus-routes.fandom.com/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;

// Years to fetch: last year + this year (+ next, for the January overlap
// when a December bulletin lands on next year's page early). Older years
// are fully covered by TfL's own register.
const YEARS = (() => {
  const y = new Date().getUTCFullYear();
  return [y - 1, y, y + 1];
})();

// ── Wikitext helpers ────────────────────────────────────────────────────────
const cleanCell = (s) => String(s ?? '')
  .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')   // [[Route 102|102]] → 102
  .replace(/<br\s*\/?>/gi, '/')                       // N-route pairing "21<br>N21"
  .replace(/'''?/g, '')
  .replace(/<[^>]+>/g, '')
  .trim();

// Parse one `{| … |}` wikitable into a rowspan-expanded grid of cell strings.
function parseTable(tableBody) {
  const rawRows = [[]];
  for (const line of tableBody.split('\n').map(l => l.trim())) {
    if (line.startsWith('|-')) { rawRows.push([]); continue; }
    if (line.startsWith('!') || (line.startsWith('|') && !line.startsWith('|}'))) {
      // split inline `||` / `!!` cell separators
      for (const part of line.slice(1).split(/\|\||!!/)) rawRows[rawRows.length - 1].push(part);
    }
  }
  const grid = [];
  const pending = {};   // column index → { remaining, value } from rowspans
  for (const rr of rawRows) {
    if (!rr.length) continue;
    const row = [];
    let col = 0, ci = 0;
    while (ci < rr.length || pending[col]) {
      if (pending[col]) {
        row.push(pending[col].value);
        if (--pending[col].remaining <= 0) delete pending[col];
        col++;
        continue;
      }
      const raw = rr[ci++];
      // attribute prefix (`rowspan="3" |value`) — attrs end at the first `|`
      const m = /^\s*((?:[a-z]+="[^"]*"\s*)+)\|(.*)$/.exec(raw);
      const attrs = m ? m[1] : '';
      const value = cleanCell(m ? m[2] : raw);
      const rs = parseInt(/rowspan="(\d+)"/.exec(attrs)?.[1] ?? '1', 10);
      row.push(value);
      if (rs > 1) pending[col] = { remaining: rs - 1, value };
      col++;
    }
    if (row.some(c => c)) grid.push(row);
  }
  return grid;
}

const MONTHS = { january:1, february:2, march:3, april:4, may:5, june:6,
                 july:7, august:8, september:9, october:10, november:11, december:12 };
function headingToIso(h) {
  const m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(h.trim());
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${String(mon).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

const money = (s) => {
  const t = String(s ?? '').replace(/£|,/g, '').trim();
  return /^\d+$/.test(t) ? parseInt(t, 10) : null;
};

// Parse one year page's wikitext into award entries.
function parsePage(wikitext, pageName) {
  const entries = [];
  // split on the == D Month YYYY == section headings
  const sections = wikitext.split(/^==\s*(.*?)\s*==\s*$/m);
  for (let i = 1; i < sections.length; i += 2) {
    const awardDate = headingToIso(cleanCell(sections[i]));
    if (!awardDate) continue;                       // non-bulletin section
    const body = sections[i + 1] ?? '';
    const tables = [...body.matchAll(/\{\|([\s\S]*?)\|\}/g)].map(m => parseTable(m[1]));
    if (!tables.length) continue;
    // table 0: route | current op | new op | PVR | vehicles (header row first)
    // table 1 (optional): route | bidders | winner | accepted | lowest | highest | £/mile
    const bidByRoute = {};
    if (tables[1]) for (const row of tables[1].slice(1)) if (row.length >= 4) bidByRoute[row[0]] = row;
    for (const row of tables[0].slice(1)) {
      if (row.length < 3 || !row[0]) continue;
      const route = row[0].toUpperCase();
      const bid = bidByRoute[row[0]];
      entries.push({
        award_date:        awardDate,
        route_id:          route,
        current_operator:  row[1] || null,
        awarded_operator:  row[2] || null,
        pvr:               /^\d+$/.test(row[3] ?? '') ? parseInt(row[3], 10) : null,
        vehicles:          (row[4] || '').replace(/\*+$/, '').trim() || null,
        accepted_bid:      bid ? money(bid[3]) : null,   // flagged tier — carried, never bids beyond it
        source_page:       pageName,
      });
    }
  }
  return entries;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const entries = [];
  const pages = [];
  for (const year of YEARS) {
    const page = `Tender_Results_${year}`;
    process.stdout.write(`  ${page} ... `);
    try {
      const res = await fetchWithTimeout(API(page), { headers: userAgentHeaders(SCRIPT) });
      if (!res.ok) { console.log(`HTTP ${res.status} — skipped`); continue; }
      const j = await res.json();
      const wikitext = j?.parse?.wikitext?.['*'];
      if (!wikitext) { console.log(j?.error?.code === 'missingtitle' ? 'not created yet' : 'no wikitext — skipped'); continue; }
      const got = parsePage(wikitext, page);
      entries.push(...got);
      pages.push(page);
      console.log(`${got.length} awards`);
    } catch (err) {
      console.log(`failed: ${err.message}`);
    }
  }

  if (!entries.length) {
    // Keep last-known-good: a challenge-walled or reshaped wiki must not
    // wipe the supplementary feed.
    console.log('No entries parsed — keeping the existing file (last known good).');
    return;
  }

  entries.sort((a, b) => a.award_date.localeCompare(b.award_date) || a.route_id.localeCompare(b.route_id));
  const payload = sanitizeRecord({
    generatedAt: new Date().toISOString(),
    source: 'london-bus-routes.fandom.com Tender Results pages (community-maintained, via MediaWiki API)',
    pages,
    count: entries.length,
    entries,
  });

  // Content-stable write (compare ignoring generatedAt) so quiet runs don't
  // churn the workflow's change-gated commit.
  const stable = (o) => JSON.stringify({ ...o, generatedAt: null });
  let unchanged = false;
  if (fs.existsSync(OUT_PATH)) {
    try { unchanged = stable(JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))) === stable(payload); }
    catch { /* unreadable prior file — rewrite */ }
  }
  if (unchanged) {
    console.log(`${entries.length} awards across ${pages.length} pages — unchanged, not rewriting`);
  } else {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(payload), 'utf8');
    console.log(`Wrote ${entries.length} awards across ${pages.length} pages to ${OUT_PATH}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
