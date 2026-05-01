# Changelog

All notable changes to **London Buses**, summarised by release.

Tags: **NEW** new feature · **FIX** bug fix · **DATA** pipeline / data source change · **UX** user-facing improvement.

---

## Upcoming

- Analytics page reading from the Supabase historical store (fleet-age trend, electrification, operator share, EWT/OTP movement around tender events, operator churn).

---

## v2.9 — Contract start dates & cost-per-mile fix

_2026-05-01_

- **NEW** Contract start date on the route card (~700 / 747 routes covered). Sourced from londonbusroutes.net `details.htm`, with the LBSL programme PDFs as backup.
- **FIX** Cost-per-mile parser misread European decimal commas (`6,25` was becoming `625`). 3 historical awards corrected.
- **UX** Joint bid row now always shows Yes / No (was hidden when "No").

---

## v2.8 — Per-route Minimum Performance Standards

_2026-05-01_

- **NEW** Contractual EWT / OTP / Mileage standards per route, scraped from TfL's per-route QSI PDFs. EWT MPS observed range 0.7–1.4 min; OTP MPS 74–90 %.
- **NEW** "MPS" KPI tile sits next to the actual EWT / OTP so contract-vs-actual reads at a glance.
- **DATA** New `fetch-route-mps.js` step in the weekly pipeline (now 16 steps).

---

## v2.7 — Tender data on every route card

_2026-04-30_

- **NEW** Tender history surfaces on every route card: previous operator, awarded vehicle, cost per mile, contract length, total awards, bids received, joint bid flag.
- **NEW** Card restructured into Route / Fleet / Tender · Current / Tender · Previous sections.
- **DATA** ~2,500 historical tender awards (back to 2003) and 10 years of upcoming-tender programme PDFs scraped weekly. Tender-history operator names now roll up to the parent group (Docklands → Go-Ahead, Selkent → Stagecoach, etc.).
- **PERF** Three pipeline short-circuits (`HEAD`-first checks for the geometry ZIP, the QSI PDF, and the programme PDFs) cut weekly runtime by ~70 % when upstream data hasn't moved.

---

## v2.6 — Frequency rules & propulsion fix

_2026-04-28_

- **NEW** Frequency band collapsed to binary: H = 5+ buses/hour, L = fewer.
- **FIX** 11 routes (D7, D8, 58, 187, 228, 251, 276, 314, 316, 384, 487) corrected from "diesel" to "electric" — `BZL` fleet code wasn't in the EV regex.
- **DATA** Tier-3 frequency fallback reads headways straight from `details.htm` when both TfL Timetable API and the per-route HTML grid yield null.

---

## v2.5 — Network Overview & operator / garage drawers

_2026-04-24_

- **NEW** Network Overview panel — KPI tiles (Routes / Operators / Garages / PVR), clickable per-operator table, PVR-weighted Fleet Mix.
- **NEW** Operator drawer (Routes operated · Garages · PVR · % of network) and Garage drawer (Routes · PVR · % of network) with a "View all routes" CTA.
- **NEW** Global Clear-all button resets every filter, marker and search in one click.
- **NEW** XLSX export gains a Fleet Mix block in the Network overview sheet.
- **NEW** Direction toggle on single-route cards (outbound ⇄ inbound).

---

## v2.4 — Stops baked in, bus-stop filter

_2026-04-23_

- **NEW** Bus-stop filter — search any stop and filter the network to routes serving it.
- **DATA** Stops now baked weekly into `stops.json` + `route_stops.json` (no runtime TfL API calls for stop data).

---

## v2.3 — Night-route frequencies & pipeline slimming

_2026-04-21_

- **FIX** All 120 night routes now resolve a frequency band. TfL encodes after-midnight departures as hour ≥ 24; the previous code didn't wrap so every night journey landed at 1400+ minutes.
- **DATA** Pipeline slimmed from 11 → 8 steps; removed unused outputs (route summary CSV, PVR aggregates JSON, stops GeoJSON).
- **NEW** Garage popup gains an Electrification row (% of garage's PVR run by electric routes).

---

## v2.2 — TfL-first data pipeline

_2026-04-17_

- **DATA** TfL Unified API as primary source for routes, destinations, timetables and stops. Scrapers fall back only when the API is sparse.
- **NEW** Per-route HTML grid fallback for frequency when the API is silent.
- **FIX** Multiple correctness improvements to operator and garage attribution.

---

## v2.0 — Operator garages, split filters, multi-sheet export

_2026-04-15_

- **NEW** Operator-coloured garage markers on the map.
- **NEW** Split filter design — Routes / Garages tabs in the sidebar.
- **NEW** XLSX export with three sheets (Routes / Garages / Network overview).

---

## v1 — Foundation

_2026-04-13 → 2026-04-14_

The initial v1.0 → v1.8 series established the core map, data pipeline and route detail experience.

- **NEW** Interactive map of every London bus route (~700) with route-type colouring.
- **NEW** Route search with autocomplete; click-map identify tool to find nearby routes.
- **NEW** Route detail panel — number, endpoints, stop count, direction toggle, operator, garage, vehicle type, deck, propulsion, frequency, length.
- **NEW** Filter system (route type, operator, deck, propulsion, frequency) with live filtering.
- **NEW** Multi-route selection via pill-based input; export filtered routes to CSV.
- **NEW** Per-operator statistics panel (Routes %, PVR %, EV %).
- **NEW** Manual override system (`data/route-overrides.json`) — any field can be hand-edited and wins over scraped data.
- **DATA** Weekly automated GitHub Actions pipeline; auto-deploys to Cloudflare Pages.
- **DATA** API key moved to environment variables; modular module architecture.
