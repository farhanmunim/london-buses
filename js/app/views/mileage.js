/* View: Mileage. */
import { D } from '../core/data.js';
import { gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { bindOpFilter, cmpRoute, downloadCsv, esc, num, opFilterHtml, routeOperatorOf } from '../core/utils.js';
import { DIVN_PAGE, divnInputCss, divnRouteChip, divnSorted } from './diversions.js';

/* ════════════════════ MILEAGE ════════════════════ */
export async function renderMileage(){
  const tok = state.navToken;
  main.innerHTML = `<div class="wrap"><div class="skel" style="height:46px;width:50%"></div></div>`;
  const PAGE = DIVN_PAGE, routeChip = divnRouteChip, inputCss = divnInputCss;
  /* Joins TfL QSI/mileage per-period figures with timetable-derived
     scheduled km, plus this site's own diversion history for the newest
     period's diversion counts. Either mileage file may not exist yet while
     its crawler finishes its first run — the page degrades to a note, never
     an error. */
  const [perf, sched, hist, mMeta] = await Promise.all([D.routePerf(), D.schedMiles(), D.divHistory(), D.meta()]);
  if(gone(tok)) return;
  const all = hist?.entries?.length ? divnSorted(hist) : [];
  main.innerHTML = `<div class="wrap">
    <div id="dhead"><h1 style="margin:2px 0 4px">Mileage</h1>
      <div style="color:var(--tx2);font-size:13.5px">Explain a route's lost mileage: scheduled-vs-operated <b>mileage per reporting period</b>, joined with the <a href="#/diversions" style="color:var(--acc);font-weight:500">diversion history</a>. Filter, and export as CSV.</div></div>
    <div class="section" style="margin-top:14px"><div class="section-h" style="display:flex;align-items:center;gap:10px">Scheduled vs operated mileage<span id="mCount" style="text-transform:none;letter-spacing:0;color:var(--mu);font-weight:500"></span>
      <button class="livebtn" id="mExport" style="margin-left:auto" title="Downloads every row matching the current filters"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>Export CSV</button></div>
      <div id="mWrap"><div class="skel" style="height:46px;width:60%"></div></div>
    </div>
  </div>`;
  const mWrap = document.getElementById('mWrap');
  if(!perf?.periods?.length || !perf?.routes){
    mWrap.innerHTML = `<div class="empty" style="padding:28px 0">The per-period performance dataset is still building — its crawler hasn't published <span style="font-family:var(--mono)">route-performance.json</span> yet. Check back soon.</div>`;
    document.getElementById('mExport').hidden = true;
    return;
  }
  const perfRoutes = perf.routes;
  const periods = perf.periods;                       // oldest → newest
  const newest = periods[periods.length - 1];
  const periodsDesc = [...periods].reverse();
  const schedRoutes = sched?.routes ?? null;
  const estKm = id => {
    const dk = schedRoutes?.[id]?.dailyKm;
    if(!dk) return null;
    // A TfL reporting period is 28 days ≈ 20 weekdays + 4 Saturdays + 4 Sundays.
    const v = 20 * (dk.weekday ?? 0) + 4 * (dk.saturday ?? 0) + 4 * (dk.sunday ?? 0);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  /* Diversion counts: TfL doesn't publish the period calendar, so the only
     period we can honestly date is the newest one — approximate it as the
     last 28 days and count history entries whose [firstSeen, lastSeen]
     overlaps that window. Every other period shows "—". */
  const nowMs = Date.now(), cutoff28 = nowMs - 28 * 864e5;
  const div28 = {};
  for(const e of all){
    const f = Date.parse(e.firstSeen ?? ''), l = Date.parse(e.lastSeen ?? '');
    if(Number.isFinite(f) && Number.isFinite(l) && f <= nowMs && l >= cutoff28){
      const k = String(e.route ?? '').toUpperCase();
      div28[k] = (div28[k] ?? 0) + 1;
    }
  }
  const routeIds = Object.keys(perfRoutes).sort(cmpRoute);
  /* Current operator per route — same route-meta resolution (N-prefix
     fallback) the diversions page and the programme tab use. */
  const mOpOf = {};
  for(const id of routeIds) mOpOf[id] = routeOperatorOf(mMeta, id);
  const mOps = [...new Set(Object.values(mOpOf).filter(Boolean))].sort();
  mWrap.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
      <input id="mq" type="search" aria-label="Search mileage by route" placeholder="Search route (e.g. 24) — shows all its periods" style="flex:1;min-width:140px;max-width:280px;border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 15px;font-size:13.5px;color:var(--tx)">
      <select id="mper" aria-label="Reporting period" style="${inputCss}">${periodsDesc.map(p => `<option${p === newest ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
      ${opFilterHtml('mop', mOps)}
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--tx2)"><input id="mbelow" type="checkbox">Below standard only</label>
    </div>
    <div class="card" style="overflow-x:auto"><table class="cpi-table" style="min-width:980px">
      <thead><tr>
        <th>Route</th><th>Period</th>
        <th class="num" title="Kilometres operated as % of schedule — red when below the route's contractual minimum standard">Operated %</th>
        <th class="num" title="Contractual minimum operated-mileage standard">Min std</th>
        <th class="num" title="Route reliability for the period, in the route's own metric">Reliability</th>
        <th class="num" title="Estimate: dailyKm × (20 weekday + 4 Saturday + 4 Sunday) per 28-day period, from the current timetable${schedRoutes ? '' : ' — scheduled-mileage data building…'}">Est. scheduled km</th>
        <th class="num" title="Est. scheduled km × (100 − operated %) ÷ 100${schedRoutes ? '' : ' — scheduled-mileage data building…'}">Est. lost km</th>
        <th class="num" title="Diversion-history entries overlapping the period. Only computable for the newest period (approximated as the last 28 days) — period calendar dates aren't published"><a href="#/diversions" style="color:inherit;text-decoration:underline dotted" title="Open the full diversion history">Diversions</a></th>
      </tr></thead>
      <tbody id="mBody"></tbody>
    </table></div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
      <button class="livebtn" id="mPrev">‹ Prev</button>
      <span id="mPage" style="font-size:12.5px;color:var(--tx2)"></span>
      <button class="livebtn" id="mNext">Next ›</button>
    </div>
    <div class="legendrow" style="margin-top:8px"><span>${schedRoutes ? 'Scheduled km are timetable-derived estimates (20 weekdays + 4 Saturdays + 4 Sundays per 28-day period). ' : ''}Search a route to see every period for it; otherwise one row per route for the selected period. Diversion counts use the <a href="#/diversions" style="color:var(--acc)">diversion history</a>'s snapshots and are only computable for the newest period (last 28 days) — period calendar dates aren't published.${schedRoutes ? '' : ' The scheduled-mileage dataset hasn’t been published yet, so the est. km columns show — for now.'}</span></div>`;
  const mst = { q:'', per:newest, op:'', below:false, page:0 };
  const rowFor = (id, per) => {
    const p = perfRoutes[id] ?? {};
    const op = num(p.operatedPct?.[per]);
    const ek = estKm(id);
    return {
      route:id, period:per, op, minStd:num(p.operatedMinStandard),
      rel:num(p.reliability?.[per]), metric:p.reliabilityMetric ?? '',
      ek, lost:(op != null && ek != null) ? Math.round(ek * (100 - op) / 100) : null,
      div: per === newest ? (div28[String(id).toUpperCase()] ?? 0) : null,
    };
  };
  const mFiltered = () => {
    const q = mst.q.trim().toUpperCase();
    let rows;
    if(q){
      const id = routeIds.find(r => String(r).toUpperCase() === q);
      rows = id ? periodsDesc.map(per => rowFor(id, per)) : [];
    } else {
      rows = routeIds.map(id => rowFor(id, mst.per));
    }
    rows = rows.filter(r => r.op != null || r.rel != null);
    if(mst.op) rows = rows.filter(r => mOpOf[r.route] === mst.op);
    if(mst.below) rows = rows.filter(r => r.op != null && r.minStd != null && r.op < r.minStd);
    return rows;
  };
  function mDraw(){
    const list = mFiltered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    mst.page = Math.min(mst.page, pages - 1);
    const shown = list.slice(mst.page * PAGE, mst.page * PAGE + PAGE);
    document.getElementById('mBody').innerHTML = shown.length ? shown.map(r => `<tr>
      <td>${routeChip(r.route)}</td>
      <td class="num" style="text-align:left;white-space:nowrap">${esc(r.period)}</td>
      <td class="num"${r.op != null && r.minStd != null && r.op < r.minStd ? ' style="color:var(--bad);font-weight:600" title="Below the contractual minimum standard"' : ''}>${r.op != null ? r.op.toFixed(1) + '%' : '—'}</td>
      <td class="num">${r.minStd != null ? r.minStd.toFixed(1) + '%' : '—'}</td>
      <td class="num" style="white-space:nowrap">${r.rel != null ? esc(String(r.rel)) + ' <span style="color:var(--mu);font-size:11px">' + esc(r.metric) + '</span>' : '—'}</td>
      <td class="num" title="Estimated from the current timetable — 20 weekdays + 4 Saturdays + 4 Sundays">${r.ek != null ? '<span style="color:var(--mu);font-size:10.5px">est.</span> ' + Math.round(r.ek).toLocaleString('en-GB') : '—'}</td>
      <td class="num">${r.lost != null ? r.lost.toLocaleString('en-GB') : '—'}</td>
      <td class="num">${r.div != null ? `<a href="#/diversions" style="color:inherit" title="Open the full diversion history">${r.div}</a>` : '<span title="period dates not published" style="color:var(--mu)">—</span>'}</td></tr>`).join('')
      : `<tr><td colspan="8" style="color:var(--mu);padding:18px 14px">No rows match — route search is exact (e.g. 24), and only routes in TfL's per-route reports appear.</td></tr>`;
    document.getElementById('mCount').textContent = ` · ${list.length.toLocaleString('en-GB')} row${list.length === 1 ? '' : 's'}${mst.q.trim() ? '' : ` · ${mst.per}`}`;
    document.getElementById('mPage').textContent = `Page ${mst.page + 1} of ${pages}`;
    document.getElementById('mPrev').disabled = mst.page === 0;
    document.getElementById('mNext').disabled = mst.page >= pages - 1;
  }
  mDraw();
  let mdeb;
  document.getElementById('mq').addEventListener('input', e => { clearTimeout(mdeb); mdeb = setTimeout(() => { mst.q = e.target.value; mst.page = 0; mDraw(); }, 150); });
  document.getElementById('mper').addEventListener('change', e => { mst.per = e.target.value; mst.page = 0; mDraw(); });
  bindOpFilter('mop', v => { mst.op = v; mst.page = 0; mDraw(); });
  document.getElementById('mbelow').addEventListener('change', e => { mst.below = e.target.checked; mst.page = 0; mDraw(); });
  document.getElementById('mPrev').addEventListener('click', () => { mst.page = Math.max(0, mst.page - 1); mDraw(); });
  document.getElementById('mNext').addEventListener('click', () => { mst.page = mst.page + 1; mDraw(); });
  document.getElementById('mExport').addEventListener('click', () => {
    downloadCsv('london-bus-mileage.csv', [
      ['route','period','operated_pct','operated_min_standard','reliability','reliability_metric','est_scheduled_km','est_lost_km','diversions_last_28d'],
      ...mFiltered().map(r => [r.route, r.period, r.op ?? '', r.minStd ?? '', r.rel ?? '', r.metric, r.ek != null ? Math.round(r.ek) : '', r.lost ?? '', r.div ?? '']),
    ]);
  });
}
