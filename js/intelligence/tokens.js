/* Tokens that charts and logic need in JS — operators, categories, colours, propulsion classes. */

/* ── tokens that charts need in JS ──────────────────────────────────────── */
// Operator identity: the validated 8-slot categorical order (fixed per operator).
export const ALL = 'All London';
export const AGE_LIMIT = 14;                    // TfL's maximum vehicle age, in years
export const OPS = ['Go-Ahead London','Stagecoach London','Metroline','Arriva London','Transport UK London Bus','First Bus London','Uno','Falcon Coaches'];
const CAT = ['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300','#4a3aa7','#e34948'];
const EXTRA = ['#0f766e','#a21caf','#4d7c0f','#b45309','#0369a1','#9f1239','#4338ca','#15803d'];
const hashStr = x => { let h = 5381; for(const c of String(x ?? '')) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h; };
export const opColour = o => { const i = OPS.indexOf(o); return i >= 0 && i < CAT.length ? CAT[i] : EXTRA[(i >= 0 ? i - CAT.length : hashStr(o)) % EXTRA.length]; };
export const brandRoot = n => String(n ?? '').toLowerCase().trim().split(/\s+/)[0] ?? '';
// Propulsion is an ordered scale → one ordinal blue ramp (validated), not hues.
export const CLASS = { diesel:{ label:'Diesel', c:'#86b6ef' }, hybrid:{ label:'Hybrid', c:'#2a78d6' }, zero:{ label:'Zero-emission', c:'#104281' } };
export const propClass = p => p === 'electric' || p === 'hydrogen' ? 'zero' : p === 'hybrid' ? 'hybrid' : 'diesel';
export const PROP_LABEL = { diesel:'Diesel', hybrid:'Hybrid', electric:'Electric', hydrogen:'Hydrogen' };
