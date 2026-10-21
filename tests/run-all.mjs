/* Runs every tests/verify-*.mjs suite in turn and prints one summary line per suite.
   Exit code is non-zero if any suite fails or crashes.   Run: npm test */
import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
const dir = new URL('.', import.meta.url).pathname;
const only = process.argv.slice(2);
const suites = readdirSync(dir).filter(f => /^verify-.*\.mjs$/.test(f) && (!only.length || only.some(o => f.includes(o)))).sort();
let failed = 0;
for(const f of suites){
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(dir, f)], { encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const result = out.split('\n').filter(l => /\d+\/\d+ .*passed/.test(l)).pop() ?? 'NO RESULT LINE (crashed?)';
  const bad = out.split('\n').filter(l => l.startsWith('FAIL'));
  const ok = r.status === 0 && !bad.length;
  if(!ok){ failed++; console.log(bad.join('\n') || out.split('\n').slice(-12).join('\n')); }
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.replace('.mjs', '').padEnd(28)} ${result.trim()} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
console.log(`\n${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
