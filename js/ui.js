/**
 * ui.js — Application entry point and orchestrator
 */

import { initMap, renderOverview, filterOverview, countVisibleRoutes, getVisibleRouteProps, invalidateMapSize } from './map.js';
import { fetchRouteIndex, fetchAllDestinations, fetchRouteClassifications } from './api.js';
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

function updateFilterStat(routeCount) {
  const el = document.getElementById('filter-stat-count');
  if (el) el.textContent = routeCount.toLocaleString();
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

// ── Sidebar collapse ──────────────────────────────────────────────────────────

collapseBtn.addEventListener('click', () => {
  sidebar.classList.add('collapsed');
  expandBtn.hidden = false;
  setTimeout(invalidateMapSize, 310);
});

expandBtn.addEventListener('click', () => {
  sidebar.classList.remove('collapsed');
  expandBtn.hidden = true;
  setTimeout(invalidateMapSize, 310);
});

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
    types:      activeSet('routetype'),
    deck:       activeSet('deck'),
    frequency:  activeSet('frequency'),
    operator:   activeSet('operator'),
    propulsion: activeSet('propulsion'),
  };
}

function applyFilters() {
  const filters = buildFilters();
  const { routeCount } = filterOverview(filters);
  updateFilterStat(routeCount);

  // Recompute stats from currently-visible routes. getVisibleRouteProps only
  // carries properties embedded in the overview — merge in pvr from the full
  // classifications map for the PVR column.
  const visible = [...getVisibleRouteProps().entries()].map(([id, props]) => ({
    ...props,
    pvr: state.classifications[id]?.pvr ?? null,
  }));
  renderOperatorStats(visible);

  // Show clear button only when at least one filter is active
  const filterClearBtn = document.getElementById('filter-clear-btn');
  if (filterClearBtn) {
    const hasActive = Object.values(filters).some(v => v !== null);
    filterClearBtn.hidden = !hasActive;
  }
}

// ── About modal ───────────────────────────────────────────────────────────────

const aboutBtn   = document.getElementById('about-btn');
const aboutModal = document.getElementById('about-modal');

function openAbout()  { if (aboutModal) aboutModal.hidden = false; }
function closeAbout() { if (aboutModal) aboutModal.hidden = true;  }

aboutBtn?.addEventListener('click', openAbout);
aboutModal?.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) closeAbout();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && aboutModal && !aboutModal.hidden) closeAbout();
});

// ── CSV export ────────────────────────────────────────────────────────────────

document.getElementById('export-csv-btn')?.addEventListener('click', () => {
  const routes = getVisibleRouteProps();
  if (!routes.size) return;

  const headers = ['route_id','route_type','is_prefix','deck','propulsion','operator','frequency','length_band','destination_outbound','destination_inbound'];
  const rows = [...routes.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, props]) => {
      const dest = state.destinations[id] ?? {};
      return [
        id,
        props.routeType   ?? '',
        props.isPrefix ? 'yes' : 'no',
        props.deck        ?? '',
        props.propulsion  ?? '',
        props.operator    ?? '',
        props.frequency   ?? '',
        props.lengthBand  ?? '',
        dest.outbound?.destination ?? '',
        dest.inbound?.destination  ?? '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `tfl-routes-${new Date().toISOString().slice(0,10)}.csv`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
