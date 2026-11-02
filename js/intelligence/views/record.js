/* View: record, head-to-head and price history. */
import { D } from '../data.js';
import { $, esc } from '../dom.js';
import { fGbp, fPct, nOf, sum } from '../format.js';
import { S, SC } from '../state.js';
import { opColour, OPS } from '../tokens.js';
import { shortOp } from './hero.js';

/* ── view: record / head-to-head / price ────────────────────────────────── */
export function renderRecord(){
  const sc = SC(), s = sc.st, rec = sc.rec, inProg = s.list.filter(r => r.next);
  const prog = `<div class="kv"><span>In the tender programme</span><b>${nOf(inProg.length, 'route')} · ${fGbp(sum(inProg, r => r.cur?.acceptedBid))}</b></div>`;
  let body;
  if(sc.kind === 'all'){
    const t = rec.retained + rec.changed, ret = t ? rec.retained / t * 100 : null;
    body = `<div class="big">${fPct(ret, 0)}</div><div class="sub" style="margin:2px 0 10px">of re-tenders kept their operator · ${rec.retained} of ${t}</div>
      <div class="meter" data-tip="${rec.retained} retained · ${rec.changed} changed operator"><i style="width:${ret ?? 0}%"></i></div>
      <div class="pair"><div class="won"><b>${rec.retained}</b><span class="sub">kept the incumbent</span></div><div class="lost" style="background:var(--sunken);color:var(--ink)"><b>${rec.changed}</b><span class="sub">changed operator</span></div></div>
      <div class="kv" style="margin-top:10px"><span>Single-bid contracts</span><b>${fPct(s.singleBid, 0)}</b></div>${prog}`;
  } else if(sc.kind === 'garage'){
    const t = rec.retained + rec.won, ret = t ? rec.retained / t * 100 : null;
    body = `<div class="big">${fPct(ret, 0)}</div><div class="sub" style="margin:2px 0 10px">of re-tenders on its routes kept ${esc(shortOp(sc.op))} · ${rec.retained} of ${t}</div>
      <div class="meter" data-tip="${rec.retained} retained · ${rec.won} won from rivals"><i style="width:${ret ?? 0}%"></i></div>
      <div class="pair"><div class="won"><b>+${rec.won}</b><span class="sub">won from rivals</span></div><div class="lost" style="background:var(--sunken);color:var(--ink)"><b>${rec.retained}</b><span class="sub">retained</span></div></div>
      <div class="kv" style="margin-top:10px"><span>Single-bid contracts</span><b>${fPct(s.singleBid, 0)}</b></div>${prog}`;
  } else {
    const contested = rec.retained + rec.lost, ret = contested ? rec.retained / contested * 100 : null;
    body = `<div class="big">${fPct(ret, 0)}</div><div class="sub" style="margin:2px 0 10px">incumbent retention · ${rec.retained} of ${contested} re-tenders</div>
      <div class="meter" data-tip="${rec.retained} retained · ${rec.lost} lost"><i style="width:${ret ?? 0}%"></i></div>
      <div class="pair"><div class="won"><b>+${rec.won}</b><span class="sub">won from rivals</span></div><div class="lost"><b>−${rec.lost}</b><span class="sub">lost to rivals</span></div></div>
      <div class="kv" style="margin-top:10px"><span>Net routes</span><b>${rec.won - rec.lost >= 0 ? '+' : '−'}${Math.abs(rec.won - rec.lost)}</b></div>${prog}`;
  }
  $('#record').innerHTML = `<div class="ch"><div><h2>Tender record</h2><p>Re-tenders and wins, last five years</p></div></div><div class="cb">${body}</div>`;
}
export function renderH2H(){
  const sc = SC(), rec = sc.rec;
  let rows, title = 'Head-to-head', sub = 'Routes won from and lost to each rival, five years', note = 'Subsidiaries count as their parent brand; moves within a group are not shown. Smaller operators are named individually.';
  if(sc.kind === 'all'){
    title = 'Tender momentum'; sub = 'Routes each operator won and lost in re-tenders, five years';
    rows = OPS.map(o => ({ r:o, won:D.REC[o].won, lost:D.REC[o].lost, tip:'Won from others: ' + D.REC[o].won + '\nLost to others: ' + D.REC[o].lost })).filter(x => x.won || x.lost).sort((a, b) => (b.won - b.lost) - (a.won - a.lost) || b.won - a.won);
    note = 'Every route that changes hands is one operator’s win and another’s loss, so the nets balance across the market (small operators outside the eight are not listed).';
  } else {
    rows = [...new Set([...Object.keys(rec.wonFrom), ...Object.keys(rec.lostTo)])].map(r => ({ r, won:rec.wonFrom[r] ?? 0, lost:rec.lostTo[r] ?? 0 })).filter(x => x.won || x.lost).sort((a, b) => (b.won - b.lost) - (a.won - a.lost) || b.won - a.won);
    if(sc.kind === 'garage'){ sub = 'Routes now at this garage, won from each rival, five years'; note = 'Only routes still run from this garage are counted, so losses cannot be shown at garage level.'; }
  }
  const max = Math.max(1, ...rows.flatMap(x => [x.won, x.lost]));
  $('#h2h').innerHTML = `<div class="ch"><div><h2>${title}</h2><p>${sub}</p></div></div>
    <div class="cb"><div class="hh hhead"><span></span><span class="l">${sc.kind === 'garage' ? '' : '◂ Lost'}</span><span class="r">Won ▸</span><span class="n">Net</span></div>
      ${rows.length ? rows.map(x => `<div class="hh" data-tip="${esc(x.r)}\n${x.tip ? x.tip : 'Won from them: ' + x.won + (sc.kind === 'garage' ? '' : '\nLost to them: ' + x.lost)}"><span class="nm"><i class="dot" style="background:${opColour(x.r)}"></i>${esc(shortOp(x.r))}</span>
        <span class="l"><b>${x.lost ? '−' + x.lost : ''}</b><i style="width:${x.lost / max * 100}%"></i></span><span class="r"><i style="width:${x.won / max * 100}%"></i><b>${x.won ? '+' + x.won : ''}</b></span>
        <span class="n ${x.won - x.lost > 0 ? 'pos' : x.won - x.lost < 0 ? 'neg' : ''}">${sc.kind === 'garage' ? '' : x.won - x.lost > 0 ? '+' : x.won - x.lost < 0 ? '−' : ''}${sc.kind === 'garage' ? '' : Math.abs(x.won - x.lost) || '0'}</span></div>`).join('') : '<div class="sub">No cross-operator changes in the last five years.</div>'}
      <div class="sub" style="margin-top:10px">${note}</div></div>`;
}
function priceChart(pts){
  const W = 440, H = 190, L = 40, R = 14, T = 12, B = 24, vals = pts.flatMap(p => [p.op, p.net]).filter(Number.isFinite);
  if(vals.length < 2) return '<div class="sub">Not enough priced awards.</div>';
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo || 1) * .15; lo = Math.max(0, lo - pad); hi += pad;
  const X = i => L + i * (W - L - R) / (pts.length - 1), Y = v => H - B - (v - lo) / (hi - lo) * (H - B - T);
  const path = key => { let d = '', pen = false; pts.forEach((p, i) => { if(Number.isFinite(p[key])){ d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p[key]).toFixed(1); pen = true; } else pen = false; }); return d; };
  const last = key => { for(let i = pts.length - 1; i >= 0; i--) if(Number.isFinite(pts[i][key])) return [X(i), Y(pts[i][key])]; return null; };
  const ticks = [0, .33, .66, 1].map(f => lo + f * (hi - lo));
  const lo_ = last('op'), ln_ = last('net'), step = (W - L - R) / (pts.length - 1);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Award price per mile by year">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="var(--line)"/><text x="${L - 6}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" fill="var(--ink-3)">£${t.toFixed(t < 10 ? 1 : 0)}</text>`).join('')}
    <path d="${path('net')}" fill="none" stroke="#98a2b3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${path('op')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${ln_ ? `<circle cx="${ln_[0].toFixed(1)}" cy="${ln_[1].toFixed(1)}" r="4" fill="#98a2b3" stroke="#fff" stroke-width="2"/>` : ''}${lo_ ? `<circle cx="${lo_[0].toFixed(1)}" cy="${lo_[1].toFixed(1)}" r="4" fill="var(--accent)" stroke="#fff" stroke-width="2"/>` : ''}
    ${pts.map((p, i) => i % 2 === 0 || i === pts.length - 1 ? `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">${p.x}</text>` : '').join('')}
    ${pts.map((p, i) => `<rect x="${(X(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}" fill="transparent" data-tip="${p.x}\n${esc(SC().name)}: ${Number.isFinite(p.op) ? '£' + p.op.toFixed(2) + ' (' + p.on + ' awards)' : 'too few awards'}\nNetwork median: ${Number.isFinite(p.net) ? '£' + p.net.toFixed(2) + ' (' + p.nn + ' awards)' : '—'}"/>`).join('')}</svg>`;
}
export function renderPrice(){
  const sc = SC(), pred = sc.kind === 'all' ? null : sc.kind === 'garage' ? (p => p.tok.some(t => sc.ids.has(t))) : (p => p.g === sc.op);
  const pts = D.PRICE.series(pred, S.real, sc.kind === 'garage' ? 2 : 4), live = pts.filter(p => Number.isFinite(p.op) && Number.isFinite(p.net)), l = live.at(-1);
  const gap = l ? (l.op / l.net - 1) * 100 : null;
  $('#price').innerHTML = `<div class="ch"><div><h2>Price per mile</h2><p>Awards by year${S.real ? ", in today's money (CPI-adjusted)" : ', as awarded'}</p></div>
    <div class="ctl"><div class="seg" role="group" aria-label="Basis"><button class="${S.real ? 'on' : ''}" data-real="1">Real</button><button class="${!S.real ? 'on' : ''}" data-real="0">Nominal</button></div></div></div>
    <div class="cb">${priceChart(pts)}
      <div class="legend">${sc.kind === 'all' ? '' : `<span><i style="background:var(--accent)"></i>${esc(sc.name)}</span>`}<span><i style="background:#98a2b3"></i>Network median</span></div>
      ${l && sc.kind !== 'all' ? `<div class="kv" style="margin-top:8px"><span>${l.x}: vs network median</span><b>${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)}%</b></div>` : ''}</div>`;
}
