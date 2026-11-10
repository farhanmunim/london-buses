/* Info buttons — a faint ⓘ in the corner of every KPI, card and table. */
import { D } from '../data.js';
import { AGE_LIMIT } from '../tokens.js';
import { tipHide, tipShow } from '../tooltip.js';

/* ── info buttons: a faint ⓘ in the corner of every KPI, card and table ──── */
const INFO = () => { const P = D.latestPeriod ? ` (${D.latestPeriod})` : '';
  return {
  'Briefing':'Sentences generated from the figures below. Tenders: 5 years.',
  'Est. annual contract value':'Sum of each route’s current accepted annual bid (TfL).',
  'Peak vehicles':'Buses needed at the busiest time (PVR).',
  'Share of peak buses':'This view’s PVR ÷ London’s PVR.',
  'Median price':'Middle £ per live mile of current contracts (TfL).',
  'Fleet age':'Average of this year − first-registration year (DVLA).',
  'Operated mileage':'Mileage run ÷ scheduled, latest period' + P + '.',
  'Up for renewal':'Annual value of contracts ending within 24 months.',
  'Remaining term':'Years left on current contracts, weighted by value.',
  'Value / vehicle':'Annual contract value ÷ PVR.',
  'Km / vehicle':'Scheduled weekday km ÷ PVR.',
  'Single-bid':'Current contracts that drew one bid ÷ all current contracts.',
  'Ageing out':`Buses first registered ${AGE_LIMIT - 2}+ years ago: they reach ${AGE_LIMIT} by ${D.YEAR + 2}.`,
  'Market position':'Operators ranked on the chosen measure.',
  'Renewal calendar':'Contracts whose current end date falls in the window. Price context compares each route’s £/mile with the median of awards in the last 24 months.',
  'Contract runway':'Current contracts by end year. Click a bar to filter.',
  'Tender record':'Re-tenders in the last 5 years: kept vs changed operator.',
  'Head-to-head':'Routes won from and lost to each rival, 5 years.',
  'Tender momentum':'Routes each operator won and lost, 5 years.',
  'Price per mile':'Median award £ per live mile by year. Real = CPI-adjusted.',
  'Electric price gap':'Median £ per live mile of TfL awards on electric buses vs awards on diesel and hybrid buses, last 5 years, in today’s money. +10% = electric awards cost 10% more per mile. Most electric awards are for new buses, so part of the gap is new-vehicle cost. Awards with no stated vehicle type are left out.',
  'Fleet register':'Registered vehicles by first-registration year (DVLA).',
  'Depots':'Peak vehicles ÷ licensed capacity per garage. Spares excluded.',
  'Garage':'Peak vehicles ÷ licensed capacity. Spares excluded.',
  'Service quality':'Operated mileage and reliability from TfL' + P + '.',
  'Replacement runway':`Buses by the year they reach ${AGE_LIMIT} (registration year + ${AGE_LIMIT}).`,
  'Needs attention':'Routes with 3+ signals: reliability, mileage, contract end, crowding, disruption, old fleet.',
  'Routes':'One row per route. Hover headings for definitions.',
  'Route map':'Route and stops (TfL). Layers add roadworks, collisions, bridges, garages, live buses.',
  'Reliability':'EWT (lower is better) or on-time % vs TfL’s standard.',
  'Price history':'£ per live mile at each award on this route.',
  'Peak load along the route':'Busiest-period load per stop vs capacity (TfL BUSTO).',
  'Operated mileage · last 13 periods':'Mileage run ÷ scheduled per period. Dotted = TfL minimum.',
  'Network & productivity':'Weekday km and trips from timetables (estimate).',
  'Corridor risk':'Bus collisions within 100 m (DfT STATS19) and low bridges.',
  'Contract':'Current contract dates and value (TfL).',
  'Award history':'Every published TfL award for this route.',
  'Attention signals':'Facts flagged for this route right now.',
  'r:Peak vehicles':'Buses this route needs at its busiest time (PVR).',
  'Price':'Current contract £ per live mile vs London median.',
  'Operated':'Mileage run ÷ scheduled, latest period' + P + '.',
  'Peak load':'Highest load along the route vs capacity.',
  'Collisions':'Bus collisions near the route (DfT STATS19).',
  'Serious or fatal':'Serious or fatal among those collisions.',
  'Lowest bridge':'Lowest height limit on the corridor. Double-deck needs ~4.4 m.',
}; };
export const COL_TIPS = { Route:'Route number and shape.', Corridor:'Route ends and its garage.', PVR:'Peak vehicles needed.', Fleet:'Propulsion and average vehicle age.', '£/mile':'Contract £ per live mile, vs London median.', Operated:'Mileage run ÷ scheduled, latest period.', Reliability:'EWT (lower is better) or on-time % vs standard.', 'Contract runway':'Contract end date; bar = term left.', 'Tender status':'Awarded: new contract awarded in 9 months or not yet started. Tender: in TfL’s programme.' };
let infoMap = null;
function decorate(root = document){
  infoMap ??= (D ? INFO() : null); if(!infoMap) return;
  const keys = Object.keys(infoMap).sort((a, b) => b.length - a.length);
  const titleOf = el => (el.matches('.kpi, .mini > div') ? el.querySelector('.l')?.firstChild?.textContent ?? el.querySelector('.l')?.textContent : el.matches('.drawer section') ? el.querySelector('h4')?.textContent : el.querySelector('.ch h2')?.textContent)?.trim();
  for(const el of root.querySelectorAll('.card, .kpi, .mini > div, .drawer section')){
    if(el.closest('.menu') || el.querySelector(':scope > .info.corner')) continue;   // re-rendering a card's innerHTML drops its button; put it back
    const t = titleOf(el); if(!t) continue;
    const key = el.matches('.mini > div') && infoMap['r:' + t] ? 'r:' + t : keys.find(k => !k.startsWith('r:') && (t === k.trim() || t.startsWith(k.trim() + ' ·')));
    const text = (key && infoMap[key]) || el.dataset.info; if(!text) continue;
    el.dataset.i = '1';
    const i = document.createElement('i'); i.className = 'info corner'; i.tabIndex = 0; i.textContent = 'i'; i.dataset.tip = t.replace(/ ·.*$/, '') + '\n' + text; i.setAttribute('role', 'note'); i.setAttribute('aria-label', 'About ' + t);
    el.append(i);
  }
}
{ let q = 0; new MutationObserver(() => { cancelAnimationFrame(q); q = requestAnimationFrame(() => decorate()); }).observe(document.body, { childList:true, subtree:true }); }
document.addEventListener('focusin', e => { const t = e.target.closest?.('.info[data-tip]'); if(t){ const r = t.getBoundingClientRect(); tipShow(t.dataset.tip, r.left - 140, r.bottom); } });
document.addEventListener('focusout', e => { if(e.target.closest?.('.info')) tipHide(); });
document.addEventListener('click', e => { const t = e.target.closest?.('.info[data-tip]'); if(t){ const r = t.getBoundingClientRect(); tipShow(t.dataset.tip, Math.max(8, r.left - 220), r.bottom); } });
