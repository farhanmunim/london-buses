/* /docs — fills in the API resource list and attribution from the generated /api/v1/index.json, so the page can
   never drift from what is actually published. The rest of the page is static HTML. */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

try {
  const res = await fetch('/api/v1/index.json');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const { data } = await res.json();
  document.getElementById('resources').innerHTML =
    '<table><tr><th>Endpoint</th><th>What it returns</th></tr>' +
    data.resources.map(r => {
      const label = `<code>${esc(r.path)}</code>`;
      const link = r.path.includes('{') || r.live ? label : `<a href="${esc(r.path)}">${label}</a>`;
      return `<tr><td>${link}${r.live ? '<span class="tag">live</span>' : ''}</td><td>${esc(r.summary)}</td></tr>`;
    }).join('') + '</table>';
  document.getElementById('attribution').innerHTML = data.attribution.map(a =>
    `<li><a href="${esc(a.url)}" rel="noopener">${esc(a.text)}</a> <span class="muted">— ${esc(a.licence)}${a.group === 'maps' ? ' (site only)' : ''}</span></li>`).join('');
} catch {
  document.getElementById('resources').innerHTML = '<p class="muted" style="padding:12px 14px">Could not load the resource list — see <a href="/api/v1/index.json">/api/v1/index.json</a>.</p>';
  document.getElementById('attribution').innerHTML = '<li class="muted">See <a href="/api/v1/index.json">/api/v1/index.json</a>.</li>';
}

/* Jump to #hash after the async content above has been laid out (the browser scrolled before it existed). */
if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
