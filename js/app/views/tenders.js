/* View: Tender — every award, filterable. */
import { D } from '../core/data.js';
import { brandRoot } from '../core/incoming.js';
import { gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { downloadCsv, esc, fmtDate, title } from '../core/utils.js';

/* ════════════════════ TENDERS — every award, filterable ════════════════ */
export async function renderTenders(tab){
  const tok = state.navToken;
  main.innerHTML = `<div class="wrap"><div class="skel" style="height:46px;width:50%"></div></div>`;
  const all = (await D.tendersAll() ?? []).filter(a => a.awardDate);
  /* operators whose very first award on file is recent — new to the network, flagged in the table (derived, not listed) */
  const firstAward = new Map(); for(const x of all){ const k = brandRoot(x.operator); if(k && (!firstAward.has(k) || x.awardDate < firstAward.get(k))) firstAward.set(k, x.awardDate); }
  const newCut = new Date(Date.now() - 548 * 864e5).toISOString().slice(0, 10);
  const isNewOp = o => { const f = firstAward.get(brandRoot(o)); return !!f && f >= newCut; };
  if(gone(tok)) return;
  if(!all.length){
    main.innerHTML = `<div class="wrap"><div class="empty">The tender register is unreachable right now — try again shortly.</div></div>`;
    return;
  }
  const ops = [...new Set(all.map(a => a.operator).filter(Boolean))].sort();
  const years = [...new Set(all.map(a => String(a.awardDate).slice(0,4)))].sort().reverse();
  const money = v => Number.isFinite(v) ? '£' + v.toLocaleString('en-GB') : '—';
  /* Contracted annual mileage — TfL's own figure where the result page
     carried one, else worked out from accepted bid ÷ £/mile (checked
     against the 2,431 awards that publish both: within 0.1%). */
  const milesPA = a => Number.isFinite(a.contractedMilesPA) ? a.contractedMilesPA
    : (Number.isFinite(a.acceptedBid) && Number.isFinite(a.costPerMile) && a.costPerMile > 0
        ? Math.round(a.acceptedBid / a.costPerMile) : null);
  const PAGE = 20;
  const st = { q:'', op:'', yr:'', sort:'date', dir:-1, page:0 };

  main.innerHTML = `<div class="wrap">
    <div id="dhead"><h1 style="margin:2px 0 4px">Tender</h1>
      <div style="color:var(--tx2);font-size:13.5px">Both halves of London bus tendering: published <b>awards</b> (${all.length.toLocaleString('en-GB')} results, ${esc(years[years.length-1])}–${esc(years[0])}) and the forward <b>programme</b> of routes coming up for tender. Filter, sort, and export either.</div></div>
    <div style="display:flex;gap:6px;margin-top:14px" role="tablist" aria-label="Tender tables">
      <button class="livebtn tabpill" id="tabA" role="tab" aria-selected="true">Awards · ${all.length.toLocaleString('en-GB')}</button>
      <button class="livebtn tabpill" id="tabP" role="tab" aria-selected="false">Programme</button>
    </div>
    <div id="tabAwards">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center">
      <input id="tq" type="search" aria-label="Search tender awards" placeholder="Search route (e.g. 24), operator or tranche" style="flex:1;min-width:180px;max-width:320px;border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 15px;font-size:13.5px;color:var(--tx)">
      <span style="display:inline-flex;align-items:center;gap:4px">
        <select id="top" aria-label="Filter by operator" style="border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 12px;font-size:13px;color:var(--tx)"><option value="">All operators</option>${ops.map(o => `<option>${esc(o)}</option>`).join('')}</select>
        <button id="topClear" hidden aria-label="Clear operator filter" title="Clear operator filter" style="width:24px;height:24px;border-radius:50%;background:var(--surf2);color:var(--tx2);font-size:13px;line-height:1">✕</button></span>
      <span style="display:inline-flex;align-items:center;gap:4px">
        <select id="tyr" aria-label="Filter by year" style="border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 12px;font-size:13px;color:var(--tx)"><option value="">All years</option>${years.map(y => `<option>${esc(y)}</option>`).join('')}</select>
        <button id="tyrClear" hidden aria-label="Clear year filter" title="Clear year filter" style="width:24px;height:24px;border-radius:50%;background:var(--surf2);color:var(--tx2);font-size:13px;line-height:1">✕</button></span>
      <button class="livebtn" id="tExport" title="Downloads every award matching the current filters"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>Export CSV</button>
    </div>
    <div class="facts facts--wrap" id="tKpis" style="margin-top:14px"></div>
    <div class="section"><div class="section-h" id="tCount"></div>
      <div class="card" style="overflow-x:auto"><table class="cpi-table" style="min-width:1380px">
        <thead><tr>
          <th data-sort="date" style="cursor:pointer">Awarded ↓</th><th>Route</th><th data-sort="prevop" style="cursor:pointer" title="The operator of the route's previous award — blank for a route's first award">Previous operator</th><th data-sort="op" style="cursor:pointer" title="The operator this award went to. Highlighted when it differs from the previous operator">New operator</th><th class="num" data-sort="tranche" style="cursor:pointer">Tranche</th><th>Joint with</th>
          <th class="num" data-sort="cpm" style="cursor:pointer">£/mile</th><th class="num" data-sort="acc" style="cursor:pointer">Accepted £/yr</th>
          <th class="num">Lowest</th><th class="num">Highest</th><th class="num" data-sort="bids" style="cursor:pointer">Bids</th>
          <th class="num" data-sort="miles" style="cursor:pointer" title="Contracted annual mileage — from the result page, or accepted bid ÷ £/mile when it omits one">Miles/yr</th>
          <th data-sort="start" style="cursor:pointer">Start</th><th>End</th><th class="num" data-sort="term" style="cursor:pointer">Term</th>
          <th>Vehicle</th><th>Source</th>
        </tr></thead>
        <tbody id="tBody"></tbody>
      </table></div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <button class="livebtn" id="tPrev">‹ Prev</button>
        <span id="tPage" style="font-size:12.5px;color:var(--tx2)"></span>
        <button class="livebtn" id="tNext">Next ›</button>
      </div>
      <div class="legendrow" style="margin-top:8px"><span>Bids, operators and vehicle notes are checked hourly through the day (append-only) and joined with the tendering programmes (contract start dates, tranches, extension options; 2017/18 onward). Contract end = the next contract’s observed start; term = end − start; miles/yr = the contracted annual mileage, or accepted bid ÷ £/mile when the result page omits it. Nominal £ as awarded. The link on each row opens that award’s original result page.</span></div>
    </div>
    </div>
    <div id="tabProg" hidden>
    <div class="section" style="margin-top:14px"><div class="section-h" style="display:flex;align-items:center;gap:10px">Tendering programme<span id="pCount" style="text-transform:none;letter-spacing:0;color:var(--mu);font-weight:500"></span>
      <button class="livebtn" id="pExport" style="margin-left:auto" title="Downloads every programme entry matching the current filters"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>Export CSV</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
        <input id="pq" type="search" aria-label="Search tendering programme" placeholder="Search route (e.g. 24), tranche or description" style="flex:1;min-width:180px;max-width:320px;border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 15px;font-size:13.5px;color:var(--tx)">
        <span style="display:inline-flex;align-items:center;gap:4px">
          <select id="pop" aria-label="Filter by current operator" title="Which operator currently runs the route(s) in each entry" style="border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 12px;font-size:13px;color:var(--tx)"></select>
          <button id="popClear" hidden aria-label="Clear operator filter" title="Clear operator filter" style="width:24px;height:24px;border-radius:50%;background:var(--surf2);color:var(--tx2);font-size:13px;line-height:1">✕</button></span>
        <span style="display:inline-flex;align-items:center;gap:4px">
          <select id="pyr" style="border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 12px;font-size:13px;color:var(--tx)"></select>
          <button id="pyrClear" hidden aria-label="Clear programme-year filter" title="Clear programme-year filter" style="width:24px;height:24px;border-radius:50%;background:var(--surf2);color:var(--tx2);font-size:13px;line-height:1">✕</button></span>
      </div>
      <div class="card" style="overflow-x:auto"><table class="cpi-table" style="min-width:1180px">
        <thead><tr><th>Route</th><th title="Which operator currently runs the route — from the live route registry, not the programme PDF">Operator</th><th>Description</th><th>Programme</th><th class="num">Tranche</th><th>Issued</th><th>Returns</th><th>Est. award</th><th>Contract start</th><th>Vehicle</th><th>+2 yr</th><th>Source</th></tr></thead>
        <tbody id="pBody"></tbody>
      </table></div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <button class="livebtn" id="pPrev">‹ Prev</button>
        <span id="pPage" style="font-size:12.5px;color:var(--tx2)"></span>
        <button class="livebtn" id="pNext">Next ›</button>
      </div>
      <div class="legendrow" style="margin-top:8px"><span>The programme is republished roughly monthly, one document per financial year. The PDF link on each row opens that programme year’s original document. Routes with a contract start in the future are highlighted; the same flag appears on their route pages.</span></div>
    </div>
    </div>
  </div>`;

  /* Tabs — awards | programme. #/tender/programme deep-links the second
     tab (the route pages' "Tendering programme" link lands there); switching
     rewrites the hash without re-rendering. */
  const setTab = (which) => {
    const a = which !== 'programme';
    document.getElementById('tabAwards').hidden = !a;
    document.getElementById('tabProg').hidden = a;
    document.getElementById('tabA').classList.toggle('on', a);
    document.getElementById('tabP').classList.toggle('on', !a);
    document.getElementById('tabA').setAttribute('aria-selected', String(a));
    document.getElementById('tabP').setAttribute('aria-selected', String(!a));
    history.replaceState(null, '', a ? '#/tender' : '#/tender/programme');
  };
  setTab(tab === 'programme' ? 'programme' : 'awards');
  document.getElementById('tabA').addEventListener('click', () => setTab('awards'));
  document.getElementById('tabP').addEventListener('click', () => setTab('programme'));

  const KEY = { date: a => a.awardDate ?? '', prevop: a => a.fromOperator ?? '', op: a => a.operator ?? '', cpm: a => a.costPerMile ?? -1, acc: a => a.acceptedBid ?? -1, bids: a => a.numberOfTenderers ?? -1, start: a => a.contractStart ?? '', term: a => a.termYears ?? -1, tranche: a => Number.isFinite(a.tranche) ? a.tranche : -1, miles: a => milesPA(a) ?? -1 };
  const filtered = () => {
    const q = st.q.trim().toUpperCase();
    // Routes match EXACTLY (typing "24" means route 24, not 124/240/N241 —
    // a combined award like "24/N24" matches on either token); operators
    // still match by substring.
    const routeHit = a => String(a.route ?? '').toUpperCase().split('/').some(t => t.trim() === q);
    let list = all.filter(a =>
      (!st.op || a.operator === st.op)
      && (!st.yr || String(a.awardDate).startsWith(st.yr))
      && (!q || routeHit(a) || String(a.tranche ?? '') === q
          || String(a.operator ?? '').toUpperCase().includes(q)
          || String(a.fromOperator ?? '').toUpperCase().includes(q)));
    const k = KEY[st.sort];
    list.sort((x,y) => { const a = k(x), b = k(y); return (a < b ? -1 : a > b ? 1 : 0) * st.dir; });
    return list;
  };
  const routeChips = r => String(r ?? '').split('/').map(x => x.trim()).filter(Boolean)
    .map(x => `<a class="rchip" style="padding:1px 7px;font-size:11px" href="#/route/${encodeURIComponent(x)}">${esc(x)}</a>`).join(' ');

  /* KPI tiles — recomputed against the CURRENT filter, so filtering to an
     operator or a year turns the page into that slice's analysis. */
  const median = arr => { if(!arr.length) return null; const a = [...arr].sort((x,y)=>x-y); const m = a.length>>1; return a.length%2 ? a[m] : (a[m-1]+a[m])/2; };
  function kpis(list){
    const priced = list.filter(a => Number.isFinite(a.costPerMile) && a.costPerMile > 0);
    const medAll = median(priced.map(a => a.costPerMile));

    // £/mile trend: median of the newest 12 months in the slice vs the 12 before
    const newest = list[0]?.awardDate ? Date.parse(String(list.reduce((m,a)=>a.awardDate>m?a.awardDate:m, '0000').slice(0,10))) : NaN;
    const inWin = (a, from, to) => { const t = Date.parse(a.awardDate); return t > from && t <= to; };
    const YR = 3.15576e10;
    const w1 = priced.filter(a => inWin(a, newest - YR, newest)).map(a => a.costPerMile);
    const w0 = priced.filter(a => inWin(a, newest - 2*YR, newest - YR)).map(a => a.costPerMile);
    const trend = (w1.length >= 5 && w0.length >= 5) ? (median(w1) / median(w0) - 1) * 100 : null;

    const withBids = list.filter(a => Number.isFinite(a.numberOfTenderers) && a.numberOfTenderers > 0);
    const avgBids = withBids.length ? withBids.reduce((s,a)=>s+a.numberOfTenderers,0) / withBids.length : null;
    const singleShare = withBids.length ? withBids.filter(a => a.numberOfTenderers === 1).length / withBids.length * 100 : null;

    const contested = list.filter(a => a.fromOperator);
    const retained = contested.length ? contested.filter(a => !a.operatorChange).length / contested.length * 100 : null;

    const bothBids = list.filter(a => Number.isFinite(a.acceptedBid) && Number.isFinite(a.lowestBid));
    const lowestWon = bothBids.length ? bothBids.filter(a => a.acceptedBid <= a.lowestBid).length / bothBids.length * 100 : null;
    const premiums = bothBids.filter(a => a.acceptedBid > a.lowestBid).map(a => (a.acceptedBid / a.lowestBid - 1) * 100);

    const wins = {};
    for(const a of list) if(a.operator) wins[a.operator] = (wins[a.operator] ?? 0) + 1;
    const top = Object.entries(wins).sort((x,y) => y[1] - x[1])[0];

    const f1 = v => v == null ? '—' : v.toFixed(1);
    const tiles = [
      ['Median £/mile', medAll != null ? '£' + medAll.toFixed(2) : '—', `${priced.length.toLocaleString('en-GB')} priced awards`],
      ['£/mile trend', trend != null ? (trend >= 0 ? '+' : '') + trend.toFixed(1) + '%' : '—', 'median, newest 12 mo vs prior 12'],
      ['Bids per tender', avgBids != null ? avgBids.toFixed(1) : '—', singleShare != null ? `${f1(singleShare)}% single-bid` : 'competition'],
      ['Incumbent retained', retained != null ? f1(retained) + '%' : '—', `${contested.length.toLocaleString('en-GB')} re-tenders`],
      ['Won by lowest bid', lowestWon != null ? f1(lowestWon) + '%' : '—', premiums.length ? `else +${f1(median(premiums))}% median premium` : 'accepted = lowest'],
      ['Most awards', top ? top[0] : '—', top ? `${top[1].toLocaleString('en-GB')} in this view` : ''],
    ];
    document.getElementById('tKpis').innerHTML = tiles.map(([l,v,sub]) =>
      `<div class="fact"><div class="l">${l}</div><div class="v" title="${esc(sub)}">${esc(String(v))}</div><div style="font-size:10px;color:var(--mu);margin-top:2px">${esc(sub)}</div></div>`).join('');
  }
  function draw(){
    const list = filtered();
    kpis(list);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    const shown = list.slice(st.page * PAGE, st.page * PAGE + PAGE);
    const vehCell = a => {
      const v = a.vehicle;
      if(!v) return '—';
      const bits = [v.basis, v.propulsion, v.deck ? v.deck + '-deck' : null].filter(Boolean);
      const label = bits.length ? bits.map(title).join(' · ') : String(v.raw ?? '').replace(/^Awarded on\s*/i, '').replace(/\.$/, '');
      return label ? `<span title="${esc(v.raw ?? '')}">${esc(label.length > 34 ? label.slice(0,32) + '…' : label)}</span>` : '—';
    };
    document.getElementById('tBody').innerHTML = shown.map(a => `<tr>
      <td class="num" style="text-align:left">${esc(fmtDate(a.awardDate) ?? a.awardDate)}</td>
      <td style="min-width:${String(a.route ?? '').includes('/') ? 200 : 60}px"><span style="display:inline-flex;gap:4px;flex-wrap:wrap;max-width:240px">${routeChips(a.route)}</span></td>
      <td style="min-width:140px"${a.fromOperatorRaw ? ` title="Listed as ${esc(a.fromOperatorRaw)}, whose London bus business Stagecoach bought in August 2022"` : ''}>${a.fromOperator ? esc(a.fromOperator) : '<span style="color:var(--mu)">—</span>'}</td>
      <td style="min-width:140px${a.operatorChange ? ';color:var(--acc);font-weight:600' : ''}"${a.operatorChange ? ` title="Operator change — previously ${esc(a.fromOperator ?? '')}"` : ''}>${esc(a.operator ?? '—')}${isNewOp(a.operator) ? '<span class="newpill" title="New to the TfL bus network — its first award on file">New</span>' : ''}${a.provisional ? `<span style="margin-left:4px;font-size:9.5px;font-weight:700;color:var(--mu);border:1px solid var(--mu);border-radius:4px;padding:0 4px;vertical-align:1px" title="${esc(a.notes ?? 'Provisional — community-reported award; the official result is not yet published.')}">PROV</span>` : ''}</td>
      <td class="num">${Number.isFinite(a.tranche) ? a.tranche : '—'}</td>
      <td${(a.jb?.partners?.length ?? 0) > 1 ? ' style="min-width:200px"' : ''}>${a.jb?.isJoint ? (a.jb.partners?.length ? `<span style="display:inline-flex;gap:4px;flex-wrap:wrap;max-width:240px" title="${esc(a.jb.raw ?? '')}">${routeChips(a.jb.partners.join('/'))}</span>` : 'Yes') : ''}</td>
      <td class="num">${Number.isFinite(a.costPerMile) ? '£' + a.costPerMile.toFixed(2) : '—'}</td>
      <td class="num">${money(a.acceptedBid)}</td>
      <td class="num">${money(a.lowestBid)}</td>
      <td class="num">${money(a.highestBid)}</td>
      <td class="num">${Number.isFinite(a.numberOfTenderers) ? a.numberOfTenderers : '—'}</td>
      <td class="num">${(m => m != null ? m.toLocaleString('en-GB') : '—')(milesPA(a))}</td>
      <td class="num" style="text-align:left">${esc(fmtDate(a.contractStart) ?? '—')}</td>
      <td class="num" style="text-align:left">${esc(fmtDate(a.contractEnd) ?? '—')}</td>
      <td class="num">${Number.isFinite(a.termYears) ? a.termYears + ' yr' + (a.twoYearExtension ? ' <span title="two-year extension option in the tendering programme" style="color:var(--mu)">+2</span>' : '') : (a.twoYearExtension ? '<span title="two-year extension option in the tendering programme" style="color:var(--mu)">+2 opt</span>' : '—')}</td>
      <td>${vehCell(a)}</td>
      <td>${a.provisional ? `<a href="https://london-bus-routes.fandom.com/wiki/Tender_Results_${encodeURIComponent((a.awardDate ?? '').slice(0,4))}" target="_blank" rel="noopener" title="Community-reported award — original page" style="color:var(--mu);white-space:nowrap">wiki ↗</a>` : a.btID ? `<a href="https://tfl.gov.uk/forms/13796.aspx?btID=${encodeURIComponent(a.btID)}" target="_blank" rel="noopener" title="This award's original result page" style="color:var(--acc);white-space:nowrap">Result ↗</a>` : '—'}</td></tr>`).join('');
    document.getElementById('tCount').textContent = `${list.length.toLocaleString('en-GB')} award${list.length===1?'':'s'}${list.length !== all.length ? ` (of ${all.length.toLocaleString('en-GB')})` : ''}`;
    document.getElementById('tPage').textContent = `Page ${st.page + 1} of ${pages}`;
    document.getElementById('tPrev').disabled = st.page === 0;
    document.getElementById('tNext').disabled = st.page >= pages - 1;
    document.querySelectorAll('#main th[data-sort]').forEach(th => {
      th.textContent = th.textContent.replace(/ [↓↑]$/, '') + (th.dataset.sort === st.sort ? (st.dir < 0 ? ' ↓' : ' ↑') : '');
    });
  }
  draw();
  let deb;
  document.getElementById('tq').addEventListener('input', e => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; st.page = 0; draw(); }, 150); });
  const syncClears = () => {
    document.getElementById('topClear').hidden = !st.op;
    document.getElementById('tyrClear').hidden = !st.yr;
  };
  document.getElementById('top').addEventListener('change', e => { st.op = e.target.value; st.page = 0; syncClears(); draw(); });
  document.getElementById('tyr').addEventListener('change', e => { st.yr = e.target.value; st.page = 0; syncClears(); draw(); });
  document.getElementById('topClear').addEventListener('click', () => { st.op = ''; document.getElementById('top').value = ''; syncClears(); draw(); });
  document.getElementById('tyrClear').addEventListener('click', () => { st.yr = ''; document.getElementById('tyr').value = ''; syncClears(); draw(); });
  document.getElementById('tPrev').addEventListener('click', () => { st.page = Math.max(0, st.page - 1); draw(); });
  document.getElementById('tNext').addEventListener('click', () => { st.page = st.page + 1; draw(); });
  document.querySelectorAll('#main th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if(st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = (k === 'op' || k === 'prevop') ? 1 : -1; }
    draw();
  }));
  document.getElementById('tExport').addEventListener('click', () => {
    downloadCsv('london-bus-tenders.csv', [
      ['award_date','route','previous_operator','new_operator','operator_change','cost_per_mile','accepted_bid','lowest_bid','highest_bid','bids_received','contracted_miles_pa',
       'contract_start','contract_end','term_years','two_year_extension_option','tranche','vehicle','joint_bid','joint_with','notes','source_url'],
      ...filtered().map(a => [a.awardDate, a.route ?? '', a.fromOperator ?? '', a.operator ?? '', a.operatorChange ? 'yes' : 'no',
        Number.isFinite(a.costPerMile) ? a.costPerMile : '', Number.isFinite(a.acceptedBid) ? a.acceptedBid : '',
        Number.isFinite(a.lowestBid) ? a.lowestBid : '', Number.isFinite(a.highestBid) ? a.highestBid : '',
        Number.isFinite(a.numberOfTenderers) ? a.numberOfTenderers : '',
        milesPA(a) ?? '',
        a.contractStart ?? '', a.contractEnd ?? '', Number.isFinite(a.termYears) ? a.termYears : '',
        a.twoYearExtension == null ? '' : (a.twoYearExtension ? 'yes' : 'no'), a.tranche ?? '',
        a.vehicle?.raw ?? '', a.jb?.isJoint ? 'yes' : 'no', a.jb?.partners?.join(' ') ?? '', a.notes ?? '',
        a.provisional ? `https://london-bus-routes.fandom.com/wiki/Tender_Results_${(a.awardDate ?? '').slice(0,4)}` : a.btID ? `https://tfl.gov.uk/forms/13796.aspx?btID=${a.btID}` : '']),
    ]);
  });

  /* ── Tendering programme table (the forward half of TfL's forms page) ── */
  const [prog, pMeta] = await Promise.all([D.programme(), D.meta()]);
  if(gone(tok)) return;
  document.getElementById('tabP').textContent = `Programme · ${prog.length.toLocaleString('en-GB')}`;
  /* CURRENT operator of each entry's route(s) — from the live route registry,
     not the programme PDF (which never names one). A combined entry like
     "649/650/651" takes the first token that resolves; night ids that don't
     exist standalone (e.g. an "N15" folded into 15) fall back to the base id.
     Withdrawn or not-yet-running routes resolve to nothing and show "—". */
  for(const e of prog){
    e.currentOperator = null;
    for(const t of String(e.route ?? '').toUpperCase().split('/').map(x => x.trim()).filter(Boolean)){
      const m = pMeta[t] ?? (t.startsWith('N') ? pMeta[t.slice(1)] : null);
      if(m?.operator){ e.currentOperator = m.operator; break; }
    }
  }
  const pOps = [...new Set(prog.map(e => e.currentOperator).filter(Boolean))].sort();
  document.getElementById('pop').innerHTML = '<option value="">All operators</option>' + pOps.map(o => `<option>${esc(o)}</option>`).join('');
  const pYears = [...new Set(prog.map(e => e.programmeYear).filter(Boolean))].sort().reverse();
  document.getElementById('pyr').innerHTML = '<option value="">All programmes</option>' + pYears.map(y => `<option>${esc(y)}</option>`).join('');
  const today = new Date().toISOString().slice(0, 10);
  const pst = { q:'', op:'', yr:'', page:0 };
  const pFiltered = () => {
    const q = pst.q.trim().toUpperCase();
    return prog.filter(e =>
      (!pst.op || e.currentOperator === pst.op)
      && (!pst.yr || e.programmeYear === pst.yr)
      && (!q || String(e.route).toUpperCase().split('/').some(t => t.trim() === q)
          || String(e.tranche ?? '').toUpperCase() === q
          || String(e.description ?? '').toUpperCase().includes(q)));
  };
  function pDraw(){
    const list = pFiltered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    pst.page = Math.min(pst.page, pages - 1);
    const shown = list.slice(pst.page * PAGE, pst.page * PAGE + PAGE);
    document.getElementById('pBody').innerHTML = shown.map(e => {
      const upcoming = e.contractStart && e.contractStart >= today;
      return `<tr${upcoming ? ' style="background:var(--acc-soft)"' : ''}>
        <td style="min-width:${String(e.route ?? '').includes('/') ? 200 : 60}px"><span style="display:inline-flex;gap:4px;flex-wrap:wrap;max-width:240px">${routeChips(e.route)}</span></td>
        <td>${esc(e.currentOperator ?? '—')}</td>
        <td style="max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.description ?? '')}">${esc(e.description ?? '—')}</td>
        <td class="num" style="text-align:left">${esc(e.programmeYear ? e.programmeYear.replace(/^(\d{4})-\d{2}(\d{2})$/, '$1/$2') : '—')}</td>
        <td class="num">${esc(e.tranche ?? '—')}</td>
        <td class="num" style="text-align:left">${esc(fmtDate(e.issueDate) ?? '—')}</td>
        <td class="num" style="text-align:left">${esc(fmtDate(e.returnDate) ?? '—')}</td>
        <td class="num" style="text-align:left">${esc(e.awardEstimated ?? '—')}</td>
        <td class="num" style="text-align:left">${upcoming ? '<b>' : ''}${esc(fmtDate(e.contractStart) ?? '—')}${upcoming ? '</b>' : ''}</td>
        <td>${esc(e.vehicleType ?? '—')}</td>
        <td>${e.twoYearExtension == null ? '—' : (e.twoYearExtension ? 'Yes' : 'No')}</td>
        <td>${e.sourceUrl && /^https:\/\//.test(e.sourceUrl) ? `<a href="${esc(e.sourceUrl)}" target="_blank" rel="noopener" title="The ${esc(e.programmeYear ?? '')} programme PDF" style="color:var(--acc);white-space:nowrap">PDF ↗</a>` : '—'}</td></tr>`;
    }).join('');
    const up = list.filter(e => e.contractStart && e.contractStart >= today).length;
    document.getElementById('pCount').textContent = ` · ${list.length.toLocaleString('en-GB')} entries${up ? ` · ${up} upcoming` : ''}`;
    document.getElementById('pPage').textContent = `Page ${pst.page + 1} of ${pages}`;
    document.getElementById('pPrev').disabled = pst.page === 0;
    document.getElementById('pNext').disabled = pst.page >= pages - 1;
  }
  pDraw();
  let pdeb;
  document.getElementById('pq').addEventListener('input', e => { clearTimeout(pdeb); pdeb = setTimeout(() => { pst.q = e.target.value; pst.page = 0; pDraw(); }, 150); });
  document.getElementById('pop').addEventListener('change', e => { pst.op = e.target.value; pst.page = 0; document.getElementById('popClear').hidden = !pst.op; pDraw(); });
  document.getElementById('popClear').addEventListener('click', () => { pst.op = ''; document.getElementById('pop').value = ''; document.getElementById('popClear').hidden = true; pDraw(); });
  document.getElementById('pyr').addEventListener('change', e => { pst.yr = e.target.value; pst.page = 0; document.getElementById('pyrClear').hidden = !pst.yr; pDraw(); });
  document.getElementById('pyrClear').addEventListener('click', () => { pst.yr = ''; document.getElementById('pyr').value = ''; document.getElementById('pyrClear').hidden = true; pDraw(); });
  document.getElementById('pPrev').addEventListener('click', () => { pst.page = Math.max(0, pst.page - 1); pDraw(); });
  document.getElementById('pNext').addEventListener('click', () => { pst.page = pst.page + 1; pDraw(); });
  document.getElementById('pExport').addEventListener('click', () => {
    downloadCsv('london-bus-tender-programme.csv', [
      ['programme_year','tranche','route','current_operator','description','tender_issue_date','tender_return_date','award_estimated','contract_start','vehicle_type','two_year_extension','source_url'],
      ...pFiltered().map(e => [e.programmeYear ?? '', e.tranche ?? '', e.route, e.currentOperator ?? '', e.description ?? '', e.issueDate ?? '', e.returnDate ?? '', e.awardEstimated ?? '', e.contractStart ?? '', e.vehicleType ?? '', e.twoYearExtension == null ? '' : (e.twoYearExtension ? 'yes' : 'no'), e.sourceUrl ?? '']),
    ]);
  });
}
