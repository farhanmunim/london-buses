/**
 * route-detail.js — Route detail panel, direction toggle, and status toast
 */

import { renderRoute, setStopsVisible } from './map.js';
import {
  state,
  routeDetail, defaultState, filtersSection,
  routeBadgeNum, routeServiceBadge, routeStopCount,
  dirToggleBtn,
  epPrimaryDot, epPrimaryDir, epPrimaryName,
  epSecondaryDot, epSecondaryDir, epSecondaryName,
  metaOperator, metaGarage, metaFrequency, metaDeck, metaPropulsion, metaPvr, metaVehicle,
  statusToast, statusText,
  stopsToggleBtn, clearRouteBtn,
} from './state.js';

// ── Route detail ──────────────────────────────────────────────────────────────

let _destOutbound = '–';
let _destInbound  = '–';

export function showRouteDetail(id, geojson, stops, destinations, classification) {
  routeBadgeNum.textContent = id;

  let svcLabel, svcCls;
  if      (classification?.isPrefix)              { svcLabel = 'Prefix';   svcCls = 'prefix'; }
  else if (classification?.type === 'night')      { svcLabel = 'Night';    svcCls = 'night'; }
  else if (classification?.type === 'twentyfour') { svcLabel = '24 Hour';  svcCls = 'twentyfour'; }
  else if (classification?.type === 'school')     { svcLabel = 'School';   svcCls = 'school'; }
  else                                            { svcLabel = 'Regular';  svcCls = 'regular'; }
  routeServiceBadge.textContent = svcLabel;
  routeServiceBadge.className   = `route-detail__service-tag ${svcCls}`;

  _destOutbound = destinations?.outbound?.destination ?? '–';
  _destInbound  = destinations?.inbound?.destination  ?? '–';

  routeStopCount.textContent = `${stops.length} stops`;

  metaOperator.textContent = classification?.operator ?? '–';

  const gn = classification?.garageName;
  const gc = classification?.garageCode;
  metaGarage.textContent   = gn && gc ? `${gn} (${gc})` : (gn ?? gc ?? '–');

  const freqMap = { high: 'High (≤6 min)', regular: 'Regular (7–15 min)', low: 'Low (>15 min)' };
  metaFrequency.textContent  = freqMap[classification?.frequency] ?? '–';

  const deckMap = { double: 'Double deck', single: 'Single deck' };
  metaDeck.textContent       = deckMap[classification?.deck] ?? '–';

  const propMap = { electric: 'Electric', hydrogen: 'Hydrogen (fuel cell)', hybrid: 'Hybrid', diesel: 'Diesel' };
  metaPropulsion.textContent = propMap[classification?.propulsion] ?? '–';

  metaPvr.textContent        = classification?.pvr != null ? String(classification.pvr) : '–';

  metaVehicle.textContent    = classification?.vehicleType ?? '–';

  const directions = [...new Set(geojson.features.map(f => String(f.properties.direction)))];
  dirToggleBtn.hidden = directions.length < 2;
  syncDirTabs('1');

  defaultState.hidden   = true;
  routeDetail.hidden    = false;
}

export function showDefaultState() {
  defaultState.hidden   = false;
  routeDetail.hidden    = true;
}

// ── Direction toggle ──────────────────────────────────────────────────────────

dirToggleBtn?.addEventListener('click', () => {
  if (!state.routeGeoJson) return;
  const next = state.direction === '1' ? '2' : '1';
  state.direction = next;
  syncDirTabs(next);
  renderRoute(state.routeGeoJson, state.stopsFeatures, next);
});

function syncDirTabs(dir) {
  const isOutbound = dir === '1';

  dirToggleBtn?.classList.add('spinning');
  setTimeout(() => dirToggleBtn?.classList.remove('spinning'), 240);

  if (isOutbound) {
    epPrimaryDot.className    = 'route-endpoint__dot outbound';
    epPrimaryDir.textContent  = 'Outbound';
    epPrimaryName.textContent = _destOutbound;
    epSecondaryDot.className   = 'route-endpoint__dot inbound';
    epSecondaryDir.textContent = 'Inbound';
    epSecondaryName.textContent = _destInbound;
  } else {
    epPrimaryDot.className    = 'route-endpoint__dot inbound';
    epPrimaryDir.textContent  = 'Inbound';
    epPrimaryName.textContent = _destInbound;
    epSecondaryDot.className   = 'route-endpoint__dot outbound';
    epSecondaryDir.textContent = 'Outbound';
    epSecondaryName.textContent = _destOutbound;
  }
}

// ── Status toast ──────────────────────────────────────────────────────────────

let _statusTimer = null;

export function showStatus(msg, type = '') {
  statusText.textContent = msg;
  statusToast.className  = type;
  statusToast.hidden     = false;
  clearTimeout(_statusTimer);
  if (type === 'error') _statusTimer = setTimeout(hideStatus, 4000);
}

export function hideStatus() {
  statusToast.hidden    = true;
  statusToast.className = '';
}

// ── Stops toggle ──────────────────────────────────────────────────────────────

function syncStopsBtn(visible) {
  if (!stopsToggleBtn) return;
  stopsToggleBtn.setAttribute('aria-pressed', String(visible));
  stopsToggleBtn.classList.toggle('active', visible);
  const label = stopsToggleBtn.querySelector('.toggle-label');
  const noun  = stopsToggleBtn.dataset.noun;
  if (label && noun) label.textContent = `${visible ? 'Hide' : 'Show'} ${noun}`;
}

stopsToggleBtn?.addEventListener('click', () => {
  const nowVisible = setStopsVisible(stopsToggleBtn.getAttribute('aria-pressed') !== 'true');
  syncStopsBtn(nowVisible);
});

// ── Clear buttons ─────────────────────────────────────────────────────────────
// Two different "clears" with different scope:
//   • Clear route (route detail panel) — mirrors the search-field X: drops the
//     selected route + pills, but *keeps* filter chips intact.
//   • Clear all (filter panel footer)  — full reset: route + pills + every
//     filter chip.
// Dynamic import avoids a circular dep (search.js imports route-detail.js).

function clearRouteOnly() {
  import('./search.js').then(m => m.clearAll());
  syncStopsBtn(true);
}
function fullReset() {
  import('./search.js').then(m => m.clearAll());
  document.querySelectorAll('#filters-section .chip[data-filter]').forEach(c => {
    c.classList.remove('active');
    c.setAttribute('aria-pressed', 'false');
  });
  document.dispatchEvent(new CustomEvent('app:filterscleared'));
  syncStopsBtn(true);
}

clearRouteBtn?.addEventListener('click', clearRouteOnly);
document.getElementById('filter-clear-btn')?.addEventListener('click', fullReset);
