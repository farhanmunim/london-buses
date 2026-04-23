/**
 * export.js — XLSX export (topbar Export button).
 *
 * Three sheets, all honouring the current filter state:
 *   • Routes            — per-route data (type, deck, propulsion, operator, …)
 *   • Garages           — per-garage data (code, name, operator, address, …)
 *   • Network overview  — per-operator aggregates (share of routes, PVR, EV)
 *
 * SheetJS is loaded via a <script defer> tag. If the user clicks before it
 * finishes downloading we surface a friendly "try again" message rather than
 * erroring into the console.
 */

import { getVisibleRouteProps, getVisibleGarages } from './map.js';
import { state, exportBtn } from './state.js';

exportBtn?.addEventListener('click', () => {
  if (typeof XLSX === 'undefined') {
    alert('Export library still loading — try again in a moment.');
    return;
  }
  const routes = getVisibleRouteProps();
  if (!routes.size) return;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildRouteRows(routes)),    'Routes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildGarageRows()),         'Garages');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildOverviewRows(routes)), 'Network overview');
  XLSX.writeFile(wb, `london-buses-${new Date().toISOString().slice(0, 10)}.xlsx`);
});

function buildRouteRows(routes) {
  return [...routes.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, props]) => {
      const dest = state.destinations[id]    ?? {};
      const cls  = state.classifications[id] ?? {};
      return {
        route_id:             id,
        route_type:           props.routeType  ?? '',
        is_prefix:            props.isPrefix ? 'yes' : 'no',
        deck:                 props.deck       ?? '',
        propulsion:           props.propulsion ?? '',
        operator:             props.operator   ?? '',
        frequency:            props.frequency  ?? '',
        length_band:          props.lengthBand ?? '',
        pvr:                  cls.pvr          ?? '',
        vehicle:              cls.vehicleType  ?? '',
        garage_name:          cls.garageName   ?? '',
        garage_code:          cls.garageCode   ?? '',
        destination_outbound: dest.outbound?.destination ?? '',
        destination_inbound:  dest.inbound?.destination  ?? '',
      };
    });
}

function buildGarageRows() {
  return getVisibleGarages()
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
    .map(g => ({
      garage_code: g.code,
      garage_name: g.name,
      operator:    g.operator ?? '',
      address:     g.address  ?? '',
      latitude:    g.lat,
      longitude:   g.lon,
      route_count: g.routeCount ?? 0,
    }));
}

function buildOverviewRows(routes) {
  const list = [...routes.entries()].map(([id, props]) => ({
    ...props,
    pvr: state.classifications[id]?.pvr ?? null,
  }));
  const totalRoutes = list.length;
  const totalPvr    = list.reduce((s, r) => s + (r.pvr ?? 0), 0);

  const ops = {};
  for (const r of list) {
    const op = r.operator ?? 'Unknown';
    (ops[op] ??= { routes: 0, pvr: 0, ev: 0 }).routes++;
    ops[op].pvr += r.pvr ?? 0;
    if (r.propulsion === 'electric') ops[op].ev++;
  }
  const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '–';
  const rows = Object.entries(ops)
    .sort(([aK, aV], [bK, bV]) => aK === 'Unknown' ? 1 : bK === 'Unknown' ? -1 : bV.routes - aV.routes)
    .map(([op, v]) => ({
      operator:        op,
      routes:          v.routes,
      route_share:     pct(v.routes, totalRoutes),
      pvr_total:       v.pvr,
      pvr_share:       pct(v.pvr, totalPvr),
      electric_routes: v.ev,
      electric_share:  pct(v.ev, v.routes),
    }));
  const totalEv = list.filter(r => r.propulsion === 'electric').length;
  rows.push({
    operator:        'TOTAL',
    routes:          totalRoutes,
    route_share:     '100%',
    pvr_total:       totalPvr,
    pvr_share:       '100%',
    electric_routes: totalEv,
    electric_share:  pct(totalEv, totalRoutes),
  });

  // Fleet mix block — mirrors the right-panel Fleet Mix chart. PVR-weighted
  // so a 42-bus diesel route outweighs a 6-bus electric school route, which
  // is how operations teams think about the fleet. Blank rows above act as a
  // visual separator in the spreadsheet; the "FLEET MIX" label sits in the
  // operator column so it reads naturally at the top of the block.
  const buckets = { electric: 0, hybrid: 0, hydrogen: 0, diesel: 0, unknown: 0 };
  const routeBuckets = { electric: 0, hybrid: 0, hydrogen: 0, diesel: 0, unknown: 0 };
  for (const r of list) {
    const key = buckets[r.propulsion] !== undefined ? r.propulsion : 'unknown';
    buckets[key]      += r.pvr ?? 0;
    routeBuckets[key] += 1;
  }
  const labelOf = { electric: 'Electric', hybrid: 'Hybrid', hydrogen: 'Hydrogen', diesel: 'Diesel', unknown: 'Unknown' };

  rows.push({ operator: '' }, { operator: 'FLEET MIX (by PVR)' });
  for (const key of ['electric', 'hybrid', 'hydrogen', 'diesel', 'unknown']) {
    const pvr = buckets[key];
    if (!pvr && !routeBuckets[key]) continue; // skip empty buckets
    rows.push({
      operator:        labelOf[key],
      routes:          routeBuckets[key],
      route_share:     pct(routeBuckets[key], totalRoutes),
      pvr_total:       pvr,
      pvr_share:       pct(pvr, totalPvr),
      electric_routes: '',
      electric_share:  '',
    });
  }
  return rows;
}
