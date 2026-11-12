/* Data health — every served dataset's age against how often it should move, behind the "Data as of" chip. */
import { D } from '../data.js';
import { $, esc } from '../dom.js';

/* expected refresh, in hours (null = a seeded snapshot that does not refresh) */
const CADENCE = { 'line-status':6, 'route-diversions':6, 'diversion-history':6, roadworks:6, 'roadworks-history':6, dtro:6, 'streetworks-history':6, fleet:12, vehicles:12, routes:24 * 7, 'route-meta':24 * 7, 'route-stops':24 * 7, 'routes-overview':24 * 60, 'route-bboxes':24 * 60, garages:24 * 14, 'scheduled-mileage':24 * 14, tenders:24 * 14, 'tender-programme':24 * 45, 'cpi-cpa':24 * 40, 'route-performance':24 * 45, accidents:null, bridges:null, crowding:null, 'crowding-profile':null };
const LABEL = { 'line-status':'Service status', 'route-diversions':'Diversions', 'diversion-history':'Diversion history', roadworks:'Roadworks (TIMS)', 'roadworks-history':'Roadworks history', dtro:'Traffic orders', 'streetworks-history':'Street works', fleet:'Fleet sightings', vehicles:'Vehicle register', routes:'Routes', 'route-meta':'Route details', 'route-stops':'Stops', 'routes-overview':'Geometry', 'route-bboxes':'Route extents', garages:'Garages', 'scheduled-mileage':'Scheduled mileage', tenders:'Tender awards', 'tender-programme':'Tendering programme', 'cpi-cpa':'CPI / CPA', 'route-performance':'Route performance', accidents:'Collisions', bridges:'Low bridges', crowding:'Crowding', 'crowding-profile':'Crowding profile' };

export function health(){
  const ds = D.manifest?.datasets ?? {}, now = Date.now(), rows = [];
  for(const [k, v] of Object.entries(ds)){
    const at = v?.fetchedAt ?? v?.generatedAt; if(!at) continue;
    const h = (now - Date.parse(at)) / 36e5, exp = CADENCE[k];
    const status = exp === null ? 'static' : !Number.isFinite(h) ? 'unknown' : h <= exp * 1.5 ? 'fresh' : h <= exp * 4 ? 'late' : 'stale';
    rows.push({ k, label:LABEL[k] ?? k, at, h, exp, status });
  }
  const order = { stale:0, late:1, fresh:2, static:3, unknown:4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label));
  const worst = rows.some(r => r.status === 'stale') ? 'stale' : rows.some(r => r.status === 'late') ? 'late' : 'fresh';
  return { rows, worst };
}
const age = h => h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h ago` : `${Math.round(h / 24)} days ago`;
export function renderHealth(){
  const { rows, worst } = health(), chip = $('#fresh');
  if(chip){ chip.classList.toggle('late', worst === 'late'); chip.classList.toggle('stale', worst === 'stale'); chip.title = worst === 'fresh' ? 'All datasets refreshed on time — click for details' : worst === 'late' ? 'Some datasets are behind their usual refresh — click for details' : 'Some datasets have not refreshed for a long time — click for details'; chip.style.cursor = 'pointer'; }
  const body = $('#healthBody'); if(!body) return;
  body.innerHTML = `<h2>Data health</h2><p style="margin:0 0 12px;color:var(--ink-2)">How old each dataset is against how often it should move. Late means behind its usual refresh; stale means several refreshes missed.</p>
    <table class="dt"><thead><tr><th>Dataset</th><th>Last refreshed</th><th>Usually every</th><th>Status</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(age(r.h))}</td><td>${r.exp === null ? 'seeded snapshot' : r.exp < 48 ? r.exp + ' h' : Math.round(r.exp / 24) + ' days'}</td><td><span class="hs ${r.status}">${r.status === 'static' ? 'snapshot' : r.status}</span></td></tr>`).join('')}</tbody></table>
    <div style="margin-top:14px;display:flex;justify-content:flex-end"><button class="btn primary" id="healthClose">Close</button></div>`;
}
