/**
 * build-api.js — Assemble the public faux-API (data/api/*.json) from the
 * repo's primary-source datasets. This is the serving contract both
 * front-ends read (same shapes the Atlas API served, so the apps and their
 * test suites carry over unchanged).
 *
 * Inputs (all committed, produced by earlier pipeline steps):
 *   data/route_classifications.json  → route-meta, routes
 *   data/garage-locations.json (+ garage-overrides.json) → garages
 *   data/source/route-vehicles.json + vehicle-fleet.json + vehicle-lookup.json
 *                                    → fleet (byRoute), vehicles (byReg)
 *   data/source/tenders.json         → tenders (byRoute, bid figures)
 *   data/routes-overview.geojson     → routes-overview (v2 property names)
 *
 * Pass-through datasets NOT rebuilt here (their own fetchers own them):
 *   route-stops.json (fetch-route-stops), line-status.json + route-diversions.json
 *   (fetch-line-status / intraday), crowding*.json (seeded; BUSTO fetcher TBD).
 *
 * Sticky merge: any field this run cannot derive falls back to the value in
 * the existing data/api file (last-known-good), so a thin upstream run never
 * blanks a served field.
 *
 * Run: node scripts/build-api.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = p => path.join(ROOT, 'data', p);
const API = p => path.join(ROOT, 'data', 'api', p);

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const tryRead = p => { try { return read(p); } catch { return null; } };
// Content-stable write: skip when only volatile timestamps differ from the
// file on disk. Without this every run rewrites generatedAt in ~4 MB of
// otherwise-identical JSON, and the twice-daily workflows would commit it
// all — pure git bloat.
const stripVolatile = obj => JSON.stringify(obj, (k, v) =>
  (k === 'generatedAt' || k === 'fetchedAt' || k === 'capturedAt') ? undefined : v);
const write = (p, obj) => {
  const prev = tryRead(p);
  if (prev && stripVolatile(prev) === stripVolatile(obj)) return;
  fs.writeFileSync(p, JSON.stringify(obj) + '\n', 'utf8');
};
const now = new Date().toISOString();
const sortKeys = obj => Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));

fs.mkdirSync(API(''), { recursive: true });

/* Canonical display names — the app-facing operator brand names. */
const BRAND_DISPLAY = {
  'Arriva': 'Arriva London', 'Arriva London': 'Arriva London',
  'First': 'First Bus London', 'First London': 'First Bus London', 'First Bus London': 'First Bus London',
  'Go-Ahead': 'Go-Ahead London', 'Go-Ahead London': 'Go-Ahead London',
  'Metroline': 'Metroline',
  'Stagecoach': 'Stagecoach London', 'Stagecoach London': 'Stagecoach London',
  'Transport UK': 'Transport UK London Bus', 'Transport UK London Bus': 'Transport UK London Bus',
  'Uno': 'Uno', 'Uno Buses': 'Uno',
};
const aliasIndex = (() => {
  const idx = new Map();
  const al = tryRead(DATA('operator-aliases.json'));
  for (const b of al?.brands ?? []) {
    idx.set(b.brand.toLowerCase(), b.brand);
    for (const a of b.aliases ?? []) idx.set(String(a).toLowerCase(), b.brand);
  }
  return idx;
})();
const displayOperator = raw => {
  if (!raw) return null;
  const brand = aliasIndex.get(String(raw).trim().toLowerCase()) ?? String(raw).trim();
  return BRAND_DISPLAY[brand] ?? brand;
};

const cls = read(DATA('route_classifications.json')).routes;
const prevMeta = tryRead(API('route-meta.json'))?.routes ?? {};

/* Active routes = what TfL currently serves (route_stops is fetched from
   TfL per live line). Classifications also carries withdrawn routes, so the
   app-facing route list and map layer filter to this set. */
const activeRoutes = new Set(Object.keys(read(DATA('route_stops.json')).routes ?? {}));

/* ── routes.json — bare array, the app's route directory ─────────────── */
{
  const routes = [...activeRoutes].sort().map(name => ({
    id: name,
    name,
    type: cls[name]?.type ?? 'regular',
  }));
  write(API('routes.json'), routes);
  console.log(`routes.json — ${routes.length} routes`);
}

/* ── route-meta.json ─────────────────────────────────────────────────── */
{
  const addYears = (iso, years) => {
    if (!iso || !Number.isFinite(years)) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    d.setFullYear(d.getFullYear() + Math.floor(years));
    d.setMonth(d.getMonth() + Math.round((years % 1) * 12));
    return d.toISOString().slice(0, 10);
  };
  const routes = {};
  for (const [name, c] of Object.entries(cls)) {
    const prev = prevMeta[name] ?? {};
    const pvr = Number.isFinite(c.pvr) && c.pvr > 0 ? c.pvr : null;
    routes[name] = {
      type: c.type ?? prev.type ?? null,
      operator: displayOperator(c.operator) ?? prev.operator ?? null,
      company: prev.company ?? null,                       // sticky: company names came from LBR detail scrape
      garage: c.garageCode ?? prev.garage ?? null,
      garageName: c.garageName ?? prev.garageName ?? null,
      pvr,
      tvr: pvr != null ? Math.floor(pvr * 1.13) : null,
      fleet: c.vehicleType ?? prev.fleet ?? null,
      propulsion: c.propulsion ?? prev.propulsion ?? null,
      lengthKm: prev.lengthKm ?? null,                     // sticky until a geometry-length builder lands
      contractDate: c.currentContractAwardDate ?? prev.contractDate ?? null,
      contractStart: c.contractStartDate ?? prev.contractStart ?? null,
      contractEnd: addYears(c.contractStartDate, c.contractTermYears) ?? prev.contractEnd ?? null,
      source: 'londonbusroutes.net',
    };
  }
  write(API('route-meta.json'), { generatedAt: now, source: 'londonbusroutes.net (garages.csv + details.htm)', count: Object.keys(routes).length, routes: sortKeys(routes) });
  console.log(`route-meta.json — ${Object.keys(routes).length} routes`);
}

/* ── garages.json ────────────────────────────────────────────────────── */
{
  const locs = read(DATA('garage-locations.json')).garages;         // keyed by code
  const overrides = tryRead(DATA('garage-overrides.json'))?.garages ?? {};
  const prev = new Map((tryRead(API('garages.json'))?.garages ?? []).map(g => [g.code, g]));
  const routesByGarage = {};
  for (const [name, c] of Object.entries(cls)) {
    if (!c.garageCode) continue;
    for (const code of String(c.garageCode).split(/[^A-Za-z]+/).filter(Boolean))
      (routesByGarage[code.toUpperCase()] ??= []).push(name);
  }
  const garages = Object.entries(locs).map(([code, g]) => {
    const o = overrides[code] ?? {};
    const p = prev.get(code) ?? {};
    const postcode = o.postcode ?? (g.address?.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i)?.[0] ?? p.postcode ?? null);
    const pvr = Number.isFinite(g.pvr) && g.pvr > 0 ? g.pvr : null;
    return {
      code,
      name: g.name,
      operator: displayOperator(g.operator) ?? p.operator ?? null,
      company: p.company ?? null,                          // sticky
      postcode,
      postcodeSource: o.postcode ? 'override' : (p.postcodeSource === 'override' && postcode === p.postcode ? 'override' : 'garage'),
      lat: o.lat ?? g.lat ?? p.lat ?? null,
      lng: o.lng ?? g.lon ?? p.lng ?? null,
      pvr,
      capacity: Number.isFinite(g.capacity) && g.capacity > 0 ? g.capacity : (p.capacity ?? null),
      utilisation: null,
      routes: (routesByGarage[code] ?? p.routes ?? []).sort(),
      licence: p.licence ?? null,                          // sticky: DVSA VOL enrichment
    };
  });
  // Garages the source list has never carried (coach/school operators from the
  // licence sweep, e.g. CP, NM) survive from the previous build wholesale.
  for (const [code, p] of prev) {
    if (locs[code]) continue;
    garages.push({ ...p, routes: (routesByGarage[code] ?? p.routes ?? []).sort() });
  }
  garages.sort((a, b) => a.code.localeCompare(b.code));
  write(API('garages.json'), { generatedAt: now, source: 'londonbusroutes.net + postcodes.io + DVSA VOL (OGL)', count: garages.length, garages });
  console.log(`garages.json — ${garages.length} garages`);
}

/* ── fleet.json + vehicles.json ──────────────────────────────────────── */
{
  const rv = read(DATA('source/route-vehicles.json'));
  const vf = read(DATA('source/vehicle-fleet.json')).vehicles ?? {};
  const lookup = tryRead(DATA('vehicle-lookup.json'))?.vehicles ?? {};
  const prevReg = tryRead(API('vehicles.json'))?.byReg ?? {};
  const yearNow = new Date().getFullYear() + new Date().getMonth() / 12;

  const prevRoute = tryRead(API('fleet.json'))?.byRoute ?? {};
  const byRoute = {};
  const regRoutes = {};
  // A rolling recency window keeps "fleet" meaning the current allocation,
  // not every vehicle that has ever worked the route. If the window empties
  // a route (sweep gap), fall back to all sightings rather than blanking.
  const RECENT_MS = 14 * 864e5;
  const cutoff = Date.now() - RECENT_MS;
  for (const [name, obs] of Object.entries(rv.routes ?? {})) {
    const recent = (obs ?? []).filter(o => new Date(o.lastSeenAt ?? 0).getTime() >= cutoff);
    const pool = recent.length ? recent : (obs ?? []);
    const regs = [...new Set(pool.map(o => String(o.reg).toUpperCase()))].sort();
    if (!regs.length) { byRoute[name] = prevRoute[name] ?? { route: name, regs: [], count: 0 }; continue; }
    const years = regs.map(r => vf[r]?.yearOfManufacture).filter(Number.isFinite);
    const makeCount = {};
    const propulsion = { electric: 0, hydrogen: 0, hybrid: 0, diesel: 0 };
    let enriched = 0;
    for (const r of regs) {
      const v = vf[r];
      if (v?.make || Number.isFinite(v?.yearOfManufacture)) enriched++;
      const mk = v?.make;
      if (mk) makeCount[mk] = (makeCount[mk] ?? 0) + 1;
      const pr = String(v?.fuelType ?? '').toLowerCase();
      if (pr in propulsion) propulsion[pr]++;
      (regRoutes[r] ??= new Set()).add(name);
    }
    byRoute[name] = {
      route: name,
      regs,
      count: regs.length,
      enriched,
      avgAgeYears: years.length ? Math.round((yearNow - years.reduce((a, b) => a + b, 0) / years.length) * 10) / 10 : null,
      propulsion,
      makes: Object.entries(makeCount).sort((a, b) => b[1] - a[1]).map(([make, n]) => ({ make, n })),
    };
  }
  // Routes the sweep has not covered yet keep their previous fleet snapshot.
  for (const [name, p] of Object.entries(prevRoute)) byRoute[name] ??= p;
  write(API('fleet.json'), { generatedAt: now, enriched: true, byRoute: sortKeys(byRoute) });

  const byReg = {};
  for (const [reg, v] of Object.entries(vf)) {
    const routes = [...(regRoutes[reg] ?? [])].sort();
    const primary = routes[0] ? cls[routes[0]] : null;
    const prev = prevReg[reg] ?? {};
    byReg[reg] = {
      reg,
      routes: routes.length ? routes : (prev.routes ?? []),
      operator: displayOperator(v.operator) ?? prev.operator ?? null,
      make: v.make ?? prev.make ?? null,
      year: v.yearOfManufacture ?? prev.year ?? null,
      fuel: v.fuelTypeRaw ?? prev.fuel ?? null,
      propulsion: v.fuelType ?? prev.propulsion ?? null,
      body: prev.body ?? null,                             // sticky: bustimes enrichment TBD
      deck: (primary && lookup[primary.vehicleType]?.deck) ?? primary?.deck ?? prev.deck ?? null,
      fleetCode: v.bonnetNo ?? prev.fleetCode ?? null,
      propulsionSource: prev.propulsionSource ?? (v.fuelType ? 'dvla' : null),
    };
  }
  write(API('vehicles.json'), { generatedAt: now, byReg: sortKeys(byReg) });
  console.log(`fleet.json — ${Object.keys(byRoute).length} routes · vehicles.json — ${Object.keys(byReg).length} regs`);
}

/* ── tenders.json ────────────────────────────────────────────────────── */
{
  const src = read(DATA('source/tenders.json')).tenders ?? {};
  const byRoute = {};
  const byId = {};
  const num = v => (Number.isFinite(v) && v > 0 ? v : null);
  for (const [btId, t] of Object.entries(src)) {
    t.bt_id = t.bt_id ?? btId;
    const jointRaw = t.joint_bids && t.joint_bids !== 'N/A' ? String(t.joint_bids) : null;
    const jointTotal = jointRaw ? Number(jointRaw.match(/totalling\s*£\s*([\d,]+)/i)?.[1]?.replace(/,/g, '') ?? NaN) : NaN;
    // Partner route numbers — with the monetary clause stripped first so
    // "totalling £13,376,000" doesn't shed digit groups into the list.
    const partnerText = jointRaw ? jointRaw.replace(/totalling[^.]*\.?/i, '') : '';
    const partners = [...partnerText.matchAll(/\b([A-Z]?\d{1,3}[A-Z]?|[A-Z]\d{1,3})\b/g)].map(m => m[1]);
    const notes = String(t.notes ?? '').trim();
    const nl = notes.toLowerCase();
    const award = {
      btID: String(t.bt_id ?? t.btID ?? ''),
      route: t.route_id,
      operator: displayOperator(t.awarded_operator),
      operatorRaw: t.awarded_operator ?? null,
      awardDate: t.award_announced_date ?? null,
      numberOfTenderers: num(t.number_of_tenderers),
      acceptedBid: num(t.accepted_bid),
      lowestBid: num(t.lowest_bid),
      highestBid: num(t.highest_bid),
      costPerMile: num(t.cost_per_mile),
      contractedMilesPA: num(t.accepted_bid) && num(t.cost_per_mile)
        ? Math.round(t.accepted_bid / t.cost_per_mile) : null,
      jointBid: jointRaw,
      jb: { isJoint: !!jointRaw, partners, total: Number.isFinite(jointTotal) ? jointTotal : null, raw: jointRaw },
      notes: notes || null,
      vehicle: notes ? {
        basis: nl.includes('existing') ? 'existing' : (nl.includes('new') ? 'new' : null),
        propulsion: ['electric', 'hydrogen', 'hybrid', 'diesel'].find(p => nl.includes(p)) ?? null,
        deck: nl.includes('double') ? 'double' : (nl.includes('single') ? 'single' : null),
        raw: notes,
      } : null,
      tranche: null,
    };
    byId[award.btID] = award;
    for (const name of String(t.route_id ?? '').split('/').map(s => s.trim().toUpperCase()).filter(Boolean))
      (byRoute[name] ??= []).push(award);
  }
  for (const list of Object.values(byRoute))
    list.sort((a, b) => String(b.awardDate ?? '').localeCompare(String(a.awardDate ?? '')));
  write(API('tenders.json'), {
    generatedAt: now,
    source: 'TfL tender results (13923/13796.aspx)',
    count: Object.keys(byId).length,
    byId: sortKeys(byId),
    byRoute: sortKeys(byRoute),
  });
  console.log(`tenders.json — ${Object.keys(byId).length} awards · ${Object.keys(byRoute).length} routes with award history`);
}

/* ── routes-overview.json (v2 property contract) ─────────────────────── */
{
  const gj = read(DATA('routes-overview.geojson'));
  const features = (gj.features ?? [])
    .filter(f => activeRoutes.has(f.properties.routeId ?? f.properties.name))
    .map(f => ({
      type: 'Feature',
      properties: {
        routeId: f.properties.routeId ?? f.properties.name,
        name: f.properties.routeId ?? f.properties.name,
        direction: f.properties.direction ?? null,
        routeType: f.properties.routeType ?? null,
      },
      geometry: f.geometry,
    }));
  write(API('routes-overview.json'), {
    type: 'FeatureCollection',
    metadata: {
      generatedAt: now,
      routeCount: new Set(features.map(f => f.properties.routeId)).size,
      featureCount: features.length,
      partial: false,
      simplificationTolerance: gj.metadata?.simplificationTolerance ?? null,
      coordinatePrecision: gj.metadata?.coordinatePrecision ?? null,
    },
    features,
  });
  console.log(`routes-overview.json — ${features.length} features`);

  // Per-route bounding boxes [minLng, minLat, maxLng, maxLat], padded ~500 m.
  // The live-vehicles Pages Function uses these to bound its BODS SIRI-VM
  // query — TfL's SIRI LineRef is the internal iBus number, so the function
  // filters by PublishedLineName within the route's bbox instead.
  const PAD = 0.006;
  const bboxes = {};
  for (const f of features) {
    const name = f.properties.routeId;
    const b = bboxes[name] ?? (bboxes[name] = [Infinity, Infinity, -Infinity, -Infinity]);
    const segs = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const seg of segs) for (const [lng, lat] of seg) {
      if (lng < b[0]) b[0] = lng;
      if (lat < b[1]) b[1] = lat;
      if (lng > b[2]) b[2] = lng;
      if (lat > b[3]) b[3] = lat;
    }
  }
  for (const b of Object.values(bboxes)) {
    b[0] = Math.round((b[0] - PAD) * 1e4) / 1e4;
    b[1] = Math.round((b[1] - PAD) * 1e4) / 1e4;
    b[2] = Math.round((b[2] + PAD) * 1e4) / 1e4;
    b[3] = Math.round((b[3] + PAD) * 1e4) / 1e4;
  }
  write(API('route-bboxes.json'), { generatedAt: now, routes: sortKeys(bboxes) });
  console.log(`route-bboxes.json — ${Object.keys(bboxes).length} routes`);
}

/* ── manifest.json ───────────────────────────────────────────────────── */
{
  const DATASET_META = {
    'routes':           { source: 'TfL Unified API · /Line/Mode/bus + /Route/Sequence', cadence: 'daily' },
    'route-stops':      { source: 'TfL Unified API · /Line/{id}/Route/Sequence', cadence: 'daily' },
    'routes-overview':  { source: 'TfL Unified API · route geometry (simplified)', cadence: 'daily' },
    'route-bboxes':     { source: 'derived from route geometry', cadence: 'daily' },
    'route-meta':       { source: 'londonbusroutes.net (garages.csv + details.htm)', cadence: 'daily' },
    'garages':          { source: 'londonbusroutes.net + postcodes.io + DVSA VOL (OGL)', cadence: 'daily' },
    'fleet':            { source: 'TfL arrivals sweep + DVLA VES', cadence: 'twice daily' },
    'vehicles':         { source: 'TfL arrivals sweep + DVLA VES', cadence: 'twice daily' },
    'tenders':          { source: 'TfL tender results (13923/13796.aspx)', cadence: 'twice daily (after ~1pm/3pm publishes)' },
    'line-status':      { source: 'TfL Unified API · /Line/{ids}/Status', cadence: 'several times daily' },
    'route-diversions': { source: 'TfL Unified API · /Line/{ids}/Status (disruptions)', cadence: 'several times daily' },
    'crowding':         { source: 'seeded snapshot (TfL BUSTO)', cadence: 'static' },
    'crowding-profile': { source: 'seeded snapshot (TfL BUSTO)', cadence: 'static' },
    'bridges':          { source: 'seeded snapshot (TfL/London Datastore EPOWR height restrictions + OSM cross-check)', cadence: 'static' },
    'accidents':        { source: 'seeded snapshot (DfT STATS19, bus/coach-involved, 2021–2025)', cadence: 'static' },
  };
  const rowsOf = j => {
    for (const k of ['routes', 'byRoute', 'byReg', 'garages', 'features', 'rows', 'stops']) {
      const v = j?.[k];
      if (Array.isArray(v)) return v.length;
      if (v && typeof v === 'object') return Object.keys(v).length;
    }
    return Array.isArray(j) ? j.length : (Number.isFinite(j?.count) ? j.count : null);
  };
  const datasets = {};
  for (const f of fs.readdirSync(API('')).filter(f => f.endsWith('.json') && f !== 'manifest.json')) {
    const key = f.replace('.json', '');
    const j = tryRead(API(f));
    datasets[key] = {
      source: DATASET_META[key]?.source ?? null,
      fetchedAt: j?.generatedAt ?? j?.metadata?.generatedAt ?? j?.capturedAt ?? new Date(fs.statSync(API(f)).mtime).toISOString(),
      status: 'ok',
      rows: rowsOf(j),
      files: [`data/api/${f}`],
      cadence: DATASET_META[key]?.cadence ?? null,
    };
  }
  write(API('manifest.json'), { generatedAt: now, datasets: sortKeys(datasets) });
  console.log(`manifest.json — ${Object.keys(datasets).length} datasets`);
}

console.log('build-api complete');
