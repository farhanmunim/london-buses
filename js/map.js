/**
 * map.js — Map initialisation, overview layer, route highlighting
 */

const LONDON = [51.505, -0.118];
const ZOOM   = 11;

const COLOR_OUTBOUND = '#e1251b';
const COLOR_INBOUND  = '#3b82f6';

// Per-type colors — chosen for visibility on CartoDB Voyager tiles
const TYPE_COLORS = {
  regular:    '#e1251b', // London bus red
  prefix:     '#ea580c', // orange
  twentyfour: '#0d9488', // teal
  night:      '#8b5cf6', // violet (distinct from blue water)
  school:     '#eab308', // yellow
};

function featureColor(props) {
  if (props.isPrefix)                   return TYPE_COLORS.prefix;
  if (props.routeType === 'night')      return TYPE_COLORS.night;
  if (props.routeType === 'twentyfour') return TYPE_COLORS.twentyfour;
  if (props.routeType === 'school')     return TYPE_COLORS.school;
  return TYPE_COLORS.regular;
}

// Active filter state — null means "all pass"
let _filters = {
  types:      null,
  deck:       null,
  frequency:  null,
  operator:   null,
  propulsion: null,
};

let _map             = null;
let _overviewLayer   = null;
let _overviewGeoJson = null;
let _outlineLayer    = null; // multi-route dark outline
let _routeLayer      = null;
let _stopsLayer      = null;
let _stopsVisible    = true;
let _identifyPopup   = null;

const _routeCanvas = L.canvas({ padding: 0.5 });
const _stopsCanvas = L.canvas({ padding: 0.5 });

// ── Geometry helpers ──────────────────────────────────────────────────────────

function ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// When a filter set is active, routes must match one of the selected values.
// Null/missing values are represented by the special value '__unknown__' —
// the user must explicitly tick "Unknown" to include them.
function matchesFilterSet(set, value) {
  if (!set) return true;
  if (value == null || value === '') return set.has('__unknown__');
  return set.has(value);
}

function featurePassesFilter(props) {
  if (_filters.types) {
    const { routeType, isPrefix } = props;
    const typeKey = isPrefix                 ? 'prefix'
                  : routeType === 'night'    ? 'night'
                  : routeType === 'school'   ? 'school'
                  :                            'regular';
    if (!_filters.types.has(typeKey)) return false;
  }
  if (!matchesFilterSet(_filters.deck,       props.deck))       return false;
  if (!matchesFilterSet(_filters.frequency,  props.frequency))  return false;
  if (!matchesFilterSet(_filters.operator,   props.operator))   return false;
  if (!matchesFilterSet(_filters.propulsion, props.propulsion)) return false;
  return true;
}

function findRoutesNearPoint(containerPt, pixelRadius) {
  if (!_overviewGeoJson || !_map) return new Map();
  const found = new Map();
  const { x: px, y: py } = containerPt;

  for (const feature of _overviewGeoJson.features) {
    const props = feature.properties;
    if (!featurePassesFilter(props)) continue;
    const { routeId } = props;
    if (found.has(routeId)) continue;

    const coords = feature.geometry.coordinates;
    outer: for (let i = 0; i < coords.length - 1; i++) {
      const a = _map.latLngToContainerPoint([coords[i][1],   coords[i][0]]);
      const b = _map.latLngToContainerPoint([coords[i+1][1], coords[i+1][0]]);
      if (ptSegDist(px, py, a.x, a.y, b.x, b.y) <= pixelRadius) {
        found.set(routeId, props);
        break outer;
      }
    }
  }
  return found;
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initMap() {
  _map = L.map('map', {
    center: LONDON, zoom: ZOOM, zoomControl: false, preferCanvas: true,
  });

  L.control.zoom({ position: 'bottomright' }).addTo(_map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> © <a href="https://carto.com/" target="_blank">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(_map);

  _map.on('click', e => {
    if (_stopsLayer) return;
    if (_identifyPopup) { _map.closePopup(_identifyPopup); _identifyPopup = null; }

    const pt     = _map.latLngToContainerPoint(e.latlng);
    const routes = findRoutesNearPoint(pt, 6);
    if (routes.size === 0) return;

    const chips = [...routes.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([id, props]) => {
        const color = featureColor(props);
        return `<span class="id-chip" data-route="${id}" style="--chip-col:${color}">${id}</span>`;
      }).join('');

    const html = `<div class="id-popup"><p class="id-popup-label">Routes here</p><div class="id-chips">${chips}</div></div>`;
    _identifyPopup = L.popup({ closeButton: false, className: 'id-popup-wrap', maxWidth: 260, offset: [0, -4] })
      .setLatLng(e.latlng).setContent(html).openOn(_map);

    // Wire chip clicks after popup is in DOM
    setTimeout(() => {
      document.querySelectorAll('.id-chip[data-route]').forEach(chip => {
        chip.addEventListener('click', () => {
          _map.closePopup(_identifyPopup);
          _identifyPopup = null;
          document.dispatchEvent(new CustomEvent('map:routeclick', { detail: chip.dataset.route }));
        });
      });
    }, 0);
  });

  return _map;
}

// ── Overview layer ────────────────────────────────────────────────────────────

function overviewStyle(feature) {
  return {
    color:   featureColor(feature.properties),
    weight:  1.5,
    opacity: _stopsLayer ? 0.1 : 0.55,
    lineCap: 'round',
  };
}

export function renderOverview(geojson) {
  if (_overviewLayer) return;
  _overviewGeoJson = geojson;
  _overviewLayer = L.geoJSON(geojson, { style: overviewStyle, interactive: false }).addTo(_map);
  _overviewLayer.bringToBack();
}

/**
 * Re-render the overview layer with the given filters.
 * Returns { routeCount } for the sidebar stat.
 * @param {{ types: Set, operators: Set|null, deck: string|null }} filters
 */
export function filterOverview(filters) {
  if (!_overviewGeoJson) return { routeCount: 0 };
  _filters = filters;

  if (_overviewLayer) { _map.removeLayer(_overviewLayer); _overviewLayer = null; }

  const seen = new Set();
  const features = _overviewGeoJson.features.filter(f => {
    if (!featurePassesFilter(f.properties)) return false;
    seen.add(f.properties.routeId);
    return true;
  });

  _overviewLayer = L.geoJSON(
    { type: 'FeatureCollection', features },
    { style: overviewStyle, interactive: false }
  ).addTo(_map);
  _overviewLayer.bringToBack();

  return { routeCount: seen.size };
}

export function dimOverview()     { _overviewLayer?.setStyle({ opacity: 0.1 }); }
export function restoreOverview() { _overviewLayer?.setStyle(f => overviewStyle(f)); }

// ── Selected route ────────────────────────────────────────────────────────────

export function clearRoute() {
  if (_outlineLayer)  { _map.removeLayer(_outlineLayer); _outlineLayer  = null; }
  if (_routeLayer)    { _map.removeLayer(_routeLayer);   _routeLayer    = null; }
  if (_stopsLayer)    { _map.removeLayer(_stopsLayer);   _stopsLayer    = null; }
  if (_identifyPopup) { _map.closePopup(_identifyPopup); _identifyPopup = null; }
  _stopsVisible = true;
  restoreOverview();
}

export function renderRoute(routeGeoJson, stopsFeatures, direction) {
  clearRoute();
  dimOverview();

  const dir   = String(direction);
  const color = dir === '2' ? COLOR_INBOUND : COLOR_OUTBOUND;
  const features = routeGeoJson.features.filter(f => String(f.properties.direction) === dir);

  if (features.length) {
    _routeLayer = L.geoJSON(
      { type: 'FeatureCollection', features },
      { style: { color, weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }, renderer: _routeCanvas }
    ).addTo(_map);
  }

  _stopsLayer = L.layerGroup();
  for (const f of stopsFeatures) {
    const [lon, lat] = f.geometry.coordinates;
    const p         = f.properties;
    const name      = p.name      ?? p.NAME      ?? 'Stop';
    const id        = p.id        ?? p.NAPTAN_ID ?? '';
    const indicator = p.indicator ?? p.STOP_LETTER ?? '';
    const towards   = p.towards   ?? '';

    // Routes serving this stop — stored as comma-separated string
    const routeIds = (p.routes ?? p.ROUTES ?? '')
      .split(',').map(r => r.trim()).filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const marker = L.circleMarker([lat, lon], {
      radius: 5, fillColor: '#fff', color, weight: 2, opacity: 1, fillOpacity: 1, renderer: _stopsCanvas,
    });

    const displayName = indicator ? `${name} <span style="opacity:.55">(${indicator})</span>` : name;

    const routeChips = routeIds.length
      ? `<div class="popup-routes">${routeIds.map(r =>
          `<span class="popup-route-chip" data-route="${r}">${r}</span>`
        ).join('')}</div>`
      : '';

    marker.bindPopup(
      `<span class="popup-name">${displayName}</span>` +
      `${towards ? `<span class="popup-id" style="color:var(--t2)">${towards}</span><br>` : ''}` +
      `<span class="popup-id">${id}</span>` +
      routeChips,
      { closeButton: true, maxWidth: 260 }
    );

    // Wire route chip clicks after popup opens
    marker.on('popupopen', () => {
      setTimeout(() => {
        document.querySelectorAll('.popup-route-chip[data-route]').forEach(chip => {
          chip.addEventListener('click', () => {
            marker.closePopup();
            document.dispatchEvent(new CustomEvent('map:routeclick', { detail: chip.dataset.route }));
          });
        });
      }, 0);
    });

    _stopsLayer.addLayer(marker);
  }

  _stopsLayer.addTo(_map);
  _stopsVisible = true;
  fitToRoute();
}

/**
 * Highlight a set of routes from the overview layer without loading stops.
 * Renders a dark outline beneath each coloured line for visual distinction,
 * and places route-number labels at each route's start and end points.
 */
export function renderMultiRoute(ids) {
  if (_routeLayer) { _map.removeLayer(_routeLayer); _routeLayer = null; }
  if (_stopsLayer) { _map.removeLayer(_stopsLayer); _stopsLayer = null; }
  if (_identifyPopup) { _map.closePopup(_identifyPopup); _identifyPopup = null; }

  if (!_overviewGeoJson || !ids.length) { restoreOverview(); return; }

  dimOverview();

  const idSet    = new Set(ids.map(id => id.toUpperCase()));
  const features = _overviewGeoJson.features.filter(f => idSet.has(f.properties.routeId));

  if (!features.length) { restoreOverview(); return; }

  const fc = { type: 'FeatureCollection', features };

  // Outline layer (added first = rendered underneath)
  _outlineLayer = L.geoJSON(fc, {
    style:    { color: '#111', weight: 6.5, opacity: 0.22, lineCap: 'round', lineJoin: 'round' },
    renderer: _routeCanvas,
    interactive: false,
  }).addTo(_map);

  // Colour layer (added second = rendered on top)
  _routeLayer = L.geoJSON(fc, {
    style:    f => ({ color: featureColor(f.properties), weight: 4, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }),
    renderer: _routeCanvas,
    interactive: false,
  }).addTo(_map);

  // Endpoint labels — one label per routeId at the start and end of direction-1 geometry
  _stopsLayer = L.layerGroup().addTo(_map);
  const labeled = new Set();
  for (const f of features) {
    const { routeId } = f.properties;
    if (labeled.has(routeId) || String(f.properties.direction) !== '1') continue;
    labeled.add(routeId);

    const coords = f.geometry.coordinates;
    if (!coords.length) continue;
    const endpoints = [coords[0], coords[coords.length - 1]];
    const color     = featureColor(f.properties);

    for (const [lon, lat] of endpoints) {
      const icon = L.divIcon({
        className: '',
        html: `<span class="route-end-label" style="--label-col:${color}">${routeId}</span>`,
        iconSize:   [1, 1],
        iconAnchor: [0, 0],
      });
      L.marker([lat, lon], { icon, interactive: false, keyboard: false }).addTo(_stopsLayer);
    }
  }

  const bounds = _routeLayer.getBounds();
  if (bounds.isValid()) _map.fitBounds(bounds, { padding: [48, 48] });
}

export function fitToRoute() {
  if (_routeLayer) {
    const bounds = _routeLayer.getBounds();
    if (bounds.isValid()) _map.fitBounds(bounds, { padding: [48, 48] });
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Count distinct routes visible in the current overview filter */
export function countVisibleRoutes() {
  if (!_overviewGeoJson) return 0;
  const seen = new Set();
  for (const f of _overviewGeoJson.features) {
    if (featurePassesFilter(f.properties)) seen.add(f.properties.routeId);
  }
  return seen.size;
}

/**
 * Returns a Map of routeId → properties for all routes currently passing the filter.
 */
export function getVisibleRouteProps() {
  if (!_overviewGeoJson) return new Map();
  const seen = new Map();
  for (const f of _overviewGeoJson.features) {
    if (!featurePassesFilter(f.properties)) continue;
    if (!seen.has(f.properties.routeId)) seen.set(f.properties.routeId, f.properties);
  }
  return seen;
}

/**
 * Show or hide the stops layer. Returns the new visibility state.
 */
export function setStopsVisible(visible) {
  _stopsVisible = visible;
  if (!_stopsLayer) return _stopsVisible;
  if (visible) {
    if (!_map.hasLayer(_stopsLayer)) _stopsLayer.addTo(_map);
  } else {
    if (_map.hasLayer(_stopsLayer)) _map.removeLayer(_stopsLayer);
  }
  return _stopsVisible;
}

/** Call after the sidebar resizes so Leaflet redraws to fill the new container width */
/** Pan + zoom back to the default London landing view. */
export function resetMapView() {
  _map?.flyTo(LONDON, ZOOM, { duration: 0.6 });
}

export function invalidateMapSize() {
  _map?.invalidateSize({ animate: false });
}

export { TYPE_COLORS };
