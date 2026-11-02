/* App shell — the #main outlet, keyboard stops for scrollable regions, and the measured header height. */

export const main = document.getElementById('main');
new MutationObserver(()=>{
  main.querySelectorAll('div[style*="overflow-x:auto"]:not([tabindex])').forEach(e=>{ e.tabIndex=0; e.setAttribute('role','region'); e.setAttribute('aria-label','Scrollable table'); });
  // Long values that scroll inside their tile (fleet model names) need a keyboard stop too.
  main.querySelectorAll('.fact .v:not([tabindex])').forEach(e=>{ if(e.scrollWidth > e.clientWidth + 1){ e.tabIndex=0; e.setAttribute('role','region'); e.setAttribute('aria-label', (e.closest('.fact')?.querySelector('.l')?.textContent ?? 'Value') + ' (scrollable)'); } });
}).observe(main,{childList:true,subtree:true});
/* The header wraps to a second line at some widths, so the full-screen map view subtracts its measured height, not a constant. */
{
  const topbar = document.querySelector('.topbar');
  const setHdr = () => document.documentElement.style.setProperty('--hdr-h', topbar.offsetHeight + 'px');
  new ResizeObserver(setHdr).observe(topbar); setHdr();
}
