/* Site-wide black banner above the header. One file controls every page: edit TAG / LABEL / HREF,
   or set ON = false to hide it. Skipped on its own target page. Loaded first thing in <body>
   so it renders above the header with no flash. */
(() => {
  const ON = true;
  const TAG = 'Experimental';
  const LABEL = 'Intelligence';
  const HREF = '/intelligence';
  if(!ON || document.getElementById('site-banner') || location.pathname.startsWith(HREF)) return;
  const style = document.createElement('style');
  style.textContent = `
    #site-banner{position:relative;z-index:500;background:#0b0b0c;color:#fff;font:500 12.5px/1.35 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
      letter-spacing:.005em;text-align:center;padding:7px 14px;display:flex;align-items:center;justify-content:center;gap:9px;min-height:30px}
    #site-banner b{flex:none;font-size:10px;font-weight:700;line-height:1;letter-spacing:.08em;text-transform:uppercase;color:#fab219;border:1px solid #fab219;border-radius:999px;padding:3px 7px}
    #site-banner a{color:#fff;font-weight:600;text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(255,255,255,.45)}
    #site-banner a:hover,#site-banner a:focus-visible{text-decoration-color:#fff}
    @media (max-width:600px){#site-banner{font-size:11.5px;padding:6px 12px;text-align:left}}`;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'site-banner'; bar.setAttribute('role', 'status');
  const tag = document.createElement('b'); tag.textContent = TAG;
  const link = document.createElement('a'); link.href = HREF; link.textContent = `${LABEL} →`;
  bar.append(tag, link);
  const cs = getComputedStyle(document.body);   // pages with a default body margin still get a full-bleed bar
  bar.style.margin = `-${cs.marginTop} -${cs.marginRight} 0 -${cs.marginLeft}`;
  if(/flex|grid/.test(cs.display)) bar.style.cssText += ';position:fixed;top:0;left:0;right:0;margin:0';   // centred single-screen pages (404)
  document.body.prepend(bar);
  // fixed elements (e.g. a side rail) read --banner-h so they start below the banner while it is on screen
  const sync = () => document.documentElement.style.setProperty('--banner-h', Math.max(0, bar.offsetHeight - scrollY) + 'px');
  sync(); addEventListener('scroll', sync, { passive:true }); addEventListener('resize', sync);
})();
