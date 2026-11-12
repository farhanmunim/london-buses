/* UI state — the current operator/garage scope and filters. */
import { D } from './data.js';
import { ALL } from './tokens.js';

/* ── state ───────────────────────────────────────────────────────────────── */
export const S = { rnWin:24, rnFilter:'open', rnQ:null, rnShown:25, op:ALL, garage:null, real:true, metric:'pvr', rwMetric:'routes', mView:'chart', rwView:'chart', gapView:'chart', feedF:'all', radarKm:5, radarAll:false, q:'', prop:'all', flags:new Set(), year:null,
            sort:{ k:'pvr', dir:-1 }, shown:30, route:null, dir:'outbound', mapBig:false, ml:{ stops:true, works:true, coll:false, bridges:false, live:false, gar:false } };

export const SC = () => D.scope(S.op, S.garage);
