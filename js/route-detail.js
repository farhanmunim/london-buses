/**
 * route-detail.js — Render one or many route cards into the Routes tab.
 *
 * Clones `#tpl-route-card` per entry and populates the fields we have
 * (operator, PVR, frequency, deck + propulsion as the 'Fleet' cell, length
 * band, garage name). Fields we don't have yet (on-time, PAX/day, contract
 * expiry / value) keep the literal "XXX" the template ships.
 */

import { routeResults, routePrompt, routeNoResult, routeCardTpl } from './state.js';

// Frequency label matches the filter pill vocabulary — High / Regular / Low
// rather than raw headway bands so "Freq" reads the same way everywhere the
// user sees it (filter pill, route card KPI).
const FREQ_MAP  = { high: 'High', low: 'Low' };
const DECK_MAP  = { double: 'Double', single: 'Single' };
const PROP_MAP  = { electric: 'Electric', hydrogen: 'Hydrogen', hybrid: 'Hybrid', diesel: 'Diesel' };
const TYPE_MAP  = { regular: 'Regular', night: 'Night', twentyfour: '24 Hour', school: 'School', prefix: 'Prefix' };

const OPERATOR_COLORS = {
  'Arriva':            '#2563eb',
  'Arriva London':     '#2563eb',
  'First':             '#7c3aed',
  'First London':      '#7c3aed',
  'Go-Ahead':          '#e8192c',
  'Go-Ahead London':   '#e8192c',
  'Metroline':         '#0891b2',
  'Stagecoach':        '#1b3d72',
  'Stagecoach London': '#1b3d72',
  'Transport UK':      '#db2777',
  'RATP':              '#16a34a',
  'Uno':               '#d97706',
};

// Short labels for the route-card operator pill (Stagecoach London → Stagecoach).
const OPERATOR_SHORT = {
  'Arriva London':     'Arriva',
  'First London':      'First',
  'Go-Ahead London':   'Go-Ahead',
  'Stagecoach London': 'Stagecoach',
  'Uno Buses':         'Uno',
  'RATP Dev':          'RATP',
};

/**
 * Render N route cards. Each entry: { id, classification, destinations }.
 * Empty list → shows the "no result" state.
 *
 * When `entries.length === 1`, the card also exposes a direction-toggle
 * button (outbound ⇄ inbound). Multi-route mode keeps the toggle hidden —
 * there's no single route to flip.
 */
export function renderRouteCards(entries, { direction = '1' } = {}) {
  if (!routeResults || !routeCardTpl) return;
  clearCards();
  if (!entries.length) { showNoResult(); return; }

  routeResults.hidden = false;
  if (routeNoResult) routeNoResult.hidden = true;
  if (routePrompt)   routePrompt.style.display = 'none';

  const single = entries.length === 1;
  for (const entry of entries) routeResults.appendChild(buildCard(entry, { single, direction }));
}

export function showNoResult() {
  clearCards();
  if (!routeResults) return;
  routeResults.hidden = false;
  if (routeNoResult) routeNoResult.hidden = false;
  if (routePrompt)   routePrompt.style.display = 'none';
}

export function showRoutePrompt() {
  clearCards();
  if (routePrompt)   routePrompt.style.display = '';
  if (routeResults)  routeResults.hidden = true;
  if (routeNoResult) routeNoResult.hidden = true;
}

// ── internals ────────────────────────────────────────────────────────────────

function clearCards() {
  if (!routeResults) return;
  [...routeResults.querySelectorAll('.route-card')].forEach(el => el.remove());
}

function buildCard({ id, classification, destinations, stopCount }, { single = false, direction = '1' } = {}) {
  const node = routeCardTpl.content.firstElementChild.cloneNode(true);
  const set  = (sel, text) => { const el = node.querySelector(sel); if (el) el.textContent = text; };

  const outbound = destinations?.outbound?.destination;
  const inbound  = destinations?.inbound?.destination;

  set('[data-rc-num]', id);

  // Route name shows the direction-specific "origin → destination" pair.
  // For single-route with both directions, the swap button flips this text
  // between the two orientations without re-fetching.
  const dirBtn = node.querySelector('[data-rc-dir]');
  const hasBoth = !!(outbound && inbound);
  if (single && hasBoth) {
    const isOutbound = direction !== '2';
    const origin = isOutbound ? inbound  : outbound;
    const dest   = isOutbound ? outbound : inbound;
    set('[data-rc-name]', `${origin} → ${dest}`);
    if (dirBtn) dirBtn.hidden = false;
  } else {
    // Multi-route or single-direction — static display, no toggle.
    const nameBits = [outbound, inbound].filter(Boolean);
    set('[data-rc-name]', nameBits.length ? nameBits.join(' → ') : '—');
    if (dirBtn) dirBtn.hidden = true;
  }

  const op   = classification?.operator ?? 'Unknown';
  const opEl = node.querySelector('[data-rc-op]');
  if (opEl) {
    opEl.textContent = OPERATOR_SHORT[op] ?? op;
    opEl.style.background = OPERATOR_COLORS[op] ?? '#64748b';
  }

  // Prefix is a sub-classification of regular in the dataset (isPrefix=true on
  // letter-prefixed routes like EL1, W7). Surface it as its own Type value
  // since that's how the sidebar filters it.
  const typeKey = classification?.isPrefix ? 'prefix' : (classification?.type ?? '');
  set('[data-rc-type]',       TYPE_MAP[typeKey] ?? 'XXX');
  set('[data-rc-pvr]',        classification?.pvr ?? 'XXX');
  set('[data-rc-stops]',      Number.isFinite(stopCount) ? stopCount.toLocaleString() : '—');
  set('[data-rc-freq]',       FREQ_MAP[classification?.frequency]  ?? 'XXX');
  set('[data-rc-deck]',       DECK_MAP[classification?.deck]       ?? 'XXX');
  set('[data-rc-propulsion]', PROP_MAP[classification?.propulsion] ?? 'XXX');

  const gn = classification?.garageName;
  const gc = classification?.garageCode;
  set('[data-rc-garage]', gn && gc ? `${gn} (${gc})` : (gn ?? gc ?? 'XXX'));

  // Vehicle name (e.g. "BYD B12RLE/Alexander Dennis Enviro400 EV"). When
  // missing leave 'XXX' so the placeholder is visible rather than an em-dash
  // which could read as "no vehicle".
  set('[data-rc-vehicle]', classification?.vehicleType ?? 'XXX');

  // Previous operator isn't in the dataset yet — keep as XXX until the
  // tender / contract feed lands.
  return node;
}
