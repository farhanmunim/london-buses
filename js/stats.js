/**
 * stats.js — Filter stat counts + operator-stats table renderer.
 *
 * Exports:
 *   updateFilterStat(routeCount)      Update the "N filtered routes" and
 *                                     "M filtered garages" numbers in the
 *                                     left panel's section-summary strips.
 *   renderOperatorStats(routes)       Rebuild the per-operator share table
 *                                     inside #operator-stats (right panel
 *                                     default state).
 */

import { countVisibleGarages } from './map.js';

export function updateFilterStat(routeCount) {
  const routeEl  = document.getElementById('filter-stat-count');
  const garageEl = document.getElementById('filter-stat-garages');
  if (routeEl)  routeEl.textContent  = routeCount.toLocaleString();
  if (garageEl) garageEl.textContent = countVisibleGarages().toLocaleString();
}

export function renderOperatorStats(routes) {
  const container = document.getElementById('operator-stats');
  if (!container) return;

  if (!routes.length) {
    container.innerHTML = '<p class="operator-stats__empty">No routes match the current filters.</p>';
    return;
  }

  const totalRoutes = routes.length;
  const totalPvr    = routes.reduce((s, r) => s + (r.pvr ?? 0), 0);

  // Aggregate per operator
  const ops = {};
  for (const r of routes) {
    const op = r.operator ?? 'Unknown';
    ops[op] ??= { routes: 0, pvr: 0, ev: 0 };
    ops[op].routes++;
    ops[op].pvr += r.pvr ?? 0;
    if (r.propulsion === 'electric') ops[op].ev++;
  }

  // Sort by route count desc, put Unknown last
  const sorted = Object.entries(ops).sort(([aK, aV], [bK, bV]) => {
    if (aK === 'Unknown') return 1;
    if (bK === 'Unknown') return -1;
    return bV.routes - aV.routes;
  });

  const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '–';

  container.innerHTML = `
    <table class="operator-stats__table" aria-label="Operator statistics">
      <thead>
        <tr>
          <th>Operator</th>
          <th title="Share of total routes">Routes</th>
          <th title="Share of peak vehicle requirement">PVR</th>
          <th title="Proportion of routes with electric vehicles">EV</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(([op, v]) => `
          <tr>
            <td class="operator-stats__op">${op}</td>
            <td>${pct(v.routes, totalRoutes)}</td>
            <td>${pct(v.pvr, totalPvr)}</td>
            <td>${pct(v.ev, v.routes)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}
