/* View: Network map — every route, with layers, filters, paint mode and heat. */
import { D, nextPollS } from '../core/data.js';
import { garagePinIcon } from '../core/incoming.js';
import { addLiveTimer, gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { isDark } from '../core/theme.js';
import { cmpRoute, downloadCsv, esc, nOf, num, opColor, PROPULSION, title, TYPE_LABEL } from '../core/utils.js';
import { bindStopPopup, bridgeDiamond, bridgesLayer, busesLayer, currentStreetworks, garageLocOk, garagePopupHtml, incidentGrave, incidentHeat, LAYER_UI, makeCorridor, makeMap, streetworksLayer, trafficOrdersLayer, troItems } from '../map/layers.js';

/* ════════════════════ NETWORK MAP ════════════════════ */
const netmapState = {
  pills: [],                                   // focused routes, in selection order
  f: { type:new Set(), prop:new Set(), deck:new Set(), freq:new Set(), op:new Set() },   // multi-select filters
  colorBy: 'operator', garages: true, garagesAll: false, panelOpen: false,
  scopeIds: null, scopeTitle: '',                // set by a scoped link (an operator's or garage's routes)
  pinOn: false, pin: null, pinR: 1500, pinIds: null,   // catchment pin: armed?, {lat,lng}, radius (m), routes inside
  rScope: 'sel',                               // with a pin: draw only the catchment routes, or fade the rest in behind them
};
const FOCUS_COLORS = ['#2563eb','#c2410c','#199e70','#7c3aed','#a16207','#be185d','#15803d','#86198f'];
const fmtKm = m => m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 2 : 0).replace(/\.?0+$/, '')} km` : `${m} m`;
const PIN_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.7-6-11a6 6 0 0 1 12 0c0 5.3-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>`;
export async function renderNetworkMap(){
  const tok = state.navToken;
  main.innerHTML = `
    <h1 class="sr-only">London bus network map</h1>
    <div class="netmap-wrap">
      <div id="netmap"></div>
      <div class="netmap-panel" id="nmPanel">
        <div class="nm-scope" id="nmScope" hidden></div>
        <div class="nm-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/></svg>
          <input id="nmq" aria-label="Search routes on the map" placeholder="Search routes — 25, N38, X68…" autocomplete="off" enterkeyhint="go" />
          <button class="clear" id="nmqClear" aria-label="Clear search" hidden><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        <div class="nm-sugg" id="nmSugg" hidden></div>
        <div class="nm-tools">
          <button class="livebtn" id="nmFilters" style="margin:0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
            Filters<span id="nmFBadge" class="nm-badge" hidden></span>
          </button>
          <div class="nm-colour">
            <span class="nm-lbl">Colour by</span>
            <div class="seg">
              <button data-cb="operator" class="${netmapState.colorBy==='operator'?'on':''}">Operator</button>
              <button data-cb="type" class="${netmapState.colorBy==='type'?'on':''}">Type</button>
            </div>
          </div>
        </div>
        <div class="nm-layers">
          <span class="nm-lbl">Layers</span>
          <div class="nm-lbtns" id="nmLayers" role="group" aria-label="Map layers">${LAYER_UI.map(l => `<button type="button" class="livebtn iconb" data-lyr="${l.k}" title="${l.label}" aria-label="${l.label}" aria-pressed="false">${l.icon}</button>`).join('')}<button type="button" class="livebtn iconb" data-lyr="pin" title="Catchment pin — drop a pin and list every route within a radius" aria-label="Catchment pin" aria-pressed="false">${PIN_ICON}</button></div>
        </div>
        <div class="nm-gscope" id="nmRouteScope" hidden><span class="nm-lbl">Routes</span><div class="seg" role="group" aria-label="Which route lines to draw"><button type="button" data-rs="sel">Catchment only</button><button type="button" data-rs="all">All routes</button></div></div>
        <div class="nm-gscope" id="nmGarScope" hidden><span class="nm-lbl">Garages</span><div class="seg" role="group" aria-label="Which garages to show"><button type="button" data-gs="route">Selected routes</button><button type="button" data-gs="all">All garages</button></div></div>
        <div class="nm-pinbox" id="nmPin" hidden>
          <div class="nm-pinhead"><span class="nm-lbl">Catchment</span><span id="nmPinSum" class="nm-pinsum">Click the map to drop a pin</span><button type="button" class="reset" id="nmPinClear" hidden>Clear pin</button></div>
          <label class="nm-pinr"><span>Radius</span><input type="range" id="nmPinR" min="250" max="5000" step="250" value="${netmapState.pinR}" aria-label="Catchment radius in metres"><b id="nmPinRv">${(netmapState.pinR / 1000).toFixed(netmapState.pinR % 1000 ? 2 : 0).replace(/\.?0+$/, '')} km</b></label>
          <div class="nm-pinops" id="nmPinOps"></div>
          <div class="nm-pinroutes" id="nmPinRoutes"></div>
        </div>
        <div class="nm-lnotes" id="nmLNotes" aria-live="polite" hidden></div>
        <div class="nm-legend" id="nmLegend" hidden></div>
        <div class="nm-filters" id="nmPop" hidden></div>
        <div class="nm-body" id="nmInfo" hidden></div>
        <div class="nm-foot"><span id="nmCount">Loading network…</span><button class="reset" id="nmExport" style="margin-left:auto" title="Every route with its full record — filters are ignored">Export CSV</button><button class="reset" id="nmReset" style="margin-left:0" hidden>Reset all</button></div>
      </div>
    </div>`;

  const [ov, meta, routes, garages] = await Promise.all([D.overview(), D.meta(), D.routes(), D.garages()]);
  if(gone(tok) || !document.getElementById('netmap')) return;
  if(!ov?.features?.length || !routes){ document.getElementById('nmCount').textContent = 'The map data is unreachable right now.'; return; }

  if(state.map){ state.map.remove(); state.map = null; }
  state.map = makeMap(document.getElementById('netmap'));
  state.map.setView([51.505,-0.118], 11);

  const st = netmapState;
  st.panelOpen = false;                        // filters start collapsed on every visit
  if(state.pendingMapQ){
    const q = state.pendingMapQ; state.pendingMapQ = null;
    const names = new Set(routes.map(r => r.name.toUpperCase()));
    const list = k => (q.get(k) ?? '').split(',').map(x => x.trim().toUpperCase()).filter(x => names.has(x));
    st.pills = list('routes');
    for(const k of Object.keys(st.f)) st.f[k].clear();
    const ids = list('ids');
    st.scopeIds = ids.length ? new Set(ids) : null;
    st.scopeTitle = q.get('title') ?? '';
    st.garagesAll = false; st.gScope = 'route';
    const pin = (q.get('pin') ?? '').split(',').map(Number);   // pin=lat,lng,radius — a catchment opened from elsewhere
    if(pin.length >= 2 && pin.every(Number.isFinite)){ st.pinOn = true; st.pin = { lat: pin[0], lng: pin[1] }; st.pinR = pin[2] >= 250 ? pin[2] : 1500; }
    else { st.pinOn = false; st.pin = null; st.pinIds = null; }
  } else if(!/[?&]embed=1/.test(location.hash)) { st.scopeIds = null; st.scopeTitle = ''; }
  const typeInfo = new Map(routes.map(r => [r.name.toUpperCase(), r.type]));
  const TYPE_COLORS = { regular:'#dc2626', night:'#6d28d9', twentyfour:'#0e7490', school:'#15803d' };
  /* Focus colours are per operating GARAGE, not per route: routes sharing a
     garage share a colour, and each new garage in the comparison takes the
     next palette slot. Routes with no linked garage get their own. */
  const garKey = p => String(meta?.[p]?.garage ?? '').split(/[^A-Za-z]+/).filter(Boolean)[0] ?? '·' + p;
  /* Base colour per operating garage (the pin wears this)… */
  const garBase = name => {
    const seen = [];
    for(const p of st.pills){ const k = garKey(p); if(!seen.includes(k)) seen.push(k); }
    return FOCUS_COLORS[Math.max(0, seen.indexOf(garKey(name))) % FOCUS_COLORS.length];
  };
  /* …and a distinct lightness step of that hue per route within the garage,
     so two same-garage (or same-operator) routes stay tellable apart while
     still reading as one family. */
  /* Absolute lightness slots — up to six routes from one garage each get a
     guaranteed-distinct shade of the base hue (≥0.08 apart in lightness; the
     palest slots get a saturation lift so the hue stays recognisable). */
  // Candidate lightness slots; each sibling takes the first candidate that
  // keeps ≥0.07 lightness distance from EVERY slot already used (base
  // included), so six same-garage routes always get six distinct shades.
  const SHADE_CAND = [.68, .32, .78, .24, .50, .60, .40, .86, .18];
  function shadeAt(hex, idx){
    if(!idx) return hex;
    const n = parseInt(hex.slice(1), 16), r=(n>>16)/255, g=((n>>8)&255)/255, b=(n&255)/255;
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b); let h=0, s=0, l=(mx+mn)/2;
    if(mx!==mn){ const d=mx-mn; s = l>.5 ? d/(2-mx-mn) : d/(mx+mn);
      h = mx===r ? ((g-b)/d + (g<b?6:0)) : mx===g ? (b-r)/d+2 : (r-g)/d+4; h/=6; }
    const used = [l];
    while(used.length <= idx){
      const L = SHADE_CAND.find(c => used.every(u => Math.abs(u - c) >= .07));
      used.push(L ?? ((used[used.length-1] + .13) % .7) + .15);
    }
    const L = used[idx];
    const S = L > .62 ? Math.min(1, s*1.15 + .08) : s;
    const f=(p,q,t)=>{ t=(t%1+1)%1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p; };
    const q = L<.5 ? L*(1+S) : L+S-L*S, p = 2*L-q;
    const T = x => Math.round(f(p,q,x)*255).toString(16).padStart(2,'0');
    return '#'+T(h+1/3)+T(h)+T(h-1/3);
  }
  const focusColor = name => {
    const k = garKey(name);
    const sibs = st.pills.filter(p => garKey(p) === k);
    return shadeAt(garBase(name), Math.max(0, sibs.indexOf(name)));
  };
  const allNames = new Set((ov.features ?? []).map(f => f.properties?.name).filter(Boolean));

  const passes = (name) => {
    const m = meta?.[name] ?? {};
    if(st.scopeIds && !st.scopeIds.has(name.toUpperCase())) return false;
    if(st.pinIds && !st.pinIds.has(name.toUpperCase())) return false;
    if(st.f.type.size && !st.f.type.has(typeInfo.get(name.toUpperCase()))) return false;
    if(st.f.op.size   && !st.f.op.has(m.operator)) return false;
    if(st.f.prop.size && !st.f.prop.has(m.propulsion)) return false;
    if(st.f.deck.size && !st.f.deck.has(m.deck)) return false;
    if(st.f.freq.size && !st.f.freq.has(m.frequency)) return false;
    return true;
  };
  const styleFor = (f) => {
    const name = f.properties?.name ?? '';
    const up = name.toUpperCase();
    if(st.pills.length){
      return st.pills.includes(up)
        ? { color: focusColor(up), opacity: 1, weight: 5 }
        : { color: '#a8a29e', opacity: .12, weight: 1.5 };
    }
    const base = st.colorBy === 'type'
      ? (TYPE_COLORS[typeInfo.get(up)] ?? '#dc2626')
      : opColor(meta?.[name]?.operator);
    return { color: base, opacity: .75, weight: 2 };
  };

  const layer = L.geoJSON(ov, {
    style: styleFor,
    onEachFeature: (f, ly) => {
      ly.on('click', () => {
        if(st.pinOn) return;                                   // the map click moves the catchment pin instead
        const up = (f.properties?.name ?? '').toUpperCase();
        if(st.pills.includes(up)) removeFocus(up);
        else addFocus(up);
      });
    },
  }).addTo(state.map);

  /* Terminus pills: a small route-number marker at each end of every
     focused line — start/end read instantly, and the number disambiguates
     same-garage routes that share a focus colour. */
  let terminiLayer = null;
  function syncTermini(){
    if(terminiLayer){ state.map.removeLayer(terminiLayer); terminiLayer = null; }
    if(!st.pills.length) return;
    terminiLayer = L.layerGroup();
    for(const p of st.pills){
      const feats = (ov.features ?? []).filter(f => (f.properties?.name ?? '').toUpperCase() === p);
      if(!feats.length) continue;
      const dir1 = feats.filter(f => String(f.properties?.direction) === '1');
      const use = (dir1.length ? dir1 : feats).reduce((a,b) =>
        JSON.stringify(b.geometry?.coordinates ?? '').length > JSON.stringify(a.geometry?.coordinates ?? '').length ? b : a);
      let cs = use.geometry?.coordinates ?? [];
      if(cs.length && typeof cs[0]?.[0] !== 'number') cs = [...cs[0], ...cs[cs.length-1]];  // MultiLineString
      if(cs.length < 2) continue;
      for(const end of [cs[0], cs[cs.length-1]]){
        const [lng, lat] = end;
        if(!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        L.marker([lat, lng], { icon: L.divIcon({ className:'', iconSize:null, html:
          `<div class="nm-term" style="background:${focusColor(p)}">${esc(p)}</div>` }) })
          .bindTooltip(`Route ${esc(p)} · terminus`, { direction:'top' })
          .addTo(terminiLayer);
      }
    }
    terminiLayer.addTo(state.map);
  }


  /* ── repaint: per-layer visibility, style, tooltip + hover rules ──
     Filtered-out routes are REMOVED from the map (no ghost hovers or
     clicks); while routes are focused, only the focused lines keep a
     tooltip — the grey context lines stay clickable to add, silent
     on hover. */
  function repaint(){
    layer.eachLayer(ly => {
      const name = ly.feature?.properties?.name ?? '';
      const up = name.toUpperCase();
      const focused = st.pills.includes(up);
      const visible = focused || passes(name);
      // With a pin and "All routes", the rest of the network stays drawn faded behind the catchment routes.
      const dim = !visible && st.pinIds && st.rScope === 'all' && !st.pills.length;
      if(!visible && !dim){
        if(ly.getTooltip()){ ly.closeTooltip(); ly.unbindTooltip(); }
        if(state.map.hasLayer(ly)) state.map.removeLayer(ly);
        return;
      }
      if(dim){
        if(!state.map.hasLayer(ly)) ly.addTo(state.map);
        ly.setStyle({ color: '#a8a29e', opacity: .18, weight: 1.5 }); ly.options.interactive = false;
        if(ly.getTooltip()){ ly.closeTooltip(); ly.unbindTooltip(); }
        ly.bringToBack();
        return;
      }
      if(!state.map.hasLayer(ly)) ly.addTo(state.map);
      ly.setStyle(styleFor(ly.feature));
      // Faded context lines are fully inert — no pointer cursor promising a
      // click that would silently add a route.
      const active = focused || !st.pills.length;
      ly.options.interactive = active;
      if(active && !ly.getTooltip()) ly.bindTooltip(`Route ${esc(name)}`, { sticky:true, direction:'top' });
      else if(!active && ly.getTooltip()){ ly.closeTooltip(); ly.unbindTooltip(); }
      if(focused) ly.bringToFront();
    });

    const vis = visibleNames();
    const filtered = filteredNow();
    const cEl = document.getElementById('nmCount');
    if(cEl) cEl.textContent = st.pills.length
      ? `${st.pills.length} route${st.pills.length===1?'':'s'} focused · ${vis.size} in view`
      : st.pinIds ? `${nOf(vis.size, 'route')} within ${fmtKm(st.pinR)} of the pin`
      : (filtered ? `${vis.size} of ${nOf(allNames.size, 'route')}` : `${nOf(allNames.size, 'route')}`);
    const reset = document.getElementById('nmReset');
    if(reset) reset.hidden = !(st.pills.length || filtered);
    syncTermini();
    syncLegend();
    syncLayers();
  }
  /* Colour key for the current mode. Hidden while routes are focused —
     there the colours belong to the route cards, not the categories. */
  const shortOp = o => String(o).replace(' London','').replace(' Bus','').replace(/\s*\(.*\)$/,'');
  function syncLegend(){
    const el = document.getElementById('nmLegend');
    if(!el) return;
    el.hidden = !!st.pills.length;
    // Colour-by has no effect while routes are focused — hide the control.
    const cb = document.querySelector('.nm-colour');
    if(cb) cb.hidden = !!st.pills.length;
    if(el.hidden){ el.innerHTML = ''; return; }
    el.innerHTML = st.colorBy === 'type'
      ? Object.entries(TYPE_LABEL).map(([v,l]) => `<span><i style="background:${TYPE_COLORS[v]}"></i>${esc(l)}</span>`).join('')
      : ops.map(o => `<span><i style="background:${opColor(o)}"></i>${esc(shortOp(o))}</span>`).join('');
  }

  /* ── filter section — inline in the panel, grouped multi-select ── */
  const ops = [...new Set(Object.values(meta ?? {}).map(m => m?.operator).filter(Boolean))].sort();
  const GROUPS = [
    ['type', 'Route type', Object.entries(TYPE_LABEL).map(([v,l]) => [v,l])],
    ['prop', 'Power', PROPULSION.map(p => [p, title(p)])],
    ['deck', 'Deck', [['double','Double deck'], ['single','Single deck']]],
    ['freq', 'Frequency', [['high','High frequency'], ['low','Low frequency']]],
    ['op', 'Operator', ops.map(o => [o, o.replace(' London','')])],
  ];
  function popHtml(){
    return GROUPS.map(([key, label, opts]) => `
      <div class="nm-group"><div class="nm-group-h">${label}</div>
        <div class="nm-group-chips">${opts.map(([v,l]) =>
          `<button class="chip ${st.f[key].has(v)?'on':''}" data-f="${key}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>
      </div>`).join('') +
      `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:2px">
        <button class="livebtn" id="nmFClear" style="margin:0">Clear filters</button>
        <button class="livebtn on" id="nmFDone" style="margin:0">Done</button>
      </div>`;
  }
  const pop = document.getElementById('nmPop');
  function syncPop(){
    pop.hidden = !st.panelOpen;
    pop.innerHTML = st.panelOpen ? popHtml() : '';
    const n = st.f.type.size + st.f.prop.size + st.f.deck.size + st.f.freq.size + st.f.op.size;
    const badge = document.getElementById('nmFBadge');
    if(badge){ badge.hidden = !n; badge.textContent = n; }
    document.getElementById('nmFilters')?.classList.toggle('on', st.panelOpen || n > 0);
  }

  /* ── focused-route cards ── */
  function cardsHtml(){
    return st.pills.map(p => {
      const m = meta?.[p] ?? {};
      const t = typeInfo.get(p);
      return `<div class="netmap-card" style="border-left:4px solid ${focusColor(p)}">
        <button class="close" data-rm="${esc(p)}" aria-label="Remove ${esc(p)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        <div style="display:flex;align-items:center;gap:9px">
          <span class="rnum ${esc(t)}" style="min-width:40px;height:27px;font-size:13px">${esc(p)}</span>
          <div style="min-width:0;font-size:12px;color:var(--tx2)">
            <b style="color:var(--tx);font-size:12.5px">${esc(m.operator ?? '')}</b><br>
            ${[TYPE_LABEL[t], m.garageName ? `${m.garageName} (${m.garage})` : null, num(m.pvr) ? `PVR ${m.pvr}` : null].filter(Boolean).map(esc).join(' · ')}
          </div>
        </div>
        <a href="#/route/${encodeURIComponent(p)}" style="display:inline-block;margin-top:7px;color:var(--acc);font-weight:600;font-size:12.5px">Open route page ›</a>
      </div>`;
    }).join('');
  }
  function syncFocus(fit){
    const info = document.getElementById('nmInfo');
    info.hidden = !st.pills.length;
    info.innerHTML = cardsHtml();
    repaint();
    if(fit && st.pills.length){
      const feats = ov.features.filter(f => st.pills.includes((f.properties?.name ?? '').toUpperCase()));
      if(feats.length){
        // Fit into the part of the map the search panel isn't covering: right of it on wide screens, below it on phones.
        const panel = document.getElementById('nmPanel'), wide = innerWidth >= 760;
        const pad = wide ? { paddingTopLeft:[panel.offsetWidth + 36, 40], paddingBottomRight:[40, 40] }
                         : { paddingTopLeft:[24, panel.offsetHeight + 28], paddingBottomRight:[24, 24] };
        try{ state.map.fitBounds(L.geoJSON({type:'FeatureCollection',features:feats}).getBounds(), pad); }catch(e){}
      }
    }
  }
  function addFocus(name){ if(!st.pills.includes(name)){ st.pills.push(name); syncFocus(true); } }
  function removeFocus(name){ st.pills = st.pills.filter(p => p !== name); syncFocus(st.pills.length > 0); }

  /* ── Layers ───────────────────────────────────────────────────────────────
     The route view's layers, on the network map, drawn by the same builders. The map's scope decides
     what each shows:
     · 1–3 routes searched or filtered → focused: every layer shows what lies near those routes, and live
       buses and stops become available. Live buses poll once per route every ~15 s, so they are capped at
       three routes rather than hammering the feed.
     · anything else → network: nothing is fetched until a layer is switched on, and the dense layers
       (low bridges, collisions, street works, traffic orders) draw only what is on screen once you zoom in,
       so the map stays readable. */
  const LY_MAX = 3, LY_REBUILD_MS = 250;
  const LY_LABEL = Object.fromEntries(LAYER_UI.map(l => [l.k, l.label]));
  const LY_NAME = { garages:'garages', stops:'stops', live:'live buses', bridges:'low bridges', inc:'collisions', sw:'street works', tro:'traffic orders' };
  const LY_MIN_ZOOM = { bridges:12, inc:13, sw:14, tro:14 };
  const needsFocus = k => k === 'live' || k === 'stops';
  const fmtN = n => n.toLocaleString('en-GB');
  const plural = (n, one, many = one + 's') => `${fmtN(n)} ${n === 1 ? one : many}`;
  const dot = c => `<span class="nm-dot" style="background:${c}"></span>`;
  const chip = (swatch, text) => `<span class="nm-chip">${swatch}${text}</span>`;
  st.gScope = 'route';
  st.ly = { garages:true, stops:false, live:false, bridges:false, inc:false, sw:false, tro:false };

  const filteredNow = () => !!(st.scopeIds || st.pinIds || st.f.type.size || st.f.prop.size || st.f.deck.size || st.f.freq.size || st.f.op.size);
  const visibleNames = () => { const v = new Set(); for(const n of allNames) if(st.pills.includes(n.toUpperCase()) || passes(n)) v.add(n); return v; };
  /* The routes the layers are about (upper-case): 1–3 of them, or [] for the whole network. */
  function layerScope(){
    const names = st.pills.length ? st.pills : (filteredNow() ? [...visibleNames()].map(n => n.toUpperCase()) : []);
    return names.length >= 1 && names.length <= LY_MAX ? names : [];
  }
  const corridors = new Map();
  const corridorFor = names => {
    const key = names.join('|');
    if(!corridors.has(key)) corridors.set(key, makeCorridor(ov.features.filter(f => names.includes((f.properties?.name ?? '').toUpperCase()))));
    return corridors.get(key);
  };

  const lyNotes = {};
  const renderLyNotes = () => {
    const el = document.getElementById('nmLNotes'); if(!el) return;
    const rows = Object.entries(lyNotes).filter(([, h]) => h);
    el.hidden = !rows.length;
    el.innerHTML = rows.map(([k, h]) => `<div class="nm-lnote" data-lyr="${k}">${h}</div>`).join('');
  };
  const setLyNote = (k, html) => { lyNotes[k] = html; renderLyNotes(); };

  /* Draws only what is on screen, and only once zoomed in past minZoom — for layers too dense to show whole. */
  function viewportLayer(k, { items, pos, build, cap, gated, shown }){
    const host = L.layerGroup().addTo(state.map);
    let inner = null, timer = 0;
    const update = () => {
      if(inner){ host.removeLayer(inner); inner = null; }
      if(state.map.getZoom() < LY_MIN_ZOOM[k]){ setLyNote(k, gated); return; }
      const b = state.map.getBounds().pad(.2), vis = [];
      for(const it of items){ const [la, ln] = pos(it); if(b.contains([la, ln])){ vis.push(it); if(vis.length >= cap) break; } }
      inner = build(vis); host.addLayer(inner);
      setLyNote(k, shown(vis.length, vis.length >= cap));
    };
    const onMove = () => { clearTimeout(timer); timer = setTimeout(update, 120); };
    state.map.on('moveend', onMove); update();
    return { remove(){ clearTimeout(timer); state.map.off('moveend', onMove); state.map.removeLayer(host); } };
  }
  const unavailable = k => { setLyNote(k, `${LY_LABEL[k]} data is unavailable right now.`); return null; };

  const LAYER_IMPL = {
    async stops(scope, alive){
      const all = await D.stops(); if(!alive()) return null; if(!all) return unavailable('stops');
      const group = L.layerGroup(); let count = 0;
      for(const name of scope){
        const rec = all[name.toLowerCase()] ?? all[name] ?? {}, colour = focusColor(name), seen = new Set();
        for(const sp of [...(rec.outbound ?? []), ...(rec.inbound ?? [])]){
          if(!Number.isFinite(sp.lat) || !Number.isFinite(sp.lng) || seen.has(sp.id)) continue;
          seen.add(sp.id); count++;
          bindStopPopup(L.circleMarker([sp.lat, sp.lng], { radius:4.5, color:colour, weight:2, fillColor:isDark() ? '#1b1917' : '#fff', fillOpacity:1 }), sp.id, sp.name, `<br><span style="color:var(--tx2)">Route ${esc(name)}</span>`).addTo(group);
        }
      }
      group.addTo(state.map);
      setLyNote('stops', plural(count, 'stop'));
      return { remove: () => state.map.removeLayer(group) };
    },

    /* Every garage in its operator's colour; the popup carries the numbers, so no distance or "operating from here" tags. */
    async garages(){
      const group = L.layerGroup(); let n = 0;
      const names = st.pills.length ? st.pills : (filteredNow() ? [...visibleNames()].map(x => x.toUpperCase()) : null);
      const mine = g => {
        if(!names) return true;
        if(!st.pills.length) return (g.routes ?? []).some(r => names.includes(String(r).toUpperCase()));
        // Focused routes: trust route-meta's garage (matches the card); fall back to the garage's own list only when meta has none.
        return names.some(p => {
          const codes = String(meta?.[p]?.garage ?? meta?.[Object.keys(meta ?? {}).find(k => k.toUpperCase() === p)]?.garage ?? '').split(/[^A-Za-z]+/).filter(Boolean).map(c => c.toUpperCase());
          return codes.length ? codes.includes(String(g.code).toUpperCase()) : (g.routes ?? []).some(r => String(r).toUpperCase() === p);
        });
      };
      const showAll = !names || st.gScope === 'all';
      for(const g of garages ?? []){
        if(!garageLocOk(g)) continue;
        const hit = mine(g);
        if(!hit && !showAll) continue;
        n++;
        L.marker([g.lat, g.lng], { icon: garagePinIcon(g, names && hit ? 34 : (names ? 26 : 30)), zIndexOffset: hit && names ? 300 : 0 })
          .bindTooltip(`${esc(g.name)} (${esc(g.code)}) · ${esc(g.operator ?? '—')}`, { direction:'top', offset:[0,-14] })
          .bindPopup(() => garagePopupHtml(g, meta, `<div style="padding:6px 0 0;border-top:1px solid var(--bd);margin-top:4px"><button type="button" class="reset" data-pinat="${g.lat},${g.lng}" style="padding:0;color:var(--acc);font-weight:600;font-size:12px">Catchment from this garage ›</button></div>`))
          .addTo(group);
      }
      group.addTo(state.map);
      setLyNote('garages', n ? `<b>${plural(n, 'garage')}</b>${names && !showAll ? ' for the selected routes' : ''}` : 'No garages found for the selected routes.');
      return { remove: () => state.map.removeLayer(group) };
    },

    async live(scope, alive){
      let layer = null, count = 0, nextIn = 15;
      const text = () => `<b>${count ? plural(count, 'live bus', 'live buses') : 'No buses tracked right now'}</b>${scope.length > 1 ? ' on ' + scope.join(', ') : ''} · ${nextIn > 0 ? `next update in ${nextIn} s` : 'updating…'}`;
      const show = html => { lyNotes.live = html; const n = document.querySelector('#nmLNotes [data-lyr="live"]'); if(n) n.innerHTML = html; else renderLyNotes(); };
      const poll = async () => {
        const [raws, reg] = await Promise.all([Promise.all(scope.map(n => D.liveVehicles(n))), D.vehiclesReg()]);
        if(!alive()) return;
        nextIn = Math.min(...raws.map(r => r ? nextPollS(r, 15) : 8));
        if(raws.every(r => !r) && layer){ show('<b>Live buses</b> — reconnecting…'); return; }   // keep the last positions
        const rows = raws.flatMap((raw, i) => (raw?.data ?? []).filter(v => Number.isFinite(v.lat) && Number.isFinite(v.lng)).map(v => ({ ...v, _route:scope[i] })));
        if(layer) state.map.removeLayer(layer);
        layer = busesLayer(rows, reg).addTo(state.map);
        count = rows.length; show(text());
      };
      await poll();
      if(!alive()) return layer ? { remove: () => state.map.removeLayer(layer) } : null;
      const timer = addLiveTimer(setInterval(() => {
        if(!alive() || document.hidden) return;   // a hidden tab makes no requests
        nextIn -= 1; show(text());
        if(nextIn <= 0){ nextIn = 999; poll(); }
      }, 1000));
      return { remove(){ clearInterval(timer); if(layer) state.map.removeLayer(layer); } };
    },

    async bridges(scope, alive){
      const all = await D.bridges(); if(!alive()) return null; if(!all) return unavailable('bridges');
      const pts = all.filter(b => Number.isFinite(b.lat) && Number.isFinite(b.lng));
      const legend = ` · ${chip(bridgeDiamond('#dc2626', '#7f1d1d', 8), '&lt;4.2 m')}${chip(bridgeDiamond('#f59e0b', '#92400e', 8), '4.2–4.9')}${chip(bridgeDiamond('#64748b', '#334155', 8), '≥4.9')}`;
      if(scope.length){
        const near = corridorFor(scope), list = pts.filter(b => near(b.lat, b.lng, 300));
        const layer = bridgesLayer(list).addTo(state.map);
        setLyNote('bridges', `${plural(list.length, 'low bridge')} within 300 m${legend}`);
        return { remove: () => state.map.removeLayer(layer) };
      }
      return viewportLayer('bridges', { items:pts, pos:b => [b.lat, b.lng], build:bridgesLayer, cap:700,
        gated:`Zoom in to see low bridges (${fmtN(pts.length)} in London)`,
        shown:n => `${plural(n, 'low bridge')} in view${legend}` });
    },

    async inc(scope, alive){
      const snap = await D.accidents(); if(!alive()) return null; if(!snap) return unavailable('inc');
      const all = (snap.accidents ?? []).filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng)), period = esc(snap.period ?? '2021–2025');
      const legend = `${chip(dot('#ea580c'), 'serious')}${chip(dot('#111827'), 'fatal')}`;
      if(scope.length){
        const near = corridorFor(scope), list = all.filter(a => near(a.lat, a.lng, 150));
        const heat = incidentHeat(list).addTo(state.map), grave = incidentGrave(list).addTo(state.map);
        setLyNote('inc', `${plural(list.length, 'collision')} within 150 m (${period}) · ${legend}`);
        return { remove(){ state.map.removeLayer(heat); state.map.removeLayer(grave); } };
      }
      const heat = incidentHeat(all).addTo(state.map);
      const vp = viewportLayer('inc', { items:all.filter(a => a.severity === 'serious' || a.severity === 'fatal'), pos:a => [a.lat, a.lng], build:incidentGrave, cap:600,
        gated:`Collision density, bus/coach (${period}) · zoom in for serious and fatal`,
        shown:(n, capped) => `Collision density · ${fmtN(n)}${capped ? '+' : ''} serious or fatal in view · ${legend}` });
      return { remove(){ vp.remove(); state.map.removeLayer(heat); } };
    },

    async sw(scope, alive){
      const snap = await D.streetworks(); if(!alive()) return null; if(!snap) return unavailable('sw');
      const current = currentStreetworks(snap);
      const legend = `${chip(dot('#dc2626'), 'immediate')}${chip(dot('#ea580c'), 'major')}${chip(dot('#f59e0b'), 'other')}`;
      if(scope.length){
        const near = corridorFor(scope), list = current.filter(e => e.coords.some(([la, ln]) => near(la, ln, 150)));
        const layer = streetworksLayer(list).addTo(state.map);
        setLyNote('sw', `${plural(list.length, 'street work')} within 150 m · ${legend}`);
        return { remove: () => state.map.removeLayer(layer) };
      }
      return viewportLayer('sw', { items:current, pos:e => e.coords[0], build:streetworksLayer, cap:400,
        gated:`Zoom in to see street works (${fmtN(current.length)} across London)`,
        shown:(n, capped) => `${fmtN(n)}${capped ? '+' : ''} street work${n === 1 ? '' : 's'} in view · ${legend}` });
    },

    async tro(scope, alive){
      const snap = await D.dtro(); if(!alive()) return null; if(!snap) return unavailable('tro');
      const orders = snap.orders ?? [];
      const legend = `${chip(dot('#dc2626'), 'closure')}${chip(dot('#2563eb'), 'bus lane')}${chip(dot('#ea580c'), 'turn')}${chip(dot('#64748b'), 'other')}`;
      if(scope.length){
        const near = corridorFor(scope);
        const list = orders.filter(o => o.routes?.some(r => scope.includes(String(r).toUpperCase()))
          || o.provisions?.some(p => p.places?.some(pl => pl.type !== 'diversionRoute' && pl.coords?.some(([la, ln]) => near(la, ln, 150)))));
        const layer = trafficOrdersLayer(troItems(list)).addTo(state.map);
        setLyNote('tro', `${plural(list.length, 'traffic order')} nearby · ${legend}`);
        return { remove: () => state.map.removeLayer(layer) };
      }
      const items = troItems(orders).filter(it => it.pl.coords?.length);
      return viewportLayer('tro', { items, pos:it => it.pl.coords[0], build:trafficOrdersLayer, cap:400,
        gated:`Zoom in to see traffic orders (${fmtN(orders.length)} in London)`,
        shown:(n, capped) => `${fmtN(n)}${capped ? '+' : ''} order location${n === 1 ? '' : 's'} in view · ${legend}` });
    },
  };

  const lyRT = {}, lyTok = {};
  async function syncLayer(k){
    const tok = lyTok[k] = (lyTok[k] ?? 0) + 1;
    lyRT[k]?.remove(); lyRT[k] = null;
    if(!st.ly[k]){ setLyNote(k, ''); return; }
    const scope = layerScope();
    if(needsFocus(k) && !scope.length){ st.ly[k] = false; setLyNote(k, ''); syncLyButtons(); return; }
    setLyNote(k, `Loading ${LY_NAME[k]}…`);
    const alive = () => lyTok[k] === tok && st.ly[k] && !!document.getElementById('netmap');
    let handle = null;
    try{ handle = await LAYER_IMPL[k](scope, alive); }
    catch(err){ console.warn('map layer', k, err.message); if(alive()) unavailable(k); return; }
    if(!handle) return;   // superseded while loading, or unavailable
    if(!alive()){ handle.remove(); return; }
    lyRT[k] = handle;
  }
  const narrowingNow = () => st.pills.length > 0 || filteredNow();
  function syncRouteScope(){
    const box = document.getElementById('nmRouteScope'); if(!box) return;
    box.hidden = !st.pinIds;
    box.querySelectorAll('[data-rs]').forEach(b => { const on = b.dataset.rs === st.rScope; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  function syncGarScope(){
    syncRouteScope();
    const box = document.getElementById('nmGarScope'); if(!box) return;
    box.hidden = !(st.ly.garages && narrowingNow());
    box.querySelectorAll('[data-gs]').forEach(b => { const on = b.dataset.gs === st.gScope; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  function syncLyButtons(){
    syncGarScope();
    const focused = layerScope().length > 0;
    document.querySelectorAll('#nmLayers [data-lyr]').forEach(b => {
      const k = b.dataset.lyr; if(k === 'pin') return;
      const gated = needsFocus(k) && !focused;
      b.classList.toggle('on', !!st.ly[k]); b.setAttribute('aria-pressed', String(!!st.ly[k]));
      b.classList.toggle('is-gated', gated); b.setAttribute('aria-disabled', String(gated));
      b.title = gated ? `${LY_LABEL[k]} — search or filter to 1–3 routes to enable` : LY_LABEL[k];
    });
  }
  /* Called from repaint(): rebuild the active layers when the scope changes. */
  let lastScope = '', lastGKey = '', rebuildTimer = 0;
  function syncLayers(){
    const scope = layerScope(), key = scope.join('|'), changed = key !== lastScope;
    lastScope = key;
    if(!scope.length) for(const k of ['live', 'stops']) if(st.ly[k]){ st.ly[k] = false; syncLayer(k); }   // no longer eligible
    syncLyButtons();
    const gKey = st.pills.join('|') + '#' + (filteredNow() ? [...visibleNames()].sort().join(',') : '');
    if(gKey !== lastGKey){ lastGKey = gKey; if(st.ly.garages) syncLayer('garages'); }
    // Adding several routes in a burst ("25, 88, N38") rebuilds once, so live buses poll once, not once per route added.
    if(changed){ clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => { for(const k of Object.keys(st.ly)) if(st.ly[k] && k !== 'garages') syncLayer(k); }, LY_REBUILD_MS); }
  }
  document.getElementById('nmRouteScope').addEventListener('click', e => {
    const b = e.target.closest('[data-rs]'); if(!b || b.dataset.rs === st.rScope) return;
    st.rScope = b.dataset.rs; syncRouteScope(); repaint();
  });
  document.getElementById('nmGarScope').addEventListener('click', e => {
    const b = e.target.closest('[data-gs]'); if(!b || b.dataset.gs === st.gScope) return;
    st.gScope = b.dataset.gs; syncGarScope(); syncLayer('garages');
  });
  let hintTimer = 0;
  document.getElementById('nmLayers').addEventListener('click', e => {
    const b = e.target.closest('[data-lyr]'); if(!b) return;
    const k = b.dataset.lyr;
    if(k === 'pin'){ st.pinOn ? pinOff() : pinArm(); return; }
    if(needsFocus(k) && !layerScope().length){
      setLyNote('hint', `${LY_LABEL[k]} appear when 1–3 routes are searched or filtered — the live feed isn’t polled for the whole network.`);
      clearTimeout(hintTimer); hintTimer = setTimeout(() => setLyNote('hint', ''), 6000);
      return;
    }
    st.ly[k] = !st.ly[k]; syncLyButtons(); syncLayer(k);
  });

  /* ── Catchment pin ─────────────────────────────────────────────────────────
     Drop a pin anywhere (or on a garage from its popup) and every route whose line passes within the radius is
     listed and the rest of the network fades — the quick way to see what a depot could reach, or what a site
     has running past it. Distance is from the pin to the nearest point of each route's drawn line, in metres. */
  const geoms = (ov.features ?? []).map(f => {
    const g = f.geometry, parts = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for(const part of parts) for(const [lng, lat] of part){ if(lat < minLat) minLat = lat; if(lat > maxLat) maxLat = lat; if(lng < minLng) minLng = lng; if(lng > maxLng) maxLng = lng; }
    return { name: String(f.properties?.name ?? '').toUpperCase(), parts, minLat, maxLat, minLng, maxLng };
  }).filter(x => x.name && x.parts.length);
  function catchment(lat, lng, r){
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, dLat = r / ky, dLng = r / kx, r2 = r * r, hit = new Set();
    for(const g of geoms){
      if(hit.has(g.name) || g.maxLat < lat - dLat || g.minLat > lat + dLat || g.maxLng < lng - dLng || g.minLng > lng + dLng) continue;
      outer: for(const part of g.parts){
        let px = (part[0][0] - lng) * kx, py = (part[0][1] - lat) * ky;
        if(px * px + py * py <= r2){ hit.add(g.name); break; }
        for(let i = 1; i < part.length; i++){
          const qx = (part[i][0] - lng) * kx, qy = (part[i][1] - lat) * ky, vx = qx - px, vy = qy - py, len2 = vx * vx + vy * vy;
          const t = len2 ? Math.max(0, Math.min(1, -(px * vx + py * vy) / len2)) : 0, cx = px + t * vx, cy = py + t * vy;
          if(cx * cx + cy * cy <= r2){ hit.add(g.name); break outer; }
          px = qx; py = qy;
        }
      }
    }
    return hit;
  }
  const pinIcon = L.divIcon({ className: 'lb-pin', iconSize: [30, 40], iconAnchor: [15, 38], html: `<svg viewBox="0 0 30 40" width="30" height="40"><path d="M15 1C7.3 1 1.5 6.9 1.5 14.4 1.5 24.6 15 38 15 38s13.5-13.4 13.5-23.6C28.5 6.9 22.7 1 15 1z" fill="#dc2626" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14.5" r="5" fill="#fff"/></svg>` });
  let pinMarker = null, pinCircle = null, pinTimer = 0;
  const pinBox = document.getElementById('nmPin');
  function syncPinBox(){
    const b = document.querySelector('#nmLayers [data-lyr="pin"]');
    if(b){ b.classList.toggle('on', st.pinOn); b.setAttribute('aria-pressed', String(st.pinOn)); }
    pinBox.hidden = !st.pinOn;
    document.getElementById('netmap').classList.toggle('pin-arm', st.pinOn && !st.pin);
    document.getElementById('nmPinClear').hidden = !st.pin;
    document.getElementById('nmPinRv').textContent = fmtKm(st.pinR);
    const sum = document.getElementById('nmPinSum'), ops = document.getElementById('nmPinOps'), list = document.getElementById('nmPinRoutes');
    if(!st.pin){ sum.textContent = 'Click the map to drop a pin, or choose a garage and pick “Catchment from this garage”.'; ops.innerHTML = ''; list.innerHTML = ''; return; }
    const names = [...(st.pinIds ?? [])].sort(cmpRoute);
    const byOp = {}; for(const n of names){ const o = meta?.[n]?.operator ?? meta?.[Object.keys(meta ?? {}).find(k => k.toUpperCase() === n) ?? '']?.operator ?? 'Unknown'; byOp[o] = (byOp[o] ?? 0) + 1; }
    const opsSorted = Object.entries(byOp).sort((a, b) => b[1] - a[1]);
    sum.innerHTML = `<b>${nOf(names.length, 'route')}</b> within ${fmtKm(st.pinR)} · ${nOf(opsSorted.length, 'operator')}`;
    ops.innerHTML = opsSorted.map(([o, n]) => `<span class="nm-chip"><span class="nm-dot" style="background:${opColor(o)}"></span>${esc(o.replace(' London', '').replace(' Bus', ''))} <b>${n}</b></span>`).join('');
    list.innerHTML = names.map(n => `<a class="rnum ${esc(typeInfo.get(n) ?? 'regular')}" href="#/route/${encodeURIComponent(n)}" title="Open route ${esc(n)}">${esc(n)}</a>`).join('');
  }
  function recomputePin(){
    if(!st.pin){ st.pinIds = null; }
    else st.pinIds = catchment(st.pin.lat, st.pin.lng, st.pinR);
    syncPinBox(); repaint();
  }
  function drawPin(){
    if(!st.pin){ if(pinMarker){ state.map.removeLayer(pinMarker); pinMarker = null; } if(pinCircle){ state.map.removeLayer(pinCircle); pinCircle = null; } return; }
    const ll = [st.pin.lat, st.pin.lng];
    if(!pinCircle) pinCircle = L.circle(ll, { radius: st.pinR, color: '#dc2626', weight: 1.5, opacity: .8, fillColor: '#dc2626', fillOpacity: .08, interactive: false }).addTo(state.map);
    else { pinCircle.setLatLng(ll); pinCircle.setRadius(st.pinR); }
    if(!pinMarker){
      pinMarker = L.marker(ll, { icon: pinIcon, draggable: true, zIndexOffset: 1000, keyboard: false }).bindTooltip('Drag to move · the panel lists every route within the circle', { direction: 'top', offset: [0, -36] }).addTo(state.map);
      pinMarker.on('drag', e => { const p = e.target.getLatLng(); st.pin = { lat: p.lat, lng: p.lng }; pinCircle?.setLatLng(p); clearTimeout(pinTimer); pinTimer = setTimeout(recomputePin, 120); });
      pinMarker.on('dragend', () => { clearTimeout(pinTimer); recomputePin(); });
    } else pinMarker.setLatLng(ll);
  }
  function setPin(lat, lng){
    st.pin = { lat, lng }; drawPin(); recomputePin();
    // Phones: the panel is a short sheet over the map, so bring the results into view and keep the pin visible.
    if(innerWidth < 760){ pinBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); const panel = document.getElementById('nmPanel'), pt = state.map.latLngToContainerPoint([lat, lng]); if(pt.y < panel.offsetTop + panel.offsetHeight + 24) state.map.panBy([0, pt.y - (panel.offsetTop + panel.offsetHeight + 90)], { animate: true }); }
  }
  function pinArm(){ st.pinOn = true; syncPinBox(); setLyNote('pin', st.pin ? '' : 'Click anywhere on the map to drop the catchment pin. Drag it to move it; the slider sets the radius.'); if(st.pin){ drawPin(); recomputePin(); } }
  function pinOff(){ st.pinOn = false; st.pin = null; st.pinIds = null; drawPin(); setLyNote('pin', ''); syncPinBox(); repaint(); }
  state.map.on('click', e => { if(!st.pinOn) return; setLyNote('pin', ''); setPin(e.latlng.lat, e.latlng.lng); });
  document.getElementById('nmPinR').addEventListener('input', e => { st.pinR = Number(e.target.value) || 1500; document.getElementById('nmPinRv').textContent = fmtKm(st.pinR); pinCircle?.setRadius(st.pinR); clearTimeout(pinTimer); pinTimer = setTimeout(recomputePin, 80); });
  document.getElementById('nmPinClear').addEventListener('click', () => { st.pin = null; st.pinIds = null; drawPin(); syncPinBox(); repaint(); setLyNote('pin', 'Click anywhere on the map to drop the catchment pin.'); });
  document.getElementById('netmap').addEventListener('click', e => {
    const b = e.target.closest('[data-pinat]'); if(!b) return;
    const [lat, lng] = b.dataset.pinat.split(',').map(Number); if(!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    state.map.closePopup(); if(!st.pinOn){ st.pinOn = true; syncPinBox(); } setLyNote('pin', ''); setPin(lat, lng);
  });
  if(st.pinOn){ syncPinBox(); if(st.pin){ drawPin(); recomputePin(); state.map.setView([st.pin.lat, st.pin.lng], 13); } }

  syncPop();
  syncFocus(st.pills.length > 0);
  syncLayer('garages');
  {
    const sEl = document.getElementById('nmScope');
    if(st.scopeTitle && sEl){ sEl.hidden = false; sEl.innerHTML = `${esc(st.scopeTitle)} <span>· ${plural(st.scopeIds?.size ?? st.pills.length, 'route')}</span>`; }
  }

  /* ── search: typeahead — nothing is added until the user picks ── */
  const nmq = document.getElementById('nmq');
  const suggBox = document.getElementById('nmSugg');
  const qClear = document.getElementById('nmqClear');
  const routeList = [...routes].sort((a,b) => cmpRoute(a.name, b.name))
    .map(r => ({ name:r.name, up:r.name.toUpperCase(), type:r.type, op: meta?.[r.name]?.operator ?? '' }));
  let sugg = [], suggIdx = -1;
  function hideSugg(){ suggBox.hidden = true; suggBox.innerHTML = ''; sugg = []; suggIdx = -1; }
  function syncSugg(){
    const v = nmq.value.trim().toUpperCase();
    qClear.hidden = !nmq.value;
    if(!v) return hideSugg();
    const pre = [], inc = [];
    for(const r of routeList){
      if(st.pills.includes(r.up)) continue;
      if(r.up.startsWith(v)) pre.push(r);
      else if(r.up.includes(v)) inc.push(r);
    }
    sugg = [...pre, ...inc].slice(0, 8);
    suggIdx = sugg.length ? 0 : -1;
    suggBox.hidden = false;
    suggBox.innerHTML = sugg.length
      ? sugg.map((r,i) => `<button class="nm-sug${i===suggIdx?' act':''}" data-add="${esc(r.up)}">
          <span class="rnum ${esc(r.type)}">${esc(r.name)}</span>
          <span class="op">${esc((r.op || '').replace(' London',''))}</span>
          <span class="ty">${esc(TYPE_LABEL[r.type] ?? '')}</span></button>`).join('')
      : `<div class="nm-nores">No route matches “${esc(nmq.value.trim())}”.</div>`;
  }
  function commit(name){ addFocus(name); nmq.value = ''; qClear.hidden = true; hideSugg(); nmq.focus(); }
  const upsSet = new Set(routeList.map(r => r.up));
  /* Comma-separated multi-select: "150,175" adds each exact match as it
     completes (typed or pasted); tokens that match nothing stay in the box. */
  function takeTokens(all){
    const parts = nmq.value.split(/[,;]+/);
    const last = all ? '' : (parts.pop() ?? '');
    const keep = [];
    for(const p of parts){
      const t = p.trim().toUpperCase();
      if(!t) continue;
      if(upsSet.has(t)){ if(!st.pills.includes(t)) addFocus(t); }
      else keep.push(p.trim());
    }
    nmq.value = [...keep, last.trimStart()].filter(Boolean).join(', ');
  }
  nmq.addEventListener('input', () => { if(/[,;]/.test(nmq.value)) takeTokens(false); syncSugg(); });
  nmq.addEventListener('keydown', e => {
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      if(!sugg.length) return;
      e.preventDefault();
      suggIdx = (suggIdx + (e.key === 'ArrowDown' ? 1 : -1) + sugg.length) % sugg.length;
      [...suggBox.querySelectorAll('.nm-sug')].forEach((b,i) => b.classList.toggle('act', i === suggIdx));
      suggBox.querySelector('.nm-sug.act')?.scrollIntoView({ block:'nearest' });
    } else if(e.key === 'Enter'){
      if(/[,;]/.test(nmq.value)){ takeTokens(true); syncSugg(); return; }
      const v = nmq.value.trim().toUpperCase();
      const pick = sugg.find(r => r.up === v) ?? sugg[suggIdx] ?? sugg[0];
      if(pick) commit(pick.up);
      else if(v && st.pills.includes(v)){ nmq.value = ''; qClear.hidden = true; hideSugg(); }
    } else if(e.key === 'Escape'){ nmq.value = ''; qClear.hidden = true; hideSugg(); }
  });
  suggBox.addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if(b) commit(b.dataset.add);
  });
  qClear.addEventListener('click', () => { nmq.value = ''; qClear.hidden = true; hideSugg(); nmq.focus(); });
  document.getElementById('netmap').addEventListener('pointerdown', hideSugg);

  /* ── wiring ── */
  document.getElementById('nmFilters').addEventListener('click', () => { st.panelOpen = !st.panelOpen; syncPop(); });
  pop.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if(chip){
      const set = st.f[chip.dataset.f];
      set.has(chip.dataset.v) ? set.delete(chip.dataset.v) : set.add(chip.dataset.v);
      syncPop(); repaint();
      return;
    }
    if(e.target.closest('#nmFClear')){ st.f.type.clear(); st.f.prop.clear(); st.f.deck.clear(); st.f.freq.clear(); st.f.op.clear(); syncPop(); repaint(); }
    if(e.target.closest('#nmFDone')){ st.panelOpen = false; syncPop(); }
  });
  document.querySelector('.nm-tools .seg').addEventListener('click', e => {
    const b = e.target.closest('button[data-cb]'); if(!b) return;
    st.colorBy = b.dataset.cb;
    document.querySelectorAll('.nm-tools .seg button').forEach(x => x.classList.toggle('on', x === b));
    repaint();
  });
  // Export EVERY route's full record — deliberately ignores the active
  // search pills and filters (the CSV is the whole network, always).
  document.getElementById('nmExport').addEventListener('click', () => {
    const num = v => (Number.isFinite(v) ? v : '');
    downloadCsv('london-bus-routes.csv', [
      ['route','type','operator','company','garage_code','garage_name','pvr','tvr','vehicle_model','propulsion','length_km','contract_start','contract_end'],
      ...(routes ?? []).map(r => {
        const m = meta?.[r.name] ?? {};
        return [r.name, m.type ?? r.type ?? '', m.operator ?? '', m.company ?? '', m.garage ?? '', m.garageName ?? '',
          num(m.pvr), num(m.tvr), m.fleet ?? '', m.propulsion ?? '', num(m.lengthKm), m.contractStart ?? '', m.contractEnd ?? ''];
      }),
    ]);
  });
  document.getElementById('nmReset').addEventListener('click', () => {
    if(st.pinOn) pinOff();
    st.pills = []; st.f.type.clear(); st.f.prop.clear(); st.f.deck.clear(); st.f.freq.clear(); st.f.op.clear();
    nmq.value = ''; qClear.hidden = true; hideSugg();
    syncPop(); syncFocus(false);
    state.map.setView([51.505,-0.118], 11);
  });
  /* one delegated remove handler for the focused-route cards */
  document.getElementById('nmPanel').addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if(rm) removeFocus(rm.dataset.rm);
  });
}
