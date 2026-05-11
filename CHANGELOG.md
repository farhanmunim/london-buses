# Changelog

All notable changes to **London Buses**, summarised by release.

Tags: **NEW** new feature · **FIX** bug fix · **DATA** pipeline / data source change · **UX** user-facing improvement.

---

## Upcoming

- Analytics page reading from the Supabase historical store (fleet-age trend, electrification, operator share, EWT/OTP movement around tender events, operator churn).

---

## v2.9 — Data-quality audit, pipeline hardening

_2026-05-11_

- **NEW** Systematic data-quality audit (`scripts/audit-data.js`) walks every record in `route_classifications`, `vehicle-fleet`, `garages.geojson`, `route-vehicles`, and `route-mps` against per-field plausibility constraints. Three severities — CRITICAL hard-fails the weekly refresh so broken data never gets committed; WARN is logged for human review; INFO records coverage stats. Report committed weekly to `data/audit/data-quality.json` so regressions are diffable. Wired into `refresh.js` as step 16 of 17.
- **FIX** PDF parser was rejecting every TfL QSI/MPS/programme PDF since pdfjs-dist 4.x added an explicit `Buffer` rejection (Buffer is a Uint8Array subclass so the old `instanceof` check passed it through unchanged). Now converted to a plain Uint8Array view at the call site. Unblocks all 662 per-route MPS PDFs and 481 entries across 10 years of tender programme PDFs — both had been silently failing for weeks.
- **FIX** Vehicle-fleet was sending bonnet numbers and `TMP*****` placeholders to DVLA, which rejected 26 % of the fleet (3,262 entries) with HTTP 400. Parser now filters to UK-VRM-shaped strings at parse time and the cache loader prunes pre-existing junk on every run. Fleet 12,663 → 9,401 valid registrations.
- **FIX** MPS error rows were treated as fresh under the 28-day TTL — every parse_error entry persisted until the TTL expired. `isFresh` now also requires `status === 200 || 404`.
- **FIX** `typeCounts` were over-counting by 1 — EL1 was both `twentyfour` and prefix-shaped, counted in both buckets. Buckets are now mutually exclusive (prefix wins over twentyfour/night/school); sum now matches total exactly.
- **FIX** Route fleet aggregator was averaging avg-age across all observed vehicles regardless of drivetrain — a 14-year-old diesel reserve briefly covering an electric route would skew the headline age by 1-2 years. Aggregator now filters to vehicles matching the dominant propulsion. Route 339 went from 4.8 y to 2.9 y on this fix alone.
- **FIX** TfL tender form occasionally pastes the full annual bid into the cost-per-mile cell (route 290 2006, route 265 2022 etc.) producing £4M/mile headlines. `fetch-tenders.js` now clamps to £0..200 at parse and retro-sanitises the existing cache on load.
- **FIX** Garages were duplicated by code (BN/BT/UX listed twice with split allocations). Now deduped, taking the higher-PVR row and unioning the route fields so neither side's allocation is lost. Also filters out placeholder out-of-London depots (Falcon Coaches Byfleet, First Purfleet, Sullivan Thorpe Park, etc.) that have no TfL code AND zero PVR. 89 → 81 garage features.
- **FIX** `pvr=0` was propagating through the `??` fallback chain from last-known-good. Now coerced to null anywhere it appears.
- **FIX** TfL's MPS and QSI Performance PDFs occasionally disagree on a route's service class (H25 being the canonical case). `serviceClass` precedence is now MPS PDF (contractual) over performance PDF (measurement); the wrong-class metric is forced to null when serviceClass is known.
- **FIX** School routes default to `deck=single` and `propulsion=diesel` when every upstream source returned null (London school services are uniformly single-deck diesel minibuses/coaches).
- **FIX** `fetch-route-details.js` was hard-failing the whole step if details.htm returned no `<pre>` blocks (upstream HTML shape change). Now degrades gracefully, keeping garages-derived fields.
- **DATA** New `data/audit/data-quality.json` artefact — full weekly report.
- **CI** Weekly refresh workflow's `git push` now retries up to 3 times with `git pull --rebase --autostash` between attempts. Eliminates the race where a manual push or another workflow lands on `main` between checkout and push.
- **CI** New `supabase-heartbeat.yml` workflow — twice-weekly (Thu+Sun 12:00 UTC) PostgREST read against `route_snapshots` to keep the free-tier Supabase project from auto-pausing on the 7-day inactivity timer.

---

## v2.8 — MPS standards, contract start dates, ingress sanitisation

_2026-05-01_

- **NEW** Contractual EWT / OTP / Mileage standards per route, from TfL's per-route QSI PDFs. EWT MPS observed range 0.7–1.4 min; OTP MPS 74–90 %. New "MPS" KPI tile sits next to the actual EWT / OTP so contract-vs-actual reads at a glance.
- **NEW** Contract start date on the route card (~700 / 747 routes covered). Sourced from londonbusroutes.net `details.htm`, with the LBSL programme PDFs as backup.
- **NEW** Combined Tenders sheet in the XLSX export — historical awards (~2,500 since 2003) + upcoming programme entries in one stream, keyed by route + date with a `kind` column. Rows filter to the search-pinned routes when set.
- **NEW** Search pills in the topbar now drive the export — typing `25, 30, 100` and pressing Export emits a workbook restricted to those routes (Garages and Tenders sheets follow the same selection).
- **NEW** Build-time make/model alignment audit. Cross-checks DVLA-observed manufacturer against the lookup's chassis make for every route; logs a summary line and writes `data/source/make-alignment.json` with the per-route diff. Vehicle lookup expanded with verified `make` for every entry.
- **DATA** Defence-in-depth ingress sanitisation. New `scripts/_lib/sanitize.js` strips HTML tags, control characters and oversized payloads from every freeform string before it lands in the JSON cache. Wired into all 11 fetchers and all build-step writers, so the public artefacts can never carry hostile markup even if an upstream source changes shape.
- **DATA** Pipeline shared-helpers extraction. `scripts/_lib/` gains `http.js` (`fetchWithTimeout`, `headLastModified`, canonical User-Agent), `cache.js` (atomic JSON write, sticky-cache loader, SIGTERM flush hook), `pdf.js` (one-time pdfjs worker setup + position-aware row extraction). Every fetcher now routes through the shared helpers — all 11 weekly fetchers plus the on-demand audit script. ~200 LOC of duplication removed; User-Agent version drift fixed.
- **UX** Frontend palette dedupe. `OPERATOR_COLORS` now lives only in `js/map.js` and is imported by `stats.js` and `route-detail.js`. Previously each had its own copy and `stats.js`'s was missing Arriva London + Uno Buses, causing those operators to render as grey on stats panels while displaying the correct brand colour elsewhere.
- **FIX** Stops toggle button no longer lingers after clearing the route search. `clearAll()` now dispatches the `routefocuschange` event the toggles HUD listens for.
- **DATA** New `fetch-route-mps.js` step in the weekly pipeline (now 16 steps). Migration `0008_route_mps.sql` adds the MPS columns to `route_snapshots`.
- **FIX** Cost-per-mile reader was misreading European decimal commas (`6,25` was becoming `625`). 3 historical awards corrected; manual override added for the one TfL-side typo we can't auto-correct.
- **UX** Joint bid row now always shows Yes / No (was previously hidden when "No"). Tender section restructured into Current / Previous; tooltip system rolled out across every route-card label.

---

## v2.7 — Tender data on every route card

_2026-04-30_

- **NEW** Tender history surfaces on every route card: previous operator, awarded vehicle, cost per mile, contract length, total awards, bids received, joint bid flag.
- **NEW** Card restructured into Route / Fleet / Tender · Current / Tender · Previous sections.
- **DATA** ~2,500 historical tender awards (back to 2003) and 10 years of upcoming-tender programme PDFs refreshed weekly. Tender-history operator names now roll up to the parent group (Docklands → Go-Ahead, Selkent → Stagecoach, etc.).
- **PERF** Three pipeline short-circuits (`HEAD`-first checks for the geometry ZIP, the QSI PDF, and the programme PDFs) cut weekly runtime by ~70 % when upstream data hasn't moved.

---

## v2.6 — Frequency rules & propulsion fix

_2026-04-28_

- **NEW** Frequency band collapsed to binary: H = 5+ buses/hour, L = fewer.
- **FIX** 11 routes (D7, D8, 58, 187, 228, 251, 276, 314, 316, 384, 487) corrected from "diesel" to "electric" — `BZL` fleet code wasn't in the EV regex.
- **DATA** Tier-3 frequency fallback reads headways straight from `details.htm` when both TfL Timetable API and the per-route HTML grid yield null.

---

## v2.5 — Network Overview & operator / garage drawers

_2026-04-24_

- **NEW** Network Overview panel — KPI tiles (Routes / Operators / Garages / PVR), clickable per-operator table, PVR-weighted Fleet Mix.
- **NEW** Operator drawer (Routes operated · Garages · PVR · % of network) and Garage drawer (Routes · PVR · % of network) with a "View all routes" CTA.
- **NEW** Global Clear-all button resets every filter, marker and search in one click.
- **NEW** XLSX export gains a Fleet Mix block in the Network overview sheet.
- **NEW** Direction toggle on single-route cards (outbound ⇄ inbound).

---

## v2.4 — Stops baked in, bus-stop filter

_2026-04-23_

- **NEW** Bus-stop filter — search any stop and filter the network to routes serving it.
- **DATA** Stops now baked weekly into `stops.json` + `route_stops.json` (no runtime TfL API calls for stop data).

---

## v2.3 — Night-route frequencies & pipeline slimming

_2026-04-21_

- **FIX** All 120 night routes now resolve a frequency band. TfL encodes after-midnight departures as hour ≥ 24; the previous code didn't wrap so every night journey landed at 1400+ minutes.
- **DATA** Pipeline slimmed from 11 → 8 steps; removed unused outputs (route summary CSV, PVR aggregates JSON, stops GeoJSON).
- **NEW** Garage popup gains an Electrification row (% of garage's PVR run by electric routes).

---

## v2.2 — TfL-first data pipeline

_2026-04-17_

- **DATA** TfL Unified API as primary source for routes, destinations, timetables and stops. Fallbacks engage only when the API is sparse.
- **NEW** Per-route HTML grid fallback for frequency when the API is silent.
- **FIX** Multiple correctness improvements to operator and garage attribution.

---

## v2.0 — Operator garages, split filters, multi-sheet export

_2026-04-15_

- **NEW** Operator-coloured garage markers on the map.
- **NEW** Split filter design — Routes / Garages tabs in the sidebar.
- **NEW** XLSX export with three sheets (Routes / Garages / Network overview).

---

## v1 — Foundation

_2026-04-13 → 2026-04-14_

The initial v1.0 → v1.8 series established the core map, data pipeline and route detail experience.

- **NEW** Interactive map of every London bus route (~700) with route-type colouring.
- **NEW** Route search with autocomplete; click-map identify tool to find nearby routes.
- **NEW** Route detail panel — number, endpoints, stop count, direction toggle, operator, garage, vehicle type, deck, propulsion, frequency, length.
- **NEW** Filter system (route type, operator, deck, propulsion, frequency) with live filtering.
- **NEW** Multi-route selection via pill-based input; export filtered routes to CSV.
- **NEW** Per-operator statistics panel (Routes %, PVR %, EV %).
- **NEW** Manual override system (`data/route-overrides.json`) — any field can be hand-edited and wins over data.
- **DATA** Weekly automated GitHub Actions pipeline; auto-deploys to Cloudflare Pages.
- **DATA** API key moved to environment variables; modular module architecture.
