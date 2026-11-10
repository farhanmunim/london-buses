/* View: electric price gap — does a route cost more per mile when it is awarded on electric buses rather than
   diesel or hybrid ones? One plain sentence, then one number per row: how much more (bar to the right) or less
   (bar to the left) electric awards cost per mile, in the same left/right style as the head-to-head card.
   The two underlying prices and the award counts live in the tooltip and the table view. */
import { D } from '../data.js';
import { $, esc } from '../dom.js';
import { median, nOf } from '../format.js';
import { S, SC } from '../state.js';
import { ALL, opColour, OPS } from '../tokens.js';
import { shortOp } from './hero.js';

const MIN = 3;                                                     // awards a side needs before a price is shown
const fP = v => Number.isFinite(v) ? '£' + v.toFixed(2) : '—';
const pct = g => Math.abs(g * 100).toFixed(Math.abs(g) < 0.1 ? 1 : 0) + '%';
const fGap = g => !Number.isFinite(g) ? '—' : Math.abs(g) < 0.005 ? 'same' : (g > 0 ? '+' : '−') + pct(g);
const words = g => Math.abs(g) < 0.02 ? 'about the same' : `${pct(g)} ${g > 0 ? 'more' : 'less'}`;
const price = pts => median(pts.map(p => p.real ?? p.v));      // today's money, one award one vote

/* electric vs diesel/hybrid for a list of awards */
function stat(pts, min = MIN){
  const ev = pts.filter(p => p.ev), ne = pts.filter(p => !p.ev);
  const e = ev.length >= min ? price(ev) : null, n = ne.length >= min ? price(ne) : null;
  return { ev:{ n:ev.length, v:e }, ne:{ n:ne.length, v:n }, gap:Number.isFinite(e) && Number.isFinite(n) && n > 0 ? e / n - 1 : null };
}

function rowsFor(sc){
  const G = D.GAP, own = sc.kind === 'all' ? null : sc.op;
  const ops = OPS.map(o => ({ name:shortOp(o), colour:opColour(o), st:stat(G.filter(p => p.g === o)), sel:o === own }))
    .filter(r => r.st.ev.n + r.st.ne.n > 0)
    .sort((a, b) => (b.st.gap ?? -9) - (a.st.gap ?? -9) || (b.st.ev.n + b.st.ne.n) - (a.st.ev.n + a.st.ne.n));
  const london = { name:'All London', colour:'#2a78d6', st:stat(G), sel:sc.kind === 'all', total:true };
  let left = [...ops, london], head = sc.kind === 'all' ? london : ops.find(r => r.sel) ?? { st:stat([]) };
  if(sc.kind === 'garage'){
    const gar = { name:sc.g.name + ' garage', colour:sc.colour, st:stat(G.filter(p => p.tok.some(t => sc.ids.has(t))), 2), sel:true, total:true, tip:'Awards on routes now run from this garage' };
    left = [gar, ...ops.map(r => ({ ...r, sel:false })), london]; head = gar;
  }
  // the same awards, split by what happened to the route when it was re-tendered (always the winning bid)
  let right, rTitle, rNote;
  if(sc.kind === 'all'){
    rTitle = 'When routes were re-tendered';
    right = [{ name:'Kept their operator', st:stat(G.filter(p => p.same === true)) }, { name:'Changed operator', st:stat(G.filter(p => p.same === false)) }];
    rNote = 'A smaller gap on routes that changed operator means the challengers priced their electric bids closer to diesel and hybrid.';
  } else {
    const op = sc.op, nm = shortOp(op), here = sc.kind === 'garage' ? (p => p.tok.some(t => sc.ids.has(t))) : (() => true), m = sc.kind === 'garage' ? 2 : MIN;
    right = [
      { name:'Kept', st:stat(G.filter(p => here(p) && p.same === true && p.w === op), m), tip:`${nm} was re-awarded the route · its own winning price` },
      { name:'Won from rivals', st:stat(G.filter(p => here(p) && p.same === false && p.w === op), m), tip:`${nm} took the route from another operator · its own winning price` },
    ];
    rTitle = sc.kind === 'garage' ? 'When routes now at this garage were re-tendered' : `When ${nm}’s routes were re-tendered`;
    if(sc.kind === 'garage') rNote = 'Only routes still run from this garage are counted, so routes lost cannot be shown at garage level.';
    else {
      right.push({ name:'Lost to rivals', st:stat(G.filter(p => p.same === false && p.fr === op && p.w !== op)), tip:`A rival took the route from ${nm} · the rival’s winning price` });
      rNote = `Each bar is the winning bid. On routes ${nm} lost, that is the rival’s price.`;
    }
  }
  return { left, right, rTitle, rNote, head, london };
}

function row(r, max){
  const g = r.st.gap, e = r.st.ev.v, n = r.st.ne.v, ok = Number.isFinite(g), tot = r.st.ev.n + r.st.ne.n;
  const why = ok ? '' : !tot ? 'No priced awards' : !Number.isFinite(e) ? `Too few electric awards (${r.st.ev.n})` : !Number.isFinite(n) ? `Too few diesel/hybrid awards (${r.st.ne.n})` : `Too few awards (${tot})`;
  const tip = `${r.name}${r.tip ? '\n' + r.tip : ''}\nElectric: ${fP(e)} per mile · ${nOf(r.st.ev.n, 'award')}\nDiesel & hybrid: ${fP(n)} per mile · ${nOf(r.st.ne.n, 'award')}\n${ok ? 'Electric costs ' + words(g) : why}`;
  const w = ok ? (Math.abs(g) / (max || 1) * 100).toFixed(1) + '%' : '0';
  return `<div class="hh gr ${r.sel ? 'sel' : ''} ${r.total ? 'tot' : ''} ${ok ? '' : 'none'}" data-tip="${esc(tip)}" tabindex="0">
    <span class="nm">${r.colour ? `<i class="dot" style="background:${r.colour}"></i>` : ''}<span>${esc(r.name)}</span></span>
    <span class="l">${ok && g < -0.005 ? `<i style="width:${w}"></i>` : ''}</span><span class="r">${ok && g > 0.005 ? `<i style="width:${w}"></i>` : ok ? '' : `<span class="nod">${esc(why)}</span>`}</span>
    <span class="n ${ok && g > 0.005 ? 'up' : ok && g < -0.005 ? 'dn' : ''}">${ok ? fGap(g) : ''}</span></div>`;
}

export function renderGap(){
  const sc = SC(), { left, right, rTitle, rNote, head, london } = rowsFor(sc);
  const max = Math.max(0.05, ...[...left, ...right].map(r => Math.abs(r.st.gap ?? 0)));
  const g = head.st.gap, who = sc.kind === 'all' ? 'London' : sc.kind === 'garage' ? sc.g.name + ' garage' : shortOp(sc.op);
  const ldn = sc.kind !== 'all' && Number.isFinite(london.st.gap) ? ` Across London, electric costs ${words(london.st.gap)}.` : '';
  const headline = Number.isFinite(g)
    ? `<div class="big">${fGap(g)}</div><div class="gtxt"><b>${esc(who)} pays ${Math.abs(g) < 0.02 ? 'about the same' : words(g)} per mile for routes awarded on electric buses ${Math.abs(g) < 0.02 ? 'as' : 'than'} on diesel or hybrid.</b>${esc(ldn)}<span class="sub"> Based on ${nOf(head.st.ev.n, 'electric award')} and ${nOf(head.st.ne.n, 'diesel/hybrid award')} in the last five years.</span></div>`
    : `<div class="big">—</div><div class="gtxt"><b>Not enough awards to compare ${esc(who)} yet</b> (${head.st.ev.n} electric, ${head.st.ne.n} diesel/hybrid).${esc(ldn)}</div>`;
  const head_ = `<div class="hh hhead gr"><span></span><span class="l">◂ <span class="xs">Electric </span>cheaper</span><span class="r"><span class="xs">Electric </span>dearer ▸</span><span class="n"></span></div>`;
  const pane = (title, rows, note) => `<div class="gpane"><h4 class="mh">${esc(title)}</h4>${head_}${rows.map(r => row(r, max)).join('')}${note ? `<div class="sub gnote">${note}</div>` : ''}</div>`;
  const table = rows => `<table class="dt"><thead><tr><th></th><th class="r">Diesel & hybrid</th><th class="r">Electric</th><th class="r">Electric costs</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.sel ? 'sel' : ''}"><td>${esc(r.name)}</td><td class="r">${fP(r.st.ne.v)} <span class="sub">· ${r.st.ne.n}</span></td><td class="r">${fP(r.st.ev.v)} <span class="sub">· ${r.st.ev.n}</span></td><td class="r"><b>${Number.isFinite(r.st.gap) ? words(r.st.gap) : '—'}</b></td></tr>`).join('')}</tbody></table>`;
  const body = S.gapView === 'table'
    ? `<div class="gapw"><div class="gpane"><h4 class="mh">By operator</h4>${table(left)}<div class="sub gnote">£ per live mile, median of awards in the last five years, in today’s money · number of awards after each price.</div></div><div class="gpane"><h4 class="mh">${esc(rTitle)}</h4>${table(right)}<div class="sub gnote">${rNote}</div></div></div>`
    : `<div class="gapw">${pane('By operator', left)}${pane(rTitle, right, rNote)}</div>`;
  $('#evgap').innerHTML = `<div class="ch"><div><h2>Electric price gap</h2><p>How much more TfL pays per mile when a route is awarded on electric buses rather than diesel or hybrid</p></div>
      <div class="ctl"><div class="seg" role="group" aria-label="View"><button class="${S.gapView === 'chart' ? 'on' : ''}" data-gapview="chart">Chart</button><button class="${S.gapView === 'table' ? 'on' : ''}" data-gapview="table">Table</button></div></div></div>
    <div class="cb"><div class="ghd">${headline}</div>${body}
      <div class="sub gnote">Hover a row for the two prices. Most electric awards are for brand-new buses, so part of the gap is the cost of new vehicles rather than the drivetrain. Prices are TfL’s £ per live mile at award, adjusted to today’s money.</div></div>`;
}
