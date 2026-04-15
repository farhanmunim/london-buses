/**
 * roadmap.js — Roadmap modal, injected on load so any #roadmap-btn on any
 * page opens the same dialog. Mirrors the About modal pattern.
 *
 * Items are defined as a plain array so a roadmap update is a one-line edit.
 */

(function () {
  // Each entry: { title, desc, stage }
  // Stages: 'idea' | 'planned' | 'building' | 'shipped'
  const ITEMS = [
    { title: 'TfL zone map overlay',
      desc:  'Optional overlay tinting the map by TfL fare zone (1–9) for quick geographic context.',
      stage: 'planned' },
    { title: 'Live bus dots',
      desc:  'Animated dots for every bus currently running, streamed from the TfL vehicle-arrivals feed.',
      stage: 'idea' },
    { title: 'Live performance (EWT · OTP)',
      desc:  'Surface route-level Excess Wait Time and On-Time Performance from TfL’s operational metrics.',
      stage: 'idea' },
    { title: 'Route tender details',
      desc:  'Tender number, contract start / end, current bid winner and previous operator for each route.',
      stage: 'idea' },
    { title: 'Headway integration',
      desc:  'Link to Headway for richer operational insights alongside each route.',
      link:  { href: 'https://headway.plumby.io/', label: 'headway.plumby.io' },
      stage: 'idea' },
  ];

  const STAGE_LABEL = {
    idea:     'Idea',
    planned:  'Planned',
    building: 'In development',
    shipped:  'Shipped',
  };

  function rowHtml({ title, desc, stage, link }) {
    const label    = STAGE_LABEL[stage] ?? stage;
    const linkHtml = link
      ? ` <a class="roadmap__link" href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)} ↗</a>`
      : '';
    return `
      <tr>
        <td class="roadmap__title">${escapeHtml(title)}</td>
        <td class="roadmap__desc">${escapeHtml(desc)}${linkHtml}</td>
        <td class="roadmap__stage-cell"><span class="roadmap__stage roadmap__stage--${stage}">${label}</span></td>
      </tr>`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const MODAL_HTML = `
    <div id="roadmap-modal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="roadmap-title">
      <div class="modal-backdrop" data-close></div>
      <div class="modal-panel modal-panel--wide">
        <button class="modal-close" aria-label="Close" data-close>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>

        <div class="modal-header">
          <div class="modal-brand" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M2 4h12M2 8h12M2 12h8" fill="none"/>
            </svg>
          </div>
          <div class="modal-heading">
            <h2 id="roadmap-title" class="modal-title">Roadmap</h2>
            <span class="modal-subtitle">What's next for London Buses</span>
          </div>
        </div>

        <p class="modal-lede">
          A running list of ideas and commitments. Stages move left-to-right as items progress.
          Shipped items are mirrored in the <a href="changelog.html">changelog</a>.
        </p>

        <table class="roadmap">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Description</th>
              <th scope="col">Stage</th>
            </tr>
          </thead>
          <tbody>
            ${ITEMS.map(rowHtml).join('')}
          </tbody>
        </table>

        <p class="modal-note">
          Have a suggestion? Open an issue on
          <a href="https://github.com/farhanmunim/london-buses" target="_blank" rel="noopener">GitHub</a>.
        </p>
      </div>
    </div>`;

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let lastTrigger = null;

  function ensureModal() {
    let modal = document.getElementById('roadmap-modal');
    if (modal) return modal;
    const wrap = document.createElement('div');
    wrap.innerHTML = MODAL_HTML.trim();
    modal = wrap.firstElementChild;
    document.body.appendChild(modal);
    return modal;
  }
  function focusable(modal) { return [...modal.querySelectorAll(FOCUSABLE)].filter(el => !el.hidden); }

  function open(trigger) {
    const modal = ensureModal();
    lastTrigger = trigger ?? document.activeElement;
    modal.hidden = false;
    (modal.querySelector('.modal-close') ?? focusable(modal)[0])?.focus();
  }
  function close() {
    const m = document.getElementById('roadmap-modal');
    if (!m || m.hidden) return;
    m.hidden = true;
    lastTrigger?.focus?.();
    lastTrigger = null;
  }

  function trapFocus(e) {
    const modal = document.getElementById('roadmap-modal');
    if (!modal || modal.hidden || e.key !== 'Tab') return;
    const items = focusable(modal);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last)  { e.preventDefault(); first.focus(); }
  }

  function init() {
    document.addEventListener('click', e => {
      // Any #roadmap-btn OR element with [data-roadmap-open] triggers the dialog
      const btn = e.target.closest('#roadmap-btn, [data-roadmap-open]');
      if (btn) { e.preventDefault(); open(btn); return; }
      const closer = e.target.closest('#roadmap-modal [data-close]');
      if (closer) close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const m = document.getElementById('roadmap-modal');
        if (m && !m.hidden) close();
      } else {
        trapFocus(e);
      }
    });
    ensureModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
