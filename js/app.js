/* ============================================================================
   Web App Blueprint · Shell Controller
   ----------------------------------------------------------------------------
   A small, modular framework that powers the shell on every page.

   Each module auto-initialises on DOMContentLoaded and silently no-ops when
   its target elements aren't present — so the same bundle works on the main
   app page and on lightweight pages like the changelog.

   Modules:
     • Drawer     — mobile off-canvas drawer for left/right panels + scroll lock
     • Panels     — desktop collapse/expand for left and right panels
     • Tabs       — generic tab-switcher for any [data-tabs] group
     • Nav        — sidebar nav-item active state
     • MobileNav  — bottom navigation bar on mobile
   ============================================================================ */
(function () {
  'use strict';

  /* ---------- tiny DOM helpers ------------------------------------------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const isMobile = () => window.innerWidth <= 640;

  /* ---------- shared state ---------------------------------------------- */
  const els = {
    overlay:          $('#overlay'),
    panelLeft:        $('#panelLeft'),
    panelRight:       $('#panelRight'),
    leftPanelHd:      $('#leftPanelHd'),
    rightPanelHd:     $('#rightPanelHd'),
    rightCollapseTab: $('#rightCollapseTab'),
  };

  /* =======================================================================
     Drawer — mobile off-canvas for left/right panels
     ======================================================================= */
  const Drawer = {
    init() {
      if (!els.overlay) return;
      on(els.overlay, 'click', this.closeAll);
    },

    syncLock() {
      const anyOpen =
        (els.panelLeft  && els.panelLeft.classList.contains('mobile-open')) ||
        (els.panelRight && els.panelRight.classList.contains('mobile-open'));
      document.body.classList.toggle('drawer-open', !!anyOpen);
    },

    closeAll() {
      els.panelLeft  && els.panelLeft.classList.remove('mobile-open');
      els.panelRight && els.panelRight.classList.remove('mobile-open');
      els.overlay    && els.overlay.classList.remove('visible');
      Drawer.syncLock();
    },

    toggle(panel) {
      if (!panel || !els.overlay) return;
      const isOpen = panel.classList.contains('mobile-open');
      Drawer.closeAll();
      if (!isOpen) {
        panel.classList.add('mobile-open');
        els.overlay.classList.add('visible');
        Drawer.syncLock();
      }
      return !isOpen;
    },
  };

  /* =======================================================================
     Panels — desktop collapse/expand
     ======================================================================= */
  const Panels = {
    init() {
      on(els.leftPanelHd, 'click', () => {
        if (isMobile()) return Drawer.closeAll();
        els.panelLeft.classList.toggle('collapsed');
      });

      on(els.rightPanelHd, 'click', () => {
        if (isMobile()) return Drawer.closeAll();
        els.panelRight.classList.toggle('collapsed');
      });

      on(els.rightCollapseTab, 'click', () => {
        els.panelRight && els.panelRight.classList.remove('collapsed');
      });
    },
  };

  /* =======================================================================
     Tabs — generic click-to-activate within a tab group
     ----------------------------------------------------------------------
     Works for any container whose children share a class. We wire up the
     common groups used in the shell; to add your own just follow the same
     { selector, siblingSelector } pattern.
     ======================================================================= */
  const Tabs = {
    groups: [
      { tab: '.right-tab', group: '.right-tabs' },
    ],

    init() {
      Tabs.groups.forEach(({ tab, group }) => {
        $$(tab).forEach(t => on(t, 'click', () => Tabs.activate(t, tab, group)));
      });
    },

    activate(tab, tabSel, groupSel) {
      const parent = tab.closest(groupSel);
      if (!parent) return;
      $$(tabSel, parent).forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
    },
  };

  /* =======================================================================
     Nav — sidebar nav item active state
     ======================================================================= */
  const Nav = {
    init() {
      $$('.nav-item').forEach(item => on(item, 'click', () => {
        $$('.nav-item').forEach(x => x.classList.remove('active'));
        item.classList.add('active');
        if (isMobile()) Drawer.closeAll();
      }));
    },
  };

  /* =======================================================================
     MobileNav — bottom nav bar on mobile
     ======================================================================= */
  const MobileNav = {
    items: [],

    init() {
      MobileNav.items = $$('.mobile-nav-item');
      if (!MobileNav.items.length) return;

      const wire = (id, handler) => on($('#' + id), 'click', handler);

      wire('mobileNavMain',   () => { MobileNav.setActive('mobileNavMain');   Drawer.closeAll(); });
      wire('mobileNavNew',    () => { MobileNav.setActive('mobileNavNew');    Drawer.closeAll(); });
      wire('mobileNavSearch', () => { MobileNav.setActive('mobileNavSearch'); Drawer.closeAll(); });

      wire('mobileNavLeft', () => {
        const opened = Drawer.toggle(els.panelLeft);
        MobileNav.setActive(opened ? 'mobileNavLeft' : 'mobileNavMain');
      });

      wire('mobileNavRight', () => {
        const opened = Drawer.toggle(els.panelRight);
        MobileNav.setActive(opened ? 'mobileNavRight' : 'mobileNavMain');
      });
    },

    setActive(id) {
      MobileNav.items.forEach(x => x.classList.remove('active'));
      const el = document.getElementById(id);
      if (el) el.classList.add('active');
    },
  };

  /* =======================================================================
     Theme — light / dark toggle, persists to localStorage
     ----------------------------------------------------------------------
     An inline <script> in <head> applies the stored/system theme before
     paint to avoid flash. This module handles the toggle button.
     ======================================================================= */
  const Theme = {
    KEY: 'app-theme',

    init() {
      const btn = $('#themeToggle');
      if (!btn) return;
      on(btn, 'click', Theme.toggle);
    },

    current() {
      return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    },

    set(theme) {
      const next = theme === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(Theme.KEY, next); } catch (_) {}
    },

    toggle() {
      Theme.set(Theme.current() === 'dark' ? 'light' : 'dark');
    },
  };

  /* =======================================================================
     Boot
     ======================================================================= */
  function boot() {
    Drawer.init();
    Panels.init();
    Tabs.init();
    Nav.init();
    MobileNav.init();
    Theme.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose for debugging / future extension
  window.AppShell = { Drawer, Panels, Tabs, Nav, MobileNav, Theme };
})();
