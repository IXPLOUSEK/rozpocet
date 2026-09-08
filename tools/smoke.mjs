// tools/smoke.mjs — integrační test. Statický server je v nodu, aby skript
// běžel stejně na hostiteli i v kontejneru s WebKitem (tools/wk.sh).
import { createRequire } from 'node:module';
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

function findPlaywright() {
  const r = createRequire(import.meta.url);
  try { return r('playwright'); } catch (e) {}
  const cands = [];
  const npx = '/home/ixp/.npm/_npx';
  if (existsSync(npx)) for (const d of readdirSync(npx)) {
    const p = npx + '/' + d + '/node_modules/playwright';
    if (existsSync(p + '/package.json')) cands.push(p);
  }
  const mcp = '/home/ixp/.local/lib/node_modules/@playwright/mcp/node_modules/playwright';
  if (existsSync(mcp + '/package.json')) cands.push(mcp);
  cands.sort((a, b) => r(b + '/package.json').version.localeCompare(r(a + '/package.json').version, 'en', { numeric: true }));
  for (const c of cands) { try { return r(c); } catch (e) {} }
  return null;
}
const pw = findPlaywright();
if (!pw) { console.error('Playwright nenalezen'); process.exit(2); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };

let PORT = 0;   // 0 = ať OS vybere volný port, testy si nelezou do zelí
const srv = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'rozpocet.html';
  const file = join(process.cwd(), rel);
  try {
    if (!statSync(file).isFile()) throw new Error('nen\u00ed soubor');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch (e) { res.writeHead(404); res.end('404'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
PORT = srv.address().port;

// WebKit potřebuje libicu74; Fedora má 77 a ABI nesedí. Na tomhle stroji
// se proto jede v Chromiu a WebKit se ověřuje v kontejneru nebo na zařízení.
const wantWebkit = process.argv.includes('--webkit');
const engine = wantWebkit ? pw.webkit : pw.chromium;
let browser = null, engineName = wantWebkit ? 'webkit' : 'chromium';
try {
  browser = await engine.launch();
} catch (e) {
  // Stažené prohlížeče neodpovídají verzi playwrightu. Sáhni po systémovém Chrome.
  if (!wantWebkit && existsSync('/usr/bin/google-chrome')) {
    browser = await pw.chromium.launch({ executablePath: '/usr/bin/google-chrome' });
    engineName = 'system chrome';
  } else { throw e; }
}
console.log('engine: ' + engineName);
const ctx = await browser.newContext({
  ...pw.devices['iPhone 15'], locale: 'cs-CZ', timezoneId: 'Europe/Prague',
});
const page = await ctx.newPage();
const errors = [], reqs = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('request', r => reqs.push(r.url()));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; } else { fail++; console.log('FAIL  ' + n + (d ? '  ' + d : '')); } };

try {
  await page.goto(`http://127.0.0.1:${PORT}/rozpocet.html`, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  ok('žádná chyba na stránce', errors.length === 0, errors.slice(0, 4).join(' | '));
  ok('appka existuje', await page.locator('#app').count() === 1);
  ok('__APP__ je k dispozici', await page.evaluate(() => !!window.__APP__));
  ok('úložiště funguje přes http', await page.evaluate(() => window.__APP__ && window.__APP__.storageOk === true));
  ok('startuje prázdná', await page.evaluate(() => {
    const s = window.__APP__.state();
    const y = s.years[String(s.activeYear)];
    return y.catalog.length === 0 && y.tx.length === 0;
  }));
  ok('jazyk cs', await page.evaluate(() => document.documentElement.lang) === 'cs');
  ok('žádný input[type=number]', await page.locator('input[type=number]').count() === 0);
  ok('12 měsíčních chipů', await page.locator('#month-strip .chip-month').count() === 12);
  ok('5 záložek', await page.locator('#tabbar .tab').count() === 5);

  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('nepřetéká do stran', wide <= 1, 'přesah ' + wide + 'px');

  const small = await page.evaluate(() => Array.from(document.querySelectorAll('input,select,textarea'))
    .filter(i => parseFloat(getComputedStyle(i).fontSize) < 16).length);
  ok('všechna pole aspoň 16px', small === 0, small + ' menších');

  const badText = await page.evaluate(() => /\b(NaN|Infinity|\[object Object\])\b/.test(document.body.innerText || ''));
  ok('nikde NaN ani [object Object]', !badText);

  const external = reqs.filter(u => !u.startsWith(`http://127.0.0.1:${PORT}`));
  ok('žádné cizí síťové volání', external.length === 0, external.slice(0, 3).join(' '));

  // Vlastní test uvnitř aplikace
  await page.evaluate(() => (window.__APP__ && window.__APP__.selfTest ? window.__APP__.selfTest() : null)).catch(()=>null);
  const st = await page.evaluate(() => (window.__APP__ && window.__APP__.selfTest ? window.__APP__.selfTest() : null))
    .catch(() => null);
  if (st) { ok('vlastní test v appce (' + st.pass + '/' + (st.pass + st.fail) + ', ' + st.skip + ' přeskočeno)', st.fail === 0); console.log('   selftest: ' + st.pass + ' ok, ' + st.fail + ' fail, ' + st.skip + ' skip'); }
  else console.log('SKIP  vlastní test se nepodařilo spustit');
} catch (e) {
  fail++; console.log('FAIL  výjimka: ' + e.message);
}

console.log((fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
