// test/lib/page.mjs — otevření appky v prohlížeči, nasypání fixtury,
// hlídání chyb a zjištění, jestli už appka vůbec něco vykresluje.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN } from './server.mjs';

export const TEST_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const ROOT = dirname(TEST_DIR);
export const FIXTURES = join(TEST_DIR, 'fixtures');
export const APP_FILE = join(ROOT, 'rozpocet.html');

// I file:// test čte ZMRAZENOU kopii, když existuje — jinak by si mohl
// sáhnout na soubor zrovna přepisovaný jinou lane a spadnout na půlce HTML.
export function appFileUrl() {
  const snap = join(TEST_DIR, '.out', 'serve', 'rozpocet.html');
  return 'file://' + (existsSync(snap) ? snap : APP_FILE);
}
export const APP_FILE_URL = 'file://' + APP_FILE;

// Port je přidělený až při startu serveru (listen(0)), takže adresa se NESMÍ
// spočítat při načtení modulu — v tu chvíli je ORIGIN prázdný. `ORIGIN` je
// živá vazba ze server.mjs, tohle ji čte až ve chvíli použití.
export function appUrl(path = '/rozpocet.html') {
  if (!ORIGIN) throw new Error('server ještě neběží — appUrl() se volá až po startServer()');
  return ORIGIN + path;
}

/** Klíče čteme ze src/30-config.js, ať se testy nerozejdou s aplikací. */
function constFromConfig(name, fallback) {
  try {
    const src = readFileSync(join(ROOT, 'src', '30-config.js'), 'utf8');
    const m = new RegExp(`const\\s+${name}\\s*=\\s*'([^']*)'`).exec(src);
    return m ? m[1] : fallback;
  } catch { return fallback; }
}
export const STORE_KEY = constFromConfig('STORE_KEY', 'rozpocet:doc');
export const BACKUP_KEY = constFromConfig('BACKUP_KEY', 'rozpocet:doc:backup');
export const SNAP_PREFIX = constFromConfig('SNAP_PREFIX', 'rozpocet:snap:');
export const QUAR_PREFIX = constFromConfig('QUAR_PREFIX', 'rozpocet:quarantine:');

export function fixturePath(name) { return join(FIXTURES, name.endsWith('.json') ? name : name + '.json'); }
export function readFixture(name) {
  const p = fixturePath(name);
  if (!existsSync(p)) throw new Error(`chybí fixtura ${p} — spusť: node test/fixtures/gen.mjs`);
  return readFileSync(p, 'utf8');
}

const BENIGN = [
  /favicon\.ico/i,
  /Failed to load resource.*favicon/i,
  /ServiceWorker.*(unsupported|not supported)/i,
];

/**
 * Otevře appku.
 * @param {object} eng  výsledek pickEngine()
 * @param {object} o
 *   o.device      objekt z devices['iPhone 15'] (nepovinné)
 *   o.viewport    {width,height}
 *   o.theme       'light' | 'dark'
 *   o.fixture     jméno fixtury nebo raw string, nasype se do localStorage[STORE_KEY]
 *   o.seed        {klíč: hodnota} další položky do localStorage
 *   o.initScript  string – kód spuštěný PŘED načtením stránky (patch API apod.)
 *   o.url         cílová adresa (default appUrl())
 *   o.hash        '#test'
 *   o.goto        false = neotvírej stránku, jen vrať page
 */
export async function openApp(eng, o = {}) {
  const browser = await eng.type.launch({ headless: true });
  const ctxOpts = {
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    colorScheme: o.theme === 'dark' ? 'dark' : 'light',
    reducedMotion: 'reduce',
    ...(o.device || {}),
  };
  if (o.viewport) { ctxOpts.viewport = o.viewport; delete ctxOpts.screen; }
  if (o.acceptDownloads) ctxOpts.acceptDownloads = true;
  if (o.downloadsPath) ctxOpts.acceptDownloads = true;

  const ctx = await browser.newContext(ctxOpts);

  const errors = { console: [], page: [], requests: [] };

  // 1) nejdřív patche API (kvóta, SecurityError), pak teprve data
  if (o.initScript) await ctx.addInitScript({ content: o.initScript });

  // 2) fixtura do localStorage PŘED načtením stránky.
  //    Nikdy se nezapéká do doručeného HTML.
  if (o.fixture || o.seed) {
    const raw = o.fixture
      ? (o.fixture.trim && o.fixture.trim().startsWith('{') ? o.fixture : readFixture(o.fixture))
      : null;
    const seed = o.seed || null;
    await ctx.addInitScript({
      content: `(function(){try{
        var K=${JSON.stringify(STORE_KEY)};
        var raw=${raw === null ? 'null' : JSON.stringify(raw)};
        if(raw!==null) localStorage.setItem(K, raw);
        var seed=${seed === null ? 'null' : JSON.stringify(seed)};
        if(seed) for(var k in seed) localStorage.setItem(k, seed[k]);
      }catch(e){ (window.__seedError=window.__seedError||[]).push(String(e)); }})();`,
    });
  }

  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const t = m.text();
    if (BENIGN.some(re => re.test(t))) return;
    if (m.type() === 'error') errors.console.push(t);
  });
  page.on('pageerror', (e) => errors.page.push(String((e && e.stack) || e)));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (BENIGN.some(re => re.test(u))) return;
    errors.requests.push(u + ' — ' + ((r.failure() && r.failure().errorText) || '?'));
  });

  const url = (o.url || appUrl()) + (o.hash || '');
  if (o.goto !== false) {
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await settle(page);
  }

  const close = async () => { try { await ctx.close(); } catch { /**/ } try { await browser.close(); } catch { /**/ } };
  return { browser, ctx, page, errors, close, url };
}

/** Počká, až se appka přestane překreslovat. */
export async function settle(page, ms = 260) {
  try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch { /**/ }
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    .catch(() => { });
  await page.waitForTimeout(ms);
}

/** Co z appky už existuje? Podle toho se rozhoduje PASS vs. SKIP. */
export async function probeApp(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const screens = Array.from(document.querySelectorAll('.screen')).map(s => ({
      id: s.id, active: s.classList.contains('is-active'), kids: s.children.length,
    }));
    return {
      sections: q('.sec-card'),
      rows: q('.row[data-id]'),
      amtInputs: q('input.amt'),
      chips: q('.chip-month'),
      tx: q('.tx[data-id]'),
      goals: q('.goal-card'),
      addBtns: q('.sec-add'),
      cssLoaded: getComputedStyle(document.body).margin !== '' &&
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() !== '',
      screens,
      bodyText: (document.body.innerText || '').length,
      booted: q('.sec-card') > 0 || q('.chip-month') > 0,
    };
  });
}

/** Základní hlídka pro každou suitu: nula neodchycených chyb, nula chyb v konzoli. */
export function errorBaseline(suite, errors, label = '') {
  return suite.test(`nula chyb na stránce${label ? ' — ' + label : ''}`, async () => {
    const bad = [
      ...errors.page.map(e => 'pageerror: ' + e.split('\n')[0]),
      ...errors.console.map(e => 'console.error: ' + e),
      ...errors.requests.map(e => 'requestfailed: ' + e),
    ];
    if (bad.length) {
      const err = new Error(`stránka vyhodila ${bad.length} chyb:\n` + bad.slice(0, 8).map(s => '        · ' + s).join('\n'));
      err.name = 'AssertionError';
      throw err;
    }
  });
}

/** Fragmenty, které build hlásí jako chybějící — kvůli hláškám u SKIPů. */
export function missingFragments() {
  const out = [];
  const need = ['10-tokens.css', '11-base.css', '12-shell.css', '13-components.css', '14-charts.css',
    '15-print.css', '32-storage.js', '33-model.js', '34-derived.js', '40-charts.js', '50-month.js',
    '51-journal.js', '52-due-goals.js', '53-io.js', '54-year-more.js', '55-sync.js', '60-events.js',
    '61-sheets.js', '70-selftest.js', '80-boot.js'];
  for (const n of need) if (!existsSync(join(ROOT, 'src', n))) out.push(n);
  return out;
}
