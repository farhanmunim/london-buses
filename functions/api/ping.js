/** /api/ping — deployment canary: confirms new Pages Functions route. */
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, at: new Date().toISOString() }),
    { headers: { 'content-type': 'application/json' } });
}
