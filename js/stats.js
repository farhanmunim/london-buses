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
    container.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'operator-stats__empty',
      textContent: 'No routes match the current filters.',
    }));
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

  const table = document.createElement('table');
  table.className = 'operator-stats__table';
  table.setAttribute('aria-label', 'Operator statistics');

  const head = document.createElement('thead');
  const hr = document.createElement('tr');
  const headers = [
    ['Operator', null],
    ['Routes', 'Share of total routes'],
    ['PVR',    'Share of peak vehicle requirement'],
    ['EV',     'Proportion of routes with electric vehicles'],
  ];
  for (const [label, title] of headers) {
    const th = document.createElement('th');
    th.textContent = label;
    if (title) th.title = title;
    hr.appendChild(th);
  }
  head.appendChild(hr);
  table.appendChild(head);

  const tbody = document.createElement('tbody');
  for (const [op, v] of sorted) {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td');
    td0.className = 'operator-stats__op';
    td0.textContent = op;
    tr.appendChild(td0);
    for (const cell of [pct(v.routes, totalRoutes), pct(v.pvr, totalPvr), pct(v.ev, v.routes)]) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  container.replaceChildren(table);
}
