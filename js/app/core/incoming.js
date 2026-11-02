/* Incoming operators — routes whose next operator is already awarded but not yet running (adds D.incoming), plus the shared garage pin. */
import { D } from './data.js';
import { esc, fmtDate, opColor, opInitials } from './utils.js';

/* ── Incoming operators ───────────────────────────────────────────────────────
   Derived, never listed: a route whose newest award went to a different operator than the one running it has a
   changeover coming. An operator that runs nothing yet but holds such awards is new to the network (Go Bus, say) —
   it appears on the Operators page, its own page and every affected route the moment the award is published,
   and moves into the normal operator lists by itself when the route data shows it running a route. */
export const brandRoot = n => String(n ?? '').toLowerCase().trim().split(/\s+/)[0] ?? '';
let _incoming = null;
D.incoming = () => _incoming ??= Promise.all([D.tenders(), D.meta()]).then(([tn, meta]) => {
  const byRoute = new Map(), byOp = new Map();
  const today = new Date().toISOString().slice(0, 10), cutoff = new Date(Date.now() - 548 * 864e5).toISOString().slice(0, 10);
  const running = new Set(Object.values(meta ?? {}).map(m => brandRoot(m?.operator)));
  for(const [route, m] of Object.entries(meta ?? {})){
    const a = [...(tn?.[route] ?? [])].sort((x, y) => String(y.awardDate).localeCompare(String(x.awardDate)))[0];
    if(!a?.operator || a.operatorChange !== true || brandRoot(a.operator) === brandRoot(m.operator)) continue;
    if(!a.provisional && a.awardDate < cutoff) continue;           // an old award the route data has simply not caught up with
    if(a.contractStart && a.contractStart <= today) continue;      // already running: the route data will show it
    const inc = { route, op:a.operator, from:m.operator, awardDate:a.awardDate, provisional:!!a.provisional, start:a.contractStart ?? m.contractEnd ?? null,
                  tranche:a.tranche ?? null, vehicle:a.vehicle?.raw ?? null, pvr:m.pvr ?? a.pvr ?? null };
    byRoute.set(route, inc);
    (byOp.get(a.operator) ?? byOp.set(a.operator, []).get(a.operator)).push(inc);
  }
  return { byRoute, byOp, fresh:[...byOp.keys()].filter(o => !running.has(brandRoot(o))) };
}).catch(() => ({ byRoute:new Map(), byOp:new Map(), fresh:[] }));
export const incWhen = i => i.start ? `starting ${fmtDate(i.start)}` : 'start date to be confirmed';

/* One garage pin for every map: operator initials over the garage code —
   "GAL / (Q)" — so both identities read at a glance. */
export function garagePinIcon(g, size = 38, tint = null){
  // tint: focus colour(s) while comparing routes — the pin matches its
  // route's line so "operated from here" reads at a glance. Two focused
  // routes from one garage split the pin diagonally.
  const bg = Array.isArray(tint) && tint.length > 1
    ? `linear-gradient(135deg, ${tint[0]} 50%, ${tint[1]} 50%)`
    : (Array.isArray(tint) ? tint[0] : tint) ?? opColor(g.operator);
  return L.divIcon({ className:'', iconSize:[size,size], iconAnchor:[size/2,size/2],
    html:`<div style="width:${size}px;height:${size}px;border-radius:10px;background:${bg};color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.12;font-family:var(--sans);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)">
      <span style="font-weight:800;font-size:${size>=38?'10.5':'9'}px;letter-spacing:.02em">${opInitials(g.operator)}</span>
      <span style="font-weight:600;font-size:8.5px">(${esc(g.code)})</span></div>` });
}
