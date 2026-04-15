/**
 * mobile-nav.js — Bottom-bar navigation on ≤640px.
 *
 * Five data-action buttons:
 *   • map       → close any open drawer
 *   • filters   → open left drawer (filters panel)
 *   • details   → open right drawer (route detail panel)
 *   • about     → close drawers + open About modal
 *   • changelog → plain <a>, native navigation (no JS)
 *
 * Drawer open/close is driven directly by toggling `.mobile-open` on the
 * panel and `.visible` on the overlay, matching the CSS contract for ≤640px.
 */

const nav = document.getElementById('m-nav');
if (nav) {
  const leftPanel  = document.getElementById('panelLeft');
  const rightPanel = document.getElementById('panelRight');
  const overlay    = document.getElementById('overlay');

  function setActive(action) {
    nav.querySelectorAll('.m-nav-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.action === action);
    });
  }
  function closeDrawers() {
    leftPanel?.classList.remove('mobile-open');
    rightPanel?.classList.remove('mobile-open');
    overlay?.classList.remove('visible');
    document.body.classList.remove('drawer-open');
  }
  function openDrawer(panel) {
    // Only one drawer at a time
    if (panel === leftPanel)  rightPanel?.classList.remove('mobile-open');
    if (panel === rightPanel) leftPanel?.classList.remove('mobile-open');
    panel?.classList.add('mobile-open');
    overlay?.classList.add('visible');
    document.body.classList.add('drawer-open');
  }

  nav.addEventListener('click', e => {
    const btn = e.target.closest('.m-nav-btn');
    if (!btn) return;
    const action = btn.dataset.action;
    switch (action) {
      case 'map':     closeDrawers(); setActive('map'); break;
      case 'filters': openDrawer(leftPanel);  setActive('filters'); break;
      case 'details': openDrawer(rightPanel); setActive('details'); break;
      case 'about':
        closeDrawers();
        setActive('about');
        document.getElementById('about-btn')?.click();
        break;
      case 'roadmap':
        closeDrawers();
        setActive('roadmap');
        document.getElementById('roadmap-btn')?.click();
        break;
    }
  });

  overlay?.addEventListener('click', () => { closeDrawers(); setActive('map'); });

  setActive('map'); // initial highlight
}
