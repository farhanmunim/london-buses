/**
 * panels.js — Desktop panel collapse/expand coordination.
 *
 * The blueprint's AppShell.Panels module wires clicks on panel headers and
 * the right collapse tab. We layer two concerns on top:
 *   1. Call invalidateMapSize() once the CSS transition settles so Leaflet
 *      redraws correctly for the new canvas width.
 *   2. Observe each panel's .collapsed class so we can reflect state onto
 *      the reopen tab (.visible) and the header button (aria-expanded),
 *      AND wire the left reopen tab's click (blueprint only handles right).
 */

import { invalidateMapSize } from './map.js';

const MAP_RESIZE_DELAY_MS = 310;

// Resize the map whenever a panel toggles, once the transition completes
for (const id of ['leftPanelHd', 'rightPanelHd', 'rightCollapseTab']) {
  document.getElementById(id)?.addEventListener('click', () => {
    setTimeout(invalidateMapSize, MAP_RESIZE_DELAY_MS);
  });
}

function wirePanelTab(panelId, tabId, headerId) {
  const panel  = document.getElementById(panelId);
  const tab    = document.getElementById(tabId);
  const header = document.getElementById(headerId);
  if (!panel || !tab) return;
  const apply = () => {
    const collapsed = panel.classList.contains('collapsed');
    tab.classList.toggle('visible', collapsed);
    if (header) header.setAttribute('aria-expanded', String(!collapsed));
  };
  apply();
  new MutationObserver(apply).observe(panel, { attributes: true, attributeFilter: ['class'] });
  tab.addEventListener('click', () => {
    panel.classList.remove('collapsed');
    setTimeout(invalidateMapSize, MAP_RESIZE_DELAY_MS);
  });
}
wirePanelTab('panelRight', 'rightCollapseTab', 'rightPanelHd');
wirePanelTab('panelLeft',  'leftCollapseTab',  'leftPanelHd');
