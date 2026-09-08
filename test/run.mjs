#!/usr/bin/env node
// test/run.mjs — jediný vstup do testů. Nulové závislosti, žádný npm install.
//
//   node test/run.mjs unit      čisté funkce a kontrakt (bez prohlížeče, ~2 s)
//   node test/run.mjs dom       ovládání na iPhonu: caret, dotyk, sticky, měsíce
//   node test/run.mjs storage   ukládání přes http:// (na file:// by to lhalo)
//   node test/run.mjs io        záloha, obnova, CSV
//   node test/run.mjs print     tisk do PDF
//   node test/run.mjs visual    30 snímků proti baseline
//   node test/run.mjs a11y      jazyk, jména, fokus, kontrast
//   node test/run.mjs all       všechno
//
// Přepínače:  --update-baseline  --no-build  --list  --webkit
//
// --webkit spustí celý běh znovu uvnitř kontejneru přes tools/wk.sh, protože
// WebKit od Playwrightu chce libicu74 a Fedora 44 má ICU 77 — ABI nesedí a
// `playwright install-deps` je jen pro apt. Bez --webkit jede všechno
// v Chromiu a chování skutečného Safari NIKDO neověřil.

process.env.TZ = process.env.TZ || 'Europe/Prague';

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { header, sub, warn, summarize } from './lib/harness.mjs';
import { startServer } from './lib/server.mjs';
import { playwrightReport, engineFor, pickErrors } from './lib/pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

const SUITES = ['unit', 'dom', 'storage', 'io', 'print', 'visual', 'a11y'];
const NEEDS_BROWSER = new Set(['dom', 'storage', 'io', 'print', 'visual', 'a11y']);

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const words = argv.filter(a => !a.startsWith('--'));
const wanted = words.length === 0 || words.includes('all') ? SUITES.slice() : words.filter(w => SUITES.includes(w));
const unknown = words.filter(w => w !== 'all' && !SUITES.includes(w));

if (flags.has('--list')) {
  console.log('suity: ' + SUITES.join(', ') + ', all');
  process.exit(0);
}
if (unknown.length) {
  console.error('Neznámá suita: ' + unknown.join(', ') + '\nZnám: ' + SUITES.join(', ') + ', all');
  process.exit(2);
}

const t0 = Date.now();
let server = null;
let exitCode = 0;

/* ── kontejner s opravdovým WebKitem ────────────────────────────────────────
   Hostitelský WebKit se spustit nedá (libicu74 vs. ICU 77). tools/wk.sh
   pustí tenhle skript v obrazu mcr.microsoft.com/playwright, kde WebKit jede.
   IN_WK hlídá, ať se to nezacyklí. */
const IN_CONTAINER = !!process.env.ROZPOCET_IN_WK || existsSync('/ms-playwright');

if (flags.has('--webkit') && !IN_CONTAINER) {
  const wk = join(ROOT, 'tools', 'wk.sh');
  if (!existsSync(wk)) {
    console.error(`--webkit potřebuje ${wk}, ten ale neexistuje.`);
    process.exit(2);
  }
  const pass = argv.filter(a => a !== '--webkit');
  console.log(`▌ spouštím v kontejneru s opravdovým WebKitem: tools/wk.sh test/run.mjs ${pass.join(' ')}`);
  const r = spawnSync(wk, ['test/run.mjs', ...pass], {
    cwd: ROOT, stdio: 'inherit',
    env: { ...process.env, ROZPOCET_IN_WK: '1' },
  });
  process.exit(r.status === null ? 2 : r.status);
}

async function main() {
  header(`rozpočet — testy (${wanted.join(', ')})`);
  sub(`node ${process.version} · TZ=${process.env.TZ} · ${ROOT}`);

  /* 1. build */
  if (!flags.has('--no-build')) {
    const b = spawnSync(process.execPath, [join(ROOT, 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
    if (b.status !== 0) {
      console.error('build.mjs spadl:\n' + (b.stderr || b.stdout));
      process.exit(2);
    }
    for (const l of String(b.stdout || '').trim().split('\n')) sub(l);
  }
  if (!existsSync(join(ROOT, 'rozpocet.html'))) {
    console.error('rozpocet.html neexistuje a build ho nevyrobil.');
    process.exit(2);
  }

  /* 2. fixtury */
  const fx = join(HERE, 'fixtures');
  if (!existsSync(fx)) mkdirSync(fx, { recursive: true });
  if (!existsSync(join(fx, 'realistic-year.json'))) {
    sub('generuji fixtury…');
    const g = spawnSync(process.execPath, [join(fx, 'gen.mjs')], { cwd: ROOT, encoding: 'utf8' });
    if (g.status !== 0) { console.error('gen.mjs spadl:\n' + (g.stderr || g.stdout)); process.exit(2); }
  }

  /* 3. prohlížeče */
  const needBrowser = wanted.some(w => NEEDS_BROWSER.has(w));
  let webkit = null, chromium = null, webkitReal = false;
  const engineNotes = [];
  if (needBrowser) {
    const rep = await playwrightReport();
    if (!rep.ok) {
      console.error('\n' + rep.report);
      console.error('\nBěží jen suita unit. Ostatní potřebují Playwright.');
      exitCode = 2;
    } else {
      for (const l of rep.report.split('\n')) sub(l);
      const wk = await engineFor('webkit', 'chromium');
      const ch = await engineFor('chromium', null);
      chromium = ch && ch.engine;
      if (wk) {
        webkit = wk.engine;
        if (wk.degraded) {
          const cmd = 'node test/run.mjs ' + wanted.join(' ') + ' --webkit';
          warn('WebKit se PŘÍMO NA HOSTITELI nespustí — tenhle běh jede v Chromiu.');
          sub('  Fedora 44 má ICU 77, tenhle build WebKitu chce ICU 74 (a libjpeg 8, libjxl 0.8,');
          sub('  libbacktrace). `playwright install-deps` je jen pro apt, takže tady nepomůže.');
          sub('');
          sub('  WebKit ale NENÍ nedostupný — běží v kontejneru a je ověřený:');
          sub('  → ' + cmd);
          sub('    (spustí tenhle běh přes tools/wk.sh v obrazu mcr.microsoft.com/playwright)');
          sub('');
          sub('  DOKUD to nespustíš takhle, chování Safari (caret, sticky, localStorage) nikdo neověřil.');
          engineNotes.push('běželo v Chromiu — pro Safari spusť: ' + cmd);
        } else {
          webkitReal = true;
          sub(`WebKit ${webkit.version} v pořádku.`);
        }
      } else {
        warn('Nenastartoval ani WebKit, ani Chromium. Prohlížečové suity se přeskočí.');
        for (const l of pickErrors('webkit').slice(0, 2)) sub('  ' + l);
      }
    }
  }

  /* 4. server nad ZMRAZENOU kopií
     Na projektu pracuje víc lidí naráz a `rozpocet.html` se přestavuje
     i během běhu testů. Když se servíruje přímo z kořene, může si suita
     v půlce běhu sáhnout na jiný soubor, než na kterém začala — vizuální
     testy pak hlásí desítky rozdílů, které nikdo neudělal. Kopie se udělá
     jednou na začátku a po celý běh se nemění. */
  if (needBrowser && (webkit || chromium)) {
    const snapDir = join(HERE, '.out', 'serve');
    mkdirSync(snapDir, { recursive: true });
    for (const f of ['rozpocet.html', 'sw.js', 'index.html', 'manifest.webmanifest']) {
      const from = join(ROOT, f);
      if (existsSync(from)) copyFileSync(from, join(snapDir, f));
    }
    const stamp = createHash('md5').update(readFileSync(join(snapDir, 'rozpocet.html'))).digest('hex').slice(0, 8);
    server = await startServer(snapDir);
    // Port přiděluje systém (listen(0)). Pevné číslo je sdílený zdroj:
    // buď ho něco drží, nebo se testy tiše připojí na cizí server.
    sub(`server ${server.origin} · zmrazená kopie ${stamp} v test/.out/serve/`);
  }

  /* 5. suity */
  const suites = [];
  const opts = {
    webkit, chromium, webkitReal, root: ROOT, here: HERE,
    origin: server ? server.origin : null,
    updateBaseline: flags.has('--update-baseline'),
    engineNotes,
  };

  for (const name of wanted) {
    if (NEEDS_BROWSER.has(name) && !(webkit || chromium)) {
      warn(`suita ${name} přeskočena — není prohlížeč`);
      continue;
    }
    let mod;
    try {
      mod = await import('./suites/' + name + '.mjs');
    } catch (e) {
      console.error(`suita ${name} se nedá načíst: ${e.message}`);
      exitCode = 2;
      continue;
    }
    try {
      const s = await mod.run(opts);
      if (s) suites.push(Array.isArray(s) ? s : s);
    } catch (e) {
      console.error(`\nsuita ${name} spadla jako celek:\n${(e && e.stack) || e}`);
      exitCode = 2;
    }
  }

  const flat = suites.flat();
  const total = summarize(flat);
  for (const n of engineNotes) warn(n);
  console.log(`\nhotovo za ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (total.fail > 0) exitCode = 1;
}

async function shutdown() {
  if (server) await server.stop();
}

main()
  .catch((e) => { console.error('\n' + ((e && e.stack) || e)); exitCode = 2; })
  .finally(async () => { await shutdown(); process.exit(exitCode); });
