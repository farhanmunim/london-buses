# London Buses

Interactive map of every London bus route. Search routes; filter by operator, garage, route type, propulsion, frequency, deck, or bus stop; view route details and stops; and compare multiple routes side-by-side.

**Live site: [london-buses.farhan.app](https://london-buses.farhan.app)**

> Private project. All rights reserved. Not for redistribution or reuse.

## What it does

- Renders the entire London bus network as a colour-coded overview layer
- Full route detail on click — geometry, stops, direction toggle, operator, vehicle make/model, propulsion, average fleet age, frequency, reliability, previous operator, contract value, contract length, next-tender batch
- Live service status per route (Good Service / disruption + TfL's reason) and a network-wide summary on the Overview panel; per-route crowding (peak load vs capacity, busiest stop/day/time)
- Stackable filters (operator, garage, route type, propulsion, frequency, deck, bus stop) that intersect — matching routes are listed in the side panel and highlighted on the map
- Multi-route comparison mode, per-operator statistics, and an XLSX export of the current view

## How it works

This repository is the entire platform — GitHub Actions is the scheduler and compute, git is the database, and Cloudflare Pages serves it all (plus one Pages Function). No backend, no VPS, no external API.

Scheduled GitHub Actions workflows fetch every dataset from its public source, validate it (a failed validation commits nothing — the last good data keeps serving), and commit the results. `scripts/build-api.js` assembles the committed primary datasets into a served **faux-API** (`data/api/*.json`) that both front-ends read as plain static JSON. Cadences match each dataset's rhythm: the full pipeline runs nightly at 03:17 UTC, service status and diversions refresh ~6×/day, tender awards are checked after TfL's afternoon publish windows, and fleet sweeps sample TfL arrivals around midday and midnight (plus the nightly run's night-network pass).

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
