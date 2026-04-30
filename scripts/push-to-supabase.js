/**
 * push-to-supabase.js — Mirror the static data files into the Supabase store.
 *
 * Runs at the end of the weekly pipeline. Reads three files produced by
 * earlier steps and upserts the contents into Supabase Postgres:
 *
 *   data/source/vehicle-fleet.json   → public.vehicles               (upsert by registration)
 *   data/route_classifications.json  → public.route_snapshots        (upsert per (route_id, snapshot_date))
 *     + data/route_stops.json        → adds stop_count per snapshot row
 *   data/source/route-vehicles.json  → public.route_vehicle_observations (insert this run's fresh observations)
 *   data/garages.geojson             → public.garage_snapshots       (upsert per (garage_code, snapshot_date))
 *     + summed PVR / route count derived from route_classifications
 *   data/source/route-performance.json → public.route_performance    (upsert per (route_id, period_label))
 *
 * The static-JSON read path that powers the public map is unaffected — Supabase
 * is a *write* destination only, used to build the historical record that
 * powers the analytics page.
 *
 * Soft-fail by design: if Supabase is unreachable or the env vars aren't set,
 * the script logs and exits 0 so the rest of the pipeline (which has already
 * succeeded by this point) isn't penalised.
 *
 * Run: npm run push-to-supabase
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './_lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DATA_DIR  = path.join(ROOT, 'data');
const BATCH     = 500;        // Supabase recommends ≤1000 rows per upsert; 500 is safely under

loadEnv();
const SUPABASE_URL              = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Supabase env not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing) — skipping push.');
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  // Service-role key bypasses RLS so we can write freely.
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function readJsonOrNull(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.warn(`  Failed to parse ${p}: ${err.message}`);
    return null;
  }
}

async function upsertInBatches(table, rows, conflictKey) {
  if (!rows.length) {
    console.log(`  ${table}: nothing to write`);
    return;
  }
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from(table)
      .upsert(chunk, { onConflict: conflictKey, ignoreDuplicates: false });
    if (error) {
      throw new Error(`${table} upsert failed at row ${i}: ${error.message}`);
    }
    written += chunk.length;
  }
  console.log(`  ${table}: wrote ${written} rows`);
}

async function insertInBatches(table, rows) {
  if (!rows.length) {
    console.log(`  ${table}: nothing to insert`);
    return;
  }
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    // Use upsert with ignoreDuplicates so a manual re-run of the pipeline on
    // the same Monday doesn't error on duplicate primary keys.
    const { error } = await supabase
      .from(table)
      .upsert(chunk, {
        onConflict: 'route_id,registration,observed_at',
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`${table} insert failed at row ${i}: ${error.message}`);
    written += chunk.length;
  }
  console.log(`  ${table}: inserted up to ${written} rows (duplicates ignored)`);
}

// ── 1. vehicles ─────────────────────────────────────────────────────────────
async function pushVehicles() {
  const path_ = path.join(DATA_DIR, 'source', 'vehicle-fleet.json');
  const fleet = readJsonOrNull(path_);
  if (!fleet) {
    console.log('  vehicles: no vehicle-fleet.json — skipping');
    return;
  }
  const now = new Date().toISOString();
  const rows = Object.entries(fleet.vehicles ?? {}).map(([reg, v]) => ({
    registration:                reg,
    make:                        v.make ?? null,
    fuel_type:                   v.fuelType ?? null,
    fuel_type_raw:               v.fuelTypeRaw ?? null,
    year_of_manufacture:         Number.isFinite(v.yearOfManufacture) ? v.yearOfManufacture : null,
    month_of_first_registration: v.monthOfFirstRegistration ?? null,
    bonnet_no:                   v.bonnetNo ?? null,
    operator:                    v.operator ?? null,
    dvla_status:                 Number.isFinite(v.dvlaStatus) ? v.dvlaStatus : null,
    last_checked_at:             v.lastCheckedAt ?? null,
    data_as_of:                  v.lastCheckedAt ?? null,   // explicit data_as_of per the dual-timestamp convention
    updated_at:                  now,
  }));
  await upsertInBatches('vehicles', rows, 'registration');
}

// Snapshot date used by every per-week table this run. Driven by the
// classifications generatedAt so all tables agree on which Monday they
// belong to. Falls back to today (UTC) for ad-hoc local runs.
function snapshotDateFor(cls) {
  return (cls?.generatedAt ? new Date(cls.generatedAt) : new Date())
    .toISOString().slice(0, 10);
}

// Per-route stop count from route_stops.json. Used as a column on
// route_snapshots so weekly trends in route length / coverage are visible
// without storing the full stop list weekly.
function loadStopCounts() {
  const file = readJsonOrNull(path.join(DATA_DIR, 'route_stops.json'));
  const map = {};
  for (const [routeId, list] of Object.entries(file?.routes ?? {})) {
    if (Array.isArray(list)) map[routeId] = list.length;
  }
  return map;
}

// ── 2. route_snapshots ──────────────────────────────────────────────────────
async function pushRouteSnapshots() {
  const cls = readJsonOrNull(path.join(DATA_DIR, 'route_classifications.json'));
  if (!cls?.routes) {
    console.log('  route_snapshots: no classifications — skipping');
    return;
  }
  const snapshotDate = snapshotDateFor(cls);
  const stopCounts = loadStopCounts();

  const rows = Object.entries(cls.routes).map(([routeId, r]) => ({
    route_id:          routeId,
    snapshot_date:     snapshotDate,
    type:              r.type ?? null,
    is_prefix:         r.isPrefix ?? null,
    length_band:       r.lengthBand ?? null,
    deck:              r.deck ?? null,
    vehicle_type:      r.vehicleType ?? null,
    propulsion:        r.propulsion ?? null,
    make:              r.make ?? null,
    vehicle_age_years: Number.isFinite(r.vehicleAgeYears) ? r.vehicleAgeYears : null,
    fleet_size:        Number.isFinite(r.fleetSize) ? r.fleetSize : null,
    operator:          r.operator ?? null,
    garage_name:       r.garageName ?? null,
    garage_code:       r.garageCode ?? null,
    pvr:               Number.isFinite(r.pvr) ? r.pvr : null,
    frequency:         r.frequency ?? null,
    stop_count:        Number.isFinite(stopCounts[routeId]) ? stopCounts[routeId] : null,
  }));
  await upsertInBatches('route_snapshots', rows, 'route_id,snapshot_date');
}

// ── 4. garage_snapshots ─────────────────────────────────────────────────────
// Per-garage weekly row. Static-ish fields (name, operator, address, location)
// come from data/garages.geojson; the aggregate fields (total_pvr,
// route_count) are summed from this run's route_classifications so the
// figures match the route-level snapshot for the same week.
async function pushGarageSnapshots() {
  const cls     = readJsonOrNull(path.join(DATA_DIR, 'route_classifications.json'));
  const garages = readJsonOrNull(path.join(DATA_DIR, 'garages.geojson'));
  if (!cls?.routes) {
    console.log('  garage_snapshots: no classifications — skipping');
    return;
  }
  if (!garages?.features) {
    console.log('  garage_snapshots: no garages.geojson — skipping');
    return;
  }
  const snapshotDate = snapshotDateFor(cls);

  // Aggregate this week's route data per garage_code so each garage row
  // carries summed PVR + route count consistent with route_snapshots.
  const aggByCode = {};   // { code: { totalPvr, routes: Set } }
  for (const [routeId, r] of Object.entries(cls.routes)) {
    const code = (r.garageCode || '').toUpperCase();
    if (!code) continue;
    const a = aggByCode[code] ??= { totalPvr: 0, routes: new Set() };
    if (Number.isFinite(r.pvr)) a.totalPvr += r.pvr;
    a.routes.add(routeId);
  }

  const rows = [];
  const seenCodes = new Set();   // de-duplicate if a code appears twice in geojson
  for (const f of garages.features) {
    const p = f.properties ?? {};
    const code = String(p['TfL garage code'] || p['LBR garage code'] || '').trim().toUpperCase();
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);

    const splitRoutes = (s) => String(s ?? '')
      .split(/\s+/).map(t => t.trim().toUpperCase()).filter(Boolean);

    const agg = aggByCode[code];
    const lon = f.geometry?.type === 'Point' ? f.geometry.coordinates?.[0] : null;
    const lat = f.geometry?.type === 'Point' ? f.geometry.coordinates?.[1] : null;

    rows.push({
      garage_code:   code,
      snapshot_date: snapshotDate,
      garage_name:   p['Garage name'] ?? null,
      operator:      p['Group name'] ?? null,
      address:       p['Garage address'] ?? null,
      postcode:      p['_geocode_postcode'] ?? null,
      lat:           Number.isFinite(lat) ? lat : null,
      lon:           Number.isFinite(lon) ? lon : null,
      total_pvr:     agg ? agg.totalPvr : 0,
      route_count:   agg ? agg.routes.size : 0,
      routes:        splitRoutes(p['TfL main network routes']),
      night_routes:  splitRoutes(p['TfL night routes']),
      school_routes: splitRoutes(p['TfL school/mobility routes']),
    });
  }
  await upsertInBatches('garage_snapshots', rows, 'garage_code,snapshot_date');
}

// ── 5. route_performance ────────────────────────────────────────────────────
// EWT (high-frequency) / OTP (low-frequency) per-route metrics from the TfL
// QSI PDF. Idempotent on (route_id, period_label) — re-running while the PDF
// is unchanged updates extracted_at but otherwise no-ops on row content.
async function pushRoutePerformance() {
  const file = readJsonOrNull(path.join(DATA_DIR, 'source', 'route-performance.json'));
  if (!file?.routes || !file.periodLabel) {
    console.log('  route_performance: no parsed data — skipping');
    return;
  }
  const periodLabel = file.periodLabel;
  const periodStart = file.periodStart ?? null;
  const periodEnd   = file.periodEnd   ?? null;
  const sourceUrl   = file.sourceUrl   ?? null;
  const pdfModified = file.pdfModifiedAt ?? null;
  const extractedAt = file.generatedAt ?? new Date().toISOString();

  const rows = Object.entries(file.routes).map(([routeId, r]) => ({
    route_id:                          routeId,
    period_label:                      periodLabel,
    period_start:                      periodStart,
    period_end:                        periodEnd,
    service_class:                     r.service_class ?? null,
    ewt_minutes:                       Number.isFinite(r.ewt_minutes)         ? r.ewt_minutes         : null,
    swt_minutes:                       Number.isFinite(r.swt_minutes)         ? r.swt_minutes         : null,
    awt_minutes:                       Number.isFinite(r.awt_minutes)         ? r.awt_minutes         : null,
    on_time_percent:                   Number.isFinite(r.on_time_percent)     ? r.on_time_percent     : null,
    early_percent:                     Number.isFinite(r.early_percent)       ? r.early_percent       : null,
    late_percent:                      Number.isFinite(r.late_percent)        ? r.late_percent        : null,
    non_arrival_percent:               Number.isFinite(r.non_arrival_percent) ? r.non_arrival_percent : null,
    scheduled_mileage_operated_percent: Number.isFinite(r.scheduled_mileage_operated_percent)
                                          ? r.scheduled_mileage_operated_percent : null,
    source_url:                        sourceUrl,
    pdf_modified_at:                   pdfModified,
    extracted_at:                      extractedAt,
  }));
  await upsertInBatches('route_performance', rows, 'route_id,period_label');
}

// ── 3. route_vehicle_observations ───────────────────────────────────────────
// Only push observations made *this run*. fetch-route-vehicles.js stamps every
// freshly-seen registration with the current run's `generatedAt`; older
// entries carry their previous lastSeenAt and are already in the DB from
// previous weeks. Filtering by lastSeenAt === generatedAt avoids duplicate
// inserts at the application layer (the PK + ignoreDuplicates is the
// belt-and-braces second line).
async function pushObservations() {
  const path_ = path.join(DATA_DIR, 'source', 'route-vehicles.json');
  const file = readJsonOrNull(path_);
  if (!file?.routes) {
    console.log('  route_vehicle_observations: no route-vehicles.json — skipping');
    return;
  }
  const thisRun = file.generatedAt;
  if (!thisRun) {
    console.log('  route_vehicle_observations: no generatedAt — skipping');
    return;
  }
  const rows = [];
  for (const [routeId, list] of Object.entries(file.routes)) {
    for (const entry of (list ?? [])) {
      if (entry?.lastSeenAt === thisRun && entry?.reg) {
        rows.push({
          route_id:     routeId,
          registration: entry.reg,
          observed_at:  entry.lastSeenAt,
        });
      }
    }
  }
  console.log(`  route_vehicle_observations: ${rows.length} fresh observations from this run`);
  await insertInBatches('route_vehicle_observations', rows);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Pushing to Supabase at ${SUPABASE_URL}`);
  await pushVehicles();
  await pushRouteSnapshots();
  await pushObservations();
  await pushGarageSnapshots();
  await pushRoutePerformance();
  console.log('Done.');
}

main().catch(err => {
  // Soft-fail: log and exit 0 so a Supabase outage doesn't break the pipeline.
  // The static JSON files have already been written by previous steps and
  // committed by the workflow. Next Monday's run picks up where this one left
  // off — route_snapshots is keyed on (route_id, snapshot_date) so it's
  // idempotent within a week.
  console.warn(`push-to-supabase failed (soft): ${err.message}`);
  process.exit(0);
});
