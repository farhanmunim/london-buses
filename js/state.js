/**
 * state.js — Shared application state and DOM refs
 *
 * Imported by every sub-module that needs to read or write state,
 * or interact with the sidebar DOM. Centralising both here avoids
 * threading them as function arguments across the whole app.
 */

// ── Application state ─────────────────────────────────────────────────────────

export const state = {
  routeId:         null,
  routeGeoJson:    null,
  stopsFeatures:   null,
  direction:       '1',
  routeIndex:      [],
  destinations:    {},
  classifications: {},
};

/** Ordered set of route IDs currently shown in multi-route mode. */
export const pillIds = new Set();

// ── DOM refs ──────────────────────────────────────────────────────────────────

// `sidebar`, `collapseBtn`, `expandBtn` existed in v1 for the old custom
// sidebar layout. v2 uses the blueprint's collapsible panel primitives, so
// the shell handles collapse/expand — these exports have been removed.
export const searchInput       = document.getElementById('search-input');
export const searchClear       = document.getElementById('search-clear');
export const autocompleteList  = document.getElementById('autocomplete-list');
export const searchPills       = document.getElementById('search-pills');
export const defaultState      = document.getElementById('default-state');
export const routeDetail       = document.getElementById('route-detail');
export const filtersSection    = document.getElementById('filters-section');
export const routeBadgeNum     = document.getElementById('route-badge-number');
export const routeServiceBadge = document.getElementById('route-service-badge');
export const routeStopCount    = document.getElementById('route-stop-count');
export const dirToggleBtn      = document.getElementById('dir-toggle-btn');
export const epPrimaryDot      = document.getElementById('ep-primary-dot');
export const epPrimaryDir      = document.getElementById('ep-primary-dir');
export const epPrimaryName     = document.getElementById('ep-primary-name');
export const epSecondaryDot    = document.getElementById('ep-secondary-dot');
export const epSecondaryDir    = document.getElementById('ep-secondary-dir');
export const epSecondaryName   = document.getElementById('ep-secondary-name');
export const stopsToggleBtn    = document.getElementById('stops-toggle-btn');
export const clearRouteBtn     = document.getElementById('clear-route-btn');
export const metaOperator      = document.getElementById('meta-operator');
export const metaGarage        = document.getElementById('meta-garage');
export const metaFrequency     = document.getElementById('meta-frequency');
export const metaDeck          = document.getElementById('meta-deck');
export const metaPropulsion    = document.getElementById('meta-propulsion');
export const metaPvr           = document.getElementById('meta-pvr');
export const metaVehicle       = document.getElementById('meta-vehicle');
export const statusToast       = document.getElementById('status-toast');
export const statusText        = document.getElementById('status-text');
export const footerDate        = document.getElementById('footer-date');
export const footerNextDate    = document.getElementById('footer-next-date');
