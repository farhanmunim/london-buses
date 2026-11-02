/* View: Garages — list and garage detail. */
import { D } from '../core/data.js';
import { garagePinIcon } from '../core/incoming.js';
import { gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { bindOpFilter, esc, nOf, num, opColor, opFilterHtml, opInitials, stripTags, tvrOf } from '../core/utils.js';
import { garageLocOk, makeMap } from '../map/layers.js';

/* ════════════════════ GARAGES ════════════════════ */
const garagesViewState = { q:'', op:'' };
export async function renderGarages(){
  const tok = state.navToken;
  main.innerHTML = `
    <h1 class="h1">Garages</h1><div class="sub">Every operating garage on the TfL network.</div>
    <div class="searchwrap"><div class="search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/></svg>
      <input id="gq" aria-label="Search garages" placeholder="Search by name or code" autocomplete="off" value="${esc(garagesViewState.q)}" />
      <button class="clear" id="gqClear" aria-label="Clear search" ${garagesViewState.q?'':'hidden'}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 2px 0" id="gopRow"></div></div>
    <div class="count-note" id="gCount"></div>
    <div class="glist" id="glist">${'<div class="skel" style="height:56px"></div>'.repeat(8)}</div>`;
  const garages = await D.garages();
  if(gone(tok)) return;
  if(!garages?.length){ document.getElementById('glist').innerHTML = '<div class="empty">The data is unreachable right now.</div>'; return; }
  const gOps = [...new Set(garages.map(g => g.operator).filter(Boolean))].sort();
  document.getElementById('gopRow').innerHTML = opFilterHtml('gop', gOps, garagesViewState.op);
  const rerender = () => {
    const q = garagesViewState.q.trim().toLowerCase();
    const list = garages.filter(g => (!q || g.name?.toLowerCase().includes(q) || g.code?.toLowerCase() === q)
        && (!garagesViewState.op || g.operator === garagesViewState.op))
      .sort((a,b) => String(a.name).localeCompare(String(b.name)));
    document.getElementById('gCount').textContent = `${list.length} garage${list.length===1?'':'s'}`;
    document.getElementById('glist').innerHTML = list.map(g => `
      <a class="grow" href="#/garage/${encodeURIComponent(g.code)}">
        <span class="avatar" style="background:${opColor(g.operator)}">${opInitials(g.operator)}</span>
        <span class="g-nm"><b>${esc(g.name)} <span style="color:var(--mu);font-weight:500">(${esc(g.code)})</span></b>
        <span>${esc(g.operator ?? '—')} · ${nOf(g.routes?.length ?? 0, 'route')}</span></span>
        <span class="g-pvr"><b>${g.pvr ?? '—'}</b>PVR</span>
      </a>`).join('') || '<div class="empty">No garages match.</div>';
  };
  rerender();
  bindOpFilter('gop', v => { garagesViewState.op = v; rerender(); });
  const gq = document.getElementById('gq'), gqClear = document.getElementById('gqClear');
  gq.addEventListener('input', () => { garagesViewState.q = gq.value; gqClear.hidden = !gq.value; rerender(); });
  gqClear.addEventListener('click', () => { gq.value=''; garagesViewState.q=''; gqClear.hidden=true; rerender(); gq.focus(); });
}

export async function renderGarageDetail(code){
  const tok = state.navToken;
  main.innerHTML = `<a class="backrow" href="#/garages">‹ All garages</a><div class="skel" style="height:120px"></div>`;
  const [garages, meta] = await Promise.all([D.garagesAll(), D.meta()]);   // every garage, so a saved link to a quiet depot still opens
  if(gone(tok)) return;
  const g = garages?.find(x => x.code?.toUpperCase() === String(code ?? '').toUpperCase());
  if(!g){ main.innerHTML = `<a class="backrow" href="#/garages">‹ All garages</a><div class="empty">Garage “${esc(code)}” not found.</div>`; return; }
  const tvr = tvrOf(g.pvr);
  const util = num(g.utilisation) ?? (num(g.pvr) && num(g.capacity) ? g.pvr / g.capacity : null);
  let ev = 0, evKnown = 0;
  for(const r of g.routes ?? []){
    const p = meta?.[r]?.propulsion;
    if(p){ evKnown++; if(p === 'electric' || p === 'hydrogen') ev++; }
  }
  const evPct = evKnown ? Math.round(ev / evKnown * 100) : null;
  main.innerHTML = `
    <a class="backrow" href="#/garages">‹ All garages</a>
    <div class="dhead">
      <span class="avatar" style="width:46px;height:46px;border-radius:12px;font-size:14px;background:${opColor(g.operator)}">${opInitials(g.operator)}</span>
      <div class="dtitle"><h1>${esc(g.name)} <span style="color:var(--mu)">(${esc(g.code)})</span></h1>
      <div class="sub2">${g.operator ? `<a href="#/operator/${encodeURIComponent(g.operator)}" style="color:var(--acc);font-weight:500">${esc(g.operator)}</a>` : ''}${g.company ? ' · ' + esc(stripTags(g.company)) : ''}</div></div>
    </div>
    <div class="facts" style="margin-top:14px">
      <div class="fact"><div class="l">PVR</div><div class="v">${g.pvr ?? '—'}</div></div>
      <div class="fact"><div class="l">TVR</div><div class="v">${tvr ?? '—'}</div></div>
      <div class="fact"><div class="l">Capacity</div><div class="v">${g.capacity ?? '—'}</div></div>
      <div class="fact"><div class="l">Routes</div><div class="v">${g.routes?.length ?? 0}</div></div>
      <div class="fact"><div class="l">Zero-emission</div><div class="v">${evPct != null ? evPct + '%' : '—'}</div></div>
      <div class="fact"><div class="l">Postcode</div><div class="v">${esc(g.postcode ?? '—')}</div></div>
      <div class="fact"><div class="l">Code</div><div class="v">${esc(g.code)}</div></div>
    </div>
    <div class="section"><div class="section-h">Routes operated here</div>
      <div class="card">
        ${util != null ? `<div class="util"><span style="color:var(--tx2)">Utilisation</span><div class="minibar"><i style="width:${Math.min(100,Math.round(util*100))}%"></i></div><b class="mono" style="font-family:var(--mono);font-size:13px">${Math.round(util*100)}%</b></div>` : ''}
        <div class="chiprow">${(g.routes ?? []).map(r => `<a class="rchip" href="#/route/${encodeURIComponent(r)}">${esc(r)}</a>`).join('') || '<span class="empty" style="padding:10px">No routes listed.</span>'}</div>
      </div>
    </div>
    <div class="section"><div class="section-h">On the map</div><div id="map"></div>
      <div class="legendrow" style="margin-top:8px"><span>Every route based at ${esc(g.name)} — tap a line to open it.</span></div>
    </div>`;
  initGarageMap(g, tok);
}

/* Garage map — the garage pin plus every route based there, each line in its
   own colour (the validated comparison palette), tappable through to the
   route page. */
const GARAGE_MAP_COLORS = ['#2563eb','#c2410c','#199e70','#7c3aed','#a16207','#be185d','#15803d','#86198f'];
async function initGarageMap(g, tok = state.navToken){
  const el = document.getElementById('map');
  if(!el) return;
  if(state.map){ state.map.remove(); state.map = null; }
  state.map = makeMap(el);
  const ov = await D.overview();
  if(gone(tok)) return;
  if(!document.getElementById('map')) return; // navigated away mid-load
  const mine = new Map();
  (g.routes ?? []).forEach((r,i) => mine.set(String(r).toUpperCase(), GARAGE_MAP_COLORS[i % GARAGE_MAP_COLORS.length]));
  const feats = (ov?.features ?? []).filter(f => mine.has((f.properties?.name ?? '').toUpperCase()));
  const group = L.featureGroup();
  for(const f of feats){
    const name = f.properties.name.toUpperCase();
    L.geoJSON(f, { style:{ color: mine.get(name), weight:3.5, opacity:.9, lineCap:'round', lineJoin:'round' } })
      .bindPopup(`<b>Route ${esc(name)}</b><br><a href="#/route/${encodeURIComponent(name)}" style="color:var(--acc);font-weight:600">Open route ›</a>`)
      .addTo(group);
  }
  group.addTo(state.map);
  const pinnable = garageLocOk(g);
  if(pinnable){
    L.marker([g.lat, g.lng], { icon: garagePinIcon(g) })
      .bindPopup(`<b>${esc(g.name)} (${esc(g.code)})</b>`)
      .addTo(state.map);
  } else {
    // Say why the pin is missing instead of leaving a silent gap.
    const note = document.querySelector('#map + .legendrow span');
    if(note) note.textContent += ' Exact garage location isn’t in the dataset yet — its record only carries the operating company’s registered-office postcode.';
  }
  try{
    let b = group.getBounds();
    if(pinnable) b = b.extend([g.lat, g.lng]);
    state.map.fitBounds(b.pad(0.06));
  }
  catch(e){ if(pinnable) state.map.setView([g.lat,g.lng],12); else state.map.setView([51.505,-0.118],11); }
}
