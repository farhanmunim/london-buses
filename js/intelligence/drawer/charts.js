/* Route-brief charts — line chart, route shape, elevation profile and direction helpers. */
import { D } from '../data.js';
import { esc } from '../dom.js';
import { pathD, projector } from '../geometry.js';
import { S } from '../state.js';
import { opColour } from '../tokens.js';

/* ── drawer: the route brief ─────────────────────────────────────────────── */
export function lineChart(points, { w = 460, h = 120, ref = null, refLabel = '', fmt = v => v, pad = 0.15, lower = false } = {}){
  const ys = points.map(p => p.y).filter(Number.isFinite); if(ys.length < 2) return '<div class="sub">Not enough history yet.</div>';
  let lo = Math.min(...ys, ref ?? Infinity), hi = Math.max(...ys, ref ?? -Infinity); const r = (hi - lo) || 1; lo -= r * pad; hi += r * pad;
  const X = i => 8 + i * (w - 52) / Math.max(1, points.length - 1), Y = v => h - 18 - (v - lo) / (hi - lo) * (h - 34);
  const live = points.map((p, i) => Number.isFinite(p.y) ? [X(i), Y(p.y), p] : null).filter(Boolean);
  const path = live.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join('');
  const [lx, ly, lp] = live[live.length - 1];
  const step = (w - 52) / Math.max(1, points.length - 1);
  const grid = [0, .5, 1].map(f => { const y = 12 + f * (h - 34); return `<line x1="0" x2="${w - 40}" y1="${y}" y2="${y}" stroke="var(--line)"/>`; }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Trend, latest ${esc(fmt(lp.y))}">${grid}
    ${ref != null ? `<line x1="0" x2="${w - 40}" y1="${Y(ref)}" y2="${Y(ref)}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="0"/><text x="${w - 38}" y="${Y(ref) + 4}" font-size="10.5" fill="var(--ink-3)">${esc(refLabel)}</text>` : ''}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="var(--accent)" stroke="#fff" stroke-width="2"/>
    <text x="${(lx + 8).toFixed(1)}" y="${(ly + 4).toFixed(1)}" font-size="11.5" font-weight="600" fill="var(--ink)">${esc(fmt(lp.y))}</text>
    <text x="8" y="${h - 3}" font-size="10.5" fill="var(--ink-3)">${esc(points[0].x)}</text><text x="${w - 40}" y="${h - 3}" font-size="10.5" fill="var(--ink-3)" text-anchor="end">${esc(points[points.length - 1].x)}</text>
    ${points.map((p, i) => Number.isFinite(p.y) ? `<rect x="${(X(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${h}" fill="transparent" data-tip="${esc(p.x)}\n${esc(fmt(p.y))}${ref != null ? '\nStandard ' + esc(refLabel.replace(/^(Min|Std)\s*/, '')) : ''}"/>` : '').join('')}</svg>`;
}
export function shapeSvg(r){
  const cs = D.lines.get(r.id); if(!cs) return '';
  const W = 476, H = 200, P = projector(D.bb, W, H, 8);
  let ghost = ''; for(const o of D.ST[r.op]?.list ?? []){ const c = D.lines.get(o.id); if(c && o.id !== r.id) ghost += `<path d="${pathD(c, P)}" fill="none" stroke="#d9dde4" stroke-width=".8"/>`; }
  const d = pathD(cs, P), [x0, y0] = P(...cs[0]), [x1, y1] = P(...cs[cs.length - 1]);
  const g = D.garages.find(x => x.code === r.garage), gp = g && Number.isFinite(g.lat) ? P(g.lng, g.lat) : null;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Route ${esc(r.id)} shape across London">${ghost}<path d="${d}" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${opColour(r.op)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="4.5" fill="#fff" stroke="${opColour(r.op)}" stroke-width="2.5"/><circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="5" fill="${opColour(r.op)}" stroke="#fff" stroke-width="2"/>
    ${gp ? `<rect x="${(gp[0] - 5).toFixed(1)}" y="${(gp[1] - 5).toFixed(1)}" width="10" height="10" rx="2.5" fill="var(--ink)" stroke="#fff" stroke-width="2" data-tip="${esc(r.garageName)} garage"/>` : ''}</svg>`;
}

/* ── drawer charts ───────────────────────────────────────────────────────── */
export function profileChart(prof){
  if(!prof?.length) return '<div class="sub">No load profile for this route.</div>';
  const w = 460, h = 130, n = prof.length, X = i => 8 + i * (w - 52) / Math.max(1, n - 1), Y = v => h - 20 - Math.min(1.3, v) / 1.3 * (h - 36);
  const pts = prof.map((p, i) => [X(i), Y(p.vc), p]), path = pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join('');
  const peak = pts.reduce((m, p) => p[2].vc > m[2].vc ? p : m, pts[0]), step = (w - 52) / Math.max(1, n - 1), t = s => String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Passenger load along the route, peaking at ${Math.round(peak[2].vc * 100)}%">
    ${[0, .5, .8, 1].map(v => `<line x1="0" x2="${w - 40}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${v === .8 ? 'var(--warn)' : 'var(--line)'}"/><text x="${w - 36}" y="${(Y(v) + 3.5).toFixed(1)}" font-size="10.5" fill="var(--ink-3)">${Math.round(v * 100)}%</text>`).join('')}
    <path d="${path}L${pts[n - 1][0].toFixed(1)} ${Y(0)}L${pts[0][0].toFixed(1)} ${Y(0)}Z" fill="var(--accent)" fill-opacity=".1"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${peak[0].toFixed(1)}" cy="${peak[1].toFixed(1)}" r="4" fill="var(--accent)" stroke="#fff" stroke-width="2"/>
    <text x="${Math.min(peak[0] + 8, w - 120).toFixed(1)}" y="${(peak[1] - 7).toFixed(1)}" font-size="11.5" font-weight="600" fill="var(--ink)">${Math.round(peak[2].vc * 100)}% at ${esc(t(peak[2].name).slice(0, 22))}</text>
    <text x="8" y="${h - 3}" font-size="10.5" fill="var(--ink-3)">${esc(t(prof[0].name).slice(0, 24))}</text><text x="${w - 40}" y="${h - 3}" font-size="10.5" fill="var(--ink-3)" text-anchor="end">${esc(t(prof[n - 1].name).slice(0, 24))}</text>
    ${pts.map(([x, , p]) => `<rect x="${(x - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${h}" fill="transparent" data-tip="${esc(t(p.name))}\nPeak load ${Math.round(p.vc * 100)}% of capacity"/>`).join('')}</svg>`;
}
const ly = (k, label, sw) => `<button class="ly ${S.ml[k] ? 'on' : ''}" data-ml="${k}" aria-pressed="${S.ml[k]}"><i class="sw ${sw}"></i>${label}<span class="cnt"></span></button>`;
export const routeChips = () => `${ly('stops', 'Stops', 'st')}${ly('works', 'Roadworks', 'wk')}${ly('coll', 'Collisions', 'cl')}${ly('bridges', 'Low bridges', 'br')}${ly('gar', 'Other garages', 'gr')}${ly('live', 'Live buses', 'lv')}`;
export const dirSeg = r => `<div class="seg float dirSeg" role="group" aria-label="Direction"><button class="${S.dir === 'outbound' ? 'on' : ''}" data-dir="outbound" data-tip="Towards ${esc(r.from)}">→ ${esc((r.from || 'Outbound').slice(0, 16))}</button><button class="${S.dir === 'inbound' ? 'on' : ''}" data-dir="inbound" data-tip="Towards ${esc(r.to)}">→ ${esc((r.to || 'Inbound').slice(0, 16))}</button></div>`;
