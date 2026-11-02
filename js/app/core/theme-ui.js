/* Theme controls — toggle button, system-preference follow, idle warm-up of the vector map files. */
import { navigate } from './router.js';
import { isDark } from './theme.js';
import { vectorLib, vectorStyles, webglOk } from '../map/layers.js';

function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('v2-theme', t); } catch(e){}
  syncThemeBtn();
  navigate();               // rebuild the view so maps pick up the dark tiles
}
function syncThemeBtn(){
  const b = document.getElementById('themeBtn');
  if(!b) return;
  b.querySelector('.th-moon').style.display = isDark() ? 'none' : '';
  b.querySelector('.th-sun').style.display  = isDark() ? '' : 'none';
  b.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
}
document.getElementById('themeBtn')?.addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
syncThemeBtn();
// Warm the lazy vector-map files while the browser is idle, so the first map
// doesn't wait on a ~300 KB download (skipped in dark mode, without WebGL, and on Save-Data).
addEventListener('load', () => (window.requestIdleCallback ?? setTimeout)(() => {
  if(isDark() || navigator.connection?.saveData || !webglOk()) return;
  vectorLib().catch(() => {}); vectorStyles().catch(() => {});
}));
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', e => {
  let stored = null; try { stored = localStorage.getItem('v2-theme'); } catch(err){}
  if(stored !== 'light' && stored !== 'dark'){   // still following the system
    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    syncThemeBtn(); navigate();
  }
});
