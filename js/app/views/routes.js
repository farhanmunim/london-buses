/* View: Routes (home) — searchable, filterable route list. */
import { D } from '../core/data.js';
import { gone, routesViewState, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { bindOpFilter, cmpRoute, esc, opFilterHtml, PROPULSION, title, TYPE_LABEL } from '../core/utils.js';

/* ════════════════════ ROUTES (home) ════════════════════ */
export async function renderRoutes(){
  const tok = state.navToken;
  main.innerHTML = `
    <h1 class="sr-only">London bus routes</h1>
    <div class="searchwrap">
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/></svg>
        <input id="q" aria-label="Search routes" placeholder="Search a route, e.g. 25 or N73" autocomplete="off" inputmode="search" value="${esc(routesViewState.q)}" />
        <button class="clear" id="qClear" aria-label="Clear search" ${routesViewState.q?'':'hidden'}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 2px 0" id="ropRow"></div>
      <div class="chips" id="chips"></div>
    </div>
    <div class="count-note" id="countNote"></div>
    <div class="rlist" id="rlist">${'<div class="skel" style="height:56px"></div>'.repeat(8)}</div>`;

  const [routes, meta, lineStatus] = await Promise.all([D.routes(), D.meta(), D.lineStatus()]);
  if(gone(tok)) return;
  if(!routes){ document.getElementById('rlist').innerHTML = '<div class="empty">The route data is unreachable right now — try again shortly.</div>'; return; }
  const disrupted = new Set((lineStatus?.rows ?? []).filter(r => r.severity !== 10).map(r => r.route));

  const ops = [...new Set(Object.values(meta).map(m => m?.operator).filter(Boolean))].sort();

  function chipsHtml(){
    const st = routesViewState;
    const c = [];
    for(const [key,label] of Object.entries(TYPE_LABEL))
      c.push(`<button class="chip ${st.type===key?'on':''}" data-f="type" data-v="${key}">${label}</button>`);
    for(const p of PROPULSION)
      c.push(`<button class="chip ${st.prop===p?'on':''}" data-f="prop" data-v="${p}">${title(p)}</button>`);
    for(const [d,l] of [['double','Double deck'],['single','Single deck']])
      c.push(`<button class="chip ${st.deck===d?'on':''}" data-f="deck" data-v="${d}">${l}</button>`);
    for(const [fq,l] of [['high','High frequency'],['low','Low frequency']])
      c.push(`<button class="chip ${st.freq===fq?'on':''}" data-f="freq" data-v="${fq}">${l}</button>`);
    for(const o of ops)
      c.push(`<button class="chip ${st.op===o?'on':''}" data-f="op" data-v="${esc(o)}">${esc(o.replace(' London',''))}</button>`);
    return c.join('');
  }

  function rowsHtml(){
    const st = routesViewState;
    const q = st.q.trim().toUpperCase();
    let list = routes.filter(r => {
      const m = meta[r.name] ?? {};
      if(q && !r.name.toUpperCase().startsWith(q)) return false;
      if(st.type && r.type !== st.type) return false;
      if(st.op && m.operator !== st.op) return false;
      if(st.prop && m.propulsion !== st.prop) return false;
      if(st.deck && m.deck !== st.deck) return false;
      if(st.freq && m.frequency !== st.freq) return false;
      return true;
    }).sort((a,b) => cmpRoute(a.name, b.name));
    const cn = document.getElementById('countNote');
    if(!cn) return '';   // debounced rerender fired after navigating away
    cn.textContent =
      `${list.length} route${list.length===1?'':'s'}${q||st.type||st.op||st.prop||st.deck||st.freq ? ' match' : ''}`;
    if(!list.length) return '<div class="empty">No routes match.</div>';
    return list.map(r => {
      const m = meta[r.name] ?? {};
      const ga = [m.garageName, m.garage ? `(${m.garage})` : null].filter(Boolean).join(' ');
      return `<a class="rrow" href="#/route/${encodeURIComponent(r.name)}">
        <span class="rnum ${esc(r.type)}">${esc(r.name)}</span>
        <span class="rmeta">
          <span class="op">${esc(m.operator ?? '—')}
            ${m.propulsion ? `<span class="rtag ${m.propulsion}">${esc(m.propulsion)}</span>` : ''}
            ${r.type !== 'regular' ? `<span class="rtag">${esc(TYPE_LABEL[r.type] ?? r.type)}</span>` : ''}
          </span>
          <span class="ga">${esc(ga || '—')}</span>
        </span>
        <span class="pvr">${disrupted.has(r.name) ? '<span class="warn-dot" title="Disruption reported"></span>' : ''}<b>${m.pvr ?? '—'}</b>PVR</span>
      </a>`;
    }).join('');
  }

  const chips = document.getElementById('chips');
  const rlist = document.getElementById('rlist');
  const rerender = () => { rlist.innerHTML = rowsHtml(); };
  chips.innerHTML = chipsHtml();
  document.getElementById('ropRow').innerHTML = opFilterHtml('rop', ops, routesViewState.op ?? '');
  rerender();
  bindOpFilter('rop', v => { routesViewState.op = v || null; chips.innerHTML = chipsHtml(); rerender(); });

  chips.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if(!b) return;
    const f = b.dataset.f, v = b.dataset.v;
    routesViewState[f] = routesViewState[f] === v ? null : v;
    if(f === 'op'){   // keep the operator select + its ✕ in step with the chip
      const s = document.getElementById('rop'), c = document.getElementById('ropClear');
      if(s){ s.value = routesViewState.op ?? ''; c.hidden = !routesViewState.op; }
    }
    chips.innerHTML = chipsHtml();
    rerender();
  });
  const q = document.getElementById('q'), qClear = document.getElementById('qClear');
  let qT = null;   // short debounce — rebuilding ~700 rows per keystroke janks mobile
  q.addEventListener('input', () => {
    routesViewState.q = q.value;
    qClear.hidden = !q.value;
    clearTimeout(qT); qT = setTimeout(rerender, 90);
  });
  qClear.addEventListener('click', () => { q.value=''; routesViewState.q=''; qClear.hidden=true; rerender(); q.focus(); });
}
