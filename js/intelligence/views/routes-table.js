/* View: routes table. */
import { D, plusMonths, TODAY, TODAY_ISO } from '../data.js';
import { $, esc } from '../dom.js';
import { fDate, fInt, fMon, fNum, natKey, nOf, warnIcon } from '../format.js';
import { glyph } from '../geometry.js';
import { S, SC } from '../state.js';
import { CLASS, PROP_LABEL, propClass } from '../tokens.js';
import { COL_TIPS } from '../ui/info.js';
import { shortOp } from './hero.js';

/* ── view: routes table ──────────────────────────────────────────────────── */
const SORTS = {
  id:r => natKey(r.id), rel:r => { const p = D.relPass(r); return p === null ? -1 : p ? 1 : 0; }, pvr:r => r.pvr, age:r => r.age ?? -1, cpm:r => r.cpm ?? -1, op:r => r.opPct ?? -1, end:r => r.cEnd ?? '9999', next:r => r.pipe?.contractStart ?? r.award?.contractStart ?? '9999',
};
const COLS = [['id','Route'],[null,'Corridor'],['pvr','PVR','num'],['age','Fleet'],['cpm','£/mile','num'],['op','Operated','num'],['rel','Reliability','num'],['end','Contract runway'],['next','Tender status']];
export function filtered(){
  const q = S.q.trim().toLowerCase(), lim = plusMonths(24);
  let list = SC().st.list.filter(r =>
    (!q || r.id.toLowerCase() === q || r.id.toLowerCase().startsWith(q) || `${r.from} ${r.to} ${r.garageName}`.toLowerCase().includes(q)) &&
    (S.prop === 'all' || propClass(r.prop) === S.prop) &&
    (!S.flags.has('exp') || (r.cEnd && r.cEnd >= TODAY_ISO && r.cEnd <= lim)) &&
    (!S.flags.has('high') || r.freq === 'high') &&
    (!S.flags.has('dis') || (r.status && r.status.status !== 'Good Service')) &&
    (!S.flags.has('attn') || r.flags.length >= 3) &&
    (!S.flags.has('prog') || r.pipe) && (!S.flags.has('awd') || r.award) &&
    (S.year == null || (r.cEnd && r.cEnd >= TODAY_ISO && (S.year === 'later' ? +r.cEnd.slice(0, 4) >= TODAY.getUTCFullYear() + 10 : +r.cEnd.slice(0, 4) === S.year))));
  const k = SORTS[S.sort.k]; list.sort((a, b) => { const x = k(a), y = k(b); return (x < y ? -1 : x > y ? 1 : 0) * S.sort.dir; });
  return list;
}
const relTxt = r => /EWT/.test(r.relMetric ?? '') ? r.rel.toFixed(2) + ' min' : r.rel.toFixed(1) + '%';
export function tenderCell(r){
  const out = [];
  if(r.award){
    const a = r.award, chg = a.operatorChange;
    out.push(`<span class="tstat"><span class="tag good" data-tip="Awarded ${esc(fDate(a.awardDate))}\n${chg ? 'Changes from ' + esc(a.fromOperator ?? '—') + ' to ' + esc(a.operator) : esc(a.operator) + ' keeps the route'}${a.contractStart ? '\nNew contract starts ' + esc(fDate(a.contractStart)) : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Awarded</span>${chg ? `<span class="sub">→ ${esc(shortOp(a.operator))}</span>` : ''}</span>`);
  }
  if(r.pipe){
    const e = r.pipe, open = e.issueDate && e.issueDate <= TODAY_ISO;
    out.push(`<span class="tstat"><span class="tag blue" data-tip="${open ? 'Out to tender now' : 'Tender due to be issued ' + esc(fDate(e.issueDate))}\n${e.returnDate ? 'Bids due ' + esc(fDate(e.returnDate)) : ''}${e.awardEstimated ? '\nAward expected ' + esc(e.awardEstimated) : ''}\nNew contract starts ${esc(fDate(e.contractStart))}">${open ? 'Out to tender' : 'Tender ' + esc(fMon(e.issueDate))}</span></span>`);
  }
  return out.length ? `<div class="tcol">${out.join('')}</div>` : '<span class="sub">—</span>';
}
function rowHtml(r){
  const cls = propClass(r.prop), rel = D.relPass(r);
  const d = r.cpm && D.netMedianCpm ? (r.cpm / D.netMedianCpm - 1) * 100 : null;
  const tot = r.cStart && r.cEnd ? Date.parse(r.cEnd) - Date.parse(r.cStart) : null, left = r.cEnd ? Date.parse(r.cEnd) - TODAY.getTime() : null;
  const frac = tot > 0 && left != null ? Math.max(0, Math.min(1, left / tot)) : null, soon = r.cEnd && r.cEnd >= TODAY_ISO && r.cEnd <= plusMonths(12);
  return `<tr class="row ${S.route === r.id ? 'sel' : ''}" data-r="${esc(r.id)}" tabindex="0" aria-label="Route ${esc(r.id)}, open brief">
    <td><div class="rcell"><span class="badge">${esc(r.id)}</span>${glyph(r)}</div></td>
    <td><div class="cor" title="${esc(r.from)} ⇄ ${esc(r.to)}">${esc(r.from || '—')} <span class="sub">⇄</span> ${esc(r.to || '—')}</div><div class="sub">${r.status && r.status.status !== 'Good Service' ? `<span class="flag" style="margin:0 12px 0 0" data-tip="${esc(r.status.status)} right now">${warnIcon}Disrupted</span>` : ''}${esc(r.garageName)} (${esc(r.garage)})</div></td>
    <td class="num">${fInt(r.pvr)}</td>
    <td><span class="pill"><i class="dot" style="background:${CLASS[cls].c}"></i>${esc(PROP_LABEL[r.prop] ?? r.prop)}</span> <span class="sub">${r.age != null ? fNum(r.age, 1) + ' y' : ''}</span></td>
    <td class="num">${r.cpm ? '£' + r.cpm.toFixed(2) : '—'} ${d != null ? `<span class="sub" data-tip="vs network median £${fNum(D.netMedianCpm, 2)}">${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}%</span>` : ''}</td>
    <td class="num">${r.opPct != null ? `<span data-tip="${esc(r.opPeriod)}${r.opMin != null ? '\nMinimum standard ' + r.opMin + '%' : ''}">${r.opPct.toFixed(1)}%</span>` : '—'}</td>
    <td class="num">${r.rel != null ? `<span data-tip="${esc(r.relMetric)}: ${esc(relTxt(r))}\nStandard ${esc(r.relStd)}${/EWT/.test(r.relMetric) ? ' (lower is better)' : ' (higher is better)'}">${esc(relTxt(r))}</span>${rel === false ? ` <span class="flag" data-tip="Below the reliability standard">${warnIcon}Below</span>` : ''}` : '<span class="sub">—</span>'}</td>
    <td>${r.cEnd ? `<span>${fMon(r.cEnd)}</span>${frac != null ? `<span class="runway ${soon ? 'soon' : ''}" data-tip="${Math.round(frac * 100)}% of the contract term remaining"><i style="width:${(frac * 100).toFixed(0)}%"></i></span>` : ''}${soon ? `<span class="flag">${warnIcon}&lt;12 mo</span>` : ''}` : '<span class="sub">—</span>'}</td>
    <td>${tenderCell(r)}</td></tr>`;
}
export function renderTable(){
  const list = filtered(), s = SC().st;
  const chip = (k, label, on, attr) => `<button class="fchip ${on ? 'on' : ''}" ${attr}>${label}</button>`;
  $('#routes').innerHTML = `<div class="ch"><div><h2>Routes</h2><p>${list.length} of ${nOf(s.n, 'route')} · every row is a route brief — click for the full picture</p></div></div>
    <div class="tools"><label class="sfield"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="rq" placeholder="Filter by route, place or garage" value="${esc(S.q)}" aria-label="Filter routes"></label>
      ${[['all', 'All'], ['diesel', 'Diesel'], ['hybrid', 'Hybrid'], ['zero', 'Zero-emission']].map(([k, l]) => chip(k, l, S.prop === k, `data-prop="${k}"`)).join('')}
      <span style="width:1px;height:20px;background:var(--line-2);margin:0 4px"></span>
      ${chip('exp', 'Ends ≤ 24 months', S.flags.has('exp'), 'data-flag="exp"')}${chip('high', 'High frequency', S.flags.has('high'), 'data-flag="high"')}${chip('dis', 'Disrupted now', S.flags.has('dis'), 'data-flag="dis"')}${chip('attn', 'Needs attention', S.flags.has('attn'), 'data-flag="attn"')}
      <span style="width:1px;height:20px;background:var(--line-2);margin:0 4px"></span>
      ${chip('prog', `In tender programme <span class="cn">${s.list.filter(r => r.pipe).length}</span>`, S.flags.has('prog'), 'data-flag="prog"')}${chip('awd', `Just awarded <span class="cn">${s.list.filter(r => r.award).length}</span>`, S.flags.has('awd'), 'data-flag="awd"')}
      ${S.year != null ? `<button class="fchip on" data-clearyear>Contract ends ${S.year === 'later' ? 'later' : S.year} ✕</button>` : ''}</div>
    <div class="tw"><table class="rt"><thead><tr>${COLS.map(([k, l, c]) => `<th class="${c ?? ''}" ${k ? `data-sort="${k}"` : ''} ${COL_TIPS[l] ? `data-tip="${esc(l)}\n${esc(COL_TIPS[l])}"` : ''} scope="col">${l}${S.sort.k === k ? `<span class="ar">${S.sort.dir < 0 ? '↓' : '↑'}</span>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${list.slice(0, S.shown).map(r => rowHtml(r)).join('') || ''}</tbody></table>${list.length ? '' : '<div class="empty">No routes match these filters.</div>'}</div>
    ${list.length > S.shown ? `<div class="more"><button class="btn" id="moreBtn">Show ${Math.min(30, list.length - S.shown)} more</button></div>` : ''}`;
}
