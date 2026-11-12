/* Actions — re-render everything, change operator/garage scope, URL hash sync, CSV export. */
import { D } from '../data.js';
import { $ } from '../dom.js';
import { closeRoute } from '../drawer/drawer.js';
import { mapClose } from '../map/route-map.js';
import { S, SC } from '../state.js';
import { ALL, OPS } from '../tokens.js';
import { menuRender } from './menus.js';
import { renderCompetition } from '../views/competition.js';
import { renderElectrify } from '../views/electrify.js';
import { renderFeed } from '../views/feed.js';
import { renderCards } from '../views/fleet.js';
import { renderHealth } from '../views/health.js';
import { renderOccupancy } from '../views/occupancy.js';
import { renderQic } from '../views/qic.js';
import { renderRadar } from '../views/radar.js';
import { renderRevenue } from '../views/revenue.js';
import { renderHero } from '../views/hero.js';
import { renderMarket } from '../views/market.js';
import { renderRenewals } from '../views/renewals.js';
import { filtered, renderTable } from '../views/routes-table.js';
import { renderRunway } from '../views/runway.js';

/* ── wiring ──────────────────────────────────────────────────────────────── */
export function renderAll(){
  renderHero(); renderFeed(); renderMarket(); renderRunway(); renderRevenue(); renderCompetition(); renderRadar(); renderOccupancy(); renderRenewals(); renderCards(); renderElectrify(); renderQic(); renderTable(); renderHealth(); menuRender();
  $('#opBtn').setAttribute('aria-expanded', 'false'); $('#opMenu').hidden = true; $('#gMenu').hidden = true; $('#gBtn').setAttribute('aria-expanded', 'false');
}
export function setGarage(code){ mapClose(); if(code){ const g = D.garageScope(code); if(!g) return; S.garage = code; S.op = g.op; } else S.garage = null; S.q = ''; S.prop = 'all'; S.flags.clear(); S.year = null; S.shown = 30; S.rnQ = null; S.rnShown = 25; S.rnFilter = 'open'; S.radarAll = false; closeRoute(); renderAll(); syncHash(); window.scrollTo({ top:0 }); }
export function setOp(o){ mapClose(); S.op = o; S.garage = null; S.q = ''; S.prop = 'all'; S.flags.clear(); S.year = null; S.shown = 30; S.radarAll = false; closeRoute(); renderAll(); syncHash(); window.scrollTo({ top:0 }); }
export function syncHash(){
  const h = '#op=' + encodeURIComponent(S.op) + (S.garage ? '&garage=' + encodeURIComponent(S.garage) : '') + (S.route ? '&route=' + encodeURIComponent(S.route) : '');
  if(location.hash !== h) history.replaceState(null, '', h);
}
export function fromHash(){
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  if(OPS.includes(p.get('op')) || p.get('op') === ALL) S.op = p.get('op');
  S.garage = null; const gc = p.get('garage'); if(gc && D.garageScope(gc)){ S.garage = gc; S.op = D.garageScope(gc).op; }
  return p.get('route');
}
export function csv(){
  const q = v => { let s = String(v ?? ''); if(/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['route','from','to','garage','pvr','propulsion','fleet_age_years','gbp_per_mile','operated_pct','contract_end','tender_status'],
    ...filtered().map(r => [r.id, r.from, r.to, r.garageName, r.pvr, r.prop, r.age ?? '', r.cpm ?? '', r.opPct ?? '', r.cEnd ?? '', r.pipe ? 'programme: tender ' + r.pipe.issueDate : r.award ? 'awarded ' + r.award.awardDate : ''])];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(q).join(',')).join('\r\n')], { type:'text/csv' }));
  a.download = `${SC().name.toLowerCase().replace(/\W+/g, '-')}-routes.csv`; document.body.append(a); a.click(); a.remove();
}
