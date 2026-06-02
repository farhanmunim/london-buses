// Headless smoke test — loads live site, drives search for a few routes,
// captures console errors + final card-panel state. Single-purpose, throwaway.
import puppeteer from 'puppeteer';

const URL = process.env.SMOKE_URL || 'https://london-buses.farhan.app/';
const ROUTES = ['339', '100'];

const browser = await puppeteer.launch({ headless: 'new' });
const page    = await browser.newPage();

const errors = [];
const pageErrors = [];
const reqFails = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || m.type() === 'warn') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => pageErrors.push(`${e.message}\n${e.stack?.split('\n').slice(0,3).join('\n')}`));
page.on('requestfailed', r => reqFails.push(`${r.url()} → ${r.failure()?.errorText}`));

console.log(`→ goto ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 });

// Wait for the bottombar "X routes shown" to render — proves base data loaded.
await page.waitForFunction(() => {
  const el = document.querySelector('[data-stat="routesShown"], .filter-summary, #routesShown');
  return el && /\d/.test(el.textContent ?? '');
}, { timeout: 30_000 }).catch(() => {});

for (const id of ROUTES) {
  console.log(`\n── route ${id} ──`);
  const before = errors.length + pageErrors.length;
  await page.focus('#globalInput');
  await page.evaluate(() => { document.getElementById('globalInput').value = ''; });
  for (const ch of id) await page.keyboard.type(ch, { delay: 50 });
  // Tell us what made it into the input before Enter
  const typedValue = await page.$eval('#globalInput', el => el.value);
  console.log('  typed:', JSON.stringify(typedValue));
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 1500));
  const cardState = await page.evaluate(() => {
    const noRes   = document.getElementById('routeNoResult');
    const results = document.getElementById('routeResults');
    const cards   = results?.querySelectorAll('article, .route-card, [data-rc-num], div.rc');
    const tpl     = document.getElementById('tpl-route-card');
    const num     = results?.querySelector('[data-rc-num]')?.textContent;
    return {
      cardCount:       cards?.length ?? -1,
      firstCardNum:    num,
      tplExists:       !!tpl,
      tplFirstTag:     tpl?.content?.firstElementChild?.tagName,
      resultsChildren: results?.children?.length,
      resultsHTML:     results ? results.innerHTML.slice(0, 100) : null,
      noResultVisible: noRes ? !noRes.hidden : null,
      resultsHidden:   results ? results.hidden : null,
      inputValue:      document.getElementById('globalInput')?.value,
      pillCount:       document.querySelectorAll('#searchPills .search-pill').length,
    };
  });
  console.log(JSON.stringify(cardState));
  const newErrs = [...errors.slice(before), ...pageErrors.slice(before)];
  if (newErrs.length) console.log('  errors:', newErrs.join(' | '));

  // Clear pill so next route starts clean
  await page.evaluate(() => document.querySelector('#searchClear, [data-role=clear-search]')?.click());
  await new Promise(r => setTimeout(r, 300));
}

console.log('\n=== SUMMARY ===');
console.log('console errors:', errors.length);
console.log('page errors:',    pageErrors.length);
console.log('request fails:',  reqFails.length);
if (errors.length)     console.log('\n--- console errors ---\n' + errors.join('\n'));
if (pageErrors.length) console.log('\n--- page errors ---\n'    + pageErrors.join('\n'));
if (reqFails.length)   console.log('\n--- failed requests ---\n' + reqFails.join('\n'));

await browser.close();
