# London Buses

Interactive map of every London bus route. Search routes; filter by operator, garage, route type, propulsion, frequency, deck, or bus stop; view route details and stops; and compare multiple routes side-by-side.

**Live site: [london-buses.farhan.app](https://london-buses.farhan.app)** · Open source under the [MIT License](LICENSE)

## What it does

The main app at `/` is a fully mobile-responsive single-page app — Routes, Map, Operators, Garages, Stops, Tender and CPI-CPA. The original map-first app is preserved read-only at `/archive/v1/` (old `/v2` links redirect to `/`).

- Renders the entire London bus network as a colour-coded overview layer, with full route detail on click — geometry, stops, direction toggle, operator, vehicle make/model, propulsion, average fleet age, frequency, previous operator, contract value and length, next-tender batch
- Route maps layer on demand: stops, **live buses** (BODS GPS), every **garage** with its distance to the route (operating and nearest garages tagged), **low bridges** graded by double-deck clearance, and bus-involved **collisions** as a severity-weighted heatmap (DfT STATS19)
- **Tenders**: every published TfL award (2003 →) and the full LBSL tendering programme in filterable, paginated tables with filter-aware analysis KPIs (median £/mile and its trend, bids per tender, incumbent retention, lowest-bid win rate); route pages plot the £/mile award history and flag routes coming up for tender
- **CPI-CPA**: the ONS CPI index (D7BT) by month with the contract price adjustment rates derived from it — P2P (85% of YoY, 4-month lag) and the 12-month rolling average — verified against ONS's reference tables
- Live service status per route (straight from TfL) with a network-wide summary; per-route crowding (peak load vs capacity, busiest stop/day/time)
- Stackable filters (operator, garage, route type, propulsion, frequency, deck, bus stop) that intersect; multi-route comparison mode; per-operator statistics
- CSV exports throughout (route register, tender awards, tendering programme, CPI-CPA series) plus v1's XLSX export

## How it works

This repository is the entire platform — GitHub Actions is the scheduler and compute, git is the database, and Cloudflare Pages serves it all (plus one Pages Function). No backend, no VPS, no external API.

Scheduled GitHub Actions workflows fetch every dataset from its public source, validate it (a failed validation commits nothing — the last good data keeps serving), and commit the results. `scripts/build-api.js` assembles the committed primary datasets into a served **faux-API** (`data/api/*.json`) that both front-ends read as plain static JSON.

### Refresh schedule

All times UTC; a run commits (and the site redeploys) only when the data actually changed. The About page in the app shows the same schedule live, with last-updated and next-check times per dataset.

| Pipeline | Datasets | Schedule | Workflow |
|---|---|---|---|
| Nightly full refresh | routes, geometry, stops, operators/garages/PVR, CPI-CPA, programme | daily 03:17 | `weekly-refresh.yml` |
| Service status | line status, diversion register | every 2 h, 07:41–21:41 | `refresh-status.yml` |
| Fleet sweeps | arrivals samples → DVLA-enriched fleet | every 8 h at 07:20 / 15:20 / 23:20 | `refresh-fleet.yml` |
| Tender checks | awards + programme | hourly 07:20–20:20, plus chained off every status/fleet run | `refresh-tenders.yml` |

Live surfaces (arrivals boards, live bus positions, live route status) are never stored: they go straight from the browser to TfL's CORS-open Unified API, and live bus GPS comes through `functions/api/live/vehicles.js` — a Cloudflare Pages Function that proxies the DfT BODS SIRI-VM feed (secret key, no CORS) with a 10-second edge cache.

Internal architecture, data handling, and pipeline notes live in [data.md](data.md).

## Local development

```bash
npm install
cp .env.example .env          # then set the required keys (see the file for where to get them)
npm run refresh               # full data pipeline (optional — committed data already serves)
npx serve .                   # any static file server works; the app is a single index.html
```

The site runs entirely from the committed `data/api/*.json`, so you can hack on the frontend with no keys at all — keys are only needed to run the data pipeline (`BUS_API_KEY`, `DVLA_API_KEY`) or the live-vehicles Pages Function (`BODS_API_KEY`).

Verification suites live in `tests/` (`node tests/verify-<name>.mjs` — they use Playwright with a system Chromium and mock all external feeds).

## Contributing

Issues and pull requests are welcome — bug reports, data corrections (see `data/route-overrides.json` for how per-route fixes are pinned), and improvements alike. Please run the verification suites before opening a PR.

## Licence

Code is [MIT](LICENSE). The datasets are derived from third-party sources and remain subject to their own terms: [TfL open data](https://tfl.gov.uk/info-for/open-data-users/) (Powered by TfL Open Data; contains OS data © Crown copyright and database rights 2016, Geomni UK Map data © and database rights 2019), public sector information under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) (DfT, DVLA, ONS), [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL), and londonbusroutes.net (community reference).

## Contributors

Thanks to Daniel Plumb, Mark Leonard-Adoko, Ross Levine, Paul Tran, and Andy Corbett for data, feedback, and reference material that has shaped this project.

## Tech

Vanilla JavaScript (ES modules) + [Leaflet](https://leafletjs.com/). No framework, no bundler.
