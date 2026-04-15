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

        <p class="modal-lede">An interactive map of every London bus route — search, filter by operator, propulsion, deck type, and more.</p>

        <div class="modal-disclaimer" role="note">
          <strong>Disclaimer.</strong> This site is an independent project and is <strong>not affiliated with, endorsed by, or operated by Transport for London (TfL), London Buses, or any bus operator</strong>. Data is compiled from public sources and may be incomplete, out of date, or inaccurate — do not rely on it for travel planning.
        </div>

        <section class="modal-section">
          <span class="modal-section-tag">Data sources</span>
          <ul class="credits-list">
            <li><a href="https://api.tfl.gov.uk" target="_blank" rel="noopener">Transport for London Unified API</a><span class="credits-note">route list · destinations · stops</span></li>
            <li><a href="https://bus.data.tfl.gov.uk" target="_blank" rel="noopener">TfL Bus Open Data</a><span class="credits-note">weekly route geometry</span></li>
            <li><a href="http://www.londonbusroutes.net" target="_blank" rel="noopener">londonbusroutes.net</a><span class="credits-note">operator · vehicle · PVR · frequency</span></li>
          </ul>
          <p class="modal-note">Data refreshes automatically every <strong>Monday at 05:00 UTC</strong>.</p>
        </section>

        <section class="modal-section">
          <span class="modal-section-tag">Built with</span>
          <ul class="credits-list">
            <li><a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a><span class="credits-note">map engine</span></li>
            <li><a href="https://carto.com/" target="_blank" rel="noopener">CARTO Voyager</a><span class="credits-note">basemap tiles</span></li>
            <li><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a><span class="credits-note">map data · © contributors</span></li>
            <li><a href="https://vercel.com/font" target="_blank" rel="noopener">Geist</a><span class="credits-note">typeface · Vercel, via Google Fonts</span></li>
          </ul>
        </section>

        <section class="modal-section">
          <span class="modal-section-tag">Source</span>
          <ul class="credits-list">
            <li><a href="https://github.com/farhanmunim/london-buses" target="_blank" rel="noopener">github.com/farhanmunim/london-buses</a><span class="credits-note">open source · MIT</span></li>
          </ul>
        </section>

        <section class="modal-section">
          <span class="modal-section-tag">Developer</span>
          <ul class="credits-list">
            <li><a href="https://farhan.app" target="_blank" rel="noopener">Farhan Munim</a><span class="credits-note">farhan.app</span></li>
          </ul>
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

  function open()  { ensureModal().hidden = false; }
  function close() { const m = document.getElementById('about-modal'); if (m) m.hidden = true; }

  function init() {
    // Any #about-btn (topbar, footer, mobile-nav) opens the dialog
    document.addEventListener('click', e => {
      const btn = e.target.closest('#about-btn');
      if (btn) { e.preventDefault(); open(); return; }
      const closer = e.target.closest('#about-modal [data-close]');
      if (closer) close();
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const m = document.getElementById('about-modal');
      if (m && !m.hidden) close();
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
