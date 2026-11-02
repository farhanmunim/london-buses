/* "More" sheet — Garages, Stops, Diversions, Mileage, CPI-CPA and About behind one affordance on both breakpoints. */

/* ── "More" sheet — Garages, Stops, Diversions, Mileage, CPI-CPA and About
   live behind one affordance on both breakpoints, so each bar keeps roomy
   primary destinations. One element: bottom sheet above the mobile tabbar,
   or pinned under the desktop More button when that one opened it. Toggles
   on tap, closes on any outside tap, Escape, or navigation (handled in
   navigate above). */
{
  const sheet = document.getElementById('moreSheet');
  const btns = ['moreTab','moreBtn'].map(id => document.getElementById(id)).filter(Boolean);
  const setOpen = (open, from) => {
    sheet.hidden = !open;
    for(const b of btns) b.setAttribute('aria-expanded', String(open));
    sheet.style.left = sheet.style.top = '';
    if(open && from === 'moreBtn' && matchMedia('(min-width:760px)').matches){
      const r = document.getElementById('moreBtn').getBoundingClientRect();
      const bar = document.querySelector('.topbar')?.getBoundingClientRect();
      sheet.style.top = Math.max(r.bottom, (bar?.bottom ?? 0)) + 6 + 'px';
      sheet.style.left = Math.max(8, Math.min(r.left, window.innerWidth - sheet.offsetWidth - 8)) + 'px';
    }
  };
  for(const b of btns) b.addEventListener('click', e => {
    setOpen(sheet.hidden, b.id);
    if(!sheet.hidden && e.detail === 0) sheet.querySelector('a')?.focus();     // opened from the keyboard: land on the first link
  });
  document.addEventListener('click', e => {
    if(!sheet.hidden && !sheet.contains(e.target) && !btns.some(b => b.contains(e.target))) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if(sheet.hidden) return;
    if(e.key === 'Escape'){
      const had = sheet.contains(document.activeElement); setOpen(false);
      if(had) btns.find(b => b.offsetParent !== null)?.focus();                // give focus back to the button that opened it
      return;
    }
    // arrow keys move through the menu like any menu; Tab leaving it closes it
    if(sheet.contains(document.activeElement) || btns.includes(document.activeElement)){
      const links = [...sheet.querySelectorAll('a')], i = links.indexOf(document.activeElement);
      if(e.key === 'ArrowDown'){ e.preventDefault(); links[(i + 1) % links.length]?.focus(); }
      else if(e.key === 'ArrowUp'){ e.preventDefault(); links[(i <= 0 ? links.length : i) - 1]?.focus(); }
      else if(e.key === 'Home' && i >= 0){ e.preventDefault(); links[0].focus(); }
      else if(e.key === 'End' && i >= 0){ e.preventDefault(); links.at(-1).focus(); }
    }
  });
  sheet.addEventListener('focusout', e => {
    if(!sheet.hidden && e.relatedTarget && !sheet.contains(e.relatedTarget) && !btns.includes(e.relatedTarget)) setOpen(false);
  });
}
