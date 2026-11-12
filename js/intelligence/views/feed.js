/* View: what changed — the last 30 days in this scope as one dated list: awards, tenders issued, contracts
   starting, fleet moves and routes slipping below standard. Gives a returning visitor a sense of time. */
import { D, plusMonths, TODAY_ISO } from '../data.js';
import { $, esc } from '../dom.js';
import { fDate, fInt, nOf } from '../format.js';
import { S, SC } from '../state.js';
import { shortOp } from './hero.js';

const KINDS = { award:'Award', tender:'Tender', start:'Contract', fleet:'Fleet', perf:'Performance' };
const tok = s => String(s ?? '').split('/').map(x => x.trim().toUpperCase()).filter(Boolean);

export function feedItems(sc){
  const since = plusMonths(-1), ahead = plusMonths(1), ids = new Set(sc.list.map(r => r.id.toUpperCase()));
  const inScope = route => sc.kind === 'all' || tok(route).some(t => ids.has(t));
  const items = [];
  // awards (TfL or provisional) in the last 30 days — on the scope's routes, or won by the scope's operator
  for(const a of D.awards){
    if(!a.awardDate || a.awardDate < since || a.awardDate > TODAY_ISO) continue;
    const mine = inScope(a.route) || (sc.kind === 'op' && D.grp(a.operator) === sc.op);
    if(!mine) continue;
    const rid = tok(a.route)[0], from = a.fromOperator && a.operatorChange ? ` from ${esc(shortOp(D.grp(a.fromOperator) === 'Other' ? a.fromOperator : D.grp(a.fromOperator)))}` : '';
    const bits = [a.termYears ? `${a.termYears}-yr` : null, a.contractStart ? `starts ${fDate(a.contractStart)}` : null, a.vehicle?.raw ?? null, a.costPerMile > 0 ? `£${a.costPerMile.toFixed(2)}/mile` : null].filter(Boolean);
    items.push({ date:a.awardDate, kind:'award', route:rid, text:`<b>Route ${esc(a.route)}</b> ${a.operatorChange ? 'awarded' : 're-awarded'} to <b>${esc(shortOp(D.grp(a.operator) === 'Other' ? a.operator : D.grp(a.operator)))}</b>${from}${bits.length ? ' · ' + esc(bits.join(' · ')) : ''}${a.provisional ? ' <span class="tag">provisional</span>' : ''}` });
  }
  // tenders issued in the last 30 days or due to be issued in the next 30
  for(const e of D.prog){
    if(!e.issueDate || e.issueDate < since || e.issueDate > ahead || !inScope(e.route)) continue;
    const r = D.byId.get(tok(e.route)[0]);
    items.push({ date:e.issueDate, kind:'tender', route:tok(e.route)[0], text:`Tender ${e.issueDate <= TODAY_ISO ? 'issued' : 'due'} for <b>route ${esc(e.route)}</b>${r ? ` (${esc(shortOp(r.op))}, PVR ${fInt(r.pvr)})` : ''}${e.returnDate ? ` · returns ${esc(fDate(e.returnDate))}` : ''}${e.contractStart ? ` · new contract ${esc(fDate(e.contractStart))}` : ''}${e.vehicleType ? ` · ${esc(e.vehicleType)}` : ''}` });
  }
  // contracts that started in the last 30 days or start in the next 30
  for(const r of sc.list){
    const a = r.hist.find(x => x.contractStart && x.contractStart >= since && x.contractStart <= ahead);
    if(!a) continue;
    items.push({ date:a.contractStart, kind:'start', route:r.id, text:`<b>Route ${esc(r.id)}</b>’s new contract ${a.contractStart <= TODAY_ISO ? 'started' : 'starts'} with <b>${esc(shortOp(D.grp(a.operator) === 'Other' ? a.operator : D.grp(a.operator)))}</b>${a.operatorChange && a.fromOperator ? ` (from ${esc(shortOp(D.grp(a.fromOperator)))})` : ''}${a.termYears ? ` · ${a.termYears}-yr term` : ''}` });
  }
  // fleet moves between routes (the register's transfers), grouped per move
  const moves = new Map();
  for(const t of D.transfers){
    if(!t.at || t.at.slice(0, 10) < since) continue;
    const touches = [...t.from, ...t.to].some(x => ids.has(String(x).toUpperCase()));
    if(!(sc.kind === 'all' || touches || (sc.kind === 'op' && t.operator === sc.op))) continue;
    const k = `${t.from.join('/')}>${t.to.join('/')}`;
    (moves.get(k) ?? moves.set(k, { ...t, regs:[] }).get(k)).regs.push(t.reg);
  }
  for(const m of moves.values()){
    const gf = D.garages.find(g => g.code === m.fromGarage)?.name, gt = D.garages.find(g => g.code === m.toGarage)?.name;
    items.push({ date:m.at.slice(0, 10), kind:'fleet', route:m.to[0], text:`<b>${nOf(m.regs.length, 'bus', 'buses')}</b> moved from route${m.from.length > 1 ? 's' : ''} <b>${esc(m.from.join(', '))}</b> to <b>${esc(m.to.join(', '))}</b>${gf && gt && gf !== gt ? ` (${esc(gf)} → ${esc(gt)})` : ''}${m.operator ? ` · ${esc(shortOp(m.operator))}` : ''} <span class="sub">${esc(m.regs.slice(0, 4).join(', '))}${m.regs.length > 4 ? '…' : ''}</span>` });
  }
  // routes that crossed below (or back above) their reliability standard in the latest period
  const P = D.periods, last = P.at(-1), prev = P.at(-2);
  if(last && prev) for(const r of sc.list){
    const pf = r.pf; if(!pf?.reliability || r.relStd == null) continue;
    const a = pf.reliability[last], b = pf.reliability[prev]; if(!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const ewt = /EWT/.test(r.relMetric), pass = v => ewt ? v <= r.relStd : v >= r.relStd;
    if(pass(a) === pass(b)) continue;
    items.push({ date:TODAY_ISO, kind:'perf', route:r.id, text:`<b>Route ${esc(r.id)}</b> ${pass(a) ? 'is back within' : 'slipped below'} its reliability standard in ${esc(last)} (${ewt ? 'EWT ' + a.toFixed(2) + ' vs ' + r.relStd : 'on time ' + a.toFixed(1) + '% vs ' + r.relStd + '%'})` });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  return items;
}

export function renderFeed(){
  const sc = SC(), all = feedItems(sc), f = S.feedF ?? 'all', items = (f === 'all' ? all : all.filter(i => i.kind === f)).slice(0, 40);
  const counts = Object.fromEntries(Object.keys(KINDS).map(k => [k, all.filter(i => i.kind === k).length]));
  let lastDay = '';
  const rows = items.map(i => {
    const head = i.date !== lastDay ? (lastDay = i.date, `<div class="fday">${esc(fDate(i.date))}${i.date > TODAY_ISO ? ' <span class="sub">upcoming</span>' : ''}</div>`) : '';
    return `${head}<button type="button" class="fi" data-r="${esc(i.route ?? '')}"><span class="fk ${i.kind}">${KINDS[i.kind]}</span><span class="ft">${i.text}</span></button>`;
  }).join('');
  $('#changed').innerHTML = `<div class="ch"><div><h2>What changed</h2><p>${all.length ? `${nOf(all.length, 'change')} in the last 30 days${sc.kind === 'all' ? ' across London' : ' for ' + esc(sc.name)}, newest first` : 'Nothing new in the last 30 days'}</p></div>
      <div class="ctl"><div class="seg" role="group" aria-label="Kind"><button class="${f === 'all' ? 'on' : ''}" data-feedf="all">All</button>${Object.entries(KINDS).map(([k, l]) => `<button class="${f === k ? 'on' : ''}" data-feedf="${k}" ${counts[k] ? '' : 'disabled'}>${l}${counts[k] ? ` <small>${counts[k]}</small>` : ''}</button>`).join('')}</div></div></div>
    <div class="cb">${rows || '<div class="sub">Nothing of this kind in the last 30 days.</div>'}${all.length > 40 && f === 'all' ? `<div class="sub" style="margin-top:8px">Showing the latest 40 of ${all.length}. Pick a kind to see the rest.</div>` : ''}</div>`;
}
