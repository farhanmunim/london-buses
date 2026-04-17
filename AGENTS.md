# London Buses — Agent Guide

A comprehensive reference for any AI agent or developer working in this repository.

---

## Project Overview

An interactive map of every London bus route. Users can:

- Search routes, filter route lines by type / operator / propulsion / frequency / deck
- Filter garage markers by operator independently of the route filter (competitor analysis)
- View per-route detail: direction toggle, endpoints, operator, garage, PVR, vehicle, stops
- Toggle route-line colour between route type and operator brand livery
- Compare multiple routes side-by-side (pill-based multi-select)
- See live per-operator statistics, recomputed as filters change
- Export the currently filtered view as a 3-sheet XLSX workbook

Deployed as a static site (no server, no build step at deploy time).

**Live site:** [london-buses.farhan.app](https://london-buses.farhan.app) (Cloudflare Pages auto-deployed from `main`).

---

## Technology Stack

| Layer       | Choice                                                                          |
| ----------- | ------------------------------------------------------------------------------- |
| Shell       | Web App Blueprint (shadcn-aligned dashboard shell, single-file CSS + AppShell JS) |
| Map         | Leaflet.js 1.9.4 (CDN)                                                          |
| Fonts       | Geist + Geist Mono (via Google Fonts)                                           |
| Tiles       | CartoDB Voyager (no key needed) + © OpenStreetMap contributors                  |
| XLSX export | SheetJS `xlsx-0.20.3` (CDN, loaded `defer`)                                     |
| Geocoder    | Photon (primary, OSM-backed) → Nominatim (fallback) for garage locations        |
| Hosting     | Cloudflare Pages (static)                                                       |
| Analytics   | Google Analytics (G-J5GKHJN7K6) on both `index.html` and `changelog.html`       |
| CI / Data   | GitHub Actions (weekly cron + manual trigger)                                   |
| Runtime     | Vanilla JS ES modules — no bundler, no framework                                |

---

## Repository Structure

```
/
├── index.html                       # Main app page — topbar + left filter panel + map + right detail panel + mobile nav
├── changelog.html                   # Release notes (same shell, no panels)
├── favicon.svg                      # London Buses mark (matches topbar logo)
├── css/app.css                      # Single stylesheet — design tokens, primitives, shell, page styles
├── js/
│   ├── ui.js                        # Boot orchestrator — loads data, hydrates state, wires footer dates
│   ├── app.js                       # Web App Blueprint shell controller (Drawer/Panels/Tabs/Nav/Theme)
│   ├── map.js                       # Leaflet map, overview layer, route/stop rendering, garage markers
│   ├── api.js                       # Data access — static files + live TfL StopPoints API
│   ├── state.js                     # Shared state object and DOM refs
│   ├── search.js                    # Search input, autocomplete, multi-route pills
│   ├── route-detail.js              # Route detail panel, direction toggle, stops toggle
│   ├── filters.js                   # Filter chip handling + per-section Clear buttons
│   ├── stats.js                     # Per-operator stats table + filter-stat count renderer
│   ├── toggles.js                   # Topbar Show/Hide Routes & Garages (paired-button helper)
│   ├── paint-mode.js                # "Colour routes by Type vs Operator" segmented control
│   ├── panels.js                    # Desktop panel collapse/expand + reopen-tab wiring
│   ├── mobile-nav.js                # Bottom-bar mobile nav (≤640px) + drawer open/close
│   ├── export.js                    # 3-sheet XLSX export via SheetJS
│   ├── about.js                     # About modal — injects HTML, traps focus, works on every page
│   └── roadmap.js                   # Roadmap modal — same pattern; items defined as a plain array
├── scripts/
│   ├── refresh.js                   # Orchestrator: runs all 10 build steps in sequence
│   ├── fetch-data.js                # Step 1 — geometry ZIP → per-route GeoJSON (TfL S3)
│   ├── fetch-route-destinations.js  # Step 2 — TfL /Line API → destinations {destination,qualifier,full} + scrape fallback
│   ├── fetch-stops.js               # Step 3 — TfL StopPoint API → stops.geojson + bus_stations.geojson
│   ├── fetch-garages.js             # Step 4 — londonbusroutes CSV + postcodes.io → garages.geojson (cached)
│   ├── fetch-frequencies.js         # Step 5 — TfL timetables → frequencies.json (+ bustimes.org fallback)
│   ├── fetch-route-details.js       # Step 6 — join garages CSV + details.htm → vehicle/operator/PVR/deck
│   ├── build-classifications.js     # Step 7 — merge into final per-route record
│   ├── build-overview.js            # Step 8 — simplified overview GeoJSON + snapshot archive
│   ├── build-garage-locations.js    # Step 9 — legacy garage-locations.json for frontend (Photon-geocoded)
│   ├── build-route-summary.js       # Step 10 — route_summary.csv (all fields flattened for spreadsheet use)
│   └── update-vehicle-lookup.js     # Maintenance — adds new vehicle types to lookup
├── data/
│   ├── routes/                      # Per-route GeoJSON files (one per route ID)
│   │   └── index.json               # List of all route IDs
│   ├── routes-overview.geojson      # Simplified full-network overview layer
│   ├── routes-overview-YYYY-MM-DD.geojson  # Weekly snapshot archive (last 4 kept)
│   ├── route_destinations.json      # Inbound/outbound {destination, qualifier, full} per route (TfL API)
│   ├── route_classifications.json   # Final per-route record (joined from all sources)
│   ├── frequencies.json             # Numeric headways per route {peak_am,peak_pm,offpeak,overnight,weekend}
│   ├── garages.geojson              # Garage code → geometry + properties (CSV-sourced, postcodes.io geocoded)
│   ├── garage-locations.json        # Legacy garage lookup consumed by frontend (Photon-geocoded)
│   ├── stops.geojson                # (gitignored, 4.7MB) All London bus stops — not consumed by frontend yet
│   ├── bus_stations.geojson         # Named bus/coach stations (NaptanBusCoachStation, ~50 features)
│   ├── route_summary.csv            # Flat CSV of every field per route — for spreadsheet / BI use
│   ├── vehicle-lookup.json          # Manual vehicle type → (deck, propulsion) lookup
│   ├── route-overrides.json         # Manual per-route field overrides (highest priority)
│   ├── build-meta.json              # Timestamps for footer display
│   ├── geometry-source.json         # ZIP date for CI change detection
│   ├── manifest.json                # Snapshot history
│   └── source/                      # (gitignored *except* geocode_cache.json) intermediate data
│       ├── route_details.json       # Scraper + garage-CSV join (intermediate for Step 7)
│       └── geocode_cache.json       # postcodes.io cache — force-committed so weekly runs skip re-geocoding
├── .github/workflows/
│   └── refresh-data.yml             # Weekly data refresh (Monday 05:00 UTC) + manual dispatch
├── Reference/                       # (gitignored) dev-only artefacts — puppeteer verify scripts, refactor plan
├── .env                             # Local only — BUS_API_KEY=... (never committed)
├── AGENTS.md                        # This file
├── CHANGELOG.md                     # Release history (markdown; the user-facing page is changelog.html)
└── package.json
```

---

## Data Inventory

Quick reference for every data point the app uses — what it is, where it comes from, how it's stored, and any rate-limit considerations.

| Data point                | What it is                                                                                                                 | Source                                                              | Retrieval                                                             | Storage                                                                                           | Refresh frequency                                                            | Rate limits / notes                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Route geometry (detailed) | Full-resolution polyline for each route (per direction)                                                                    | TfL S3 bucket — `Route_Geometry_YYYYMMDD.zip` (XML per route)       | Build-time download + XML parse + Douglas-Peucker simplify (0.00005°) | `data/routes/<ID>.geojson` (one file per route) + `data/routes/index.json`                        | Weekly CI, **only if ZIP date changed** (tracked via `geometry-source.json`) | No key required for S3 listing; single ZIP download per run                         |
| Route destinations        | Inbound/outbound `{ destination, qualifier, full }` per route                                                              | **Primary:** TfL API `/Line/Mode/bus` + `/Line/<id>/Route` + `/StopPoint/Route`  **Fallback:** londonbusroutes.net `routes.htm` for routes TfL omits | Build-time fetch + dashed-description parse (fallback) + hardcoded override for route 969 | `data/route_destinations.json` (keyed by uppercase ID)                                            | Weekly CI                                                                    | TfL key required; 500 req/min, scripts throttle to 350 req/min                      |
| Frequencies (numeric)     | Mean headway (minutes) per route per band: `peak_am`, `peak_pm`, `offpeak`, `overnight`, `weekend`                         | **Primary:** TfL `/Line/<id>/Timetable/<firstStop>`  **Fallback:** londonbusroutes.net `times/<id>.htm` pre-grids | Build-time fetch + HHMM grid parse (fallback only for TfL-gap routes) | `data/frequencies.json`                                                                           | Weekly CI                                                                    | TfL throttle; 200 ms delay on scrape fallback                                       |
| Stops + bus stations      | Every London bus stop + named bus/coach stations (~50)                                                                     | TfL `/StopPoint/Mode/bus` (paginated) + `/StopPoint/Type/NaptanBusCoachStation` | Build-time fetch                                                      | `data/stops.geojson` (gitignored) + `data/bus_stations.geojson` (committed)                       | Weekly CI                                                                    | TfL throttle                                                                        |
| Route classifications     | Per-route merged record: type, isPrefix, lengthBand, operator, deck, propulsion, PVR, headways, frequencyBand, vehicleType | Merged at build time from scraper + overrides + lookup + geometry   | Build step 3 combines all inputs with precedence rules                | `data/route_classifications.json` (single file)                                                   | Weekly CI                                                                    | Pure build step — no external calls                                                 |
| Route details (raw)       | Per-route vehicle type, garage code, PVR, headways                                                                         | **Primary:** londonbusroutes.net `garages.csv` (authoritative operator/garage/PVR)  **Secondary:** `details.htm` for vehicle type | Build-time HTTP fetch + regex parse (no fixed-width slicing — that was the previous bug) | `data/source/route_details.json` (gitignored — intermediate for Step 7)                           | Weekly CI                                                                    | **HTTP only, no HTTPS**; no auth; public data; UTF-8 with cp1252 fallback for mojibake fix |
| Garages (geometry)        | Garage code → `{ name, operator, address, lat, lon, routes }`                                                              | londonbusroutes.net `garages.csv` + postcodes.io bulk geocoding     | Build-time fetch + postcode lookup (cached across runs)               | `data/garages.geojson` + `data/source/geocode_cache.json` (force-committed)                       | Weekly CI                                                                    | postcodes.io is unauthenticated; cache skips lookups on stable weeks                |
| Routes overview           | Simplified full-network GeoJSON with classification properties embedded                                                    | Derived from `data/routes/*.geojson` + `route_classifications.json` | Build step 4 — aggressive simplify (0.0005°, 4dp ≈ 11 m)              | `data/routes-overview.geojson` + dated snapshot `routes-overview-YYYY-MM-DD.geojson` (max 4 kept) | Weekly CI                                                                    | Pure build step                                                                     |
| Bus stops (per route)     | Stop name, coords, NaPTAN ID, "towards" text, lines served                                                                 | TfL API — `/Line/<id>/StopPoints`                                   | **Live from browser** on route click                                  | In-memory cache in `api.js` (not persisted)                                                       | Live, cached for session                                                     | No key required (public endpoint, ~500 req/min per IP); falls back to `[]` on error |
| Vehicle lookup            | Vehicle type string → `{ deck, propulsion }` fallback                                                                      | Manual curation via `npm run update-vehicle-lookup`                 | Hand-edited                                                           | `data/vehicle-lookup.json`                                                                        | On demand (manual)                                                           | None                                                                                |
| Route overrides           | Per-route manual field overrides (highest priority)                                                                        | Manual curation                                                     | Hand-edited                                                           | `data/route-overrides.json`                                                                       | On demand (manual)                                                           | None                                                                                |
| Build metadata            | Last-build + next-refresh timestamps for footer                                                                            | Generated by build step 4                                           | Build-time write                                                      | `data/build-meta.json`                                                                            | Weekly CI                                                                    | None                                                                                |
| Geometry source marker    | Date of the TfL geometry ZIP last ingested (for CI change detection)                                                       | Build step 1                                                        | Build-time write                                                      | `data/geometry-source.json`                                                                       | Weekly CI                                                                    | None                                                                                |
| Snapshot manifest         | History of dated overview snapshots                                                                                        | Build step 4                                                        | Build-time write                                                      | `data/manifest.json`                                                                              | Weekly CI                                                                    | None                                                                                |
| Garage locations          | Code → `{ name, operator, address, lat, lon }` for every London bus garage                                                 | `londonbusroutes.net/garages.htm` (name, address) + Photon (geocode) | Build-time scrape + geocode; cache reuses entries with unchanged address | `data/garage-locations.json`                                                                      | Weekly CI (cached; only re-geocodes new/changed addresses)                   | Photon has no strict rate limit; 1.5 s courtesy delay. Nominatim fallback with 60 s backoff on 429. |
| Night-route aliases       | Map of `N<ID>` → daytime sibling when both share a `times/<id>.htm` URL (24-hour service)                                  | `londonbusroutes.net/routes.htm`                                    | Build step 2 parses routes.htm + builds href-share graph              | Embedded in `data/source/route_details.json` under `aliases` + `operatorByRoute`                  | Weekly CI                                                                    | Used by Step 3 as a fallback so night routes inherit operator/garage/deck from the daytime route. |

**Security note:** `BUS_API_KEY` is used **only** in build scripts (GitHub Actions secret + local `.env`). It never reaches the browser. All runtime API calls from the browser are unauthenticated.

---

## Data Pipeline

Runs weekly via GitHub Actions (`npm run refresh`). Ten steps, each depending on the previous where noted.

**Guiding principle: TfL API first — scrape only to fill gaps.** londonbusroutes.net and bustimes.org fallbacks run *only* for routes the TfL API did not return. TfL-sourced values are never overwritten by scraped ones. This was a 2026-04 rework after the previous scraper-first pipeline produced systematically wrong data (route 1 tagged as a Bombardier CR4000 tram, etc.).

### Step 1 — `scripts/fetch-data.js` — Geometry

**Source: TfL S3 bucket (no auth).**

1. Lists the bucket for the latest `Route_Geometry_YYYYMMDD.zip`
2. Downloads + extracts (XML per route)
3. Parses + Douglas-Peucker simplifies (0.00005°), writes `data/routes/<ID>.geojson`
4. Uppercases all route IDs
5. Writes `data/geometry-source.json` with the ZIP date for CI change detection

Routes 700–799 excluded (coaching).

### Step 2 — `scripts/fetch-route-destinations.js` — Destinations

**Primary: TfL API** (`/Line/Mode/bus` → route IDs, then `/Line/<id>/Route` + `/StopPoint/Route`). Emits reference-shape `{ inbound, outbound, service_types }` where each direction is `{ destination, qualifier, full }`.

**Fallback: londonbusroutes.net `routes.htm`** — parses dashed `Origin - ... - Destination` descriptions for routes absent from TfL.

**Hardcoded override:** route 969 (Whitton–Roehampton Vale mobility route) is not surfaced in either source; a small HARDCODED block at the end of the script fills it.

Throttled at 350 req/min. Output: `data/route_destinations.json`.

### Step 3 — `scripts/fetch-stops.js` — Stops + Bus Stations

- `stops.geojson` from `/StopPoint/Mode/bus` (paginated) — gitignored (4.7 MB, not used by frontend yet).
- `bus_stations.geojson` from `/StopPoint/Type/NaptanBusCoachStation` — ~50 named termini with centroid fallback + child-name de-genericising.

### Step 4 — `scripts/fetch-garages.js` — Garages

**Source: londonbusroutes.net `garages.csv` + postcodes.io bulk geocoding.**

- Parses the CSV for `{ code, name, operator, address, routes }`
- Bulk-geocodes postcodes via postcodes.io (unauthenticated, very liberal limits)
- Caches results in `data/source/geocode_cache.json` (force-committed so subsequent weekly runs do zero geocoding on a stable week)
- Writes `data/garages.geojson`

### Step 5 — `scripts/fetch-frequencies.js` — Numeric Frequencies

**Primary: TfL `/Line/<id>/Timetable/<firstStop>`** — parses schedule intervals into per-band headways (peak_am, peak_pm, offpeak, overnight, weekend).

**Fallback: londonbusroutes.net `times/<id>.htm`** `<pre>` grids — parsed only for routes still missing values after the TfL pass. Day-type inferred from the heading above each grid (Mon-Fri / Sat / Sun).

Routes with no published timetable (most schools + some seasonal) end up with all-zero headways — acceptable, not a bug.

Output: `data/frequencies.json`.

### Step 6 — `scripts/fetch-route-details.js` — Vehicle / Operator / PVR

**Primary: `garages.csv`** (same CSV as Step 4) — the *authoritative* source for operator / garage code / garage name / PVR per route. This replaced the previous column-slice parser that was drifting across footnotes and producing wrong rows (route 1 picking up a tram line).

**Secondary: `details.htm`** — parsed with a robust regex (no fixed-width slicing) to pull the vehicle-type string, with UTF-8 → Latin-1 fallback to fix mojibake (`2D�` etc.).

**`routes.htm` pass** still provides:
- **Aliases** — `N<id>` → daytime `<id>` when both share a `times/<id>.htm`. Used by Step 7 so night routes inherit operator/garage/deck from the daytime sibling.
- **Operator-by-route fallback** (normalised to parent brand).

Derives `deck` (double/single/null) + `propulsion` (electric/hydrogen/hybrid/diesel). Output: `data/source/route_details.json` (gitignored).

### Step 7 — `scripts/build-classifications.js`

Merges all inputs into a single authoritative per-route record.

**Precedence (highest wins) for route-level fields:**

1. `data/route-overrides.json` — manual per-route field overrides
2. `data/source/route_details.json[routeId]` — authoritative data for the route itself (garage-CSV + details.htm)
3. **Night-route alias fallback** — if the record is missing fields and `aliases[routeId]` points at a daytime route, inherit from that route (so `N128` reports the same operator / garage / deck as `128`)
4. `data/source/route_details.json.operatorByRoute[routeId]` — operator-only fallback from `routes.htm`
5. `data/vehicle-lookup.json` — vehicle-type → (deck, propulsion) fallback; `vehicleLookupBestMatch()` tries combinatorial clean transforms (strips `2D`/`3D`, fleet prefix, size) so variants like `B5LH/Gemini 3 2D` match the canonical `B5LH/Gemini 3` key
6. Derived from route ID / geometry — type, isPrefix, lengthBand

Route type:

| Type             | Condition                                         |
| ---------------- | ------------------------------------------------- |
| `night`          | ID starts with `N` (e.g. N205)                    |
| `school`         | Numeric ID in range 600–699                       |
| `regular`        | Everything else                                   |
| `isPrefix: true` | ID starts with a non-N letter (e.g. A10, EL1, W7) |

Frequency band (weekday headway, falls back to Sunday/Evening):

- `high` ≤6 min, `regular` 7–15 min, `low` >15 min

Length band (Haversine, direction 1 only):

- `short` < 8 km, `medium` 8–20 km, `long` > 20 km

Output: `data/route_classifications.json`

### Step 8 — `scripts/build-overview.js`

- Applies aggressive simplification (0.0005°, 4dp precision ≈ 11 m)
- Embeds all classification properties on every feature for client-side filtering
- Writes `routes-overview.geojson`, dated snapshot archive (max 4 kept), updates `manifest.json` + `build-meta.json`

**Critical:** If classifications change, Step 8 MUST be re-run. The overview GeoJSON must stay in sync with `route_classifications.json` or filter results and detail panels will disagree.

### Step 9 — `scripts/build-garage-locations.js` (legacy)

**Source: `londonbusroutes.net/garages.htm` (name + address) + Photon (geocoding)**

1. Fetches `garages.htm` and parses each garage row for `{ code, name, operator, address }`
2. Loads `data/garage-locations.json` as a cache; any garage whose scraped address matches the cached entry is reused verbatim (zero lookups on a stable week)
3. For new or changed addresses, geocodes via **Photon** (primary, OSM-backed) with a 1.5 s courtesy delay; falls back to **Nominatim** with 60 s cooldown on 429
4. Rejects hits outside a London bounding box (`51.28–51.72, -0.55–0.35`) to avoid ambiguous matches (e.g. "Harrow" in Scotland)
5. Progressively loosens the query if needed: full address → drop leading house number → `"<name> bus garage, London"`
6. Writes `data/garage-locations.json` with `{ generatedAt, count, garages: { <code>: { ... lat, lon } } }`

**Weekly impact:** since the cache is address-keyed, a typical weekly run performs zero geocoder calls and finishes in under a second.

Kept as a separate step because the frontend (`api.js → fetchGarageLocations`) still reads `garage-locations.json` rather than the newer `garages.geojson`. Both files are regenerated weekly; consolidating to a single source is on the roadmap.

### Step 10 — `scripts/build-route-summary.js`

Joins destinations + classifications + frequencies + garages into `data/route_summary.csv`, one row per route with every human-readable field flattened (matches the reference RouteMapster CSV layout). Not consumed by the frontend — intended for spreadsheet / BI / ad-hoc analysis.

---

## Manual Data Curation

Two hand-editable files let you correct or fill in data without modifying scripts:

### `data/vehicle-lookup.json` — vehicle type fallback

Maps each unique vehicle type string to `{ deck, propulsion }`. Used when `fetch-route-details.js` couldn't derive these from the raw scraper text. Maintained via:

```bash
npm run update-vehicle-lookup
```

which scans `data/source/route_details.json` for new vehicle types, adds them with `null` placeholders, and preserves any manual entries you've made. Sorts alphabetically for easier editing.

### `data/route-overrides.json` — per-route overrides

Any field set here beats all scraped/derived data. Keys are route IDs (case-insensitive). Entries whose key starts with `_` are ignored (documentation/examples).

```json
{
  "routes": {
    "N128": { "deck": "double", "propulsion": "hybrid", "operator": "Go-Ahead" },
    "SCS": { "vehicleType": "Enviro400EV 10.5m" }
  }
}
```

After editing either file, run:

```bash
npm run build-classifications && npm run build-overview
```

Then commit and push. Weekly CI will not overwrite your manual entries.

---

## Frontend Architecture

Every module has a single responsibility and a JSDoc header stating what it exports and what it depends on. `ui.js` is a thin boot orchestrator (≤80 lines); all interactive wiring lives in focused modules.

### Module Graph

```
ui.js (boot) ──→ map.js · api.js · state.js · stats.js
              ──→ search.js · route-detail.js
              ──→ panels.js · toggles.js · filters.js
              ──→ paint-mode.js · mobile-nav.js · export.js

about.js   ── standalone (injects modal HTML, works on every page)
roadmap.js ── standalone (same pattern)
app.js     ── Web App Blueprint AppShell (Drawer / Panels / Tabs / Theme)
```

### Shell — `js/app.js` (Web App Blueprint)

Exposes `window.AppShell` with six modules:

| Module      | Responsibility                                                                |
| ----------- | ----------------------------------------------------------------------------- |
| `Drawer`    | Mobile off-canvas for left/right panels, overlay, body scroll-lock            |
| `Panels`    | Desktop collapse/expand for left + right panels (click on `.panel-hd`)        |
| `Tabs`      | Generic tab switcher (unused in London Buses, kept for parity)                |
| `Nav`       | Sidebar `.nav-item` active state (unused here)                                |
| `MobileNav` | Blueprint's default bottom-nav wiring — **replaced by our own** `mobile-nav.js` |
| `Theme`     | Light/dark toggle, persists to `localStorage` under `app-theme`               |

### `api.js` — Data Access

- In-memory cache keyed by URL / route ID
- All destination keys normalised to uppercase on load
- `fetchStopsForRoute(id)` — calls `https://api.tfl.gov.uk/Line/<id>/StopPoints` live (no API key needed, no large file in git); falls back to `[]` on error
- `fetchGarageLocations()` — loads `data/garage-locations.json`, filters out garages missing coords

### `map.js` — Leaflet Map

- Overview layer: `routes-overview.geojson` rendered as polylines whose colour is chosen by `featureColor(props)`
  - **Paint mode** (set by `setPaintMode(mode)`): `type` uses the categorical palette (regular red, prefix mustard, 24-hour teal, night violet, school green); `operator` uses brand liveries (Arriva turquoise, First pink, Go-Ahead red, Metroline dark blue, Stagecoach navy, Transport UK blue, RATP green)
  - **Opacity**: 0.8 when no route is focused, 0.2 when one is (faint context underlay)
  - **Visibility**: `setRoutesVisible(visible)` is *context-aware* — when a route is focused, it toggles only the overview; when nothing is focused, it toggles every route-line layer
- Click-to-identify: finds routes within 6 px of click, shows popup with clickable `.map-id-popup__chip` route chips
- Stop popups: `.map-popup__name`, `.map-popup__id`, and clickable `.map-popup__route-chip` for every other route serving that stop
- Multi-route mode: `renderMultiRoute()` dims the overview, draws selected routes with a dark outline + colour layer + endpoint labels
- **Garage markers**: `renderGarages(garages, routeCounts)` places a colour-coded pin per garage using its operator's brand livery; `setGaragesVisible(visible)` toggles the layer; `filterGarages(operatorSet)` hides/shows markers by operator

### Filter Semantics

Unified null handling across all filter categories: **a filter is only active when at least one chip is selected; null values match only if the user ticks the `Unknown` chip.**

```
if (!_filters.X) return true              // no filter active → pass
if (value == null) return X.has('__unknown__')
return X.has(value)
```

**Two independent filter groups** are now maintained:

| Group           | Chip `data-filter` values                                             | Drives                   |
| --------------- | --------------------------------------------------------------------- | ------------------------ |
| Route filters   | `routetype`, `operator`, `frequency`, `deck`, `propulsion`            | Route-line overlay + stats table + Routes/Network sheets in export |
| Garage filter   | `garageoperator`                                                      | Garage markers + Garages sheet in export                           |

The garage filter is deliberately separate so a user can overlay (say) Stagecoach routes with Arriva's garage footprint for competitor analysis.

### `ui.js` — Boot orchestrator

- Loads overview + route index + destinations + classifications in parallel, then garage locations in a second Promise
- Hydrates `state.routeIndex / destinations / classifications`
- Computes footer "last updated / next refresh" dates from `data/build-meta.json`
- Imports every interactive module so each wires its own listeners on load

### `state.js`

All shared DOM refs and the `state` object centralised here. Import only what each module needs.

### Export — `export.js`

Single XLSX workbook with three sheets, all honouring current filter state:

- **Routes** — per-route data (type, deck, propulsion, operator, frequency, PVR, vehicle, garage, destinations)
- **Garages** — per-garage data (code, name, operator, address, latitude, longitude, route_count)
- **Network overview** — per-operator aggregates (route share, PVR share, EV share, plus TOTAL row)

SheetJS is loaded from CDN with `defer`; the export handler surfaces a friendly message if the library hasn't loaded yet.

### Modals — `about.js` / `roadmap.js`

Both modals are self-contained:

- Inject their HTML into `<body>` on load so they're available on every page that ships the script tag (index + changelog)
- Open via any element carrying the matching id (`#about-btn` / `#roadmap-btn`) OR the matching data attribute (`[data-roadmap-open]`), allowing inline triggers in prose without id collisions
- Trap Tab / Shift+Tab focus while open
- Move focus to the close button on open, restore to the trigger on close
- Close on Escape, backdrop click, or the `[data-close]` buttons

Roadmap items are defined as a plain array at the top of `roadmap.js` — adding a new entry is a one-line edit. Each item accepts an optional `{ link: { href, label } }` rendered safely (both strings HTML-escaped).

---

## Environment Setup

### Local Development

```bash
npm install
cp .env.example .env          # then set BUS_API_KEY=your_key_here
npm run refresh               # full data pipeline (~5 min)
npx serve .                   # or: node serve.mjs
```

### GitHub Actions

Set `BUS_API_KEY` in **Settings → Secrets and variables → Actions → Repository secrets**.

Workflow (`.github/workflows/refresh-data.yml`):

- Runs every Monday at 05:00 UTC
- Can be triggered manually from the Actions tab
- Has `permissions: contents: write` so the bot can push data commits back to `main`

Files committed per run:

- **Always:** `routes-overview.geojson`, `route_destinations.json`, `route_classifications.json`, `frequencies.json`, `garages.geojson`, `route_summary.csv`, `garage-locations.json`, `build-meta.json`, `manifest.json`, `geometry-source.json`, dated snapshot archive (pruned via `git add -A`)
- **Force-added:** `data/source/geocode_cache.json` (to persist postcodes.io cache across runs)
- **Only when the geometry ZIP date changed:** `data/routes/` (individual route files)
- **Never committed:** `data/stops.geojson` (gitignored — 4.7 MB, not used by frontend)

---

## Known Data Gaps

- **Discontinued routes**: some routes exist in the weekly geometry ZIP but are not in TfL's active `/Line/Mode/bus` list (e.g. `N6, N12, T1–T3, UL*, NEL1, 108D, 281N, 481D`). These render on the map but have no destinations, operator, deck, etc. Mitigation options: filter out at build time, or keep them under the `Unknown` filter chip (current behaviour).
- **Letter-only routes without scraper data**: even in londonbusroutes.net, coverage is not exhaustive. Use `route-overrides.json` to fill gaps.
- **24-hour routes**: TfL API no longer distinguishes them reliably — most routes return `"Regular"` even if they run nightly. `build-classifications.js` still assigns `type: 'twentyfour'` when `service_types` contains both `Regular` and `Night`, and the map palette reserves a colour for it, but the route-type filter chip was removed from the UI (the route-type group only shows Regular / Prefix / Night / School). The night-route alias fallback (Step 2 → Step 3) fills the practical gap by letting `N128` etc. inherit data from the daytime sibling when routes.htm confirms a 24-hour service.
- **Garage coordinates**: garages with no address on `londonbusroutes.net` or a geocoder miss are written with `lat: null, lon: null` and skipped by `renderGarages`. Add manual coords via `route-overrides.json` (future) or patch `data/garage-locations.json` directly.

---

## Key Design Decisions

| Decision                                   | Reason                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| Stops fetched live from TfL API            | Authoritative; no large file in git; no weekly-refresh dependency       |
| Route IDs uppercased throughout            | TfL API returns lowercase; consistent canonical form avoids lookup bugs |
| londonbusroutes.net for supplementary data | TfL API lacks vehicle type, operator, PVR, and frequency                |
| Two simplification tolerances              | 0.00005° for per-route detail, 0.0005° for overview performance         |
| No framework or bundler                    | Static hosting, zero deploy-time build, simple deployment               |
| Unified `Unknown` filter semantics         | Consistent handling; users never silently lose routes with missing data |
| Manual override files checked into git     | Curation decisions are versioned, visible in diffs, not clobbered by CI |
| Route / garage filters split               | Lets a user overlay one operator's route network with another's garages (competitor analysis) |
| Paint mode as a view switch, not a filter  | Colour encoding is a perception choice, not a data filter — shouldn't affect which routes show |
| XLSX export (SheetJS) replaces CSV         | A multi-sheet workbook keeps Routes / Garages / Network overview together and respects filter state in one file |
| z-index centralised on `:root`             | All stacking decisions documented in one place; prevents "arms race" of ever-higher values |
| BEM for project-specific classes only      | Blueprint primitives (`.btn`, `.chip`, `.nav-item`, `.panel-hd`) keep their flat shadcn-style names; only the app-layer classes get `block__element--modifier` naming |
| Photon before Nominatim for geocoding      | Nominatim blocks after small bursts; Photon tolerates sustained use with the same OSM data |

---

## CSS system

- Single stylesheet (`css/app.css`, ~1900L) organised as Tokens → Base → Primitives → Shell → Pages → Responsive → Dark.
- All stacking decisions tokenised on `:root` (`--z-overlay`, `--z-topbar`, `--z-desktop-panel`, `--z-map-hud`, `--z-above-map`, `--z-drawer`, `--z-mobile-nav`, `--z-modal`). No literal `z-index: N` values anywhere else.
- Fluid type via `clamp()` on the changelog title / entry title, route badge, modal padding — reduces the number of media-query overrides needed.
- Three media queries cover genuine layout-mode changes (≤900 / ≤640 / ≤380). Breakpoint-specific size tweaks belong in those; everything else should scale fluidly.
- Dark mode: shadcn neutral palette on `[data-theme="dark"]`. All downstream tokens resolve via `var()` so components pick it up automatically; only bespoke colours (Leaflet tiles, hero backgrounds) need explicit dark-mode rules.

## Accessibility

- `<header role="banner">`, `<main>`, `<aside aria-label>`, `<footer>`, `<nav>` landmarks on both pages.
- Panel headers and reopen tabs are `<button>` elements with `aria-expanded` and `aria-controls`. A MutationObserver in `panels.js` flips `aria-expanded` in lock-step with the `.collapsed` class so keyboard users hear the state change.
- Every interactive primitive has a visible focus ring via `:focus-visible`.
- Modals (About, Roadmap) trap focus while open and restore focus to the trigger on close.
- `aria-live="polite"` on the filter stat region.
- Skip link on every page targets the main content.
- Every decorative SVG carries `aria-hidden="true"`; every icon-only button carries `aria-label`.

---

## Constraints

- TfL API key only used in build scripts — never exposed to the browser
- No sensitive data in committed files
- Static output only — no server-side logic
- Never introduce a bundler or framework — the no-build-at-deploy contract is load-bearing for the Cloudflare Pages setup
- Keep Google Analytics aggregate-only and include the same snippet on every user-facing HTML page (currently `index.html` + `changelog.html`)
- Analytics is anonymous aggregate only — no user accounts, no fingerprinting
