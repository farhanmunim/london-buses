/**
 * touch-manifest.js <dataset> — bring one dataset's row in data/api/manifest.json up to date (fetchedAt and row
 * count, read from its own file) without rebuilding the whole served API. Used by single-dataset workflows
 * (refresh-cpi.yml): running build-api.js for that would re-derive every dataset from whatever caches the runner
 * happens to hold. Writes only when the row actually changed, so a quiet run leaves the tree clean.
 *
 * Run: node scripts/touch-manifest.js cpi-cpa
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'api');
const key = process.argv[2];
if (!key) { console.error('usage: node scripts/touch-manifest.js <dataset>'); process.exit(2); }

const read = f => JSON.parse(fs.readFileSync(path.join(API, f), 'utf8'));
const data = read(`${key}.json`), manifest = read('manifest.json');
const row = manifest.datasets?.[key];
if (!row) { console.error(`manifest has no "${key}" row`); process.exit(1); }

const fetchedAt = data.generatedAt ?? data.metadata?.generatedAt ?? data.capturedAt;
const rows = Number.isFinite(data.count) ? data.count : row.rows;
if (!fetchedAt) { console.error(`${key}.json carries no generatedAt`); process.exit(1); }
if (row.fetchedAt === fetchedAt && row.rows === rows) { console.log(`manifest "${key}" already current`); process.exit(0); }
row.fetchedAt = fetchedAt; row.rows = rows;
manifest.generatedAt = new Date().toISOString();
fs.writeFileSync(path.join(API, 'manifest.json'), JSON.stringify(manifest) + '\n', 'utf8');
console.log(`manifest "${key}" → fetchedAt ${fetchedAt}, ${rows} rows`);
