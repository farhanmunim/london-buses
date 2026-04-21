# Changelog

All notable changes to **London Buses** are listed here.

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
