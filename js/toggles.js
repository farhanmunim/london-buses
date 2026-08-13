/**
 * toggles.js — Map-area show/hide controls for Route lines + Garages.
 *
 * Each button is a `.mctl` in the top-right of the map. Clicking flips the
 * map layer visibility, persists the choice, and updates aria-pressed / `.on`
 * for the button's own visual state. A matching event from the map (when a
 * route is focused and the overview auto-hides) keeps the button in sync
 * without persisting that transient state.
 */

import { setRoutesVisible, setGaragesVisible, setStopsPreference, setLiveVehiclesEnabled, isRouteActive } from './map.js?v=2.16.6';
import { toggleLinesBtn, toggleGaragesBtn, toggleStopsBtn, toggleLiveBtn } from './state.js?v=2.16.6';

function wire(btn, { storageKey, apply, syncEvent, persistWhen }) {
  if (!btn) return;
  const stored = localStorage.getItem(storageKey);
  const on = stored === null ? true : stored === '1';

  const paint = (state) => {
    btn.classList.toggle('on', state);
    btn.setAttribute('aria-pressed', String(state));
  };
  const setAll = (state, { persist = true } = {}) => {
    apply(state);
    paint(state);
    if (persist && (!persistWhen || persistWhen())) {
      try { localStorage.setItem(storageKey, state ? '1' : '0'); } catch (_) {}
    }
  };

  setAll(on);
  btn.addEventListener('click', () => setAll(btn.getAttribute('aria-pressed') !== 'true'));
  if (syncEvent) document.addEventListener(syncEvent, e => paint(!!e.detail));
}

wire(toggleLinesBtn, {
  storageKey: 'routes-visible',
  apply:      setRoutesVisible,
  syncEvent:  'map:routesvisibilitychange',
  persistWhen: () => !isRouteActive(),
});

wire(toggleGaragesBtn, {
  storageKey: 'garages-visible',
  apply:      setGaragesVisible,
});

// Stops toggle: visible only while a route is focused. Every fresh route
// focus force-resets the stops preference to ON — users expect to see stops
// appear when they click a route. A persistent "off" setting from an old
// session was defeating that expectation.
if (toggleStopsBtn) {
  toggleStopsBtn.hidden = true;
  let stopsOn = true;

  const paint = (on) => {
    toggleStopsBtn.classList.toggle('on', on);
    toggleStopsBtn.setAttribute('aria-pressed', String(on));
  };
  paint(stopsOn);
  setStopsPreference(stopsOn);

  toggleStopsBtn.addEventListener('click', () => {
    stopsOn = !stopsOn;
    paint(stopsOn);
    setStopsPreference(stopsOn);
  });

  document.addEventListener('app:routefocuschange', e => {
    toggleStopsBtn.hidden = !e.detail;
    if (e.detail) {
      // Reset to ON whenever a route is re-focused so the user always sees
      // stops by default — the button is their escape hatch, not a sticky
      // cross-session preference.
      stopsOn = true;
      paint(stopsOn);
      setStopsPreference(stopsOn);
    }
  });
}

// Live-buses toggle: same lifecycle as Stops — visible only while a route
// is focused, reset to ON per focus (the button pauses the GPS poll for
// this focus, it isn't a sticky preference).
if (toggleLiveBtn) {
  toggleLiveBtn.hidden = true;
  let liveOn = true;

  const paint = (on) => {
    toggleLiveBtn.classList.toggle('on', on);
    toggleLiveBtn.setAttribute('aria-pressed', String(on));
  };
  paint(liveOn);

  // Loading feedback — the first GPS fetch of a focus (or of a re-enable)
  // takes a moment, and without a cue "loading" and "no buses out" look
  // identical. The pill's bus icon swaps for a spinner while the fetch is
  // in flight; a transient note under the pills words the empty outcomes.
  const spinner = document.createElement('span');
  spinner.className = 'mctl-spin';
  spinner.hidden = true;
  const busIcon = toggleLiveBtn.querySelector('svg');
  busIcon?.before(spinner);

  let toastEl = null, toastTimer = null;
  const toast = (msg) => {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (!msg) { toastEl?.remove(); toastEl = null; return; }
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'map-toast';
      toastEl.setAttribute('role', 'status');
      document.querySelector('.map-area')?.append(toastEl);
    }
    toastEl.textContent = msg;
    toastTimer = setTimeout(() => toast(null), 4000);
  };

  const setLoading = (loading) => {
    toggleLiveBtn.classList.toggle('is-loading', loading);
    toggleLiveBtn.setAttribute('aria-busy', String(loading));
    spinner.hidden = !loading;
    if (busIcon) busIcon.style.display = loading ? 'none' : '';
  };

  document.addEventListener('map:livevehiclesloading', e => {
    const { loading, count } = e.detail ?? {};
    setLoading(!!loading);
    if (loading) { toast(null); return; }
    if (count === 0)         toast('No buses tracked on this route right now');
    else if (count == null)  toast('Live bus feed unavailable');
  });

  toggleLiveBtn.addEventListener('click', () => {
    liveOn = !liveOn;
    paint(liveOn);
    if (!liveOn) { setLoading(false); toast(null); }
    setLiveVehiclesEnabled(liveOn);
  });

  // Driven by the vehicles lifecycle, not route focus — comparison mode
  // focuses routes without live tracking, and the pill must not show there.
  document.addEventListener('map:livevehiclesfocus', e => {
    toggleLiveBtn.hidden = !e.detail;
    if (!e.detail) { setLoading(false); toast(null); }
    if (e.detail && !liveOn) {
      liveOn = true;
      paint(liveOn);
      setLiveVehiclesEnabled(liveOn);
    }
  });
}
