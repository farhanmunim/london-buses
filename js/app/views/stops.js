/* View: Stops — search and live arrivals. */
import { D, nextPollS, stopRegistry } from '../core/data.js';
import { addLiveTimer, gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { bindOpFilter, cmpRoute, esc, haversineM, opFilterHtml, title } from '../core/utils.js';

/* ════════════════════ STOPS — search + live arrivals ════════════════════ */
const stopsViewState = { q:'', op:'' };
const fmtDist = m => m < 950 ? `${Math.round(m/10)*10} m` : `${(m/1000).toFixed(1)} km`;

export async function renderStops(){
  const tok = state.navToken;
  main.innerHTML = `
    <h1 class="h1">Bus stops</h1><div class="sub">Find any stop and see live arrival times.</div>
    <div class="searchwrap">
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/></svg>
        <input id="sq" aria-label="Search stops" placeholder="Search a stop, e.g. Angel Station" autocomplete="off" value="${esc(stopsViewState.q)}" />
        <button class="clear" id="sqClear" aria-label="Clear search" ${stopsViewState.q?'':'hidden'}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        <button class="livebtn" id="nearBtn" style="margin:0;flex:none"><span class="spin"></span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>Near me</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 2px 0" id="sopRow"></div>
    </div>
    <div class="count-note" id="sCount"></div>
    <div class="glist" id="slist"><div class="empty" id="sHint">Loading the stop directory…</div></div>`;
  const [reg, meta] = await Promise.all([stopRegistry(), D.meta()]);
  if(gone(tok)) return;
  if(!reg?.size){ const l=document.getElementById('slist'); if(l) l.innerHTML = '<div class="empty">The data is unreachable right now.</div>'; return; }
  const all = [...reg.values()];
  /* route → operator, built once, lazily — one Map lookup per line keeps the
     ~20k-stop join cheap. A stop matches when ANY route serving it is run by
     the selected operator. */
  const sOps = [...new Set(Object.values(meta ?? {}).map(m => m?.operator).filter(Boolean))].sort();
  let opByRoute = null;
  const lineOp = l => {
    if(!opByRoute){
      opByRoute = new Map();
      for(const [r, mm] of Object.entries(meta ?? {})) if(mm?.operator) opByRoute.set(String(r).toUpperCase(), mm.operator);
    }
    return opByRoute.get(String(l).toUpperCase()) ?? null;
  };
  const servedBy = (s, op) => { for(const l of s.lines) if(lineOp(l) === op) return true; return false; };
  document.getElementById('sopRow').innerHTML = opFilterHtml('sop', sOps, stopsViewState.op);

  const rowHtml = (s, dist) => `
    <a class="grow" href="#/stop/${encodeURIComponent(s.id)}">
      <span class="avatar" style="background:var(--acc);border-radius:50%;width:32px;height:32px;font-size:${s.letter?'13px;font-weight:800':'10px'}">${esc(s.letter ?? [...s.lines].length)}</span>
      <span class="g-nm"><b>${esc(s.name)}</b><span>${[...s.lines].sort(cmpRoute).slice(0,8).map(esc).join(' · ')}${s.lines.size>8?' …':''}</span></span>
      ${dist != null ? `<span class="g-pvr"><b style="font-size:12.5px">${fmtDist(dist)}</b>away</span>` : ''}
    </a>`;

  const rerender = () => {
    const q = stopsViewState.q.trim().toLowerCase();
    const op = stopsViewState.op;
    const cEl = document.getElementById('sCount'), lEl = document.getElementById('slist');
    if(!cEl || !lEl) return;
    if(q.length < 2 && !op){
      cEl.textContent = `${all.length.toLocaleString('en-GB')} stops on the network`;
      lEl.innerHTML = '<div class="empty">Type at least two characters, or use “Near me”.</div>';
      return;
    }
    const matched = all.filter(s => (q.length < 2 || s.name?.toLowerCase().includes(q)) && (!op || servedBy(s, op)));
    const list = matched.slice(0, 60);
    cEl.textContent = `${matched.length.toLocaleString('en-GB')} stop${matched.length===1?'':'s'} match${list.length < matched.length ? ` · first ${list.length} shown` : ''}`;
    lEl.innerHTML = list.map(s => rowHtml(s)).join('') || '<div class="empty">No stops match.</div>';
  };
  rerender();
  bindOpFilter('sop', v => { stopsViewState.op = v; rerender(); });
  const sq = document.getElementById('sq'), sqClear = document.getElementById('sqClear');
  let sqT = null;   // ~20k stop names per keystroke — debounce the rebuild
  sq.addEventListener('input', () => { stopsViewState.q = sq.value; sqClear.hidden = !sq.value; clearTimeout(sqT); sqT = setTimeout(rerender, 90); });
  sqClear.addEventListener('click', () => { sq.value=''; stopsViewState.q=''; sqClear.hidden=true; rerender(); sq.focus(); });

  /* Near me — device location → closest stops, sorted by distance */
  const nearBtn = document.getElementById('nearBtn');
  nearBtn.addEventListener('click', () => {
    const cEl = document.getElementById('sCount'), lEl = document.getElementById('slist');
    if(!navigator.geolocation){ cEl.textContent = 'Location is not available in this browser.'; return; }
    nearBtn.classList.add('loading','on');
    navigator.geolocation.getCurrentPosition(pos => {
      nearBtn.classList.remove('loading');
      const { latitude:lat, longitude:lng } = pos.coords;
      const nearest = all
        .map(s => ({ s, d: haversineM(lat, lng, s.lat, s.lng) }))
        .sort((a,b) => a.d - b.d)
        .slice(0, 15);
      if(!cEl || !lEl) return;
      if(!nearest.length || nearest[0].d > 30000){
        cEl.textContent = 'You seem to be outside the TfL network.';
        lEl.innerHTML = '<div class="empty">No London bus stops nearby.</div>';
        return;
      }
      stopsViewState.q = ''; const qEl = document.getElementById('sq'); if(qEl) qEl.value = '';
      cEl.textContent = 'Closest stops to you';
      lEl.innerHTML = nearest.map(({s,d}) => rowHtml(s, d)).join('');
    }, err => {
      nearBtn.classList.remove('loading','on');
      const cEl2 = document.getElementById('sCount');
      if(cEl2) cEl2.textContent = err.code === 1
        ? 'Location permission was declined — search by name instead.'
        : 'Couldn’t get your location — try again or search by name.';
    }, { enableHighAccuracy:false, timeout:10000, maximumAge:60000 });
  });
}

export async function renderStopDetail(id){
  const tok = state.navToken;
  main.innerHTML = `<a class="backrow" href="#/stops">‹ Stop search</a><div class="skel" style="height:120px"></div>`;
  const reg = await stopRegistry();
  if(gone(tok)) return;
  const s = reg?.get(id);
  main.innerHTML = `
    <a class="backrow" href="#/stops">‹ Stop search</a>
    <div class="dhead">
      <span class="avatar" style="width:46px;height:46px;border-radius:50%;font-size:13px;background:var(--acc)">
        ${s?.letter ? `<b style="font-size:17px;font-weight:800;color:#fff">${esc(s.letter)}</b>`
          : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.4" fill="#fff" stroke="none"/></svg>'}
      </span>
      <div class="dtitle"><h1>${esc(s?.name ?? 'Bus stop')}</h1>
      <div class="sub2"><span class="livechip"><i class="pulse"></i>LIVE</span> · <span id="nextUpd">updating…</span></div></div>
    </div>
    ${s?.lines?.size ? `<div class="section"><div class="section-h">Routes serving this stop</div>
      <div class="card"><div class="chiprow">${[...s.lines].sort(cmpRoute).map(l => `<a class="rchip" href="#/route/${encodeURIComponent(l)}">${esc(l)}</a>`).join('')}</div></div></div>` : ''}
    <div class="section"><div class="section-h">Next buses</div>
      <div class="card"><div class="kv" id="arrBoard"><div class="kv-empty">Loading arrivals…</div></div></div>
      <div class="legendrow" style="margin-top:7px"><span>Predictions count down live and re-sync every 30 s.</span></div>
    </div>`;

  /* Live board: predictions carry an absolute due time, so the display
     counts down every second between the 30 s re-syncs — like the dot-matrix
     board at the stop itself. */
  const board = () => document.getElementById('arrBoard');
  let lastGoodAt = 0;
  const dueText = ms => ms <= 30000 ? 'Due' : `${Math.round(ms/60000)} min`;
  let nextIn = 0;
  async function poll(){
    const raw = await D.arrivals(id);
    if(gone(tok)) return;   // another stop board may own #arrBoard by now
    nextIn = raw ? nextPollS(raw, 30) : 8;     // failed fetch → quick quiet retry
    const el = board(); if(!el) return;   // navigated away
    // A transient failure must not wipe a good board: dues are absolute
    // timestamps, so the last data keeps counting down while we reconnect.
    if(!raw && lastGoodAt && Date.now() - lastGoodAt < 180000){
      const n = document.getElementById('nextUpd');
      if(n) n.textContent = 'reconnecting…';
      return;
    }
    const t0 = Date.now();
    const rows = (raw?.data ?? [])
      .filter(a => Number.isFinite(a.timeToStation))
      .map(a => ({ ...a, dueAt: Number.isFinite(Date.parse(a.expectedArrival)) ? Date.parse(a.expectedArrival) : t0 + a.timeToStation*1000 }))
      .sort((a,b) => a.dueAt - b.dueAt)
      .slice(0, 12);
    if(raw) lastGoodAt = Date.now();
    if(!rows.length){
      if(!s){
        // Not in the stop directory AND nothing predicted: this id is not a
        // stop we can show — say so instead of rendering a ghost live board.
        main.innerHTML = `<a class="backrow" href="#/stops">‹ Stop search</a><div class="empty">${raw || reg
          ? `Stop “${esc(id)}” isn’t in the stop directory.`
          : 'The stop directory is unreachable right now — try again shortly.'}</div>`;
        return;
      }
      el.innerHTML = `<div class="kv-empty">${raw
        ? 'No buses predicted right now — the stop may not be served at this time of day.'
        : 'Live arrivals are unreachable right now — retrying shortly.'}</div>`;
      return;
    }
    // TfL Countdown's platformName is the stop-flag letter ("A") — surface it
    // in the header roundel once known (route-stops doesn't carry it yet).
    const letter = rows.map(a => a.platformName).find(p => p && String(p).trim().length <= 3);
    if(letter){
      const av = document.querySelector('.dhead .avatar');
      if(av && av.textContent.trim() !== String(letter).trim())
        av.innerHTML = `<b style="font-size:16px;font-weight:800;color:#fff">${esc(String(letter).trim())}</b>`;
    }
    el.innerHTML = rows.map(a => {
      const vHref = a.vehicleId
        ? `#/vehicle/${encodeURIComponent(String(a.vehicleId).toUpperCase())}?stop=${encodeURIComponent(id)}&line=${encodeURIComponent(a.lineName ?? '')}`
        : null;
      const sub = [a.currentLocation ? `<span>${esc(a.currentLocation)}</span>` : '',
        vHref ? `<a class="plate" href="${vHref}">${esc(String(a.vehicleId).toUpperCase())}</a>` : '']
        .filter(Boolean).join(' ');
      return `<div>
        <span class="k" style="display:flex;align-items:center;gap:9px;color:var(--tx)">
          <a class="rnum" style="min-width:40px;height:26px;font-size:12.5px;border-radius:7px" href="#/route/${encodeURIComponent(a.lineName)}">${esc(a.lineName)}</a>
          <span style="min-width:0"><b style="font-weight:600">${esc(title(a.destinationName ?? ''))}</b>
          ${sub ? `<span style="display:flex;align-items:center;gap:6px;margin-top:2px;font-size:11.5px;color:var(--mu);flex-wrap:wrap">${sub}</span>` : ''}</span>
        </span>
        <span class="v mono" data-due="${a.dueAt}" style="align-self:center;white-space:nowrap"></span>
      </div>`;
    }).join('');
    paintDues();
  }
  function paintDues(){
    const el = board(); if(!el) return;
    const now = Date.now();
    el.querySelectorAll('[data-due]').forEach(cell => {
      const ms = (+cell.dataset.due) - now;
      cell.textContent = ms < -90000 ? 'Departed' : dueText(Math.max(0, ms));
      cell.style.color = ms <= 30000 ? 'var(--good)' : 'var(--tx)';
    });
  }
  function tick(){
    if(!board()) return;
    paintDues();
    nextIn -= 1;
    const n = document.getElementById('nextUpd');
    if(n && n.textContent !== 'reconnecting…') n.textContent = nextIn > 0 ? `next update in ${nextIn} s` : 'updating…';
    if(n && nextIn <= 0) n.textContent = 'updating…';
    if(nextIn <= 0){ nextIn = 999; poll(); }   // poll re-anchors nextIn to the feed
  }
  poll(); nextIn = 30;
  const n0 = document.getElementById('nextUpd'); if(n0) n0.textContent = 'next update in 30 s';
  addLiveTimer(setInterval(tick, 1000));
}
