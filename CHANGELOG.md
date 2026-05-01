# Changelog

All notable changes to **London Buses** are listed here.

---

## Upcoming

- **Analytics page** — `/analytics` reading directly from Supabase via the anon key (RLS-locked to read-only). Charts under consideration: fleet-age trend, operator share over time, electrification curve, EWT/OTP movement around tender events, and per-route operator churn.

---

## v2.7 – Tender data & pipeline short-circuits

_2026-04-30_

- **Tender award history surfaced on every route card.** The placeholder rows (Previous operator / Contract expires / Contract value) are now wired up. `build-classifications.js` joins `data/source/tenders.json` (~2,500 historical awards back to 2003) and `data/source/tender-programme.json` (upcoming tender schedule from the LBSL programme PDFs) to compute per-route `previousOperator`, `lastAwardDate`, `lastCostPerMile`, `nextTenderStart`, `nextTenderYear`, plus six high-signal additions: `tenderAwardCount` (awards on file), `numberOfTenderers` (bids received), `wasJointBid` (Yes/No), `contractTermYears` (note-derived → date-derived fallback), `awardedPropulsion`/`awardedDeck` and `prevAwardedPropulsion`/`prevAwardedDeck` (so the card can show "Electric (double) — was Hybrid (double)" when a route changes spec), and `extensionEligible` (TfL's 2-year-extension marker from the programme PDF). Combined route IDs like `341/N341` automatically feed both the day route and its night sibling. "Previous operator" walks the sorted award list to find the most recent earlier operator that genuinely differs from the current incumbent.
- **Route card restructured into Route / Fleet / Tender·Last / Tender·Next sections.** KPI strip slimmed to 4 tiles (Type · PVR · Stops · Freq); per-section labels match the modal-section vocabulary. Tender rows that don't apply to a route (no joint bid, no spec change, no extension flag) are now hidden rather than rendered as `—`, so cards stay compact for routes with sparse tender data.
- **Tender-history operator names normalised** for display: subsidiary brands (Arriva London North, First London East, Abellio West London, Stagecoach East London, Metroline West, Go-Ahead London, …) fold into the parent brand for the "Previous operator" cell, while genuinely distinct historical brands (Tower Transit, Selkent, Blue Triangle, London Sovereign, Docklands Buses, …) stay verbatim. Three explicit UI states: a real predecessor name, "no change" (route re-awarded to the same operator), or "first award" / `XXX` (no prior history on file).
- **Tender data pushed to Supabase** with four derived columns on `public.tenders` — `propulsion_type`, `is_joint_bid`, `vehicles_basis`, `previous_operator` — and two on `public.tender_programme` (`propulsion_type`, `previous_operator`). All derivations run automatically in `push-to-supabase.js` from the existing notes / vehicle-type / award-date fields, then `data/tender-overrides.json` applies any manual corrections. Migrations 0006 + 0007.
- **Pipeline short-circuits** for the three fetchers that were doing unnecessary upstream work every weekly run:
  - **Geometry ZIP** (`fetch-data.js`) — lists S3, compares the latest ZIP date against `data/geometry-source.json::zipDate`, and skips the ~10 MB download + 700 file rewrites if unchanged. Runs in ~1 s on weeks where TfL hasn't republished (≈95% of weeks).
  - **Route performance PDF** (`fetch-route-performance.js`) — `HEAD` request first; skip the parse if `Last-Modified` matches the cached `pdfModifiedAt`. The QSI PDF only republishes every ~4 weeks (one TfL reporting cycle), so most weeks now exit in milliseconds.
  - **Tender programme PDFs** (`fetch-tender-programme.js`) — per-year `HEAD`; copies the cached entries forward unchanged when a closed financial year's PDF hasn't been re-uploaded. In steady state this drops 10 PDF parses to 1 (the active year).
  - All three accept `--force` for manual re-runs.
- **Truthful nulls in the build.** When a source file (`tenders.json`, `tender-programme.json`) loads cleanly but a route has no entries, the relevant fields write `null` rather than falling back to last-known-good — otherwise stale values from earlier runs persist forever. Last-known-good is reserved for the case where the source file itself is missing (i.e. the upstream scrape failed).
- **About → Contributors** — Daniel Plumb, Mark Leonard-Adoko, and Ross Levine added under the Developer section.

---

## v2.6 – Frequency rules, propulsion fix, headway tier-3 fallback

_2026-04-28_

- **Frequency band collapsed to binary**: `high` = 5+ buses/hour (≤12 min headway), `low` = fewer than 5/hour. The old three-band scheme (high ≤6 / regular 7–15 / low >15 min) is gone everywhere — `bandForHeadway` in `fetch-frequencies.js`, `FREQ_MAP` in the route card, the schema docs in `data.md` / `agent.md`, the filter pills in `index.html`, and all three data files (`frequencies.json`, `route_classifications.json`, `routes-overview.geojson`).
- **SL7 manually pinned to high frequency** in `data/route-overrides.json`. Its scraped Mon-Sat headway is 15 min so without the override the new rule would put it in `low`.
- **Propulsion fix for the BZL fleet code**. Stagecoach London / Metroline encode their MCV eVoSeti EV double-deckers and single-deckers as `BZL` in the `details.htm` vehicle column (e.g. `BZL (dd) 10.9m/MCV 2D`). The body string alone (`MCV`) has no EV marker and `cleanVehicleType` strips the `BZL` prefix, so `derivePropulsion` was defaulting to `diesel`. Added `\bBZL\b` to the EV regex; corrects 11 routes — D7, D8, 58, 187, 228, 251, 276, 314, 316, 384, 487 — to `electric`.
- **Pipeline now reads the headway columns from `details.htm` automatically**. New `representativeHeadway()` in `fetch-route-details.js` parses Mon-Sat / Sunday / evening cells (handling night-route layout where headways sit before the date, and skipping school routes whose headway columns hold endpoint names instead of numbers). The value lands in `data/source/route_details.json` as `headwayMin` per route. `build-classifications.js` then uses it as a **tier-3 fallback** for `frequency` when both TfL `/Line/<id>/Timetable` (tier 1) and `times/<id>.htm` (tier 2) yield null. Same ≤12 cutoff as `bandForHeadway` so the binning rule is identical across all three tiers — the manual rebin done in this release reproduces automatically on every weekly refresh.
- **Filter pill tooltips reworded** to the new thresholds ("5 or more buses per hour" / "fewer than 5 buses per hour"); the redundant "Regular" filter pill removed.

---

## v2.5 – Network Overview & Full Design Overhaul

_2026-04-24_

- **Complete design overhaul**: Geist / Geist Mono typography, tokenised CSS (`--font-sans`, `--font-mono`, `--fs-*`, `--sp-*`, `--r-*`, `--t-fast`) across every component and page. Section labels, input pills, badges, and KPI tiles now share one visual language.
- **Network Overview panel** — right-rail tabs for **Overview** (4 KPI tiles: Routes / Operators / Garages / PVR, clickable by-operator table, Fleet Mix 100%-stacked bar by propulsion) and **Routes** (per-route cards with Type · PVR · Freq · Deck · Propulsion · Length + garage / vehicle / contract block).
- **Operator drawer** — tap any operator row to see Routes operated · Garages · PVR · % of network routes, a PVR-weighted Fleet Mix, and a clickable garage list.
- **Garage drawer** — same vocabulary (Routes operated · PVR · % of network PVR · % of network routes) plus a primary "View all routes operated here" CTA that populates the topbar with that garage's routes and renders them on the map.
- **Garage-selection pill** in the sidebar mirrors the bus-stop filter pattern; the X clears both the pill and the committed routes.
- **Global Clear All** — one topbar button (red accent pill) resets every filter, marker selection, stop filter, route pill and search in a single click, returning the right panel to Overview. Tab-scoped Clear filters / Clear selection sit in the sidebar live strip and only appear for their own tab.
- **Route-lines, Garages and Stops toggles** on the map canvas — Stops toggle only appears when a single route is focused (multi-route mode draws endpoint labels, not stops, so the button would be a no-op).
- **Route search parity** — topbar and Routes-tab inputs share one pipeline: Space / Comma / Enter commits a pill, Backspace drops the last, ↑/↓/Enter works on the autocomplete. Overflow collapses to a "+N" summary so long selections never push the placeholder out of the field.
- **XLSX export** now includes a **Fleet Mix** block in the Network overview sheet (PVR-weighted propulsion split).
- **Modals ported** — About and Roadmap share a common frame, width, header, support card and badge language; Roadmap stages render as pill-status badges (shipped / building / planned / idea).
- **Changelog page** — Vercel-style article list in the new shell, sticky topbar, fixed footer, flat-white light-mode surface, DM Sans → Geist fonts, inline theme toggle.
- **Favicon + brand mark aligned** — the red-square-with-bus SVG is identical in the browser tab, desktop topbar, changelog topbar, and mobile topbar.
- **Mobile responsiveness pass** — consolidated media queries at 760px using modern CSS (`clamp()`, `dvh`, `env(safe-area-inset-bottom)`, logical properties). The mobile menu was simplified to a compact topbar + drag-handle sheet + 4-tab bottom nav; the redundant peek-KPI strip, in-sheet tab strip, and central search FAB were removed. The Clear-all button, scoped Clear buttons, and live count strip all relocate into the mobile shell so mobile reaches every desktop action.
- **Version pill** now links to the changelog on every page.
- **Operator labels unified** — "Go-Ahead London" / "Stagecoach London" / etc. display as "Go-Ahead" / "Stagecoach" everywhere (operator table, drawer header, route-card pill).
- **Operator colour palette unified** — one canonical `OPERATOR_COLORS` map now drives map route lines, garage pins, sidebar filter-pill dots, operator-card swatches, drawer swatches, overview-table swatches and the route-card operator pill. Previously the map used brand livery colours and the rest of the UI used a separate design palette; now all eight operators render the same hue in every surface.
- **Drawer KPIs rethought** — subtitle under the drawer name is quieter (operator-only for garage view; empty for operator view); four shared slots show Routes operated · {Garages | PVR} · PVR · % of network routes. Operator and garage views share three of four KPIs so the vocabulary is consistent as you drill Network → Operator → Garage.
- **Direction toggle** on the route card — single-route mode only. A compact 22 × 22 icon-button next to the destination name flips outbound ⇄ inbound; the icon spins 180° one-shot on click, the `origin → destination` text updates in place, and the map re-renders in the new direction's colour.
- **Route-card KPIs** — grid is now Type · PVR · Stops · Freq · Deck · Propulsion (Length dropped). Stops reads the pre-baked per-route count from `route_stops.json` via a new O(1) `fetchRouteStopCount` helper in `api.js`.
- **Frequency vocabulary aligned** — filter pills and route-card "Freq" KPI both show **Low / Regular / High** instead of raw headway bands. Underlying data values (`low`/`regular`/`high`) unchanged; the raw headway ranges move into pill `title` tooltips.
- **Route card polish** — flatter KPI tiles (no inner borders), tighter padding, route number 22 → 18px, operator pill slimmer, tender rows separated by dividers rather than blocks. Calmer "data card" rhythm.
- **Mobile "Clear all" in the topbar** — the global reset button is relocated into `.mob-top` on mobile, so every action reachable from the desktop topbar is reachable on a phone. Scoped Clear buttons follow the same pattern inside the Filters tab.
- **Search pill overflow** — at >3 committed route pills, the topbar search collapses the overflow into a neutral `+N` counter (routes still accessible via individual `×` buttons on the visible pills) so the search input never gets pushed out of the field.
- **Mobile map HUD** — stacked vertically on the right edge at ≤760px so Route lines / Garages / Stops don't fight each other horizontally, and the Leaflet zoom moves to the bottom-left with safe-area padding.
- **Bus-stop search field design matches the topbar search** — pill radius, padding, focus ring and input shrink behaviour now identical across every search field.
- **Fixed a descendant-combinator CSS bug** in the light-mode changelog override (`[data-theme="light"] html.changelog-page` → `html.changelog-page[data-theme="light"]`). Validated with puppeteer — every surface on the changelog now computes to `#ffffff` in light mode.

---

## v1.0 – Core Map & Data Foundation

_2026-04-13_

- **Initial data pipeline**: Fetches and processes route geometry, stops, and destinations
- **Map rendering**: Displays routes with polylines and stop markers
- **On-demand route loading**: Per-route GeoJSON and metadata fetched dynamically
- **Basic route search**: Load and zoom to a selected route

---

## v1.1 – UI Foundation

_2026-04-13_

- **Sidebar layout**: Persistent, collapsible sidebar with map-first layout
- **Route detail panel**: Route number, endpoints, stop count, direction toggle
- **Search autocomplete**: Prefix-based suggestions with keyboard navigation

---

## v1.2 – Map Interaction & Visual Clarity

_2026-04-13_

- **Route type colours**: Visual distinction between service types
- **Map identify tool**: Click map to discover nearby routes and trigger search

---

## v1.3 – Filters & Data Exploration

_2026-04-13_

- **Filter system**: Route type, operator, deck type, and frequency
- **Live filtering**: Results update instantly based on active filters
- **CSV export**: Export filtered routes

---

## v1.4 – Extended Route Metadata

_2026-04-13_

- **Operator and garage data**: Added to classifications and shown in route detail

---

## v1.5 – Multi-Route Support

_2026-04-13_

- **Multi-route selection**: View multiple routes simultaneously
- **Pill-based input**: Add/remove routes quickly
- **Improved map clarity**: Overlapping routes visually separated

---

## v1.6 – Refinement & Simplification

_2026-04-13_

- **Removed unsupported filters**: Operator, deck type, and frequency dropped (not available from API)
- **Improved classification display**: More accurate service badges
- **State handling fixes**: Clearing search fully resets map and UI
- **Dynamic metadata**: “Last updated” and “Next update” driven by build data

---

## v1.7 – Data Pipeline Overhaul

_2026-04-13_

- **Fully API-driven system**: Removed all third-party CSV dependencies
- **Rebuilt classification logic**: Route type from API data + route patterns; length via geometry
- **Secure API handling**: API key moved to environment variables
- **Modular architecture**: Core UI split into focused modules
- **Automated updates**: Weekly pipeline with GitHub Actions + auto-deploy
- **Snapshot versioning**: Weekly GeoJSON archives with rolling retention
- **Unified build command**: Single command to run full pipeline

---

## v1.8 – Data Accuracy, Live Stops & Manual Overrides

_2026-04-14_

- **Live stop data**: Stops now fetched from the official API at runtime — removes a large static file and ensures always-current stop information
- **Case-insensitive route lookup**: Fixes missing inbound/outbound destinations on N-prefix routes
- **Operator statistics panel**: Per-operator table (Routes %, PVR %, EV %) shown in the default sidebar state
- **Dynamic stats**: Table updates live as filters are applied
- **Unknown filter chips**: Every optional filter group (Operator, Frequency, Deck, Propulsion) gains an Unknown chip so routes missing data are never silently hidden
- **Vehicle type lookup**: Curated mapping of vehicle type → deck + propulsion fills gaps where scraper data is incomplete
- **Manual route overrides**: `data/route-overrides.json` lets any field be hand-edited and wins over scraped data
- **Letter-only route IDs**: Scraper now picks up codes like `SCS` and `RV1`
- **UI polish**: Wider sidebar, hint moved into search placeholder, filter Clear button only shown when active, consistent service badge styling
- **Removed 24 hr filter**: Underlying data field no longer provided by the API
- **Hardened CI**: Correct write permissions, current runner versions, stops endpoint fix

---

## v2.3 – Pipeline Slimming, Night-Route Frequencies & Garage UX

_2026-04-21_

- **Night-route frequencies now populate correctly**. TfL encodes after-midnight departures as hour ≥ 24 (e.g. `24:18` = 00:18 next day, `28:08` = 04:08). Previous code multiplied them straight into 1400+ minutes so every night journey fell outside every band; the fix wraps with `h % 24`. Combined with a richer schedule-name classifier that recognises TfL labels like "Friday Night/Saturday Morning" and "Mo-Th Nights/Tu-Fr Morning", all 120 night routes (N1, N8, N12, N86, N128, …) now resolve a frequency band. For N-routes TfL doesn't list separately the builder falls back to the daytime alias's band (e.g. N12 → line 12).
- **Frequencies collapsed to one value per route**. `data/frequencies.json` is now a flat `{ routeId: "high" | "regular" | "low" }` map. Previously we stored five numeric headways per route (`peak_am, peak_pm, offpeak, overnight, weekend`) that nothing downstream consumed — the frontend only needs the band. Derivation moved from `build-classifications.js` into `fetch-frequencies.js`, with a weekday-offpeak → AM peak → PM peak → Saturday → overnight preference chain for picking the representative headway before binning (≤6 / 7–15 / >15 min).
- **Data pipeline slimmed from 11 → 8 steps**. Removed `fetch-stops.js` (stops are fetched live from TfL when a route is opened), `build-route-summary.js` (CSV had no consumer), `build-pvr-aggregates.js` (operator / electrification aggregates are computed client-side in `stats.js`). Deleted the files they produced (`stops.geojson`, `bus_stations.geojson`, `route_summary.csv`, `pvr_aggregates.json`), plus `manifest.json` and the dated `routes-overview-YYYY-MM-DD.geojson` snapshots that nothing read. Shipped data on disk now ~3–4 MB.
- **`refresh.js` orchestrator hardened**. Network-bound fetch steps now soft-fail so one flaky upstream (e.g. a transient socket close from londonbusroutes.net) doesn't abort the whole weekly run; downstream builders keep going with the previously-committed files and the last-known-good merge in `build-classifications.js`. Build steps still hard-fail — they should never crash in normal operation.
- **Classification record cleaned of dead denormalized fields** — `lengthKm`, `lengthMiles`, numeric per-band `frequencies`, and `destinations` are all removed. The frontend consumes the categorical band directly and fetches destinations from `route_destinations.json` separately.
- **Reference-app dependency removed**. `fetch-garages.js` no longer reads `reference/data/garages-base.geojson`; it only reuses the previously-committed `data/garages.geojson` as a geometry cache. Every data source the pipeline touches is now one of: TfL Unified API, TfL geometry S3 ZIP, londonbusroutes.net, bustimes.org, postcodes.io, Photon/Nominatim.
- **Garage popup polish**. "Total PVR" renamed to **PVR** (the word "peak" already implies "total"). New **Electrification** row shows the share of the garage's known PVR run by battery-electric routes (`electric PVR ÷ known PVR`, whole-percent). Denominator is the sum of per-route PVRs — not the CSV garage-wide total — so numerator and denominator stay consistent.
- **Garage highlight for focused routes**. When a single route is searched, the operating garage(s) now show a subtle permanent tooltip ("Operating from here") above the marker. Clears automatically when switching to multi-route mode or pressing Clear. Replaces an earlier pulsing-ring prototype that was too visually loud.
- **New `data.md` reference**. Comprehensive pipeline doc — sources, per-field precedence, known traps (including the night-route timestamp encoding), CI cadence, platform limits (TfL API, Cloudflare Pages, GitHub Actions, postcodes.io, Nominatim). Single source of truth for how data flows end-to-end.

---

## v2.2 – TfL-first Data Pipeline & Accuracy Overhaul

_2026-04-17_

- **TfL-first data sourcing**: Pipeline now uses the TfL Unified API as the authoritative source for route lists, destinations, stops, named bus/coach stations, and timetables. Scraping from londonbusroutes.net and bustimes.org is retained only as a fallback for routes TfL omits — TfL values are never overwritten by scraped values.
- **Fixed wrong route classifications**: Route 1 was tagged as a Bombardier CR4000 tram (operator "First", garage "Therapia Lane") because the previous scraper parsed `details.htm` by drifting fixed-width column offsets. Rewritten to join the authoritative `garages.csv` (operator / garage / PVR / vehicle) with a robust regex over `details.htm`. Mojibake like `Enviro400 MMC 2D�` is fixed via UTF-8 → Latin-1 fallback.
- **New destinations schema**: `data/route_destinations.json` now stores `{ destination, qualifier, full }` per direction (matches the reference implementation) instead of the previous `{ destination, originator }` which was leaking raw stop names.
- **Numeric frequencies**: New `data/frequencies.json` with mean headways per band (`peak_am`, `peak_pm`, `offpeak`, `overnight`, `weekend`) sourced from TfL `/Line/<id>/Timetable` with bustimes.org grid fallback for TfL-gap routes.
- **New datasets**: `data/stops.geojson` (all London bus stops from TfL `/StopPoint/Mode/bus`, gitignored — 4.7 MB), `data/bus_stations.geojson` (~50 named bus/coach stations), `data/garages.geojson` (authoritative garage CSV + postcodes.io geocoding), `data/route_summary.csv` (flattened spreadsheet view of every route).
- **Postcode-based garage geocoding**: Garage lat/lon now derived from UK postcodes via postcodes.io (bulk, unauthenticated) with results cached in `data/source/geocode_cache.json` — force-committed so weekly runs skip re-geocoding on a stable week.
- **Vehicle-lookup combinatorial matcher**: `build-classifications.js` now tries stripped variants (`2D`/`3D`, fleet prefix, size) so `B5LH/Gemini 3 2D` matches the canonical `B5LH/Gemini 3` key — closes ~55 missing deck/propulsion rows.
- **Pipeline grew to 10 steps**: `refresh.js` now orchestrates geometry → destinations → stops → garages → frequencies → route-details → classifications → overview → legacy garage-locations → route summary.
- **Weekly CI workflow**: Now stages the new data files (`frequencies.json`, `garages.geojson`, `route_summary.csv`) so they deploy to Cloudflare Pages, uses `git add -A` so pruned dated snapshots are actually removed, and force-adds the geocode cache.
- **Removed Puppeteer** (~170 MB unused devDep) — shaves noticeable time off every CI `npm ci`.
- **About modal overhaul**: Added "Not a journey planner" lede, split Data Sources from Built-with, added attributions for TfL Open Data Licence, ONS/OGL v3, OSM ODbL, SheetJS (Apache 2.0), Geist (SIL OFL). New Privacy section discloses Google Analytics aggregate-only usage.
- **CSS fix**: Data Sources list now stacks name + description when descriptions are long (via the new `credits-list--inline` variant for short notes); fixes the squashed two-column layout after adding fuller attributions.
- **Hardened `.gitignore`**: Broader env/secret patterns (`*.env`, `.env.*`, `*.pem`, `*.key`, `secrets.json`, `credentials.json`), editor dirs (`.vscode/`, `.idea/`), Claude `settings.json`, OS cruft.

---

## v2.4 – Stops Baked In & Bus-Stop Filter

_2026-04-23_

- **Stops are now pre-baked weekly, not fetched live from TfL**. New pipeline step `fetch-route-stops.js` calls `/Line/<id>/StopPoints` for every route and produces two files: `data/stops.json` (30 677 unique stops keyed by naptan ID, with `name`, `indicator`, `lat`, `lon`, and a `routes` reverse index) and `data/route_stops.json` (per-route ordered stop lists with the `towards` label for each stop). The frontend's `fetchStopsForRoute()` now joins these two files instead of hitting `api.tfl.gov.uk` — zero runtime TfL calls for stop data, so opening a route is instant and the app works the same whether TfL is up or not.
- **New bus-stop filter**. A "Bus stop" search in the filters panel (below Propulsion) filters the visible route set to only routes serving the selected stop. Composes with every other filter (operator, route type, frequency, deck, propulsion) as AND — e.g. "Go-Ahead electric routes passing through Camden Town". Autocomplete is prefix-first then substring, top 8 matches. `stops.json` is lazy-loaded on first focus of the input so it doesn't land on every page view.
- **Pipeline: 8 → 9 steps**. Stops slot in between route destinations and garages. Soft-fail like the other fetch steps.
- **GitHub Actions bumped to v5**. `actions/checkout@v5` and `actions/setup-node@v5` clear the Node 20 deprecation warning; both run on Node 24.

---
