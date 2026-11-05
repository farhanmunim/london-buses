import fs from 'fs';

/**
 * The v1 API contract, in one place: which datasets are published, what they are, and what must be
 * credited when they are reused. build-v1.js turns this registry into api/v1/ (data files, per-route
 * slices, index.json, openapi.json); the docs page reads those generated files, so nothing is listed twice.
 *
 * Adding a dataset = add a row here (+ its attribution ids). Removing or reshaping one is a breaking change
 * and needs /api/v2 — see the versioning policy in docs/api.md.
 */

/** Every credit the project owes, in one file shared by the API (meta.attribution, /api/v1/index.json), the About page
 *  and /docs: data/attribution.json. `group` is "data" (datasets) or "maps" (basemaps, libraries, fonts). */
export const ATTRIBUTION = Object.fromEntries(
  JSON.parse(fs.readFileSync(new URL('../../data/attribution.json', import.meta.url), 'utf8')).map(a => [a.id, a]));

/** name → { file (relative to data/), summary, attribution ids, shape hint }. `name` is the URL: /api/v1/{name}.json */
export const DATASETS = [
  { name: 'routes', file: 'api/routes.json', summary: 'Every active London bus route: id, display name and type.', attr: ['tfl'] },
  { name: 'route-meta', file: 'api/route-meta.json', summary: 'Per-route operator, garage, PVR/TVR, fleet type, propulsion, deck, frequency and contract fields, keyed by route id.', attr: ['tfl', 'lbr', 'bustimes', 'dvla'] },
  { name: 'route-stops', file: 'api/route-stops.json', summary: 'Ordered stop sequence for each route direction (id, name, coordinates, lines, indicator letter).', attr: ['tfl', 'os'] },
  { name: 'routes-overview', file: 'api/routes-overview.json', summary: 'Simplified geometry for every route as one GeoJSON FeatureCollection (map overview).', attr: ['tfl', 'os'] },
  { name: 'route-bboxes', file: 'api/route-bboxes.json', summary: 'Bounding box [west, south, east, north] per route.', attr: ['tfl', 'os'] },
  { name: 'route-destinations', file: 'route_destinations.json', summary: 'Destination boards (from/to) for each route and direction.', attr: ['tfl'] },
  { name: 'garages', file: 'api/garages.json', summary: 'Bus garages: code, name, operator, postcode, coordinates, PVR and licence capacity.', attr: ['lbr', 'dvsa', 'postcodes'] },
  { name: 'fleet', file: 'api/fleet.json', summary: 'Observed vehicles per route with make, age and propulsion aggregates (core fleet vs cover).', attr: ['tfl', 'dvla'] },
  { name: 'vehicles', file: 'api/vehicles.json', summary: 'Vehicle register: registration → make, fuel, age, last-seen routes.', attr: ['tfl', 'dvla'] },
  { name: 'tenders', file: 'api/tenders.json', summary: 'Every awarded route contract: bids, operator, cost per mile, contract dates — by tender id and by route. Includes provisional awards.', attr: ['tfl', 'fandom'] },
  { name: 'tender-programme', file: 'api/tender-programme.json', summary: 'The forward tendering programme: upcoming tenders and contract expiries.', attr: ['tfl'] },
  { name: 'line-status', file: 'api/line-status.json', summary: 'Current service status for every route (refreshed several times a day).', attr: ['tfl'] },
  { name: 'route-diversions', file: 'api/route-diversions.json', summary: 'Routes currently on diversion, with the stated reason and window.', attr: ['tfl'] },
  { name: 'diversion-history', file: 'api/diversion-history.json', summary: 'Rolling archive of observed diversions.', attr: ['tfl'] },
  { name: 'roadworks', file: 'api/roadworks.json', summary: 'Live road disruptions (TIMS) joined to the bus routes they affect.', attr: ['tfl'] },
  { name: 'roadworks-history', file: 'api/roadworks-history.json', summary: 'Rolling archive of observed road disruptions.', attr: ['tfl'] },
  { name: 'streetworks-history', file: 'api/streetworks-history.json', summary: 'Street works from DfT Street Manager affecting London (columnar: fields + enums + rows).', attr: ['dft', 'ogl'] },
  { name: 'dtro', file: 'api/dtro.json', summary: 'Digital traffic regulation orders (closures, bus lanes, gates, banned turns) joined to routes.', attr: ['dft', 'ogl'] },
  { name: 'route-performance', file: 'api/route-performance.json', summary: 'Excess wait time / on-time metrics and operated mileage by period, per route.', attr: ['tfl'] },
  { name: 'scheduled-mileage', file: 'api/scheduled-mileage.json', summary: 'Estimated scheduled kilometres and trips per route and day type.', attr: ['tfl', 'os'] },
  { name: 'crowding', file: 'api/crowding.json', summary: 'Busiest-point crowding band per route (TfL BUSTO snapshot).', attr: ['tfl'] },
  { name: 'crowding-profile', file: 'api/crowding-profile.json', summary: 'Crowding profile along each route.', attr: ['tfl'] },
  { name: 'bridges', file: 'api/bridges.json', summary: 'Low-bridge height restrictions.', attr: ['tfl', 'datastore', 'osm'] },
  { name: 'accidents', file: 'api/accidents.json', summary: 'Bus/coach-involved road collisions (DfT STATS19).', attr: ['dft', 'ogl'] },
  { name: 'cpi-cpa', file: 'api/cpi-cpa.json', summary: 'ONS CPI index and derived contract price-adjustment (CPA) rates.', attr: ['ons', 'ogl'] },
  { name: 'manifest', file: 'api/manifest.json', summary: 'What each dataset is, where it comes from, when it was last fetched and how often it updates.', attr: [] },
];

/** Per-route slices assembled from the datasets above. */
export const ROUTE_SLICE_ATTR = ['tfl', 'os', 'lbr', 'bustimes', 'dvla', 'fandom'];

export const LIVE = [
  { path: '/api/v1/live/vehicles', summary: 'Live bus positions for one route (?line=88), from the DfT Bus Open Data Service. Cached 10 s. Never stored.', attr: ['dft', 'ogl'] },
];

export const NOTICE = 'Provided as is, without warranty. Data is rebuilt from public sources several times a day; see meta.generatedAt and /api/v1/manifest.json for freshness.';
