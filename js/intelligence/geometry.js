/* Geometry — tile-free cartography: bounds, projection, route glyphs. */
import { D } from './data.js';

/* ── geometry: tile-free cartography ─────────────────────────────────────── */
export function robustBounds(coordsList, lo = .01, hi = .99){
  const xs = [], ys = []; for(const cs of coordsList) for(const [x, y] of cs){ xs.push(x); ys.push(y); }
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
  return { minLon:q(xs, lo), maxLon:q(xs, hi), minLat:q(ys, lo), maxLat:q(ys, hi) };
}
export function bounds(coordsList){
  let a = 99, b = -99, c = 99, d = -99;
  for(const cs of coordsList) for(const [x, y] of cs){ if(x < c) c = x; if(x > d) d = x; if(y < a) a = y; if(y > b) b = y; }
  return { minLon:c, maxLon:d, minLat:a, maxLat:b };
}
export const KX = Math.cos(51.5 * Math.PI / 180);
export function projector(bb, w, h, pad = 8){
  const sx = (bb.maxLon - bb.minLon) * KX, sy = bb.maxLat - bb.minLat;
  const k = Math.min((w - 2 * pad) / sx, (h - 2 * pad) / sy);
  const ox = (w - sx * k) / 2, oy = (h - sy * k) / 2;
  return (lon, lat) => [ox + (lon - bb.minLon) * KX * k, oy + (bb.maxLat - lat) * k];
}
export const pathD = (coords, P) => coords.map(([x, y], i) => { const [px, py] = P(x, y); return (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1); }).join('');
export function glyph(r){
  const cs = D.lines.get(r.id); if(!cs) return '<svg class="glyph" viewBox="0 0 54 30" aria-hidden="true"></svg>';
  const P = projector(bounds([cs]), 54, 30, 4);
  const [x0, y0] = P(...cs[0]), [x1, y1] = P(...cs[cs.length - 1]);
  return `<svg class="glyph" viewBox="0 0 54 30" aria-hidden="true"><path d="${pathD(cs, P)}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="2" fill="#fff" stroke="currentColor" stroke-width="1.3"/><circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="2.2" fill="currentColor"/></svg>`;
}
