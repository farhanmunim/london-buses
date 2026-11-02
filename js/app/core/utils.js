/* Small shared helpers — escaping, formatting, operator colours/filters, route sorting, great-circle distance, CSV export. */

/* ── Small utils ──────────────────────────────────────────────────────── */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const stripTags = s => String(s ?? '').replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"')
  .replace(/\s+/g,' ').trim();
export const num = v => Number.isFinite(v) ? v : null;
export const tvrOf = pvr => Number.isFinite(pvr) ? Math.floor(pvr * 1.13) : null;
export const nOf = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const plural = (n, one, many = one + 's') => `${Number(n).toLocaleString('en-GB')} ${n === 1 ? one : many}`;
export const fmtDate = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d)
  ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : null; };
export const monthYear = ym => { const m = /^(\d{4})-(\d{2})/.exec(ym ?? ''); return m ? `${m[2]}/${m[1]}` : null; };
export const title = s => String(s ?? '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
export const cmpRoute = (a,b) => { const na=parseInt(a,10), nb=parseInt(b,10);
  if(!isNaN(na)&&!isNaN(nb)&&na!==nb) return na-nb; if(!isNaN(na)&&isNaN(nb)) return -1; if(isNaN(na)&&!isNaN(nb)) return 1;
  return String(a).localeCompare(String(b)); };

/* Operator filter — the tender tables' select + ✕ clear pattern, shared by
   every filterable table. Options come pre-normalised from route-meta /
   garages (the pipeline canonicalises operator names — no extra
   normalisation here); blank/unknown operators only ever match
   "All operators". */
const opSelCss = 'border:1px solid var(--bd);background:var(--surf);border-radius:999px;padding:8px 12px;font-size:13px;color:var(--tx);max-width:100%';
const opClearCss = 'width:24px;height:24px;border-radius:50%;background:var(--surf2);color:var(--tx2);font-size:13px;line-height:1;flex:none';
export const opFilterHtml = (id, ops, cur = '') => `<span style="display:inline-flex;align-items:center;gap:4px;min-width:0">
    <select id="${id}" aria-label="Filter by operator" style="${opSelCss}"><option value="">All operators</option>${ops.map(o => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>
    <button id="${id}Clear" ${cur ? '' : 'hidden'} aria-label="Clear operator filter" title="Clear operator filter" style="${opClearCss}">✕</button></span>`;
export function bindOpFilter(id, apply){
  const sel = document.getElementById(id), clr = document.getElementById(id + 'Clear');
  sel.addEventListener('change', () => { clr.hidden = !sel.value; apply(sel.value); });
  clr.addEventListener('click', () => { sel.value = ''; clr.hidden = true; apply(''); });
}
/* Current operator of a (possibly combined "24/N24") route id — the same
   resolution the tendering-programme tab uses: route-meta first, an
   N-prefixed id falling back to its base id. */
export const routeOperatorOf = (meta, route) => {
  for(const t of String(route ?? '').toUpperCase().split('/').map(x => x.trim()).filter(Boolean)){
    const m = meta?.[t] ?? (t.startsWith('N') ? meta?.[t.slice(1)] : null);
    if(m?.operator) return m.operator;
  }
  return null;
};

export const TYPE_LABEL = { regular:'Day', night:'Night', twentyfour:'24-hour', school:'School' };
export const PROPULSION = ['electric','hybrid','hydrogen','diesel'];
const OP_INITIALS = { 'Arriva':'ARL','Arriva London':'ARL','First':'FRG','First Bus London':'FRG','First London':'FRG','Go-Ahead':'GAL','Go-Ahead London':'GAL','Metroline':'MLN','Stagecoach':'SCL','Stagecoach London':'SCL','Transport UK':'TUK','Transport UK London Bus':'TUK','Transport UK London Bus (RATP)':'TUK','RATP':'RTP','RATP Dev':'RTP','Uno':'UNO','Uno Buses':'UNO','Falcon':'FAL','Falcon Buses':'FAL' };
const OP_COLORS   = { 'Arriva London':'#1d4ed8','Arriva':'#1d4ed8','First Bus London':'#7c3aed','First London':'#7c3aed','First':'#7c3aed','Go-Ahead London':'#c81e1e','Go-Ahead':'#c81e1e','Metroline':'#07809d','Stagecoach London':'#1e3a8a','Stagecoach':'#1e3a8a','Transport UK London Bus':'#be185d','Transport UK London Bus (RATP)':'#be185d','Transport UK':'#be185d','Uno':'#b26205','Uno Buses':'#b26205' };
/* Upstream sources sometimes reword operator names ("First London" became "First Bus
   London") — fall back to the longest dictionary key the name starts with,
   so a rewording degrades to the right colour, not to fallback grey. */
const opKey = (dict, n) => dict[n] != null ? n
  : Object.keys(dict).sort((a,b) => b.length - a.length).find(k => String(n ?? '').startsWith(k));
/* Operators the tables above do not list (a new entrant, a small contractor) still get their own stable identity:
   initials from the name, and a colour picked from a spare palette by hashing it — so a name always wears one colour. */
const EXTRA_COLORS = ['#0f766e','#a21caf','#4d7c0f','#b45309','#0369a1','#9f1239','#4338ca','#15803d','#c2410c','#6d28d9'];
const hashStr = s => { let h = 5381; for(const c of String(s ?? '')) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h; };
export const opInitials = n => { const k = opKey(OP_INITIALS, n); if(k) return OP_INITIALS[k];
  const w = String(n ?? '?').split(/[\s\-]+/).map(x => x.replace(/[^A-Za-z]/g,'')).filter(Boolean);
  return (w.length > 1 ? w.slice(0,3).map(x => x[0]).join('') : (w[0] ?? '?').slice(0,3)).toUpperCase(); };
export const opColor    = n => { const k = opKey(OP_COLORS, n); return k ? OP_COLORS[k] : EXTRA_COLORS[hashStr(n) % EXTRA_COLORS.length]; };

export const haversineM = (aLat,aLng,bLat,bLng) => {
  const D = Math.PI/180, R = 6371e3;
  const x = Math.sin((bLat-aLat)*D/2)**2 + Math.cos(aLat*D)*Math.cos(bLat*D)*Math.sin((bLng-aLng)*D/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
};
/* ════════════════════ CPI-CPA — ONS index + contract escalation ════════ */
/* CSV export: quote-escape every field, prefix formula-leading characters
   so a cell can never execute in Excel, CRLF rows, UTF-8 BOM for Excel. */
export function downloadCsv(filename, rows){
  const cell = v => {
    let t = v == null ? '' : String(v);
    if(/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replaceAll('"', '""') + '"';
  };
  const csv = '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
