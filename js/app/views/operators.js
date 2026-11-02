/* View: Operators — list, and operator detail (operator → garages → routes → map). */
import { D } from '../core/data.js';
import { incWhen } from '../core/incoming.js';
import { gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { cmpRoute, esc, fmtDate, nOf, num, opColor, opInitials, plural, stripTags, tvrOf } from '../core/utils.js';

/* ════════════════════ OPERATORS ════════════════════ */
export async function renderOperators(){
  const tok = state.navToken;
  main.innerHTML = `<h1 class="h1">Operators</h1><div class="sub">Who runs London’s buses — routes, fleet size and electrification.</div>
    <div class="oplist" id="oplist">${'<div class="skel" style="height:120px"></div>'.repeat(6)}</div>`;
  const [meta, garages] = await Promise.all([D.meta(), D.garages()]);
  if(gone(tok)) return;
  const agg = new Map();
  for(const [name, m] of Object.entries(meta ?? {})){
    if(!m?.operator) continue;
    const a = agg.get(m.operator) ?? { routes:0, pvr:0, ev:0, evKnown:0, company:m.company };
    a.routes++;
    if(num(m.pvr)) a.pvr += m.pvr;
    if(m.propulsion){ a.evKnown++; if(m.propulsion==='electric'||m.propulsion==='hydrogen') a.ev++; }
    agg.set(m.operator, a);
  }
  const gCount = new Map();
  for(const g of garages ?? []) if(g.operator) gCount.set(g.operator, (gCount.get(g.operator) ?? 0) + 1);
  const list = [...agg.entries()].sort((a,b) => b[1].routes - a[1].routes);
  if(!list.length){ document.getElementById('oplist').innerHTML = '<div class="empty">The route data is unreachable right now — try again shortly.</div>'; return; }
  document.getElementById('oplist').innerHTML = list.map(([op,a]) => {
    const evPct = a.evKnown ? Math.round(a.ev / a.evKnown * 100) : null;
    return `<a class="opcard" href="#/operator/${encodeURIComponent(op)}">
      <div class="ophead">
        <span class="avatar" style="background:${opColor(op)}">${opInitials(op)}</span>
        <div><div class="nm">${esc(op)}</div><div class="co">${esc(stripTags(a.company ?? ''))}</div></div>
      </div>
      <div class="opstats">
        <div class="opstat"><div class="l">Routes</div><div class="v">${a.routes}</div></div>
        <div class="opstat"><div class="l">PVR</div><div class="v">${a.pvr || '—'}</div></div>
        <div class="opstat"><div class="l">Garages</div><div class="v">${gCount.get(op) ?? '—'}</div></div>
      </div>
      ${evPct != null ? `<div><div class="minibar"><i style="width:${evPct}%;background:var(--good)"></i></div>
        <div class="legendrow"><span>${evPct}% zero-emission routes</span></div></div>` : ''}
    </a>`;
  }).join('') + await (async () => {
    const inc = await D.incoming(); if(!inc.fresh.length) return '';
    return inc.fresh.map(op => {
      const rs = inc.byOp.get(op).sort((a, b) => cmpRoute(a.route, b.route)), starts = [...new Set(rs.map(r => r.start).filter(Boolean))].sort();
      return `<a class="opcard incoming" href="#/operator/${encodeURIComponent(op)}">
        <div class="ophead">
          <span class="avatar" style="background:${opColor(op)}">${esc(opInitials(op))}</span>
          <div><div class="nm">${esc(op)} <span class="newpill">Incoming</span></div><div class="co">Awarded ${plural(rs.length, 'route')} · ${starts.length ? 'from ' + esc(fmtDate(starts[0])) : 'start to be confirmed'}${rs.some(r => r.provisional) ? ' · provisional' : ''}</div></div>
        </div>
        <div class="chiprow">${rs.map(r => `<span class="rchip">${esc(r.route)}</span>`).join('')}</div>
      </a>`;
    }).join('');
  })();
}

/* ── Operator detail — drill: operator → garages → routes → map ─────────── */
export async function renderOperatorDetail(op){
  const tok = state.navToken;
  main.innerHTML = `<a class="backrow" href="#/operators">‹ All operators</a><div class="skel" style="height:140px"></div>`;
  const [meta, garages, routes] = await Promise.all([D.meta(), D.garages(), D.routes()]);
  if(gone(tok)) return;
  const myRoutes = (routes ?? []).filter(r => meta?.[r.name]?.operator === op).sort((a,b)=>cmpRoute(a.name,b.name));
  if(!myRoutes.length){
    const inc = (await D.incoming()).byOp.get(op);
    if(gone(tok)) return;
    if(!inc?.length){ main.innerHTML = `<a class="backrow" href="#/operators">‹ All operators</a><div class="empty">No routes found for “${esc(op)}”.</div>`; return; }
    const rs = [...inc].sort((a, b) => cmpRoute(a.route, b.route)), pvr = rs.reduce((t, r) => t + (num(r.pvr) ?? 0), 0);
    main.innerHTML = `
      <a class="backrow" href="#/operators">‹ All operators</a>
      <div class="dhead">
        <span class="avatar" style="width:46px;height:46px;border-radius:12px;font-size:14px;background:${opColor(op)}">${esc(opInitials(op))}</span>
        <div class="dtitle"><h1>${esc(op)} <span class="newpill">Incoming</span></h1><div class="sub2">New to the TfL bus network</div></div>
      </div>
      <div class="changenote"><b>${esc(op)} has been awarded ${plural(rs.length, 'route')}.</b> ${rs.some(r => r.provisional) ? 'These awards are community-reported and provisional until TfL publishes the official results. ' : ''}Garages, fleet and performance appear here once the routes are running.</div>
      <div class="facts" style="margin-top:14px">
        <div class="fact"><div class="l">Routes awarded</div><div class="v">${rs.length}</div></div>
        <div class="fact"><div class="l">PVR</div><div class="v">${pvr || '—'}</div></div>
        <div class="fact"><div class="l">First start</div><div class="v">${esc(fmtDate([...rs.map(r => r.start).filter(Boolean)].sort()[0]) || 'TBC')}</div></div>
      </div>
      <div class="section"><div class="section-h">Awarded routes</div>
        <div class="glist">${rs.map(r => `<a class="grow" href="#/route/${encodeURIComponent(r.route)}">
          <span class="avatar" style="background:var(--tx2)">${esc(r.route)}</span>
          <span class="g-nm"><b>Route ${esc(r.route)}</b><span>from ${esc(r.from ?? '—')} · ${esc(incWhen(r))}${r.provisional ? ' · provisional' : ''}</span></span>
          <span class="g-pvr"><b>${r.pvr ?? '—'}</b>PVR</span></a>`).join('')}</div>
      </div>`;
    return;
  }
  const myGarages = (garages ?? []).filter(g => g.operator === op).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  let pvr = 0, ev = 0, known = 0;
  for(const r of myRoutes){
    const m = meta[r.name];
    if(num(m?.pvr)) pvr += m.pvr;
    if(m?.propulsion){ known++; if(m.propulsion==='electric'||m.propulsion==='hydrogen') ev++; }
  }
  const company = stripTags(meta[myRoutes[0].name]?.company ?? '');
  main.innerHTML = `
    <a class="backrow" href="#/operators">‹ All operators</a>
    <div class="dhead">
      <span class="avatar" style="width:46px;height:46px;border-radius:12px;font-size:14px;background:${opColor(op)}">${opInitials(op)}</span>
      <div class="dtitle"><h1>${esc(op)}</h1><div class="sub2">${esc(company)}</div></div>
    </div>
    <div class="facts" style="margin-top:14px">
      <div class="fact"><div class="l">Routes</div><div class="v">${myRoutes.length}</div></div>
      <div class="fact"><div class="l">PVR</div><div class="v">${pvr || '—'}</div></div>
      <div class="fact"><div class="l">TVR</div><div class="v">${tvrOf(pvr) ?? '—'}</div></div>
      <div class="fact"><div class="l">Garages</div><div class="v">${myGarages.length}</div></div>
      <div class="fact"><div class="l">Zero-emission</div><div class="v">${known ? Math.round(ev/known*100)+'%' : '—'}</div></div>
      <div class="fact"><div class="l">Night routes</div><div class="v">${myRoutes.filter(r=>r.type==='night').length}</div></div>
    </div>
    <div class="section"><div class="section-h">Garages</div>
      <div class="glist">${myGarages.map(g => `
        <a class="grow" href="#/garage/${encodeURIComponent(g.code)}">
          <span class="avatar" style="background:${opColor(op)}">${esc(g.code)}</span>
          <span class="g-nm"><b>${esc(g.name)}</b><span>${nOf(g.routes?.length ?? 0, 'route')}${num(g.capacity)?` · capacity ${g.capacity}`:''}</span></span>
          <span class="g-pvr"><b>${g.pvr ?? '—'}</b>PVR</span>
        </a>`).join('') || '<div class="empty">No garages listed.</div>'}
      </div>
    </div>
    <div class="section"><div class="section-h">Routes</div>
      <div class="card"><div class="chiprow">${myRoutes.map(r => `<a class="rchip" href="#/route/${encodeURIComponent(r.name)}">${esc(r.name)}</a>`).join('')}</div></div>
    </div>`;
}
