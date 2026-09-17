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
 *      carries the highway authority), and commits the survivors to THIS
 *      GitHub repo — one file per event on the dedicated
 *      `streetworks-inbox` branch (inbox/<MessageId>.json via the GitHub
 *      contents API). No other storage: git IS the queue, matching the
 *      rest of the platform.
 *   3. The repo's status workflow folds the inbox into the committed
 *      archive with plain git (scripts/drain-streetworks.js) and deletes
 *      the processed files.
 *
 * Why a dedicated branch + one file per event:
 *   - Commits to `streetworks-inbox` never touch main, so they trigger no
 *     Cloudflare Pages production builds. (Dashboard note: exclude this
 *     branch from PREVIEW builds too — Settings → Builds → preview branch
 *     control.)
 *   - Unique filenames mean concurrent events never edit the same file;
 *     two simultaneous commits can still race on the branch head, in which
 *     case GitHub returns 409, this function returns non-2xx, and AWS SNS
 *     retries the delivery — the standard SNS retry contract does the
 *     queueing for us.
 *
 * Setup (one-time):
 *   - Fine-grained GitHub PAT, THIS repo only, permission Contents:
 *     Read & write → Pages project env var GITHUB_TOKEN (encrypted).
 *   - Optional GITHUB_REPO env var (owner/repo), defaults to
 *     farhanmunim/london-buses.
 *   - GET this endpoint until it reports ready:true, THEN register.
 *
 * GET  → health JSON (token ok? inbox branch? queued file count?)
 * POST → SNS envelope handling as above.
 */

// Topic gate: pinned to eu-west-2 + DfT's topic NAMES. The ACCOUNT id in
// their docs (287813576808) may not match production, and a mismatch here
// silently 403'd deliveries — so the account is not pinned; the signature
// check plus the name pin carry the trust, and every decision is now
// breadcrumbed to the inbox branch so a rejection is observable.
const EXPECTED_TOPICS = /^arn:aws:sns:eu-west-2:\d+:(prod|sm)?[-_]?(permit|activity|section[-_]?58)[a-z-]*$/i;
const CERT_HOST = /^https:\/\/sns\.eu-west-2\.amazonaws\.com\/[^\s]+\.pem$/;
// The 33 London boroughs + TfL as Street Manager names them. Everything
// with LONDON in the name (the LB* boroughs, City of London, TfL) plus the
// authorities whose names don't carry it. "KINGSTON UPON THAMES" is
// deliberately full-phrase so Kingston-upon-Hull never matches.
const LONDON_HA = /LONDON|WESTMINSTER|KENSINGTON AND CHELSEA|ROYAL BOROUGH OF GREENWICH|KINGSTON UPON THAMES/;

const DEFAULT_REPO = 'farhanmunim/london-buses';
const INBOX_BRANCH = 'streetworks-inbox';
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';   // git's well-known empty tree

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

/* ── GitHub inbox ───────────────────────────────────────────────────────── */
function gh(env) {
  const repo = env.GITHUB_REPO ?? DEFAULT_REPO;
  const headers = {
    'authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'accept': 'application/vnd.github+json',
    'user-agent': 'london-buses-streetworks-fn',
    'x-github-api-version': '2022-11-28',
  };
  return { repo, headers, api: (p) => `https://api.github.com/repos/${repo}${p}` };
}

// Create the inbox branch from a parentless empty commit (first event only).
async function bootstrapBranch({ api, headers }) {
  const commit = await fetch(api('/git/commits'), {
    method: 'POST', headers,
    body: JSON.stringify({ message: 'streetworks inbox root (empty)', tree: EMPTY_TREE, parents: [] }),
  });
  if (!commit.ok) return false;
  const { sha } = await commit.json();
  const ref = await fetch(api('/git/refs'), {
    method: 'POST', headers,
    body: JSON.stringify({ ref: `refs/heads/${INBOX_BRANCH}`, sha }),
  });
  return ref.ok || ref.status === 422;   // 422 = created concurrently — fine
}

// Tiny observability: every POST decision leaves a breadcrumb file on the
// inbox branch (log/<ts>-<verdict>.json — type, topic, verdict; never
// tokens or SubscribeURLs), so a rejected confirmation is visible in git
// instead of vanishing into a 403. Best-effort: a failed breadcrumb never
// fails the request.
async function breadcrumb(env, verdict, msg) {
  if (!env.GITHUB_TOKEN) return;
  try {
    const g = gh(env);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `log/${ts}-${(msg?.MessageId ?? 'x').slice(0, 8)}.json`;
    const body = JSON.stringify({
      at: new Date().toISOString(),
      verdict,
      type: msg?.Type ?? null,
      topicArn: msg?.TopicArn ?? null,
      messageId: msg?.MessageId ?? null,
    });
    const payload = JSON.stringify({ message: `streetworks ${verdict}`, branch: INBOX_BRANCH,
      content: btoa(unescape(encodeURIComponent(body))) });
    let res = await fetch(g.api(`/contents/${path}`), { method: 'PUT', headers: g.headers, body: payload });
    if (res.status === 422 && await bootstrapBranch(g)) {
      await fetch(g.api(`/contents/${path}`), { method: 'PUT', headers: g.headers, body: payload });
    }
  } catch { /* observability must never break delivery */ }
}

async function storeEvent(env, msg, ha) {
  const g = gh(env);
  const path = `inbox/${msg.MessageId}.json`;
  const payload = JSON.stringify({
    message: `streetworks event ${msg.MessageId}`,
    branch: INBOX_BRANCH,
    content: btoa(unescape(encodeURIComponent(JSON.stringify({
      receivedAt: new Date().toISOString(),
      topic: msg.TopicArn,
      ha,
      messageId: msg.MessageId,
      message: msg.Message,
    })))),
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(g.api(`/contents/${path}`), { method: 'PUT', headers: g.headers, body: payload });
    if (res.ok) return { ok: true };
    if (res.status === 422) {
      // Either the file already exists (SNS redelivery — success) or the
      // branch doesn't exist yet (first ever event — bootstrap and retry).
      const detail = await res.text();
      if (/sha/i.test(detail)) return { ok: true, duplicate: true };
      if (attempt === 1 && await bootstrapBranch(g)) continue;
      return { ok: false, status: 422, detail: detail.slice(0, 160) };
    }
    if (res.status === 409 && attempt === 1) continue;   // head moved under us — one in-function retry
    return { ok: false, status: res.status };
  }
  return { ok: false, status: 409 };                     // SNS will redeliver
}

/* ── Handlers ───────────────────────────────────────────────────────────── */
export async function onRequestGet({ env }) {
  if (!env.GITHUB_TOKEN) {
    return json({ service: 'street-manager open-data receiver', ready: false,
                  hint: 'Set the GITHUB_TOKEN env var (fine-grained PAT, this repo, Contents read/write) on the Pages project.' }, 503);
  }
  const g = gh(env);
  const repoRes = await fetch(g.api(''), { headers: g.headers });
  if (!repoRes.ok) {
    return json({ service: 'street-manager open-data receiver', ready: false,
                  hint: `GitHub token cannot reach ${g.repo} (HTTP ${repoRes.status}).` }, 503);
  }
  let queued = 0, branch = false;
  const dir = await fetch(g.api(`/contents/inbox?ref=${INBOX_BRANCH}`), { headers: g.headers });
  if (dir.ok) { branch = true; const list = await dir.json(); queued = Array.isArray(list) ? list.length : 0; }
  else if (dir.status === 404) {
    // Branch or dir absent — absent until the first event; still ready.
    const refRes = await fetch(g.api(`/git/ref/heads/${INBOX_BRANCH}`), { headers: g.headers });
    branch = refRes.ok;
  }
  return json({
    service: 'street-manager open-data receiver',
    ready: true,
    storage: `github:${g.repo}#${INBOX_BRANCH}`,
    inboxBranchExists: branch,
    queuedEvents: queued >= 1000 ? '1000+' : queued,
    hint: 'Endpoint is ready — you can register this URL for Street Manager open data.',
  });
}

export async function onRequestPost({ request, env }) {
  let msg;
  try { msg = await request.json(); }
  catch { return json({ error: 'not JSON' }, 400); }

  const type = request.headers.get('x-amz-sns-message-type') ?? msg.Type;
  const failure = await verifySns(msg);
  if (failure) {
    await breadcrumb(env, `rejected: ${failure}`, msg);
    return json({ error: failure }, 403);
  }

  if (type === 'SubscriptionConfirmation') {
    // Activate the subscription. The signature check above proves the
    // request is genuine AWS SNS; the SubscribeURL host pin below stops
    // anything else. Topic-name mismatches are logged, not fatal — a
    // wrongly-guessed DfT account id must never eat the one-shot
    // confirmation again.
    if (!/^https:\/\/sns\.eu-west-2\.amazonaws\.com\//.test(msg.SubscribeURL ?? '')) {
      await breadcrumb(env, 'rejected: bad SubscribeURL', msg);
      return json({ error: 'bad SubscribeURL' }, 403);
    }
    const res = await fetch(msg.SubscribeURL);
    await breadcrumb(env, res.ok ? 'confirmed subscription' : `confirm fetch HTTP ${res.status}`, msg);
    return json({ confirmed: res.ok, topic: msg.TopicArn }, res.ok ? 200 : 502);
  }

  if (type === 'UnsubscribeConfirmation') {
    await breadcrumb(env, 'unsubscribe notice', msg);
    return json({ noted: true });
  }

  if (type === 'Notification') {
    if (!EXPECTED_TOPICS.test(msg.TopicArn ?? '')) {
      await breadcrumb(env, 'rejected: unexpected topic', msg);
      return json({ error: 'unexpected topic' }, 403);
    }
    const ha = highwayAuthorityOf(msg);
    if (!ha || !LONDON_HA.test(ha)) return json({ skipped: 'outside London', ha });
    if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN not configured' }, 503);
    const stored = await storeEvent(env, msg, ha);
    // Non-2xx makes SNS redeliver (its retry policy is the queue's
    // durability), so only report success when the commit really landed.
    return stored.ok ? json({ stored: true, duplicate: stored.duplicate ?? false })
                     : json({ error: 'github store failed', ...stored }, 503);
  }

  return json({ error: 'unknown message type' }, 400);
}
