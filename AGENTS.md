# London Buses — Agent Guide

A comprehensive reference for any AI agent or developer working in this repository.

---

## Project Overview

An interactive map of every London bus route. Users can search routes, filter by type/operator/propulsion/frequency/deck, view route details and stops, compare multiple routes side-by-side, and see live per-operator statistics. Deployed as a static site (no server, no build step at deploy time).

**Live site:** [london-buses.farhan.app](https://london-buses.farhan.app) (Cloudflare Pages auto-deployed from `main`).

---

## Technology Stack

| Layer     | Choice                                                         |
| --------- | -------------------------------------------------------------- |
| Map       | Leaflet.js 1.9.4 (CDN)                                         |
| Fonts     | Geist + Geist Mono (via Google Fonts)                          |
| Tiles     | CartoDB Voyager (no key needed) + © OpenStreetMap contributors |
| Hosting   | Cloudflare Pages (static)                                      |
| Analytics | Google Analytics — anonymous, aggregate only                   |
| CI / Data | GitHub Actions (weekly cron + manual trigger)                  |
| Runtime   | Vanilla JS ES modules — no bundler, no framework               |

---

## Repository Structure

```
/
├── index.html                       # Single-page app shell (search, map, sidebar, About modal)
├── css/style.css                    # All styles — design tokens, components, responsive
├── js/
│   ├── ui.js                        # Entry point — boots map, filters, stats, About modal, CSV export
│   ├── map.js                       # Leaflet map, overview layer, route/stop rendering
│   ├── api.js                       # Data access — static files + live TfL StopPoints API
│   ├── search.js                    # Search input, autocomplete, multi-route pills
│   ├── route-detail.js              # Route detail panel, direction toggle, stops toggle
│   └── state.js                     # Shared state object and DOM refs
├── scripts/
│   ├── refresh.js                   # Orchestrator: runs all 4 build steps in sequence
│   ├── fetch-data.js                # Step 1 — geometry ZIP + destinations from TfL API
│   ├── fetch-route-details.js       # Step 2 — vehicle/operator/PVR/frequency scrape
│   ├── build-classifications.js     # Step 3 — merge into final per-route record
│   ├── build-overview.js            # Step 4 — simplified overview GeoJSON + snapshot archive
│   └── update-vehicle-lookup.js     # Maintenance — adds new vehicle types to lookup
├── data/
│   ├── routes/                      # Per-route GeoJSON files (one per route ID)
│   │   └── index.json               # List of all route IDs
│   ├── routes-overview.geojson      # Simplified full-network overview layer
│   ├── routes-overview-YYYY-MM-DD.geojson  # Weekly snapshot archive (last 4 kept)
│   ├── route_destinations.json      # Inbound/outbound names per route (from TfL API)
│   ├── route_classifications.json   # Final per-route record (joined from all sources)
│   ├── vehicle-lookup.json          # Manual vehicle type → (deck, propulsion) lookup
│   ├── route-overrides.json         # Manual per-route field overrides (highest priority)
│   ├── build-meta.json              # Timestamps for footer display
│   ├── geometry-source.json         # ZIP date for CI change detection
│   ├── manifest.json                # Snapshot history
│   └── source/                      # (gitignored) intermediate scraper output
├── .github/workflows/
│   └── refresh-data.yml             # Weekly data refresh (Monday 05:00 UTC) + manual dispatch
├── .env                             # Local only — BUS_API_KEY=... (never committed)
├── AGENTS.md                        # This file
├── CHANGELOG.md                     # Release history
└── package.json
```

---

## Data Inventory

Quick reference for every data point the app uses — what it is, where it comes from, how it's stored, and any rate-limit considerations.

| Data point                | What it is                                                                                                                 | Source                                                              | Retrieval                                                             | Storage                                                                                           | Refresh frequency                                                            | Rate limits / notes                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Route geometry (detailed) | Full-resolution polyline for each route (per direction)                                                                    | TfL S3 bucket — `Route_Geometry_YYYYMMDD.zip` (XML per route)       | Build-time download + XML parse + Douglas-Peucker simplify (0.00005°) | `data/routes/<ID>.geojson` (one file per route) + `data/routes/index.json`                        | Weekly CI, **only if ZIP date changed** (tracked via `geometry-source.json`) | No key required for S3 listing; single ZIP download per run                         |
| Route destinations        | Inbound/outbound terminus names                                                                                            | TfL API — `/Line/Mode/bus` + `/Line/<id>/Route`                     | Build-time authenticated HTTPS calls                                  | `data/route_destinations.json` (single file, keyed by uppercase ID)                               | Weekly CI                                                                    | TfL key required; 500 req/min limit, scripts throttle to 350 req/min                |
| Route classifications     | Per-route merged record: type, isPrefix, lengthBand, operator, deck, propulsion, PVR, headways, frequencyBand, vehicleType | Merged at build time from scraper + overrides + lookup + geometry   | Build step 3 combines all inputs with precedence rules                | `data/route_classifications.json` (single file)                                                   | Weekly CI                                                                    | Pure build step — no external calls                                                 |
| Route details (raw)       | Scraped vehicle type, garage code, PVR, headways per route                                                                 | londonbusroutes.net — `details.htm` (fixed-width `<pre>`)           | Build-time HTTP fetch + column-slice parse                            | `data/source/route_details.json` (gitignored — intermediate)                                      | Weekly CI                                                                    | **HTTP only, no HTTPS**; no auth; public data; no published rate limit — be polite  |
| Garages                   | Garage code → `{ operator, garageName }`                                                                                   | londonbusroutes.net — `garages.htm` (HTML table)                    | Build-time HTTP fetch + HTML parse                                    | Merged inline into `route_details.json` (not stored separately)                                   | Weekly CI                                                                    | Same as above — HTTP only, no auth                                                  |
| Routes overview           | Simplified full-network GeoJSON with classification properties embedded                                                    | Derived from `data/routes/*.geojson` + `route_classifications.json` | Build step 4 — aggressive simplify (0.0005°, 4dp ≈ 11 m)              | `data/routes-overview.geojson` + dated snapshot `routes-overview-YYYY-MM-DD.geojson` (max 4 kept) | Weekly CI                                                                    | Pure build step                                                                     |
| Bus stops (per route)     | Stop name, coords, NaPTAN ID, "towards" text, lines served                                                                 | TfL API — `/Line/<id>/StopPoints`                                   | **Live from browser** on route click                                  | In-memory cache in `api.js` (not persisted)                                                       | Live, cached for session                                                     | No key required (public endpoint, ~500 req/min per IP); falls back to `[]` on error |
| Vehicle lookup            | Vehicle type string → `{ deck, propulsion }` fallback                                                                      | Manual curation via `npm run update-vehicle-lookup`                 | Hand-edited                                                           | `data/vehicle-lookup.json`                                                                        | On demand (manual)                                                           | None                                                                                |
| Route overrides           | Per-route manual field overrides (highest priority)                                                                        | Manual curation                                                     | Hand-edited                                                           | `data/route-overrides.json`                                                                       | On demand (manual)                                                           | None                                                                                |
| Build metadata            | Last-build + next-refresh timestamps for footer                                                                            | Generated by build step 4                                           | Build-time write                                                      | `data/build-meta.json`                                                                            | Weekly CI                                                                    | None                                                                                |
| Geometry source marker    | Date of the TfL geometry ZIP last ingested (for CI change detection)                                                       | Build step 1                                                        | Build-time write                                                      | `data/geometry-source.json`                                                                       | Weekly CI                                                                    | None                                                                                |
| Snapshot manifest         | History of dated overview snapshots                                                                                        | Build step 4                                                        | Build-time write                                                      | `data/manifest.json`                                                                              | Weekly CI                                                                    | None                                                                                |

**Security note:** `BUS_API_KEY` is used **only** in build scripts (GitHub Actions secret + local `.env`). It never reaches the browser. All runtime API calls from the browser are unauthenticated.

---

## Data Pipeline

Runs weekly via GitHub Actions (`npm run refresh`). Each step depends on the previous.

### Step 1 — `scripts/fetch-data.js`

**Source: TfL official APIs (primary)**

1. Lists TfL's S3 bucket for the latest `Route_Geometry_YYYYMMDD.zip`
2. Downloads + extracts — each ZIP entry is an XML file per route
3. Parses XML, applies Douglas-Peucker simplification (0.00005°), writes `data/routes/<ID>.geojson`
4. Fetches `/Line/Mode/bus` → all active route IDs, then `/Line/<id>/Route` for each → `data/route_destinations.json`
5. Route IDs are **uppercased** on write (TfL API returns lowercase; uppercase is canonical throughout)
6. Writes `data/geometry-source.json` with the ZIP date for CI change detection

Rate limit: 350 req/min (safely under TfL's 500/min limit with API key).
Routes 700–799 excluded (coaching, not bus).

### Step 2 — `scripts/fetch-route-details.js`

**Source: londonbusroutes.net (supplementary — TfL API lacks this data)**

Fetches:

- `garages.htm` — HTML table mapping garage code → `{ operator, garageName }`
- `details.htm` — fixed-width `<pre>` text (4 blocks: day routes ×2, night, school)

Fixed-width column positions (0-indexed, empirically verified):

| Field           | Slice     |
| --------------- | --------- |
| Route ID        | `[0:4]`   |
| Vehicle type    | `[5:34]`  |
| Garage code     | `[35:38]` |
| PVR             | `[39:42]` |
| Mon–Sat headway | `[57:64]` |
| Sunday headway  | `[65:72]` |
| Evening headway | `[73:80]` |

Route-ID regex accepts:

- Numeric (1–999) with optional letter suffix: `25`, `108D`
- N-prefix: `N1`, `N279`
- Letter-prefix with digit: `A10`, `EL1`, `W7`
- Letter-only: `SCS`, `RV1`

Derives:

- `deck`: `double` / `single` / `null`
- `propulsion`: `electric` / `hydrogen` / `hybrid` / `diesel`
- `operator`: via garage code → `garages.htm` lookup
- Headways capped at 90 min to reject garbage from column overlaps on night block

Output: `data/source/route_details.json` (gitignored — intermediate).

**Note:** londonbusroutes.net only supports HTTP (no HTTPS). Data is non-sensitive, public.

### Step 3 — `scripts/build-classifications.js`

Merges all inputs into a single authoritative per-route record.

**Precedence (highest wins):**

1. `data/route-overrides.json` — manual per-route field overrides
2. `data/source/route_details.json` — scraped operator/deck/propulsion/PVR/frequency
3. `data/vehicle-lookup.json` — vehicle-type → (deck, propulsion) fallback when direct derivation returned null
4. Derived from route ID / geometry — type, isPrefix, lengthBand

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

### Step 4 — `scripts/build-overview.js`

- Applies aggressive simplification (0.0005°, 4dp precision ≈ 11 m)
- Embeds all classification properties on every feature for client-side filtering
- Writes `routes-overview.geojson`, dated snapshot archive (max 4 kept), updates `manifest.json` + `build-meta.json`

**Critical:** If classifications change, Step 4 MUST be re-run. The overview GeoJSON must stay in sync with `route_classifications.json` or filter results and detail panels will disagree.

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

### Module Graph

```
ui.js ──→ map.js
       ──→ api.js
       ──→ state.js
       ──→ search.js ──→ api.js
                     ──→ map.js
                     ──→ route-detail.js ──→ map.js
                                         ──→ state.js
                                         ──→ search.js  (dynamic import — avoids circular dep)
```

### `api.js` — Data Access

- In-memory cache keyed by URL / route ID
- All destination keys normalised to uppercase on load (handles legacy lowercase data)
- `fetchStopsForRoute(id)` — calls `https://api.tfl.gov.uk/Line/<id>/StopPoints` live (no API key needed, no large file in git); falls back to `[]` on error

### `map.js` — Leaflet Map

- Overview: `routes-overview.geojson` rendered as faint colour-coded polylines (per `routeType`)
- Click-to-identify: finds routes within 6 px of click, shows popup with clickable route chips
- Stop popups: name, NaPTAN ID, "towards" text, clickable chips for other routes serving that stop

### Filter Semantics

Unified null handling across all filter categories: **a filter is only active when at least one chip is selected; null values match only if the user ticks the `Unknown` chip.**

```
if (!_filters.X) return true              // no filter active → pass
if (value == null) return X.has('__unknown__')
return X.has(value)
```

Applies to: `deck`, `frequency`, `operator`, `propulsion`. The `Route type` group has no Unknown chip (every route has a type).

### `ui.js` — Boot + orchestration

- Boots map, loads overview + route index + destinations + classifications in parallel
- Wires filter chip clicks, CSV export, About modal open/close
- `renderOperatorStats(routes)` — dynamic per-operator table (Routes %, PVR %, EV %) that recomputes from `getVisibleRouteProps()` whenever filters change

### `state.js`

All DOM refs centralised here. Import only what each module needs.

### Multi-Route Mode

Activated when pills are used. `renderMultiRoute()` dims the overview, draws selected routes with a dark outline + colour layer + endpoint labels.

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

- Always: `routes-overview.geojson`, `route_destinations.json`, `route_classifications.json`, `build-meta.json`, `manifest.json`, `geometry-source.json`, snapshot archive
- Only when the geometry ZIP date changed: `data/routes/` (individual route files)

---

## Known Data Gaps

- **Discontinued routes**: some routes exist in the weekly geometry ZIP but are not in TfL's active `/Line/Mode/bus` list (e.g. `N6, N12, T1–T3, UL*, NEL1, 108D, 281N, 481D`). These render on the map but have no destinations, operator, deck, etc. Mitigation options: filter out at build time, or keep them under the `Unknown` filter chip (current behaviour).
- **Letter-only routes without scraper data**: even in londonbusroutes.net, coverage is not exhaustive. Use `route-overrides.json` to fill gaps.
- **24-hour routes**: TfL API no longer distinguishes them — all routes return `"Regular"` for `service_types`. The `twentyfour` filter type has been removed from the UI.

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
| `twentyfour` type removed                  | TfL API stopped exposing distinguishing data                            |

---

## Constraints

- TfL API key only used in build scripts — never exposed to the browser
- No sensitive data in committed files
- Static output only — no server-side logic
- Analytics is anonymous aggregate only — no user accounts, no fingerprinting
