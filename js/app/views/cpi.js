/* View: CPI-CPA — ONS index and contract escalation. */
import { D } from '../core/data.js';
import { gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { downloadCsv, esc, fmtDate, MONTH_NAMES } from '../core/utils.js';

const monthLabel = ym => { const m = /^(\d{4})-(\d{2})$/.exec(ym ?? ''); return m ? `${MONTH_NAMES[+m[2]-1]} ${m[1]}` : ym; };
const pct2 = v => v == null ? '—' : (Number(v) * 100).toFixed(2) + '%';
export async function renderCpi(){
  const tok = state.navToken;
  main.innerHTML = `<div class="wrap"><div class="skel" style="height:46px;width:50%"></div></div>`;
  const d = await D.cpi();
  if(gone(tok)) return;
  if(!d?.months?.length){
    main.innerHTML = `<div class="wrap"><div class="empty">The CPI-CPA dataset is unreachable right now — try again shortly.</div></div>`;
    return;
  }
  const rows = [...d.months].reverse();   // newest first
  const latest = rows[0];
  // Rates already CONFIRMED for months beyond the latest CPI print: P2P
  // looks back 4 months and RA closes at the prior month, so these are
  // actuals fixed by published data — this month's own index just isn't
  // out yet. Rendered above the series, marked, never forecasts.
  const fwd = [...(d.confirmedForward ?? [])].reverse();
  const fwdP2pTo = (d.confirmedForward ?? []).filter(r => r.p2p).slice(-1)[0]?.month;
  const fwdRaTo  = (d.confirmedForward ?? []).filter(r => r.ra).slice(-1)[0]?.month;
  const facts = [
    ['CPI index', latest.cpi, `${monthLabel(latest.month)} · 2015 = 100`],
    ['YoY inflation', pct2(latest.yoy), monthLabel(latest.month)],
    ['P2P rate', pct2(latest.p2p), '85% of YoY, 4-month lag'],
    ['Rolling average', pct2(latest.ra), '85% of 12-month avg YoY'],
  ];
  const trFwd = r => `<tr style="background:var(--acc-soft)">
    <td style="font-weight:600">${esc(monthLabel(r.month))} <span style="font-size:9.5px;font-weight:700;color:var(--acc);border:1px solid var(--acc);border-radius:4px;padding:0 4px;vertical-align:1px" title="Actual rate, fully determined by published CPI — this month's own index is not yet released">CONFIRMED</span></td>
    <td class="num" style="color:var(--mu)">—</td>
    <td class="num" style="color:var(--mu)">—</td>
    <td class="num" title="${esc(r.p2p ?? '')}">${r.p2p ? pct2(r.p2p) : '—'}</td>
    <td class="num" title="${esc(r.ra ?? '')}">${r.ra ? pct2(r.ra) : '—'}</td></tr>`;
  const tr = r => `<tr>
    <td style="font-weight:600">${esc(monthLabel(r.month))}</td>
    <td class="num">${esc(r.cpi)}</td>
    <td class="num" title="${esc(r.yoy ?? '')}">${pct2(r.yoy)}</td>
    <td class="num" title="${esc(r.p2p ?? '')}">${pct2(r.p2p)}</td>
    <td class="num" title="${esc(r.ra ?? '')}">${pct2(r.ra)}</td></tr>`;
  main.innerHTML = `<div class="wrap">
    <div id="dhead"><h1 style="margin:2px 0 4px">CPI-CPA</h1>
      <div style="color:var(--tx2);font-size:13.5px">CPI All Items Index (2015 = 100) with the contract price adjustment rates derived from it. Rates apply <b>85% of CPI</b>: point-to-point (P2P) takes the year-on-year change from four months earlier; the rolling average (RA) averages the twelve monthly year-on-year changes ending at the previous month.</div>
      ${fwdP2pTo ? `<div style="display:inline-flex;align-items:center;gap:7px;margin-top:10px;margin-right:8px;background:var(--acc-soft);color:var(--acc);border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:600" title="P2P looks back four months and RA closes at the prior month, so these rates are already fixed by published CPI">✓ Confirmed ahead: P2P to ${esc(monthLabel(fwdP2pTo))}${fwdRaTo ? ` · RA to ${esc(monthLabel(fwdRaTo))}` : ''}</div>` : ''}${d.nextRelease ? `<div style="display:inline-flex;align-items:center;gap:7px;margin-top:10px;background:var(--acc-soft);color:var(--acc);border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:600"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>Next CPI release: ${esc(d.nextRelease)}</div>` : ''}</div>
    <div class="facts facts--wrap" style="margin-top:14px">${facts.map(([l,v,sub]) =>
      `<div class="fact"><div class="l">${l}</div><div class="v" title="${esc(sub)}">${esc(String(v))}</div><div style="font-size:10px;color:var(--mu);margin-top:2px">${esc(sub)}</div></div>`).join('')}</div>
    <div class="section"><div class="section-h" style="display:flex;align-items:center;gap:10px">Monthly series · since ${esc(monthLabel(d.months[0].month))}
      <button class="livebtn" id="cpiExport" style="margin-left:0"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>Export CSV</button></div>
      <div class="card" style="overflow-x:auto"><table class="cpi-table">
        <thead><tr><th>Month</th><th class="num">CPI index</th><th class="num">YoY</th><th class="num">P2P (85%)</th><th class="num">Rolling avg (85%)</th></tr></thead>
        <tbody>${fwd.map(trFwd).join('')}${rows.map(tr).join('')}</tbody>
      </table></div>
      <div class="legendrow" style="margin-top:8px"><span>yoy[M] = (CPI[M] − CPI[M−12]) ÷ CPI[M−12] · P2P[M] = yoy[M−4] × 0.85 · RA[M] = avg(yoy[M−12] … yoy[M−1]) × 0.85. Values rounded half-up at 8 dp (hover a cell for full precision). YoY here is derived from the published 1-dp index — as the CPA calculation requires — so it can differ from the headline 12-month rate (computed from unrounded indices) by up to 0.1 pp.${d.releaseDate ? ` Released ${esc(fmtDate(d.releaseDate) ?? '')}.` : ''}${d.nextRelease ? ` Next release ${esc(d.nextRelease)}.` : ''}</span></div>
    </div>
  </div>`;
  document.getElementById('cpiExport')?.addEventListener('click', () => {
    downloadCsv('cpi-cpa.csv', [
      ['month','cpi_index','yoy_change','p2p_rate','ra_rate','status'],
      ...d.months.map(r => [r.month, r.cpi, r.yoy ?? '', r.p2p ?? '', r.ra ?? '', 'actual']),
      ...(d.confirmedForward ?? []).map(r => [r.month, '', '', r.p2p ?? '', r.ra ?? '', 'confirmed_forward']),
    ]);
  });
}
