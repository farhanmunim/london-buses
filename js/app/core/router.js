/* Router — hash navigation: parses the URL, resets per-view state, dispatches to the view renderers. */
import { state } from './nav.js';
import { main } from './shell.js';
import { renderAbout } from '../views/about.js';
import { renderCpi } from '../views/cpi.js';
import { renderDiversions } from '../views/diversions.js';
import { renderGarageDetail, renderGarages } from '../views/garages.js';
import { renderMileage } from '../views/mileage.js';
import { renderNetworkMap } from '../views/network-map.js';
import { renderOperatorDetail, renderOperators } from '../views/operators.js';
import { renderRouteDetail } from '../views/route-detail.js';
import { renderRoutes } from '../views/routes.js';
import { renderStopDetail, renderStops } from '../views/stops.js';
import { renderStreetworks } from '../views/streetworks.js';
import { renderTenders } from '../views/tenders.js';
import { renderTro } from '../views/traffic-orders.js';
import { renderVehicleDetail } from '../views/vehicle.js';

export function navigate(){
  state.navToken++;
  for(const t of state.liveTimers) clearInterval(t);
  state.liveTimers = [];
  if(state.map){ state.map.remove(); state.map = null; }   // free the previous view's Leaflet instance
  let h = location.hash.replace(/^#\/?/, '');
  // /map takes an optional query — routes=, ids=, title=, embed=1 — so other pages can open it scoped (see mapParams).
  if(/^map\?/.test(h)){ state.pendingMapQ = new URLSearchParams(h.slice(4)); h = 'map'; }
  // A malformed escape in the hash (#/route/%E0%A4%A) must not blank the page: fall back to the raw text.
  const safeDecode = x => { try{ return decodeURIComponent(x); }catch{ return x; } };
  // A query on any page (#/tender?x=1, #/route/88?x=1) is ignored, never mistaken for part of the route; the vehicle
  // page keeps its own (it reads its query from the hash itself).
  const pathOnly = h.split('?')[0];
  let [seg, arg] = (pathOnly.split('/')[0] === 'vehicle' ? h : pathOnly).split('/').map(safeDecode);
  const view = seg === '' ? 'routes' : seg;
  const navKey = view === 'route' ? 'routes' : view === 'garage' ? 'garages'
    : view === 'operator' ? 'operators' : view === 'stop' ? 'stops' : view === 'vehicle' ? 'routes' : view;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === navKey));
  // The More button/tab (both breakpoints) lights when any of the pages the
  // sheet holds is active, and the sheet closes on every navigation.
  const SHEET_PAGES = ['garages','stops','diversions','streetworks','tro','mileage','cpi','about'];
  for(const id of ['moreTab','moreBtn'])
    document.getElementById(id)?.classList.toggle('on', SHEET_PAGES.includes(navKey));
  const moreSheet = document.getElementById('moreSheet');
  if(moreSheet && !moreSheet.hidden){
    moreSheet.hidden = true;
    for(const id of ['moreTab','moreBtn']) document.getElementById(id)?.setAttribute('aria-expanded','false');
  }
  window.scrollTo(0, 0);
  main.classList.toggle('fullbleed', view === 'map');
  // Per-view titles so history entries and tabs are tellable apart.
  const TITLES = { routes:'Routes', map:'Network map', stops:'Stops', operators:'Operators',
    garages:'Garages', tender:'Tender', diversions:'Diversions', streetworks:'Street works', tro:'Traffic orders', mileage:'Mileage', cpi:'CPI-CPA', about:'About',
    route:`Route ${arg ?? ''}`, stop:'Stop', operator: arg ?? 'Operator',
    garage:`Garage ${arg ?? ''}`, vehicle: arg ? String(arg).split('?')[0] : 'Vehicle' };
  document.title = (TITLES[view] ? TITLES[view] + ' · ' : '') + 'londonbuses.org';
  // One page_view per hash navigation (initial load included — send_page_view
  // is disabled in the config above so this is the single source of truth).
  if(typeof gtag === 'function') gtag('event', 'page_view', { page_location: location.href, page_title: document.title });
  if(view === 'routes')         renderRoutes();
  else if(view === 'map')       renderNetworkMap();
  else if(view === 'route')     renderRouteDetail(arg);
  else if(view === 'stops')     renderStops();
  else if(view === 'stop')      renderStopDetail(arg);
  else if(view === 'operators') renderOperators();
  else if(view === 'operator')  renderOperatorDetail(arg);
  else if(view === 'garages')   renderGarages();
  else if(view === 'garage')    renderGarageDetail(arg);
  else if(view === 'vehicle')   renderVehicleDetail(arg);
  else if(view === 'tender')    renderTenders(arg);
  else if(view === 'tenders')   { location.replace('#/tender' + (arg ? '/' + encodeURIComponent(arg) : '')); return; }   // legacy plural slug
  else if(view === 'diversions' && arg === 'mileage') { location.replace('#/mileage'); return; }   // legacy tab deep link
  else if(view === 'diversions') renderDiversions();
  else if(view === 'streetworks') renderStreetworks();
  else if(view === 'tro')       renderTro();
  else if(view === 'mileage')   renderMileage();
  else if(view === 'cpi')       renderCpi();
  else if(view === 'about')     renderAbout();
  else                          renderRoutes();
}
window.addEventListener('hashchange', navigate);
