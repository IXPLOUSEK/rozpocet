// test/suites/io.mjs — záloha, obnova, tabulka.
//
// Záloha je JEDINÁ kopie, kterou má uživatelka plně pod kontrolou.
// Když se stáhne prázdný soubor, pozná to až ve chvíli, kdy z něj bude
// chtít obnovit — tedy když už je pozdě. Proto se tu netestuje "funkce
// se zavolala", ale skutečně stažený soubor: jméno, velikost, obsah.
//
// Všechno jede přes opravdové kliknutí a opravdové stažení, ne přes
// volání vnitřních funkcí — ty jsou zavřené v IIFE a stejně by se tím
// přeskočila půlka cesty, na které se to láme.

import { readFileSync, mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Suite, assert, skip, header, sub } from '../lib/harness.mjs';
import { openApp, probeApp, errorBaseline, settle, TEST_DIR, STORE_KEY } from '../lib/page.mjs';

const OUT = join(TEST_DIR, '.out');
const IPHONE = ['iPhone 15', 'iPhone 14', 'iPhone 13'];

function deviceOf(eng, names) {
  const d = (eng && eng.mod && eng.mod.devices) || {};
  for (const n of names) if (d[n]) return d[n];
  return null;
}

/* ── ovládání skrz opravdové UI ─────────────────────────────────────────── */

/** Přepne na obrazovku „Víc", kde bydlí zálohy. */
async function goMore(page) {
  const tab = page.locator('nav.tabbar [data-screen="more"]').first();
  if (await tab.count()) { await tab.click({ force: true }); await settle(page, 260); return true; }
  const ok = await page.evaluate(() => {
    if (!window.__APP__) return false;
    const s = window.__APP__.state();
    s.ui.screen = 'more';
    window.__APP__.render();
    return true;
  });
  await settle(page, 260);
  return ok;
}

/** Najde tlačítko podle data-act, případně podle popisku. */
async function actionButton(page, act, textRe) {
  const byAct = page.locator(`[data-act="${act}"]`).first();
  if (await byAct.count()) return byAct;
  if (textRe) {
    const all = page.locator('button');
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const t = (await all.nth(i).textContent()) || '';
      if (textRe.test(t.trim())) return all.nth(i);
    }
  }
  return null;
}

/**
 * Klikne a počká na stažení. Vrátí { name, bytes, text } nebo null.
 * Když appka místo stažení otevře systémové sdílení, dá to najevo.
 */
async function download(page, btn, ms = 9000) {
  const wait = page.waitForEvent('download', { timeout: ms }).catch(() => null);
  try { await btn.scrollIntoViewIfNeeded({ timeout: 2000 }); } catch { /* stačí force klik */ }
  await btn.click({ force: true });
  const dl = await wait;
  if (!dl) return null;
  mkdirSync(OUT, { recursive: true });
  const name = dl.suggestedFilename();
  const path = join(OUT, name);
  try { await dl.saveAs(path); } catch { return { name, bytes: 0, text: '', path: null }; }
  const buf = readFileSync(path);
  return { name, bytes: buf.length, text: buf.toString('utf8'), buf, path };
}

/* ── hledání částek v dokumentu ─────────────────────────────────────────── */

const AMOUNT_KEYS = new Set(['plan', 'act', 'amt', 'target', 'startBalance']);
function scanAmounts(node, cb, path = '') {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((v, i) => scanAmounts(v, cb, `${path}[${i}]`)); return; }
  for (const k in node) {
    const p = path ? `${path}.${k}` : k;
    if (AMOUNT_KEYS.has(k)) cb(p, node[k], node);
    else scanAmounts(node[k], cb, p);
  }
}

export async function run(opts) {
  const S = new Suite('io');
  header('io — záloha, obnova, tabulka pro Excel');

  const eng = opts.webkit || opts.chromium;
  if (!eng) { S.note('není prohlížeč'); return S; }
  const device = deviceOf(eng, IPHONE) || { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };
  sub(`engine: ${opts.webkitReal ? 'WebKit' : 'Chromium (náhrada za WebKit)'}`);
  if (!opts.webkitReal) {
    S.note('io běželo v Chromiu — sdílení do Souborů na iOS ověří jen člověk (AKCEPTACE.md 8, 9)');
  }
  mkdirSync(OUT, { recursive: true });

  const open = (o) => openApp(eng, { device, theme: 'light', acceptDownloads: true, ...o });

  /* ═══ 1. záloha do JSON ═══ */

  let exported = null;      // { name, text, bytes }

  {
    const a = await open({ fixture: 'realistic-year' });
    try {
      await errorBaseline(S, a.errors, 'zálohy');

      await S.test('záloha se stáhne pod jménem rozpocet-zaloha-RRRR-MM-DD.json', async () => {
        if (!(await probeApp(a.page)).booted) skip('appka zatím nic nevykresluje');
        await goMore(a.page);
        const btn = await actionButton(a.page, 'io.export', /stáhnout zálohu/i);
        if (!btn) skip('tlačítko „Stáhnout zálohu" zatím není');
        exported = await download(a.page, btn);
        if (!exported) skip('kliknutí nic nestáhlo (na iOS to jde přes sdílení, tady se to neprojeví)');
        assert.match(exported.name, /^rozpocet-zaloha-\d{4}-\d{2}-\d{2}\.json$/,
          `jméno souboru je ${JSON.stringify(exported.name)} — uživatelka podle něj v Souborech pozná datum`);
      });

      await S.test('stažená záloha není prázdná a dá se přečíst', async () => {
        if (!exported) skip('záloha se nestáhla');
        assert.gte(exported.bytes, 1, 'soubor má 0 bajtů — přesně to, co uživatelka zjistí až při obnově');
        assert.gte(exported.bytes, 1000, `soubor má jen ${exported.bytes} B, na celý rok to nestačí`);
        let doc = null;
        try { doc = JSON.parse(exported.text); }
        catch (e) { throw Object.assign(new Error('záloha není platný JSON: ' + e.message), { name: 'AssertionError' }); }
        assert.eq(doc.app, 'rozpocet', 'v záloze chybí značka aplikace');
        const y = doc.years && doc.years[String(doc.activeYear)];
        assert.ok(y, 'v záloze není aktivní rok');
        assert.eq(y.catalog.length, 69, 'v záloze chybí kategorie');
        assert.eq(y.tx.length, 601, 'v záloze chybí zápisy v deníku');
      });

      await S.test('žádná vyplněná částka se v záloze nezměnila na null', async () => {
        if (!exported) skip('záloha se nestáhla');
        const src = JSON.parse(readFileSync(join(TEST_DIR, 'fixtures', 'realistic-year.json'), 'utf8'));
        const doc = JSON.parse(exported.text);

        const filled = new Map();
        scanAmounts(src, (p, v) => { if (v !== null && v !== undefined) filled.set(p, v); });
        const lost = [];
        scanAmounts(doc, (p, v) => {
          if (!filled.has(p)) return;
          if (v === null || v === undefined) lost.push(`${p}: bylo ${filled.get(p)}, v záloze ${v}`);
          else if (v !== filled.get(p)) lost.push(`${p}: bylo ${filled.get(p)}, v záloze ${v}`);
        });
        assert.empty(lost, 'záloha přišla o částky — po obnově by chyběly peníze');
      });

      // Mazání je v tomhle modelu měkké (cat.archived, tx.del). Když se
      // do zálohy nedostane archivovaná kategorie nebo osiřelý zápis,
      // obnova ze zálohy je tiše ZTRÁTOVÁ — a přesně to je krok 9
      // v AKCEPTACE.md, kde se porovnávají čísla před vymazáním a po obnově.
      await S.test('záloha si nechá i archivované kategorie a osiřelé zápisy', async () => {
        if (!exported) skip('záloha se nestáhla');
        const src = JSON.parse(readFileSync(join(TEST_DIR, 'fixtures', 'realistic-year.json'), 'utf8'));
        const doc = JSON.parse(exported.text);
        const sy = src.years['2026'];
        const dy = doc.years && doc.years['2026'];
        assert.ok(dy, 'v záloze chybí rok 2026');

        const missCats = sy.catalog.filter(c => !dy.catalog.some(d => d.id === c.id))
          .map(c => `${c.name}${c.archived ? ' (archivovaná)' : ''}`);
        assert.empty(missCats, 'záloha vynechala kategorie — po obnově by zmizely i s historií');

        const dIds = new Set(dy.tx.map(t => t.id));
        const missTx = sy.tx.filter(t => !dIds.has(t.id))
          .map(t => `${t.d} ${t.note || '(bez poznámky)'} ${(t.amt / 100).toFixed(2)} Kč (cat ${t.cat})`);
        assert.empty(missTx, 'záloha vynechala zápisy z deníku — po obnově by chyběly peníze');
      });

      await S.test('v záloze nejsou žádné necelé částky', async () => {
        if (!exported) skip('záloha se nestáhla');
        const bad = [];
        scanAmounts(JSON.parse(exported.text), (p, v) => {
          if (v === null || v === undefined) return;
          if (!Number.isSafeInteger(v)) bad.push(`${p} = ${v}`);
        });
        assert.empty(bad, 'v záloze jsou částky, které nejsou celé haléře');
      });
    } finally { await a.close(); }
  }

  /* ═══ 2. rozbitý stav se vůbec nesmí exportovat ═══
     Uložit zálohu, ve které je NaN, je horší než neuložit žádnou:
     uživatelka bude mít pocit, že je v bezpečí. */

  {
    const a = await open({ fixture: 'realistic-year' });
    try {
      await S.test('když je ve stavu NaN, záloha se NEVYTVOŘÍ a řekne se to česky', async () => {
        if (!(await probeApp(a.page)).booted) skip('appka zatím nic nevykresluje');
        const poisoned = await a.page.evaluate(() => {
          if (!window.__APP__) return false;
          const s = window.__APP__.state();
          const y = s.years[String(s.activeYear)];
          const e = y.months[s.ui.month].entries[0];
          if (!e) return false;
          e.plan = NaN;
          return true;
        });
        if (!poisoned) skip('__APP__ zatím není');

        await goMore(a.page);
        const btn = await actionButton(a.page, 'io.export', /stáhnout zálohu/i);
        if (!btn) skip('tlačítko „Stáhnout zálohu" zatím není');

        const got = await download(a.page, btn, 3500);
        await settle(a.page, 400);
        const txt = await a.page.evaluate(() => document.body.innerText || '');

        if (got) {
          throw Object.assign(new Error(
            `záloha se i s NaN stáhla (${got.name}, ${got.bytes} B) — má se odmítnout`), { name: 'AssertionError' });
        }
        assert.match(txt, /nepodařilo|nesed|chyb|poškoz|zkontroluj|neulož/i,
          `export se nekonal, ale uživatelka se nedozvěděla proč; text: ${txt.replace(/\s+/g, ' ').slice(0, 200)}`);
      });
    } finally { await a.close(); }
  }

  /* ═══ 3. kolečko export → import → export ═══ */

  {
    const a = await open({ fixture: 'realistic-year' });
    try {
      await S.test('export → import → export dá bajt za bajt stejný soubor', async () => {
        if (!exported) skip('první záloha se nestáhla');
        if (!(await probeApp(a.page)).booted) skip('appka zatím nic nevykresluje');

        const tmp = join(OUT, 'roundtrip-in.json');
        writeFileSync(tmp, exported.text, 'utf8');

        await goMore(a.page);
        const imp = await actionButton(a.page, 'io.import', /načíst zálohu/i);
        if (!imp) skip('tlačítko „Načíst zálohu" zatím není');

        const chooser = a.page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
        await imp.click({ force: true });
        const fc = await chooser;
        if (!fc) skip('výběr souboru se neotevřel');
        await fc.setFiles(tmp);
        await settle(a.page, 700);
        await confirmIfAsked(a.page);

        // Po importu se appka překreslí a může zůstat otevřený panel.
        // Než se klikne na druhý export, musí být obrazovka zase klidná.
        await closeSheets(a.page);
        await goMore(a.page);
        const btn = await actionButton(a.page, 'io.export', /stáhnout zálohu/i);
        if (!btn) skip('po importu zmizelo tlačítko „Stáhnout zálohu"');
        const again = await download(a.page, btn);
        if (!again) skip('druhý export nic nestáhl');

        // Razítka se mezi dvěma exporty liší vždycky a nic to neznamená.
        // Porovnává se všechno ostatní.
        const norm = (s) => {
          const d = JSON.parse(s);
          for (const k of ['savedAt', 'exportedAt', 'rev', 'deviceId']) delete d[k];
          if (d.settings) { delete d.settings.lastExportAt; delete d.settings.lastSyncAt; }
          return JSON.stringify(d);
        };
        const A = norm(exported.text), B = norm(again.text);
        if (A === B) return;

        // Nejdřív se podívej, jestli se cestou něco NEZTRATILO — to je
        // horší než přeuspořádání a chce to konkrétní jména, ne offset.
        const lost = lostBetween(JSON.parse(exported.text), JSON.parse(again.text));
        if (lost.length) {
          throw Object.assign(new Error(
            'import ZAHODIL data — po obnově ze zálohy by chyběla\n'
            + lost.slice(0, 8).map(s => '        · ' + s).join('\n')
            + (lost.length > 8 ? `\n        … a dalších ${lost.length - 8}` : '')), { name: 'AssertionError' });
        }
        const i = firstDiff(A, B);
        throw Object.assign(new Error(
          'druhá záloha se od první liší — někde se data cestou mění\n'
          + `        první rozdíl na znaku ${i} z ${A.length}\n`
          + `        první záloha: …${A.slice(Math.max(0, i - 90), i + 90)}…\n`
          + `        druhá záloha: …${B.slice(Math.max(0, i - 90), i + 90)}…`), { name: 'AssertionError' });
      });
    } finally { await a.close(); }
  }

  /* ═══ 4. import NAHRAZUJE, nikdy nepřilepuje ═══
     Kdyby import sléval, uživatelka by po obnově měla každou položku
     dvakrát a součty by seděly na dvojnásobek. To je krok 9 v AKCEPTACE.md. */

  {
    const seedDoc = miniDoc([
      ['a1', 'Nájem', 400000], ['a2', 'Jídlo', 300000], ['a3', 'Doprava', 200000],
      ['a4', 'Zábava', 200000], ['a5', 'Drogerie', 100000],
    ]);                                     // 5 řádků, celkem 12 000 Kč
    const backup = miniDoc([
      ['b1', 'Nájem', 400000], ['b2', 'Jídlo', 200000], ['b3', 'Telefon', 100000],
    ]);                                     // 3 řádky, celkem 7 000 Kč

    const a = await open({ seed: { [STORE_KEY]: JSON.stringify(seedDoc) } });
    try {
      await S.test('import NAHRADÍ současná data, nesleje je (5 řádků/12 000 → 3 řádky/7 000)', async () => {
        if (!(await probeApp(a.page)).booted) skip('appka zatím nic nevykresluje');

        const before = await countRows(a.page);
        if (before === null) skip('__APP__ zatím není');
        assert.eq(before.rows, 5, 'kontrolní data se nenačetla');
        assert.eq(before.total, 1200000, 'kontrolní součet nesedí');

        const tmp = join(OUT, 'replace-backup.json');
        writeFileSync(tmp, JSON.stringify(backup), 'utf8');

        await goMore(a.page);
        const imp = await actionButton(a.page, 'io.import', /načíst zálohu/i);
        if (!imp) skip('tlačítko „Načíst zálohu" zatím není');
        const chooser = a.page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
        await imp.click({ force: true });
        const fc = await chooser;
        if (!fc) skip('výběr souboru se neotevřel');
        await fc.setFiles(tmp);
        await settle(a.page, 700);
        await confirmIfAsked(a.page);
        await settle(a.page, 400);

        const after = await countRows(a.page);
        assert.eq(after.rows, 3, `po obnově je ${after.rows} řádků — sléváním by jich bylo 8`);
        assert.eq(after.total, 700000, `po obnově je součet ${after.total / 100} Kč, čekal jsem 7 000 Kč`);
        const survivors = after.ids.filter(id => id.startsWith('a'));
        assert.empty(survivors, 'z původních dat něco přežilo import');
      });
    } finally { await a.close(); }
  }

  /* ═══ 5. cizí soubor ═══ */

  {
    const a = await open({ fixture: 'realistic-year' });
    try {
      await S.test('cizí JSON se odmítne a data zůstanou bajt za bajt stejná', async () => {
        if (!(await probeApp(a.page)).booted) skip('appka zatím nic nevykresluje');
        // Otisk se bere až PO přepnutí na „Víc". Samotné přepnutí obrazovky
        // je taky změna stavu (ui.screen, rev) a porovnávat se mají DATA,
        // ne to, kde zrovna uživatelka stojí.
        await goMore(a.page);
        const before = await dataFingerprint(a.page);

        const tmp = join(OUT, 'cizi.json');
        writeFileSync(tmp, JSON.stringify({
          version: 3, kind: 'jina-appka',
          items: [{ title: 'Nákup', price: 12.5 }, { title: 'Kafe', price: 2.2 }],
        }, null, 2), 'utf8');

        const imp = await actionButton(a.page, 'io.import', /načíst zálohu/i);
        if (!imp) skip('tlačítko „Načíst zálohu" zatím není');
        const chooser = a.page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
        await imp.click({ force: true });
        const fc = await chooser;
        if (!fc) skip('výběr souboru se neotevřel');
        await fc.setFiles(tmp);
        await settle(a.page, 800);

        const txt = await a.page.evaluate(() => document.body.innerText || '');
        assert.match(txt, /nevypadá|nen[íi] záloh|nepodařilo|špatn|cizí|neznám/i,
          `cizí soubor prošel bez hlášky; text: ${txt.replace(/\s+/g, ' ').slice(0, 200)}`);

        const after = await dataFingerprint(a.page);
        if (after !== before) {
          const i = firstDiff(before, after);
          throw Object.assign(new Error(
            'odmítnutý import přesto sáhl na uložená data\n'
            + `        první rozdíl na znaku ${i}\n`
            + `        před: …${before.slice(Math.max(0, i - 70), i + 70)}…\n`
            + `        po:   …${after.slice(Math.max(0, i - 70), i + 70)}…`), { name: 'AssertionError' });
        }
      });
    } finally { await a.close(); }
  }

  /* ═══ 6. CSV pro českou Excel ═══
     Bez BOM rozseká Excel diakritiku, bez středníku nacpe řádek do jednoho
     sloupce a bez odzbrojení „=" si z názvu udělá vzorec. */

  {
    const a = await open({ fixture: 'adversarial' });
    let csv = null;
    try {
      await S.test('tabulka se stáhne jako CSV', async () => {
        if (!(await probeApp(a.page)).booted) skip('appka zatím nic nevykresluje');
        await goMore(a.page);
        const btn = await actionButton(a.page, 'io.exportCsv', /tabulk|csv/i);
        if (!btn) skip('tlačítko pro CSV zatím není');
        csv = await download(a.page, btn);
        if (!csv) skip('kliknutí nic nestáhlo');
        assert.gte(csv.bytes, 20, 'CSV je prázdné');
        assert.match(csv.name, /\.csv$/, `jméno je ${csv.name}`);
      });

      await S.test('CSV začíná BOM (EF BB BF) — jinak Excel rozseká diakritiku', () => {
        if (!csv) skip('CSV se nestáhlo');
        const b = csv.buf;
        assert.eq(`${b[0]},${b[1]},${b[2]}`, '239,187,191',
          `první tři bajty jsou ${b[0]},${b[1]},${b[2]} — má být 239,187,191`);
      });

      await S.test('CSV odděluje středníkem a končí řádky CRLF', () => {
        if (!csv) skip('CSV se nestáhlo');
        const body = csv.text.replace(/^﻿/, '');
        const head = body.split('\r\n')[0];
        assert.ok(head.includes(';'), `hlavička neobsahuje středník: ${JSON.stringify(head)}`);
        assert.ok(!/(^|[^\r])\n/.test(body), 'někde je holé \\n místo \\r\\n — Excel to slepí');
        assert.gte(body.split('\r\n').filter(Boolean).length, 2, 'CSV má jen hlavičku');
      });

      await S.test('částka v CSV je "1234,50" — čárka a žádné mezery v čísle', () => {
        if (!csv) skip('CSV se nestáhlo');
        const body = csv.text.replace(/^﻿/, '');
        const cells = body.split('\r\n').slice(1).flatMap(l => l.split(';'));
        const nums = cells.filter(c => /^-?\d+,\d{2}$/.test(c));
        assert.gte(nums.length, 1, `žádná buňka nevypadá jako částka; ukázka: ${cells.slice(0, 12).join(' | ')}`);
        const spaced = cells.filter(c => /\d[  ]\d/.test(c));
        assert.empty(spaced, 'v čísle je mezera — Excel z celého sloupce udělá text a SUM vrátí nulu');
        const dotted = cells.filter(c => /^-?\d+\.\d{2}$/.test(c));
        assert.empty(dotted, 'desetinná tečka místo čárky');
      });

      await S.test('čeština v CSV zůstane celá (Žluťoučký kůň)', () => {
        if (!csv) skip('CSV se nestáhlo');
        assert.match(csv.text, /Žluťoučký kůň úpěl ďábelské ódy/,
          'diakritika se v CSV zkomolila');
      });

      await S.test('název začínající "=" je odzbrojený, Excel z něj neudělá vzorec', () => {
        if (!csv) skip('CSV se nestáhlo');
        const line = csv.text.split('\r\n').find(l => l.includes('SUMA(A1:A9)'));
        if (!line) skip('řádek se vzorcem se do CSV nedostal');
        assert.match(line, /'=SUMA\(A1:A9\)|"'=SUMA\(A1:A9\)"/,
          `buňka není odzbrojená apostrofem: ${JSON.stringify(line.slice(0, 120))}`);
      });
    } finally { await a.close(); }
  }

  try { rmSync(join(OUT, 'roundtrip-in.json'), { force: true }); } catch { /* nic */ }
  return S;
}

/* ── pomocníci ── */

/** Když se objeví potvrzovací panel („Nahradit současná data?"), odklikne ho. */
async function confirmIfAsked(page) {
  const sheet = page.locator('.sheet[role="dialog"]');
  if (!(await sheet.count())) return false;
  const btns = sheet.locator('button');
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const t = ((await btns.nth(i).textContent()) || '').trim();
    if (/^(nahradit|načíst|ano|pokračovat|ok|rozumím|obnovit)/i.test(t)) {
      await btns.nth(i).click({ force: true });
      await settle(page, 500);
      return true;
    }
  }
  return false;
}

/** Zavře otevřené panely, ať nic nepřekrývá tlačítka. */
async function closeSheets(page) {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('.sheet[role="dialog"]').count())) return;
    await page.keyboard.press('Escape');
    await settle(page, 200);
  }
}

/** Otisk DAT (ne obrazovky): jen roky a nastavení, bez razítek. */
async function dataFingerprint(page) {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    if (!raw) return '(v úložišti nic není)';
    try {
      const d = JSON.parse(raw);
      return JSON.stringify({ years: d.years, activeYear: d.activeYear, settings: d.settings });
    } catch { return raw; }
  }, STORE_KEY);
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

/** Co v dokumentu B chybí oproti A — pojmenovaně, ať se to dá opravit. */
function lostBetween(A, B) {
  const out = [];
  for (const yk of Object.keys(A.years || {})) {
    const ya = A.years[yk], yb = (B.years || {})[yk];
    if (!yb) { out.push(`celý rok ${yk}`); continue; }
    const bCats = new Set((yb.catalog || []).map(c => c.id));
    for (const c of ya.catalog || []) {
      if (!bCats.has(c.id)) out.push(`kategorie „${c.name}" (${c.id})${c.archived ? ' — archivovaná' : ''}`);
    }
    const bTx = new Set((yb.tx || []).map(t => t.id));
    for (const t of ya.tx || []) {
      if (!bTx.has(t.id)) {
        const known = (ya.catalog || []).some(c => c.id === t.cat);
        out.push(`zápis ${t.d} „${t.note || '(bez poznámky)'}" ${(t.amt / 100).toFixed(2)} Kč`
          + (known ? '' : ` — jeho kategorie ${t.cat} v katalogu není (osiřelý zápis)`));
      }
    }
    const bEntries = new Set();
    for (const mo of yb.months || []) for (const e of mo.entries || []) bEntries.add(e.id);
    for (const mo of ya.months || []) for (const e of mo.entries || []) {
      if (!bEntries.has(e.id)) out.push(`položka ${e.id} v měsíci ${mo.m + 1}`);
    }
  }
  return out;
}

async function countRows(page) {
  return page.evaluate(() => {
    if (!window.__APP__) return null;
    const s = window.__APP__.state();
    const y = s.years[String(s.activeYear)];
    const mo = y.months[s.ui.month];
    const live = mo.entries.filter(e => !e.del);
    return {
      rows: live.length,
      total: live.reduce((a, e) => a + (Number.isSafeInteger(e.plan) ? e.plan : 0), 0),
      ids: y.catalog.map(c => c.id),
    };
  });
}

/** Maličký, ale platný dokument — pro test „import nahrazuje". */
function miniDoc(rows) {
  const months = Array.from({ length: 12 }, (_, m) => ({ m, note: '', entries: [] }));
  const catalog = rows.map(([id, name, plan], i) => ({
    id: 'c_' + id, sec: 'fixed', name, icon: '•', order: (i + 1) * 10,
    recurring: true, dueDay: null, goal: null, archived: false,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  rows.forEach(([id, , plan], i) => {
    months[0].entries.push({
      id: 'e_' + id, cat: 'c_' + id, plan, act: null, paid: false, paidAt: null,
      due: null, autoFilled: false, del: false, updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
  return {
    app: 'rozpocet', schema: 1, rev: 0,
    savedAt: '2026-01-01T00:00:00.000Z', deviceId: 'd_mini',
    activeYear: 2026, isDemo: false,
    settings: {
      theme: 'auto', dueSoonDays: 7, autofillOnPaid: true,
      syncUrl: '', syncSecret: '', lastSyncAt: null, lastExportAt: null, installNagDismissedAt: null,
    },
    ui: { screen: 'month', month: 0, yearTab: 'summary', journalFilter: 'all' },
    years: { '2026': { year: 2026, catalog, months, tx: [] } },
  };
}
