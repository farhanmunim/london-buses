# Changelog

All notable changes to **London Buses**, summarised by release.

Tags: **NEW** new feature · **FIX** bug fix · **DATA** data & coverage · **UX** user-facing improvement.

---

## v2.22.1 — Keyless basemap

_2026-08-28_

- **FIX** Maps showed "API KEY REQUIRED" watermark tiles — CARTO began requiring an API key for its free basemap tiles. Both apps now use standard OpenStreetMap tiles (keyless); v2's dark mode renders them through an invert/hue-rotate tile filter. Attribution updated.

---

## v2.22 — Standing on its own

_2026-08-27_

The Atlas API is retired: **this repository is now the whole platform**. GitHub Actions fetches, validates and commits every dataset; the site serves them as static JSON from `data/api/`; and Cloudflare Pages hosts it all — no VPS, no warehouse, no external API.

- **NEW** An in-repo **faux-API** (`data/api/*.json`, same response shapes the Atlas API served) is rebuilt by `scripts/build-api.js` from the pipeline's primary datasets — routes, route-meta, garages, route-stops (per-direction with stop letters, from TfL's canonical Route/Sequence), fleet, vehicles, tenders (accepted/lowest/highest bids), line-status, route-diversions, routes-overview and a freshness manifest. Sticky per-field last-known-good merges mean a thin upstream run never blanks a served field.
- **NEW** **Scheduled refreshes fit each dataset's rhythm** — full pipeline nightly at 03:17 UTC (the night slot also samples the night network); service status + diversions ~6×/day; tender awards checked after TfL's ~1pm/~3pm publish windows; fleet sweeps ~midday and ~midnight. Runs that find nothing new commit nothing.
- **NEW** Live bus positions now come through this site's own `/api/live/vehicles` Cloudflare Pages Function (BODS SIRI-VM, bounded per route, 10 s edge cache); live arrivals and live route status go **straight to TfL's own API** from the browser. Live data is never stored.
- **DATA** The 24/7 fleet-tracking estimates are retired with the warehouse: the QSI reliability section, Tracked reliability card, performance trend, per-route MPS figures and vehicle sighting history are gone from both apps. Everything else — tenders, fleet, crowding (archived BUSTO snapshot), garages, diversions, live layers — carries over unchanged.
- **NEW** A migration test suite (`tests/verify-migration.mjs`) proves both apps run with **zero requests to the retired API**, and the live-resilience suite is re-pointed at the new endpoints (8/8 passing).

---

## v2.21.1 — Riding out feed outages

_2026-08-27_

- **UX** The **Roadmap** dialog is retired (footer button, modal and styles removed) as part of winding the project down — the sunset banner is the forward-looking notice now.

- **FIX** A flapping live feed no longer wipes your screen. During a TfL-proxy outage (2026-08-27: ~1-in-3 requests succeeding) the stop arrivals board showed "Live arrivals are unreachable" on nearly every refresh even though it had good data seconds earlier. Now every live surface keeps its **last-good data** — arrival times keep counting down (they're absolute timestamps), live buses hold their last positions, vehicle tracking stops claiming "the bus has left" when it's the feed that's gone — shows a quiet "reconnecting…" and retries every ~8 s. The unreachable message appears only when there's genuinely nothing to show, and route status already fell back to the daily snapshot.
- **NEW** A live-resilience test suite ships in `tests/` (feed-outage simulation, sticky-board and recovery assertions), so this behaviour stays verified.

---

## v2.21 — The tendering lens

_2026-08-18_

- **UX** On the route map the **operating garage stands apart** — larger pin with an accent ring and a stronger connector, so home vs competitor garages read at a glance.
- **UX** **Live refreshes now align with the Atlas clock** — every live poll (arrivals boards, live buses, vehicle tracking, route status) reads the feed's capture time and cache lifetime and schedules the next fetch just after Atlas's copy expires, instead of on the app's own drifting timer. Countdowns show the true seconds to fresh data, and a stale edge answer triggers a quick retry.
- **NEW** The nearest-garage analysis now lives **on the route map itself** as a "Closest garages" toggle beside Stops and Live buses — every operator's closest garage layers on as its operator-coloured pin with a dashed connector to the exact stop it was measured from, each with a tooltip ("Metroline's closest — King's Cross (KC) · 1.76 mi from Holborn Circus") and the full garage popup. All map layers are now user-controlled from one row, and the separate card + table are gone.
- **NEW** Tender awards now show the full bid picture — **accepted, lowest and highest bids** (£/yr) on both the current contract and the previous award, plus contracted miles now taken from the published figure rather than derived.
- **NEW** Map garage popups now carry the numbers — PVR, TVR, capacity, zero-emission % and routes-operated as clean label/value rows (the v1 popup structure in v2's design), every route served as tappable chips, and the detail link.
- **NEW** While comparing routes, an **"All" chip** next to Garages shows every garage in London around your focused routes (competitor scan); the focused routes' home garages stay full-size in their focus tint while the rest render smaller in operator colours. Reset clears it.
- **UX** Comparison shades now guarantee **six visibly distinct steps** per garage family — slots are placed at fixed lightness values at least 0.08 apart, with a saturation lift on the palest so the hue stays recognisable.
- **UX** The "Colour by" control hides while routes are focused — it has no effect there (comparison colours are garage-keyed), matching the legend's behaviour.
- **UX** The About footer drops the TVR formula note.

---

## v2.20 — Clearer comparisons

_2026-08-18_

- **NEW** **Stop-flag letters** — stop search results and "Near me" rows now show the stop's letter (e.g. Upton Park Station **A** / **B**) in the red roundel instead of a route count, and stop pages carry it in the header, now that the Atlas stop directory publishes letters. TfL's "→N"-style compass markers are treated as unlettered.
- **NEW** Map comparisons get **terminus markers** — a small route-number pill at each end of every focused line, so where a route starts and finishes reads instantly.
- **UX** Same-family focus colours now use **distinct shades** — the operating garage keeps its base colour (and its pin wears it), while each of its routes takes a different lightness of that hue, so two routes from one garage stay tellable apart.
- **NEW** **Deck type** on route pages — Single/Double deck (or the mixed split) derived from the observed vehicles, as a headline tile and a Fleet-card line.
- **UX** KPI colour language: clearly-good values read green, clearly-bad red, plain statements stay standard — applied to the tracked-reliability card (EWT, on-time departures, confidence grade).
- **UX** Long registration lists collapse to a "+n more" button that reveals the rest in place.
- **FIX** Dark-mode contrast: active nav/filter pills no longer render white-on-white (the bug class behind "Map" disappearing in the top bar), and a programmatic contrast audit of every page in both themes now passes — the light theme's muted labels were darkened to clear 3:1.

---

## v2.19 — Dark mode

_2026-08-17_

- **NEW** v2 gains **dark mode** — follows your system preference automatically, with a sun/moon toggle in the top bar that remembers your choice. The whole app re-themes, including the maps: CARTO's dark basemap with matching labels-only tiles above the route lines, dark popups and tooltips, and theme-aware stop markers.
- **FIX** **Transport UK is not part of RATP** — the operator now displays as "Transport UK London Bus" everywhere (route pages, operator pages, tender history, filters, legend); the "(RATP)" suffix in the Atlas data is normalised out at the data edge until the upstream name is corrected.
- **NEW** Stop pages show the **stop-flag letter** (e.g. Upton Park Station "A") in the header roundel, sourced from TfL Countdown's platform field — the stop directory itself doesn't carry letters yet.

---

## v2.18.1 — Map page polish

_2026-08-16_

- **UX** Garage pins on v2's Map page now follow what you're looking at — focused routes show their garages, active filters show only garages still operating a visible route, and with nothing active every garage shows. Garages are **on by default**, and while comparing routes each garage pin is **tinted the same colour as its route's line** (splitting diagonally when one garage runs two focused routes), so "operated from here" reads at a glance.
- **UX** Map search accepts **comma-separated lists** — type or paste "150,175" and each route is added as it completes; tokens that match nothing stay in the box.
- **UX** Comparison colours are keyed by **operating garage**, not per route — routes sharing a garage share one colour (and a solid pin), and each new garage takes the next palette slot, so colour = "operated from here".
- **DATA** Focused-route garage pins now trust route-meta's authoritative garage allocation, falling back to the garage's own route list only when meta has none — the garage lists can carry stale claims (Lea Interchange's list wrongly includes route 86; observed vehicle assignments confirm 86 runs from Romford (NS) only).
- **UX** The Map page gains a **colour key** — a legend under the Colour by control listing every operator (or route type) with its line colour; it steps aside while routes are focused, where the colours belong to the route cards.
- **FIX** Faded background routes are fully inert while routes are focused — no pointer cursor, and clicking them no longer silently adds a route.
- **UX** The "Colour by" control sits on its own aligned row; **Stops** moves to the end of the nav; the experimental tracked-reliability note no longer crowds the bottom of its card.
- **UX** The "© OpenStreetMap © CARTO · Powered by TfL Open Data" strip is gone from every map corner (v1 and v2) — the credits live in the About / info area.
- **FIX** Honest error states, from a full audit of every v2 view: with the Atlas API unreachable, a route page no longer claims the route "isn't in the current TfL network" and the Operators page no longer renders a heading over nothing — both now say the API is unreachable; an unknown stop id says the stop isn't in the directory instead of rendering a ghost live-arrivals board; and a stop whose live feed is down says so instead of "no buses predicted".

---

## v2.18 — Readable maps everywhere

_2026-08-16_

- **UX** Place and road names now sit **above** the route lines on every map — the basemap is drawn without labels and CARTO's matching labels-only tiles render in their own layer over the lines. One set of names, never doubled, no longer buried under thick polylines. Applies to the main app and every v2 map view.
- **UX** v2's Map page redesigned around one floating panel: a real search **typeahead** (suggestions with operator and type — typing "25" no longer grabs routes 2 and 5), multi-route focus with colour-keyed cards, grouped multi-select filters that expand in place, and a hover that stays quiet on faded routes — while routes are focused, only they answer with a tooltip, and filtered-out routes leave the map entirely.
- **UX** All v2 mini maps are now built by one shared constructor — same tiles, same single-line attribution, same behaviour — and every map that can show a garage shows the two-line operator/code pin. Where Atlas can't place a garage (its record only carries the operating company's registered-office postcode, or the route has no garage link yet), the map says so in a note instead of pinning the wrong spot or leaving a silent gap.
- **UX** v2 now lands on the **Map** page on desktop screens (and Map leads the desktop nav); phones land on Routes as before. An explicit Routes visit is respected either way.
- **NEW** Route pages gain a **Tracked reliability** card — Atlas's own EWT/OTD v2 estimate from continuously tracking every bus via BODS (observed vs scheduled waits, on-time departures with the full outcome breakdown, and the measured day with its confidence grade). Clearly badged **experimental** and not comparable to the TfL QSI figures above it; rebuilt daily.
- **FIX** v2 operator colours — "First Bus London" and "Transport UK London Bus (RATP)" rendered fallback grey because Atlas rewords operator names; both now resolve to their brand colours and correct initials (FRG, TUK), and future rewordings degrade to a prefix match instead of grey.
- **NEW** Garage pages show a **zero-emission KPI** — the share of the garage's routes running electric or hydrogen.

---

## v2.17 — Cleaner defaults & comparison colours

_2026-08-13_

- **NEW** v2 gains a **Map tab** — the whole network on one interactive map: every route coloured by operator or type (toggle), the same type/propulsion/operator filters as the Routes list with a live shown-count, an optional garages overlay, and tap-or-search to focus any route (the rest fade) with an info card linking into its page. Full-bleed on desktop, fully usable on mobile.
- **NEW** London Buses **v2 (beta)** at [/v2](https://london-buses.farhan.app/v2/) — a new mobile-first companion app: search and filter every route (type, operator, propulsion), and explore route, operator and garage detail pages. Minimal light UI, every number served live by the Atlas API (route facts incl. PVR/TVR, live status with the multi-notice selection logic, QSI reliability vs standards with trend, BUSTO crowding with load profile, fleet sample, contract & tendering, per-route map with direction toggle and opt-in live buses, operator aggregates, garage utilisation). Ships as a single HTML file, immune by construction to the edge-cache mixed-asset failures that have bitten the main app.
- **UX** Focusing a route now shows a clean line by default — the full stop list and live-bus tracking start OFF per focus (the pills opt in), with only the start and finish stops kept visible as slightly larger rings.
- **UX** Multi-route comparison gets a designed palette — eight deep, high-contrast hues in the app's own colour language (blue, burnt orange, aqua, violet, mustard, pink, green, plum), in a fixed order validated for colour-vision-deficiency separation and contrast against the basemap. Colours stay sticky per route while selected.
- **UX** Garage pins now carry three-letter operator initials — SCL Stagecoach, ARL Arriva, GAL Go-Ahead, TUK Transport UK, FRG First, MLN Metroline, UNO Uno, FAL Falcon.
- **UX** The floating "Operating from here" label is gone — the operating garage's pin itself now lights up with an accent ring and glow when its route is focused (the wording remains as a hover tooltip).
- **NEW** TVR joins PVR on the route card, in the garage popup and in the XLSX export — Total Vehicle Requirement, the peak requirement plus spares allowance (PVR × 1.13, rounded down).

---

## v2.16 — Diversions drawn on the map

_2026-08-07_

- **UX** Stops a diversion skips are now marked, matching the treatment on [atlas.farhan.app](https://atlas.farhan.app) — dark red-ringed "switched-off" markers with a "not served · diversion" hover, from three tiers: the Atlas diff's structured missed-stops when present, stop names matched out of TfL's prose ("missing stops X, Y and Z" / "from X to Y" ranges), and a geometric fallback (any of the route's own stops >150 m off the drawn line while a diversion is active). A stop can no longer float unexplained.
- **DATA** Orphan stops eliminated network-wide — the stop lists came from TfL's `/Line/{id}/StopPoints`, a loose association list that includes diversion-path stops and stale associations the route doesn't actually serve (31,128 such entries across 641 routes; route 175 alone carried 52, drawn as floating rings around Romford). Every route's stops are now constrained to the Atlas API's `/route-stops` canonical set (built from the served sequence, diversion-frozen, validated) — all 642 routes now match it exactly, and the weekly refresh applies the same constraint from now on.
- **DATA** Diverted routes keep their real shape — iBus schedule drops absorb diversion re-routings (sometimes weeks early), so the weekly geometry refresh was silently redrawing diverted routes along their temporary path (175 lost its Dagenham loop; 10 routes affected). Geometry for routes on an active or imminent diversion is now held at last-good, mirroring Atlas's canonical-baseline freeze, and the 10 absorbed routes were restored to canonical. Self-heals when each episode ends.
- **UX** The "Live buses" pill now shows a spinner while the first GPS fetch of a focus is in flight — pressing it (or focusing a route) previously gave no feedback until the buses appeared. When the feed answers with nothing, a transient note under the pills says so: "No buses tracked on this route right now" (feed fine, nothing out — common outside a night/school route's hours) vs "Live bus feed unavailable" (feed unreachable). The recurring 15 s refreshes stay silent.
- **FIX** Route cards no longer show another route's disruption notice — TfL files one notice onto several lines' status feeds (and sometimes misfiles one outright: a 379 diversion was published on line 376's feed), and the card blindly showed whichever notice TfL listed first. The status is now chosen properly: only notices whose validity window covers right now count (TfL's `isNow` flag is unreliable), the worst active one wins, and among equals the one whose text actually names the route is preferred. Fixed 4 routes network-wide at time of shipping (4, 138, 162, 376).
- **UX** Data-source labels aligned with the official [Atlas API reference](https://atlas.farhan.app/docs/) — daily-refreshed fields (PVR, length, headway, garage PVR & capacity) now say "refreshed daily, via the Atlas API"; EWT/OTP figures are attributed to TfL's QSI reports and the MPS standards to TfL's per-route MPS reports (not tender records); the daily reliability chart is labelled experimental and not comparable to TfL's QSI; contract end is marked as curated flagship-route data; and the About dialog gains a data-sources & attribution section (Powered by TfL Open Data · DfT BODS · DVLA · londonbusroutes.net · OpenStreetMap).
- **UX** Live bus chevrons now contrast both direction lines — orange (outbound) and cyan (inbound), a pair deliberately off the route-line palette: line-blue inbound wedges vanished into the blue inbound line. Warm/cool keeps the direction semantics and orange/cyan survives red-green colour-vision deficiency.
- **NEW** Active diversions render on the map — when TfL has the focused route on diversion and the Atlas pipeline has derived the diverted path, it draws as a **dashed line** in the direction colour with a "Diversion · until \<date\>" label, and the bypassed stretch of the official route gets a white-striped "not served" treatment. Street-accurate geometry (recovered by diffing TfL's redrawn route against the frozen pre-diversion baseline), per direction, refreshed daily; routes whose diversion geometry isn't derived yet simply show the status chip as before. Atlas `/route-diversions`.

---

## v2.15.8 — Who's out on the route

_2026-08-04_

- **NEW** "Out now" on the route card — how many buses are tracked on the route right now, plus every registration in a monospace list (live BODS snapshot at card open; the map layer keeps its own 15 s poll).
- **UX** Outbound live buses are orange (orange-500) instead of red — red wedges disappeared into the red route line; orange separates cleanly while inbound keeps the canonical blue. Wedges nudged slightly larger with a stronger shadow.
- **NEW** Clicking a live bus now shows its vehicle record: registration, destination, make, year and age, propulsion, and fleet number — merged from the weekly DVLA fleet cache (~9,500 registrations) overlaid with Atlas's fresher per-reg sample.

---

## v2.15.2 — Live-feed CORS fix & orphan stops

_2026-08-04_

- **FIX** Live buses actually work now — the vehicles feed was fetched from Atlas's `/api/live/vehicles` alias, which serves the data without CORS headers, so browsers silently dropped every response and the map never showed a single bus. Switched to `/api/v1/live/vehicles` (same feed, CORS-open).
- **UX** Live buses are bearing-rotated chevrons — the same wedge marker grammar as the Atlas site — pointing where the bus is actually heading, filled with the canonical direction colours (red outbound / blue inbound, matching the route line), with a white halo and soft shadow separating them from stops and line. Dot fallback for buses reporting no bearing. The stray hardcoded crowded-bar red also moved onto a proper `--red` theme token.
- **FIX** Live bus dots now draw above the route line and stop rings — they rendered underneath because they landed on the map's default canvas (created at init, so lowest in the stack); they get a dedicated pane between the overlays and the garage markers.
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
