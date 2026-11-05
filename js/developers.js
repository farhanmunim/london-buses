/* Renders the resource table and attribution list on /developers from the generated /api/v1/index.json,
   so the docs can never drift from what is actually published. */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

try {
  const { data } = await (await fetch('/api/v1/index.json')).json();
  document.getElementById('resources').innerHTML =
    '<table><thead><tr><th>Endpoint</th><th>What it returns</th></tr></thead><tbody>' +
    data.resources.map(r => {
      const href = r.path.includes('{') || r.live ? null : r.path;
      const label = `<code>${esc(r.path)}</code>`;
      return `<tr><td>${href ? `<a href="${esc(href)}">${label}</a>` : label}${r.live ? '<span class="tag">live</span>' : ''}</td><td>${esc(r.summary)}</td></tr>`;
    }).join('') + '</tbody></table>';
  document.getElementById('attribution').innerHTML = data.attribution.map(a =>
    `<li><a href="${esc(a.url)}" rel="noopener">${esc(a.text)}</a> <span class="muted">— ${esc(a.licence)}</span></li>`).join('');
} catch {
  document.getElementById('resources').innerHTML = '<p class="muted">Could not load the resource list — see <a href="/api/v1/index.json">/api/v1/index.json</a>.</p>';
}
