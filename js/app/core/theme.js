/* Theme — the current-theme predicate (the pre-paint stamp lives inline in index.html). */

/* ── Theme ── */
export const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
