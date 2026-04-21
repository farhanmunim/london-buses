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
import './paint-mode.js';    // Colour-routes-by segmented control
import './mobile-nav.js';    // mobile bottom nav (≤640px)
import './export.js';        // XLSX export (3-sheet workbook)

import { initMap, renderOverview, countVisibleRoutes,
         renderGarages, setGaragesVisible } from './map.js';
import { fetchRouteIndex, fetchAllDestinations, fetchRouteClassifications, fetchGarageLocations } from './api.js';
import { state, footerDate, footerNextDate } from './state.js';
import { updateFilterStat, renderOperatorStats } from './stats.js';

// ── Boot ──────────────────────────────────────────────────────────────────────

initMap();

// Small-file metadata first so the sidebar (search, stats, filter counts) can
// populate before the 1.3 MB overview GeoJSON finishes downloading.
Promise.all([
  fetchRouteIndex(),
  fetchAllDestinations(),
  fetchRouteClassifications(),
]).then(([ids, dests, classifications]) => {
  state.routeIndex      = ids;
  state.destinations    = dests;
  state.classifications = classifications;
  renderOperatorStats(Object.values(classifications));
  updateFooterDates();
}).catch(err => console.warn('Metadata preload failed:', err));

// Low-priority so it yields to the above on slow connections; the map tiles
// are already painting while this streams in.
fetch('./data/routes-overview.geojson', { priority: 'low' })
  .then(r => r.json())
  .then(overview => {
    renderOverview(overview);
    updateFilterStat(countVisibleRoutes());
  })
  .catch(err => console.warn('Overview load failed:', err));

// Garages load independently so they don't block the initial map paint.
// Route-count per garage is derived from classifications once they're loaded.
Promise.all([fetchGarageLocations(), fetchRouteClassifications()]).then(([garages, classifications]) => {
  if (!garages.length) return;
  // Group routes by garage code so the garage popup can show per-route chips
  // and total PVR. Entry shape: { routeId, pvr, operator, type }.
  const garageRoutes = {};
  for (const [routeId, c] of Object.entries(classifications)) {
    if (!c.garageCode) continue;
    (garageRoutes[c.garageCode] ??= []).push({
      routeId,
      pvr:        c.pvr ?? null,
      operator:   c.operator ?? null,
      type:       c.type ?? null,
      propulsion: c.propulsion ?? null,
    });
  }
  // Sort each garage's routes alphanumerically (numeric first, then letter-prefix)
  const routeSortKey = id => [/^\d/.test(id) ? 0 : 1, id.padStart(6, '0')];
  for (const list of Object.values(garageRoutes)) {
    list.sort((a, b) => {
      const [ka, la] = routeSortKey(a.routeId), [kb, lb] = routeSortKey(b.routeId);
      return ka - kb || la.localeCompare(lb);
    });
  }
  renderGarages(garages, garageRoutes);
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
