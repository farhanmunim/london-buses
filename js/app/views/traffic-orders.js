/* View: Traffic orders (D-TRO). */
import { D, troPretty } from '../core/data.js';
import { gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { downloadCsv, esc, title } from '../core/utils.js';
import { ddMMM, DIVN_PAGE, divnInputCss, divnRouteChip } from './diversions.js';

/* ════════════════════ TRAFFIC ORDERS ════════════════════
   DfT's D-TRO service — the statutory digital record of traffic regulation
   orders (closures, bus lanes and gates, banned turns, one-ways, kerbside
   rules). The pipeline searches a Greater London polygon and keeps the
   bus-relevant orders; publication is mandatory for new orders from autumn
   2026, so coverage grows as each authority onboards. */
export async function renderTro(){
  const tok = state.navToken;
  main.innerHTML = `<div class="wrap"><div class="skel" style="height:46px;width:50%"></div></div>`;
  const snap = await D.dtro();
  if(gone(tok)) return;
  if(!snap?.orders?.length){
    main.innerHTML = `<div class="wrap"><div class="empty">No traffic regulation orders fetched yet — the feed refreshes regularly. Try again shortly.</div></div>`;
    return;
  }
  const PAGE = DIVN_PAGE, inputCss = divnInputCss, routeChip = divnRouteChip;
  const now = new Date().toISOString();
  const rows = snap.orders.map(o => {
    const provs = o.provisions ?? [];
    const regs = [...new Set(provs.flatMap(p => p.regulationTypes ?? []))];
    const starts = provs.map(p => p.start).filter(Boolean).sort();
    const ends = provs.map(p => p.end).filter(Boolean).sort();
    const start = starts[0] ?? null, end = ends.pop() ?? null;
    const status = start && start > now ? 'Upcoming' : end && end < now ? 'Ended' : start || end ? 'Current' : '—';
    return {
      id: o.id, name: o.troName ?? 'Traffic regulation order',
      authority: title(o.traName ?? '') || String(o.tra ?? '—'),
      regs, regsPretty: regs.map(troPretty),
      temporary: provs.some(p => /^tt[rm]o/i.test(p.orderReportingPoint ?? '')),
      desc: provs.map(p => p.description).find(Boolean) ?? provs.flatMap(p => p.places ?? []).map(pl => pl.description).find(Boolean) ?? '',
      start, end, status, published: o.publicationTime ?? null,
      routes: o.routes ?? [], hasDiversion: provs.some(p => (p.places ?? []).some(pl => pl.type === 'diversionRoute')),
    };
  }).sort((a, b) => String(b.published ?? '').localeCompare(String(a.published ?? '')));
  const authorities = [...new Set(rows.map(r => r.authority))].sort();
  const regOptions = [...new Set(rows.flatMap(r => r.regsPretty))].sort();
  const auth = snap.publishingAuthorities ?? {};
  const authNote = Object.entries(auth).sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `${title(n)} (${c})`).join(', ');

  main.innerHTML = `<div class="wrap">
    <div><h1 style="margin:2px 0 4px">Traffic orders</h1>
      <div style="color:var(--tx2);font-size:13.5px">The <b>statutory traffic regulation orders</b> shaping how buses move — road closures, bus lanes and gates, banned turns and one-ways, filtered to the ${rows.length.toLocaleString('en-GB')} bus-relevant orders in Greater London (of ${(snap.totalOrders ?? rows.length).toLocaleString('en-GB')} fetched). Filter, and export as CSV.</div>
      <div style="color:var(--mu);font-size:12px;margin-top:6px">Publication is mandatory for new orders from autumn 2026, so coverage grows as each authority onboards. Orders within 35 m of a route's corridor carry route chips; closures often include the <b style="color:var(--tx2)">official diversion route</b>, drawn on each route's map. See also <a href="#/streetworks" style="color:var(--mu);font-weight:600;text-decoration:underline dotted">street works →</a> and <a href="#/diversions" style="color:var(--mu);font-weight:600;text-decoration:underline dotted">diversions →</a></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center">
      <input id="troq" type="search" aria-label="Search traffic orders" placeholder="Search order, street or authority" style="flex:1;min-width:160px;max-width:280px;border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 15px;font-size:13.5px;color:var(--tx)">
      <select id="troauth" aria-label="Filter by authority" style="${inputCss}"><option value="">All authorities</option>${authorities.map(a => `<option>${esc(a)}</option>`).join('')}</select>
      <select id="troreg" aria-label="Filter by regulation type" style="${inputCss}"><option value="">All regulation types</option>${regOptions.map(r => `<option>${esc(r)}</option>`).join('')}</select>
      <select id="trost" aria-label="Filter by status" style="${inputCss}"><option value="">Any status</option><option>Current</option><option>Upcoming</option><option>Ended</option></select>
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--tx2)"><input id="troroutes" type="checkbox">On a route corridor only</label>
      <button class="livebtn" id="troExport" title="Downloads every order matching the current filters"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>Export CSV</button>
    </div>
    <div class="section"><div class="section-h" id="troCount"></div>
      <div class="card" style="overflow-x:auto"><table class="cpi-table" style="min-width:1050px">
        <thead><tr>
          <th>Order</th><th>Authority</th><th>Regulations</th><th>Status</th><th>Window</th><th>Published</th><th>Routes</th>
        </tr></thead>
        <tbody id="troBody"></tbody>
      </table></div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <button class="livebtn" id="troPrev">‹ Prev</button>
        <span id="troPage" style="font-size:12.5px;color:var(--tx2)"></span>
        <button class="livebtn" id="troNext">Next ›</button>
      </div>
      <div class="legendrow" style="margin-top:8px"><span>The legal orders themselves, not works or observations. Publishing so far: ${esc(authNote) || '—'}. Neighbouring counties appear because the search polygon covers the whole network's extent. ⤳ marks orders that publish an official diversion route.</span></div>
    </div>
  </div>`;

  const st = { q:'', auth:'', reg:'', stat:'', onRoutes:false, page:0 };
  const filtered = () => {
    const q = st.q.trim().toUpperCase();
    return rows.filter(r =>
      (!q || r.name.toUpperCase().includes(q) || r.authority.toUpperCase().includes(q) || r.desc.toUpperCase().includes(q))
      && (!st.auth || r.authority === st.auth)
      && (!st.reg || r.regsPretty.includes(st.reg))
      && (!st.stat || r.status === st.stat)
      && (!st.onRoutes || r.routes.length));
  };
  const stBadge = s => {
    const c = s === 'Current' ? 'var(--warn)' : s === 'Upcoming' ? 'var(--acc)' : 'var(--mu)';
    return `<span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-radius:5px;padding:2px 6px;color:${c};background:color-mix(in srgb, ${c} 12%, transparent)">${esc(s)}</span>`;
  };
  function draw(){
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    document.getElementById('troBody').innerHTML = list.slice(st.page * PAGE, st.page * PAGE + PAGE).map(r => `<tr>
      <td style="max-width:250px" title="${esc(r.id)}"><b>${esc(r.name)}</b>${r.hasDiversion ? ' <span title="Publishes an official diversion route" style="color:var(--good)">⤳</span>' : ''}${r.desc && r.desc !== r.name ? `<div style="font-size:11px;color:var(--mu)">${esc(r.desc)}</div>` : ''}</td>
      <td style="font-size:12px;max-width:150px">${esc(r.authority)}</td>
      <td style="max-width:230px;font-size:12px" title="${esc(r.regsPretty.join(', '))}">${esc(r.regsPretty.slice(0, 3).join(', '))}${r.regsPretty.length > 3 ? ` <span style="color:var(--mu)">+${r.regsPretty.length - 3}</span>` : ''}</td>
      <td>${stBadge(r.status)}${r.temporary ? `<div style="font-size:10px;color:var(--mu);margin-top:2px">temporary</div>` : ''}</td>
      <td style="white-space:nowrap">${ddMMM(r.start)} → ${ddMMM(r.end)}</td>
      <td style="white-space:nowrap;font-size:12px">${ddMMM(r.published)}</td>
      <td style="max-width:160px">${r.routes.length ? r.routes.map(routeChip).join('') : '<span style="color:var(--mu);font-size:11px">—</span>'}</td></tr>`).join('');
    document.getElementById('troCount').textContent =
      `${list.length.toLocaleString('en-GB')} order${list.length === 1 ? '' : 's'}${list.length !== rows.length ? ` (of ${rows.length.toLocaleString('en-GB')})` : ''}`;
    document.getElementById('troPage').textContent = `Page ${st.page + 1} of ${pages}`;
    document.getElementById('troPrev').disabled = st.page === 0;
    document.getElementById('troNext').disabled = st.page >= pages - 1;
  }
  draw();
  let deb;
  document.getElementById('troq').addEventListener('input', e => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; st.page = 0; draw(); }, 150); });
  document.getElementById('troauth').addEventListener('change', e => { st.auth = e.target.value; st.page = 0; draw(); });
  document.getElementById('troreg').addEventListener('change', e => { st.reg = e.target.value; st.page = 0; draw(); });
  document.getElementById('trost').addEventListener('change', e => { st.stat = e.target.value; st.page = 0; draw(); });
  document.getElementById('troroutes').addEventListener('change', e => { st.onRoutes = e.target.checked; st.page = 0; draw(); });
  document.getElementById('troPrev').addEventListener('click', () => { st.page = Math.max(0, st.page - 1); draw(); });
  document.getElementById('troNext').addEventListener('click', () => { st.page = st.page + 1; draw(); });
  document.getElementById('troExport').addEventListener('click', () => {
    downloadCsv('london-bus-traffic-orders.csv', [
      ['id','order','authority','regulation_types','status','temporary','window_start','window_end','published','routes','official_diversion_route'],
      ...filtered().map(r => [r.id, r.name, r.authority, r.regsPretty.join('; '), r.status, r.temporary ? 'yes' : 'no',
        r.start ?? '', r.end ?? '', r.published ?? '', r.routes.join(' '), r.hasDiversion ? 'yes' : 'no']),
    ]);
  });
}
