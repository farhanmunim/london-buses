# Changelog

All notable changes to **London Buses** are listed here.

---

## v1.0 – Core Map & Data Foundation

_2026-04-13_

- **Initial data pipeline**: Fetches and processes route geometry, stops, and destinations
- **Map rendering**: Displays routes with polylines and stop markers
- **On-demand route loading**: Per-route GeoJSON and metadata fetched dynamically
- **Basic route search**: Load and zoom to a selected route

---

## v1.1 – UI Foundation

_2026-04-13_

- **Sidebar layout**: Persistent, collapsible sidebar with map-first layout
- **Route detail panel**: Route number, endpoints, stop count, direction toggle
- **Search autocomplete**: Prefix-based suggestions with keyboard navigation

---

## v1.2 – Map Interaction & Visual Clarity

_2026-04-13_

- **Route type colours**: Visual distinction between service types
- **Map identify tool**: Click map to discover nearby routes and trigger search

---

## v1.3 – Filters & Data Exploration

_2026-04-13_

- **Filter system**: Route type, operator, deck type, and frequency
- **Live filtering**: Results update instantly based on active filters
- **CSV export**: Export filtered routes

---

## v1.4 – Extended Route Metadata

_2026-04-13_

- **Operator and garage data**: Added to classifications and shown in route detail

---

## v1.5 – Multi-Route Support

_2026-04-13_

- **Multi-route selection**: View multiple routes simultaneously
- **Pill-based input**: Add/remove routes quickly
- **Improved map clarity**: Overlapping routes visually separated

---

## v1.6 – Refinement & Simplification

_2026-04-13_

- **Removed unsupported filters**: Operator, deck type, and frequency dropped (not available from API)
- **Improved classification display**: More accurate service badges
- **State handling fixes**: Clearing search fully resets map and UI
- **Dynamic metadata**: “Last updated” and “Next update” driven by build data

---

## v1.7 – Data Pipeline Overhaul

_2026-04-13_

- **Fully API-driven system**: Removed all third-party CSV dependencies
- **Rebuilt classification logic**: Route type from API data + route patterns; length via geometry
- **Secure API handling**: API key moved to environment variables
- **Modular architecture**: Core UI split into focused modules
- **Automated updates**: Weekly pipeline with GitHub Actions + auto-deploy
- **Snapshot versioning**: Weekly GeoJSON archives with rolling retention
- **Unified build command**: Single command to run full pipeline

---

## v1.8 – Data Accuracy, Live Stops & Manual Overrides

_2026-04-14_

- **Live stop data**: Stops now fetched from the official API at runtime — removes a large static file and ensures always-current stop information
- **Case-insensitive route lookup**: Fixes missing inbound/outbound destinations on N-prefix routes
- **Operator statistics panel**: Per-operator table (Routes %, PVR %, EV %) shown in the default sidebar state
- **Dynamic stats**: Table updates live as filters are applied
- **Unknown filter chips**: Every optional filter group (Operator, Frequency, Deck, Propulsion) gains an Unknown chip so routes missing data are never silently hidden
- **Vehicle type lookup**: Curated mapping of vehicle type → deck + propulsion fills gaps where scraper data is incomplete
- **Manual route overrides**: `data/route-overrides.json` lets any field be hand-edited and wins over scraped data
- **Letter-only route IDs**: Scraper now picks up codes like `SCS` and `RV1`
- **UI polish**: Wider sidebar, hint moved into search placeholder, filter Clear button only shown when active, consistent service badge styling
- **Removed 24 hr filter**: Underlying data field no longer provided by the API
- **Hardened CI**: Correct write permissions, current runner versions, stops endpoint fix

---
