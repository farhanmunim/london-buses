# London Buses

Interactive map of every London bus route. Search routes; filter by operator, garage, route type, propulsion, frequency, deck, or bus stop; view route details and stops; and compare multiple routes side-by-side.

**Live site: [london-buses.farhan.app](https://london-buses.farhan.app)**

> Private project. All rights reserved. Not for redistribution or reuse.

## What it does

Two front-ends share the same data: the original map-first app at `/` and the v2 single-page app at `/v2` (fully mobile-responsive — Routes, Map, Operators, Garages, Stops, Tenders and CPI-CPA).

- Renders the entire London bus network as a colour-coded overview layer, with full route detail on click — geometry, stops, direction toggle, operator, vehicle make/model, propulsion, average fleet age, frequency, previous operator, contract value and length, next-tender batch
- Route maps layer on demand: stops, **live buses** (BODS GPS), every **garage** with its distance to the route (operating and nearest garages tagged), **low bridges** graded by double-deck clearance, and bus-involved **collisions** as a severity-weighted heatmap (DfT STATS19)
- **Tenders**: every published TfL award (2003 →) and the full LBSL tendering programme in filterable, paginated tables with filter-aware analysis KPIs (median £/mile and its trend, bids per tender, incumbent retention, lowest-bid win rate); route pages plot the £/mile award history and flag routes coming up for tender
- **CPI-CPA**: the ONS CPI index (D7BT) by month with the contract price adjustment rates derived from it — P2P (85% of YoY, 4-month lag) and the 12-month rolling average — verified against ONS's reference tables
- Live service status per route (straight from TfL) with a network-wide summary; per-route crowding (peak load vs capacity, busiest stop/day/time)
- Stackable filters (operator, garage, route type, propulsion, frequency, deck, bus stop) that intersect; multi-route comparison mode; per-operator statistics
- CSV exports throughout (route register, tender awards, tendering programme, CPI-CPA series) plus v1's XLSX export

## How it works

This repository is the entire platform — GitHub Actions is the scheduler and compute, git is the database, and Cloudflare Pages serves it all (plus one Pages Function). No backend, no VPS, no external API.

Scheduled GitHub Actions workflows fetch every dataset from its public source, validate it (a failed validation commits nothing — the last good data keeps serving), and commit the results. `scripts/build-api.js` assembles the committed primary datasets into a served **faux-API** (`data/api/*.json`) that both front-ends read as plain static JSON. Cadences match each dataset's rhythm: the full pipeline runs nightly at 03:17 UTC, service status and diversions refresh every ~2h through the day, tender awards are checked hourly through the day (TfL publishes early-to-mid afternoon), and fleet sweeps sample TfL arrivals every ~8h (plus the nightly run's night-network pass).

Live data is never stored: live arrivals and route status go straight to TfL's CORS-open Unified API from the browser, and live bus positions come through `functions/api/live/vehicles.js` — a Cloudflare Pages Function that proxies the DfT BODS SIRI-VM feed (secret key, no CORS) with a 10-second edge cache.

Internal architecture, data handling, and pipeline notes live in [data.md](data.md).

## Local development

```bash
npm install
cp .env.example .env          # then set the required keys
npm run refresh               # full data pipeline
npx serve .                   # or: node serve.mjs
```

## Contributors

Thanks to Daniel Plumb, Mark Leonard-Adoko, Ross Levine, Paul Tran, and Andy Corbett for data, feedback, and reference material that has shaped this project.

## Tech

Vanilla JavaScript (ES modules) + [Leaflet](https://leafletjs.com/). No framework, no bundler.
