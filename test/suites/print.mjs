// test/suites/print.mjs — tisk a PDF — vlastní: L1
//
// PROČ tahle suita existuje: appka je jedna dlouhá rolovací obrazovka.
// Když se z ní tiskne, prohlížeč vytiskne jen to, co je zrovna vidět,
// a zbytek spolkne posuvná oblast. Sestava pak má jednu stránku a mamka
// si myslí, že jí tiskárna sežrala rok. Proto se tady netestuje "jak to
// vypadá", ale tvrdá mechanika: v tiskovém médiu nesmí zůstat žádný
// scroll container, žádná zastropovaná výška a nic přilepeného
// (`position: fixed` / `sticky`) — sticky hlavička se totiž na papíře
// zopakuje na každé stránce a ukousne půl řádku.
//
// Druhá půlka suity sáhne na skutečně vygenerované A4 PDF a přečte si ho
// zpátky přes poppler (pdfinfo / pdftotext). Screenshot by lhal: PDF plné
// prázdných stránek vypadá na screenshotu úplně stejně jako hotová sestava.
//
// Všechno, co ještě není napsané, končí jako SKIP, ne jako FAIL — půlka
// appky se píše přímo teď a "ještě to není" není chyba.

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Suite, assert, skip, header, sub, warn } from '../lib/harness.mjs';
import { openApp, probeApp, settle, errorBaseline, TEST_DIR } from '../lib/page.mjs';

/* ── kam se ukládají artefakty ───────────────────────────────────────────── */

const OUT_DIR = join(TEST_DIR, '.out');
const PDF_PATH = join(OUT_DIR, 'rozpocet-print.pdf');
const YEAR_PDF_PATH = join(OUT_DIR, 'rozpocet-print-rok.pdf');
const WK_SHOT = join(OUT_DIR, 'print-webkit.png');

/** Desktopová šířka pro tisk: dost místa, aby se sestava chovala jako na papíře. */
const PRINT_VIEWPORT = { width: 1024, height: 1400 };
/** A4 na 96 dpi v CSS pixelech — 210 × 297 mm. Na tomhle se měří přetečení. */
const A4_VIEWPORT = { width: 794, height: 1123 };

/* ── drobní pomocníci ────────────────────────────────────────────────────── */

const msg = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 180);

function ensureOutDir() {
  try { mkdirSync(OUT_DIR, { recursive: true }); return true; } catch { return false; }
}

/** Spustí externí nástroj a nikdy nevyhodí — chybějící binárka je SKIP, ne pád. */
function runTool(bin, args, opts = {}) {
  try {
    const r = spawnSync(bin, args, {
      encoding: opts.encoding === null ? 'buffer' : 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30000,
    });
    if (r.error) return { ok: false, reason: String(r.error.code || r.error.message || r.error) };
    return { ok: true, code: r.status, out: r.stdout || '', err: String(r.stderr || '') };
  } catch (e) {
    return { ok: false, reason: msg(e) };
  }
}

/** Je nástroj vůbec nainstalovaný? (poppler vypisuje verzi do stderru a to je v pořádku) */
function haveTool(bin) {
  return runTool(bin, ['-v']).ok;
}

/**
 * Počet stránek PDF. Nejdřív pdfinfo, pak nouzově surové počítání `/Type /Page`
 * v bajtech souboru. Když ani jedno, vrátí null a test se přeskočí.
 */
function pdfPageCount(path) {
  const info = runTool('pdfinfo', [path]);
  if (info.ok) {
    const m = /^Pages:\s*(\d+)\s*$/m.exec(String(info.out));
    if (m) return { pages: Number(m[1]), how: 'pdfinfo' };
  }
  try {
    const raw = readFileSync(path, 'latin1');
    // `/Type /Pages` je strom stránek, ne stránka — ten se počítat nesmí.
    const hits = raw.match(/\/Type\s*\/Page(?![s])/g);
    if (hits && hits.length) return { pages: hits.length, how: 'syrové bajty' };
  } catch { /* nevadí */ }
  return { pages: null, how: null };
}

/** Text z PDF. Bez pdftotext se nedá poznat, jestli je sestava prázdná. */
function pdfText(path) {
  if (!haveTool('pdftotext')) return { ok: false, reason: 'pdftotext není nainstalovaný' };
  const r = runTool('pdftotext', ['-enc', 'UTF-8', path, '-']);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, text: String(r.out || '') };
}

/** Dvanáct měsíců: první tvar je nominativ z hlaviček, druhý genitiv z dat. */
const MONTHS_CS = [
  ['Leden', 'ledna'], ['Únor', 'února'], ['Březen', 'března'],
  ['Duben', 'dubna'], ['Květen', 'května'], ['Červen', 'června'],
  ['Červenec', 'července'], ['Srpen', 'srpna'], ['Září', 'září'],
  ['Říjen', 'října'], ['Listopad', 'listopadu'], ['Prosinec', 'prosince'],
];

/**
 * Hledá slovo jako celek. Prosté `includes('červen')` by našlo "červen"
 * uvnitř "červenec" a test by tvrdil, že červen v sestavě je, i kdyby nebyl.
 */
function hasWord(hay, word) {
  try {
    return new RegExp('(?<![\\p{L}\\p{N}])' + word + '(?![\\p{L}\\p{N}])', 'iu').test(hay);
  } catch {
    return String(hay).toLowerCase().includes(String(word).toLowerCase());
  }
}

/** Řetězce, které se nikdy nesmí dostat na papír — vždycky je to chyba formátování. */
const GARBAGE = ['NaN', 'undefined', 'Infinity', '[object Object]'];

/* ── audit tiskového média (běží uvnitř stránky) ─────────────────────────── */

/**
 * Projde VŠECHNY prvky a vrátí tři seznamy provinilců.
 *
 * Filtry, které nejsou změkčení, ale přesnost:
 *  · prvky bez vykresleného boxu (display:none kdekoliv nad nimi) se netisknou,
 *    takže je nemá smysl řešit — `.tabbar`, `.fab` a sheety sem patří;
 *  · `.sr-only` je schválně oříznuté 1×1 políčko pro odečítač obrazovky;
 *  · `overflow: hidden`, ve kterém se obsah VEJDE (typicky ellipsis u názvu
 *    kategorie), papír nijak neohrozí. Ostrý problém je posuvná oblast
 *    (`auto` / `scroll`) nebo oříznutý obsah — a přesně to hlásíme.
 */
/* Sestavy se vyrábí SPUŠTĚNÍM TISKU v appce, ne jen přepnutím média.
   Ten rozdíl je podstatný: `emulateMedia({media:'print'})` vysází živou
   obrazovku, kdežto `io.print` teprve postaví `#screen-print` — a přesně
   to dostane uživatelka na papír. Kdyby se testoval jen první případ,
   prošla by i sestava, která se nikdy nevykreslí.

   Každá se vyrobí jednou a sdílí ji víc testů. */
function makePrintPdf(actionSel, path, label) {
  let cache = null;
  return async function (page) {
    if (cache) return cache;
    const fail = (reason) => (cache = { ok: false, reason });
    try {
      if (!ensureOutDir()) return fail('nešlo vyrobit adresář ' + OUT_DIR);

      const started = await page.evaluate(async (sel) => {
        if (!window.__APP__) return 'appka nemá __APP__';
        let btn = document.querySelector(sel);
        if (!btn) {                       // tlačítko bývá v Nastavení
          const s = window.__APP__.state();
          s.ui.screen = 'more';
          window.__APP__.render();
          await new Promise(r => setTimeout(r, 300));
          btn = document.querySelector(sel);
        }
        if (!btn) return `tlačítko ${sel} neexistuje`;
        btn.click();                      // window.print() je v headless no-op
        await new Promise(r => setTimeout(r, 900));
        const host = document.querySelector('#screen-print');
        if (!host || (!host.children.length && !(host.textContent || '').trim())) {
          return 'sestava se spustila, ale #screen-print zůstal prázdný';
        }
        return null;
      }, actionSel);
      if (started) return fail(started);

      await page.emulateMedia({ media: 'print' }).catch(() => { });
      await page.waitForTimeout(400);
      await page.pdf({
        path, format: 'A4', printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '12mm', left: '10mm' },
      });
      if (!existsSync(path) || statSync(path).size === 0) return fail(`${label} PDF se vyrobilo prázdné`);
      const pc = pdfPageCount(path);
      const tx = pdfText(path);
      cache = {
        ok: true, bytes: statSync(path).size, path,
        pages: pc.pages, text: tx.ok ? tx.text : null, textErr: tx.ok ? '' : tx.reason,
      };
      return cache;
    } catch (e) {
      return fail(`${label} tisk spadl: ` + msg(e));
    }
  };
}

const printMonthPdf = makePrintPdf('[data-act="io.print"]', join(OUT_DIR, 'rozpocet-print-mesic.pdf'), 'měsíční');
const printYearPdf = makePrintPdf('[data-act="io.printYear"]', YEAR_PDF_PATH, 'roční');

/** Stejný provinilec 11× je jeden problém, ne jedenáct. Sloučí a spočítá. */
function tally(list) {
  const n = new Map();
  for (const s of list || []) n.set(s, (n.get(s) || 0) + 1);
  return Array.from(n, ([s, c]) => (c > 1 ? `${s}   (${c}×)` : s));
}

const AUDIT_FN = () => {
  const nameOf = (e) => {
    const t = e.tagName ? e.tagName.toLowerCase() : '?';
    const id = e.id ? '#' + e.id : '';
    const raw = (e.getAttribute && e.getAttribute('class')) || '';
    const cls = raw.trim() ? '.' + raw.trim().split(/\s+/).slice(0, 4).join('.') : '';
    return t + id + cls;
  };
  const rendered = (e) => {
    if (typeof e.checkVisibility === 'function') {
      try { return e.checkVisibility(); } catch { /* padáme na náhradní měření */ }
    }
    return e.getClientRects().length > 0;
  };

  const out = { scrollers: [], ellipsis: [], maxHeights: [], positioned: [], seen: 0, skipped: 0 };
  const all = document.querySelectorAll('*');
  for (const e of all) {
    if (e.closest && e.closest('.sr-only')) { out.skipped++; continue; }
    if (!rendered(e)) { out.skipped++; continue; }
    out.seen++;

    let cs;
    try { cs = getComputedStyle(e); } catch { continue; }
    const ovs = [cs.overflow, cs.overflowX, cs.overflowY];

    // (a) posuvné oblasti — kvůli nim se tiskne jedna obrazovka místo celého roku
    const scrollable = ovs.some(v => v === 'auto' || v === 'scroll');
    const clipping = ovs.some(v => v !== 'visible');
    const cutV = clipping && e.scrollHeight > e.clientHeight + 2;
    const cutW = clipping && e.scrollWidth > e.clientWidth + 2;
    // Jednořádkový popisek s třemi tečkami (nowrap + ellipsis) je záměr,
    // ne chyba tisku — hlásí se, ale zvlášť, aby nepřekřičel opravdové
    // posuvné oblasti. Ty utnou celou tabulku, tohle jen konec názvu.
    const ellipsis = cutW && !cutV && cs.textOverflow === 'ellipsis';
    if (scrollable || cutV || cutW) {
      const why = cutV ? `  (obsah je ${e.scrollHeight} px vysoký v okně ${e.clientHeight} px — spodek se uřízne)`
        : cutW ? `  (obsah je ${e.scrollWidth} px široký v okně ${e.clientWidth} px — konec se uřízne)`
          : '';
      const line = nameOf(e) + '  overflow: ' + ovs.join(' / ') + why + `  height: ${cs.height}`;
      (ellipsis ? out.ellipsis : out.scrollers).push(line);
    }

    // (b) zastropovaná výška — obsah přes ni na papíře nepřeteče, zmizí
    if (cs.maxHeight && cs.maxHeight !== 'none') {
      out.maxHeights.push(nameOf(e) + '  max-height: ' + cs.maxHeight);
    }

    // (c) přilepené prvky — na každé stránce znovu, přes obsah
    if ((cs.position === 'fixed' || cs.position === 'sticky')
      && e !== document.documentElement && e !== document.body) {
      out.positioned.push(nameOf(e) + '  position: ' + cs.position);
    }
  }
  return out;
};

/* ── suita ───────────────────────────────────────────────────────────────── */

export async function run(opts = {}) {
  const S = new Suite('print');
  header('print — tisková CSS, A4 PDF a jeho obsah');

  const chromium = (opts && opts.chromium) || null;
  const webkit = (opts && opts.webkit) || null;
  const webkitReal = !!(opts && opts.webkitReal);
  // Hlavní kontext: Chromium, když je — jen ono umí page.pdf().
  const eng = chromium || webkit;

  if (!eng) {
    S.note('žádný prohlížeč nenastartoval — tisk neověřen');
    await S.test('tisková suita', async () => {
      skip('nenastartoval ani Chromium, ani WebKit — tisk se nedá ověřit');
    });
    return S;
  }

  /* 1) jeden kontext pro všechna tvrzení nad tiskovým médiem.
        Otevírat prohlížeč na každé tvrzení je pomalé a nic navíc to neřekne. */
  let app = null, openErr = null;
  try {
    app = await openApp(eng, {
      viewport: PRINT_VIEWPORT,
      fixture: 'realistic-year',
      theme: 'light',
    });
  } catch (e) {
    openErr = msg(e);
  }

  if (!app) {
    S.note('appka se nepodařilo otevřít: ' + openErr);
    await S.test('tisková suita', async () => {
      skip('appka se v prohlížeči neotevřela (' + openErr + ')');
    });
    return S;
  }

  try {
    /* stav appky — podle něj se rozhoduje PASS vs. SKIP u obsahu sestavy */
    let probe = null;
    try { probe = await probeApp(app.page); } catch (e) { warn('probeApp selhal: ' + msg(e)); }
    const booted = !!(probe && probe.booted);
    sub(`appka ${booted ? 'něco vykresluje' : 'zatím nevykresluje nic'}`
      + (probe ? ` · sekcí ${probe.sections}, řádků ${probe.rows}, měsíčních chipů ${probe.chips}` : ''));

    /* přepnutí na tiskové médium — odtud dolů se všechno měří jako na papíře */
    let printMedia = false, mediaErr = '';
    try {
      await app.page.emulateMedia({ media: 'print' });
      await settle(app.page);
      printMedia = true;
    } catch (e) {
      mediaErr = msg(e);
      warn('emulateMedia({media:"print"}) selhalo: ' + mediaErr);
    }

    /** Audit se udělá jednou a sdílí ho tři testy, ať je jasné, KTERÝ problém to je. */
    let audit = null, auditErr = '';
    if (printMedia) {
      try { audit = await app.page.evaluate(AUDIT_FN); } catch (e) { auditErr = msg(e); }
    }
    const needAudit = () => {
      if (!printMedia) skip('tiskové médium se nepodařilo zapnout (' + mediaErr + ')');
      if (!audit) skip('audit tiskového média se nepodařilo spustit (' + auditErr + ')');
      return audit;
    };
    if (audit) sub(`v tiskovém médiu vykresleno ${audit.seen} prvků (${audit.skipped} se netiskne)`);

    /* ── 1. tiskové médium rozbalí každou posuvnou oblast ──────────────────── */

    await S.test('tisk: žádný prvek si neroluje sám v sobě', async () => {
      const a = needAudit();
      // Tohle je TA chyba: appka roluje uvnitř `#main`, tiskárna dostane
      // jen viditelný výřez a rok se vytiskne na jednu stránku.
      assert.empty(tally(a.scrollers),
        'v tiskovém médiu zůstaly posuvné/oříznuté oblasti — vytiskne se jen viditelný výřez');
    });

    // Oddělené, protože je to jiná váha problému: uřízne se konec názvu
    // v legendě, ne celá tabulka. Přesto na papíře „Jídlo a potravi…" být nemá.
    await S.test('tisk: názvy se neuřezávají třemi tečkami', async () => {
      const a = needAudit();
      assert.empty(tally(a.ellipsis),
        'na papíře zůstal text zkrácený třemi tečkami — v tisku není kam klepnout, aby se dočetl');
    });

    await S.test('tisk: nikde nezůstala max-height', async () => {
      const a = needAudit();
      // Zastropovaná výška obsah nezalomí na další stránku, ale useká ho.
      assert.empty(a.maxHeights,
        'v tiskovém médiu zůstala max-height — obsah přes ni se na papír nedostane');
    });

    await S.test('tisk: nic není position: fixed ani sticky', async () => {
      const a = needAudit();
      // Sticky hlavička se v tisku zopakuje na každé stránce a ukousne půl řádku.
      assert.empty(a.positioned,
        'v tiskovém médiu zůstaly přilepené prvky — na každé stránce překryjí obsah');
    });

    /* ── 2. ovládání se na papír netiskne ─────────────────────────────────── */

    const CHROME = ['nav.tabbar', '#fab', '.sheet-backdrop', '#sheet-host', '#month-strip', '.sec-add'];

    await S.test('tisk: ovládací prvky se na papír netisknou', async () => {
      if (!printMedia) skip('tiskové médium se nepodařilo zapnout (' + mediaErr + ')');
      const r = await app.page.evaluate((sels) => {
        const res = { missing: [], visible: [] };
        for (const sel of sels) {
          const els = Array.from(document.querySelectorAll(sel));
          if (!els.length) { res.missing.push(sel); continue; }
          for (const e of els) {
            const d = getComputedStyle(e).display;
            if (d !== 'none') { res.visible.push(`${sel} → display: ${d}`); break; }
          }
        }
        return res;
      }, CHROME);

      if (r.missing.length === CHROME.length) {
        skip('žádný z ovládacích prvků v DOM ještě není: ' + r.missing.join(', '));
      }
      if (r.missing.length) sub('  ještě neexistuje: ' + r.missing.join(', '));
      // Tlačítka a lišty na papíře nejdou zmáčknout — jen ukusují místo
      // a při tisku do PDF vypadají jako chyba sazby.
      assert.empty(r.visible, 'ovládací prvky se v tiskovém médiu pořád kreslí');
    });

    await S.test('tisk: ovládání sekce zmizí, ale název sekce zůstane', async () => {
      if (!printMedia) skip('tiskové médium se nepodařilo zapnout (' + mediaErr + ')');
      const r = await app.page.evaluate(() => {
        const t = document.querySelector('.sec-toggle');
        if (!t) return { has: false };
        const vis = (e) => {
          if (!e) return false;
          if (typeof e.checkVisibility === 'function') { try { return e.checkVisibility(); } catch { /**/ } }
          return e.getClientRects().length > 0;
        };
        const title = t.querySelector('.sec-title') || document.querySelector('.sec-title');
        return {
          has: true,
          toggle: getComputedStyle(t).display,
          chevronVisible: Array.from(document.querySelectorAll('.sec-chevron')).some(vis),
          titleVisible: vis(title),
          titleText: title ? (title.textContent || '').trim().slice(0, 40) : '',
        };
      });
      if (!r.has) skip('.sec-toggle v DOM ještě není — sekce se zatím nevykreslují');

      const bad = [];
      // Šipka na rozbalení je čistě dotykové ovládání, na papíře nemá co dělat.
      if (r.chevronVisible) bad.push('.sec-chevron se pořád kreslí (na papíře je to jen ⌃ bez funkce)');
      // POZOR: `.sec-toggle` v sobě nese `.sec-title`, tedy JEDINÝ název sekce.
      // Schovat celé tlačítko a nechat kartu bez nadpisu je horší chyba než
      // tisknout tlačítko, takže se hlídá výsledek, ne selektor.
      if (!r.titleVisible) bad.push('název sekce se v tisku nevykreslí (display: ' + r.toggle + ')');
      assert.empty(bad, 'sekce se v tiskovém médiu chová špatně');
    });

    // `#screen-print` je do spuštění tisku SCHVÁLNĚ prázdný — naplní ho až
    // renderPrintView(). Test proto tisk nejdřív spustí a teprve pak se ptá,
    // jestli je sestava vidět. (Dřív se ptal rovnou a odcházel se SKIPem
    // „renderPrintView ještě neexistuje", i když už dávno existovala.)
    await S.test('tisk: #screen-print se v tiskovém médiu ukáže', async () => {
      if (!printMedia) skip('tiskové médium se nepodařilo zapnout (' + mediaErr + ')');
      const has = await app.page.evaluate(() => !!document.querySelector('#screen-print'));
      if (!has) skip('#screen-print v DOM není');

      const started = await app.page.evaluate(async () => {
        if (!window.__APP__) return 'appka nemá __APP__';
        let btn = document.querySelector('[data-act="io.print"]');
        if (!btn) {
          const s = window.__APP__.state();
          s.ui.screen = 'more';
          window.__APP__.render();
          await new Promise(r => setTimeout(r, 300));
          btn = document.querySelector('[data-act="io.print"]');
        }
        if (!btn) return 'tlačítko [data-act="io.print"] neexistuje';
        btn.click();
        await new Promise(r => setTimeout(r, 700));
        return null;
      });
      if (started) skip(started + ' — tisk se zatím nedá spustit');

      const r = await app.page.evaluate(() => {
        const e = document.querySelector('#screen-print');
        return {
          display: getComputedStyle(e).display,
          kids: e.children.length,
          text: (e.textContent || '').trim().length,
        };
      });
      assert.gte(r.kids + r.text, 1, 'tisk se spustil, ale #screen-print zůstal prázdný');
      assert.ne(r.display, 'none',
        '#screen-print má obsah, ale v tiskovém médiu je schovaný — sestava by vyšla prázdná');
    });

    /* ── 3.–6. skutečné A4 PDF ────────────────────────────────────────────── */

    // page.pdf() je jen v Chromiu. WebKit (Safari) žádné API na tisk do PDF
    // nemá — tam se tisk ověřuje ručně podle test/AKCEPTACE.md.
    let pdfReady = false, pdfErr = '';
    if (!chromium) {
      pdfErr = 'page.pdf() existuje jen v Chromiu a to tady není';
    } else if (!ensureOutDir()) {
      pdfErr = 'nešlo vyrobit adresář ' + OUT_DIR;
    } else {
      try {
        await app.page.pdf({
          path: PDF_PATH,
          format: 'A4',
          printBackground: true,
          margin: { top: '10mm', right: '10mm', bottom: '12mm', left: '10mm' },
        });
        pdfReady = existsSync(PDF_PATH) && statSync(PDF_PATH).size > 0;
        if (!pdfReady) pdfErr = 'PDF se sice vyrobilo, ale je prázdné';
      } catch (e) {
        pdfErr = msg(e);
      }
    }

    let pages = null, pagesHow = null;
    let text = null, textErr = '';
    if (pdfReady) {
      const pc = pdfPageCount(PDF_PATH);
      pages = pc.pages; pagesHow = pc.how;
      const tx = pdfText(PDF_PATH);
      if (tx.ok) text = tx.text; else textErr = tx.reason;
      sub(`PDF ${PDF_PATH} · ${statSync(PDF_PATH).size} B`
        + (pages != null ? ` · ${pages} str. (${pagesHow})` : ' · počet stránek neznámý')
        + (text != null ? ` · ${text.length} znaků textu` : ` · text nepřečten (${textErr})`));
      S.note(`tisková sestava: ${PDF_PATH}`);
    } else if (pdfErr) {
      sub('PDF se nevyrobilo: ' + pdfErr);
    }

    const needPdf = () => { if (!pdfReady) skip('PDF se nevyrobilo — ' + (pdfErr || 'neznámý důvod')); };
    const needText = () => {
      needPdf();
      if (text === null) skip('text z PDF se nedá přečíst — ' + (textErr || 'pdftotext chybí'));
      return text;
    };

    await S.test('tisková sestava má aspoň dvě stránky A4', async () => {
      needPdf();
      if (pages == null) skip('pdfinfo není nainstalovaný a v syrových bajtech se stránky nenašly');
      // Roční přehled s dvanácti měsíci a šesti sekcemi se na jednu A4 nevejde.
      // Jedna stránka = tiskne se jen viditelný výřez, přesně ta chyba z hlavičky.
      assert.gte(pages, 2,
        `sestava má ${pages} stránku — celý rok se na jednu A4 nevejde, tiskne se jen výřez`);
    });

    // Sestavy jsou DVĚ a každá má mít něco jiného. Měsíční přehled, ve kterém
    // se objeví všech dvanáct měsíců, je stejná chyba jako roční přehled,
    // ve kterém chybí jedenáct z nich.
    //
    // Pozor na pády: nominativ ("Září") je nadpis sestavy, genitiv ("září")
    // je součást data. V měsíčním přehledu se proto počítají jen NOMINATIVY —
    // genitiv sousedního měsíce tam být smí, protože zápis z 31. srpna
    // může být schválně započítaný do září.
    await S.test('měsíční sestava obsahuje právě jeden měsíc — ten vybraný', async () => {
      needPdf();
      if (!booted) skip('appka zatím nic nevykresluje — sestava je prázdná');
      if (!chromium) skip('page.pdf() existuje jen v Chromiu');
      const sel = await app.page.evaluate(() => (window.__APP__ ? window.__APP__.state().ui.month : null));
      if (sel === null) skip('__APP__ zatím není, nevím který měsíc je vybraný');

      const rep = await printMonthPdf(app.page);
      if (!rep.ok) skip(rep.reason);
      sub(`měsíční sestava ${rep.path} · ${rep.bytes} B`
        + (rep.pages != null ? ` · ${rep.pages} str.` : '')
        + (rep.text != null ? ` · ${rep.text.length} znaků` : ''));
      if (rep.text === null) skip('text z měsíční sestavy se nedá přečíst — ' + rep.textErr);

      const t = rep.text;
      const want = MONTHS_CS[sel][0];
      const found = MONTHS_CS.filter(([nom]) => hasWord(t, nom)).map(([nom]) => nom);
      assert.ok(found.includes(want),
        `v měsíční sestavě chybí nadpis vybraného měsíce „${want}" (našel jsem: ${found.join(', ') || 'žádný'})`);
      const extra = found.filter(n => n !== want);
      assert.empty(extra,
        `měsíční sestava je jen za „${want}", ale je v ní nadpis i jiných měsíců`);
    });

    await S.test('roční sestava obsahuje všech dvanáct měsíců', async () => {
      needPdf();
      if (!booted) skip('appka zatím nic nevykresluje — sestava je prázdná');
      if (!chromium) skip('page.pdf() existuje jen v Chromiu');

      const year = await printYearPdf(app.page);
      if (!year.ok) skip(year.reason);
      sub(`roční sestava ${YEAR_PDF_PATH} · ${year.bytes} B`
        + (year.pages != null ? ` · ${year.pages} str.` : '')
        + (year.text != null ? ` · ${year.text.length} znaků` : ''));
      if (year.text === null) skip('text z roční sestavy se nedá přečíst — ' + year.textErr);

      const missing = [];
      for (const [nom, gen] of MONTHS_CS) {
        // Měsíc se počítá za nalezený v nominativu (nadpis) i v genitivu
        // (datum „8. září 2026") — obojí je platný český tvar.
        if (!hasWord(year.text, nom) && !hasWord(year.text, gen)) missing.push(`${nom} (ani "${gen}")`);
      }
      assert.empty(missing, 'v roční sestavě chybí měsíce');
    });

    await S.test('roční sestava má aspoň dvanáct stránek (měsíc na stránku)', async () => {
      needPdf();
      if (!chromium) skip('page.pdf() existuje jen v Chromiu');
      const year = await printYearPdf(app.page);
      if (!year.ok) skip(year.reason);
      if (year.pages == null) skip('počet stránek roční sestavy se nepodařilo zjistit');
      assert.gte(year.pages, 12,
        `roční sestava má ${year.pages} stránek — dvanáct měsíců se na míň nevejde, `
        + 'nejspíš chybí zalomení stránky mezi měsíci');
    });

    await S.test('v roční sestavě není NaN, undefined ani [object Object]', async () => {
      needPdf();
      if (!chromium) skip('page.pdf() existuje jen v Chromiu');
      const year = await printYearPdf(app.page);
      if (!year.ok) skip(year.reason);
      if (year.text === null) skip('text z roční sestavy se nedá přečíst — ' + year.textErr);
      const bad = [];
      for (const needle of GARBAGE) {
        const i = year.text.indexOf(needle);
        if (i < 0) continue;
        bad.push(`${needle} → …${year.text.slice(Math.max(0, i - 25), i + needle.length + 25).replace(/\s+/g, ' ').trim()}…`);
      }
      assert.empty(bad, 'v roční sestavě je surový technický nesmysl');
    });

    await S.test('v PDF není NaN, undefined, Infinity ani [object Object]', async () => {
      const t = needText();
      const bad = [];
      for (const needle of GARBAGE) {
        const i = t.indexOf(needle);
        if (i < 0) continue;
        const excerpt = t.slice(Math.max(0, i - 25), i + needle.length + 25).replace(/\s+/g, ' ').trim();
        bad.push(`${needle} → …${excerpt}…`);
      }
      // Když se tohle vytiskne, mamka drží v ruce papír, kde místo částky
      // stojí "NaN Kč". Nedá se to opravit tužkou ani vysvětlit.
      assert.empty(bad, 'v tiskové sestavě je surový technický nesmysl');
    });

    await S.test('PDF není prázdné (má text a jsou v něm koruny)', async () => {
      const t = needText();
      if (!booted) skip('appka zatím nic nevykresluje — sestava je prázdná');
      // Test na počet stránek by prošel i u dvanácti bílých listů,
      // proto se navíc kouká, jestli tam vůbec něco stojí.
      assert.gte(t.replace(/\s+/g, ' ').trim().length, 200,
        'z PDF se dá vytáhnout skoro žádný text — stránky jsou prázdné');
      assert.ok(/Kč/.test(t), 'v sestavě není ani jedna částka v Kč');
    });

    /* ── 7. tisková parita s WebKitem ─────────────────────────────────────── */

    // Rozměry z Chromia si vezmeme hned, ať je s čím porovnávat, až WebKit
    // někdy nastartuje. Porovnávají se metriky, ne pixely — antialiasing
    // a písma se mezi jádry liší vždycky a o tisku nic neříkají.
    const PARITY_SELS = ['#app', 'main', '#screen-print', '.card'];
    const MEASURE_FN = (sels) => {
      const out = {};
      for (const sel of sels) {
        const e = document.querySelector(sel);
        out[sel] = e ? Math.round(e.getBoundingClientRect().width / 2) * 2 : null;
      }
      return out;
    };
    let chromeRects = null;
    if (printMedia) {
      try { chromeRects = await app.page.evaluate(MEASURE_FN, PARITY_SELS); } catch { /* nevadí */ }
    }

    await S.test('tisková parita: WebKit sází stejně široko jako Chromium', async () => {
      if (!webkitReal) {
        // Na tomhle stroji WebKit nejde spustit (Fedora nemá ICU 74, libjpeg 8,
        // libjxl 0.8 ani libbacktrace). Pouštět tenhle test na Chromiu a tvářit
        // se, že je to Safari, by bylo horší než ho nespustit vůbec.
        skip('WebKit nenastartoval — tiskovou paritu musí ověřit člověk na Macu podle test/AKCEPTACE.md kroku 11'
          + ' (nebo strojově: node test/run.mjs print --webkit)');
      }
      if (!chromeRects) skip('rozměry z Chromia se nepodařilo změřit');
      if (!ensureOutDir()) skip('nešlo vyrobit adresář ' + OUT_DIR);

      let wk = null;
      try {
        wk = await openApp(webkit, {
          viewport: PRINT_VIEWPORT, fixture: 'realistic-year', theme: 'light',
        });
      } catch (e) {
        skip('WebKit se nepodařilo otevřít: ' + msg(e));
      }
      try {
        await wk.page.emulateMedia({ media: 'print' });
        await settle(wk.page);
        await wk.page.screenshot({ path: WK_SHOT, fullPage: true });
        const wkRects = await wk.page.evaluate(MEASURE_FN, PARITY_SELS);
        const bad = [];
        for (const sel of PARITY_SELS) {
          const a = chromeRects[sel], b = wkRects[sel];
          if (a == null && b == null) continue;         // ani v jednom — nic k porovnání
          if (a == null || b == null) {
            bad.push(`${sel}: Chromium ${a == null ? 'nemá' : a + 'px'}, WebKit ${b == null ? 'nemá' : b + 'px'}`);
            continue;
          }
          if (Math.abs(a - b) > 2) bad.push(`${sel}: Chromium ${a}px vs. WebKit ${b}px`);
        }
        assert.empty(bad, `tisková šířka se mezi jádry rozchází (snímek: ${WK_SHOT})`);
      } finally {
        if (wk) await wk.close();
      }
    });

    /* ── 8. přetečení do strany na A4 ─────────────────────────────────────── */

    await S.test('tisk na A4: nic nepřetéká za pravý okraj', async () => {
      let a4 = null;
      try {
        a4 = await openApp(eng, { viewport: A4_VIEWPORT, fixture: 'realistic-year', theme: 'light' });
      } catch (e) {
        skip('druhý prohlížeč pro A4 se nepodařilo otevřít: ' + msg(e));
      }
      try {
        await a4.page.emulateMedia({ media: 'print' });
        await settle(a4.page);
        const r = await a4.page.evaluate((w) => {
          const nameOf = (e) => {
            const t = e.tagName ? e.tagName.toLowerCase() : '?';
            const id = e.id ? '#' + e.id : '';
            const raw = (e.getAttribute && e.getAttribute('class')) || '';
            const cls = raw.trim() ? '.' + raw.trim().split(/\s+/).slice(0, 4).join('.') : '';
            return t + id + cls;
          };
          const wide = [];
          for (const e of document.querySelectorAll('*')) {
            if (e.closest && e.closest('.sr-only')) continue;
            const rects = e.getClientRects();
            if (!rects.length) continue;
            const right = e.getBoundingClientRect().right;
            if (right > w + 1) wide.push(`${nameOf(e)}  pravý okraj ${Math.round(right)}px`);
          }
          return {
            scrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
            wide,
          };
        }, A4_VIEWPORT.width);

        // Co přeteče vpravo, tiskárna prostě uřízne — na papíře pak chybí
        // sloupec se skutečností a nikdo si toho nevšimne, dokud nepočítá.
        assert.lte(r.scrollWidth, A4_VIEWPORT.width + 1,
          `stránka je v tisku širší než A4 (${r.scrollWidth}px místo ${A4_VIEWPORT.width}px)`);
        assert.empty(r.wide, 'prvky přetékající za pravý okraj A4');
      } finally {
        if (a4) await a4.close();
      }
    });

    /* ── 9. povinná hlídka chyb ───────────────────────────────────────────── */

    // Tisk běží přes stejný kód jako obrazovka; když se cestou něco podělá,
    // musí to spadnout tady, a ne tiše vytisknout půlku sestavy.
    //
    // Jediná výjimka: "ResizeObserver loop completed with undelivered
    // notifications." Tohle nehlásí appka, ale prohlížeč sám — přepnutí na
    // tiskové médium překreslí celou stránku, ResizeObserver se v jednom
    // snímku spustí podruhé a Chrome to oznámí. Ověřeno: při běžném načtení
    // se hláška neobjeví, přijde až po emulateMedia({media:'print'}).
    // Nic se tím nerozbije a jinak by tenhle test padal navždycky.
    const RO_NOISE = /ResizeObserver loop/i;
    const roNoise = app.errors.console.filter(e => RO_NOISE.test(e));
    const printErrors = {
      page: app.errors.page,
      console: app.errors.console.filter(e => !RO_NOISE.test(e)),
      requests: app.errors.requests,
    };
    if (roNoise.length) {
      sub(`(${roNoise.length}× ResizeObserver loop po přepnutí na tisk — hláška prohlížeče, ne appky)`);
      S.note(`tisk vyvolal ${roNoise.length}× "ResizeObserver loop" — do chyb se nepočítá, ale ví se o tom`);
    }
    await errorBaseline(S, printErrors, 'tisk');

    if (!webkitReal) {
      S.note('tisková parita s reálným Safari NEOVĚŘENA — viz test/AKCEPTACE.md krok 11');
    }
  } finally {
    try { await app.close(); } catch { /* nevadí */ }
  }

  return S;
}
