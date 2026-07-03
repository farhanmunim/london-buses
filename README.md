# London Buses

Interactive map of every London bus route. Search routes; filter by operator, garage, route type, propulsion, frequency, deck, or bus stop; view route details and stops; and compare multiple routes side-by-side.

**Live site: [london-buses.farhan.app](https://london-buses.farhan.app)**

> Private project. All rights reserved. Not for redistribution or reuse.

## What it does

- Renders the entire London bus network as a colour-coded overview layer
- Full route detail on click — geometry, stops, direction toggle, operator, vehicle make/model, propulsion, average fleet age, frequency, reliability, previous operator, contract value, contract length, next-tender batch
- Live service status per route (Good Service / disruption + TfL's reason) and a network-wide summary on the Overview panel; per-route crowding (peak load vs capacity, busiest stop/day/time) — both from the Atlas API
- Stackable filters (operator, garage, route type, propulsion, frequency, deck, bus stop) that intersect — matching routes are listed in the side panel and highlighted on the map
- Multi-route comparison mode, per-operator statistics, and an XLSX export of the current view

## How it works

Static site — no backend, no deploy-time build. A scheduled job refreshes the data from public sources each week and commits the resulting JSON/GeoJSON back to the repo; the host auto-deploys from the default branch.

The frontend data layer (`js/api.js`) is API-first against the [Atlas public API](https://atlas.farhan.app/api/v1) for the datasets it serves — garage locations (merged join-safely with the committed record), tender-award history, per-route reliability (EWT/OTP + MPS, overlaid onto the classifications), live line status, crowding, and the freshness manifest — and falls back to the committed files automatically when the API is unreachable (API-only datasets simply hide their UI). Everything else (per-route geometry, the classification enrichment, stops, destinations, the overview layer) loads from the committed weekly-refresh data, which the API does not yet cover at the fidelity the UI needs. Historical storage lives in the Atlas warehouse (`/api/v1/history`) — this project no longer writes to any database.

Internal architecture, data handling, and pipeline notes live in [data.md](data.md).

## Local development

```bash
npm install
cp .env.example .env          # then set the required keys
npm run refresh               # full data pipeline
npx serve .                   # or: node serve.mjs
```

## Contributors

Thanks to Daniel Plumb, Mark Leonard-Adoko, Ross Levine, and Paul Tran for data, feedback, and reference material that has shaped this project.

## Tech

Vanilla JavaScript (ES modules) + [Leaflet](https://leafletjs.com/). No framework, no bundler.
