/* View: Street works. */
import { D } from '../core/data.js';
import { gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { downloadCsv, esc, title } from '../core/utils.js';
import { ddMMM, ddMMMhm, DIVN_PAGE, divnInputCss } from './diversions.js';

/* ════════════════════ STREET WORKS ════════════════════
   The Street Manager archive: every permitted street work in the 33
   London highway authorities + TfL, pushed live over SNS to this site's
   receiver and folded into streetworks-history.json every drain. Works
   aren't joined to bus routes yet (coordinates arrive as OSGB grid WKT —
   the corridor join is a follow-up), so the page slices by borough,
   street, promoter and status instead. */
export async function renderStreetworks(){
  const tok = state.navToken;
  main.innerHTML = `<div class="wrap"><div class="skel" style="height:46px;width:50%"></div></div>`;
  const sw = await D.streetworks();
  if(gone(tok)) return;
  if(!sw?.entries?.length){
    main.innerHTML = `<div class="wrap"><div class="empty">No street works archived yet — the feed went live on 18 Sep 2026 and fills as events arrive. Try again shortly.</div></div>`;
    return;
  }
  const PAGE = DIVN_PAGE, inputCss = divnInputCss;
  /* Three payload shapes share the archive — PERMIT (work_*), ACTIVITY
     (activity_*: events, coordination notices) and Section 58 restrictions —
     so every field falls back across them, and ref-form values
     ("road_closure") are prettified. */
  const pretty = s => s && /_/.test(s) ? title(String(s).replaceAll('_', ' ')) : s;
  const rows = sw.entries.map(e => {
    const l = e.latest ?? {};
    return {
      ref: e.ref, ha: e.ha ?? '—',
      street: title(l.street_name ?? '') || '—', town: title(l.town ?? ''),
      promoter: title(l.promoter_organisation ?? '') || '—',
      category: l.work_category ?? (l.activity_type ? title(pretty(l.activity_type)) : e.objectType === 'SECTION_58' ? 'Restriction' : '—'),
      tm: pretty(l.traffic_management_type ?? l.activity_location_type) ?? '—',
      status: l.work_status ?? (l.activity_name ? 'Notified' : '—'), permit: l.permit_status ?? null,
      detail: l.activity_name ?? l.activity_location_description ?? null,
      sensitive: l.is_traffic_sensitive === 'Yes',
      start: l.actual_start_date_time ?? l.proposed_start_date ?? l.start_date ?? null,
      end: l.actual_end_date_time ?? l.proposed_end_date ?? l.end_date ?? null,
      lastType: e.lastType ?? e.events?.[e.events.length - 1]?.type ?? null,
      lastEvent: e.lastEvent, nEvents: e.nEvents ?? e.events?.length ?? 0,
    };
  }).sort((a, b) => String(b.lastEvent ?? '').localeCompare(String(a.lastEvent ?? '')));
  const has = sel => [...new Set(rows.map(sel).filter(v => v && v !== '—'))].sort();
  const boroughs = has(r => r.ha), cats = has(r => r.category), stats = has(r => r.status);
  const evLabel = t => t ? (t.charAt(0) + t.slice(1).toLowerCase()).replaceAll('_', ' ') : '—';
  const badgeCss = 'display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-radius:5px;padding:2px 6px';
  const catBadge = c => c === 'Immediate' || c === 'Immediate - urgent' || c === 'Immediate - emergency'
    ? `<span style="${badgeCss};color:var(--warn);background:color-mix(in srgb, var(--warn) 14%, transparent)">${esc(c)}</span>`
    : c === 'Major'
    ? `<span style="${badgeCss};color:var(--acc);background:var(--acc-soft)">Major</span>`
    : `<span style="${badgeCss};color:var(--tx2);background:var(--surf2)">${esc(c)}</span>`;
  const permitChip = p => !p ? ''
    : p === 'refused' || p === 'revoked'
    ? ` <span style="font-size:10.5px;font-weight:700;color:var(--warn)" title="Latest permit decision">permit ${esc(p)}</span>`
    : p === 'granted'
    ? ` <span style="font-size:10.5px;font-weight:700;color:var(--good)" title="Latest permit decision">permit granted</span>` : '';

  main.innerHTML = `<div class="wrap">
    <div><h1 style="margin:2px 0 4px">Street works</h1>
      <div style="color:var(--tx2);font-size:13.5px">The <b>statutory street-works record</b> for London — every permit and work event for the 33 London highway authorities + TfL (${rows.length.toLocaleString('en-GB')} works so far). Filter, and export as CSV.</div>
      <div style="color:var(--mu);font-size:12px;margin-top:6px">Updated live since 18 Sep 2026; the archive folds new events roughly every 2 h. Works aren't matched to bus routes yet — for roadworks already joined to routes see each route's page, for the legal orders behind closures the <a href="#/tro" style="color:var(--mu);font-weight:600;text-decoration:underline dotted">traffic orders →</a>, and for notified diversions the <a href="#/diversions" style="color:var(--mu);font-weight:600;text-decoration:underline dotted">diversion history →</a></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center">
      <input id="swq" type="search" aria-label="Search street works" placeholder="Search street, ref or promoter" style="flex:1;min-width:160px;max-width:280px;border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 15px;font-size:13.5px;color:var(--tx)">
      <select id="swha" aria-label="Filter by highway authority" style="${inputCss}"><option value="">All boroughs</option>${boroughs.map(b => `<option>${esc(b)}</option>`).join('')}</select>
      <select id="swcat" aria-label="Filter by work category" style="${inputCss}"><option value="">All categories</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select>
      <select id="swst" aria-label="Filter by work status" style="${inputCss}"><option value="">All statuses</option>${stats.map(s => `<option>${esc(s)}</option>`).join('')}</select>
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--tx2)"><input id="swsen" type="checkbox">Traffic-sensitive only</label>
      <button class="livebtn" id="swExport" title="Downloads every work matching the current filters"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>Export CSV</button>
    </div>
    <div class="section"><div class="section-h" id="swCount"></div>
      <div class="card" style="overflow-x:auto"><table class="cpi-table" style="min-width:1100px">
        <thead><tr>
          <th>Street</th><th>Borough</th><th>Promoter</th><th>Category</th>
          <th>Traffic management</th><th>Status</th><th>Window</th><th>Latest event</th>
        </tr></thead>
        <tbody id="swBody"></tbody>
      </table></div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <button class="livebtn" id="swPrev">‹ Prev</button>
        <span id="swPage" style="font-size:12.5px;color:var(--tx2)"></span>
        <button class="livebtn" id="swNext">Next ›</button>
      </div>
      <div class="legendrow" style="margin-top:8px"><span>The statutory register utilities and boroughs work from, filtered to London's highway authorities. Window = actual dates where reported, otherwise the permit's proposed dates. ⚠ marks streets the authority flags traffic-sensitive. Archive starts 18 Sep 2026 (there is no earlier history to backfill from).</span></div>
    </div>
  </div>`;

  const st = { q:'', ha:'', cat:'', stat:'', sen:false, page:0 };
  const filtered = () => {
    const q = st.q.trim().toUpperCase();
    return rows.filter(r =>
      (!q || r.street.toUpperCase().includes(q) || r.ref.toUpperCase().includes(q) || r.promoter.toUpperCase().includes(q))
      && (!st.ha || r.ha === st.ha)
      && (!st.cat || r.category === st.cat)
      && (!st.stat || r.status === st.stat)
      && (!st.sen || r.sensitive));
  };
  function draw(){
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    document.getElementById('swBody').innerHTML = list.slice(st.page * PAGE, st.page * PAGE + PAGE).map(r => `<tr>
      <td style="max-width:230px" title="${esc(r.ref)}"><b>${esc(r.street)}</b>${r.sensitive ? ' <span title="Traffic-sensitive street" style="color:var(--warn)">⚠</span>' : ''}${r.town ? `<div style="font-size:11px;color:var(--mu)">${esc(r.town)}</div>` : ''}</td>
      <td style="font-size:12px;white-space:nowrap">${esc(r.ha)}</td>
      <td style="max-width:200px;font-size:12px" title="${esc(r.promoter)}">${esc(r.promoter)}</td>
      <td>${catBadge(r.category)}</td>
      <td style="max-width:180px;font-size:12px">${esc(r.tm)}</td>
      <td style="font-size:12px;white-space:nowrap" title="${esc(r.detail ?? '')}">${esc(r.status)}${permitChip(r.permit)}</td>
      <td style="white-space:nowrap">${ddMMM(r.start)} → ${ddMMM(r.end)}</td>
      <td style="white-space:nowrap;font-size:12px" title="${r.nEvents} event${r.nEvents === 1 ? '' : 's'} recorded">${esc(evLabel(r.lastType))}<div style="font-size:11px;color:var(--mu)">${ddMMMhm(r.lastEvent)}</div></td></tr>`).join('');
    document.getElementById('swCount').textContent =
      `${list.length.toLocaleString('en-GB')} work${list.length === 1 ? '' : 's'}${list.length !== rows.length ? ` (of ${rows.length.toLocaleString('en-GB')})` : ''}`;
    document.getElementById('swPage').textContent = `Page ${st.page + 1} of ${pages}`;
    document.getElementById('swPrev').disabled = st.page === 0;
    document.getElementById('swNext').disabled = st.page >= pages - 1;
  }
  draw();
  let deb;
  document.getElementById('swq').addEventListener('input', e => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; st.page = 0; draw(); }, 150); });
  document.getElementById('swha').addEventListener('change', e => { st.ha = e.target.value; st.page = 0; draw(); });
  document.getElementById('swcat').addEventListener('change', e => { st.cat = e.target.value; st.page = 0; draw(); });
  document.getElementById('swst').addEventListener('change', e => { st.stat = e.target.value; st.page = 0; draw(); });
  document.getElementById('swsen').addEventListener('change', e => { st.sen = e.target.checked; st.page = 0; draw(); });
  document.getElementById('swPrev').addEventListener('click', () => { st.page = Math.max(0, st.page - 1); draw(); });
  document.getElementById('swNext').addEventListener('click', () => { st.page = st.page + 1; draw(); });
  document.getElementById('swExport').addEventListener('click', () => {
    downloadCsv('london-street-works.csv', [
      ['reference','street','town','borough','promoter','category','traffic_management','status','permit_status','traffic_sensitive','window_start','window_end','latest_event','latest_event_time','events_recorded'],
      ...filtered().map(r => [r.ref, r.street, r.town, r.ha, r.promoter, r.category, r.tm, r.status, r.permit ?? '',
        r.sensitive ? 'yes' : 'no', r.start ?? '', r.end ?? '', r.lastType ?? '', r.lastEvent ?? '', r.nEvents]),
    ]);
  });
}
