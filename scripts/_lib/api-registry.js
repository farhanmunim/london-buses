/**
 * The v1 API contract, in one place: which datasets are published, what they are, and what must be
 * credited when they are reused. build-v1.js turns this registry into api/v1/ (data files, per-route
 * slices, index.json, openapi.json); the docs page reads those generated files, so nothing is listed twice.
 *
 * Adding a dataset = add a row here (+ its attribution ids). Removing or reshaping one is a breaking change
 * and needs /api/v2 — see the versioning policy in docs/api.md.
 */

export const ATTRIBUTION = {
  tfl: {
    id: 'tfl',
    text: 'Powered by TfL Open Data',
    url: 'https://tfl.gov.uk/info-for/open-data-users/',
    licence: 'TfL Open Data licence (based on the Open Government Licence v3.0)',
  },
  os: {
    id: 'os',
    text: 'Contains OS data © Crown copyright and database rights 2016 and Geomni UK Map data © and database rights 2019',
    url: 'https://tfl.gov.uk/info-for/open-data-users/our-open-data',
    licence: 'As supplied with TfL Open Data',
  },
  ogl: {
    id: 'ogl',
    text: 'Contains public sector information licensed under the Open Government Licence v3.0',
    url: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    licence: 'Open Government Licence v3.0',
  },
  dft: {
    id: 'dft',
    text: 'Department for Transport open data (STATS19, D-TRO, Street Manager, Bus Open Data Service)',
    url: 'https://www.gov.uk/government/organisations/department-for-transport',
    licence: 'Open Government Licence v3.0',
  },
  ons: {
    id: 'ons',
    text: 'Office for National Statistics — CPI All Items Index (D7BT)',
    url: 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7bt/mm23',
    licence: 'Open Government Licence v3.0',
  },
  dvla: {
    id: 'dvla',
    text: 'Vehicle make, fuel type and age derived from the DVLA Vehicle Enquiry Service',
    url: 'https://developer-portal.driver-vehicle-licensing.api.gov.uk/',
    licence: 'DVLA VES terms — derived aggregates only; no keeper or personal data',
  },
  dvsa: {
    id: 'dvsa',
    text: 'Operator licence data from DVSA Vehicle Operator Licensing (OGL)',
    url: 'https://www.gov.uk/government/organisations/driver-and-vehicle-standards-agency',
    licence: 'Open Government Licence v3.0',
  },
  lbr: {
    id: 'lbr',
    text: 'Garage and route allocations compiled from londonbusroutes.net',
    url: 'https://www.londonbusroutes.net/',
    licence: 'Community-maintained; credit the source',
  },
  osm: {
    id: 'osm',
    text: '© OpenStreetMap contributors (bridge-height cross-check)',
    url: 'https://www.openstreetmap.org/copyright',
    licence: 'Open Database Licence (ODbL)',
  },
  fandom: {
    id: 'fandom',
    text: 'Provisional tender awards (flagged "provisional") from the London Bus Routes wiki, london-bus-routes.fandom.com',
    url: 'https://london-bus-routes.fandom.com/',
    licence: 'CC BY-SA 3.0 — share-alike applies to those records',
  },
  postcodes: {
    id: 'postcodes',
    text: 'Garage coordinates via postcodes.io (contains OS data © Crown copyright)',
    url: 'https://postcodes.io/',
    licence: 'Open Government Licence v3.0',
  },
};

/** name → { file (relative to data/), summary, attribution ids, shape hint }. `name` is the URL: /api/v1/{name}.json */
export const DATASETS = [
  { name: 'routes', file: 'api/routes.json', summary: 'Every active London bus route: id, display name and type.', attr: ['tfl'] },
  { name: 'route-meta', file: 'api/route-meta.json', summary: 'Per-route operator, garage, PVR/TVR, fleet type, propulsion, deck, frequency and contract fields, keyed by route id.', attr: ['tfl', 'lbr', 'dvla'] },
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
  { name: 'bridges', file: 'api/bridges.json', summary: 'Low-bridge height restrictions.', attr: ['tfl', 'osm'] },
  { name: 'accidents', file: 'api/accidents.json', summary: 'Bus/coach-involved road collisions (DfT STATS19).', attr: ['dft', 'ogl'] },
  { name: 'cpi-cpa', file: 'api/cpi-cpa.json', summary: 'ONS CPI index and derived contract price-adjustment (CPA) rates.', attr: ['ons', 'ogl'] },
  { name: 'manifest', file: 'api/manifest.json', summary: 'What each dataset is, where it comes from, when it was last fetched and how often it updates.', attr: [] },
];

/** Per-route slices assembled from the datasets above. */
export const ROUTE_SLICE_ATTR = ['tfl', 'os', 'lbr', 'dvla', 'fandom'];

export const LIVE = [
  { path: '/api/v1/live/vehicles', summary: 'Live bus positions for one route (?line=88), from the DfT Bus Open Data Service. Cached 10 s. Never stored.', attr: ['dft', 'ogl'] },
];

export const NOTICE = 'Provided as is, without warranty. Data is rebuilt from public sources several times a day; see meta.generatedAt and /api/v1/manifest.json for freshness.';
