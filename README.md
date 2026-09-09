# London Buses

An interactive map and data explorer for every bus route in London. Search routes. See them on a map. Watch live arrivals and live bus positions. Browse operators, garages and stops. Dig into contracts: who runs each route, what it cost, and when it comes up for tender again.

**Live site: [london-buses.farhan.app](https://london-buses.farhan.app)** · [Full documentation](https://london-buses.farhan.app/docs.html) · Open source under the [MIT License](LICENSE)

## What it does

The app at `/` covers Routes, Map, Operators, Garages, Stops, Tender and CPI-CPA. It works well on phones. The original map-first app is preserved at `/archive/v1/`.

- Draws the whole network as one colour-coded map. Click a route for full detail: geometry, stops, operator, vehicle type, propulsion, fleet age, contract value, next tender.
- Route maps add layers on demand: stops, **live buses** (GPS), every **garage** with its distance to the route, **low bridges** graded by double-deck clearance, and bus-involved **collisions** as a heatmap.
- **Tender**: every published TfL award since 2003, plus the forward tendering programme. Both tables are searchable by route, operator or tranche, with analysis numbers computed for the current filter (median £/mile and trend, bids per tender, incumbent retention). Route pages chart their own award history.
- **CPI-CPA**: the ONS CPI index by month and the contract price adjustment rates derived from it. Verified against ONS reference tables.
- Live service status per route, straight from TfL. Per-route crowding: peak load, busiest stop, busiest time.
- Stackable filters, multi-route comparison, per-operator statistics, CSV exports throughout.

## How it works

There is no server. The repository is the whole platform. GitHub Actions is the scheduler and the computer. Git is the database. Cloudflare Pages serves it all, plus one small edge function for live bus GPS.

Scheduled workflows fetch every dataset from its public source, validate it, and commit the results. A failed validation commits nothing — the last good data keeps serving. `scripts/build-api.js` turns the committed datasets into a set of static JSON files under `data/api/` (the "faux-API") that the app reads like an API.

The full story — GitHub, the app, the pipeline, storage, Cloudflare, deployment — is in the [docs](https://london-buses.farhan.app/docs.html). Deep per-field data notes are in [data.md](data.md).

### Refresh schedule

Cron times are UTC (that is what GitHub Actions runs on). The About page in the app shows the same schedule in London time, with last-updated and next-check times per dataset. A run commits — and the site redeploys — only when the data actually changed.

| Pipeline | Datasets | Schedule | Workflow |
|---|---|---|---|
| Nightly full refresh | routes, geometry, stops, operators/garages/PVR, CPI-CPA, programme | daily 03:17 | `weekly-refresh.yml` |
| Service status | line status, diversion register | every 2 h, 07:41–21:41 | `refresh-status.yml` |
| Fleet sweeps | arrivals samples → DVLA-enriched fleet | every 8 h at 07:20 / 15:20 / 23:20 | `refresh-fleet.yml` |
| Tender checks | awards + programme | hourly 07:20–20:20, plus after every other run | `refresh-tenders.yml` |

Live data is never stored. Arrivals and route status go straight from the browser to TfL. Live bus positions come through `functions/api/live/vehicles.js`, a Cloudflare Pages Function that proxies the DfT BODS GPS feed with a 10-second edge cache.

## Local development

```bash
npm install
cp .env.example .env          # then set the keys (the file says where to get them)
npm run refresh               # full data pipeline — optional, committed data already works
npx serve .                   # any static file server; the app is one index.html
```

The site runs entirely from the committed `data/api/*.json`. You can work on the frontend with no keys at all. Keys are only needed to run the pipeline (`BUS_API_KEY`, `DVLA_API_KEY`) or the live-vehicles function (`BODS_API_KEY`).

Tests live in `tests/`. Run one with `node tests/verify-<name>.mjs`. They use Playwright with a system Chromium and mock all external feeds, so they pass offline.

## Contributing

Issues and pull requests are welcome. Bug reports, data corrections and improvements alike. Per-route data fixes go in `data/route-overrides.json` — anything set there beats scraped data and survives every refresh. Please run the test suites before opening a PR.

## Contributors

Thanks to Daniel Plumb, Mark Leonard-Adoko, Ross Levine, Paul Tran, and Andy Corbett for data, feedback, and reference material.

## Licence

Code is [MIT](LICENSE). The data comes from third-party sources and stays under their terms: [TfL open data](https://tfl.gov.uk/info-for/open-data-users/) (Powered by TfL Open Data; contains OS data © Crown copyright and database rights 2016, Geomni UK Map data © and database rights 2019), public sector information under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) (DfT, DVLA, ONS), [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL), and londonbusroutes.net (community reference).

## Tech

Vanilla JavaScript and [Leaflet](https://leafletjs.com/). No framework. No bundler. One HTML file.
