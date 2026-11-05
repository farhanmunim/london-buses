# Public API (v1)

`https://londonbuses.org/api/v1/` — open JSON, no key, CORS-enabled. Human docs: `/docs#api`. Machine docs: `/api/v1/openapi.json`, `/api/v1/index.json`.
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
- A breaking change ships as `/api/v2`; `v1` keeps running for a long overlap and is announced on `/docs#api`.
- Datasets keep the pipeline's own shape (some keyed by route id, some arrays, `streetworks-history` columnar). Per-route slices (`/routes/{id}.json`) are the friendly entry point.

## Adding / changing a dataset
1. Add a row to `DATASETS` in `scripts/_lib/api-registry.js` (+ attribution ids). 2. `npm run build-v1`. 3. `node tests/verify-api.mjs`.
Attribution is mandatory per dataset — check each source's licence before publishing it (see `ATTRIBUTION`).

## Freshness
Every data commit is one Pages build, and builds are the scarce free resource (500/month; the pipeline uses ~330). The API adds none. Current cadences: status/diversions ~2 h, tenders hourly in the TfL publication window, fleet 8 h, the rest daily or static.
**If fresher status is ever needed:** don't add paid services. Run a small poller on the Coolify VPS (one TfL call every few minutes, held in memory, served with CORS at e.g. `data.londonbuses.org` behind Cloudflare's free cache), and have the apps prefer it with the static copy as fallback. Not built — nobody needs it yet; the site already calls TfL directly for per-route live status.

## Live buses
`/api/v1/live/vehicles` runs a Function per request (free tier ≈100 k/day shared with the site). If third-party traffic outgrows that, move live feeds to the same VPS poller (one BODS/TfL call per interval, served from memory behind Cloudflare's cache).
