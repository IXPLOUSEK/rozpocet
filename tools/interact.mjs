// tools/interact.mjs — chování, které se nedá ověřit staticky.
// Nejdůležitější je test kurzoru: překreslení při psaní ničí rozepsané číslo.
import { createRequire } from 'node:module';
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let PORT = 0;   // 0 = ať OS vybere volný port, testy si nelezou do zelí
const srv = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'rozpocet.html';
  try {
    const file = join(process.cwd(), rel);
    if (!statSync(file).isFile()) throw 0;
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch (e) { res.writeHead(404); res.end('404'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
PORT = srv.address().port;

const wantWebkit = process.argv.includes('--webkit');
let browser;
try { browser = await (wantWebkit ? pw.webkit : pw.chromium).launch(); }
catch (e) { browser = await pw.chromium.launch({ executablePath: '/usr/bin/google-chrome' }); }
const ctx = await browser.newContext({ ...pw.devices['iPhone 15'], locale: 'cs-CZ', timezoneId: 'Europe/Prague' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : (fail++, console.log('FAIL  ' + n + (d !== undefined ? '  ' + d : ''))); };

await page.goto(`http://127.0.0.1:${PORT}/rozpocet.html`, { waitUntil: 'load' });
await page.waitForTimeout(400);

// Nasadit kategorie přímo přes model, ať test nezávisí na uvítacím dialogu.
await page.evaluate(() => {
  const A = window.__APP__;
  A.seedForTest = true;
  const st = A.state();
  st.settings.welcomeDone = true;
});
await page.evaluate(() => {
  // Uvítací panel zavřít, pokud je otevřený.
  const b = document.querySelector('#sheet-host .btn');
  if (b) b.click();
});
await page.waitForTimeout(200);

// Přidat položku přes veřejné API modelu není vystavené, takže přes UI:
const addBtn = page.locator('#screen-month .sec-add').first();
ok('tlačítko přidat položku existuje', await addBtn.count() > 0);

// --- test kurzoru ---
// Nasyp řádek přímo do stavu a překresli, ať se testuje jen psaní.
await page.evaluate(() => {
  const A = window.__APP__, st = A.state();
  const y = st.years[String(st.activeYear)];
  const cat = { id: 'c_test', sec: 'daily', name: 'Jídlo', icon: '🛒', order: 10,
                recurring: true, dueDay: null, goal: null, archived: false,
                createdAt: new Date().toJSON(), updatedAt: new Date().toJSON() };
  y.catalog.push(cat);
  y.months[st.ui.month].entries.push({ id: 'e_test', cat: 'c_test', plan: 0, act: null,
    paid: false, paidAt: null, due: null, autoFilled: false, del: false, updatedAt: new Date().toJSON() });
  st.rev++;
  A.render();
});
await page.waitForTimeout(250);

const cell = page.locator('[data-id="e_test"] input[data-f="plan"]');
ok('testovací řádek se vykreslil', await cell.count() === 1);

if (await cell.count() === 1) {
  await cell.click();
  await page.waitForTimeout(120);
  const seq = '1234,50';
  let caretOk = true, valueOk = true;
  for (let i = 0; i < seq.length; i++) {
    await page.keyboard.type(seq[i]);
    await page.waitForTimeout(60);
    const st = await cell.evaluate(el => ({ v: el.value, s: el.selectionStart, focused: document.activeElement === el }));
    if (!st.focused || st.s !== i + 1) caretOk = false;
    if (st.v !== seq.slice(0, i + 1)) valueOk = false;
  }
  ok('kurzor při psaní neuteče', caretOk);
  ok('hodnota se během psaní nepřeformátuje', valueOk);

  // vložení číslice doprostřed
  await cell.evaluate(el => { el.value = '1234'; el.setSelectionRange(2, 2); });
  await page.keyboard.type('9');
  await page.waitForTimeout(80);
  const mid = await cell.evaluate(el => ({ v: el.value, s: el.selectionStart }));
  ok('vložení doprostřed', mid.v === '12934' && mid.s === 3, JSON.stringify(mid));

  // součet se přepočítá, zatímco je kurzor v poli
  const liveTotal = await page.evaluate(() => {
    const A = window.__APP__;
    return A.computeMonth(A.state().activeYear, A.state().ui.month).sections.daily.plan;
  });
  ok('součet se počítá i s kurzorem v poli', liveTotal === 1293400, liveTotal);

  await cell.evaluate(el => el.blur());
  await page.waitForTimeout(200);
  const disp = await page.locator('[data-id="e_test"] .cell-plan .amt-display').textContent();
  ok('po opuštění pole se zobrazí formátovaně', /12 934/.test(disp), JSON.stringify(disp));
}

// --- prázdné pole není nula ---
await page.evaluate(() => {
  const A = window.__APP__, st = A.state();
  const e = st.years[String(st.activeYear)].months[st.ui.month].entries.find(x => x.id === 'e_test');
  e.act = 50000; st.rev++; A.render();
});
await page.waitForTimeout(200);
const actCell = page.locator('[data-id="e_test"] input[data-f="act"]');
await actCell.click();
await page.keyboard.press('Meta+A').catch(() => {});
await actCell.evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); });
await page.waitForTimeout(250);
const cleared = await page.evaluate(() => {
  const A = window.__APP__, st = A.state();
  const e = st.years[String(st.activeYear)].months[st.ui.month].entries.find(x => x.id === 'e_test');
  return e.act;
});
ok('smazané pole je null, ne nula', cleared === null, JSON.stringify(cleared));

// --- přepínání měsíců nezdvojuje řádky ---
const before = await page.locator('#screen-month .row').count();
for (let r = 0; r < 2; r++) for (let m = 0; m < 12; m++) {
  await page.evaluate(mm => window.__APP__ && document.querySelector(`.chip-month[data-m="${mm}"]`).click(), m);
}
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.chip-month.is-active') || document.querySelector('.chip-month[data-m="8"]').click());
const after = await page.locator('#screen-month .row').count();
ok('24 přepnutí měsíce nezdvojilo řádky', after <= before, before + ' -> ' + after);

const ids = await page.evaluate(() => Array.from(document.querySelectorAll('#screen-month .row')).map(r => r.dataset.id));
ok('žádné id řádku dvakrát', new Set(ids).size === ids.length);

ok('žádná chyba v konzoli', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log((fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
