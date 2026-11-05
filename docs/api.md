# Public API (v1)

`https://londonbuses.org/api/v1/` — open JSON, no key, CORS-enabled. Human docs: `/developers`. Machine docs: `/api/v1/openapi.json`, `/api/v1/index.json`.
The website is a client of this API (`js/app/core/data.js`, `js/intelligence/data.js`), so what it shows is what the API serves.

## How it is built (all free-tier)
- `scripts/_lib/api-registry.js` is the contract: datasets, summaries, and which attributions each needs.
- `scripts/build-v1.js` turns the committed datasets (`data/api/*.json`, `data/routes/*.geojson`, `data/route_destinations.json`) into `api/v1/` **at deploy time** — it is gitignored, never committed, so the bots' data commits stay small. ~2 200 static files, ~64 MB.
- Cloudflare Pages serves them from the CDN: unlimited bandwidth, no Functions invocations. `_headers` adds CORS and `Cache-Control: max-age=0, must-revalidate` (ETag → 304), so consumers see a new deploy immediately.
- The only dynamic endpoint is `/api/v1/live/vehicles?line=` (Pages Function, alias of `/api/live/vehicles`, 10 s edge cache, DfT BODS). Bus arrivals are not proxied: call TfL's `/StopPoint/{id}/Arrivals` directly (CORS-open).
- `tests/verify-api.mjs` checks every generated file (envelope, attribution, route coverage, OpenAPI paths, headers, Pages limits) and runs in `npm test` / CI.

## Response shape
```json
{ "meta": { "api": "londonbuses.org", "version": "v1", "resource": "/api/v1/route-meta.json",
            "generatedAt": "…", "source": "…", "cadence": "daily",
            "attribution": [ { "id": "tfl", "text": "Powered by TfL Open Data", "url": "…", "licence": "…" } ],
            "notice": "…" },
  "data": { … the dataset exactly as the pipeline produced it … } }
```

## Versioning policy
- Within `v1` fields are **added, never removed or retyped**. New datasets and new route-slice fields are non-breaking.
- A breaking change ships as `/api/v2`; `v1` keeps running for a long overlap and is announced on `/developers`.
- Datasets keep the pipeline's own shape (some keyed by route id, some arrays, `streetworks-history` columnar). Per-route slices (`/routes/{id}.json`) are the friendly entry point.

## Adding / changing a dataset
1. Add a row to `DATASETS` in `scripts/_lib/api-registry.js` (+ attribution ids). 2. `npm run build-v1`. 3. `node tests/verify-api.mjs`.
Attribution is mandatory per dataset — check each source's licence before publishing it (see `ATTRIBUTION`).

## Freshness
Every data commit is one Pages build, and builds are the scarce free resource (500/month; the pipeline uses ~330). The API adds none. Current cadences: status/diversions ~2 h, tenders hourly in the TfL publication window, fleet 8 h, the rest daily or static.
**Next step (not built yet): a "hot lane".** Publish the fastest-moving datasets (line-status, diversions, road works) from a GitHub Action straight to Cloudflare R2 (free tier: 10 GB, 1 M writes/month, free egress) behind a cache-friendly route — no commit, no build — so they can refresh every 10–15 minutes without touching the build budget. Route slices would then link to those resources instead of embedding them.

## Live buses
`/api/v1/live/vehicles` runs a Function per request (free tier ≈100 k/day shared with the site). If third-party traffic outgrows that, move live feeds to a single poller on the Coolify VPS (one BODS/TfL call per interval, served from memory behind Cloudflare's cache).
