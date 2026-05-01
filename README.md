# London Buses

Interactive map of every London bus route. Search routes, filter by type, operator, propulsion, frequency, or deck, view route details and stops, and compare multiple routes side-by-side.

**Live site: [london-buses.farhan.app](https://london-buses.farhan.app)**

## What it does

- Renders the entire London bus network as a colour-coded overview layer
- Full route detail on click — geometry, stops, direction toggle, operator, vehicle make/model, propulsion, average fleet age, frequency, EWT/OTP reliability, previous operator, contract value (£/mile), next-tender date
- Multi-route comparison mode with endpoint labels
- Per-operator statistics that update live as you filter
- XLSX export (Routes / Garages / Network overview) of the current filter selection

## How it works

Static site — no backend, no build step at deploy time. A weekly GitHub Actions job pulls data from TfL's official APIs and londonbusroutes.net, cleans and merges it, and commits the resulting JSON and GeoJSON files back to the repo. Cloudflare Pages auto-deploys from `main`.

See [AGENTS.md](AGENTS.md) for the full architecture, data pipeline, and repository structure.

## Data sources

- [Transport for London Unified API](https://api.tfl.gov.uk/) — route geometry, destinations, stops, live arrivals (per-route vehicle observations)
- [TfL iBus open data](https://ibus.data.tfl.gov.uk/) — every TfL bus's registration plate + operator + fleet code
- [DVLA Vehicle Enquiry Service](https://developer-portal.driver-vehicle-licensing.api.gov.uk/) — registration → make, fuel type, year of first registration. Authoritative per-route propulsion + average fleet age
- [londonbusroutes.net](https://londonbusroutes.net/) — operator, vehicle type, PVR, garage allocation, headway-column fallback for routes TfL doesn't surface
- TfL Bus Performance (QSI) PDF — per-route Excess Wait Time (EWT) for high-frequency routes and On-Time Performance (OTP) for low-frequency, refreshed every 4 weeks
- TfL per-route QSI PDFs (`bus.data.tfl.gov.uk/boroughreports/routes/performance-route-{ID}.pdf`) — per-route Minimum Performance Standard (MPS), the contractual EWT/OTP/mileage threshold each route is graded against. Values vary route-by-route within a service class because each tender contract sets its own standard.
- TfL tender awards (`tfl.gov.uk/forms/13796.aspx`) — every historical bus tender (~2,500 awards back to 2003) with awarded operator, accepted/lowest/highest bids, cost per live mile, and notes
- TfL annual tendering programme PDFs — upcoming tender schedule by financial year (issue/return/award/contract-start dates, vehicle spec)

## Historical store

A weekly pipeline mirrors current state into a Supabase Postgres database — `vehicles`, `route_snapshots`, `route_vehicle_observations`, `garage_snapshots`, `route_performance`, `tenders`, `tender_programme` — so we can build trend charts and compare past vs. present (e.g. "how has the 25's fleet age changed over the contract?"). The public map keeps reading static JSON from Cloudflare Pages; Supabase is a write-only sink at the end of the pipeline. Every row carries an `extracted_at` (when our pipeline collected it) and a period column (when the data is accurate as of) so freshness is always explicit.

## Pipeline efficiency

Every fetcher self-throttles and persists its own freshness watermark, so the weekly run does the minimum work upstream:

- **Geometry ZIP** — list S3, compare ZIP date against `data/geometry-source.json::zipDate`; skip download + extract if unchanged (~95% of weeks)
- **Route performance PDF** — `HEAD` first, compare `Last-Modified` against cached value; skip parse if unchanged (PDF only republishes every ~4 weeks)
- **Tender programme PDFs** — per-year `HEAD`; skip closed financial years that haven't been re-published (drops the active year only in steady state)
- **Vehicle fleet (DVLA)** — sticky 90-day TTL per registration; cap of 6,000 lookups/run
- **Tender awards** — once cached, never re-fetched (awards are immutable); cap of 4,000 per run

Pass `--force` to any of the above scripts to bypass and re-fetch.

## Upcoming

- **Analytics page** — `/analytics` reading from Supabase via the anon key (RLS-locked to read-only). Charts: fleet-age trend, operator share over time, electrification curve, EWT/OTP movement around tender events, operator churn by route.

## Contributors

Thanks to Daniel Plumb, Mark Leonard-Adoko, and Ross Levine for data, feedback, and reference material that has shaped this project.

## Tech

Vanilla JavaScript (ES modules), [Leaflet](https://leafletjs.com/), CartoDB Voyager tiles, Cloudflare Pages, GitHub Actions.

## Licence

[MIT](LICENSE)
