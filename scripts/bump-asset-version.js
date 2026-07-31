/**
 * bump-asset-version.js — stamp a new cache-busting version onto every
 * first-party asset URL: the <link>/<script> references in the HTML and
 * every static `import './x.js'` across js/.
 *
 * Why: the site deploys with no build step and no fingerprinted filenames,
 * and the farhan.app zone caches /js and /css for 4 h regardless of the
 * origin's Cache-Control. Without versioned URLs, a deploy leaves edge POPs
 * and browsers holding a MIXED module graph — on 2026-07-31 a stale map.js
 * next to a fresh toggles.js threw "does not provide an export" and broke
 * the app for cached visitors. With ?v= on every module URL the graph is
 * fetched atomically: index.html (always revalidated) names the version,
 * and every import resolves under it — all-new or all-old, never mixed.
 *
 * Run as part of every release, before committing:
 *   node scripts/bump-asset-version.js            # uses package.json version
 *   node scripts/bump-asset-version.js 2.16.0     # explicit version
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = process.argv[2]
  ?? JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

if (!/^[\w.-]+$/.test(V)) {
  console.error(`Refusing suspicious version string: ${V}`);
  process.exit(1);
}

const VER_RE = /\?v=[\w.-]+/g;

let filesTouched = 0, refsStamped = 0;

function stamp(file, patterns) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const re of patterns) {
    after = after.replace(re, (m) => {
      refsStamped++;
      // Strip any existing ?v=… then append the current one.
      const clean = m.replace(VER_RE, '');
      // `m` ends just before the closing quote — append the query there.
      return `${clean}?v=${V}`;
    });
  }
  if (after !== before) { fs.writeFileSync(file, after, 'utf8'); filesTouched++; }
}

// HTML: first-party stylesheet + module entry references.
for (const html of ['index.html', 'changelog.html', '404.html']) {
  const p = path.join(ROOT, html);
  if (!fs.existsSync(p)) continue;
  stamp(p, [
    /(?:css|js)\/[\w./-]+\.(?:css|js)(?:\?v=[\w.-]+)?(?=")/g,
  ]);
}

// JS modules: every static relative import specifier.
for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
  if (!f.endsWith('.js')) continue;
  stamp(path.join(ROOT, 'js', f), [
    /\.\/[\w./-]+\.js(?:\?v=[\w.-]+)?(?=')/g,
  ]);
}

console.log(`Stamped ?v=${V} on ${refsStamped} references across ${filesTouched} files.`);
