# Changelog

All notable changes to **London Buses**, summarised by release.

Tags: **NEW** new feature · **FIX** bug fix · **DATA** data & coverage · **UX** user-facing improvement.

---

## v2.15.2 — Live-feed CORS fix & orphan stops

_2026-08-04_

- **FIX** Live buses actually work now — the vehicles feed was fetched from Atlas's `/api/live/vehicles` alias, which serves the data without CORS headers, so browsers silently dropped every response and the map never showed a single bus. Switched to `/api/v1/live/vehicles` (same feed, CORS-open).
- **FIX** Orphaned stops purged — TfL's `/Line/{id}/StopPoints` occasionally includes a wrong stop-area record (W13 and N55 both listed "Mulberry Circus", a Barking stop group ~9 km from either route; route 344 carried one 13.9 km off). Six such stops removed across W13, N55, 344, S1, S2 and P13, and the weekly fetch now drops any stop further than 2 km from its route's own geometry.

---

## v2.15 — Live buses & deeper Atlas data

_2026-07-31_

- **NEW** Live bus positions — selecting a route draws its buses' real-time GPS positions (BODS SIRI-VM via the Atlas live feed, ~10 s fresh) as solid direction-coloured dots, the visual inverse of the white stop rings. Updates every 15 s while the route stays focused; click a bus for its registration and destination. Single-route view only — comparison mode stays clean.
- **NEW** The route card's status chip is now genuinely live — it reads Atlas's live per-route status feed (seconds fresh) instead of the warehouse's daily 03:20 snapshot, falling back to the snapshot (and saying so in the tooltip) when the live feed is down.
- **NEW** Headway row — "every ~12 min" from TfL's timetable via the Atlas history API, alongside the coarse H/L frequency band.
- **NEW** Daily reliability chart — the last ≤30 days of Atlas's own EWT / on-time estimates from live arrivals sampling, as a bar strip matching the crowding chart's grammar. Indicative (not TfL-published); the current partial day is excluded.
- **NEW** Average wait row — actual vs scheduled wait (AWT/SWT, whose difference is the EWT) for high-frequency routes, and a Contract end row (Atlas route-meta, where published).
- **UX** The load-along-the-route chart now says which direction it depicts ("· inbound").
- **UX** "Live buses" pill in the map controls (next to Stops) — appears while a single route is focused, ON by default, pauses/resumes the GPS poll. Hidden in comparison mode, which never tracks.

---

## v2.14 — Atlas API-first data layer

_2026-07-27_

- **DATA** Classifications now also overlay the Atlas API's `/route-meta` (daily londonbusroutes.net re-parse: garage code + name and PVR take the API value; operator, vehicle model, propulsion fill bundled blanks only, because the build normalises those vocabularies) and `/fleet` (today's DVLA-enriched arrivals sample fills make / age / size / composition / propulsion for routes the accumulated weekly build has no answer for, marked `fleetConfidence: low`).
- **NEW** Load-along-the-route chart in the Crowding section — a stop-by-stop bar profile of peak-direction load ÷ capacity (colour-stepped at the BUSTO 50% busy / 80% crowded thresholds, stop name + % on hover), so you can see *where* a route fills up, not just how much. Atlas `/crowding-profile`; hidden for routes without coverage.
- **NEW** Reliability trend row on the route card — the last few published quarters of EWT (or on-time % for low-frequency routes) with an improving / steady / worsening verdict, from the Atlas history API (`/history/performance-history`). Hidden until a route has ≥2 published periods.
- **NEW** Mileage-operated row — scheduled mileage actually run last quarter vs the contractual standard (e.g. "97.8% · standard 98%"), from Atlas `/route-performance`; the weekly build never carried the actuals.
- **NEW** Route length row — one-way km from the Atlas daily route-meta parse, complementing the coarse short/medium/long band.
- **UX** Footer freshness pill now tracks all six Atlas datasets the app consumes (garages, tenders, crowding, performance, route-meta, fleet).
- **FIX** Full-dataset audit (747 routes × every field: enums, ranges, joins, cross-field coherence, cross-dataset coverage) found and fixed four defects: (1) the Atlas route-meta garage overlay could split one garage's routes across two code vocabularies — Lea Interchange (HO in the build, LI in the API) dropped from 13 routes to 1; garage fields are now gap-fill only. (2) The 2026-07-27 refresh silently lost 8 routes' stop lists (18, 177–183) to a TfL 429 burst — restored, and `fetch-route-stops.js` now keeps last-known-good for routes whose fetch fails. (3) `lengthBand` was measured from direction-1 geometry only; TfL's ZIP packs doubled traces into some entries, banding 36 routes a size too big — now the shortest direction is measured, with 10 both-directions-doubled routes pinned via `route-overrides.json` against londonbusroutes.net lengths. (4) Atlas parses blank PVRs as 0 — no longer overlaid.
- **FIX** Weekly refresh schedule restored — the workflow moved to `.github/workflows/weekly-refresh.yml` because the old path's Actions entry was manually disabled on 2026-07-04 during the Supabase decommission and GitHub pins the disabled state to the file path. Four missed weeks (06–27 July) are caught up by the first run.
- **NEW** Multi-route comparison colours — when 2+ routes are pinned, each gets its own line colour (a fixed 8-colour categorical palette, ordering validated for colour-vision-deficiency separation) instead of the operator/type colour, so overlapping same-operator routes stay distinguishable. The colour follows the route everywhere: map line, endpoint labels, a swatch dot on its route card, and a dot in its search pill. Assignment is sticky — removing one pill never repaints the others; a freed colour goes to the next route added. Single-route mode keeps the fixed outbound/inbound direction colours, and paint modes still only restyle the network overview.
- **NEW** Live service status on every route card — a Good Service / disruption chip under the route header, with TfL's diversion/closure reason underneath (clamped; full text on hover) — from the Atlas API `line-status` snapshot (~5 min fresh). The Overview panel gets a matching network line ("634 of 676 routes on good service · 42 disrupted"). Hidden for routes the feed doesn't cover (school routes) and whenever the API is unreachable.
- **NEW** Crowding section on the route card — peak load ÷ capacity with its comfort band ("Busy · 76% of capacity"), the busiest stop / day / time, and per-day-type peaks (Mon–Fri / Sat / Sun) — from the Atlas API `crowding` dataset (TfL BUSTO, ~606 routes). Rows hide when a route has no BUSTO coverage.
- **NEW** Garage drawer subtitle shows the legal operating company (e.g. "London General Transport Services Ltd") on hover — an Atlas API field the local pipeline never carried.
- **UX** Footer freshness now mirrors the Atlas warehouse: "Refreshed" is the newest of the site build and the Atlas datasets the app consumes (garages, tenders, crowding), "Next" is the next Atlas daily pipeline run (~03:17 UTC), and hovering the pill breaks the sources down per dataset. Falls back to the site-build date + weekly Monday schedule when the API is unreachable.
- **DATA** Frontend data layer is now API-first against the **Atlas public API** (`atlas.farhan.app/api/v1`). Garage locations load from `/garages` via a join-safe merge — the API refreshes name/position/PVR/capacity per garage code; the committed file keeps the street address, the operator vocabulary `route_classifications.json` joins on, and garages the API doesn't list (Lea Interchange, Therapia Lane, Hatfield). Tender-award history for the XLSX export loads from `/tenders` (2,508 awards vs the committed 2,501), adapted to the committed shape: award dates converted to ISO, `reason_not_lowest` overlaid from the committed snapshot (not exposed by the API). Every API path falls back to the committed files automatically, so the site still works fully from repo data if the API is down. Per-route geometry, classifications, stops, destinations and the overview layer stay on the committed weekly-refresh data — the API doesn't yet serve those at the fidelity the UI needs (full-res per-direction geometry, school routes, stop `indicator`/`towards`, paint-mode properties, destination labels).
- **DATA** Supabase historical store removed — history and analytics live in the **Atlas warehouse** now, served by its public API (`atlas.farhan.app/api/v1/history`). This pipeline writes to no database anymore: deleted `push-to-supabase.js`, the daily `sample-vehicles.js` sampler, `backfill-route-vehicle-sightings.js`, the sampler + heartbeat workflows, `db/migrations/`, the `@supabase/supabase-js` dependency, and the dead `tender-overrides.json` (only the Supabase push consumed it). The refresh pipeline is now 16 steps; fleet recurrence (`days`) accumulates forward in `route-vehicles.json`'s rolling 56-day window as before, just without the Supabase densifier.
- **DATA** Route reliability on the card (EWT/OTP actuals + MPS + service class) now overlays from the Atlas API `/route-performance` at load — same TfL QSI source as the committed build, but re-checked daily, so it's never staler. Committed values stand when the API is unreachable.
- Analytics page reading from the Atlas API history group (`/api/v1/history`) — charts and trends across the network (fleet-age trend, electrification, operator share, fleet capacity, operator churn).

---

## v2.13 — Garage popup parity & small UX touches

_2026-06-02_

- **NEW** Clicking a garage marker exposes the same **View all routes operated here** CTA that's been on the side drawer — same shape, same downstream behaviour. Filters the network to that garage's routes without opening the drawer.
- **NEW** Both CTAs also flash the "Operating from here" tooltip above the chosen garage marker — the same visual that fires when a single route is focused now fires for a garage. New `highlightGarageByCode(code)` helper in `js/map.js` keeps the two entry points (popup + drawer) in lockstep.
- **NEW** Colour swatches on the Route Type filter pills — only when colouring routes by type — so the legend connection between pill and line is direct. `paint-mode.js` toggles `html.paint-by-type`; CSS reveals the dots only when that class is on.
- **FIX** Route 339's tender block showed Tower Transit as the awarded operator next to Stagecoach London as the current operator — both correct historically, confusing together. Stagecoach acquired Tower Transit's Lea Interchange operations in 2024 and inherited the contract; the awarded-operator display now folds to "Stagecoach". Same handling already applied to RATP Dev → First (Feb 2025). `OPERATOR_ACQUISITION_PAIRS` in `js/route-detail.js` lists the parent links; `data/operator-aliases.json` is the canonical record.

---

## v2.12 — Tender split into three sections & sharper map

_2026-06-02_

- **NEW** Tender block on the route card splits into three sections: **Current active contract** (the originating award — the one a route is actually running on today), **Next contract — awarded** (only when a re-tender has landed for a not-yet-started contract), and **Previous operator** (the last genuine change of hands). Rows in each section follow the same order — Operator, Tranche, Awarded on, Contract start, Length, Cost/mile, Contracted miles, Awarded vehicle, Joint bid, Bids received — so the three boxes read like-for-like. Resolves the long-standing case where a route in the transition window (e.g. 100) showed "Awarded Feb 2026" next to "Contract start Sep 2019".
- **NEW** Operator pill in every tender section, with an inline `change` flag when the next-contract awarded operator differs from the current incumbent. FirstGroup / RATP Dev (Feb 2025 acquisition) treated as the same operator on the flag, so ~10 affected routes don't show a false change. Curated lookup: `data/operator-aliases.json`.
- **NEW** Hover tooltips on every route-card label expose source + freshness in a consistent `Source: X. Freshness: Y.` format.
- **UX** Map tiles serve at 2× on hi-DPI displays via `detectRetina: true` — road names and labels stay crisp at larger window sizes.
- **FIX** Deck type corrected on **141 routes** mis-labelled DD. Cause: `deriveDeck()` regex read door-count markers (`2D` = dual door) as deck markers. Curated vehicle lookup now takes precedence over the regex, so Enviro200 / BYD D8UR / Streetlite always render SD.
- **FIX** Two regressions from a refactor mishap that broke the route-card panel — restored.

---

## v2.11 — Garage filter & filtered-route list

_2026-05-22_

- **NEW** Garage filter in the sidebar — a multi-select dropdown of garages grouped by operator. Pick one or more (even across operators) to narrow the network to their routes. It's a stackable filter like the others, so it combines with Operator, Route Type, Propulsion, etc. (and matches the garage drawer's "View all routes operated here").
- **NEW** The Routes panel now lists every route matching your active filters (bus stop, operator, type, propulsion, deck, frequency) — not just coloured lines on the map. Click any route to open its full card.
- **DATA** Contract lengths corrected across 400+ routes — now read directly from a public reference (with reduction/extension notes applied) and cross-checked against a second source, replacing the old estimate-from-award-gaps heuristic (e.g. an implausible 10-year term dropped to 5). Coverage 725/747.

---

## v2.10 — Tranche on the route card

_2026-05-11_

- **NEW** Tranche reference on every route card (Tender · Current contract). Shows the tendering-programme batch a route's upcoming tender sits in (e.g. `913`). Coverage 712/747 routes. Also added to the XLSX Routes sheet.

---

## v2.9 — Data accuracy corrections

_2026-05-11_

- **FIX** Average fleet age was being skewed by reserve vehicles of the wrong drivetrain briefly covering a route — a 14-year diesel on an electric route would add a year or two. Now only vehicles matching the route's dominant propulsion count. Route 339 went from 4.8 y to 2.9 y on this fix alone.
- **FIX** Garages were duplicated by code (BN/BT/UX) and the list included out-of-London placeholder depots with no network code and zero PVR. Deduped and filtered — a cleaner 81 garages.
- **FIX** Tender records occasionally carry the full annual bid in the cost-per-mile cell (route 290 2006, route 265 2022 etc.) producing £4M/mile headlines. Cost-per-mile is now clamped to a sane range.
- **FIX** School routes default to single-deck diesel when every upstream source returned null (London school services are uniformly single-deck diesel minibuses/coaches).

---

## v2.8 — MPS standards & contract start dates

_2026-05-01_

- **NEW** Contractual EWT / OTP / Mileage standards per route, from official per-route performance reports. A new "MPS" KPI tile sits next to the actual EWT / OTP so contract-vs-actual reads at a glance.
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
- **DATA** ~2,500 historical tender awards (back to 2003) and 10 years of upcoming-tender programme data refreshed weekly.

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

## v2.2 — API-first data pipeline

_2026-04-17_

- **DATA** An official transport API as the primary source for routes, destinations, timetables and stops. Fallbacks engage only when the API is sparse.
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
- **DATA** Weekly automated build pipeline; auto-deploys to a static host.
- **DATA** API key moved to environment variables; modular module architecture.
