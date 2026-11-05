/* GET /api/v1/live/vehicles?line=88 — the public, CORS-open alias of /api/live/vehicles (same handler, same
   10 s edge cache). The site itself keeps using the unversioned path; third-party apps use this one so the
   contract can stay stable if the internal route moves. Live data is never stored. */
import { onRequestGet as live } from '../../live/vehicles.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Expose-Headers': 'Cache-Control, Age',
};

export async function onRequestGet(context) {
  const res = await live(context);
  const out = new Response(res.body, res);   // cached responses have immutable headers
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}
