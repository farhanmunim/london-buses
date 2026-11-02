/* londonbuses.org — entry point. Imports every module for its side effects (listeners, the D.incoming patch), then boots the router.
   All data comes from this site's own pipeline (data/api/*.json) plus TfL's live endpoints. */
import { navigate } from './core/router.js';
import './core/data.js';
import './core/incoming.js';
import './core/tooltip.js';
import './core/shell.js';
import './core/more-sheet.js';
import './core/theme-ui.js';
import './core/net-chip.js';

/* boot — desktops land on the Map (the map is the point of a big screen);
   small viewports land on Routes, where a full-bleed map would be cramped.
   Only a truly bare URL is redirected: an explicit #/ (Routes nav click,
   refresh after navigating) is respected. */
if(/[?&]embed=1/.test(location.hash)) document.documentElement.classList.add('embed');
if(document.documentElement.classList.contains('embed')){
  // Inside an embedded map every in-app link leaves the frame, so a page never renders without its header.
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href^="#/"]'); if(!a || window.top === window) return;
    e.preventDefault(); window.top.location.href = '/' + a.getAttribute('href');
  }, true);
}   // an embedded map: no header, tab bar or footer
if(!location.hash && matchMedia('(min-width:760px)').matches){
  location.replace('#/map');   // the fragment change fires hashchange → navigate()
} else {
  navigate();
}
