/**
 * fetch-tenders.js -- TfL bus tender award results.
 *
 * Source:
 *   https://tfl.gov.uk/forms/13923.aspx       -- discovery page; the route
 *                                                dropdown lists every awarded
 *                                                tender as <option value="ID">.
 *   https://tfl.gov.uk/forms/13796.aspx?btID= -- per-tender result page.
 *
 * Each btID maps to one historical award event. ~2500 in total, going back to
 * the early 2000s. Awards are immutable -- once a row is in the cache we never
 * re-fetch it, so steady-state runs only pull the handful of new btIDs
 * TfL added since last run.
 *
 * WAF note: since 2026-08-28 tfl.gov.uk/forms/* sits behind a Cloudflare
 * managed challenge (cf-mitigated: challenge) that 403s every plain HTTP
 * client. When plain-fetch discovery is blocked the crawl falls back to
 * headless Chromium (playwright-core; system Chrome on CI runners), which
 * clears the challenge non-interactively and then crawls sequentially.
 *
 * Output: data/source/tenders.json (force-committed across runs)
 *   {
 *     generatedAt, totalKnownIds, newThisRun,
 *     tenders: { [btID]: { route_id, award_announced_date, awarded_operator,
 *                          number_of_tenderers, accepted_bid, lowest_bid,
 *                          highest_bid, cost_per_mile, reason_not_lowest,
 *                          joint_bids, notes, source_url, scraped_at } }
 *   }
 *
 * Encoding note: every label-matching lookup uses prefix/substring regex
 * instead of literal column names so the script is robust to encoding drift
 * (Windows-1252 vs UTF-8) when an editor re-saves the file. Avoid embedding
 * non-ASCII characters in this file directly.
 *
 * Run: npm run fetch-tenders
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeText } from './_lib/sanitize.js';
import { fetchWithTimeout, userAgentHeaders }                 from './_lib/http.js';
import { loadJsonCache, atomicWriteJson, installSignalFlush } from './_lib/cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_PATH  = path.join(ROOT, 'data', 'source', 'tenders.json');

const DISCOVERY_URL = 'https://tfl.gov.uk/forms/13923.aspx';
const RESULT_URL    = (id) => `https://tfl.gov.uk/forms/13796.aspx?btID=${id}`;
const SCRIPT        = 'tenders';
const CONC          = 4;
const REQS_PER_MIN  = 200;            // ~3.3 RPS -- polite rate against TfL
const FLUSH_EVERY   = 100;            // periodic cache flush so a CI timeout doesn't lose progress
const MAX_PER_RUN   = 4000;           // hard cap; cold-start week takes one extended run

async function fetchText(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    // TfL's WAF intermittently 403s datacenter traffic (first seen
    // 2026-08-28 from GitHub runners). Identifying UA first; retries add
    // browser-ish Accept headers and jittered backoff for the transient
    // cases — a hard policy block still surfaces as the final error.
    const headers = attempt === 1
      ? userAgentHeaders(SCRIPT)
      : { ...userAgentHeaders(SCRIPT), Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-GB,en;q=0.9' };
    try {
      const res = await fetchWithTimeout(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, attempt * 3000 + Math.random() * 2000));
    }
  }
}

// Browser-mode crawling. TfL put tfl.gov.uk/forms/* behind a Cloudflare
// managed challenge (response carries `cf-mitigated: challenge`; first seen
// 2026-08-28) that 403s every plain HTTP client regardless of headers — the
// challenge needs a real JS-executing browser to pass. When plain-fetch
// discovery is blocked, the whole crawl retries through headless Chromium
// (playwright-core + the CI runner's system Chrome). The challenge clears
// once per context, so subsequent navigations in the same context are
// ordinary page loads.
let _browser = null, _page = null;

async function browserStart() {
  const { chromium } = await import('playwright-core');
  const candidates = [
    process.env.TENDERS_BROWSER ? { executablePath: process.env.TENDERS_BROWSER } : null,
    { channel: 'chrome' },                        // GitHub runners: preinstalled Chrome stable
    { executablePath: '/opt/pw-browsers/chromium' },
  ].filter(Boolean);
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  // Cloudflare's challenge scores automation fingerprints: navigator.webdriver
  // (removed by disabling Blink's AutomationControlled feature) and the
  // HeadlessChrome UA. CI sets TENDERS_HEADFUL=1 and runs under xvfb-run so
  // a real headful Chrome renders the page — headless mode stayed flagged
  // ("challenge not cleared") on GitHub runners even with a clean IP.
  const headless = !process.env.TENDERS_HEADFUL;
  const args = ['--disable-blink-features=AutomationControlled'];
  let lastErr = null;
  for (const opts of candidates) {
    try { _browser = await chromium.launch({ headless, args, proxy, ...opts }); break; }
    catch (err) { lastErr = err; }
  }
  if (!_browser) throw lastErr ?? new Error('no Chromium available for browser-mode fetch');
  const ctx = await _browser.newContext({ locale: 'en-GB', viewport: { width: 1366, height: 900 } });
  _page = await ctx.newPage();
}

async function browserStop() {
  try { await _browser?.close(); } catch { /* already gone */ }
  _browser = _page = null;
}

// Navigate and return the settled DOM. waitSelector rides through the
// challenge interstitial's auto-reload; when it never appears the content
// is returned anyway and the caller's parser decides.
async function browserFetchHtml(url, waitSelector, timeoutMs = 60_000) {
  await _page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  if (waitSelector) await _page.waitForSelector(waitSelector, { timeout: timeoutMs }).catch(() => {});
  return await _page.content();
}

async function discoverTenderIdsBrowser() {
  const html = await browserFetchHtml(DISCOVERY_URL, '#BusTenderSearch_ddl_btID');
  if (!html.includes('id="BusTenderSearch_ddl_btID"')) {
    // Diagnose what Cloudflare actually served so a persistent failure in
    // CI logs says whether we're stuck on the interstitial ("Just a
    // moment..."), got a block page, or something else entirely.
    const title = await _page.title().catch(() => '?');
    const text = (await _page.evaluate(() => document.body?.innerText ?? '').catch(() => ''))
      .replace(/\s+/g, ' ').slice(0, 160);
    throw new Error(`challenge not cleared (title "${title}"; body: ${text})`);
  }
  return parseDiscoveryHtml(html);
}

// Discovery: pull every option value from the route dropdown
async function discoverTenderIds() {
  const html = await fetchText(DISCOVERY_URL);
  return parseDiscoveryHtml(html);
}

function parseDiscoveryHtml(html) {
  const ids = [];
  const seen = new Set();
  // Only options inside the route-id dropdown (not the tranche/date dropdowns)
  const dropdownStart = html.indexOf('id="BusTenderSearch_ddl_btID"');
  if (dropdownStart === -1) throw new Error('Route dropdown not found on discovery page');
  const dropdownEnd = html.indexOf('</select>', dropdownStart);
  const block = html.slice(dropdownStart, dropdownEnd);
  for (const m of block.matchAll(/<option\s+value="(\d+)"[^>]*>([^<]+)<\/option>/g)) {
    const id = parseInt(m[1], 10);
    const label = m[2].trim().replace(/^Route\s+/i, '');     // "Route 1/N1" -> "1/N1"
    if (!seen.has(id)) { seen.add(id); ids.push({ id, label }); }
  }
  return ids;
}

// Per-tender parser
function stripTags(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&pound;|Â£/g, 'GBP_')   // normalise pound sign to a token we never literally search
    .replace(/\s+/g, ' ')
    .trim();
}

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function parseTenderersCount(s) {
  if (!s) return null;
  const t = String(s).trim().toLowerCase();
  if (NUM_WORDS[t] != null) return NUM_WORDS[t];
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

function parseMoney(s) {
  if (!s) return null;
  // Strip pound token + whitespace. Comma handling is more nuanced: TfL's
  // tender pages mix two conventions in the same column —
  //   '4,205,196'  → thousands separators  → 4205196
  //   '6,25'       → European decimal mark → 6.25
  // The decimal-comma form is "a single comma with 1-2 digits after and no
  // other commas or dots". Anything else gets the standard thousands strip.
  // Bug fix: previously every comma was stripped, turning '6,25' into 625
  // (caused outliers in cost_per_mile for btID 1521 / 1148 / 2073, etc.).
  let cleaned = String(s).replace(/GBP_|\s/g, '');
  if (/^-?\d+,\d{1,2}$/.test(cleaned)) cleaned = cleaned.replace(',', '.');
  else                                  cleaned = cleaned.replace(/,/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  return parseFloat(cleaned);
}

function parseAwardDate(s) {
  // "01 July 2009" -> "2009-07-01"
  if (!s) return null;
  const m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  const mo = months[m[2].slice(0, 3).toLowerCase()];
  if (!mo) return null;
  const day = String(m[1]).padStart(2, '0');
  const month = String(mo).padStart(2, '0');
  return `${m[3]}-${month}-${day}`;
}

// Look up a label by case-insensitive prefix so encoding mojibake on the
// pound sign or stray whitespace doesn't break matching.
function rowByPrefix(rows, prefix) {
  const target = prefix.toLowerCase();
  for (const k of Object.keys(rows)) {
    if (k.toLowerCase().startsWith(target)) return rows[k];
  }
  return null;
}

function parseTenderHtml(html, btId) {
  // Header line: "Route X/N1 - award announced <span ...>DATE</span>"
  const headerRe = /<strong>\s*Route\s+([^<]+?)\s*-\s*award announced\s*<span[^>]*>([^<]+)<\/span>\s*<\/strong>/i;
  const headerM = headerRe.exec(html);
  const routeId = headerM ? headerM[1].trim() : null;
  const awardDate = headerM ? parseAwardDate(headerM[2].trim()) : null;

  // The detail table - class="tenderResults"
  const tableM = /<table\s+class="tenderResults"[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!tableM) return null;

  const rows = {};
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm;
  while ((rm = rowRe.exec(tableM[1])) !== null) {
    const cells = [...rm[1].matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/\1>/gi)];
    if (cells.length < 2) continue;
    const label = stripTags(cells[0][2]);
    const value = stripTags(cells[1][2]);
    if (label) rows[label] = value;
  }

  // Defence-in-depth: every freeform field from the TfL form passes through
  // sanitizeText so any embedded HTML / control chars / oversized payloads
  // never reach the JSON cache. Numeric / known-shape fields skip this
  // (parseMoney etc. already enforce shape).
  return {
    route_id:               sanitizeText(routeId, { maxLen: 64 }),
    award_announced_date:   awardDate,
    awarded_operator:       sanitizeText(rowByPrefix(rows, 'Successful Tenderer'),         { maxLen: 200 }),
    number_of_tenderers:    parseTenderersCount(rowByPrefix(rows, 'Number of Tenderers')),
    accepted_bid:           parseMoney(rowByPrefix(rows, 'Accepted Bid')),
    lowest_bid:             parseMoney(rowByPrefix(rows, 'Lowest Individual Compliant Bid')),
    highest_bid:            parseMoney(rowByPrefix(rows, 'Highest Individual Compliant Bid')),
    // Sanity-clamp cost_per_mile. TfL's tender form occasionally has the
    // full annual bid pasted into this cell instead of the per-mile rate
    // (seen on btID 1521, 1148, 2073, 290 (2006), 265 (2022)). Real rates
    // span £3-15 for regular passenger routes and up to ~£100 for school
    // routes. Anything over 200 is a column-mix-up — drop it rather than
    // surface a £4.2M-per-mile headline in the UI.
    cost_per_mile:          (v => (v != null && v >= 0 && v <= 200 ? v : null))(
                              parseMoney(rowByPrefix(rows, 'Cost per live mile'))
                            ),
    reason_not_lowest:      sanitizeText(rowByPrefix(rows, 'Reason for not awarding'),     { maxLen: 1000 }),
    joint_bids:             sanitizeText(rowByPrefix(rows, 'Joint Bids'),                  { maxLen: 1000 }),
    notes:                  sanitizeText(rowByPrefix(rows, 'Notes'),                       { maxLen: 2000 }),
    source_url:             RESULT_URL(btId),
    scraped_at:             new Date().toISOString(),
  };
}

// Cache I/O — load + atomic flush via `_lib/cache.js`.
function loadCache() {
  const j = loadJsonCache(OUT_PATH, {});
  const tenders = j.tenders ?? {};
  // Retro-sanitise pre-existing records. The cost_per_mile clamp in
  // parseTenderHtml only protects future scrapes; entries already cached
  // (e.g. btID for route 290 2006, route 265 2022) with absurd values like
  // 4,205,196 (the full annual bid pasted into the per-mile cell at TfL)
  // sit forever otherwise. Clearing them to null tells the build step "we
  // don't have a reliable rate for this tender" rather than surfacing a
  // £4.2M/mile headline.
  let clamped = 0;
  for (const rec of Object.values(tenders)) {
    if (rec.cost_per_mile != null && (rec.cost_per_mile < 0 || rec.cost_per_mile > 200)) {
      rec.cost_per_mile = null;
      clamped++;
    }
  }
  if (clamped) console.log(`  Sanitised ${clamped} cached cost_per_mile outlier(s)`);
  return { tenders };
}
function flushCache(cache, totalKnown, newThisRun) {
  atomicWriteJson(OUT_PATH, {
    generatedAt:   new Date().toISOString(),
    totalKnownIds: totalKnown,
    newThisRun,
    tenderCount:   Object.keys(cache.tenders).length,
    tenders:       cache.tenders,
  });
}

// Main
async function main() {
  console.log(`Discovering tender IDs from ${DISCOVERY_URL} ...`);
  let allIds;
  let browserMode = false;
  try {
    allIds = await discoverTenderIds();
  } catch (err) {
    // Plain fetch is 403'd by the Cloudflare challenge — fall back to a
    // real headless browser, which passes the challenge non-interactively.
    console.warn(`  Plain-fetch discovery blocked (${err.message}) — retrying via headless Chromium.`);
    try {
      await browserStart();
      allIds = await discoverTenderIdsBrowser();
      browserMode = true;
      console.log('  Browser-mode discovery succeeded (Cloudflare challenge cleared).');
    } catch (err2) {
      await browserStop();
      // Awards are immutable and append-only, so a blocked discovery loses
      // nothing permanent — with a warm cache this run is a graceful no-op
      // rather than a red workflow email. The data-quality audit warns when
      // tenders.json's generatedAt goes stale, so a *persistent* block
      // still surfaces. A cold start (no cache) must fail loudly.
      const cached = loadCache();
      if (Object.keys(cached.tenders).length) {
        console.warn(`  Browser discovery also failed (${err2.message}) — serving ${Object.keys(cached.tenders).length} cached awards, no refresh this run.`);
        return;
      }
      throw err2;
    }
  }
  console.log(`  ${allIds.length} tender IDs in dropdown`);

  const cache = loadCache();
  const known = new Set(Object.keys(cache.tenders).map(s => parseInt(s, 10)));
  // Browser mode is one sequential page — cap the backlog per run so a
  // large catch-up spreads over a few scheduled runs instead of hitting
  // the workflow timeout. Steady state (a handful of new btIDs) never hits it.
  const cap = browserMode ? Math.min(MAX_PER_RUN, 250) : MAX_PER_RUN;
  const toFetch = allIds.filter(({ id }) => !known.has(id)).slice(0, cap);
  console.log(`Cache holds ${known.size} tenders; ${toFetch.length} new this run (cap ${cap}${browserMode ? ', browser mode' : ''})`);

  if (!toFetch.length) {
    console.log('Cache fully warm -- nothing to fetch.');
    flushCache(cache, allIds.length, 0);
    await browserStop();
    return;
  }

  let fetched = 0, errored = 0;

  // SIGTERM handler: flush before exit so a CI timeout never loses progress.
  installSignalFlush(() => flushCache(cache, allIds.length, fetched));

  const minIntervalMs = Math.ceil(60_000 / REQS_PER_MIN);
  let nextSlot = Date.now();
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= toFetch.length) break;
      const { id, label } = toFetch[i];

      const wait = nextSlot - Date.now();
      nextSlot = Math.max(Date.now(), nextSlot) + minIntervalMs;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      try {
        const html = browserMode
          ? await browserFetchHtml(RESULT_URL(id), 'table.tenderResults', 45_000)
          : await fetchText(RESULT_URL(id));
        const parsed = parseTenderHtml(html, id);
        if (parsed) {
          // Prefer the dropdown label as canonical route_id when the result
          // body's header is missing or shaped weirdly.
          parsed.route_id = parsed.route_id ?? label;
          cache.tenders[id] = parsed;
          fetched++;
        } else {
          errored++;
        }
      } catch (err) {
        errored++;
      }

      if ((fetched + errored) % FLUSH_EVERY === 0) {
        flushCache(cache, allIds.length, fetched);
        console.log(`  ${fetched + errored}/${toFetch.length}  ok=${fetched} err=${errored}  (cache flushed)`);
      }
    }
  }
  // A browser context is a single page — navigations must be sequential.
  await Promise.all(Array.from({ length: browserMode ? 1 : CONC }, worker));

  flushCache(cache, allIds.length, fetched);
  await browserStop();
  console.log(`Done: ok=${fetched}  err=${errored}  total cached=${Object.keys(cache.tenders).length}`);
}

main().catch(async err => { await browserStop(); console.error('Fatal:', err); process.exit(1); });
