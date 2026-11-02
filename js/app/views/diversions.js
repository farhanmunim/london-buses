/* View: Diversions — current and historical route diversions (also exports helpers shared by Street works, Traffic orders and Mileage). */
import { D } from '../core/data.js';
import { gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { bindOpFilter, downloadCsv, esc, MONTH_NAMES, opFilterHtml, routeOperatorOf } from '../core/utils.js';

/* ════════════════════ DIVERSIONS & MILEAGE ════════════════════
   Two sibling pages (#/diversions, #/mileage) sharing the same data layer:
   the diversion history feeds both — the mileage table counts overlapping
   history entries per route. Shared row/format helpers live here. */
export const DIVN_PAGE = 20;
export const ddMMM = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d)
  ? `${String(d.getDate()).padStart(2,'0')} ${MONTH_NAMES[d.getMonth()]}` : '—'; };
export const ddMMMhm = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d)
  ? `${String(d.getDate()).padStart(2,'0')} ${MONTH_NAMES[d.getMonth()]} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '—'; };
export const divnRouteChip = r => `<a class="rchip" style="padding:1px 7px;font-size:11px" href="#/route/${encodeURIComponent(r)}">${esc(r)}</a>`;
export const divnInputCss = 'border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 12px;font-size:13px;color:var(--tx)';
export const divnSorted = hist => [...hist.entries].sort((a,b) => String(b.lastSeen ?? '').localeCompare(String(a.lastSeen ?? '')));

export async function renderDiversions(){
  const tok = state.navToken;
  main.innerHTML = `<div class="wrap"><div class="skel" style="height:46px;width:50%"></div></div>`;
  const [hist, dMeta] = await Promise.all([D.divHistory(), D.meta()]);
  if(gone(tok)) return;
  if(!hist?.entries?.length){
    main.innerHTML = `<div class="wrap"><div class="empty">The diversion history is unreachable right now — try again shortly.</div></div>`;
    return;
  }
  const all = divnSorted(hist);
  for(const e of all) e.currentOperator = routeOperatorOf(dMeta, e.route);
  const dOps = [...new Set(all.map(e => e.currentOperator).filter(Boolean))].sort();
  const PAGE = DIVN_PAGE, routeChip = divnRouteChip, inputCss = divnInputCss;
  const CAT_LABEL = { PlannedWork:'Planned', RealTime:'Unplanned', Event:'Event' };
  /* Badges reuse the site's existing accent/warn/muted vars — no new palette. */
  const badgeCss = 'display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-radius:5px;padding:2px 6px';
  const badge = c => c === 'PlannedWork'
    ? `<span class="dbadge" style="${badgeCss};color:var(--acc);background:var(--acc-soft)">Planned</span>`
    : c === 'RealTime'
    ? `<span class="dbadge" style="${badgeCss};color:var(--warn);background:color-mix(in srgb, var(--warn) 14%, transparent)">Unplanned</span>`
    : `<span class="dbadge" style="${badgeCss};color:var(--tx2);background:var(--surf2)">Event</span>`;
  const trunc = s => { s = String(s ?? ''); return s.length > 120 ? s.slice(0, 119) + '…' : s; };

  main.innerHTML = `<div class="wrap">
    <div id="dhead"><h1 style="margin:2px 0 4px">Diversions</h1>
      <div style="color:var(--tx2);font-size:13.5px">The full <b>diversion history</b> day by day (${all.length.toLocaleString('en-GB')} entries). Filter, and export as CSV.</div>
      <div style="color:var(--mu);font-size:12px;margin-top:6px">History accumulated from status snapshots since ${esc(ddMMM(hist.firstObservedAt))} ${esc(String(new Date(hist.firstObservedAt ?? 0).getFullYear() || ''))} (~5-8 snapshots/day). No historical diversion feed exists, so it is built up over time. <a href="#/mileage" style="color:var(--mu);font-weight:600;text-decoration:underline dotted">Mileage by period →</a> · <a href="#/streetworks" style="color:var(--mu);font-weight:600;text-decoration:underline dotted">Street works →</a></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center">
      <input id="dq" type="search" aria-label="Search diversions by route" placeholder="Search route (e.g. 24)" style="flex:1;min-width:140px;max-width:240px;border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 15px;font-size:13.5px;color:var(--tx)">
      <select id="dty" aria-label="Filter by diversion type" style="${inputCss}">
        <option value="">All types</option><option value="PlannedWork">Planned</option><option value="RealTime">Unplanned</option><option value="Event">Event</option></select>
      ${opFilterHtml('dop', dOps)}
      <input id="dday" type="date" aria-label="Show diversions observed on this day" title="Show only diversions observed on this day" style="${inputCss}">
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--tx2)"><input id="dact" type="checkbox">Active only</label>
      <button class="livebtn" id="dExport" title="Downloads every diversion matching the current filters"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>Export CSV</button>
    </div>
    <div class="section"><div class="section-h" id="dCount"></div>
      <div class="card" style="overflow-x:auto"><table class="cpi-table" style="min-width:1080px">
        <thead><tr>
          <th>Route</th><th>Type</th><th>Stated window</th><th>First seen</th><th>Last seen</th>
          <th class="num" title="Distinct days this diversion was observed in the snapshots">Days observed</th>
          <th style="text-align:center">Active</th><th>Reason</th>
        </tr></thead>
        <tbody id="dBody"></tbody>
      </table></div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <button class="livebtn" id="dPrev">‹ Prev</button>
        <span id="dPage" style="font-size:12.5px;color:var(--tx2)"></span>
        <button class="livebtn" id="dNext">Next ›</button>
      </div>
      <div class="legendrow" style="margin-top:8px"><span>Accumulated per status refresh (${(hist.snapshotCount ?? 0).toLocaleString('en-GB')} snapshots so far). Stated window = the dates in the notice; first/last seen = when this site's snapshots actually observed it; days observed = distinct days it appeared (hover for the list). Pick a date to see everything observed that day.</span></div>
    </div>
  </div>`;

  /* ── History table ── */
  const st = { q:'', ty:'', op:'', act:false, day:'', page:0 };
  const filtered = () => {
    const q = st.q.trim().toUpperCase();
    // Routes match EXACTLY, same rule as the tenders route search.
    return all.filter(e =>
      (!q || String(e.route ?? '').toUpperCase().split('/').some(t => t.trim() === q))
      && (!st.op || e.currentOperator === st.op)
      && (!st.ty || e.category === st.ty)
      && (!st.act || e.active)
      && (!st.day || (e.days ?? []).includes(st.day)));
  };
  function draw(){
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    const shown = list.slice(st.page * PAGE, st.page * PAGE + PAGE);
    document.getElementById('dBody').innerHTML = shown.map(e => `<tr>
      <td title="${esc(e.currentOperator ?? '')}">${routeChip(e.route)}</td>
      <td>${badge(e.category)}</td>
      <td style="white-space:nowrap">${ddMMM(e.since)} → ${ddMMM(e.until)}</td>
      <td class="num" style="text-align:left;white-space:nowrap">${ddMMMhm(e.firstSeen)}</td>
      <td class="num" style="text-align:left;white-space:nowrap">${ddMMMhm(e.lastSeen)}</td>
      <td class="num" title="${esc((e.days ?? []).join(', '))}">${(e.days ?? []).length}</td>
      <td style="text-align:center">${e.active ? '<span style="color:var(--good);font-weight:700" title="Still present in the latest snapshot">✓</span>' : '<span style="color:var(--mu)">—</span>'}</td>
      <td style="max-width:460px;font-size:12px;line-height:1.4" title="${esc(e.reason ?? '')}">${esc(trunc(e.reason))}</td></tr>`).join('');
    document.getElementById('dCount').textContent =
      `${list.length.toLocaleString('en-GB')} diversion${list.length === 1 ? '' : 's'}${list.length !== all.length ? ` (of ${all.length.toLocaleString('en-GB')})` : ''}`;
    document.getElementById('dPage').textContent = `Page ${st.page + 1} of ${pages}`;
    document.getElementById('dPrev').disabled = st.page === 0;
    document.getElementById('dNext').disabled = st.page >= pages - 1;
  }
  draw();
  let deb;
  document.getElementById('dq').addEventListener('input', e => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; st.page = 0; draw(); }, 150); });
  document.getElementById('dty').addEventListener('change', e => { st.ty = e.target.value; st.page = 0; draw(); });
  bindOpFilter('dop', v => { st.op = v; st.page = 0; draw(); });
  document.getElementById('dday').addEventListener('change', e => { st.day = e.target.value; st.page = 0; draw(); });
  document.getElementById('dact').addEventListener('change', e => { st.act = e.target.checked; st.page = 0; draw(); });
  document.getElementById('dPrev').addEventListener('click', () => { st.page = Math.max(0, st.page - 1); draw(); });
  document.getElementById('dNext').addEventListener('click', () => { st.page = st.page + 1; draw(); });
  document.getElementById('dExport').addEventListener('click', () => {
    downloadCsv('london-bus-diversions.csv', [
      ['route','type','scheduled','stated_since','stated_until','first_seen','last_seen','observations','days_observed','days','active','reason'],
      ...filtered().map(e => [e.route ?? '', CAT_LABEL[e.category] ?? e.category ?? '', e.scheduled ? 'yes' : 'no',
        e.since ?? '', e.until ?? '', e.firstSeen ?? '', e.lastSeen ?? '', Number.isFinite(e.observations) ? e.observations : '',
        (e.days ?? []).length, (e.days ?? []).join(' '), e.active ? 'yes' : 'no', e.reason ?? '']),
    ]);
  });

}
