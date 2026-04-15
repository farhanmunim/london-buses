/**
 * ui.js — Boot orchestrator.
 *
 * Reads the small set of static data files, hydrates shared state, renders
 * the initial map overview + operator stats, and computes the "last / next
 * updated" dates shown in the desktop footer. All interactive wiring lives
 * in focused modules imported below.
 */

import './search.js';        // search input, autocomplete, pill system
import './route-detail.js';  // right-panel route view, direction toggle, toasts
import './panels.js';        // desktop panel collapse/expand + map resize
import './toggles.js';       // topbar Show/Hide Routes & Garages toggles
import './filters.js';       // filter chips + Clear buttons
import './mobile-nav.js';    // mobile bottom nav (≤640px)
import './export.js';        // XLSX export (3-sheet workbook)

import { initMap, renderOverview, countVisibleRoutes,
         renderGarages, setGaragesVisible } from './map.js';
import { fetchRouteIndex, fetchAllDestinations, fetchRouteClassifications, fetchGarageLocations } from './api.js';
import { state, footerDate, footerNextDate } from './state.js';
import { updateFilterStat, renderOperatorStats } from './stats.js';

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
  updateFooterDates();
}).catch(err => console.warn('Boot preload failed:', err));

// Garages load independently so they don't block the initial map paint.
// Route-count per garage is derived from classifications once they're loaded.
Promise.all([fetchGarageLocations(), fetchRouteClassifications()]).then(([garages, classifications]) => {
  if (!garages.length) return;
  const routeCounts = {};
  for (const c of Object.values(classifications)) {
    if (c.garageCode) routeCounts[c.garageCode] = (routeCounts[c.garageCode] ?? 0) + 1;
  }
  renderGarages(garages, routeCounts);
  // Default ON; only hide if the user explicitly opted out in a prior session
  setGaragesVisible(localStorage.getItem('garages-visible') !== '0');
  updateFilterStat(countVisibleRoutes());
});

// ── Footer: last / next data refresh dates ───────────────────────────────────

function updateFooterDates() {
  fetch('./data/build-meta.json').then(r => r.json()).then(meta => {
    const ts = meta?.routeOverview?.updatedAt;
    if (!ts) return;
    const fmt = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    // Next scheduled run is the upcoming Monday 05:00 UTC (GitHub Actions cron
    // "0 5 * * 1"). Compute forward from "now" so a late-running last build
    // can't push the date off a Monday.
    if (footerDate)     footerDate.textContent     = fmt(new Date(ts));
    if (footerNextDate) footerNextDate.textContent = fmt(nextMondayAt(5));
  }).catch(() => { /* meta file missing is non-fatal */ });
}

function nextMondayAt(utcHour) {
  const now = new Date();
  const d   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, 0, 0));
  const daysAhead = (1 - d.getUTCDay() + 7) % 7 || (d > now ? 0 : 7);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d;
}
