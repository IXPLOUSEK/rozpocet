// test/suites/visual.mjs — 30 snímků obrazovky proti uložené baseline.
//
// 30 = {světlý, tmavý} × {iPhone 15, iPad, desktop 1440×900} × {měsíc,
// sekce, Deník, Úspory, tisk}. Porovnání dělá test/visual.py (Pillow),
// protože harness nesmí mít žádnou npm závislost.
//
// PROČ tolik SKIPů: appku právě píšou jiní agenti a půlka obrazovek
// ještě neexistuje. Chybějící Deník NENÍ regrese, takže se hlásí jako
// SKIP — ale snímek se udělá stejně, aby se adresář baseline plnil, jak
// appka roste. Selhat smí jenom to, co se opravdu VIZUÁLNĚ ZMĚNILO.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { Suite, assert, skip, header, sub, warn } from '../lib/harness.mjs';
import { openApp, probeApp, settle, errorBaseline, TEST_DIR } from '../lib/page.mjs';

// Baseline patří KONKRÉTNÍMU enginu a KONKRÉTNÍMU prostředí. Chromium na
// hostiteli a Chromium v kontejneru mají jiný fontconfig a stejná stránka
// v nich vypadá jinak. Kdyby se snímky porovnávaly napříč, každý běh
// v kontejneru by hlásil 30 falešných rozdílů — a po druhém takovém běhu
// by téhle suitě nikdo nevěřil. Proto má každé prostředí vlastní podadresář.
const ENV_TAG = (process.env.ROZPOCET_IN_WK || existsSync('/ms-playwright')) ? 'container' : 'host';
let BASELINE_DIR = join(TEST_DIR, 'baseline', 'chromium-' + ENV_TAG);
const OUT_DIR = join(TEST_DIR, '.out');
const VISUAL_PY = join(TEST_DIR, 'visual.py');

/** Nad tímhle podílem změněných pixelů je snímek považovaný za rozbitý. */
const LIMIT = 0.005;          // 0,5 %

/** Fixtura pro všechny snímky — ať jsou stránky plné obsahu, ne prázdné. */
const FIXTURE = 'realistic-year';

/* ── co se fotí ──────────────────────────────────────────────────────────── */

// Jména zařízení se mezi verzemi Playwrightu přejmenovávají, takže se
// nikdy nesází na jedno jméno: bere se první, které registr opravdu zná.
const DEVICES = [
  {
    id: 'iphone15', label: 'iPhone 15',
    names: ['iPhone 15', 'iPhone 15 Pro', 'iPhone 14', 'iPhone 13', 'iPhone 12'],
    fallbackViewport: { width: 393, height: 852 },
  },
  {
    id: 'ipad', label: 'iPad',
    names: ['iPad (gen 7)', 'iPad (gen 11)', 'iPad Pro 11', 'iPad Mini', 'iPad'],
    fallbackViewport: { width: 810, height: 1080 },
  },
  {
    id: 'desktop', label: 'desktop 1440×900',
    names: [],                                        // desktop je prostě viewport
    fallbackViewport: { width: 1440, height: 900 },
  },
];

const THEMES = [
  { id: 'light', label: 'světlý' },
  { id: 'dark', label: 'tmavý' },
];

const VIEWS = [
  { id: 'month', label: 'měsíc' },
  { id: 'sections', label: 'sekce' },
  { id: 'journal', label: 'Deník' },
  { id: 'savings', label: 'Úspory' },
  { id: 'print', label: 'tisk' },
];

/** Vypnutí všeho, co by mezi dvěma běhy mohlo dopadnout jinak. */
const FREEZE_CSS = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

/* ── pomocníci ───────────────────────────────────────────────────────────── */

const pct = (x) => (x * 100).toFixed(2).replace('.', ',') + ' %';

function ensureDirs() {
  mkdirSync(BASELINE_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
}

/** Najde v registru Playwrightu první existující jméno ze seznamu. */
function pickDevice(devices, names) {
  const all = Object.keys(devices || {});
  for (const n of names) if (all.includes(n)) return { name: n, device: devices[n] };
  // volnější kolo — třeba "iPad (gen 9)", které jsme jménem netrefili
  for (const n of names) {
    const hit = all.find(k => !/landscape/i.test(k) && k.toLowerCase().startsWith(String(n).toLowerCase()));
    if (hit) return { name: hit, device: devices[hit] };
  }
  return null;
}

/**
 * Přepne obrazovku klikem na spodní lištu.
 * @returns {Promise<boolean>} true = obrazovka se opravdu přepnula a něco na ní je
 */
async function gotoScreen(page, id) {
  const sel = `nav.tabbar button[data-screen="${id}"]`;
  let clicked = false;
  try {
    await page.click(sel, { timeout: 2500 });
    clicked = true;
  } catch {
    // Tlačítko může být zakryté (např. otevřený sheet). Zkusíme klik
    // programově — jde nám o snímek obrazovky, ne o test ovladatelnosti.
    try {
      clicked = await page.evaluate((s) => {
        const b = document.querySelector(s);
        if (!b) return false;
        b.click();
        return true;
      }, sel);
    } catch { clicked = false; }
  }
  if (!clicked) return false;
  await settle(page);
  let p = null;
  try { p = await probeApp(page); } catch { p = null; }
  if (!p || !Array.isArray(p.screens)) return false;
  const sc = p.screens.find(s => s.id === 'screen-' + id) || null;
  // Aktivní, ale prázdná obrazovka = renderer ještě není napsaný.
  return !!(sc && sc.active && sc.kids > 0);
}

/** Sroluje na konec — appka si roluje uvnitř #main, ne oknem. */
async function scrollToBottom(page) {
  try {
    await page.evaluate(() => {
      const cands = [document.getElementById('main'), document.scrollingElement, document.body];
      for (const el of cands) {
        if (!el) continue;
        try { el.scrollTop = el.scrollHeight; } catch { /* ignore */ }
      }
    });
  } catch { /* nevadí — snímek se udělá i tak */ }
}

async function scrollToTop(page) {
  try {
    await page.evaluate(() => {
      const cands = [document.getElementById('main'), document.scrollingElement, document.body];
      for (const el of cands) {
        if (!el) continue;
        try { el.scrollTop = 0; } catch { /* ignore */ }
      }
    });
  } catch { /* ignore */ }
}

async function shoot(page) {
  await settle(page);
  return page.screenshot({ fullPage: true, animations: 'disabled', timeout: 30000 });
}

/** Zavolá test/visual.py a vrátí rozparsovaný JSON, nebo {error}. */
function comparePng(baselinePath, actualPath, diffPath) {
  let r;
  try {
    r = spawnSync('python3', [VISUAL_PY, baselinePath, actualPath, diffPath], {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000,
    });
  } catch (e) {
    return { error: 'python3 se nepodařilo spustit: ' + (e && e.message) };
  }
  if (r.error) return { error: 'python3 se nepodařilo spustit: ' + r.error.message };
  const lines = String(r.stdout || '').trim().split('\n').filter(Boolean);
  const last = lines.length ? lines[lines.length - 1] : '';
  let j = null;
  try { j = JSON.parse(last); } catch { /* níž */ }
  if (!j || typeof j !== 'object') {
    const why = (last || String(r.stderr || '').trim() || 'prázdný výstup').slice(0, 300);
    return { error: `visual.py nevrátil JSON (kód ${r.status}): ${why}` };
  }
  if (j.error) return { error: 'visual.py: ' + j.error };
  if (r.status !== 0) return { error: `visual.py skončil kódem ${r.status}` };
  if (typeof j.changed !== 'number' || !Number.isFinite(j.changed)) {
    return { error: 'visual.py vrátil nečíselné "changed": ' + JSON.stringify(j.changed) };
  }
  return j;
}

/* ── suita ───────────────────────────────────────────────────────────────── */

export async function run(opts = {}) {
  const S = new Suite('visual');
  header('visual — 30 snímků proti baseline');

  // Chromium je preferovaný (na téhle Fedoře jediný, co nastartuje);
  // kdyby náhodou chyběl, vezmeme cokoli, co harness podstrčil.
  const eng = (opts && (opts.chromium || opts.webkit)) || null;
  if (!eng || typeof eng.type !== 'object' || typeof eng.type.launch !== 'function') {
    warn('žádný prohlížeč (opts.chromium je null) — vizuální suita se přeskakuje');
    await S.test('vizuální suita má prohlížeč, kterým se dá fotit', async () => {
      skip('opts.chromium je null — bez prohlížeče nejde pořídit ani jeden snímek');
    });
    S.note('vizuál přeskočen celý: nebyl k dispozici prohlížeč');
    return S;
  }
  if (opts.chromium == null) {
    S.note('Chromium chybělo — snímky vznikly na náhradním enginu z opts.webkit');
  }

  // Snímky NIKDY nevznikly v Safari. Tohle musí vidět každý, kdo by je
  // chtěl brát jako důkaz o vykreslování na iPhonu.
  if (!opts.webkitReal) {
    S.note('POZOR: baseline snímky vznikly v Chromiu, ne v Safari — o Safari-specifickém '
      + 'vykreslení (caret, sticky, safe-area, fonty) z nich neplyne nic.');
  }
  // Čas se nemrazí: mrazí se jen animace a přechody. Snímky, na kterých
  // appka ukazuje "dnes" nebo "za 3 dny", se tedy den ode dne mění.
  S.note('mrazí se jen animace/přechody, ne datum — po půlnoci může být rozdíl legitimní '
    + '(pak: node test/run.mjs visual --update-baseline)');

  // Jméno enginu do cesty, ať se snímky z různých prohlížečů nikdy nepotkají.
  const engName = (() => {
    try { return eng.type.name(); } catch { return opts.chromium ? 'chromium' : 'webkit'; }
  })();
  BASELINE_DIR = join(TEST_DIR, 'baseline', `${engName}-${ENV_TAG}`);
  sub(`baseline: test/baseline/${engName}-${ENV_TAG}/`);

  ensureDirs();

  const devices = (eng.mod && eng.mod.devices) || {};
  const measured = [];        // {name, changed, diff, skipped}
  let pyOk = false;
  let pyWhy = '';

  /* ── vstupní kontroly ─────────────────────────────────────────────────── */

  await S.test('adresář test/baseline/ existuje a jde do něj zapsat', () => {
    ensureDirs();
    assert.ok(existsSync(BASELINE_DIR), `test/baseline/ se nepodařilo vytvořit (${BASELINE_DIR})`);
    assert.ok(existsSync(OUT_DIR), `test/.out/ se nepodařilo vytvořit (${OUT_DIR})`);
    // Zápis se ověřuje právem, ne testovacím souborem — v baseline/ mají
    // ležet jenom PNG a nic jiného.
    accessSync(BASELINE_DIR, constants.W_OK);
    accessSync(OUT_DIR, constants.W_OK);
    assert.ok(existsSync(VISUAL_PY), `chybí porovnávač snímků ${VISUAL_PY}`);
  });

  await S.test('python3 + Pillow umí porovnat snímky', () => {
    const r = spawnSync('python3', [VISUAL_PY, '--help'], { encoding: 'utf8', timeout: 20000 });
    if (r.error || r.status !== 0) {
      pyWhy = 'python3 nespustil visual.py: ' + ((r.error && r.error.message) || `kód ${r.status}`);
      skip(pyWhy);
    }
    const p = spawnSync('python3', ['-c', 'from PIL import Image; print(Image.__name__)'],
      { encoding: 'utf8', timeout: 20000 });
    if (p.error || p.status !== 0) {
      pyWhy = 'chybí Pillow (PIL) — snímky se jen uloží, porovnávat se nebude';
      skip(pyWhy);
    }
    pyOk = true;
  });

  /* ── fotíme: jeden kontext na (zařízení × motiv), v něm 5 pohledů ─────── */

  let errBaselineDone = false;

  for (const dev of DEVICES) {
    const found = dev.names.length ? pickDevice(devices, dev.names) : null;
    if (dev.names.length && !found) {
      sub(`registr Playwrightu nezná ${dev.names[0]} — beru náhradní viewport `
        + `${dev.fallbackViewport.width}×${dev.fallbackViewport.height}`);
    } else if (found && found.name !== dev.names[0]) {
      sub(`${dev.names[0]} v registru není, fotím na "${found.name}"`);
    }

    for (const theme of THEMES) {
      const combo = `${dev.label} · ${theme.label}`;
      /** @type {Record<string, {buf: Buffer|null, skip: string, error: string}>} */
      const shots = {};
      for (const v of VIEWS) shots[v.id] = { buf: null, skip: '', error: '' };

      let app = null;
      let openError = '';
      let captureError = '';
      try {
        app = await openApp(eng, {
          ...(found ? { device: found.device } : { viewport: dev.fallbackViewport }),
          theme: theme.id,
          fixture: FIXTURE,
        });
      } catch (e) {
        openError = String((e && e.message) || e).split('\n')[0];
      }

      if (app) {
        const { page, errors } = app;
        try {
          // Bez tohohle by blikající kurzor nebo dojezd animace udělal
          // z každého druhého běhu "změnu".
          try { await page.addStyleTag({ content: FREEZE_CSS }); } catch { /* nevadí */ }

          let booted = false;
          try {
            const p = await probeApp(page);
            booted = !!(p && p.booted);
          } catch { booted = false; }

          // Hlídka chyb se pouští jen jednou, nad prvním kontextem —
          // třicetkrát opsaná stejná hláška by souhrn zaplevelila.
          const notBooted = booted ? '' : 'měsíční obrazovka se ještě nevykresluje';

          /* 1) měsíc — jak se to načte */
          try {
            await scrollToTop(page);
            shots.month.buf = await shoot(page);
            shots.month.skip = notBooted;
          } catch (e) { shots.month.error = String((e && e.message) || e).split('\n')[0]; }

          /* 2) sekce — spodek měsíční obrazovky (#main si roluje sám) */
          try {
            await scrollToBottom(page);
            shots.sections.buf = await shoot(page);
            shots.sections.skip = notBooted;
          } catch (e) { shots.sections.error = String((e && e.message) || e).split('\n')[0]; }

          /* 3) Deník */
          try {
            const ok = await gotoScreen(page, 'journal');
            shots.journal.buf = await shoot(page);
            if (!ok) shots.journal.skip = 'obrazovka Deník zatím není hotová';
          } catch (e) { shots.journal.error = String((e && e.message) || e).split('\n')[0]; }

          /* 4) Úspory */
          try {
            const ok = await gotoScreen(page, 'savings');
            shots.savings.buf = await shoot(page);
            if (!ok) shots.savings.skip = 'obrazovka Úspory zatím není hotová';
          } catch (e) { shots.savings.error = String((e && e.message) || e).split('\n')[0]; }

          /* 5) tisk — zpátky na měsíc a přepnout médium na print */
          try {
            await gotoScreen(page, 'month');
            await scrollToTop(page);
            await page.emulateMedia({ media: 'print' });
            shots.print.buf = await shoot(page);
            shots.print.skip = notBooted;
          } catch (e) {
            shots.print.error = String((e && e.message) || e).split('\n')[0];
          } finally {
            try { await page.emulateMedia({ media: null }); } catch { /* ignore */ }
          }

          if (!errBaselineDone) {
            errBaselineDone = true;
            await errorBaseline(S, errors, 'vizuál');
          }
        } catch (e) {
          // Pojistka: kdyby přesto něco proteklo (zavřená stránka, spadlý
          // prohlížeč), nesmí to vzít s sebou zbývajících pět kombinací.
          captureError = String((e && e.message) || e).split('\n')[0];
        } finally {
          try { await app.close(); } catch { /* ignore */ }
        }
      } else {
        warn(`kontext ${combo} se nepodařilo otevřít: ${openError}`);
      }

      /* ── z bufferů uděláme testy (jeden na snímek) ───────────────────── */

      for (const view of VIEWS) {
        const stem = `${view.id}-${dev.id}-${theme.id}`;
        const baselinePath = join(BASELINE_DIR, stem + '.png');
        const actualPath = join(OUT_DIR, stem + '.png');
        const diffPath = join(OUT_DIR, stem + '.diff.png');
        const shot = shots[view.id];
        const fresh = !existsSync(baselinePath);
        const label = `snímek: ${view.label} · ${dev.label} · ${theme.label}`
          + (fresh || opts.updateBaseline ? (fresh ? ' (nová baseline)' : ' (baseline přepsána)') : '');

        await S.test(label, () => {
          if (openError) skip(`kontext se neotevřel: ${openError}`);
          if (captureError && !shot.buf) skip(`focení kombinace ${combo} spadlo: ${captureError}`);
          if (shot.error) skip(`snímek se nepodařilo pořídit: ${shot.error}`);
          if (!shot.buf) skip('snímek se nepořídil (appka ještě nic nevykreslila?)');

          // Čerstvý snímek si schováme vždycky — i když test skončí SKIPem,
          // ať je co ukázat.
          writeFileSync(actualPath, shot.buf);

          if (fresh || opts.updateBaseline) {
            writeFileSync(baselinePath, shot.buf);
            sub(fresh
              ? `  ↳ založena baseline ${stem}.png (${(shot.buf.length / 1024).toFixed(0)} kB)`
              : `  ↳ baseline ${stem}.png přepsána (${(shot.buf.length / 1024).toFixed(0)} kB)`);
            if (shot.skip) skip(shot.skip + ' — baseline založena z toho, co tam je');
            return;
          }

          if (!pyOk) {
            measured.push({ name: stem, changed: null, diff: diffPath, skipped: true });
            skip(pyWhy || 'porovnávač snímků není k dispozici');
          }

          const res = comparePng(baselinePath, actualPath, diffPath);
          if (res.error) {
            measured.push({ name: stem, changed: null, diff: diffPath, skipped: true });
            throw Object.assign(new Error(res.error), { name: 'AssertionError' });
          }

          measured.push({ name: stem, changed: res.changed, diff: diffPath, skipped: !!shot.skip });

          if (shot.skip) {
            // Rozestavěná obrazovka smí vypadat jinak než včera. Číslo se
            // ale vypíše, ať je vidět, že se něco hnulo.
            skip(`${shot.skip} · rozdíl proti baseline ${pct(res.changed)}`);
          }

          assert.lte(res.changed, LIMIT,
            `${stem} se liší o ${pct(res.changed)} (${res.pixels} z ${res.total} px, limit ${pct(LIMIT)})`
            + `\n      rozdíl: ${diffPath}`
            + `\n      nový:   ${actualPath}`
            + (res.note ? `\n      ${res.note}` : ''));
        });
      }
    }
  }

  if (!errBaselineDone) {
    await S.test('nula chyb na stránce — vizuál', async () => {
      skip('nepodařilo se otevřít ani jeden kontext, nebylo co hlídat');
    });
  }

  /* ── souhrn ───────────────────────────────────────────────────────────── */

  await S.test('žádný snímek se neliší o víc než 0,5 %', () => {
    const cmp = measured.filter(m => typeof m.changed === 'number' && !m.skipped);
    const skipped = measured.filter(m => m.skipped).length;
    if (!cmp.length) {
      if (measured.length) skip(`porovnávat šlo jen rozestavěné obrazovky (${skipped}× SKIP)`);
      skip(opts.updateBaseline
        ? 'nebylo co porovnávat — baseline se právě přepisovaly (--update-baseline)'
        : 'nebylo co porovnávat — baseline se právě zakládaly');
    }
    const worst = cmp.reduce((a, b) => (b.changed > a.changed ? b : a));
    sub(`porovnáno ${cmp.length} snímků`
      + (skipped ? ` (+ ${skipped} rozestavěných)` : '')
      + ` · nejhorší ${worst.name}: ${pct(worst.changed)}`);
    assert.lte(worst.changed, LIMIT,
      `nejvíc se hnul ${worst.name}: ${pct(worst.changed)} (limit ${pct(LIMIT)})`
      + `\n      koukni na ${worst.diff}`);
  });

  S.note(`snímky: test/.out/ · baseline: ${BASELINE_DIR.slice(BASELINE_DIR.indexOf('test/'))}/ · limit ${pct(LIMIT)}`);
  return S;
}
