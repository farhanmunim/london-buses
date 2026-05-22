# Changelog

All notable changes to **London Buses**, summarised by release.

Tags: **NEW** new feature · **FIX** bug fix · **DATA** pipeline / data source change · **UX** user-facing improvement.

---

## Upcoming

- Analytics page reading from the Supabase historical store — charts and trends across the network (fleet-age trend, electrification, operator share, fleet capacity, operator churn).
- **30 Oct 2026 — Supabase Data API grant change.** Supabase is removing the implicit Data API grant on `public`-schema tables. All existing tables in this project keep their grants. Any new table or view added on or after that date must include explicit `GRANT` statements + RLS — `db/migrations/_template.sql` is the new starting point. See `agent.md` for the procedure.

---

## v2.11 — Garage filter & filtered-route list

_2026-05-22_

- **NEW** Garage filter in the sidebar — pick any garage (grouped by operator) to show just the routes it operates on the map and Routes tab. The same result as a garage's "View all routes operated here", now one step away in the filter panel.
- **NEW** The Routes panel now lists every route matching your active filters (bus stop, operator, type, propulsion, deck, frequency) — not just coloured lines on the map. Click any route to open its full card.

---

## v2.10 — Tranche on the route card

_2026-05-11_

- **NEW** Tranche reference on every route card (Tender · Current contract). Shows the LBSL programme batch a route's upcoming tender sits in (e.g. `913`). Coverage 712/747 routes. Also added to the XLSX Routes sheet.

---

## v2.9 — Data accuracy corrections

_2026-05-11_

- **FIX** Average fleet age was being skewed by reserve vehicles of the wrong drivetrain briefly covering a route — a 14-year diesel on an electric route would add a year or two. Now only vehicles matching the route's dominant propulsion count. Route 339 went from 4.8 y to 2.9 y on this fix alone.
- **FIX** Garages were duplicated by code (BN/BT/UX) and the list included out-of-London placeholder depots with no TfL code and zero PVR. Deduped and filtered — a cleaner 81 garages.
- **FIX** TfL tender form occasionally pastes the full annual bid into the cost-per-mile cell (route 290 2006, route 265 2022 etc.) producing £4M/mile headlines. Cost-per-mile is now clamped to a sane range.
- **FIX** School routes default to single-deck diesel when every upstream source returned null (London school services are uniformly single-deck diesel minibuses/coaches).

---

## v2.8 — MPS standards & contract start dates

_2026-05-01_

- **NEW** Contractual EWT / OTP / Mileage standards per route, from TfL's per-route QSI PDFs. A new "MPS" KPI tile sits next to the actual EWT / OTP so contract-vs-actual reads at a glance.
- **NEW** Contract start date on the route card (~700 / 747 routes covered).
- **NEW** Combined Tenders sheet in the XLSX export — historical awards (~2,500 since 2003) + upcoming programme entries in one stream. Rows filter to the search-pinned routes when set.
- **NEW** Search pills in the topbar now drive the export — typing `25, 30, 100` and pressing Export emits a workbook restricted to those routes (every sheet follows the same selection).
- **UX** Joint bid row now always shows Yes / No (was previously hidden when "No"). Tender section restructured into Current / Previous; tooltips rolled out across every route-card label.
- **FIX** Cost-per-mile reader was misreading European decimal commas (`6,25` was becoming `625`). 3 historical awards corrected.
- **FIX** A few operators rendered grey on the stats panels instead of their brand colour. Now consistent everywhere.
- **FIX** Stops toggle button no longer lingers after clearing the route search.

---

## v2.7 — Tender data on every route card

_2026-04-30_

- **NEW** Tender history surfaces on every route card: previous operator, awarded vehicle, cost per mile, contract length, total awards, bids received, joint bid flag.
- **NEW** Card restructured into Route / Fleet / Tender · Current / Tender · Previous sections.
- **DATA** ~2,500 historical tender awards (back to 2003) and 10 years of upcoming-tender programme PDFs refreshed weekly.

---

## v2.6 — Frequency rules & propulsion fix

_2026-04-28_

- **NEW** Frequency band collapsed to binary: H = 5+ buses/hour, L = fewer.
- **FIX** 11 routes (D7, D8, 58, 187, 228, 251, 276, 314, 316, 384, 487) corrected from "diesel" to "electric".

---

## v2.5 — Network Overview & operator / garage drawers

_2026-04-24_

- **NEW** Network Overview panel — KPI tiles (Routes / Operators / Garages / PVR), clickable per-operator table, PVR-weighted Fleet Mix.
- **NEW** Operator drawer (Routes operated · Garages · PVR · % of network) and Garage drawer (Routes · PVR · % of network) with a "View all routes" CTA.
- **NEW** Global Clear-all button resets every filter, marker and search in one click.
- **NEW** XLSX export gains a Fleet Mix block in the Network overview sheet.
- **NEW** Direction toggle on single-route cards (outbound ⇄ inbound).

---

## v2.4 — Bus-stop filter

_2026-04-23_

- **NEW** Bus-stop filter — search any stop and filter the network to routes serving it.

---

## v2.3 — Night-route frequencies & garage electrification

_2026-04-21_

- **FIX** All 120 night routes now resolve a frequency band (after-midnight departures were previously mis-bucketed).
- **NEW** Garage popup gains an Electrification row (% of garage's PVR run by electric routes).

---

## v2.2 — TfL-first data pipeline

_2026-04-17_

- **DATA** TfL Unified API as primary source for routes, destinations, timetables and stops. Fallbacks engage only when the API is sparse.
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
- **NEW** Manual override system (`data/route-overrides.json`) — any field can be hand-edited and wins over data.
- **DATA** Weekly automated GitHub Actions pipeline; auto-deploys to Cloudflare Pages.
- **DATA** API key moved to environment variables; modular module architecture.
