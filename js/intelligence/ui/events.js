/* Event wiring — global listeners (clicks, keys, scroll-spy, resize). */
import { D } from '../data.js';
import { $, $$ } from '../dom.js';
import { closeRoute, openRoute, stepRoute } from '../drawer/drawer.js';
import { applyLayers, EMPTY, livePoll, liveStop, mapClose, mapOpen, mapShow, MP } from '../map/route-map.js';
import { S } from '../state.js';
import { csv, fromHash, renderAll, setGarage, setOp } from './actions.js';
import { gMenuRender } from './menus.js';
import { palClose, palIdx, palItems, palOpen, palPick, palRender, setPalIdx } from './palette.js';
import { renderMarket } from '../views/market.js';
import { renderGap } from '../views/gap.js';
import { renderPrice } from '../views/record.js';
import { renderRenewals, rnCsv } from '../views/renewals.js';
import { renderTable } from '../views/routes-table.js';
import { renderRunway } from '../views/runway.js';

document.addEventListener('click', e => {
  const t = e.target;
  const rw2 = t.closest('[data-rnwin]'); if(rw2){ S.rnWin = +rw2.dataset.rnwin; S.rnQ = null; S.rnShown = 25; renderRenewals(); return; }
  const rf = t.closest('[data-rnf]'); if(rf){ S.rnFilter = rf.dataset.rnf; S.rnQ = null; S.rnShown = 25; renderRenewals(); return; }
  const rq = t.closest('[data-rnq]'); if(rq){ S.rnQ = S.rnQ === rq.dataset.rnq ? null : rq.dataset.rnq; S.rnShown = 25; renderRenewals(); return; }
  if(t.closest('#rnMore')){ S.rnShown += 25; renderRenewals(); return; }
  if(t.closest('#rnCsv')){ rnCsv(); return; }
  const gr = t.closest('[data-gar]'); if(gr){ setGarage(gr.dataset.gar); return; }
  const op = t.closest('[data-op]'); if(op){ setOp(op.dataset.op); return; }
  const ml = t.closest('[data-ml]'); if(ml){ const k = ml.dataset.ml; S.ml[k] = !S.ml[k]; $$(`[data-ml="${k}"]`).forEach(c => { c.classList.toggle('on', S.ml[k]); c.setAttribute('aria-pressed', String(S.ml[k])); }); if(k === 'gar') $$('.garleg').forEach(e => e.hidden = !S.ml.gar);
    if(MP.map){ applyLayers(MP.map); if(k === 'live'){ if(S.ml.live) livePoll(D.byId.get(S.route), MP.tok); else { liveStop(); MP.map.getSource('live').setData(EMPTY); } } } return; }
  const dr = t.closest('[data-dir]'); if(dr){ S.dir = dr.dataset.dir; $$('.dirSeg button').forEach(b => b.classList.toggle('on', b.dataset.dir === S.dir)); mapShow(D.byId.get(S.route)); return; }
  const ex = t.closest('[data-expand]'); if(ex){ mapOpen(ex.dataset.expand); return; }
  if(t.closest('#mfClose')){ mapClose(); return; }

  const rl = t.closest('[data-real]'); if(rl){ S.real = rl.dataset.real === '1'; renderPrice(); return; }
  const gv = t.closest('[data-gapview]'); if(gv){ S.gapView = gv.dataset.gapview; renderGap(); return; }
  if(t.closest('#watchAll')){ S.flags.add('attn'); S.shown = 30; renderTable(); $('#routes').scrollIntoView({ behavior:'smooth', block:'start' }); return; }
  const m = t.closest('[data-metric]'); if(m){ S.metric = m.dataset.metric; renderMarket(); return; }
  const mv = t.closest('[data-mview]'); if(mv){ S.mView = mv.dataset.mview; renderMarket(); return; }
  const rw = t.closest('[data-rw]'); if(rw){ S.rwMetric = rw.dataset.rw; renderRunway(); return; }
  const rv = t.closest('[data-rwview]'); if(rv){ S.rwView = rv.dataset.rwview; renderRunway(); return; }
  const y = t.closest('[data-year]'); if(y){ const v = y.dataset.year === 'later' ? 'later' : +y.dataset.year; S.year = S.year === v ? null : v; S.shown = 30; renderRunway(); renderTable(); if(S.year != null) $('#routes').scrollIntoView({ behavior:'smooth', block:'start' }); return; }
  if(t.closest('[data-clearyear]')){ S.year = null; renderRunway(); renderTable(); return; }
  const p = t.closest('[data-prop]'); if(p){ S.prop = p.dataset.prop; S.shown = 30; renderTable(); return; }
  const f = t.closest('[data-flag]'); if(f){ S.flags.has(f.dataset.flag) ? S.flags.delete(f.dataset.flag) : S.flags.add(f.dataset.flag); S.shown = 30; renderTable(); return; }
  const th = t.closest('th[data-sort]'); if(th){ const k = th.dataset.sort; S.sort = S.sort.k === k ? { k, dir:-S.sort.dir } : { k, dir:k === 'id' || k === 'end' || k === 'next' ? 1 : -1 }; renderTable(); return; }
  if(t.closest('#moreBtn')){ S.shown += 30; renderTable(); return; }
  const row = t.closest('tr.row, .nx[data-r], .rnrow[data-r]'); if(row){ openRoute(row.dataset.r); return; }
  if(t.closest('#dClose') || t.id === 'scrim'){ closeRoute(); return; }
  if(t.closest('#dPrev')){ stepRoute(-1); return; } if(t.closest('#dNext')){ stepRoute(1); return; }
  if(t.closest('#opBtn')){ const o = $('#opMenu'); o.hidden = !o.hidden; $('#gMenu').hidden = true; $('#opBtn').setAttribute('aria-expanded', String(!o.hidden)); return; }
  if(t.closest('#gBtn')){ const o = $('#gMenu'); o.hidden = !o.hidden; $('#opMenu').hidden = true; $('#gBtn').setAttribute('aria-expanded', String(!o.hidden)); if(!o.hidden){ $('#gq').value = ''; gMenuRender(); $('#gq').focus(); } return; }
  if(!t.closest('.opsw')){ $('#opMenu').hidden = true; $('#gMenu').hidden = true; $('#opBtn').setAttribute('aria-expanded', 'false'); $('#gBtn').setAttribute('aria-expanded', 'false'); }
  if(t.closest('#searchBtn')){ palOpen(); return; }
  const pi = t.closest('[data-pi]'); if(pi){ palPick(+pi.dataset.pi); return; }
  if(t.id === 'pal'){ palClose(); return; }
  if(t.closest('#aboutBtn')){ $('#aboutM').hidden = false; return; } if(t.id === 'aboutM'){ $('#aboutM').hidden = true; return; }
  if(t.closest('#exportBtn')){ csv(); return; }
  if(t.closest('#linkBtn')){ navigator.clipboard?.writeText(location.href).then(() => { $('#linkTxt').textContent = 'Copied'; setTimeout(() => $('#linkTxt') && ($('#linkTxt').textContent = 'Copy link'), 1400); }); return; }
});
document.addEventListener('input', e => { if(e.target.id === 'gq') gMenuRender(); if(e.target.id === 'rq'){ S.q = e.target.value; S.shown = 30; const pos = e.target.selectionStart; renderTable(); const i = $('#rq'); i.focus(); i.setSelectionRange(pos, pos); } if(e.target.id === 'palIn'){ setPalIdx(0); palRender(); } });
document.addEventListener('keydown', e => {
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); $('#pal').hidden ? palOpen() : palClose(); return; }
  if(!$('#pal').hidden){
    if(e.key === 'Escape') palClose();
    else if(e.key === 'ArrowDown'){ e.preventDefault(); setPalIdx(Math.min(palItems.length - 1, palIdx + 1)); palRender(); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); setPalIdx(Math.max(0, palIdx - 1)); palRender(); }
    else if(e.key === 'Enter'){ e.preventDefault(); palPick(palIdx); }
    return;
  }
  if(e.key === 'Escape' && !$('#mapfs').hidden){ mapClose(); return; }
  if(e.key === 'Escape'){ if(!$('#aboutM').hidden) $('#aboutM').hidden = true; else if(S.route) closeRoute(); else { $('#opMenu').hidden = true; $('#gMenu').hidden = true; } return; }
  if(e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)){ e.preventDefault(); palOpen(); return; }
  if(S.route && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)){ if(e.key === 'ArrowRight') stepRoute(1); if(e.key === 'ArrowLeft') stepRoute(-1); }
  if((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('tr.row')){ e.preventDefault(); openRoute(e.target.dataset.r); }
});
document.addEventListener('pointerover', e => {                      // footprint ↔ table coupling
  const row = e.target.closest?.('tr.row'); $$('#foot path.hl').forEach(p => p.classList.remove('hl'));
  if(row) $(`#foot path[data-r="${CSS.escape(row.dataset.r)}"]`)?.classList.add('hl');
});
addEventListener('hashchange', () => { const r = fromHash(); renderAll(); r ? openRoute(r, false) : closeRoute(); });

$('#aboutBody').innerHTML = `<h2>Operator intelligence · v3 concept</h2><p style="margin:0;color:var(--ink-2)">A design exploration for the next evolution of this project: from a route explorer to an operator-level intelligence dashboard. Everything here is real data from the project's own open dataset; nothing is mocked.</p>
  <h5>The idea</h5><ul><li><b>One route brief, everywhere.</b> A route's shape, PVR, fleet, price, operated mileage, contract runway and next tender form one compact unit — a table row and the detail drawer show the same fields.</li><li><b>Operator KPIs are roll-ups of those fields,</b> so headline numbers always agree with the rows beneath them.</li><li><b>Market → Contracts → Fleet → Routes</b> is the reading order: where you stand, what is at risk, what you run, then every route.</li></ul>
  <h5>What is live</h5><ul><li>Operator switcher, ⌘K search, sortable and filterable routes, per-route drawer (←/→ to step), CSV export, shareable links.</li><li>Contract runway buckets are clickable and filter the table.</li><li><b>Electric price gap:</b> how much more TfL pays per mile when a route is awarded on electric buses rather than diesel or hybrid, per operator and for routes that changed hands.</li><li>Route shapes and the operator footprint are plain SVG from TfL geometry — no map tiles.</li></ul>
  <h5>Caveats worth knowing</h5><ul><li>Contract value is the sum of accepted annual bids per route's current contract — an estimate.</li><li>Tender record groups subsidiaries into their parent brand and counts only cross-group changes.</li><li>Operated mileage and reliability are the reported figures for the latest published period.</li></ul>
  <h5>Next ideas</h5><ul><li>Saved watchlists of routes.</li><li>Alerts when a contract nears its end or a tender is issued.</li><li>Garage-to-garage comparison and a depot-capacity forecast against the age-limit runway.</li><li>Scenario tool: what a re-tender at the network median price would change.</li></ul>
  <div style="margin-top:18px;display:flex;justify-content:flex-end"><button class="btn primary" id="aboutClose">Close</button></div>`;
$('#aboutClose').addEventListener('click', () => $('#aboutM').hidden = true);
