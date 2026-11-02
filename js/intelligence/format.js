/* Formatting and small numeric helpers (plus the shared warning icon). */

/* ── formatting ──────────────────────────────────────────────────────────── */
const nf = new Intl.NumberFormat('en-GB');
export const nOf = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const fInt = n => Number.isFinite(n) ? nf.format(Math.round(n)) : '—';
export const fNum = (n, d = 1) => Number.isFinite(n) ? n.toFixed(d) : '—';
export const fPct = (n, d = 1) => Number.isFinite(n) ? n.toFixed(d) + '%' : '—';
export const fGbp = n => !Number.isFinite(n) ? '—' : n >= 1e9 ? '£' + (n / 1e9).toFixed(2) + 'bn' : n >= 1e6 ? '£' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'm' : n >= 1e3 ? '£' + Math.round(n / 1e3) + 'k' : '£' + Math.round(n);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const fMon = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : '—'; };
export const fDate = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : '—'; };
export const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
export const median = a => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
export const natKey = id => { const m = /^([A-Za-z]*)(\d+)/.exec(id) ?? []; return (m[1] ?? '').toUpperCase().padEnd(3, ' ') + String(m[2] ?? '').padStart(5, '0') + id; };
export const warnIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.01"/></svg>';
