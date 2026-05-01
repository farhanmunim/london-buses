/**
 * about.js — About modal, injected on load so any page with an #about-btn
 * (topbar, footer, mobile-nav) opens the same dialog. Included by index.html
 * and changelog.html.
 */

(function () {
  const MODAL_HTML = `
    <div id="about-modal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div class="modal-backdrop" data-close></div>
      <div class="modal-panel">
        <button class="modal-close" aria-label="Close" data-close>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>

        <div class="modal-header">
          <div class="modal-brand" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.8" fill="none"/>
              <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="modal-heading">
            <h2 id="about-title" class="modal-title">London Buses</h2>
            <span class="modal-subtitle">Every route on one map</span>
          </div>
        </div>

        <p class="modal-lede">An interactive map of every London bus route — search, filter by operator, propulsion, deck type, and more. <strong>Not a journey planner</strong> — for live times and travel advice, use <a href="https://tfl.gov.uk/plan-a-journey/" target="_blank" rel="noopener">tfl.gov.uk</a>.</p>

        <div class="modal-disclaimer" role="note">
          <strong>Disclaimer.</strong> This site is an independent project and is <strong>not affiliated with, endorsed by, or operated by Transport for London (TfL), London Buses, or any bus operator</strong>. Data is compiled from public sources and may be incomplete, out of date, or inaccurate. You are responsible for verifying anything before acting on it; I take no responsibility for how this information is used.
        </div>

        <section class="modal-section">
          <span class="modal-section-tag">Data sources</span>
          <ul class="credits-list">
            <li><a href="https://api.tfl.gov.uk" target="_blank" rel="noopener">TfL Unified API</a><span class="credits-note">route list · destinations · bus stops · named bus/coach stations · timetable headways — Powered by TfL Open Data; contains OS data © Crown copyright &amp; database rights 2016</span></li>
            <li><a href="https://bus.data.tfl.gov.uk" target="_blank" rel="noopener">TfL Bus Open Data (S3)</a><span class="credits-note">weekly detailed route geometry (Route_Geometry ZIP)</span></li>
            <li><a href="http://www.londonbusroutes.net" target="_blank" rel="noopener">londonbusroutes.net</a><span class="credits-note">authoritative vehicle type · PVR · operator / garage assignment · garage CSV · used only as fallback for routes TfL omits</span></li>
            <li><a href="https://bustimes.org/regions/L" target="_blank" rel="noopener">bustimes.org</a><span class="credits-note">timetable + destination scrape fallback for the handful of routes absent from TfL</span></li>
            <li><a href="https://postcodes.io" target="_blank" rel="noopener">postcodes.io</a><span class="credits-note">bulk postcode → lat/lon geocoding for garages (ONS data · OGL v3)</span></li>
            <li><a href="https://photon.komoot.io/" target="_blank" rel="noopener">Photon</a><span class="credits-note">legacy garage-locations geocoder (OpenStreetMap-backed)</span></li>
          </ul>
          <p class="modal-note">Data refreshes automatically every <strong>Monday at 05:00 UTC</strong>. TfL data is used under the terms of the <a href="https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service" target="_blank" rel="noopener">TfL Open Data Licence</a>.</p>
        </section>

        <section class="modal-section">
          <span class="modal-section-tag">Built with</span>
          <ul class="credits-list credits-list--inline">
            <li><a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a><span class="credits-note">map engine · BSD-2</span></li>
            <li><a href="https://carto.com/attribution/" target="_blank" rel="noopener">CARTO Voyager</a><span class="credits-note">basemap tiles</span></li>
            <li><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a><span class="credits-note">basemap data · © contributors · ODbL</span></li>
            <li><a href="https://sheetjs.com" target="_blank" rel="noopener">SheetJS Community</a><span class="credits-note">XLSX export · Apache 2.0</span></li>
            <li><a href="https://vercel.com/font" target="_blank" rel="noopener">Geist</a><span class="credits-note">typeface · SIL OFL</span></li>
            <li><a href="https://github.com" target="_blank" rel="noopener">GitHub</a><span class="credits-note">source hosting · Actions for the weekly data refresh</span></li>
            <li><a href="https://pages.cloudflare.com" target="_blank" rel="noopener">Cloudflare Pages</a><span class="credits-note">static hosting · global CDN</span></li>
          </ul>
        </section>

        <section class="modal-section">
          <span class="modal-section-tag">Privacy</span>
          <p class="modal-note" style="margin-top: 0; padding: 0 var(--sp-3);">
            Uses <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Analytics</a> (aggregate page-view statistics only — no accounts, no user-level tracking, no advertising cookies). No personal data is collected or stored by this site. Your browser does make direct requests to the TfL API for live bus-stop data when you open a route.
          </p>
        </section>

        <section class="modal-section">
          <span class="modal-section-tag">Source</span>
          <ul class="credits-list credits-list--inline">
            <li><a href="https://github.com/farhanmunim/london-buses" target="_blank" rel="noopener">github.com/farhanmunim/london-buses</a><span class="credits-note">open source · MIT</span></li>
          </ul>
        </section>

        <section class="modal-section">
          <span class="modal-section-tag">Developer</span>
          <ul class="credits-list credits-list--inline">
            <li><a href="https://farhan.app" target="_blank" rel="noopener">Farhan Munim</a><span class="credits-note">farhan.app</span></li>
          </ul>
        </section>

        <section class="modal-section">
          <span class="modal-section-tag">Contributors</span>
          <p class="modal-note" style="margin-top: 0; padding: 0 var(--sp-3);">Daniel Plumb, Mark Leonard-Adoko, Ross Levine</p>
        </section>

        <section class="modal-section modal-support">
          <span class="modal-section-tag">Support</span>
          <p class="modal-support__copy">
            Support the development of this open source project.
          </p>
          <a class="modal-support__link" href="https://buymeacoffee.com/farhan.app" target="_blank" rel="noopener">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h2a2 2 0 0 1 0 4h-2"/><path d="M7 3v2M10 3v2M13 3v2"/></svg>
            Buy me a coffee
            <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>
          </a>
        </section>
      </div>
    </div>
  `;

  function ensureModal() {
    let modal = document.getElementById('about-modal');
    if (modal) return modal;
    const wrap = document.createElement('div');
    wrap.innerHTML = MODAL_HTML.trim();
    modal = wrap.firstElementChild;
    document.body.appendChild(modal);
    return modal;
  }

  // Focusable elements inside the modal, in tab order
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let lastTrigger = null;

  function getFocusable(modal) { return [...modal.querySelectorAll(FOCUSABLE)].filter(el => !el.hidden); }

  function open(trigger) {
    const modal = ensureModal();
    lastTrigger = trigger ?? document.activeElement;
    modal.hidden = false;
    // Move focus into the dialog — prefer the close button for predictable tabbing
    const closeBtn = modal.querySelector('.modal-close');
    (closeBtn ?? getFocusable(modal)[0])?.focus();
  }
  function close() {
    const m = document.getElementById('about-modal');
    if (!m || m.hidden) return;
    m.hidden = true;
    // Restore focus to whatever opened the dialog
    lastTrigger?.focus?.();
    lastTrigger = null;
  }

  function trapFocus(e) {
    const modal = document.getElementById('about-modal');
    if (!modal || modal.hidden || e.key !== 'Tab') return;
    const items = getFocusable(modal);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last)  { e.preventDefault(); first.focus(); }
  }

  function init() {
    // Any #about-btn (topbar, footer, mobile-nav) opens the dialog
    document.addEventListener('click', e => {
      const btn = e.target.closest('#about-btn');
      if (btn) { e.preventDefault(); open(btn); return; }
      const closer = e.target.closest('#about-modal [data-close]');
      if (closer) close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const m = document.getElementById('about-modal');
        if (m && !m.hidden) close();
      } else {
        trapFocus(e);
      }
    });
    // Pre-inject the modal so the first open is immediate
    ensureModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
