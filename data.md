# Data Pipeline — London Buses

Definitive reference for every datapoint in this project: where it comes from, how
it is cleaned, how blanks get filled, and what to watch out for.

**Cadence:** weekly, Mondays 05:00 UTC, via GitHub Actions (`.github/workflows/refresh-data.yml`).
**Orchestrator:** `scripts/refresh.js` — runs the 9 pipeline steps in sequence; network-bound fetch steps soft-fail so one flaky source doesn't abort the week. Pure build steps hard-fail.
**Philosophy:** TfL API first. Scrape only to fill blanks. Always keep last-known-good
when a source fails, so a flaky upstream never wipes curated data.

---

## 1. Sources

| Source | Auth | Role | Notes / Limits |
|---|---|---|---|
| **TfL Unified API** (`api.tfl.gov.uk`) | `app_key` + `app_id` via `BUS_API_KEY` env var | **Primary** for route IDs, service types, timetables, stops, destinations | Free tier, 500 req/min. Our scripts self-throttle to ~350 req/min. Key held in GH Actions secret + local `.env`; **never** reaches the browser. |
| **TfL geometry ZIP** (public S3) | None | Per-route geometry (inbound/outbound LineStrings) | No auth, no rate-limit published; `Route_Geometry_*.zip` updated roughly weekly. |
| **londonbusroutes.net** | None | Fallback for: operator, garage, PVR, vehicle type, destinations, 24-hour aliasing | HTTP (not HTTPS). HTML is fragile — we parse with regex, not fixed-width columns (previous bug). Scrape with a 200ms courtesy delay. |
| **londonbustimes.com / bustimes.org** | None | Secondary operator cross-reference | Independent of londonbusroutes.net — survives their downtime. |
| **postcodes.io** | None | Bulk postcode → lat/lon for garages | Free, generous limits. Cached in `data/source/geocode_cache.json`, persisted between runs. |
| **Photon → Nominatim (OSM)** | None | Fallback geocode for garage addresses without a clean postcode | Photon primary (OSM-backed, tolerates sustained use). Nominatim is strict — respect its 1 req/s and 60s back-off on 429. |

---

## 2. Datapoints — per route

Master record: `data/route_classifications.json`, keyed by route ID (upper-case).
Every field below is denormalized into this file so the frontend only needs **one** JSON fetch.

| Field | Type | Primary source | Fallback chain | Notes / traps |
|---|---|---|---|---|
| `type` | `regular` \| `night` \| `twentyfour` \| `school` | Derived: route ID prefix + TfL `service_types` | Routes.htm href-share: N<id>↔<id> ⇒ <id> is 24h | TfL often returns only `Regular`; don't trust the API alone for 24-hour detection. |
| `isPrefix` | bool | Derived from route ID regex | — | Letter-prefixed IDs (A10, EL1, W7, X26) — but never for N-routes. |
| `lengthBand` | `short` \| `medium` \| `long` | Haversine sum of direction=1 geometry, binned | — | <8 / 8–20 / >20 km. Numeric km/miles aren't stored — the frontend only needs the band. |
| `deck` | `double` \| `single` \| null | Scraper (details.htm) + manual `vehicle-lookup.json` | Daytime alias sibling for N-routes | Watch for fleet prefix stripping: "B5LH/Gemini 3 2D*" → "B5LH/Gemini 3". |
| `vehicleType` | string | Scraper (details.htm, regex-parsed) | Alias | Mojibake — fall back from UTF-8 to Latin-1 (`2D­` → `2D`). |
| `propulsion` | `hybrid` \| `electric` \| `hydrogen` \| `diesel` \| null | `vehicle-lookup.json` keyed by vehicleType | Alias | Lookup maintained manually via `npm run update-vehicle-lookup`; new vehicle types appear with `null` until curated. |
| `operator` | string | Scraper (garages.csv) | routes.htm 3rd col → bustimes.org → last-known-good | Normalise to parent brand ("Abellio" → "Transport UK" where applicable). |
| `garageName` / `garageCode` | string | Scraper (garages.csv route-column parse) | Alias → last-known-good | Some routes run from multiple garages; today we store the primary only — see "known gaps". |
| `pvr` | integer | Scraper (details.htm) | Alias → last-known-good | Peak Vehicle Requirement. Sum of PVRs across all routes ≈ total fleet demand. |
| `frequency` | `high` \| `regular` \| `low` \| null | Computed in `fetch-frequencies.js` and stored flat in `frequencies.json` | — | Thresholds: ≤6 / 7–15 / >15 min between buses, measured over the weekday off-peak window (falling back through AM peak → PM peak → Saturday → overnight). The frontend only needs the band, so numeric headways are discarded once the band is derived. |

### Companion files

- **`data/frequencies.json`** — flat `{ routeId: "high" \| "regular" \| "low" }` map. TfL `/Line/<id>/Timetable/<firstStop>` primary; `times/<id>.htm` `<pre>` grids fallback. Consumed only by `build-classifications.js`.
- **`data/route_destinations.json`** — `{ outbound, inbound, service_types }` per route. TfL `/Line/<id>/Route` primary; routes.htm dashed "Origin - … - Destination" fallback. Route 969 has no API entry — hard-coded. Consumed by the frontend detail panel and by `build-classifications.js` (for `type` derivation).
- **`data/garages.geojson`** — garage geometry + operator + route allocation. Pipeline intermediate; feeds `fetch-route-details.js` and `build-garage-locations.js`.
- **`data/garage-locations.json`** — geocoded garage map markers. Consumed by the frontend.
- **`data/routes-overview.geojson`** — aggressively simplified full-network map layer. Consumed by the frontend.
- **`data/routes/<id>.geojson`** — per-route full-fidelity geometry. Consumed by the frontend when a single route is selected.
- **`data/stops.json`** — canonical stop registry. Shape: `{ stops: { "<naptanId>": { name, indicator, lat, lon, routes: ["1","24",…] } } }`. ~30 k unique stops; ~6 MB on disk, ~1.3 MB gzipped over the wire. Consumed by the frontend: (a) to resolve per-route stops when a route is selected, and (b) to power the bus-stop filter (stopId → routes reverse index is pre-denormalized so the filter is O(1) per feature).
- **`data/route_stops.json`** — per-route ordered stop list: `{ routes: { "1": [{ id, towards }, …] } }`. The `towards` label is the TfL stop-flag hint ("Towards Hampstead") and is per route+stop, not per stop alone. Consumed by the frontend when rendering stops for a selected route.
- **`data/build-meta.json`** — generation timestamps shown in the footer.
- **`data/geometry-source.json`** — upstream ZIP date, read by CI to skip re-committing unchanged per-route files.

Client-side aggregates (e.g. operator-level PVR share, electrification) are computed live in `js/stats.js` from `route_classifications.json` — no separate aggregate file on disk. Stops are **pre-baked weekly** into `stops.json` + `route_stops.json`; the frontend no longer calls the TfL API at runtime for stop data.

---

## 3. Pipeline stages (`npm run refresh`)

| # | Script | Reads | Writes | Failure behaviour |
|---|---|---|---|---|
| 1 | `fetch-data.js` | TfL geometry ZIP | `data/routes/<id>.geojson`, `geometry-source.json` | Soft fail. |
| 2 | `fetch-route-destinations.js` | TfL API → routes.htm | `route_destinations.json` | Soft fail; per-route fallback. |
| 3 | `fetch-route-stops.js` | TfL `/Line/<id>/StopPoints` | `stops.json`, `route_stops.json` | Soft fail; last-known-good kept on failure. |
| 4 | `fetch-garages.js` | garages.csv + postcodes.io | `garages.geojson`, `geocode_cache.json` | Soft fail; geocode cache reused. |
| 5 | `fetch-frequencies.js` | TfL timetables → times/<id>.htm | `frequencies.json` | Soft fail; per-route fallback; zero ≠ high. |
| 6 | `fetch-route-details.js` | garages.geojson + details.htm + bustimes | `source/route_details.json` | Soft fail; each source independently optional. |
| 7 | `build-classifications.js` | all above + `route-overrides.json` + `vehicle-lookup.json` + last-known-good `route_classifications.json` | `route_classifications.json` | **Merges last-known-good** so one bad scrape never wipes curated fields. |
| 8 | `build-overview.js` | classifications + per-route geojson | `routes-overview.geojson`, `build-meta.json` | Hard fail. Must re-run after step 7. |
| 9 | `build-garage-locations.js` | `garages.geojson` + Photon/Nominatim | `garage-locations.json` | Soft fail; address-keyed cache, usually zero network calls. |

### Field-precedence (in `build-classifications.js`)

```
route-overrides.json   (manual curation; always wins)
  └── scraper this run
        └── daytime alias sibling (for N-routes)
              └── independent secondary (bustimes.org for operator)
                    └── vehicle-lookup.json (for deck/propulsion)
                          └── last-known-good route_classifications.json
                                └── null
```

---

## 4. Known traps

- **Routes 700–799** — coach / excluded from geometry ZIP. No classification entry.
- **Route 969** — TfL Line endpoint returns nothing. Hard-coded in `fetch-route-destinations.js`.
- **N-prefix ≠ night-only** — if both N128 and 128 share a routes.htm `times/` URL, `128` is 24-hour. Derive, don't assume.
- **After-midnight hours ≥ 24** — TfL encodes night departures as `24:18` / `28:08` meaning 00:18 / 04:08 next day. Always wrap with `h % 24` before binning; without it every night journey lands at 1400+ minutes and misses every band.
- **Zero headway** — TfL returns `0` when a band has no service. Skip zeros when picking the representative headway; don't treat them as "high frequency".
- **Night-route schedule names** — TfL names night schedules things like "Friday Night/Saturday Morning" and "Mo-Th Nights/Tu-Fr Morning". `classifyScheduleName` in `fetch-frequencies.js` maps those to the correct weekday/Saturday bucket via first-match keyword.
- **Scraper encoding** — londonbusroutes.net sometimes serves Latin-1 mojibake (`2D­`). Decode fallback is required.
- **Vehicle lookup drift** — when operators refresh fleets, new `vehicleType` strings appear with null propulsion/deck. `update-vehicle-lookup.js` surfaces them; they must be filled manually.
- **Multi-garage routes** — some routes are shared across 2+ garages. We currently record only the primary; the classification record single-values it. Upgrading to arrays is a schema change for the frontend.
- **Geometry ZIP date** — the workflow only commits per-route files if the ZIP date changed, to avoid a 500 KB churn commit every week.
- **CI runtime** — the refresh is budgeted for <30 min; current p50 is ~6 min. If a scraper starts hanging, cap with per-request timeouts; don't let a single slow URL eat the 30-min ceiling.

---

## 5. Hosting & platform limits

| Dimension | Limit | Headroom today |
|---|---|---|
| **Cloudflare Pages** (free) | 500 builds/mo, unlimited bandwidth, 25 MiB per file, 20 000 files per deploy | We are static only — no deploy-time build. Largest deployed files are `stops.json` and `route_stops.json` at ~6 MB each (lazy-loaded on stop-search focus; ~1.3 MB each gzipped). Comfortably within. |
| **GitHub free plan** | 2 000 Actions minutes/mo (private repos; unlimited for public) | Weekly refresh uses ~6 min → ~25 min/mo. |
| **GitHub Actions job** | 6 h per job; 30-min timeout configured here | Plenty. |
| **Repo size** | No hard limit, but >1 GB warns; single file >100 MB blocked | Committed data ~3–4 MB. |
| **TfL API** | 500 req/min with key | Self-throttled to ~350. |
| **postcodes.io** | ~10 req/s bulk; no published hard cap | Cache hit rate ~100% on stable weeks. |
| **Nominatim** | 1 req/s, ≥1s between requests, UA required, 60s back-off on 429 | Photon is primary so we almost never hit Nominatim. |

**Secret storage:** `BUS_API_KEY` lives in GitHub Actions secrets and in a local `.env`
(gitignored). It is used **build-time only**; the frontend fetches static JSON/GeoJSON.

---

## 6. Manual curation surfaces

- `data/route-overrides.json` — per-route field overrides; any set field wins over every other source.
- `data/vehicle-lookup.json` — vehicleType → `{ deck, propulsion }`. Run `npm run update-vehicle-lookup` after a refresh to discover new entries.

These two files are the only hand-maintained data in the project. Everything else is regenerated weekly.
