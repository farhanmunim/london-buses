/* Small geographic helpers: metres from a point to the nearest point of a route line. */

/* Distance in metres from (lat, lng) to the nearest point of a polyline given as [lng, lat] pairs. */
export function distToLine(lat, lng, coords){
  if(!coords?.length) return Infinity;
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
  let best = Infinity, px = (coords[0][0] - lng) * kx, py = (coords[0][1] - lat) * ky;
  best = px * px + py * py;
  for(let i = 1; i < coords.length; i++){
    const qx = (coords[i][0] - lng) * kx, qy = (coords[i][1] - lat) * ky, vx = qx - px, vy = qy - py, len2 = vx * vx + vy * vy;
    const t = len2 ? Math.max(0, Math.min(1, -(px * vx + py * vy) / len2)) : 0, cx = px + t * vx, cy = py + t * vy, d2 = cx * cx + cy * cy;
    if(d2 < best) best = d2;
    px = qx; py = qy;
  }
  return Math.sqrt(best);
}
export const fKm = m => !Number.isFinite(m) ? '—' : m < 950 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`;
