/* Site-wide banner above the header. One file controls every page: edit TAG / LABEL / HREF
   (the link out to the experimental page) and BACK_LABEL / BACK_HREF (the link home, shown on
   that page itself), or set ON = false to hide it. Loaded first thing in <body> so it renders
   above the header with no flash. */
(() => {
  const ON = true;
  const TAG = 'Experimental';
  const LABEL = 'Try Intelligence';
  const HREF = '/intelligence';
  const BACK_LABEL = 'Back to londonbuses.org';
  const BACK_HREF = '/';
  if(!ON || document.getElementById('site-banner')) return;
  const onTarget = location.pathname.startsWith(HREF);
  const style = document.createElement('style');
  style.textContent = `
    #site-banner{position:relative;z-index:500;display:flex;align-items:center;justify-content:center;gap:12px;min-height:38px;padding:6px 16px;
      font:500 12.5px/1.3 Geist,Inter,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.005em;color:rgba(255,255,255,.78);
      background:radial-gradient(70% 220% at 50% -60%,rgba(245,158,11,.22),transparent 70%),#0c0a09;
      border-bottom:1px solid rgba(255,255,255,.08);-webkit-font-smoothing:antialiased}
    #site-banner b{flex:none;display:inline-flex;align-items:center;gap:6px;padding:4px 9px 4px 8px;border-radius:999px;
      font-size:10.5px;font-weight:600;line-height:1;letter-spacing:.06em;text-transform:uppercase;
      color:#fbbf24;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.32)}
    #site-banner b::before{content:"";width:5px;height:5px;border-radius:50%;background:#fbbf24;box-shadow:0 0 0 0 rgba(251,191,36,.55);animation:sb-pulse 2.4s ease-out infinite}
    @keyframes sb-pulse{70%{box-shadow:0 0 0 6px rgba(251,191,36,0)}100%{box-shadow:0 0 0 0 rgba(251,191,36,0)}}
    #site-banner a{flex:none;display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;
      color:#fff;font-weight:600;text-decoration:none;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.16);
      transition:background .15s,border-color .15s}
    #site-banner a::before{content:"";position:absolute;inset:0}
    #site-banner a::after{content:"→";transition:transform .15s}
    #site-banner:hover a{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.3)}
    #site-banner:hover a::after{transform:translateX(3px)}
    #site-banner.is-back a{flex-direction:row-reverse}
    #site-banner.is-back a::after{content:"←"}
    #site-banner.is-back:hover a::after{transform:translateX(-3px)}
    #site-banner a:focus-visible{outline:2px solid #fbbf24;outline-offset:2px}
    @media (prefers-reduced-motion:reduce){#site-banner b::before{animation:none}#site-banner a,#site-banner a::after{transition:none}}
    @media (max-width:640px){#site-banner{gap:8px;padding:6px 12px;font-size:12px}}`;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'site-banner'; bar.setAttribute('role', 'status');
  bar.classList.toggle('is-back', onTarget);
  const tag = document.createElement('b'); tag.textContent = TAG;
  const link = document.createElement('a'); link.href = onTarget ? BACK_HREF : HREF; link.textContent = onTarget ? BACK_LABEL : LABEL;
  bar.append(tag, link);
  const cs = getComputedStyle(document.body);   // pages with a default body margin still get a full-bleed bar
  bar.style.margin = `-${cs.marginTop} -${cs.marginRight} 0 -${cs.marginLeft}`;
  if(/flex|grid/.test(cs.display)) bar.style.cssText += ';position:fixed;top:0;left:0;right:0;margin:0';   // centred single-screen pages (404)
  document.body.prepend(bar);
  // fixed elements (e.g. a side rail) read --banner-h so they start below the banner while it is on screen
  const sync = () => document.documentElement.style.setProperty('--banner-h', Math.max(0, bar.offsetHeight - scrollY) + 'px');
  // pages that fill the viewport (the map view) subtract the banner's full, scroll-independent height
  const size = () => document.documentElement.style.setProperty('--sb-h', bar.offsetHeight + 'px');
  sync(); size(); addEventListener('scroll', sync, { passive:true }); addEventListener('resize', () => { sync(); size(); });
})();
