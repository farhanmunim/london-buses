/**
 * ui.js — Application entry point and orchestrator
 */

import { initMap, renderOverview, filterOverview, countVisibleRoutes, getVisibleRouteProps, invalidateMapSize,
         renderGarages, setGaragesVisible, setStopsPreference, setRoutesVisible,
         filterGarages, countVisibleGarages, getVisibleGarages } from './map.js';
import { fetchRouteIndex, fetchAllDestinations, fetchRouteClassifications, fetchGarageLocations } from './api.js';
import { state, sidebar, collapseBtn, expandBtn, filtersSection, footerDate, footerNextDate } from './state.js';
import './search.js';
import './route-detail.js';


// ── Boot ──────────────────────────────────────────────────────────────────────

initMap();

Promise.all([
  fetch('./data/routes-overview.geojson').then(r => r.json()),
  fetchRouteIndex(),
  fetchAllDestinations(),
  fetchRouteClassifications(),
]).then(([overview, ids, dests, classifications]) => {
  renderOverview(overview);
  state.routeIndex      = ids;
  state.destinations    = dests;
  state.classifications = classifications;
  updateFilterStat(countVisibleRoutes());
  renderOperatorStats(Object.values(classifications));

  fetch('./data/build-meta.json').then(r => r.json()).then(meta => {
    const ts = meta?.routeOverview?.updatedAt;
    if (!ts) return;
    const fmt = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    const last = new Date(ts);
    // Next scheduled run is the upcoming Monday 05:00 UTC (GitHub Actions cron: "0 5 * * 1").
    // Always compute forward from "now" so a late-running last build can't push the date off a Monday.
    const next = nextMondayAt(5); // 05:00 UTC
    if (footerDate)     footerDate.textContent     = fmt(last);
    if (footerNextDate) footerNextDate.textContent = fmt(next);
  }).catch(() => {});

  function nextMondayAt(utcHour) {
    const now = new Date();
    const d   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, 0, 0));
    // Advance to next Monday (1) — same-day counts only if the scheduled hour is still ahead
    const daysAhead = (1 - d.getUTCDay() + 7) % 7 || (d > now ? 0 : 7);
    d.setUTCDate(d.getUTCDate() + daysAhead);
    return d;
  }
}).catch(err => console.warn('Boot preload failed:', err));

// Garages load independently — don't block the main overview on it.
// Route-count per garage is derived from classifications once they're loaded.
Promise.all([fetchGarageLocations(), fetchRouteClassifications()]).then(([garages, classifications]) => {
  if (!garages.length) return;
  const routeCounts = {};
  for (const c of Object.values(classifications)) {
    if (c.garageCode) routeCounts[c.garageCode] = (routeCounts[c.garageCode] ?? 0) + 1;
  }
  renderGarages(garages, routeCounts);
  // Paired toggles were initialised at module load; re-apply visibility now
  // that the layer actually exists. Buttons are already in the correct state.
  setGaragesVisible(localStorage.getItem('garages-visible') === '1');
  updateFilterStat(countVisibleRoutes());
});

// ── Garages toggle (topbar) ───────────────────────────────────────────────────
// Stops toggle lives in the route detail panel and is wired by route-detail.js.

// Paired toggles — one logical control can have multiple button copies
// (e.g. in the topbar AND inside the filters panel). They all stay in sync.
function wirePairedToggle({ ids, storageKey, defaultOn, apply }) {
  const buttons = ids.map(id => document.getElementById(id)).filter(Boolean);
  if (!buttons.length) return;
  const stored = localStorage.getItem(storageKey);
  const on = stored === null ? defaultOn : stored === '1';
  const setAll = (state) => {
    for (const b of buttons) {
      b.setAttribute('aria-pressed', String(state));
      b.classList.toggle('active', state);
      const noun  = b.dataset.noun;
      const label = b.querySelector('.toggle-label');
      if (noun && label) label.textContent = `${state ? 'Hide' : 'Show'} ${noun}`;
    }
    apply(state);
    localStorage.setItem(storageKey, state ? '1' : '0');
  };
  setAll(on);
  for (const b of buttons) b.addEventListener('click', () => setAll(!(b.getAttribute('aria-pressed') === 'true')));
}

wirePairedToggle({
  ids:        ['toggle-routes-btn', 'toggle-routes-btn-side'],
  storageKey: 'routes-visible',
  defaultOn:  true,
  apply:      setRoutesVisible,
});
wirePairedToggle({
  ids:        ['toggle-garages-btn', 'toggle-garages-btn-side'],
  storageKey: 'garages-visible',
  defaultOn:  false,
  apply:      setGaragesVisible,
});

function updateFilterStat(routeCount) {
  const routeEl  = document.getElementById('filter-stat-count');
  const garageEl = document.getElementById('filter-stat-garages');
  if (routeEl)  routeEl.textContent  = routeCount.toLocaleString();
  if (garageEl) garageEl.textContent = countVisibleGarages().toLocaleString();
}

// ── Operator stats table ──────────────────────────────────────────────────────

function renderOperatorStats(routes) {
  const container = document.getElementById('operator-stats');
  if (!container) return;

  if (!routes.length) {
    container.innerHTML = '<p class="stats-empty">No routes match the current filters.</p>';
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
    <table class="stats-table" aria-label="Operator statistics">
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
            <td class="stat-op">${op}</td>
            <td>${pct(v.routes, totalRoutes)}</td>
            <td>${pct(v.pvr, totalPvr)}</td>
            <td>${pct(v.ev, v.routes)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ── Map resize on panel toggle ────────────────────────────────────────────────
// Blueprint's Panels module collapses left/right panels via header click. Map
// needs its size invalidated once the CSS transition settles.
document.getElementById('leftPanelHd')?.addEventListener('click', () => setTimeout(invalidateMapSize, 310));
document.getElementById('rightPanelHd')?.addEventListener('click', () => setTimeout(invalidateMapSize, 310));
document.getElementById('rightCollapseTab')?.addEventListener('click', () => setTimeout(invalidateMapSize, 310));

// Track each panel's collapsed state explicitly (MutationObserver on class).
// Drives the `.visible` class on the corresponding reopen tab, and wires
// the left tab's click to re-expand (blueprint only wires the right one).
function wirePanelTab(panelId, tabId) {
  const panel = document.getElementById(panelId);
  const tab   = document.getElementById(tabId);
  if (!panel || !tab) return;
  const apply = () => tab.classList.toggle('visible', panel.classList.contains('collapsed'));
  apply();
  new MutationObserver(apply).observe(panel, { attributes: true, attributeFilter: ['class'] });
  tab.addEventListener('click', () => {
    panel.classList.remove('collapsed');
    setTimeout(invalidateMapSize, 310);
  });
}
wirePanelTab('panelRight', 'rightCollapseTab');
wirePanelTab('panelLeft',  'leftCollapseTab');

// ── Filters ───────────────────────────────────────────────────────────────────

filtersSection.addEventListener('click', e => {
  const chip = e.target.closest('.chip[data-filter]');
  if (!chip) return;
  chip.classList.toggle('active');
  chip.setAttribute('aria-pressed', String(chip.classList.contains('active')));
  applyFilters();
});

// Fired by fullReset() in route-detail.js after clearing all chips
document.addEventListener('app:filterscleared', () => {
  applyFilters();
});

function buildFilters() {
  function activeSet(key) {
    const chips = [...filtersSection.querySelectorAll(`.chip.active[data-filter="${key}"]`)];
    return chips.length ? new Set(chips.map(c => c.dataset.val)) : null;
  }
  return {
    types:           activeSet('routetype'),
    deck:            activeSet('deck'),
    frequency:       activeSet('frequency'),
    operator:        activeSet('operator'),
    propulsion:      activeSet('propulsion'),
    garageOperator:  activeSet('garageoperator'),
  };
}

function applyFilters() {
  const filters = buildFilters();
  const { routeCount } = filterOverview(filters);
  filterGarages(filters.garageOperator); // dedicated — independent of route filters
  updateFilterStat(routeCount);

  const visible = [...getVisibleRouteProps().entries()].map(([id, props]) => ({
    ...props,
    pvr: state.classifications[id]?.pvr ?? null,
  }));
  renderOperatorStats(visible);
  syncClearBtn();
}

// Show Clear when any filter chip is active OR a route has been searched/selected
function syncClearBtn() {
  const btn = document.getElementById('filter-clear-btn');
  if (!btn) return;
  const anyChip   = !!filtersSection.querySelector('.chip.active[data-filter]');
  const anySearch = !!state.routeId || (document.getElementById('search-input')?.value.trim() ?? '') !== '';
  const anyPill   = !!document.querySelector('#search-pills .search-pill');
  btn.hidden = !(anyChip || anySearch || anyPill);
}

document.addEventListener('app:searchstatechange', syncClearBtn);

// About modal is now handled by js/about.js (shared with changelog.html).

// ── Export ────────────────────────────────────────────────────────────────────
// Single XLSX workbook with three sheets (Routes · Garages · Network overview),
// each reflecting the current filter state. Uses SheetJS loaded from CDN.

document.getElementById('export-csv-btn')?.addEventListener('click', () => {
  if (typeof XLSX === 'undefined') {
    alert('Export library still loading — try again in a moment.');
    return;
  }

  const routes = getVisibleRouteProps();
  if (!routes.size) return;

  // Sheet 1 — Routes
  const routeRows = [...routes.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, props]) => {
      const dest  = state.destinations[id] ?? {};
      const cls   = state.classifications[id] ?? {};
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

  // Sheet 2 — Garages (respect operator filter)
  const garageRows = getVisibleGarages()
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

  // Sheet 3 — Network overview (per-operator aggregates over the filtered routes)
  const visibleRouteList = [...routes.entries()].map(([id, props]) => ({
    ...props,
    pvr: state.classifications[id]?.pvr ?? null,
  }));
  const totalRoutes = visibleRouteList.length;
  const totalPvr    = visibleRouteList.reduce((s, r) => s + (r.pvr ?? 0), 0);
  const ops = {};
  for (const r of visibleRouteList) {
    const op = r.operator ?? 'Unknown';
    ops[op] ??= { routes: 0, pvr: 0, ev: 0 };
    ops[op].routes++;
    ops[op].pvr += r.pvr ?? 0;
    if (r.propulsion === 'electric') ops[op].ev++;
  }
  const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '–';
  const overviewRows = Object.entries(ops)
    .sort(([aK, aV], [bK, bV]) => {
      if (aK === 'Unknown') return 1;
      if (bK === 'Unknown') return -1;
      return bV.routes - aV.routes;
    })
    .map(([op, v]) => ({
      operator:         op,
      routes:           v.routes,
      route_share:      pct(v.routes, totalRoutes),
      pvr_total:        v.pvr,
      pvr_share:        pct(v.pvr, totalPvr),
      electric_routes:  v.ev,
      electric_share:   pct(v.ev, v.routes),
    }));
  overviewRows.push({
    operator: 'TOTAL', routes: totalRoutes, route_share: '100%',
    pvr_total: totalPvr, pvr_share: '100%',
    electric_routes: visibleRouteList.filter(r => r.propulsion === 'electric').length,
    electric_share: pct(visibleRouteList.filter(r => r.propulsion === 'electric').length, totalRoutes),
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(routeRows),    'Routes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(garageRows),   'Garages');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overviewRows), 'Network overview');

  XLSX.writeFile(wb, `london-buses-${new Date().toISOString().slice(0, 10)}.xlsx`);
});
