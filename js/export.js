/**
 * export.js — XLSX export handler.
 *
 * Produces a single workbook with three sheets, each honouring the current
 * filter state:
 *   • Routes            — per-route data (type, deck, propulsion, operator, …)
 *   • Garages           — per-garage data (code, name, operator, address, …)
 *   • Network overview  — per-operator aggregates (share of routes, PVR, EV)
 *
 * Depends on SheetJS loaded via a <script> tag in index.html; if the library
 * is not yet available we surface a friendly message rather than erroring.
 */

import { getVisibleRouteProps, getVisibleGarages } from './map.js';
import { state } from './state.js';

document.getElementById('export-csv-btn')?.addEventListener('click', () => {
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
      garage_code:  g.code,
      garage_name:  g.name,
      operator:     g.operator ?? '',
      address:      g.address  ?? '',
      latitude:     g.lat,
      longitude:    g.lon,
      route_count:  g.routeCount ?? 0,
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
    ops[op] ??= { routes: 0, pvr: 0, ev: 0 };
    ops[op].routes++;
    ops[op].pvr += r.pvr ?? 0;
    if (r.propulsion === 'electric') ops[op].ev++;
  }
  const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '–';

  const rows = Object.entries(ops)
    .sort(([aK, aV], [bK, bV]) => {
      if (aK === 'Unknown') return 1;
      if (bK === 'Unknown') return -1;
      return bV.routes - aV.routes;
    })
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
  return rows;
}
