/**
 * /api/live/vehicles?line=88 — live bus positions (Cloudflare Pages Function)
 *
 * Proxies the DfT Bus Open Data Service SIRI-VM datafeed (which has no CORS
 * and needs a secret key) into the envelope both front-ends already consume:
 *
 *   { feed: "vehicles", live: true, cached: <bool>, capturedAt, count,
 *     data: [{ reg, line, publishedLine, direction, lat, lng, bearing,
 *              destination, origin, operatorRef, recordedAt }] }
 *
 * Query strategy: TfL's SIRI LineRef is the internal iBus contract number
 * (route 88 runs as LineRef 426), so filtering upstream by lineRef misses.
 * Instead the function bounds the query to the route's bounding box (from
 * the committed data/api/route-bboxes.json, served by this same site) plus
 * operatorRef=TFLO, then filters the XML by PublishedLineName. A route
 * corridor holds a few hundred vehicles at most, which keeps both the BODS
 * payload and the regex parse well inside the Workers free-tier CPU budget.
 *
 * Caching: responses are cached 10 s per line via the Cache API and served
 * with Cache-Control: max-age=10 — the front-ends' liveGet() reads max-age
 * (+ Age) to align their next poll with edge expiry, exactly as they did
 * against the Atlas feed.
 *
 * Requires the BODS_API_KEY environment variable (Cloudflare Pages
 * project settings → Environment variables). Live data is never stored.
 */

const BODS_URL = 'https://data.bus-data.dft.gov.uk/api/v1/datafeed/';
const CACHE_S = 10;

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1].trim() : null;
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const line = String(url.searchParams.get('line') ?? '').trim().toUpperCase();
  if (!line) return json({ error: 'line parameter required' }, 400);
  if (!env.BODS_API_KEY) return json({ error: 'BODS_API_KEY not configured' }, 503);

  // One cache entry per line; the reg/bbox parts of the upstream call are
  // deterministic per line so the line alone is a sufficient key.
  const cacheKey = new Request(`${url.origin}/api/live/vehicles?line=${encodeURIComponent(line)}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Route bbox from the committed dataset (served by this same deployment).
  const bboxRes = await env.ASSETS.fetch(new URL('/data/api/route-bboxes.json', url.origin));
  if (!bboxRes.ok) return json({ error: 'route-bboxes unavailable' }, 502);
  const bbox = (await bboxRes.json())?.routes?.[line];
  if (!bbox) return json({ feed: 'vehicles', live: true, cached: false, capturedAt: new Date().toISOString(), count: 0, data: [] });

  const upstream = new URL(BODS_URL);
  upstream.searchParams.set('boundingBox', bbox.join(','));
  upstream.searchParams.set('operatorRef', 'TFLO');
  upstream.searchParams.set('api_key', env.BODS_API_KEY);

  const res = await fetch(upstream, { headers: { 'User-Agent': 'london-buses.farhan.app live proxy' } });
  // 503, not 502 — Cloudflare swallows a Worker's 502/504 body and serves
  // its own branded error page, which hides this diagnostic JSON.
  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 300);
    return json({ error: `BODS upstream HTTP ${res.status}`, upstreamBody: snippet }, 503);
  }
  const xml = await res.text();

  const capturedAt = tag(xml, 'ResponseTimestamp') ?? new Date().toISOString();
  const data = [];
  for (const m of xml.matchAll(/<VehicleActivity>([\s\S]*?)<\/VehicleActivity>/g)) {
    const block = m[1];
    if ((tag(block, 'PublishedLineName') ?? '').toUpperCase() !== line) continue;
    const lat = Number(tag(block, 'Latitude'));
    const lng = Number(tag(block, 'Longitude'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const bearing = Number(tag(block, 'Bearing'));
    data.push({
      reg: tag(block, 'VehicleRef'),
      line: tag(block, 'LineRef'),
      publishedLine: line,
      direction: tag(block, 'DirectionRef') ?? '1',
      lat,
      lng,
      bearing: Number.isFinite(bearing) ? bearing : null,
      destination: tag(block, 'DestinationName'),
      origin: tag(block, 'OriginName'),
      operatorRef: tag(block, 'OperatorRef'),
      recordedAt: tag(block, 'RecordedAtTime'),
    });
  }

  const body = { feed: 'vehicles', live: true, cached: false, capturedAt, count: data.length, data };
  const response = json(body, 200, { 'Cache-Control': `public, max-age=${CACHE_S}` });
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}
