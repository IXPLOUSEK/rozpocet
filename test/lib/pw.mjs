// test/lib/pw.mjs — najde Playwright a spustí prohlížeč, který na tomhle stroji
// opravdu nastartuje. Nulové závislosti, žádný npm install.
//
// Na téhle Fedoře je nainstalováno několik kopií Playwrightu (npx cache,
// globální node_modules) a NE každá má stažené prohlížeče, které umí spustit.
// Proto se browser nevybírá podle verze, ale podle toho, jestli reálně nabootuje.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();

function pkgVersion(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version; }
  catch { return '?'; }
}

/** Všechna místa, kde tu Playwright může ležet. Pořadí = preference. */
export function candidateModules() {
  const out = [];
  const push = (p) => {
    if (!p) return;
    if (!existsSync(join(p, 'package.json'))) return;
    if (!out.includes(p)) out.push(p);
  };

  if (process.env.PLAYWRIGHT_MODULE) push(process.env.PLAYWRIGHT_MODULE);

  // 1) lokální node_modules projektu (kdyby si je někdo přece jen nainstaloval)
  push(join(process.cwd(), 'node_modules', 'playwright'));

  // 2) npx cache — tam obvykle sedí ta nejnovější verze
  const npx = join(HOME, '.npm', '_npx');
  if (existsSync(npx)) {
    let dirs = [];
    try { dirs = readdirSync(npx); } catch { dirs = []; }
    const found = [];
    for (const d of dirs) {
      const p = join(npx, d, 'node_modules', 'playwright');
      if (existsSync(join(p, 'package.json'))) found.push(p);
    }
    // novější verze první
    found.sort((a, b) => cmpVer(pkgVersion(b), pkgVersion(a)));
    found.forEach(push);
  }

  // 3) globální node_modules (přímo i uvnitř @playwright/mcp)
  for (const g of [join(HOME, '.local', 'lib', 'node_modules'), '/usr/lib/node_modules', '/usr/local/lib/node_modules']) {
    push(join(g, 'playwright'));
    push(join(g, '@playwright', 'mcp', 'node_modules', 'playwright'));
    push(join(g, '@playwright', 'test', 'node_modules', 'playwright'));
  }

  return out;
}

function cmpVer(a, b) {
  const pa = String(a).split(/[.-]/).map(n => (/^\d+$/.test(n) ? +n : -1));
  const pb = String(b).split(/[.-]/).map(n => (/^\d+$/.test(n) ? +n : -1));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

const _modCache = new Map();
async function loadModule(dir) {
  if (_modCache.has(dir)) return _modCache.get(dir);
  let mod = null;
  for (const entry of ['index.mjs', 'index.js']) {
    const p = join(dir, entry);
    if (!existsSync(p)) continue;
    try { mod = await import('file://' + p); break; } catch { /* zkus další */ }
  }
  _modCache.set(dir, mod);
  return mod;
}

/**
 * @returns {Promise<{ok:boolean, dirs:string[], report:string}>}
 */
export async function playwrightReport() {
  const dirs = candidateModules();
  const lines = dirs.map(d => `  ${pkgVersion(d)}  ${d}`);
  return {
    ok: dirs.length > 0,
    dirs,
    report: dirs.length
      ? 'Playwright nalezen:\n' + lines.join('\n')
      : 'Playwright NENALEZEN. Zkoušel jsem: node_modules/playwright, ~/.npm/_npx/*/node_modules/playwright,\n'
        + '~/.local/lib/node_modules/{playwright,@playwright/mcp/node_modules/playwright}.\n'
        + 'Nastav PLAYWRIGHT_MODULE=/cesta/k/node_modules/playwright a spusť znovu.',
  };
}

const _browserPick = new Map();   // kind -> {mod, dir, version} | null
const _pickErrors = new Map();    // kind -> string[]

/** Systémové prohlížeče, kterými se dá zachránit nesedící stažený balík. */
const SYSTEM_CHROME = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

/**
 * Vybere pro daný typ prohlížeče tu kopii Playwrightu, která ho fakt spustí.
 *
 * Na tomhle stroji nesedí verze staženého balíku prohlížečů s verzí
 * playwrightu, takže se nestačí zeptat na `require('playwright')` — musí se
 * to zkusit spustit. Když neuspěje ani jeden stažený Chromium, sáhne se po
 * systémovém Chrome. Výsledek se cachuje na proces (spouštění je drahé).
 */
export async function pickEngine(kind /* 'webkit' | 'chromium' */) {
  if (_browserPick.has(kind)) return _browserPick.get(kind);
  const errs = [];
  let chosen = null;

  for (const dir of candidateModules()) {
    const mod = await loadModule(dir);
    if (!mod || !mod[kind]) { errs.push(`${dir}: modul nejde načíst`); continue; }
    try {
      const b = await mod[kind].launch({ headless: true });
      await b.close();
      chosen = { mod, dir, version: pkgVersion(dir), type: mod[kind], launchOpts: {}, system: false };
      break;
    } catch (e) {
      errs.push(`${pkgVersion(dir)} @ ${dir}:\n    ` + firstLines(e, 6));
    }
  }

  // Záchranná brzda: stažený Chromium nesedí, ale v systému je Chrome.
  if (!chosen && kind === 'chromium') {
    for (const dir of candidateModules()) {
      const mod = await loadModule(dir);
      if (!mod || !mod.chromium) continue;
      for (const exe of SYSTEM_CHROME) {
        if (!existsSync(exe)) continue;
        try {
          const b = await mod.chromium.launch({ headless: true, executablePath: exe });
          await b.close();
          chosen = {
            mod, dir, version: pkgVersion(dir),
            type: wrapWithExe(mod.chromium, exe),
            launchOpts: { executablePath: exe }, system: exe,
          };
          break;
        } catch (e) { errs.push(`systémový ${exe}: ` + firstLines(e, 2)); }
      }
      if (chosen) break;
    }
  }

  _browserPick.set(kind, chosen);
  _pickErrors.set(kind, errs);
  return chosen;
}

/** BrowserType, který si k launch() vždycky přibalí cestu k systémovému Chrome. */
function wrapWithExe(type, exe) {
  return {
    name: () => type.name(),
    launch: (o) => type.launch({ ...(o || {}), executablePath: exe }),
    launchPersistentContext: (d, o) => type.launchPersistentContext(d, { ...(o || {}), executablePath: exe }),
    connect: (...a) => type.connect(...a),
    executablePath: () => exe,
  };
}

export function pickErrors(kind) { return _pickErrors.get(kind) || []; }

function firstLines(e, n) {
  return String(e && e.message ? e.message : e)
    .split('\n').filter(Boolean).slice(0, n).map(s => s.trim()).join(' / ');
}

/**
 * Vrátí engine pro `want`, případně s degradací na `fallback`.
 * @returns {Promise<{engine:object, kind:string, degraded:boolean, note:string}|null>}
 */
export async function engineFor(want, fallback) {
  const first = await pickEngine(want);
  if (first) return { engine: first, kind: want, degraded: false, note: '' };
  const errs = pickErrors(want);
  if (!fallback) return null;
  const second = await pickEngine(fallback);
  if (!second) return null;
  return {
    engine: second,
    kind: fallback,
    degraded: true,
    note: `${want} na tomhle stroji nenastartoval, běží ${fallback}. Důvod:\n    ` + (errs[0] || 'neznámý'),
  };
}

export async function devicesFrom(engine) {
  const mod = engine && engine.mod;
  return (mod && mod.devices) || {};
}
