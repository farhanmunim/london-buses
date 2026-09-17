/**
 * /api/streetworks — DfT Street Manager open-data receiver (Pages Function)
 *
 * Street Manager open data is PUSH-ONLY: after registering at
 * manage-roadworks.service.gov.uk/open-data-onboarding you give DfT this
 * URL, and AWS SNS POSTs every permit/activity event in England to it.
 * This function is the receiving end:
 *
 *   1. SubscriptionConfirmation → verifies the signature, checks the topic
 *      is one of DfT's, then GETs the SubscribeURL to activate the
 *      subscription (registration fails without this handshake).
 *   2. Notification → verifies the SNS signature (SigV1 SHA-1 or SigV2
 *      SHA-256, cert fetched from sns.eu-west-2.amazonaws.com only, ±15 min
 *      timestamp window), drops everything outside the 33 London boroughs
 *      + TfL (the feed is England-wide; the `ha_org` message attribute
 *      carries the highway authority), and inserts the survivors into D1.
 *   3. The repo's status workflow drains D1 into the committed archive via
 *      scripts/drain-streetworks.js (Cloudflare REST API) — the same
 *      git-as-database pattern as every other dataset here.
 *
 * Volume: England-wide is far beyond Workers KV's free write quota, which
 * is why storage is D1 (100k row writes/day free) and why the London
 * filter runs HERE, not at drain time. London-filtered volume is a few
 * thousand events/day.
 *
 * Setup (one-time, Cloudflare dashboard):
 *   - Create a D1 database (suggested name: streetworks)
 *   - Bind it to this Pages project as STREETWORKS_DB
 *   - GET this endpoint to confirm it reports ready:true, THEN register.
 *
 * GET  → health JSON (binding present? how many rows queued?)
 * POST → SNS envelope handling as above.
 */

const EXPECTED_TOPICS = /^arn:aws:sns:eu-west-2:287813576808:prod-(permit|activity|section-58)-topic$/;
const CERT_HOST = /^https:\/\/sns\.eu-west-2\.amazonaws\.com\/[^\s]+\.pem$/;
// The 33 London boroughs + TfL as Street Manager names them. Everything
// with LONDON in the name (the LB* boroughs, City of London, TfL) plus the
// authorities whose names don't carry it. "KINGSTON UPON THAMES" is
// deliberately full-phrase so Kingston-upon-Hull never matches.
const LONDON_HA = /LONDON|WESTMINSTER|KENSINGTON AND CHELSEA|ROYAL BOROUGH OF GREENWICH|KINGSTON UPON THAMES/;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

/* ── SNS signature verification ─────────────────────────────────────────── */
// Canonical string per AWS SNS docs: alternating "Name\nValue\n" lines for
// the present fields, in this fixed order per message type.
function canonicalString(msg) {
  const fields = msg.Type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  let s = '';
  for (const f of fields) if (msg[f] !== undefined && msg[f] !== null) s += f + '\n' + msg[f] + '\n';
  return s;
}

// Minimal ASN.1 walk to lift SubjectPublicKeyInfo out of an X.509 DER cert
// (WebCrypto imports 'spki', not certificates). Certificate = SEQ{ tbs SEQ{
// [0] version?, serial, sigAlg, issuer, validity, subject, SPKI, ... }, .. }.
function derElement(buf, off) {
  const tag = buf[off];
  let len = buf[off + 1], lenBytes = 1;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[off + 2 + i];
    lenBytes = 1 + n;
  }
  const header = 1 + lenBytes;
  return { tag, start: off, contentStart: off + header, end: off + header + len };
}
function extractSpki(der) {
  const cert = derElement(der, 0);                       // Certificate SEQ
  const tbs = derElement(der, cert.contentStart);        // tbsCertificate SEQ
  let off = tbs.contentStart;
  let el = derElement(der, off);
  if (el.tag === 0xa0) { off = el.end; el = derElement(der, off); }  // [0] version
  for (const _skip of ['serial', 'sigAlg', 'issuer', 'validity', 'subject']) {
    off = el.end;
    el = derElement(der, off);
  }
  return der.slice(el.start, el.end);                    // SPKI SEQ (full TLV)
}

const certCache = new Map();   // cert URL → CryptoKey promise (per-isolate)
async function signingKey(certUrl, hash) {
  const cacheId = certUrl + '|' + hash;
  if (!certCache.has(cacheId)) {
    certCache.set(cacheId, (async () => {
      const res = await fetch(certUrl);
      if (!res.ok) throw new Error(`cert fetch ${res.status}`);
      const pem = await res.text();
      const b64 = pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, '');
      const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const spki = extractSpki(der);
      return crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
    })());
  }
  return certCache.get(cacheId);
}

async function verifySns(msg) {
  if (!CERT_HOST.test(msg.SigningCertURL ?? '')) return 'bad cert URL';
  if (!EXPECTED_TOPICS.test(msg.TopicArn ?? '')) return 'unexpected topic';
  const age = Math.abs(Date.now() - Date.parse(msg.Timestamp ?? 0));
  if (!(age < 15 * 60 * 1000)) return 'stale timestamp';
  const hash = msg.SignatureVersion === '2' ? 'SHA-256' : 'SHA-1';
  let key;
  try { key = await signingKey(msg.SigningCertURL, hash); }
  catch (e) { return 'cert error: ' + e.message; }
  const sig = Uint8Array.from(atob(msg.Signature ?? ''), c => c.charCodeAt(0));
  const data = new TextEncoder().encode(canonicalString(msg));
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  return ok ? null : 'signature mismatch';
}

/* ── London filter ──────────────────────────────────────────────────────── */
function highwayAuthorityOf(msg) {
  const attr = msg.MessageAttributes ?? {};
  for (const k of ['ha_org', 'ha_org_name', 'area']) {
    const v = attr[k]?.Value;
    if (v) return String(v).toUpperCase();
  }
  // Fall back to the event payload itself.
  try {
    const inner = JSON.parse(msg.Message);
    const v = inner?.object_data?.highway_authority ?? inner?.highway_authority ?? inner?.object_data?.area_name;
    if (v) return String(v).toUpperCase();
  } catch { /* not JSON */ }
  return null;
}

/* ── D1 ─────────────────────────────────────────────────────────────────── */
let tableReady = false;
async function ensureTable(db) {
  if (tableReady) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    received_at TEXT NOT NULL,
    topic TEXT,
    ha TEXT,
    message TEXT NOT NULL
  )`.replace(/\n\s*/g, ' '));
  tableReady = true;
}

/* ── Handlers ───────────────────────────────────────────────────────────── */
export async function onRequestGet({ env }) {
  const ready = !!env.STREETWORKS_DB;
  let queued = null;
  if (ready) {
    try {
      await ensureTable(env.STREETWORKS_DB);
      queued = (await env.STREETWORKS_DB.prepare('SELECT COUNT(*) AS n FROM events').first())?.n ?? 0;
    } catch (e) { return json({ ready: false, error: 'D1 error: ' + e.message }, 503); }
  }
  return json({
    service: 'street-manager open-data receiver',
    ready,
    queuedEvents: queued,
    hint: ready
      ? 'Endpoint is ready — you can register this URL for Street Manager open data.'
      : 'Bind a D1 database to this Pages project as STREETWORKS_DB, then re-check.',
  }, ready ? 200 : 503);
}

export async function onRequestPost({ request, env }) {
  let msg;
  try { msg = await request.json(); }
  catch { return json({ error: 'not JSON' }, 400); }

  const type = request.headers.get('x-amz-sns-message-type') ?? msg.Type;
  const failure = await verifySns(msg);
  if (failure) return json({ error: failure }, 403);

  if (type === 'SubscriptionConfirmation') {
    // Activate the subscription. SubscribeURL host is pinned to SNS by the
    // signature check above plus this explicit guard.
    if (!/^https:\/\/sns\.eu-west-2\.amazonaws\.com\//.test(msg.SubscribeURL ?? '')) {
      return json({ error: 'bad SubscribeURL' }, 403);
    }
    const res = await fetch(msg.SubscribeURL);
    return json({ confirmed: res.ok, topic: msg.TopicArn }, res.ok ? 200 : 502);
  }

  if (type === 'UnsubscribeConfirmation') return json({ noted: true });

  if (type === 'Notification') {
    const ha = highwayAuthorityOf(msg);
    if (!ha || !LONDON_HA.test(ha)) return json({ skipped: 'outside London', ha });
    if (!env.STREETWORKS_DB) return json({ error: 'STREETWORKS_DB not bound' }, 503);
    await ensureTable(env.STREETWORKS_DB);
    await env.STREETWORKS_DB
      .prepare('INSERT OR IGNORE INTO events (id, received_at, topic, ha, message) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(msg.MessageId, new Date().toISOString(), msg.TopicArn, ha, msg.Message)
      .run();
    return json({ stored: true });
  }

  return json({ error: 'unknown message type' }, 400);
}
