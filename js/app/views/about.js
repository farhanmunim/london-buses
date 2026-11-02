/* View: About — what the site is, attribution, and live dataset freshness. */
import { D } from '../core/data.js';
import { gone, state } from '../core/nav.js';
import { main } from '../core/shell.js';
import { esc, fmtDate } from '../core/utils.js';

export async function renderAbout(){
  const tok = state.navToken;
  main.innerHTML = `<div class="about">
    <h1>About</h1>
    <div class="absub">Every London bus route, operator, garage and contract — built entirely from open data.</div>

    <p>londonbuses.org is an independent project. It is <b>not affiliated with Transport for London</b> or any bus operator, and it is not a journey planner — for travel advice use <a href="https://tfl.gov.uk" rel="noopener" target="_blank">tfl.gov.uk</a>.</p>

    <h2>Attribution</h2>
    <p class="note" style="margin-top:0">Powered by TfL Open Data. Contains OS data © Crown copyright and database rights 2016 and Geomni UK Map data © and database rights 2019. Contains public sector information licensed under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" rel="noopener" target="_blank">Open Government Licence v3.0</a>. Map data © <a href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">OpenStreetMap</a> contributors; basemap by OpenFreeMap, OpenMapTiles and CARTO.</p>

    <h2>Live right now</h2>
    <div class="card"><table class="fresh">
      <tr><td><span class="livechip"><i class="pulse"></i>LIVE</span> Bus arrivals</td><td class="desc">Re-syncs every ~30 s while a stop board is open.</td></tr>
      <tr><td><span class="livechip"><i class="pulse"></i>LIVE</span> Bus positions</td><td class="desc">GPS positions — every ~15–20 s while the live layer is on.</td></tr>
      <tr><td><span class="livechip"><i class="pulse"></i>LIVE</span> Route status</td><td class="desc">Checked on view, re-polled every 60 s.</td></tr>
    </table></div>
    <p class="note">Live feeds are never stored — the browser reads them directly, with the last published snapshot as fallback.</p>

    <h2>When each dataset refreshes</h2>
    <div class="card"><table class="fresh" id="freshTable"><tr><td colspan="3" style="color:var(--mu)">Loading…</td></tr></table></div>
    <p class="note">Times are London time (GMT/BST); the scheduler can slip a slot by a few minutes to a few hours. A refresh publishes only when the data actually changed, so "last updated" is the last time the upstream moved, not the last check. Low bridges, collisions and crowding are seeded snapshots and don't refresh.</p>

    <h2>Credits</h2>
    <p>Built by <a href="https://farhan.app" rel="noopener" target="_blank">Farhan Munim</a>. Thanks to Daniel Plumb, Mark Leonard-Adoko, Ross Levine, Paul Tran and Andy Corbett for data, feedback and reference material. The original map-first app is preserved as the <a href="/archive/v1/">classic map app ›</a></p>

    <div class="footer" style="margin-top:28px">Data may be incomplete or out of date — verify before acting on it.</div>
  </div>`;
  const mf = await D.manifest();
  if(gone(tok)) return;

  /* Refresh schedule per pipeline — mirrors .github/workflows (keep in sync):
     nightly full refresh 03:17, status every 2 h 07:41–21:41, fleet sweeps
     07:20/15:20/23:20, tender checks hourly 07:20–20:20 (all UTC). */
  /* The crons fire at fixed UTC times, but we show London wall-clock
     (Europe/London), so the displayed times shift by an hour between GMT
     and BST automatically. */
  const lonFmt = new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/London', hour:'2-digit', minute:'2-digit', hour12:false });
  const lon = d => lonFmt.format(d);
  const lonAt = (h, m) => { const n = new Date(); return lon(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), h, m))); };
  const SCHED = {
    nightly: { label:`nightly · ${lonAt(3,17)} London time`,                        hours:[3],                          minute:17 },
    status:  { label:`every 2 h · ${lonAt(7,41)}–${lonAt(21,41)} London time`,      hours:[7,9,11,13,15,17,19,21],      minute:41 },
    fleet:   { label:`every 8 h · ${lonAt(7,20)}/${lonAt(15,20)}/${lonAt(23,20)} London time`, hours:[7,15,23],         minute:20 },
    cpi:     { label:'ONS release day · from 09:00 London time', hours:[8,9,10,11,12,13,14,15,16,17], minute:3, release:true },
    tenders: { label:`hourly · ${lonAt(7,20)}–${lonAt(20,20)} London time`,         hours:[7,8,9,10,11,12,13,14,15,16,17,18,19,20], minute:20 },
  };
  const nextRun = sc => {
    const now = new Date();
    for(let d = 0; d <= 1; d++){
      for(const h of sc.hours){
        const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, h, sc.minute));
        if(t > now) return t;
      }
    }
    return null;
  };
  const rel = iso => {
    const t = new Date(iso).getTime();
    if(!Number.isFinite(t)) return null;
    const m = Math.round(Math.abs(Date.now() - t) / 60000);
    return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m/60)} h` : `${Math.round(m/1440)} d`;
  };
  // CPI is polled only on ONS release day: show the release date itself unless that day is today
  const cpiRelease = await D.cpi().then(c => Date.parse(String(c?.nextRelease) + ' UTC'), () => NaN);
  const nextTxt = sc => {
    if(sc.release && Number.isFinite(cpiRelease) && Date.now() < cpiRelease){
      const d = new Date(cpiRelease);
      return `on ONS release day, ${d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}`;
    }
    const t = nextRun(sc); if(!t) return '—';
    return `in ~${rel(t.toISOString())} (${lon(t)} London)`;
  };
  const ds = mf?.datasets ?? {};
  const newest = keys => keys.map(k => ds[k]?.fetchedAt).filter(Boolean).sort().pop() ?? null;
  const warn = keys => keys.some(k => ds[k]?.status && ds[k].status !== 'ok') ? ' ⚠️' : '';
  const GROUPS = [
    { name:'Routes, stops & geometry',   keys:['routes','routes-overview','route-stops'], sc:SCHED.nightly },
    { name:'Operators, garages & PVR',   keys:['route-meta','garages'],                   sc:SCHED.nightly },
    { name:'Service status & diversions',keys:['line-status','route-diversions'],         sc:SCHED.status },
    { name:'Fleet observations',  keys:['fleet','vehicles'],                       sc:SCHED.fleet },
    { name:'Tender awards',              keys:['tenders'],                                sc:SCHED.tenders },
    { name:'Tendering programme',        keys:['tender-programme'],                       sc:SCHED.tenders },
    { name:'Contract price adjustment (CPI)',              keys:['cpi-cpa'],                                sc:SCHED.cpi },
  ];
  document.getElementById('freshTable').innerHTML =
    `<tr><th style="text-align:left;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mu);padding:9px 14px 5px">Dataset</th>
      <th style="text-align:right;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mu);padding:9px 14px 5px">Last updated</th>
      <th style="text-align:right;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mu);padding:9px 14px 5px">Next check</th></tr>` +
    GROUPS.map(g => {
      const at = newest(g.keys);
      return `<tr><td>${esc(g.name)}<div style="font-size:11px;color:var(--mu)">${esc(g.sc.label)}</div></td>
        <td>${at ? `${esc(rel(at))} ago${warn(g.keys)}<div style="font-size:11px;color:var(--mu)">${esc(fmtDate(at) ?? '')}</div>` : '—'}</td>
        <td>${esc(nextTxt(g.sc))}</td></tr>`;
    }).join('');
}
