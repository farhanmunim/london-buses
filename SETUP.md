# Setting up London Buses from scratch

The checklist for standing the project up in a new repository, on a new host, under a new domain. Everything below is in the order it needs doing. Nothing here is magic: a public GitHub repository runs the data pipeline on a schedule, Git is the database, and a host serves the files plus two small `/api` endpoints.

How the pieces fit together is explained in `docs.html` (sections 9–12); per-field data notes are in `data.md`.

---

## 1. The repository

1. **Create a new, empty, public repository** on GitHub. Public matters: scheduled workflows get unlimited Actions minutes on public repositories, and the nightly pipeline alone uses 15–20 hours a month.
2. **Push a clean snapshot, not the old history.** The old history carries years of automated data commits (the pack is ~80 MB) and author details that need not travel. From a checkout of the old `main`:
   ```bash
   git checkout --orphan fresh && git add -A && git commit -m "London Buses"
   git remote set-url origin git@github.com:<owner>/<repo>.git
   git push -u origin fresh:main
   ```
   The default branch must be `main`: every workflow pushes to it, and the `workflow_run` cross-trigger only fires on the default branch.
3. **Do not create** `streetworks-inbox` or `streetworks-archive` by hand. The street-works receiver creates the first on its first delivery; the status workflow's drain step creates the second. Both are managed by code only.
4. **Enable Actions** (Settings → Actions → General → "Allow all actions"). The workflows declare `permissions: contents: write` themselves, so the repository-level "Workflow permissions" setting can stay at its default.
5. **Add the Actions secrets** (Settings → Secrets and variables → Actions):

   | Secret | Used by | Where to get it |
   |---|---|---|
   | `BUS_API_KEY` | every TfL fetch (nightly, status, fleet) | api-portal.tfl.gov.uk — free; create an app, copy its key |
   | `DVLA_API_KEY` | `fetch-vehicle-fleet.js` (nightly, fleet) | developer-portal.driver-vehicle-licensing.api.gov.uk — Vehicle Enquiry Service, free tier |
   | `DTRO_CLIENT_ID`, `DTRO_API_KEY`, `DTRO_CLIENT_SECRET` | `fetch-dtro.js` (status) — *optional* | d-tro.dft.gov.uk — register, create an application, copy the id and key/secret pair. Without them the step logs a skip and the rest of the run is unaffected. |

   `GITHUB_TOKEN` is provided by Actions automatically; nothing to add.
6. **Run the nightly workflow once by hand** (Actions → "Nightly Data Refresh" → Run workflow) and watch it finish green. It proves the keys, commits a `data: nightly refresh …` commit and, through the `workflow_run` trigger, kicks the tender sweep. The four schedules then run on their own:

   | Workflow | Schedule (UTC) | What it refreshes |
   |---|---|---|
   | `weekly-refresh.yml` (named "Nightly Data Refresh") | daily 03:17 | the full pipeline and the audit gate |
   | `refresh-status.yml` | every 2 h, 07:41–21:41 | service status, diversions + history, TIMS roadworks, the street-works drain, D-TRO orders |
   | `refresh-fleet.yml` | 07:20 / 15:20 / 23:20 | arrivals sweep + DVLA fleet records |
   | `refresh-tenders.yml` | hourly 07:20–20:20, plus after every status/fleet run | tender awards and the programme |

   The workflow *names* ("Intraday Status Refresh", "Intraday Fleet Sweep") are referenced by `refresh-tenders.yml`'s `workflow_run` trigger — rename one and rename the reference too. GitHub disables scheduled workflows after 60 days with no repository activity; the data commits themselves keep the repository active.

## 2. Keys that live on the host, not in Actions

| Variable | Used by | Notes |
|---|---|---|
| `BODS_API_KEY` | `/api/live/vehicles` | data.bus-data.dft.gov.uk — free account, copy the API key from your profile. Never reaches the browser. |
| `GITHUB_REPO` | `/api/streetworks` | `owner/repo` of the repository above. The receiver refuses to start without it. |
| `GITHUB_TOKEN` | `/api/streetworks` | A **fine-grained** personal access token scoped to *that repository only*, permission **Contents: Read and write**, nothing else. The receiver's health check does a write self-test, so a read-only token shows as not ready. |

## 3. Hosting

The site is static files from `main`, plus two endpoints. Either host below works; the contract is the same.

**What any host must do**

- Serve the repository root as the site (`index.html`, `v3.html`, `docs.html`, `404.html`, `data/`, `archive/`), following `main`.
- Apply the headers in `_headers`: HSTS, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Cache-Control: public, max-age=0, must-revalidate` on HTML, JSON, JS and CSS. Revalidation is not optional: there are no fingerprinted filenames, so it is what keeps returning visitors on the current code.
- Send `Access-Control-Allow-Origin: *` on `/data/api/*` (the faux-API is public by design).
- Apply the 301s in `_redirects` (`/v2*` → `/`, `/changelog.html` → `/archive/v1/changelog.html`).
- Serve `/404.html` for unknown paths.
- Serve clean URLs the way Cloudflare Pages does: `/docs` ⇒ `docs.html` (and redirect `/docs.html` → `/docs`), likewise `/v3`. Do **not** add an `/docs → /docs.html` rule on a host that already does this — it loops.
- Run `/api/live/vehicles` and `/api/streetworks` from `functions/api/` with the variables in §2. Both are written for the Cloudflare Pages Functions runtime (`onRequestGet` / `onRequestPost` taking `{ request, env }`, plus `caches.default` and `env.ASSETS` in the live proxy). On any other host they need a thin adapter — the logic itself is plain `fetch` and Web Crypto.

**Option A — Cloudflare Pages (how it runs today)**

1. Pages → Create project → connect the repository. Production branch `main`, no build command, output directory `/`.
2. Settings → Environment variables (Production): `BODS_API_KEY`, `GITHUB_REPO`, `GITHUB_TOKEN` (encrypt all three).
3. Settings → Builds → exclude `streetworks-inbox` and `streetworks-archive` from preview builds, or every street-works event triggers a preview deploy.
4. Custom domain → add the domain; Cloudflare issues the certificate. `_headers`, `_redirects` and `functions/` are picked up automatically.
5. Mind the budget: the free tier allows 500 builds a month and the schedules produce ~12 data commits a day (~370 builds). Keep code pushes modest or move to a paid tier.

**Option B — your own server**

1. Clone the repository on the server and keep it current with a timer, e.g. a cron entry every 5 minutes: `cd /srv/london-buses && git pull --ff-only --quiet`. Nothing links the server to GitHub; it only reads the public repository.
2. Point nginx (or Caddy) at the checkout as the document root with the headers, CORS rule, redirects and 404 page from the contract above.
3. Run the two endpoints as a small Node service behind the web server (reverse-proxy `/api/`), with `BODS_API_KEY`, `GITHUB_REPO` and `GITHUB_TOKEN` in its environment. Replace `caches.default` with an in-memory map keyed by line and expiring after 10 s, and `env.ASSETS.fetch('/data/api/route-bboxes.json')` with a read of that file from the checkout.
4. Put TLS in front (Caddy does it automatically; nginx + certbot otherwise). HSTS is in the header set, so the site must be HTTPS before the header goes live.

## 4. Registrations that need the live URL

Do these only once the site answers on its final domain.

- **Street Manager open data (optional).** `GET https://<domain>/api/streetworks` until the JSON says `"ready": true` (it checks the token, the repository and does a write self-test). Then register that URL at manage-roadworks.service.gov.uk/open-data-onboarding. DfT's AWS SNS sends a subscription confirmation, which the receiver confirms itself; after that every London permit and activity event is committed to `streetworks-inbox` and folded into `data/api/streetworks-history.json` by the next status run. Without this registration the Street works page simply shows the archive as it was.
- **CARTO basemap key.** `index.html` (`CARTO_KEY`) and `archive/v1/js/map.js` carry a CARTO client key for the dark-theme and fallback raster tiles. It is public by design but tied to an account and its allowed domains: create your own at carto.com (free tier, 5M tiles/month), allow the new domain, and replace the value in both files. The light theme uses OpenFreeMap, which needs no key.
- **Analytics.** The pages load two trackers: Google Analytics (`G-…` in `index.html`, `docs.html`, `404.html`, `archive/v1/*`) and a self-hosted Umami script with a per-site `data-website-id`. Add the new domain to the GA property, create a new Umami site for the domain and swap the id — or remove the tags.

## 5. Domain references to update

Search for the old hostname and replace it in: `README.md` (live-site and docs links), `robots.txt` (comment and `Sitemap:` line), `sitemap.xml` (three `<loc>` entries), and the `archive/v1/` titles if you want the classic app's title to match. `functions/api/live/vehicles.js` derives its upstream User-Agent from the request host, so it needs no edit. `site-banner.js` carries the migration notice: set `ON = false` once the move is done.

## 6. Local development and tests

```bash
npm install
cp .env.example .env          # fill in the keys you have; the frontend needs none
npx serve .                   # or any static server; the app is one index.html
npm run refresh               # the full pipeline — optional, committed data already works
npm run test:fixtures         # once: downloads the pinned Leaflet/MapLibre builds the suites serve offline
node tests/verify-v3.mjs      # any suite; they expect Chromium at /opt/pw-browsers/chromium or $CHROMIUM
```

The tender fetcher falls back to a real browser when TfL's forms sit behind a Cloudflare challenge (`TENDERS_BROWSER` to point at a Chromium binary; CI runs it under `xvfb-run`). From a datacentre IP the challenge is interactive and cannot be passed, so when the award cache goes stale, run `npm run tenders-local` from a home connection and commit the result.

## 7. Launch-day checklist

- [ ] Repository public, default branch `main`, Actions enabled, five secrets added
- [ ] Nightly workflow run by hand, green, data commit landed
- [ ] Host serving `main` with headers, CORS, redirects and the 404 page
- [ ] `/api/live/vehicles?line=25` returns a vehicle list (BODS key works)
- [ ] `/api/streetworks` reports `ready: true` (token + repo), then registered with DfT
- [ ] CARTO key replaced and the new domain allowed on it
- [ ] Analytics ids re-pointed or removed
- [ ] Old hostname replaced in `README.md`, `robots.txt`, `sitemap.xml`
- [ ] `site-banner.js` switched off
- [ ] Test suites green after `npm run test:fixtures`
