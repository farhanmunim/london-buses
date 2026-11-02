/* View: renewal calendar. */
import { D, plusMonths, TODAY, TODAY_ISO } from '../data.js';
import { $, esc } from '../dom.js';
import { fDate, fGbp, fInt, fPct, natKey, nOf, sum } from '../format.js';
import { S, SC } from '../state.js';
import { opColour } from '../tokens.js';
import { shortOp } from './hero.js';
import { tenderCell } from './routes-table.js';

/* ── view: renewal calendar ──────────────────────────────────────────────── */
const RN_WINDOWS = [12, 24, 36, 60];
/* a route whose re-tender is already decided (the "just awarded" state used across the page) */
const eff = r => r.award ?? null;
/* the annual bid being replaced: the contract before the award when one is already decided */
const oldBid = r => { const e = eff(r); return (e ? r.hist.find(x => x !== e)?.acceptedBid : r.cur?.acceptedBid) ?? null; };
const qKey = iso => `${iso.slice(0, 4)}-Q${Math.floor((+iso.slice(5, 7) - 1) / 3) + 1}`;
const qLabel = k => `Q${k.slice(-1)} ${k.slice(0, 4)}`;
function rnList(){
  const sc = SC(), lim = plusMonths(S.rnWin), bench = D.bench.cpm;
  let list = sc.st.list.filter(r => r.cEnd && r.cEnd >= TODAY_ISO && r.cEnd <= lim);
  const all = list;
  const gap = r => { const c = eff(r)?.costPerMile ?? r.cpm; return c > 0 && bench ? (c / bench - 1) * 100 : null; };
  if(S.rnFilter === 'open') list = list.filter(r => !eff(r));
  else if(S.rnFilter === 'awarded') list = list.filter(r => eff(r));
  else if(S.rnFilter === 'above') list = list.filter(r => gap(r) != null && gap(r) > 5);
  else if(S.rnFilter === 'below') list = list.filter(r => gap(r) != null && gap(r) < -5);
  else if(S.rnFilter === 'prog') list = list.filter(r => r.pipe || r.next);
  list = [...list].sort((a, b) => a.cEnd.localeCompare(b.cEnd) || b.pvr - a.pvr || (natKey(a.id) < natKey(b.id) ? -1 : 1));
  return { sc, all, list, gap, bench };
}
export function renderRenewals(){
  const { sc, all, list, gap, bench } = rnList();
  const quarters = []; { const t = new Date(TODAY); let y = t.getUTCFullYear(), q = Math.floor(t.getUTCMonth() / 3);
    const end = qKey(plusMonths(S.rnWin)); for(let i = 0; i < 24; i++){ const k = `${y}-Q${q + 1}`; quarters.push({ k, rs:[] }); if(k === end) break; q++; if(q > 3){ q = 0; y++; } } }
  const qmap = new Map(quarters.map(x => [x.k, x])); for(const r of all) qmap.get(qKey(r.cEnd))?.rs.push(r);
  const val = rs => sum(rs, oldBid), swing = rs => sum(rs.filter(r => r.fcValue != null && oldBid(r)), r => r.fcValue - oldBid(r));
  const open = all.filter(r => !eff(r)), done = all.length - open.length;
  const cur = val(all), sw = swing(open), nPrice = open.filter(r => r.fcValue != null && oldBid(r)).length;
  const max = Math.max(1, ...quarters.map(x => val(x.rs)));
  const dense = quarters.length > 10;
  const cols = quarters.map(x => { const v = val(x.rs), h = v / max * 100, sel = S.rnQ === x.k, n = x.rs.length;
    return `<button type="button" class="colw ${sel ? 'sel' : ''} ${n ? '' : 'empty'}" data-rnq="${x.k}" aria-pressed="${sel}" aria-label="${qLabel(x.k)}: ${nOf(n, 'route')}, ${fGbp(v)} a year" data-tip="${qLabel(x.k)}\n${nOf(n, 'route')} · ${fInt(sum(x.rs, r => r.pvr))} PVR\n${fGbp(v)} a year ends${n ? '\nClick to show only this quarter' : ''}"${n ? '' : ' disabled'}><span class="n">${!dense && n ? fGbp(v) : ''}</span><span class="b" style="height:${v ? Math.max(2, h) : 0}%"></span></button>`; }).join('');
  const labels = quarters.map((x, i) => `<span>${dense && !x.k.endsWith('Q1') && i ? '' : 'Q' + x.k.slice(-1)}${x.k.endsWith('Q1') || i === 0 ? `<b>${x.k.slice(0, 4)}</b>` : ''}</span>`).join('');
  const shown = S.rnQ ? list.filter(r => qKey(r.cEnd) === S.rnQ) : list, vis = shown.slice(0, S.rnShown);
  let lastQ = null;
  const items = vis.map(r => {
    const k = qKey(r.cEnd), head = k !== lastQ ? (lastQ = k, (() => { const g = shown.filter(x => qKey(x.cEnd) === k); return `<div class="rnq"><b>${qLabel(k)}</b><span class="sub">${g.length} route${g.length === 1 ? '' : 's'} · ${fInt(sum(g, x => x.pvr))} PVR · ${fGbp(val(g))} a year</span></div>`; })()) : '';
    const e = eff(r), gp = gap(r), cp = e?.costPerMile > 0 ? e.costPerMile : r.cpm;
    const was = oldBid(r), a = e?.acceptedBid > 0 ? e.acceptedBid : was;
    const d = e ? (e.acceptedBid > 0 && was ? e.acceptedBid - was : null) : (r.fcValue != null && was ? r.fcValue - was : null);
    const price = cp > 0 ? `<span data-tip="${e ? 'New contract price' : 'Current price'}\n£${cp.toFixed(2)} per mile${e ? ' (awarded ' + esc(fDate(e.awardDate)) + ')' : ' as awarded'}${gp != null ? `\n${gp >= 0 ? '+' : '−'}${Math.abs(gp).toFixed(0)}% against £${bench.toFixed(2)}, the median of awards in the last 24 months` : ''}"><small>${e ? 'New £/mile' : '£/mile'}</small><b>£${cp.toFixed(2)}</b>${gp != null ? `<em class="pd ${gp > 5 ? 'hi' : gp < -5 ? 'lo' : ''}">${gp >= 0 ? '▲' : '▼'} ${Math.abs(gp).toFixed(0)}%</em>` : ''}</span>` : `<span><small>£/mile</small><b>—</b></span>`;
    return `${head}<button type="button" class="rnrow" data-r="${esc(r.id)}"><span class="rm"><span class="badge">${esc(r.id)}</span><span class="t"><b>${esc(r.from)} ⇄ ${esc(r.to)}</b><span class="sub"><i class="dot" style="background:${opColour(r.op)}"></i>${esc(shortOp(r.op))} · ${esc(r.garageName ?? '')}</span></span></span>
      <span class="rn"><span><small>Ends</small><b>${esc(fDate(r.cEnd))}</b></span><span><small>PVR</small><b>${fInt(r.pvr)}</b></span>${price}
      <span data-tip="${e ? 'Awarded annual value' : 'Annual value'}\n${e ? 'The new contract’s accepted bid' + (d != null ? '; ' + (d >= 0 ? '+' : '−') + fGbp(Math.abs(d)) + ' against the current contract' : '') : 'Current accepted bid' + (d != null ? `\nAt the recent median £/mile a re-tender would be about ${fGbp(r.fcValue)} (${d >= 0 ? '+' : '−'}${fGbp(Math.abs(d))}). Indicative only` : '')}"><small>${e ? 'New a year' : 'A year'}</small><b>${fGbp(a)}</b>${d != null ? `<em class="pd ${d > 0 ? 'hi' : 'lo'}">${d > 0 ? '▲' : '▼'} ${fGbp(Math.abs(d))}</em>` : ''}</span>
      <span class="rt">${tenderCell(r)}</span></span></button>`;
  }).join('');
  const f = [['open', 'Still open'], ['awarded', 'Already awarded'], ['all', 'All'], ['above', 'Priced above recent awards'], ['below', 'Priced below'], ['prog', 'In the tender programme']];
  const progN = all.filter(r => r.pipe || r.next).length;
  $('#renewals').innerHTML = `<div class="ch"><div><h2>Renewal calendar</h2><p>Contracts ending in the next ${S.rnWin} months${sc.kind === 'all' ? ' across London' : ' · ' + esc(sc.name)}, with price context</p></div>
      <div class="ctl"><div class="seg" role="group" aria-label="Window">${RN_WINDOWS.map(w => `<button class="${w === S.rnWin ? 'on' : ''}" data-rnwin="${w}">${w} mo</button>`).join('')}</div>
      <button class="btn" id="rnCsv" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/></svg><span>CSV</span></button></div></div>
    <div class="cb"><div class="rnstats">
      <div><div class="l">Routes ending</div><div class="v">${fInt(all.length)}</div><div class="s">${fInt(open.length)} still open · ${fInt(done)} already awarded</div></div>
      <div><div class="l">Annual value ending</div><div class="v">${fGbp(cur)}</div><div class="s">${fPct(sc.st.value ? cur / sc.st.value * 100 : null, 0)} of current value</div></div>
      <div><div class="l">Recent award median</div><div class="v">${bench ? '£' + bench.toFixed(2) : '—'}<small> /mile</small></div><div class="s">${fInt(D.bench.n)} awards in the last 24 months</div></div>
      <div><div class="l">Indicative price drift</div><div class="v">${nPrice ? (sw >= 0 ? '+' : '−') + fGbp(Math.abs(sw)) : '—'}</div><div class="s">${nPrice ? `open routes re-priced at the recent median · ${nOf(nPrice, 'route')}` : 'no open routes with price data'}</div></div></div>
      ${all.length ? `<div class="cols rnc" role="group" aria-label="Value of contracts ending, by quarter">${cols}</div><div class="xl rnx">${labels}</div>` : ''}
      <div class="rnf" role="group" aria-label="Filter">${f.map(([k, l]) => `<button type="button" class="fchip ${S.rnFilter === k ? 'on' : ''}" data-rnf="${k}" aria-pressed="${S.rnFilter === k}">${l}${{ open:open.length, awarded:done, all:all.length, prog:progN }[k] != null ? `<span class="cn">${{ open:open.length, awarded:done, all:all.length, prog:progN }[k]}</span>` : ''}</button>`).join('')}${S.rnQ ? `<button type="button" class="fchip on" data-rnq="${S.rnQ}">${qLabel(S.rnQ)} <span aria-hidden="true">×</span><span class="vh"> clear quarter</span></button>` : ''}</div>
      <div class="rnlist" aria-live="polite">${items || `<div class="sub" style="padding:18px 4px">${all.length ? 'No routes match this filter.' : 'No contracts end in this window.'}</div>`}</div>
      ${shown.length > vis.length ? `<button class="btn more" type="button" id="rnMore">Show ${Math.min(25, shown.length - vis.length)} more <span class="sub">(${fInt(shown.length - vis.length)} left)</span></button>` : ''}
      <div class="sub" style="margin-top:12px">Indicative only: the swing re-prices each route’s contracted miles at the median £/mile of awards made in the last 24 months, so it shows direction and scale, not a forecast of what bidders will offer. Contract end dates are TfL’s; extension options are not applied.</div></div>`;
}
export function rnCsv(){
  const { list, gap, bench } = rnList(), lim = S.rnQ ? list.filter(r => qKey(r.cEnd) === S.rnQ) : list;
  const q = v => { let s = String(v ?? ''); if(/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['route','from','to','operator','garage','pvr','contract_end','gbp_per_mile','vs_recent_median_pct','annual_value_gbp','indicative_retender_value_gbp','tender_status'],
    ...lim.map(r => [r.id, r.from, r.to, r.op, r.garageName ?? '', r.pvr, r.cEnd, (eff(r)?.costPerMile ?? r.cpm) ?? '', gap(r) != null ? gap(r).toFixed(1) : '', (eff(r)?.acceptedBid ?? r.cur?.acceptedBid) ?? '', !eff(r) && r.fcValue != null ? Math.round(r.fcValue) : '', eff(r) ? 'awarded ' + eff(r).awardDate : r.pipe ? 'programme: tender ' + r.pipe.issueDate : r.next ? 'programme' : 'open'])];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(q).join(',')).join('\r\n')], { type:'text/csv' }));
  a.download = `${SC().name.toLowerCase().replace(/\W+/g, '-')}-renewals-${S.rnWin}-months.csv`; document.body.append(a); a.click(); a.remove();
}
