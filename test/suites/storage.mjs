// test/suites/storage.mjs — ukládání dat.
//
// VŠECHNO tady jede přes http://127.0.0.1:8173. Není to formalita:
// Safari na localStorage z file:// hodí SecurityError, appka spadne do
// nouzové větve v paměti — a testy by pak vesele hlásily, že ukládání
// funguje, přestože by testovaly úplně jinou cestu. Proto první tvrzení
// v téhle suitě kontroluje protokol.
//
// Tohle je jediná kopie jejích dat. Každý test je tu proto, že nějaká
// varianta "prohlížeč odmítl uložit" znamená ztracený rozpočet.

import { Suite, assert, skip, header, sub } from '../lib/harness.mjs';
import {
  openApp, probeApp, errorBaseline, settle,
  STORE_KEY, SNAP_PREFIX, QUAR_PREFIX, BACKUP_KEY,
  readFixture, appFileUrl,
} from '../lib/page.mjs';
import { denseDoc } from '../fixtures/gen.mjs';

const IPHONE = ['iPhone 15', 'iPhone 14', 'iPhone 13'];
const MIB = 1024 * 1024;

function deviceOf(eng, names) {
  const d = (eng && eng.mod && eng.mod.devices) || {};
  for (const n of names) if (d[n]) return d[n];
  return null;
}

/** Přečte všechny klíče appky z localStorage. */
const DUMP = `(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    out[k] = localStorage.getItem(k);
  }
  return out;
})()`;

export async function run(opts) {
  const S = new Suite('storage');
  header('storage — ukládání (jen přes http://, nikdy file://)');

  const eng = opts.webkit || opts.chromium;
  if (!eng) { S.note('není prohlížeč'); return S; }
  const device = deviceOf(eng, IPHONE) || { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };
  sub(`engine: ${opts.webkitReal ? 'WebKit' : 'Chromium (náhrada za WebKit)'}`);
  if (!opts.webkitReal) {
    S.note('storage běželo v Chromiu — Safari má vlastní limity i vlastní SecurityError (AKCEPTACE.md 6, 7)');
  }

  const open = (o) => openApp(eng, { device, theme: 'light', ...o });

  /* ═══ 0. hlídka protokolu — musí být první ═══ */

  {
    const a = await open({ fixture: 'empty' });
    try {
      await errorBaseline(S, a.errors, 'úložiště');
      await S.test('testy úložiště opravdu běží přes http://, ne file://', async () => {
        const proto = await a.page.evaluate(() => location.protocol);
        assert.eq(proto, 'http:',
          'přes file:// hodí Safari na localStorage SecurityError a testovala by se nouzová větev v paměti');
      });
      await S.test('localStorage je přes http:// skutečně dostupné', async () => {
        const ok = await a.page.evaluate(() => {
          try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
          catch (e) { return String(e && e.name); }
        });
        assert.eq(ok, true, 'localStorage nejde ani zapsat — všechno ostatní by bylo bezcenné');
      });
    } finally { await a.close(); }
  }

  /* ═══ 1. zápis → načtení → bajt za bajt totéž ═══ */

  await (async () => {
    const a = await open({ fixture: 'realistic-year' });
    try {
      await S.test('zápis → znovunačtení → data jsou bajt za bajt stejná', async () => {
        const info = await probeApp(a.page);
        if (!info.booted) skip('appka zatím nic nevykresluje');

        const before = await a.page.evaluate((k) => {
          if (window.__APP__ && window.__APP__.save) window.__APP__.save();
          const raw = localStorage.getItem(k);
          if (!raw) return null;
          const d = JSON.parse(raw);
          return JSON.stringify({ years: d.years, activeYear: d.activeYear, settings: d.settings });
        }, STORE_KEY);
        if (before === null) skip('appka zatím nic neuložila');

        await a.page.reload({ waitUntil: 'load' });
        await settle(a.page);

        const after = await a.page.evaluate((k) => {
          const raw = localStorage.getItem(k);
          if (!raw) return null;
          const d = JSON.parse(raw);
          return JSON.stringify({ years: d.years, activeYear: d.activeYear, settings: d.settings });
        }, STORE_KEY);

        assert.ok(after !== null, 'po znovunačtení nezůstal v úložišti žádný dokument');
        if (before !== after) {
          const i = firstDiff(before, after);
          throw Object.assign(new Error(
            'data se při načtení a uložení změnila\n'
            + `        první rozdíl na znaku ${i}\n`
            + `        před:  …${before.slice(Math.max(0, i - 60), i + 60)}…\n`
            + `        po:    …${after.slice(Math.max(0, i - 60), i + 60)}…`), { name: 'AssertionError' });
        }
      });

      await S.test('po znovunačtení nechybí ani jedna položka', async () => {
        const info = await probeApp(a.page);
        if (!info.booted) skip('appka zatím nic nevykresluje');
        const n = await a.page.evaluate(() => {
          if (!window.__APP__) return null;
          const s = window.__APP__.state();
          const y = s.years[String(s.activeYear)];
          return {
            cats: y.catalog.length,
            tx: y.tx.length,
            entries: y.months.reduce((x, m) => x + m.entries.length, 0),
          };
        });
        if (!n) skip('__APP__ zatím není');
        assert.eq(n.cats, 69, 'kategorií');
        assert.eq(n.tx, 601, 'zápisů v deníku');
        assert.eq(n.entries, 816, 'položek v měsících');
      });
    } finally { await a.close(); }
  })();

  /* ═══ 2. poškozený obsah ═══
     Nic se nesmí zahodit. Uživatelka má jednu kopii a i rozsypaný soubor
     může být to jediné, z čeho se dá něco zachránit. */

  const CORRUPT = [
    ['úplně rozsypaný obsah', '}{ tohle není JSON \u0000 ###'],
    ['ořezaný, ale věrohodný JSON', readFixture('realistic-year').slice(0, 120000)],
    ['JSON, který není dokument appky', '{"neco":"jineho","cisla":[1,2,3]}'],
  ];

  for (const [label, payload] of CORRUPT) {
    const a = await open({ seed: { [STORE_KEY]: payload } });
    try {
      await S.test(`poškozeno (${label}): odloží se stranou a původní text zůstane`, async () => {
        const dump = await a.page.evaluate(DUMP);
        const quar = Object.keys(dump).filter(k => k.startsWith(QUAR_PREFIX));
        if (!quar.length) {
          throw Object.assign(new Error(
            `poškozený obsah se nikam neodložil (žádný klíč ${QUAR_PREFIX}*)\n`
            + `        klíče v úložišti: ${Object.keys(dump).join(', ') || '(žádné)'}`), { name: 'AssertionError' });
        }
        const kept = quar.some(k => String(dump[k]).includes(payload.slice(0, 200)));
        assert.ok(kept, `karanténa neobsahuje původní text (klíče: ${quar.join(', ')})`);
      });

      await S.test(`poškozeno (${label}): appka se i tak otevře a nespadne`, async () => {
        const alive = await a.page.evaluate(() => !!document.querySelector('#app') && !!window.__APP__);
        assert.ok(alive, 'appka se po poškozeném souboru vůbec nerozjela');
        const errs = a.errors.page.length;
        assert.eq(errs, 0, 'poškozený soubor vyhodil neodchycenou výjimku');
      });

      await S.test(`poškozeno (${label}): řekne to česky a nabídne, co s tím`, async () => {
        const txt = await a.page.evaluate(() => document.body.innerText || '');
        if (!/poškoz|nepodařilo|záloh/i.test(txt)) {
          throw Object.assign(new Error(
            'uživatelka se nikde nedozví, že se něco stalo\n        text stránky: '
            + txt.replace(/\s+/g, ' ').slice(0, 200)), { name: 'AssertionError' });
        }
      });
    } finally { await a.close(); }
  }

  /* ═══ 3. migrace v1 ═══
     "v1" = dokument bez klíče `schema`. Musí se načíst A musí po sobě
     nechat snímek toho, co tam bylo předtím — kdyby migrace něco pokazila,
     musí být z čeho couvnout. */

  {
    const v1 = (() => {
      const d = JSON.parse(readFixture('realistic-year'));
      delete d.schema;                    // jinak je to dnešní dokument
      return JSON.stringify(d);
    })();

    const a = await open({ seed: { [STORE_KEY]: v1 } });
    try {
      await S.test('v1 (bez klíče schema) se načte a doplní se mu schema', async () => {
        const r = await a.page.evaluate(() => {
          if (!window.__APP__) return null;
          const s = window.__APP__.state();
          const y = s.years[String(s.activeYear)];
          return { schema: s.schema, cats: y ? y.catalog.length : 0, tx: y ? y.tx.length : 0 };
        });
        if (!r) skip('__APP__ zatím není');
        assert.gte(r.schema, 1, 'po migraci chybí schema');
        assert.eq(r.cats, 69, 'migrace ztratila kategorie');
        assert.eq(r.tx, 601, 'migrace ztratila zápisy v deníku');
      });

      await S.test('v1: zůstane po ní snímek stavu PŘED migrací', async () => {
        const dump = await a.page.evaluate(DUMP);
        const snaps = Object.keys(dump).filter(k => k.startsWith(SNAP_PREFIX));
        if (!snaps.length) {
          throw Object.assign(new Error(
            `po migraci nezůstal žádný snímek (${SNAP_PREFIX}*), není kam couvnout\n`
            + `        klíče: ${Object.keys(dump).join(', ')}`), { name: 'AssertionError' });
        }
        const recoverable = snaps.some((k) => {
          const raw = dump[k];
          try {
            const o = JSON.parse(raw);
            const inner = o && o.doc ? o.doc : o;
            return inner && inner.years && Object.keys(inner.years).length > 0;
          } catch { return false; }
        });
        assert.ok(recoverable, `snímek nejde přečíst zpátky na dokument (klíče: ${snaps.join(', ')})`);
      });
    } finally { await a.close(); }
  }

  // Starý soubor s desetinnými částkami se SCHVÁLNĚ nepřepočítává
  // (viz komentář v unit suitě) — musí ho odmítnout validace, ne tichý odhad.
  {
    const a = await open({ seed: { [STORE_KEY]: readFixture('legacy-v1') } });
    try {
      await S.test('starý soubor s korunovými floaty se nepřijme potichu', async () => {
        const r = await a.page.evaluate((k) => {
          const out = { keys: [], amounts: [] };
          for (let i = 0; i < localStorage.length; i++) out.keys.push(localStorage.key(i));
          if (window.__APP__) {
            const s = window.__APP__.state();
            const y = s.years && s.years[String(s.activeYear)];
            if (y) {
              for (const mo of y.months) for (const e of mo.entries) {
                if (!Number.isSafeInteger(e.plan)) out.amounts.push('plan=' + e.plan);
                if (e.act !== null && !Number.isSafeInteger(e.act)) out.amounts.push('act=' + e.act);
              }
            }
          }
          void k;
          return out;
        }, STORE_KEY);
        assert.empty(r.amounts.slice(0, 6), 'desetinné částky se dostaly až do živého stavu — 14 500,5 Kč se dá přečíst i jako 145 Kč');
        const quarantined = r.keys.some(k => k.startsWith(QUAR_PREFIX));
        assert.ok(quarantined, `soubor se nikam neodložil, klíče: ${r.keys.join(', ')}`);
      });
    } finally { await a.close(); }
  }

  /* ═══ 4. došlo místo ═══
     Safari na iPhonu má na localStorage kolem 5 MB a hlásí to teprve při
     zápisu. Když se to spolkne, uživatelka píše do appky, která si nic
     nepamatuje, a zjistí to až za měsíc. */

  {
    const QUOTA_PATCH = `(() => {
      const real = Storage.prototype.setItem;
      let n = 0;
      Storage.prototype.setItem = function (k, v) {
        // Prvních pár zápisů projde (aby appka nabootovala), pak dojde místo.
        if (String(k).indexOf('rozpocet:doc') === 0 && ++n > 1) {
          const e = new DOMException('kvóta', 'QuotaExceededError');
          window.__quotaHits = (window.__quotaHits || 0) + 1;
          throw e;
        }
        return real.call(this, k, v);
      };
    })();`;

    const a = await open({ fixture: 'realistic-year', initScript: QUOTA_PATCH });
    try {
      await S.test('došlo místo: řekne se to česky a nabídne se záloha', async () => {
        await a.page.evaluate(() => {
          try { if (window.__APP__ && window.__APP__.save) window.__APP__.save(); } catch (e) { /* appka to má chytit sama */ }
        });
        await settle(a.page, 400);
        const r = await a.page.evaluate(() => ({
          text: document.body.innerText || '',
          hits: window.__quotaHits || 0,
          actions: Array.from(document.querySelectorAll('button')).map(b => (b.textContent || '').trim()).filter(Boolean),
        }));
        if (!r.hits) skip('appka při tomhle scénáři vůbec nezkusila zapsat');
        assert.match(r.text, /místo|nevešl|nepodařilo uložit|záloh/i,
          `o došlém místě se uživatelka nikde nedozví; text: ${r.text.replace(/\s+/g, ' ').slice(0, 200)}`);
        const offersExport = /záloh|stáhnout|ulož/i.test(r.actions.join(' | ')) || /stáhni si zálohu/i.test(r.text);
        assert.ok(offersExport, `nikde se nenabízí stažení zálohy; tlačítka: ${r.actions.slice(0, 12).join(' | ')}`);
      });

      await S.test('došlo místo: v paměti se neztratí ani koruna', async () => {
        const n = await a.page.evaluate(() => {
          if (!window.__APP__) return null;
          const s = window.__APP__.state();
          const y = s.years[String(s.activeYear)];
          return { cats: y.catalog.length, tx: y.tx.length };
        });
        if (!n) skip('__APP__ zatím není');
        assert.eq(n.cats, 69, 'po chybě zápisu zmizely kategorie z paměti');
        assert.eq(n.tx, 601, 'po chybě zápisu zmizely zápisy z paměti');
      });

      await S.test('došlo místo: s appkou se dá dál pracovat', async () => {
        assert.empty(a.errors.page.slice(0, 3), 'chyba kvóty vyhodila neodchycenou výjimku');
        const worked = await a.page.evaluate(async () => {
          if (!window.__APP__) return null;
          const s = window.__APP__.state();
          const was = s.ui.month;
          const next = (was + 1) % 12;
          try {
            s.ui.month = next;
            window.__APP__.render();
            await new Promise(r => setTimeout(r, 200));
            return { ok: s.ui.month === next, was, next };
          } catch (e) { return { ok: false, err: String(e) }; }
        });
        if (!worked) skip('__APP__ zatím není');
        assert.ok(worked.ok, 'po chybě kvóty už appka nereaguje: ' + (worked.err || ''));
      });
    } finally { await a.close(); }
  }

  /* ═══ 5. úložiště zamčené hned od začátku ═══
     Safari v soukromém okně (a při některých nastaveních ochrany soukromí)
     hodí SecurityError už na prvním zápisu. */

  {
    const SEC_PATCH = `(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).indexOf('rozpocet:') === 0) throw new DOMException('zakázáno', 'SecurityError');
        return real.call(this, k, v);
      };
    })();`;

    const a = await open({ fixture: 'empty', initScript: SEC_PATCH });
    try {
      await S.test('zamčené úložiště: appka jede dál v paměti a viditelně to přizná', async () => {
        await settle(a.page, 300);
        const r = await a.page.evaluate(() => ({
          text: document.body.innerText || '',
          banner: !!document.querySelector('.banner'),
          alive: !!window.__APP__,
          storageOk: window.__APP__ ? window.__APP__.storageOk : null,
        }));
        assert.ok(r.alive, 'appka se při zamčeném úložišti vůbec nerozjela');
        assert.eq(r.storageOk, false, 'appka si myslí, že ukládání funguje, přestože nefunguje');
        assert.ok(r.banner, 'chybí viditelný proužek s upozorněním');
        assert.match(r.text, /neukl|neulož|nejde uložit|nezůstan/i,
          `není česky napsáno, že se data neuloží; text: ${r.text.replace(/\s+/g, ' ').slice(0, 200)}`);
      });
    } finally { await a.close(); }
  }

  /* ═══ 6. otevřeno z file:// ═══
     Když si soubor stáhne a otevře poklepáním, Safari localStorage zakáže.
     Musí to poznat a říct — ne se tvářit, že je všechno v pořádku. */

  {
    let a = null;
    try {
      a = await open({ url: appFileUrl(), fixture: null });
      await S.test('otevřeno z file://: ukáže se český proužek „data se neukládají"', async () => {
        await settle(a.page, 400);
        const r = await a.page.evaluate(() => ({
          proto: location.protocol,
          text: document.body.innerText || '',
          alive: !!document.querySelector('#app'),
        }));
        assert.eq(r.proto, 'file:', 'tenhle jediný test má běžet z file://');
        assert.ok(r.alive, 'z file:// se appka vůbec nevykreslila');
        // Chromium localStorage z file:// povolí, Safari ne. Když se sem
        // dostane povolené úložiště, banner logicky nebude — a to je v pořádku.
        const blocked = await a.page.evaluate(() => {
          try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return false; }
          catch { return true; }
        });
        if (!blocked) skip('tenhle prohlížeč z file:// ukládat umí (Safari ne) — ověřit ručně podle AKCEPTACE.md');
        assert.match(r.text, /neukl|neulož|nezůstan|adres/i,
          `chybí české varování; text: ${r.text.replace(/\s+/g, ' ').slice(0, 200)}`);
      });
    } catch (e) {
      await S.test('otevřeno z file://: ukáže se český proužek „data se neukládají"', () => { throw e; });
    } finally { if (a) await a.close(); }
  }

  /* ═══ 7. velikost ═══
     12 měsíců plných dat a 2000 zápisů se musí vejít hluboko pod limit
     Safari (~5 MB), aby zbylo místo na zálohu i na karanténu. */

  {
    const dense = denseDoc(2000);
    const json = JSON.stringify(dense);
    const bytes = Buffer.byteLength(json, 'utf8');

    await S.test('12 měsíců + 2000 zápisů se vejde pod 1,5 MiB', async () => {
      const y = dense.years[String(dense.activeYear)];
      assert.eq(y.tx.length, 2000, 'kontrolní data nemají 2000 zápisů');
      assert.eq(y.months.length, 12);
      assert.lte(bytes, 1.5 * MIB,
        `dokument má ${(bytes / MIB).toFixed(2)} MiB (${bytes} B) — na iPhonu je strop kolem 5 MB a musí zbýt i na zálohu`);
      sub(`hustý rok: ${(bytes / MIB).toFixed(2)} MiB / ${(bytes / 2000).toFixed(0)} B na zápis`);
    });

    const a = await open({ seed: { [STORE_KEY]: json } });
    try {
      await S.test('hustý rok se do úložiště opravdu vejde a přečte se zpátky', async () => {
        const r = await a.page.evaluate((k) => {
          const raw = localStorage.getItem(k);
          if (!raw) return null;
          let tx = null;
          try { const d = JSON.parse(raw); tx = d.years[String(d.activeYear)].tx.length; } catch { /* nic */ }
          return { len: raw.length, tx };
        }, STORE_KEY);
        assert.ok(r, 'v úložišti po zápisu nic není');
        assert.eq(r.tx, 2000, 'zpátky se nepřečetlo všech 2000 zápisů');
        assert.lte(r.len, 1.5 * MIB, `v úložišti zabírá ${(r.len / MIB).toFixed(2)} MiB`);
      });

      await S.test('hustý rok appku nepoloží (vykreslí se do 6 s)', async () => {
        const info = await probeApp(a.page);
        if (!info.booted) skip('appka zatím nic nevykresluje');
        assert.gte(info.rows, 1, 's hustými daty se nevykreslil ani jeden řádek');
        assert.empty(a.errors.page.slice(0, 3), 'hustá data vyhodila výjimku');
      });
    } finally { await a.close(); }
  }

  /* ═══ 8. záloha vedle hlavního klíče ═══ */

  {
    const a = await open({ fixture: 'realistic-year' });
    try {
      await S.test('vedle hlavního klíče drží appka i druhou kopii', async () => {
        await a.page.evaluate(() => { if (window.__APP__ && window.__APP__.save) window.__APP__.save(); });
        await settle(a.page, 250);
        const keys = await a.page.evaluate(() => {
          const out = [];
          for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
          return out;
        });
        if (!keys.includes(BACKUP_KEY)) {
          skip(`druhá kopie (${BACKUP_KEY}) zatím není — klíče: ${keys.join(', ')}`);
        }
        const same = await a.page.evaluate(([m, b]) => {
          const A = localStorage.getItem(m), B = localStorage.getItem(b);
          if (!A || !B) return null;
          try {
            return JSON.stringify(JSON.parse(A).years) === JSON.stringify(JSON.parse(B).years);
          } catch { return false; }
        }, [STORE_KEY, BACKUP_KEY]);
        assert.ok(same !== false, 'druhá kopie obsahuje jiná data než hlavní klíč');
      });
    } finally { await a.close(); }
  }

  return S;
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}
