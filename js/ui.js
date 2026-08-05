/**
 * ui.js — Boot orchestrator.
 *
 * Side-effect imports wire each module's own event listeners. Data loading
 * happens here so the modules stay pure: `ui.js` fetches the static JSON
 * files, hydrates `state`, and hands the derived shapes to the renderers.
 *
 * Order matters:
 *   1. Map first so the tile layer starts painting while the rest loads.
 *   2. Small metadata files (index + destinations + classifications) —
 *      enough to render the sidebar route count + operator cards without
 *      waiting on the 1.3 MB overview GeoJSON.
 *   3. Overview GeoJSON (low priority).
 *   4. Garages (independent — unblocks route markers on the map).
 */

import './panels.js?v=2.15.12';        // sidebar tabs, right-panel tabs, section collapse
import './filters.js?v=2.15.12';       // pill-based filter engine
import './paint-mode.js?v=2.15.12';    // colour-routes-by toggle (both copies synced)
import './toggles.js?v=2.15.12';       // map-area route/garage visibility controls
import './search.js?v=2.15.12';        // topbar + routes-tab search (multi-route pills)
import './stop-search.js?v=2.15.12';   // bus-stop filter in sidebar
import './garage-filter.js?v=2.15.12'; // garage-selection pill in sidebar (parity with stop filter)
import './route-detail.js?v=2.15.12';  // route-card renderer (imported for side-effect-free exports)
import './filtered-routes.js?v=2.15.12'; // lists filter-matched routes in the Routes tab
import './mobile-nav.js?v=2.15.12';    // pull-up sheet + bottom nav
import './export.js?v=2.15.12';        // XLSX export
import './tooltip.js?v=2.15.12';       // custom [data-tip] hover tooltip used by route-card labels

import { initMap, renderOverview, renderGarages, setGaragesVisible } from './map.js?v=2.15.12';
import { fetchRouteIndex, fetchAllDestinations, fetchRouteClassifications, fetchGarageLocations, fetchLineStatus, fetchManifest } from './api.js?v=2.15.12';
import { state, footerDate, footerNextDate, themeToggle, themeToggleMob } from './state.js?v=2.15.12';
import { renderOperatorStats, setGarageData } from './stats.js?v=2.15.12';
import { setGarageOptions } from './garage-filter.js?v=2.15.12';
import { applyFilters } from './filters.js?v=2.15.12';

// ── Theme ────────────────────────────────────────────────────────────────────
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('app-theme', t); } catch (_) {}
}
function toggleTheme() {
  setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}
themeToggle?.addEventListener('click', toggleTheme);
themeToggleMob?.addEventListener('click', toggleTheme);

// ── Map ──────────────────────────────────────────────────────────────────────
initMap();

// Metadata preload — sidebar + operator cards can render from these alone.
Promise.all([
  fetchRouteIndex(),
  fetchAllDestinations(),
  fetchRouteClassifications(),
]).then(([ids, dests, classifications]) => {
  state.routeIndex      = ids;
  state.destinations    = dests;
  state.classifications = classifications;

  // Initial hero + operator cards from the full classifications set — before
  // any filters apply, every route is "visible".
  const all = Object.entries(classifications).map(([id, c]) => ({
    routeId:    id,
    routeType:  c.type,
    isPrefix:   c.isPrefix,
    deck:       c.deck,
    frequency:  c.frequency,
    operator:   c.operator,
    propulsion: c.propulsion,
    lengthBand: c.lengthBand,
    pvr:        c.pvr ?? null,
    vehicleAgeYears: c.vehicleAgeYears ?? null,
  }));
  renderOperatorStats(all);
  updateFooterDates();
}).catch(err => console.warn('Metadata preload failed:', err));

// Overview GeoJSON (the heavy one) — fetched last so it doesn't starve the
// lighter metadata requests above.
fetch('./data/routes-overview.geojson', { priority: 'low' })
  .then(r => r.json())
  .then(overview => {
    renderOverview(overview);
    applyFilters();                         // refreshes counts + stats from the map
  })
  .catch(err => console.warn('Overview load failed:', err));

// Garages — independent of the overview; route-count per garage is joined in
// here so garage popups can show per-route chips + total PVR.
Promise.all([fetchGarageLocations(), fetchRouteClassifications()]).then(([garages, classifications]) => {
  if (!garages.length) return;
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
  const routeSortKey = id => [/^\d/.test(id) ? 0 : 1, id.padStart(6, '0')];
  for (const list of Object.values(garageRoutes)) {
    list.sort((a, b) => {
      const [ka, la] = routeSortKey(a.routeId), [kb, lb] = routeSortKey(b.routeId);
      return ka - kb || la.localeCompare(lb);
    });
  }
  renderGarages(garages, garageRoutes);
  setGaragesVisible(localStorage.getItem('garages-visible') !== '0');

  // Hand the garage records to stats.js so operator cards / drawer can show
  // real garage counts, and to garage-filter.js for the sidebar picker.
  setGarageData(garages, garageRoutes);
  setGarageOptions(garages, garageRoutes);
  applyFilters(); // refresh op cards now that garage counts are known
});

// ── Overview: network live-status line (Atlas API) ───────────────────────────
// One line under the KPI grid: how much of the network is on good service
// right now. Stays hidden when the API is unreachable.
function updateNetworkLiveStatus() {
  fetchLineStatus().then(ls => {
    const el   = document.getElementById('ov-live');
    const text = document.getElementById('ov-live-text');
    if (!el || !text || !ls?.summary) return;
    const { total, good, disrupted } = ls.summary;
    text.textContent = disrupted
      ? `${good} of ${total} routes on good service · ${disrupted} disrupted`
      : `All ${total} routes on good service`;
    el.classList.toggle('ov-live--bad', disrupted > 0);
    const asOf = ls.capturedAt ? new Date(ls.capturedAt) : null;
    el.dataset.tip = 'Live network status. Source: TfL, via the Atlas API.'
      + (asOf && !Number.isNaN(asOf.getTime())
          ? ` As of ${String(asOf.getHours()).padStart(2, '0')}:${String(asOf.getMinutes()).padStart(2, '0')}.`
          : '');
    el.hidden = false;
  }).catch(() => { /* live status is decorative — never fatal */ });
}
updateNetworkLiveStatus();

// ── Footer: last / next refresh ──────────────────────────────────────────────
// "Refreshed" is the freshest reference data the site consumes — the newest
// of the local weekly build and the Atlas API datasets it reads (garages,
// tenders, crowding, performance, route-meta, fleet; live status is
// excluded, it's stamped where it's shown). "Next" mirrors the Atlas
// warehouse cadence: its pipeline runs
// daily at ~03:17 UTC, though per-dataset TTLs gate what actually re-pulls.
// The hover tip breaks the sources down. Falls back to the local build date
// + weekly Monday schedule when the API is unreachable.
function updateFooterDates() {
  Promise.all([
    fetch('./data/build-meta.json').then(r => r.json()).catch(() => null),
    fetchManifest(),
  ]).then(([meta, manifest]) => {
    const fmt   = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    const parse = ts => { const d = ts ? new Date(ts) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

    const buildTs   = parse(meta?.routeOverview?.updatedAt);
    const atlas     = manifest?.datasets ?? {};
    const atlasSets = ['garages', 'tenders', 'crowding', 'performance', 'route-meta', 'fleet'];
    const newest    = [buildTs, ...atlasSets.map(k => parse(atlas[k]?.fetchedAt))]
      .filter(Boolean).sort((a, b) => b - a)[0];
    if (!newest) return;

    if (footerDate)     footerDate.textContent     = fmt(newest);
    if (footerNextDate) footerNextDate.textContent = fmt(manifest ? nextAtlasRun() : nextMondayAt(5));

    const pill = document.querySelector('.footer-data');
    if (pill && manifest) {
      const bits = [];
      if (buildTs) bits.push(`Site build ${fmt(buildTs)} (weekly, Mondays)`);
      for (const k of atlasSets) {
        const d = parse(atlas[k]?.fetchedAt);
        if (d) bits.push(`Atlas ${k} ${fmt(d)}`);
      }
      bits.push('Atlas warehouse refreshes daily ~03:17 UTC');
      pill.dataset.tip = bits.join(' · ');
    }
  }).catch(() => { /* freshness display is non-fatal */ });
}
// The Atlas data warehouse refreshes via a daily GitHub Action at 03:17 UTC
// (the push triggers the Atlas site/API rebuild a few minutes later).
function nextAtlasRun() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 17, 0));
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
function nextMondayAt(utcHour) {
  const now = new Date();
  const d   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, 0, 0));
  const daysAhead = (1 - d.getUTCDay() + 7) % 7 || (d > now ? 0 : 7);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d;
}
