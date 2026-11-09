/* View: zero-emission price gap — what awards on electric buses cost per mile against awards on diesel and hybrid
   buses, for each operator and for the routes that changed hands. A dumbbell per row: the light dot is the
   diesel/hybrid price, the dark dot the electric price, the number on the right is the gap between them. */
import { D } from '../data.js';
import { $, esc } from '../dom.js';
import { median, nOf } from '../format.js';
import { S, SC } from '../state.js';
import { ALL, opColour, OPS } from '../tokens.js';
import { shortOp } from './hero.js';

const C_NE = 'var(--seq-3)', C_EV = 'var(--seq-5)';   // one hue, two shades: an ordered pair, not two categories
const fP = v => Number.isFinite(v) ? '£' + v.toFixed(2) : '—';
const fGap = g => !Number.isFinite(g) ? '—' : (g >= 0 ? '+' : '−') + Math.abs(g * 100).toFixed(Math.abs(g) < 0.1 ? 1 : 0) + '%';
const val = p => S.real ? p.real : p.v;

/* price of a set of awards: the median £/mile, or every £ ÷ every mile ("by miles") */
function price(pts){
  if(S.gapW === 'miles'){
    const l = pts.filter(p => p.bid && p.miles && (!S.real || p.k)); if(!l.length) return null;
    return l.reduce((s, p) => s + p.bid * (S.real ? p.k : 1), 0) / l.reduce((s, p) => s + p.miles, 0);
  }
  return median(pts.map(val));
}
/* one row: electric vs diesel/hybrid for a list of awards; a side needs `min` awards before it is priced */
function stat(pts, min){
  const ev = pts.filter(p => p.ev), ne = pts.filter(p => !p.ev);
  const e = ev.length >= min ? price(ev) : null, n = ne.length >= min ? price(ne) : null;
  return { ev:{ n:ev.length, v:e }, ne:{ n:ne.length, v:n }, gap:Number.isFinite(e) && Number.isFinite(n) && n > 0 ? e / n - 1 : null };
}

function rowsFor(sc){
  const G = D.GAP, min = 3;
  const own = sc.kind === 'all' ? null : sc.op;
  // left: every operator, own operator emphasised, London as the reference row
  const ops = OPS.map(o => ({ key:o, name:shortOp(o), colour:opColour(o), st:stat(G.filter(p => p.g === o), min), sel:o === own }))
    .filter(r => r.st.ev.n + r.st.ne.n > 0)
    .sort((a, b) => (b.st.gap ?? -9) - (a.st.gap ?? -9) || (b.st.ev.n + b.st.ne.n) - (a.st.ev.n + a.st.ne.n));
  const london = { key:ALL, name:'All London', colour:'#2a78d6', st:stat(G, min), sel:sc.kind === 'all', total:true };
  let left = [...ops, london], gar = null;
  if(sc.kind === 'garage'){
    gar = { key:sc.key, name:sc.g.name + ' garage', colour:sc.colour, st:stat(G.filter(p => p.tok.some(t => sc.ids.has(t))), 2), sel:true, total:true, tip:'Awards on routes now run from this garage' };
    left = [gar, ...ops.map(r => ({ ...r, sel:false })), london];
  }
  // right: the same awards split by what happened to the route at re-tender (the winner's price in every case)
  let right, rTitle, rNote;
  if(sc.kind === 'all'){
    rTitle = 'By outcome of the re-tender';
    right = [{ name:'Kept the incumbent', st:stat(G.filter(p => p.same === true), min) }, { name:'Changed operator', st:stat(G.filter(p => p.same === false), min) }];
    rNote = 'Routes that changed hands were won at these prices: a smaller gap here than above means challengers priced electric bids close to diesel and hybrid ones.';
  } else {
    const op = sc.op, here = sc.kind === 'garage' ? (p => p.tok.some(t => sc.ids.has(t))) : (() => true), m = sc.kind === 'garage' ? 2 : min;
    right = [
      { name:'Retained', st:stat(G.filter(p => here(p) && p.same === true && p.w === op), m), tip:`${shortOp(op)} kept the route · its own winning price` },
      { name:'Won from rivals', st:stat(G.filter(p => here(p) && p.same === false && p.w === op), m), tip:`${shortOp(op)} took the route · its own winning price` },
    ];
    if(sc.kind === 'garage'){ rTitle = 'Re-tenders of routes now at this garage'; rNote = 'Only routes still run from this garage are counted, so losses cannot be shown at garage level.'; }
    else {
      right.push({ name:'Lost to rivals', st:stat(G.filter(p => p.same === false && p.fr === op && p.w !== op), min), tip:`A rival took the route from ${shortOp(op)} · the rival’s winning price` });
      rTitle = `${shortOp(op)}’s re-tenders`; rNote = 'Each dot is the winning bid. On lost routes that is the rival’s price, so a lower electric dot there than on retained routes is the price it took to beat the incumbent.';
    }
  }
  return { left, right, rTitle, rNote, head:gar ?? (sc.kind === 'all' ? london : ops.find(r => r.sel) ?? { st:stat([], min) }), london };
}

function dumbbell(r, lo, hi){
  const X = v => ((v - lo) / (hi - lo || 1) * 100).toFixed(1), e = r.st.ev.v, n = r.st.ne.v, both = Number.isFinite(e) && Number.isFinite(n);
  const dot = (v, cls, label) => Number.isFinite(v) ? `<i class="pt ${cls}" style="left:${X(v)}%" aria-label="${label} ${fP(v)}"></i>` : '';
  const lab = (v, side) => Number.isFinite(v) ? `<b class="vl ${side}" style="left:${X(v)}%">${fP(v)}</b>` : '';
  const [lv, hv] = both ? (n <= e ? [n, e] : [e, n]) : [null, Number.isFinite(e) ? e : n];
  const tot = r.st.ev.n + r.st.ne.n;
  const missing = !Number.isFinite(e) && !Number.isFinite(n) ? (tot ? `Too few priced awards (${tot})` : 'No priced awards') : !Number.isFinite(e) ? `Too few electric awards (${r.st.ev.n})` : !Number.isFinite(n) ? `Too few diesel/hybrid awards (${r.st.ne.n})` : '';
  const tip = `${r.name}${r.tip ? '\n' + r.tip : ''}\nElectric: ${fP(e)} · ${nOf(r.st.ev.n, 'award')}\nDiesel & hybrid: ${fP(n)} · ${nOf(r.st.ne.n, 'award')}${both ? '\nGap: ' + fGap(r.st.gap) : missing ? '\n' + missing : ''}`;
  const empty = !Number.isFinite(e) && !Number.isFinite(n);
  return `<div class="gr ${r.sel ? 'sel' : ''} ${r.total ? 'tot' : ''} ${empty ? 'none' : ''}" data-tip="${esc(tip)}" tabindex="0">
    <span class="nm">${r.colour ? `<i class="dot" style="background:${r.colour}"></i>` : ''}<span>${esc(r.name)}</span></span>
    <span class="tk">${empty ? `<span class="nod">${esc(missing)}</span>` : `${both ? `<i class="ln" style="left:${X(lv)}%;width:${(X(hv) - X(lv)).toFixed(1)}%"></i>` : ''}${dot(n, 'ne', 'Diesel and hybrid')}${dot(e, 'ev', 'Electric')}${both ? lab(lv, 'l') + lab(hv, 'r') : lab(hv, 'r')}`}</span>
    <span class="gp ${Number.isFinite(r.st.gap) ? (r.st.gap > 0.005 ? 'up' : r.st.gap < -0.005 ? 'dn' : '') : 'na'}">${both ? fGap(r.st.gap) : empty ? '' : '—'}</span></div>`;
}

export function renderGap(){
  const sc = SC(), { left, right, rTitle, rNote, head, london } = rowsFor(sc);
  const vals = [...left, ...right].flatMap(r => [r.st.ev.v, r.st.ne.v]).filter(Number.isFinite);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo || 1) * .08; lo -= pad; hi += pad;
  const g = head.st.gap, both = Number.isFinite(g);
  const who = sc.kind === 'all' ? 'London' : sc.kind === 'garage' ? esc(sc.g.name) + ' garage' : esc(shortOp(sc.op));
  const headline = both
    ? `<div class="big">${fGap(g)}</div><div class="sub">${who}’s awards on electric buses cost ${Math.abs(g) < 0.02 ? 'about the same' : (g > 0 ? 'more' : 'less')} per mile ${Math.abs(g) < 0.02 ? 'as' : 'than'} its awards on diesel and hybrid buses · ${nOf(head.st.ev.n, 'electric award')}, ${nOf(head.st.ne.n, 'diesel/hybrid award')}${sc.kind !== 'all' && Number.isFinite(london.st.gap) ? ` · London ${fGap(london.st.gap)}` : ''}</div>`
    : `<div class="big">—</div><div class="sub">Too few priced awards to compare ${who} yet (${head.st.ev.n} electric, ${head.st.ne.n} diesel/hybrid)${Number.isFinite(london.st.gap) ? ` · London ${fGap(london.st.gap)}` : ''}</div>`;
  const legend = `<div class="legend"><span><i style="background:${C_NE};border-radius:50%"></i>Diesel & hybrid</span><span><i style="background:${C_EV};border-radius:50%"></i>Electric</span><span class="sub">Gap = electric ÷ diesel & hybrid − 1 · ${S.gapW === 'miles' ? 'total £ ÷ total contracted miles' : 'median £ per live mile'} · awards in the last five years${S.real ? ', in today’s money' : ', as awarded'}</span></div>`;
  const pane = (title, rows, note) => `<div class="gpane"><h4 class="mh">${esc(title)}</h4><div class="gr ghead"><span></span><span class="tk"><span class="ax">◂ cheaper per mile</span><span class="ax r">dearer ▸</span></span><span class="gp">Gap</span></div>${rows.map(r => dumbbell(r, lo, hi)).join('')}${note ? `<div class="sub gnote">${note}</div>` : ''}</div>`;
  const table = rows => `<table class="dt"><thead><tr><th></th><th class="r">Diesel & hybrid</th><th class="r">Electric</th><th class="r">Gap</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.sel ? 'sel' : ''}"><td>${esc(r.name)}</td><td class="r">${fP(r.st.ne.v)} <span class="sub">· ${r.st.ne.n}</span></td><td class="r">${fP(r.st.ev.v)} <span class="sub">· ${r.st.ev.n}</span></td><td class="r"><b>${fGap(r.st.gap)}</b></td></tr>`).join('')}</tbody></table>`;
  const body = S.gapView === 'table'
    ? `<div class="gapw"><div class="gpane"><h4 class="mh">By operator</h4>${table(left)}</div><div class="gpane"><h4 class="mh">${esc(rTitle)}</h4>${table(right)}<div class="sub gnote">${rNote}</div></div></div>`
    : `<div class="gapw">${pane('By operator', left)}${pane(rTitle, right, rNote)}</div>`;
  $('#evgap').innerHTML = `<div class="ch"><div><h2>Zero-emission price gap</h2><p>What awards on electric buses cost per mile against awards on diesel and hybrid buses, last five years${S.real ? ', in today’s money' : ', as awarded'}</p></div>
      <div class="ctl"><div class="seg" role="group" aria-label="View"><button class="${S.gapView === 'chart' ? 'on' : ''}" data-gapview="chart">Chart</button><button class="${S.gapView === 'table' ? 'on' : ''}" data-gapview="table">Table</button></div>
        <div class="seg" role="group" aria-label="Price"><button class="${S.gapW === 'median' ? 'on' : ''}" data-gapw="median">Median</button><button class="${S.gapW === 'miles' ? 'on' : ''}" data-gapw="miles">By miles</button></div>
        <div class="seg" role="group" aria-label="Basis"><button class="${S.real ? 'on' : ''}" data-real="1">Real</button><button class="${!S.real ? 'on' : ''}" data-real="0">Nominal</button></div></div></div>
    <div class="cb"><div class="ghd">${headline}</div>${body}${legend}
      <div class="sub gnote">Vehicle basis is TfL’s own note on each award (“awarded on new electrics”, “existing hybrids”). Nearly every electric award is on new buses and nearly every diesel or hybrid award on existing ones, so the gap includes the cost of new vehicles, not only the drivetrain. Awards with no stated basis are left out.</div></div>`;
}
