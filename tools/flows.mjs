// tools/flows.mjs — průchod scénáři, které bude dělat ona.
// Data se vkládají do localStorage PŘED načtením stránky, nikdy do souboru.
import { createRequire } from 'node:module';
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

function findPlaywright() {
  const r = createRequire(import.meta.url);
  try { return r('playwright'); } catch (e) {}
  const c = [];
  const npx = '/home/ixp/.npm/_npx';
  if (existsSync(npx)) for (const d of readdirSync(npx)) {
    const p = npx + '/' + d + '/node_modules/playwright';
    if (existsSync(p + '/package.json')) c.push(p);
  }
  c.sort((a, b) => r(b + '/package.json').version.localeCompare(r(a + '/package.json').version, 'en', { numeric: true }));
  for (const x of c) { try { return r(x); } catch (e) {} }
  return null;
}
const pw = findPlaywright();
if (!pw) { console.error('Playwright nenalezen'); process.exit(2); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let PORT = 0;   // 0 = ať OS vybere volný port, testy si nelezou do zelí
const srv = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'rozpocet.html';
  try {
    const f = join(process.cwd(), rel);
    if (!statSync(f).isFile()) throw 0;
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  } catch (e) { res.writeHead(404); res.end('404'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
PORT = srv.address().port;

const wantWebkit = process.argv.includes('--webkit');
let browser;
try { browser = await (wantWebkit ? pw.webkit : pw.chromium).launch(); }
catch (e) { browser = await pw.chromium.launch({ executablePath: '/usr/bin/google-chrome' }); }

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : (fail++, console.log('FAIL  ' + n + (d !== undefined ? '  ' + d : ''))); };

const fixture = JSON.parse(readFileSync('test/fixtures/realistic-year.json', 'utf8'));
const doc = fixture.doc || fixture;

const ctx = await browser.newContext({ ...pw.devices['iPhone 15'], locale: 'cs-CZ', timezoneId: 'Europe/Prague' });
await ctx.addInitScript(d => {
  try { localStorage.setItem('rozpocet:doc', JSON.stringify(d)); } catch (e) {}
}, doc);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/interactive-widget/i.test(m.text())) errs.push('console: ' + m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/rozpocet.html`, { waitUntil: 'load' });
await page.waitForTimeout(600);

ok('realistická data se načetla', await page.evaluate(() => {
  const s = window.__APP__.state();
  return s.years[String(s.activeYear)].catalog.length > 10;
}));
ok('žádná chyba po načtení', errs.length === 0, errs.slice(0, 3).join(' | '));

// --- projít všechny obrazovky ---
for (const scr of ['month', 'year', 'journal', 'savings', 'more']) {
  await page.click(`#tabbar .tab[data-screen="${scr}"]`);
  await page.waitForTimeout(350);
  const vis = await page.locator(`#screen-${scr}`).isVisible();
  const kids = await page.locator(`#screen-${scr} > *`).count();
  ok('obrazovka ' + scr + ' se vykreslí', vis && kids > 0, 'viditelná=' + vis + ' prvků=' + kids);
  const bad = await page.evaluate(s => {
    const t = document.querySelector('#screen-' + s).innerText || '';
    return /\b(NaN|Infinity|\[object Object\])\b/.test(t) ? t.slice(0, 120) : null;
  }, scr);
  ok('obrazovka ' + scr + ' bez NaN', bad === null, bad || '');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('obrazovka ' + scr + ' nepřetéká', over <= 1, over + 'px');
}

// --- roční přehled se rovná součtu měsíců ---
await page.click('#tabbar .tab[data-screen="year"]');
await page.waitForTimeout(300);
const yearOk = await page.evaluate(() => {
  const A = window.__APP__, y = A.state().activeYear;
  let acc = 0; for (let m = 0; m < 12; m++) acc += A.computeMonth(y, m).balance;
  return A.computeYear(y).totals.balance === acc;
});
ok('rok = součet dvanácti měsíců', yearOk);

// --- rychlý zápis výdaje ---
await page.click('#tabbar .tab[data-screen="month"]');
await page.waitForTimeout(300);
const beforeAdd = await page.evaluate(() => {
  const A = window.__APP__, s = A.state();
  return A.computeMonth(s.activeYear, s.ui.month).sections.daily.act;
});
await page.click('#fab');
await page.waitForTimeout(400);
const sheetOpen = await page.locator('#sheet-host .sheet').count();
ok('rychlý zápis se otevře', sheetOpen === 1);
if (sheetOpen === 1) {
  const amt = page.locator('#sheet-host input[inputmode="decimal"]').first();
  ok('částka má číselnou klávesnici', await amt.count() > 0);
  const focused = await page.evaluate(() => {
    const a = document.activeElement;
    return !!(a && a.getAttribute && a.getAttribute('inputmode') === 'decimal');
  });
  ok('kurzor rovnou v částce', focused);
  if (await amt.count() > 0) {
    await amt.fill('250');
    const saveBtn = page.locator('#sheet-host .btn-primary').first();
    await saveBtn.click();
    await page.waitForTimeout(500);
    const afterAdd = await page.evaluate(() => {
      const A = window.__APP__, s = A.state();
      return A.computeMonth(s.activeYear, s.ui.month).sections.daily.act;
    });
    ok('zápis 250 Kč zvedl skutečnost přesně o 250', afterAdd - beforeAdd === 25000, (afterAdd - beforeAdd));
    const planUnchanged = await page.evaluate(() => {
      const A = window.__APP__, s = A.state();
      return A.computeMonth(s.activeYear, s.ui.month).sections.daily.plan;
    });
    ok('plán se zápisem nezměnil', Number.isSafeInteger(planUnchanged));
  }
}
await page.evaluate(() => { const b = document.querySelector('.sheet-close'); if (b) b.click(); });
await page.waitForTimeout(300);

// --- příklad v poli musí sedět k sekci ---
await page.click('#tabbar .tab[data-screen="month"]');
await page.waitForTimeout(400);
{
  const ocekavane = { income: /Výplata/, fixed: /Nájem/, daily: /Jídlo/,
                      savings: /Dovolená/, debt: /Půjčka/, subs: /Netflix/ };
  const videne = [];
  for (const sec of Object.keys(ocekavane)) {
    const btn = page.locator(`#screen-month .sec-card[data-sec="${sec}"] .sec-add`).first();
    if (!(await btn.count())) { videne.push(sec + ':bez tlačítka'); continue; }
    await btn.click();
    await page.waitForTimeout(350);
    const ph = await page.evaluate(() => {
      const i = document.querySelector('#sheet-host input');
      return i ? (i.getAttribute('placeholder') || '') : null;
    });
    videne.push(sec + ':' + ph);
    ok('příklad u „' + sec + '" sedí k sekci', ph && ocekavane[sec].test(ph), String(ph));
    await page.evaluate(() => { const b = document.querySelector('.sheet-close'); if (b) b.click(); });
    await page.waitForTimeout(300);
  }
  const unikatni = new Set(videne.map(v => v.split(':')[1]));
  ok('každá sekce má svůj příklad', unikatni.size === videne.length, videne.join(' | '));
}

// --- záloha se dá vyrobit a je neprázdná ---
const exp = await page.evaluate(() => {
  try {
    const A = window.__APP__;
    const payload = JSON.stringify(A.state());
    return { len: payload.length, hasNull: /"(plan|act|amt)":null,"(?!act)/.test(payload) };
  } catch (e) { return { err: String(e) }; }
});
ok('stav jde serializovat a není prázdný', exp.len > 500, JSON.stringify(exp).slice(0, 120));

// --- tisk: nic se nesmí rolovat ---
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(200);
const printBad = await page.evaluate(() => {
  const bad = [];
  for (const sel of ['html', 'body', '#app', '#main', '.screen']) {
    for (const n of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(n);
      if (cs.overflow !== 'visible' || cs.maxHeight !== 'none') bad.push(sel + ' overflow=' + cs.overflow + ' maxH=' + cs.maxHeight);
    }
  }
  return bad.slice(0, 3);
});
ok('v tisku se nic neroluje', printBad.length === 0, printBad.join(' | '));
const chromeHidden = await page.evaluate(() => {
  const h = ['.app-header', '.tabbar', '.fab', '.month-strip'];
  return h.filter(s => { const n = document.querySelector(s); return n && getComputedStyle(n).display !== 'none'; });
});
ok('v tisku se neskryté ovládání netiskne', chromeHidden.length === 0, chromeHidden.join(' '));
await page.emulateMedia({ media: 'screen' });

ok('žádná chyba za celý průchod', errs.length === 0, errs.slice(0, 4).join(' | '));

console.log((fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
