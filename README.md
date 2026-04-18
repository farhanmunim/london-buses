# London Buses

Interactive map of every London bus route. Search routes, filter by type, operator, propulsion, frequency, or deck, view route details and stops, and compare multiple routes side-by-side.

**Live site: [london-buses.farhan.app](https://london-buses.farhan.app)**

## What it does

- Renders the entire London bus network as a colour-coded overview layer
- Full route detail on click — geometry, stops, direction toggle, operator, vehicle, frequency
- Multi-route comparison mode with endpoint labels
- Per-operator statistics that update live as you filter
- XLSX export (Routes / Garages / Network overview) of the current filter selection

## How it works

Static site — no backend, no build step at deploy time. A weekly GitHub Actions job pulls data from TfL's official APIs and londonbusroutes.net, cleans and merges it, and commits the resulting JSON and GeoJSON files back to the repo. Cloudflare Pages auto-deploys from `main`.

See [AGENTS.md](AGENTS.md) for the full architecture, data pipeline, and repository structure.

## Data sources

- [Transport for London Unified API](https://api.tfl.gov.uk/) — route geometry, destinations, stops
- [londonbusroutes.net](https://londonbusroutes.net/) — operator, vehicle type, PVR, and frequency data

## Tech

Vanilla JavaScript (ES modules), [Leaflet](https://leafletjs.com/), CartoDB Voyager tiles, Cloudflare Pages, GitHub Actions.

## Licence

[MIT](LICENSE)
