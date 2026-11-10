/* View: price versus rivals — are this operator's winning bids cheaper or dearer per mile than each other
   operator's, taking electric awards and diesel/hybrid awards separately (so new electric fleets are never set
   against old diesels)? Two numbers up top, then one row per rival in the head-to-head style: bar to the left
   means we bid cheaper than them, bar to the right dearer. The two prices and award counts live in the tooltip
   and the table view. */
import { D } from '../data.js';
import { $, esc } from '../dom.js';
import { nOf, sum } from '../format.js';
import { S, SC } from '../state.js';
import { ALL, opColour, OPS } from '../tokens.js';
import { shortOp } from './hero.js';

const MIN = 3;                                                     // awards a side needs before a price is shown
const fP = v => Number.isFinite(v) ? '£' + v.toFixed(2) : '—';
const pct = g => Math.abs(g * 100).toFixed(Math.abs(g) < 0.1 ? 1 : 0) + '%';
const fGap = g => !Number.isFinite(g) ? '—' : Math.abs(g) < 0.005 ? 'same' : (g > 0 ? '+' : '−') + pct(g);
const words = g => Math.abs(g) < 0.005 ? 'the same price' : `${pct(g)} ${g > 0 ? 'dearer' : 'cheaper'}`;
const CLS = [['ev', 'Electric bids', p => p.ev], ['ne', 'Diesel & hybrid bids', p => !p.ev]];

/* the price of a set of awards: every £ of accepted bid ÷ every contracted mile, in today's money — a weighted
   average, so a 30-bus route counts for more than a school run */
function price(pts, min){
  const l = pts.filter(p => p.bid && p.miles && p.k); if(l.length < min) return { v:null, n:l.length };
  return { v:sum(l, p => p.bid * p.k) / sum(l, p => p.miles), n:l.length };
}
const cmp = (mine, theirs, min) => { const a = price(mine, min), b = price(theirs, min); return { a, b, gap:Number.isFinite(a.v) && Number.isFinite(b.v) ? a.v / b.v - 1 : null }; };

function build(sc){
  const G = D.GAP, me = sc.kind === 'garage' ? sc.g.name + ' garage' : sc.kind === 'all' ? null : shortOp(sc.op);
  const mineOf = sc.kind === 'garage' ? (p => p.tok.some(t => sc.ids.has(t))) : sc.kind === 'op' ? (p => p.g === sc.op) : null;
  const min = sc.kind === 'garage' ? 2 : MIN;
  const rows = [];
  if(sc.kind === 'all'){
    // no one is selected: each operator's bids against everyone else's
    for(const o of OPS){
      const mine = G.filter(p => p.g === o), rest = G.filter(p => p.g !== o); if(!mine.length) continue;
      rows.push({ name:shortOp(o), colour:opColour(o), who:shortOp(o), ev:cmp(mine.filter(p => p.ev), rest.filter(p => p.ev), min), ne:cmp(mine.filter(p => !p.ev), rest.filter(p => !p.ev), min) });
    }
    const ev = price(G.filter(p => p.ev), min), ne = price(G.filter(p => !p.ev), min);
    return { rows, me:null, head:{ ev, ne, gap:Number.isFinite(ev.v) && Number.isFinite(ne.v) ? ev.v / ne.v - 1 : null } };
  }
  const mine = G.filter(mineOf), rest = G.filter(p => !mineOf(p));
  for(const o of OPS){
    if(sc.kind === 'op' && o === sc.op) continue;
    const theirs = rest.filter(p => p.g === o); if(!theirs.length) continue;
    rows.push({ name:shortOp(o), colour:opColour(o), who:me, ev:cmp(mine.filter(p => p.ev), theirs.filter(p => p.ev), min), ne:cmp(mine.filter(p => !p.ev), theirs.filter(p => !p.ev), min) });
  }
  const all = { name:'All other operators', who:me, total:true, sel:true, ev:cmp(mine.filter(p => p.ev), rest.filter(p => p.ev), min), ne:cmp(mine.filter(p => !p.ev), rest.filter(p => !p.ev), min) };
  rows.push(all);
  return { rows, me, head:all };
}

function row(r, k, max){
  const c = r[k], g = c.gap, ok = Number.isFinite(g), who = r.who ?? r.name;
  const few = (nm, n) => n ? `Too few ${nm} awards (${n})` : `No priced ${nm} awards`;
  const why = ok ? '' : c.a.v == null && c.b.v == null ? `Too few awards (${who} ${c.a.n}, ${r.name} ${c.b.n})` : c.a.v == null ? few(who, c.a.n) : few(r.name, c.b.n);
  const tip = `${who} vs ${r.name} · ${CLS.find(x => x[0] === k)[1].toLowerCase()}\n${who}: ${fP(c.a.v)} per mile · ${nOf(c.a.n, 'award')}\n${r.name}: ${fP(c.b.v)} per mile · ${nOf(c.b.n, 'award')}\n${ok ? who + ' bids ' + words(g) : why}`;
  const w = ok ? (Math.abs(g) / (max || 1) * 100).toFixed(1) + '%' : '0';
  return `<div class="hh gr ${r.sel ? 'sel' : ''} ${r.total ? 'tot' : ''} ${ok ? '' : 'none'}" data-tip="${esc(tip)}" tabindex="0">
    <span class="nm">${r.colour ? `<i class="dot" style="background:${r.colour}"></i>` : ''}<span>${esc(r.name)}</span></span>
    <span class="l">${ok && g < -0.005 ? `<i style="width:${w}"></i>` : ''}</span><span class="r">${ok && g > 0.005 ? `<i style="width:${w}"></i>` : ok ? '' : `<span class="nod">${esc(why)}</span>`}</span>
    <span class="n ${ok && g > 0.005 ? 'up' : ok && g < -0.005 ? 'dn' : ''}">${ok ? fGap(g) : ''}</span></div>`;
}

export function renderGap(){
  const sc = SC(), { rows, me, head } = build(sc);
  const max = Math.max(0.05, ...rows.flatMap(r => [Math.abs(r.ev.gap ?? 0), Math.abs(r.ne.gap ?? 0)]));
  const whoL = sc.kind === 'all' ? 'cheaper' : `${esc(me)} cheaper`, whoR = sc.kind === 'all' ? 'dearer' : `${esc(me)} dearer`;
  let headline;
  if(sc.kind === 'all'){
    headline = `<div class="gks"><div class="gk"><div class="big">${fP(head.ev.v)}</div><div class="gl">per mile · electric bids</div></div><div class="gk"><div class="big">${fP(head.ne.v)}</div><div class="gl">per mile · diesel & hybrid bids</div></div></div>
      <div class="gtxt"><b>Across London, routes awarded on electric buses cost ${Number.isFinite(head.gap) ? words(head.gap).replace('dearer', 'more').replace('cheaper', 'less') : '—'} per mile than routes awarded on diesel or hybrid.</b><span class="sub">Each row below sets one operator’s winning bids against everyone else’s. Based on ${nOf(head.ev.n, 'electric award')} and ${nOf(head.ne.n, 'diesel/hybrid award')} in the last five years.</span></div>`;
  } else {
    const part = (c, label) => Number.isFinite(c.gap) ? `${label} bids <b>${words(c.gap)}</b> per mile` : `too few ${label} awards to compare (${c.a.n})`;
    const subject = sc.kind === 'garage' ? `Routes now at <b>${esc(sc.g.name)} garage</b> were won with` : `<b>${esc(me)}</b> wins routes with`;
    headline = `<div class="gks"><div class="gk"><div class="big">${fGap(head.ev.gap)}</div><div class="gl">electric bids vs other operators</div></div><div class="gk"><div class="big">${fGap(head.ne.gap)}</div><div class="gl">diesel & hybrid bids vs other operators</div></div></div>
      <div class="gtxt">Against every other operator’s winning bids, ${subject} ${part(head.ev, 'electric')} and ${part(head.ne, 'diesel and hybrid')}.<span class="sub">Based on ${nOf(head.ev.a.n, 'electric award')} and ${nOf(head.ne.a.n, 'diesel/hybrid award')} ${sc.kind === 'garage' ? 'on routes now at this garage' : 'won by ' + esc(me)} in the last five years.</span></div>`;
  }
  const hhead = `<div class="hh hhead gr"><span></span><span class="l">◂ ${whoL}</span><span class="r">${whoR} ▸</span><span class="n"></span></div>`;
  const pane = ([k, title]) => `<div class="gpane"><h4 class="mh">${title}${sc.kind === 'all' ? '' : ` · ${esc(me)} vs each operator`}</h4>${hhead}${rows.map(r => row(r, k, max)).join('')}</div>`;
  const table = `<table class="dt"><thead><tr><th>${sc.kind === 'all' ? 'Operator' : 'Versus'}</th><th class="r">${sc.kind === 'all' ? 'Their' : esc(me)} electric £/mile</th><th class="r">${sc.kind === 'all' ? 'Others’' : 'Their'} electric</th><th class="r">Gap</th><th class="r">${sc.kind === 'all' ? 'Their' : esc(me)} diesel/hybrid £/mile</th><th class="r">${sc.kind === 'all' ? 'Others’' : 'Their'} diesel/hybrid</th><th class="r">Gap</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.sel ? 'sel' : ''}"><td>${esc(r.name)}</td><td class="r">${fP(r.ev.a.v)} <span class="sub">· ${r.ev.a.n}</span></td><td class="r">${fP(r.ev.b.v)} <span class="sub">· ${r.ev.b.n}</span></td><td class="r"><b>${fGap(r.ev.gap)}</b></td><td class="r">${fP(r.ne.a.v)} <span class="sub">· ${r.ne.a.n}</span></td><td class="r">${fP(r.ne.b.v)} <span class="sub">· ${r.ne.b.n}</span></td><td class="r"><b>${fGap(r.ne.gap)}</b></td></tr>`).join('')}</tbody></table>`;
  const body = S.gapView === 'table' ? `<div class="tw">${table}</div>` : `<div class="gapw">${CLS.map(pane).join('')}</div>`;
  $('#evgap').innerHTML = `<div class="ch"><div><h2>Price versus rivals</h2><p>${sc.kind === 'all' ? 'How each operator’s winning bids compare per mile with everyone else’s' : `How ${esc(me)}’s winning bids compare per mile with each other operator’s`}, for electric and for diesel/hybrid buses</p></div>
      <div class="ctl"><div class="seg" role="group" aria-label="View"><button class="${S.gapView === 'chart' ? 'on' : ''}" data-gapview="chart">Chart</button><button class="${S.gapView === 'table' ? 'on' : ''}" data-gapview="table">Table</button></div></div></div>
    <div class="cb"><div class="ghd">${headline}</div>${body}
      <div class="sub gnote">Hover a row for the two prices. Price is the total contract value ÷ total contracted miles of each operator’s TfL awards in the last five years, in today’s money, so a big route counts for more than a school run. Electric is compared only with electric (nearly all on new buses) and diesel/hybrid only with diesel/hybrid.${sc.kind === 'garage' ? ' At garage level only awards on routes now run from this garage count, so the sample is small.' : ''}</div></div>`;
}
