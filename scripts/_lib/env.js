/**
 * env.js — `.env` loader shared by every pipeline script.
 *
 * Reads KEY=VALUE pairs from <repo-root>/.env into `process.env`. Existing env
 * vars (e.g. those set by GitHub Actions secrets) always win — local `.env`
 * never overrides CI. Quoted values have their wrapping quotes stripped.
 * Silently skips if `.env` is missing (the GH Actions case).
 *
 * Usage:
 *   import { loadEnv } from './_lib/env.js';
 *   loadEnv();
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

export function loadEnv() {
  try {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
