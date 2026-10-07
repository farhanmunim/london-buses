/* Site-wide notice banner. One file controls every page: edit TEXT, or set ON = false to hide it.
   Loaded first thing in <body> so it renders above the header with no flash. */
(() => {
  const ON = true;
  const TEXT = 'System upgrade in progress: we’re moving to new servers, so some pages may be slow or briefly unavailable.';
  if(!ON || document.getElementById('site-banner')) return;
  const style = document.createElement('style');
  style.textContent = `
    #site-banner{position:relative;z-index:500;background:#0b0b0c;color:#fff;font:500 12.5px/1.35 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
      letter-spacing:.005em;text-align:center;padding:7px 14px;display:flex;align-items:center;justify-content:center;gap:9px;min-height:30px}
    #site-banner i{flex:none;width:7px;height:7px;border-radius:50%;background:#fab219;box-shadow:0 0 0 0 rgba(250,178,25,.6);animation:sbp 2s infinite}
    @keyframes sbp{70%{box-shadow:0 0 0 7px rgba(250,178,25,0)}100%{box-shadow:0 0 0 0 rgba(250,178,25,0)}}
    @media (prefers-reduced-motion:reduce){#site-banner i{animation:none}}
    @media (max-width:600px){#site-banner{font-size:11.5px;padding:6px 12px;text-align:left}}`;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'site-banner'; bar.setAttribute('role', 'status');
  const dot = document.createElement('i'); dot.setAttribute('aria-hidden', 'true');
  const msg = document.createElement('span'); msg.textContent = TEXT;
  bar.append(dot, msg);
  const cs = getComputedStyle(document.body);   // pages with a default body margin still get a full-bleed bar
  bar.style.margin = `-${cs.marginTop} -${cs.marginRight} 0 -${cs.marginLeft}`;
  if(/flex|grid/.test(cs.display)) bar.style.cssText += ';position:fixed;top:0;left:0;right:0;margin:0';   // centred single-screen pages (404)
  document.body.prepend(bar);
  // fixed elements (e.g. a side rail) read --banner-h so they start below the banner while it is on screen
  const sync = () => document.documentElement.style.setProperty('--banner-h', Math.max(0, bar.offsetHeight - scrollY) + 'px');
  sync(); addEventListener('scroll', sync, { passive:true }); addEventListener('resize', sync);
})();
