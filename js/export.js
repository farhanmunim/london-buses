/**
 * export.js — XLSX export (topbar Export button).
 *
 * Three sheets, all honouring the current filter state:
 *   • Routes            — per-route data, full record (identity / service /
 *                         fleet / reliability / last tender / next tender)
 *   • Garages           — per-garage data (code, name, operator, address, …)
 *   • Network overview  — per-operator aggregates (share of routes, PVR, EV)
 *                         + PVR-weighted fleet mix
 *
 * SheetJS is loaded via a <script defer> tag. If the user clicks before it
 * finishes downloading we surface a friendly "try again" message rather than
 * erroring into the console.
 */

import { getVisibleRouteProps, getVisibleGarages } from './map.js';
import { state, exportBtn } from './state.js';
import { fetchRouteStopCount } from './api.js';

exportBtn?.addEventListener('click', async () => {
  if (typeof XLSX === 'undefined') {
    alert('Export library still loading — try again in a moment.');
    return;
  }
  const routes = getVisibleRouteProps();
  if (!routes.size) return;

  // Pre-resolve per-route stop counts so the Routes sheet can include them.
  // First call warms the route_stops bundle (~1.3 MB gzipped); subsequent
  // calls are O(1). Using Promise.all keeps the click → file gap under a
  // second on a warm cache and ~1-2 s on a cold one.
  const stopCounts = new Map();
  await Promise.all([...routes.keys()].map(async (id) => {
    try { stopCounts.set(id, await fetchRouteStopCount(id)); }
    catch { stopCounts.set(id, null); }
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildRouteRows(routes, stopCounts)), 'Routes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildGarageRows()),                  'Garages');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildOverviewRows(routes)),          'Network overview');
  XLSX.writeFile(wb, `london-buses-${new Date().toISOString().slice(0, 10)}.xlsx`);
});

// Helpers — keep formatting consistent across the sheet so a downstream
// pivot or sort behaves predictably.
const yesNo = (v) => (v === true ? 'yes' : v === false ? 'no' : '');
const num   = (v) => (Number.isFinite(v) ? v : '');
const str   = (v) => (v ?? '');

function buildRouteRows(routes, stopCounts) {
  return [...routes.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, props]) => {
      const dest = state.destinations[id]    ?? {};
      const cls  = state.classifications[id] ?? {};

      // Column ordering mirrors the route-card sections (identity → service →
      // fleet → reliability → last tender → next tender) so the spreadsheet
      // reads in the same order a user would scan the card.
      return {
        // ── Identity ──
        route_id:                  id,
        destination_outbound:      str(dest.outbound?.destination),
        destination_inbound:       str(dest.inbound?.destination),
        route_type:                str(props.routeType),
        is_prefix:                 yesNo(props.isPrefix),
        operator:                  str(props.operator),

        // ── Service ──
        frequency:                 str(props.frequency),
        length_band:               str(props.lengthBand),
        pvr:                       num(cls.pvr),
        stop_count:                num(stopCounts.get(id)),
        garage_code:               str(cls.garageCode),
        garage_name:               str(cls.garageName),

        // ── Fleet (live, observed via TfL arrivals + DVLA join) ──
        deck:                      str(props.deck),
        propulsion:                str(props.propulsion),
        vehicle_make:              str(cls.make),
        vehicle_model:             str(cls.vehicleType),
        avg_fleet_age_years:       num(cls.vehicleAgeYears),
        observed_fleet_size:       num(cls.fleetSize),

        // ── Reliability (TfL QSI PDF — actuals + per-route contractual MPS) ──
        service_class:             str(cls.serviceClass),
        ewt_minutes:               num(cls.ewtMinutes),
        ewt_mps_minutes:           num(cls.ewtMps),
        on_time_percent:           num(cls.onTimePercent),
        otp_mps_percent:           num(cls.otpMps),
        mileage_mps_percent:       num(cls.mileageMps),
        performance_period:        str(cls.perfPeriod),

        // ── Tender — last (current) contract ──
        last_award_date:           str(cls.lastAwardDate),
        contract_start_date:       str(cls.contractStartDate),
        awards_on_record:          num(cls.tenderAwardCount),
        bids_received:             num(cls.numberOfTenderers),
        was_joint_bid:             yesNo(cls.wasJointBid),
        previous_operator:         str(cls.previousOperator),
        awarded_propulsion:        str(cls.awardedPropulsion),
        awarded_deck:              str(cls.awardedDeck),
        previous_awarded_propulsion: str(cls.prevAwardedPropulsion),
        previous_awarded_deck:     str(cls.prevAwardedDeck),
        cost_per_mile_gbp:         num(cls.lastCostPerMile),
        contract_term_years:       num(cls.contractTermYears),

        // ── Tender — next (upcoming) contract ──
        contract_expires:          str(cls.nextTenderStart),
        next_programme_year:       str(cls.nextTenderYear),
        next_award_propulsion:     str(cls.nextAwardPropulsion),
        next_award_deck:           str(cls.nextAwardDeck),
        extension_eligible:        yesNo(cls.extensionEligible),
      };
    });
}

function buildGarageRows() {
  // Pre-index PVR by garage code so we can attach each garage's contracted
  // PVR (sum of every route assigned to it). PVR is per-route in the
  // classifications, not per-garage, so it has to be aggregated here.
  const pvrByGarage = {};
  for (const cls of Object.values(state.classifications ?? {})) {
    const code = cls.garageCode;
    if (!code || !Number.isFinite(cls.pvr)) continue;
    pvrByGarage[code] = (pvrByGarage[code] ?? 0) + cls.pvr;
  }

  return getVisibleGarages()
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
    .map(g => ({
      garage_code: g.code,
      garage_name: g.name,
      operator:    g.operator ?? '',
      address:     g.address  ?? '',
      latitude:    g.lat,
      longitude:   g.lon,
      route_count: g.routeCount ?? 0,
      total_pvr:   pvrByGarage[g.code] ?? 0,
    }));
}

function buildOverviewRows(routes) {
  const list = [...routes.entries()].map(([id, props]) => ({
    ...props,
    pvr: state.classifications[id]?.pvr ?? null,
  }));
  const totalRoutes = list.length;
  const totalPvr    = list.reduce((s, r) => s + (r.pvr ?? 0), 0);

  const ops = {};
  for (const r of list) {
    const op = r.operator ?? 'Unknown';
    (ops[op] ??= { routes: 0, pvr: 0, ev: 0 }).routes++;
    ops[op].pvr += r.pvr ?? 0;
    if (r.propulsion === 'electric') ops[op].ev++;
  }
  const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '–';
  const rows = Object.entries(ops)
    .sort(([aK, aV], [bK, bV]) => aK === 'Unknown' ? 1 : bK === 'Unknown' ? -1 : bV.routes - aV.routes)
    .map(([op, v]) => ({
      operator:        op,
      routes:          v.routes,
      route_share:     pct(v.routes, totalRoutes),
      pvr_total:       v.pvr,
      pvr_share:       pct(v.pvr, totalPvr),
      electric_routes: v.ev,
      electric_share:  pct(v.ev, v.routes),
    }));
  const totalEv = list.filter(r => r.propulsion === 'electric').length;
  rows.push({
    operator:        'TOTAL',
    routes:          totalRoutes,
    route_share:     '100%',
    pvr_total:       totalPvr,
    pvr_share:       '100%',
    electric_routes: totalEv,
    electric_share:  pct(totalEv, totalRoutes),
  });

  // Fleet mix block — mirrors the right-panel Fleet Mix chart. PVR-weighted
  // so a 42-bus diesel route outweighs a 6-bus electric school route, which
  // is how operations teams think about the fleet. Blank rows above act as a
  // visual separator in the spreadsheet; the "FLEET MIX" label sits in the
  // operator column so it reads naturally at the top of the block.
  const buckets = { electric: 0, hybrid: 0, hydrogen: 0, diesel: 0, unknown: 0 };
  const routeBuckets = { electric: 0, hybrid: 0, hydrogen: 0, diesel: 0, unknown: 0 };
  for (const r of list) {
    const key = buckets[r.propulsion] !== undefined ? r.propulsion : 'unknown';
    buckets[key]      += r.pvr ?? 0;
    routeBuckets[key] += 1;
  }
  const labelOf = { electric: 'Electric', hybrid: 'Hybrid', hydrogen: 'Hydrogen', diesel: 'Diesel', unknown: 'Unknown' };

  rows.push({ operator: '' }, { operator: 'FLEET MIX (by PVR)' });
  for (const key of ['electric', 'hybrid', 'hydrogen', 'diesel', 'unknown']) {
    const pvr = buckets[key];
    if (!pvr && !routeBuckets[key]) continue; // skip empty buckets
    rows.push({
      operator:        labelOf[key],
      routes:          routeBuckets[key],
      route_share:     pct(routeBuckets[key], totalRoutes),
      pvr_total:       pvr,
      pvr_share:       pct(pvr, totalPvr),
      electric_routes: '',
      electric_share:  '',
    });
  }
  return rows;
}
