/* Operator Intelligence — v3 concept. Entry point: loads the data, then renders.
   One idea: every route is the same compact "brief" (shape · PVR · fleet · £/mile · operated % · contract runway ·
   next tender) whether it is a table row or the detail drawer, and operator KPIs are the roll-up of those same
   fields, so the numbers always agree. All data is this project's own static JSON (data/api/*.json); route shapes
   are drawn as plain SVG — no map tiles. */
import { build, D, load, setData } from './data.js';
import { $, $$, esc } from './dom.js';
import { openRoute } from './drawer/drawer.js';
import { fDate } from './format.js';
import { robustBounds } from './geometry.js';
import { S } from './state.js';
import { fromHash, renderAll, syncHash } from './ui/actions.js';
import './tooltip.js';
import './ui/info.js';
import './ui/events.js';

/* ── boot ────────────────────────────────────────────────────────────────── */
(async () => {
  try{
    const raw = await load();
    setData(build(raw));
    D.garages = raw.garages;
    D.bb = D.lines.size ? robustBounds([...D.lines.values()]) : { minLon:-0.5, maxLon:0.3, minLat:51.3, maxLat:51.7 };
    const gen = raw.manifest?.generatedAt;
    $('#fresh').innerHTML = `<i></i>Data as of ${gen ? esc(fDate(gen)) : 'recently'}`;
    $('#app').innerHTML = `<section id="overview"><div id="hero"></div><section class="card sec" id="brief" aria-label="Briefing"></section><div class="grid sec" id="kpis"></div><div class="grid sec" id="kpis2" aria-label="Commercial and operational signals"></div></section>
      <div class="grid sec"><section class="card s5" id="market" aria-label="Market position"></section><section class="card s7" id="runway" aria-label="Contract runway"></section></div>
      <div class="grid sec" id="contracts"><section class="card s4" id="record" aria-label="Tender record"></section><section class="card s4" id="h2h" aria-label="Head-to-head"></section><section class="card s4" id="price" aria-label="Price per mile"></section></div>
      <section class="card sec" id="renewals" aria-label="Renewal calendar"></section>
      <div class="grid sec"><section class="card s4" id="fleet" aria-label="Fleet register"></section><section class="card s4" id="depots" aria-label="Depots"></section><section class="card s4" id="quality" aria-label="Service quality"></section></div>
      <section class="card sec" id="ageout" aria-label="Replacement runway"></section>
      <section class="card sec" id="watch" aria-label="Needs attention"></section>
      <section class="card sec" id="routes" aria-label="Routes"></section>`;
    if(new URLSearchParams(location.search).has('debug')) window.__v3 = { D, S };
    const orig = fromHash(); renderAll();
    // rail: "Contracts" jumps to the runway card, "Fleet" to the fleet card; the section in view is highlighted
    const spy = new IntersectionObserver(es => es.forEach(en => { if(en.isIntersecting) $$('.rail a.nav[data-sec]').forEach(a => a.classList.toggle('on', a.dataset.sec === en.target.dataset.spy)); }), { rootMargin:'-30% 0px -60% 0px' });
    [['overview', '#overview'], ['market', '#market'], ['contracts', '#runway'], ['renewals', '#renewals'], ['fleet', '#fleet'], ['routes', '#routes']].forEach(([k, sel]) => { const el = $(sel); if(el){ el.dataset.spy = k; spy.observe(el); } });
    $$('.rail a.nav[data-sec]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const id = { contracts:'runway', fleet:'fleet' }[a.dataset.sec] ?? a.dataset.sec; document.getElementById(id)?.scrollIntoView({ behavior:'smooth', block:'start' }); $$('.rail a.nav').forEach(x => x.classList.toggle('on', x === a)); }));
    if(orig) openRoute(orig, false); else syncHash();
  }catch(e){
    console.error(e);
    $('#app').innerHTML = `<div class="err"><b>Couldn't load the operator data.</b><br>${esc(e.message)}<br><a href="/intelligence">Reload</a></div>`;
  }
})();
