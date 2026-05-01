/**
 * route-detail.js — Render one or many route cards into the Routes tab.
 *
 * Clones `#tpl-route-card` per entry and populates the per-route record from
 * `route_classifications.json`. Fields displayed from the historical pipeline:
 *   - operator, PVR, deck, propulsion (LBR + DVLA)
 *   - make + vehicle (DVLA + LBR)
 *   - avg fleet age + fleet size (DVLA cross-referenced with TfL arrivals)
 *   - reliability — EWT for high-freq, OTP for low-freq (TfL QSI PDF)
 *   - previous operator, contract expires, contract value (TfL tender data,
 *     joined from data/source/tenders.json + tender-programme.json)
 */

import { routeResults, routePrompt, routeNoResult, routeCardTpl } from './state.js';

// Frequency label matches the filter pill vocabulary — High / Regular / Low
// rather than raw headway bands so "Freq" reads the same way everywhere the
// user sees it (filter pill, route card KPI).
const FREQ_MAP  = { high: 'High', low: 'Low' };
// Deck rendered as the standard industry abbreviations — saves horizontal
// space on the small Fleet rows and the composite "Awarded vehicle" cell
// (e.g. "Electric (DD)" instead of "Electric (double)").
const DECK_MAP  = { double: 'DD', single: 'SD' };
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

// Tender-history operators — historical TfL tender data carries subsidiary
// names (Arriva London North, First London East, Abellio West London, …)
// that should fold into the parent brand for display, while genuinely
// distinct historical brands (Tower Transit, Selkent, London Sovereign,
// Blue Triangle, Docklands Buses, …) stay as-is so the predecessor reads
// as a meaningful contractor rather than an over-collapsed "Stagecoach".
// Order matters: longest prefix first so "Arriva London North" beats "Arriva".
const TENDER_OP_PREFIXES = [
  ['Arriva London',    'Arriva'],
  ['Arriva Kent',      'Arriva'],
  ['Arriva The Shires','Arriva'],
  ['Arriva the Shires','Arriva'],
  ['Abellio London',   'Abellio'],
  ['Abellio West',     'Abellio'],
  ['Stagecoach East',  'Stagecoach'],
  ['Stagecoach Selkent','Stagecoach'],
  ['Stagecoach London','Stagecoach'],
  ['First London',     'First'],
  ['First CentreWest', 'First'],
  ['First Capital',    'First'],
  ['Metroline West',   'Metroline'],
  ['Metroline Travel', 'Metroline'],
  ['Go-Ahead London',  'Go-Ahead'],
];
function normaliseTenderOperator(name) {
  if (!name) return name;
  for (const [prefix, brand] of TENDER_OP_PREFIXES) {
    if (name.startsWith(prefix)) return brand;
  }
  // Existing OPERATOR_SHORT covers current-incumbent labels.
  return OPERATOR_SHORT[name] ?? name;
}

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

  // Vehicle make — DVLA returns the manufacturer in upper-case ("VOLVO").
  // Title-case it so it reads naturally ("Volvo").
  const make = classification?.make;
  set('[data-rc-vehicle-make]', make ? toTitleCase(make) : 'XXX');

  // Vehicle model — chassis+body string from LBR ("B5LH/Gemini 3", "Enviro400 MMC").
  // The underlying field is still called `vehicleType` for compatibility with
  // the Supabase schema; the UI calls it "Vehicle model".
  set('[data-rc-vehicle-model]', classification?.vehicleType ?? 'XXX');

  // Avg fleet age in years — mean of (today − monthOfFirstRegistration) across
  // observed regs. One decimal, matches DVLA's resolution.
  const age = classification?.vehicleAgeYears;
  set('[data-rc-age]', Number.isFinite(age) ? `${age.toFixed(1)} years` : 'XXX');

  // Reliability — exactly one of (EWT, OTP) is populated per route depending
  // on serviceClass. Label swaps with the metric so the user always sees the
  // right vocabulary ("EWT 1.6 min" for high-freq, "On time 80%" for low-freq).
  const perfL = node.querySelector('[data-rc-perf-l]');
  const sc    = classification?.serviceClass;
  const ewt   = classification?.ewtMinutes;
  const otp   = classification?.onTimePercent;
  if (sc === 'high-frequency' && Number.isFinite(ewt)) {
    if (perfL) perfL.textContent = 'Excess wait time';
    set('[data-rc-perf]', `${ewt.toFixed(1)} min`);
  } else if (sc === 'low-frequency' && Number.isFinite(otp)) {
    if (perfL) perfL.textContent = 'On-time performance';
    set('[data-rc-perf]', `${otp.toFixed(0)}%`);
  } else {
    if (perfL) perfL.textContent = 'Reliability';
    set('[data-rc-perf]', 'XXX');
  }

  // Last awarded — when the most recent tender on this route was decided.
  const lastAwd = classification?.lastAwardDate;
  set('[data-rc-last-award]', lastAwd ? formatHumanDate(lastAwd) : 'XXX');

  // Awards on record — total number of historical TfL tenders we've seen for
  // this route. Stability signal (one award since 2003 = incumbent-dominated;
  // 5+ awards = competitive corridor).
  const awardCnt = classification?.tenderAwardCount;
  set('[data-rc-award-count]', awardCnt ? `${awardCnt}${awardCnt === 1 ? ' award' : ' awards'}` : 'XXX');

  // Bids received — competitiveness of the most recent tender.
  const bids = classification?.numberOfTenderers;
  toggleRow(node, 'bids', Number.isFinite(bids) && bids > 0);
  if (Number.isFinite(bids) && bids > 0) set('[data-rc-bids]', `${bids}${bids === 1 ? ' bid' : ' bids'}`);

  // Joint bid — only render the row when the route was bundled (the "No"
  // case is the boring default). The bundled-routes phrase TfL fills in
  // can be a paragraph long, so we collapse to a plain "Yes" — the value
  // is the *flag*, not the partner list, which would dominate the card.
  const wasJB = classification?.wasJointBid === true;
  toggleRow(node, 'joint', wasJB);
  if (wasJB) set('[data-rc-joint]', 'Yes');

  // Previous operator — derived from tender history (most recent earlier
  // award whose operator differs from the current incumbent). Subsidiary
  // names ("Arriva London North", "First London East", …) fold into the
  // parent brand for readability. Three distinct UI states:
  //   • Real predecessor       → "Arriva", "Tower Transit", …
  //   • count >= 2 + null      → "(no change)" — same operator re-awarded
  //   • count <= 1             → "(first award)" or "—" (no history at all)
  const prevOp     = classification?.previousOperator;
  const awardCount = classification?.tenderAwardCount ?? 0;
  const prevEl     = node.querySelector('[data-rc-previous]');
  if (prevOp) {
    if (prevEl) {
      prevEl.classList.remove('rc-tr-v--muted');
      prevEl.textContent = normaliseTenderOperator(prevOp);
    }
  } else if (awardCount >= 2) {
    if (prevEl) {
      prevEl.classList.add('rc-tr-v--muted');
      prevEl.textContent = 'no change';
    }
  } else if (awardCount === 1) {
    if (prevEl) {
      prevEl.classList.add('rc-tr-v--muted');
      prevEl.textContent = 'first award';
    }
  } else {
    if (prevEl) {
      prevEl.classList.remove('rc-tr-v--muted');
      prevEl.textContent = 'XXX';
    }
  }

  // Contract expires — when the next scheduled tender's contract starts on
  // this route. Falls back to "—" rather than a stale past date when TfL
  // hasn't yet published a future programme entry for the route.
  const nextStart = classification?.nextTenderStart;
  set('[data-rc-expiry]', nextStart ? formatHumanDate(nextStart) : 'XXX');

  // Cost per mile — most recent tender's £/mile (normalised so comparisons
  // across routes of different lengths actually mean something). Two decimals
  // matches TfL's published precision.
  const cpm = classification?.lastCostPerMile;
  set('[data-rc-value]', Number.isFinite(cpm) ? `£${cpm.toFixed(2)}` : 'XXX');

  // Awarded vehicle — what TfL specified the most recent contract should
  // run. Worth comparing against the live `propulsion` / `deck` above; a
  // route mid-conversion will show awarded=electric vs actual=hybrid.
  set('[data-rc-awarded-veh]', formatAwardedVehicle(classification?.awardedPropulsion, classification?.awardedDeck));

  // Previous spec — only render when the most-recent tender's awarded spec
  // genuinely differs from the second-most-recent. A clean propulsion-
  // transition surface ("Electric (double) — was Hybrid (double)").
  const aP = classification?.awardedPropulsion;
  const aD = classification?.awardedDeck;
  const pP = classification?.prevAwardedPropulsion;
  const pD = classification?.prevAwardedDeck;
  const specChanged = (pP || pD) && (pP !== aP || pD !== aD);
  toggleRow(node, 'prev-veh', !!specChanged);
  if (specChanged) set('[data-rc-prev-veh]', formatAwardedVehicle(pP, pD));

  // Contract term — note-derived (rare, authoritative) or date-derived
  // (broader coverage, ±1y precision).
  const term = classification?.contractTermYears;
  toggleRow(node, 'term', Number.isFinite(term) && term > 0);
  if (Number.isFinite(term) && term > 0) set('[data-rc-term]', `${term} years`);

  // Next award spec — what TfL plans the *next* tender to require. Often
  // the strongest signal of an electrification transition.
  set('[data-rc-next-veh]', formatAwardedVehicle(classification?.nextAwardPropulsion, classification?.nextAwardDeck));

  // Extension eligible — TfL's 'x' marker on the programme entry. Only
  // render the row when Yes; "No" is the silent default.
  const ext = classification?.extensionEligible === true;
  toggleRow(node, 'extension', ext);
  if (ext) set('[data-rc-extension]', 'Yes (2 years)');

  return node;
}

// Show or hide a conditional row by its `data-rc-row` key. Rows ship with
// the `hidden` attribute set in the template so missing data doesn't draw
// a placeholder; renders only flip the attribute, never construct DOM.
function toggleRow(card, key, show) {
  const row = card.querySelector(`[data-rc-row="${key}"]`);
  if (!row) return;
  row.hidden = !show;
}

// "Hybrid (DD)" / "Electric" / "—" depending on what we have. Kept as one
// row rather than two so the Tender section stays compact.
function formatAwardedVehicle(propulsion, deck) {
  const p = propulsion ? PROP_MAP[propulsion] : null;
  const d = deck       ? DECK_MAP[deck]       : null;
  if (p && d) return `${p} (${d})`;
  if (p)      return p;
  if (d)      return d;
  return 'XXX';
}

function toTitleCase(s) {
  return String(s).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

// ISO yyyy-mm-dd → "12 Aug 2025". Locale-stable so the card reads the same
// for everyone regardless of browser locale.
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatHumanDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return iso;
  const mon = MONTHS_SHORT[parseInt(m[2], 10) - 1] ?? m[2];
  return `${parseInt(m[3], 10)} ${mon} ${m[1]}`;
}
