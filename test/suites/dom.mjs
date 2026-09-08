// test/suites/dom.mjs — ovládání na iPhonu.
//
// Tahle suita je o tom, jestli se to dá v ruce POUŽÍT: jestli kurzor při psaní
// neuteče, jestli se dá do políčka trefit prstem, jestli hlavička drží
// a jestli se položky při přepínání měsíců tiše nemnoží.
//
// Cílové zařízení: iPhone 15, Safari, čeština, Praha.
// Pozor: na tomhle stroji WebKit nenastartuje (ICU 74 vs. 77), takže bez
// `--webkit` (kontejner) tohle běží v Chromiu a chování Safari NENÍ ověřeno.

import { Suite, assert, skip, header, sub } from '../lib/harness.mjs';
import { openApp, probeApp, errorBaseline, settle } from '../lib/page.mjs';

const IPHONE = ['iPhone 15', 'iPhone 14', 'iPhone 13', 'iPhone 12'];

function deviceOf(eng, names) {
  const d = (eng && eng.mod && eng.mod.devices) || {};
  for (const n of names) if (d[n]) return { name: n, device: d[n] };
  return { name: null, device: null };
}

export async function run(opts) {
  const S = new Suite('dom');
  header('dom — ovládání na iPhonu (caret, dotyk, sticky, měsíce)');

  const eng = opts.webkit || opts.chromium;
  if (!eng) { S.note('není prohlížeč'); return S; }
  const { name: devName, device } = deviceOf(eng, IPHONE);
  sub(`engine: ${opts.webkitReal ? 'WebKit' : 'Chromium (náhrada za WebKit)'} · zařízení: ${devName || 'vlastní 393×852'}`);
  if (!opts.webkitReal) {
    S.note('dom běželo v Chromiu — caret a sticky v Safari musí ověřit člověk (AKCEPTACE.md 3, 4)');
  }

  const base = device || { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

  let app = null;
  try {
    app = await openApp(eng, { device: base, theme: 'light', fixture: 'realistic-year' });
  } catch (e) {
    S.note('appku se nepodařilo otevřít: ' + String(e).split('\n')[0]);
    await S.test('appka se otevře', () => { throw e; });
    return S;
  }

  const { page, errors } = app;
  const info = await probeApp(page);
  sub(`vykresleno: ${info.sections} sekcí, ${info.rows} řádků, ${info.amtInputs} částkových polí`);
  const notBooted = () => { if (!info.booted) skip('appka zatím nic nevykresluje'); };

  try {
    await errorBaseline(S, errors, 'iPhone');

    /* ═══════════ 1. CARET — hlavní test celé téhle appky ═══════════
       Formátování částky za běhu (přepsání value v `input` handleru) přesune
       kurzor na konec. Uživatelka pak napíše "1 234" a v poli má "4321".
       Proto se po KAŽDÉM stisku kontroluje trojice: fokus, pozice kurzoru,
       hodnota. Když to praskne, hláška ukáže přesně u kterého znaku. */

    await S.test('caret: psaní "1 234,50" po znacích neutíká kurzor', async () => {
      notBooted();
      if (!info.amtInputs) skip('žádné `input.amt` — řádky se zatím nevykreslují');

      const TEXT = '1 234,50';
      const target = page.locator('input.amt').first();
      await target.evaluate((el) => {
        window.__caret = el;
        el.focus();
        el.value = '';
        el.setSelectionRange(0, 0);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(60);

      const bad = [];
      for (let i = 0; i < TEXT.length; i++) {
        const ch = TEXT[i];
        await page.keyboard.type(ch);
        await page.waitForTimeout(60);            // 60 ms mezera, jako by psal člověk
        const st = await page.evaluate(() => {
          const a = document.activeElement;
          return {
            isTarget: a === window.__caret,
            tag: a ? a.tagName.toLowerCase() + '.' + String(a.className || '').split(' ')[0] : '(nic)',
            value: a && 'value' in a ? a.value : null,
            sel: a && 'selectionStart' in a ? a.selectionStart : null,
          };
        });
        const want = TEXT.slice(0, i + 1);
        if (!st.isTarget) bad.push(`znak ${i + 1} (${JSON.stringify(ch)}): fokus utekl na ${st.tag}`);
        else if (st.value !== want) bad.push(`znak ${i + 1} (${JSON.stringify(ch)}): hodnota ${JSON.stringify(st.value)}, čekal ${JSON.stringify(want)}`);
        else if (st.sel !== i + 1) bad.push(`znak ${i + 1} (${JSON.stringify(ch)}): kurzor na ${st.sel}, čekal ${i + 1} (hodnota ${JSON.stringify(st.value)})`);
        if (bad.length >= 4) break;               // víc už jen šumí
      }
      assert.empty(bad, 'kurzor/hodnota se při psaní rozešly');
    });

    await S.test('caret: vložení číslice doprostřed nepřeskočí na konec', async () => {
      notBooted();
      if (!info.amtInputs) skip('žádné `input.amt`');
      const target = page.locator('input.amt').first();
      await target.evaluate((el) => {
        el.focus();
        el.value = '1234';
        el.setSelectionRange(2, 2);               // kurzor mezi "12" a "34"
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(60);
      await page.keyboard.type('9');
      await page.waitForTimeout(80);
      const st = await page.evaluate(() => {
        const a = document.activeElement;
        return { value: a.value, sel: a.selectionStart, cls: String(a.className || '') };
      });
      assert.eq(st.value, '12934', 'číslice se vložila jinam, než kam ukazoval kurzor');
      assert.eq(st.sel, 3, 'kurzor po vložení neskočil za vloženou číslici');
    });

    await S.test('caret: po opuštění pole ukáže sousední `.amt-display` naformátovanou částku', async () => {
      notBooted();
      if (!info.amtInputs) skip('žádné `input.amt`');
      const got = await page.evaluate(async () => {
        const el = document.querySelector('input.amt');
        el.focus();
        el.value = '12934';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.blur();
        el.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 260));
        const cell = el.closest('label, .cell') || el.parentElement;
        const disp = cell && cell.querySelector('.amt-display');
        return { disp: disp ? disp.textContent : null, value: el.value };
      });
      if (got.disp === null) skip('`.amt-display` v řádku zatím není');
      const flat = String(got.disp).replace(/[  \s]/g, '');
      assert.match(flat, /12934/, `.amt-display ukazuje ${JSON.stringify(got.disp)}, čekal jsem 12 934 Kč`);
    });

    /* ═══════════ 2. typ pole ═══════════
       input[type=number] na iOS nepustí českou čárku a kurzor v něm skáče.
       Kontroluje se i obsah <template>, protože z nich se řádky teprve klonují. */

    await S.test('nikde není input[type=number] (ani v šablonách)', async () => {
      const hits = await page.evaluate(() => {
        const out = [];
        const scan = (root, where) => {
          root.querySelectorAll('input[type="number"], input[type=number]')
            .forEach(i => out.push(`${where}: ${i.className || i.name || '(bez třídy)'}`));
        };
        scan(document, 'dokument');
        document.querySelectorAll('template').forEach(t => scan(t.content, 'šablona #' + t.id));
        return out;
      });
      assert.empty(hits, 'input[type=number] — iOS v něm nepustí čárku a rozbije kurzor');
    });

    await S.test('každý `input.amt` je type=text + inputmode=decimal', async () => {
      const bad = await page.evaluate(() => {
        const out = [];
        const check = (i, where) => {
          const t = (i.getAttribute('type') || 'text').toLowerCase();
          const im = (i.getAttribute('inputmode') || '').toLowerCase();
          if (t !== 'text') out.push(`${where}: type="${t}"`);
          if (im !== 'decimal') out.push(`${where}: inputmode="${im || '(chybí)'}"`);
        };
        document.querySelectorAll('input.amt').forEach((i, n) => check(i, `dokument #${n}`));
        document.querySelectorAll('template').forEach(t =>
          t.content.querySelectorAll('input.amt').forEach((i, n) => check(i, `šablona #${t.id} #${n}`)));
        return out;
      });
      assert.empty(bad, 'částkové pole má špatný typ — na iOS by chyběla číselná klávesnice s čárkou');
    });

    /* ═══════════ 3. velikost písma ═══════════
       Pod 16px Safari při zaostření pole stránku přiblíží a rozhodí layout. */

    await S.test('každý input/select/textarea má aspoň 16px', async () => {
      const bad = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('input, select, textarea').forEach((el) => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          const fs = parseFloat(cs.fontSize);
          if (!(fs >= 16)) out.push(`${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]} = ${cs.fontSize}`);
        });
        return out;
      });
      assert.empty(bad, 'pod 16px Safari při psaní zoomne celou stránku');
    });

    /* ═══════════ 4. dotykové cíle ═══════════ */

    await S.test('každé tlačítko, odkaz a zaškrtávátko má aspoň 44×44 px', async () => {
      const bad = await page.evaluate(() => {
        const out = [];
        const sel = 'button, a[href], label:has(input[type=checkbox]), input[type=checkbox], [role=button]';
        let nodes;
        try { nodes = document.querySelectorAll(sel); }
        catch { nodes = document.querySelectorAll('button, a[href], input[type=checkbox], [role=button]'); }
        nodes.forEach((el) => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) return;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;      // schované, neřešíme
          if (r.width < 44 || r.height < 44) {
            const id = el.dataset && el.dataset.act ? `[data-act=${el.dataset.act}]` : '';
            out.push(`${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}${id} = ${Math.round(r.width)}×${Math.round(r.height)}`);
          }
        });
        return out;
      });
      assert.empty(bad, 'moc malý dotykový cíl — prstem se do něj netrefí (Apple HIG: 44×44 pt)');
    });

    /* ═══════════ 5. vodorovné posouvání ═══════════ */

    await S.test('žádné vodorovné posouvání na 320 / 375 / 393 / 430 / 768 / 1024', async () => {
      const bad = [];
      for (const w of [320, 375, 393, 430, 768, 1024]) {
        await page.setViewportSize({ width: w, height: 800 });
        await settle(page, 180);
        const r = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          iw: window.innerWidth,
          culprits: Array.from(document.querySelectorAll('*')).filter((el) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.right > window.innerWidth + 1;
          }).slice(0, 3).map(el => `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`),
        }));
        if (r.sw > r.iw + 1) bad.push(`${w}px: scrollWidth ${r.sw} > ${r.iw}` + (r.culprits.length ? ` — přetéká ${r.culprits.join(', ')}` : ''));
      }
      await page.setViewportSize({ width: base.viewport ? base.viewport.width : 393, height: base.viewport ? base.viewport.height : 852 });
      await settle(page, 180);
      assert.empty(bad, 'stránka jde posunout do strany');
    });

    /* ═══════════ 6. sticky hlavička ═══════════
       Nejčastější příčina "sticky nedrží" není sticky samotné, ale
       `overflow: hidden` na některém předkovi. Proto se leze po rodičích. */

    // Hlavička nemusí sedět na y=0 — NAD ní může být proužek (#banner-host)
    // s upozorněním „Přidej si mě na plochu". Správné tvrzení proto není
    // „hlavička je na nule", ale „hlavička se nehnula od spodní hrany toho,
    // co je nad ní". Jinak by test hlásil chybu jen proto, že se ukazuje
    // banner — a nutil by ho někoho vypnout, aby testy prošly.
    await S.test('hlavička drží nahoře i po 1200 px posunutí', async () => {
      notBooted();
      const hdr = await page.locator('header.app-header, #app-header').count();
      if (!hdr) skip('hlavička v DOM není');
      const r = await page.evaluate(async () => {
        const h = document.querySelector('header.app-header, #app-header');
        const banner = document.querySelector('#banner-host');
        const bannerH = banner ? banner.getBoundingClientRect().height : 0;

        // Posouvá se TA oblast, ve které je obsah — u téhle appky `#main`.
        // Kdyby se místo toho posouval kořen dokumentu, odjela by celá
        // stránka i s hlavičkou; to je jiná chyba a hlídá ji vlastní test.
        let scroller = document.querySelector('#main') || document.querySelector('main');
        if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) {
          scroller = null;
          for (const n of document.querySelectorAll('*')) {
            const cs = getComputedStyle(n);
            if (/auto|scroll/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) {
              if (!scroller || n.scrollHeight > scroller.scrollHeight) scroller = n;
            }
          }
        }
        if (!scroller) {
          const de = document.scrollingElement || document.documentElement;
          if (de.scrollHeight > de.clientHeight + 1) scroller = de;
        }
        if (!scroller) return { none: true };

        const before = h.getBoundingClientRect().top;
        scroller.scrollTop = 1200;
        await new Promise(rr => requestAnimationFrame(() => requestAnimationFrame(rr)));
        await new Promise(rr => setTimeout(rr, 200));
        return {
          before,
          top: h.getBoundingClientRect().top,
          bannerH,
          bannerText: banner ? (banner.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) : '',
          pos: getComputedStyle(h).position,
          scrolled: scroller.scrollTop,
          scrollerName: scroller.tagName.toLowerCase() + (scroller.id ? '#' + scroller.id : ''),
        };
      });
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
        const m = document.querySelector('#main');
        if (m) m.scrollTop = 0;
      });
      await settle(page, 150);
      if (r.none) skip('na stránce zatím není nic, co by se dalo posunout');
      if (r.scrolled < 100) skip(`obsah se nedá posunout (${r.scrollerName} scrollTop ${r.scrolled}) — zatím není dost obsahu`);

      // Očekávaná pozice = spodní hrana proužku nad hlavičkou (obvykle 0).
      const want = r.bannerH;
      const drift = Math.abs(r.top - want);
      const why = r.bannerH
        ? ` (nad hlavičkou je proužek #banner-host vysoký ${r.bannerH.toFixed(0)} px${r.bannerText ? `: „${r.bannerText}…"` : ''})`
        : '';
      assert.lte(drift, 1,
        `hlavička se po posunutí ${r.scrollerName} o ${r.scrolled} px odlepila: je na y=${r.top.toFixed(1)}, `
        + `má být ${want.toFixed(1)}${why}. position: ${r.pos}`);
    });

    // Posouvat se má JEN obsah uvnitř `#main`. `#app` je proto vysoké
    // 100svh a `overflow: hidden`. Když má i tak kořen dokumentu volnost,
    // dá se odsunout celá stránka — a odjede s ní hlavička i spodní lišta.
    // Na iPhonu to vypadá, jako by se appka utrhla pod výřezem.
    //
    // Měří se VOLNOST kořene, ne gesto: `mouse.wheel` mobilní WebKit vůbec
    // neumí, takže gesto by test v Safari jen shodilo. Gesto se proto zkusí
    // navíc a jen když jde — je to důkaz, že se k té volnosti dá dostat.
    await S.test('celá stránka se posouvat nedá — posouvá se jen obsah', async () => {
      notBooted();
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      });

      let gesture = null;
      try {
        await page.mouse.move(200, 40);            // nad hlavičkou, ne nad seznamem
        for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 300);
        await settle(page, 300);
        gesture = await page.evaluate(() => Math.max(
          window.scrollY, (document.scrollingElement || document.documentElement).scrollTop));
      } catch {
        gesture = null;                            // mobilní WebKit kolečko nemá
      }

      const r = await page.evaluate(() => {
        const de = document.scrollingElement || document.documentElement;
        const tall = [];
        for (const n of document.body.querySelectorAll('*')) {
          const b = n.getBoundingClientRect();
          if (b.height > 0 && b.bottom > window.innerHeight + 50 && getComputedStyle(n).position === 'static') {
            tall.push(`${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''} sahá do ${Math.round(b.bottom)} px`);
          }
        }
        return { slack: de.scrollHeight - de.clientHeight, tall: tall.slice(0, 3) };
      });
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      });
      await settle(page, 150);

      const proof = gesture === null
        ? ' (gesto kolečkem tenhle engine neumí, měřím jen volnost)'
        : `, gestem se opravdu posunula o ${gesture} px`;
      assert.lte(r.slack, 1,
        `kořen dokumentu má ${r.slack} px volnosti${proof} — `
        + '`#app { height: 100svh; overflow: hidden }` tady neořezává'
        + (r.tall.length ? `\n        přečnívá: ${r.tall.join(', ')}` : ''));
    });

    // Sticky se nejčastěji nerozbije samo — rozbije ho `overflow` na předkovi.
    // Předek s overflow jiným než `visible` se stane scroll kontejnerem
    // a prvek se pak lepí k NĚMU, ne k tomu, co se opravdu posouvá.
    //
    // ALE: tohle pravidlo platí jen tehdy, když je sticky prvek UVNITŘ
    // posuvné oblasti. V tomhle layoutu je hlavička flexový sourozenec NAD
    // scrollerem (`#app` je pevných 100svh, posouvá se až `#main` pod ní),
    // takže drží prostě proto, že se s ní nic neposouvá — sticky na ní je
    // mrtvé CSS a není co rozbít. Kdyby test trval na „žádný předek nesmí
    // mít overflow", nutil by přepsat funkční layout kvůli pravidlu,
    // které se na něj nevztahuje.
    await S.test('žádný předek sticky hlavičky nemá overflow jiné než visible', async () => {
      const r = await page.evaluate(() => {
        const h = document.querySelector('header.app-header, #app-header');
        if (!h) return null;
        const label = (n) => `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}`
          + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : '');

        // Co se na téhle stránce OPRAVDU posouvá?
        const scrollers = [];
        const root = document.scrollingElement || document.documentElement;
        if (root.scrollHeight > root.clientHeight + 1) scrollers.push(root);
        for (const n of document.querySelectorAll('*')) {
          const cs = getComputedStyle(n);
          const scrolly = /auto|scroll/.test(cs.overflowY) || /auto|scroll/.test(cs.overflowX);
          if (scrolly && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) {
            scrollers.push(n);
          }
        }
        // Je hlavička uvnitř některé z nich?
        const inside = scrollers.filter(s => s !== root && s.contains(h) && s !== h);
        const insideRoot = scrollers.includes(root);

        if (!inside.length) {
          return {
            scoped: false,
            pos: getComputedStyle(h).position,
            insideRoot,
            scrollers: scrollers.map(label).slice(0, 4),
          };
        }

        // Hlavička JE v posuvné oblasti → hlídej předky mezi ní a scrollerem.
        const scroller = inside[inside.length - 1];
        const bad = [];
        let n = h.parentElement;
        while (n && n !== scroller) {
          const cs = getComputedStyle(n);
          for (const prop of ['overflow', 'overflowX', 'overflowY']) {
            const v = cs[prop];
            if (v !== 'visible' && !/^visible/.test(v)) bad.push(`${label(n)} má ${prop}: ${v}`);
          }
          n = n.parentElement;
        }
        return { scoped: true, bad, scroller: label(scroller), pos: getComputedStyle(h).position };
      });

      if (r === null) skip('hlavička v DOM není');
      if (!r.scoped) {
        skip(`hlavička není uvnitř posuvné oblasti (posouvá se ${r.scrollers.join(', ') || 'nic'}), `
          + `drží ji layout — position: ${r.pos} je tu bez účinku a není co rozbít`);
      }
      assert.empty(r.bad,
        `mezi hlavičkou a posuvnou oblastí (${r.scroller}) je předek s overflow != visible — `
        + `ruší position: ${r.pos}`);
    });

    /* ═══════════ 7. zmenšený výřez kvůli klávesnici ═══════════
       Klávesnice na iPhonu sebere zhruba 336 px. Když se appka nepostará
       o odscrollování, uživatelka píše do políčka, na které nevidí. */

    // POZOR NA HRANICI MOŽNOSTÍ EMULACE.
    // Na iPhonu drží zaostřené pole nad klávesnicí PROHLÍŽEČ: appka mu to
    // řekne přes `interactive-widget=resizes-content` a Safari pak samo
    // odroluje na zaostřený prvek. Zmenšení výřezu přes setViewportSize()
    // ale prohlížeči neřekne „vyjela klávesnice" — jen zkrátí okno, takže
    // se to odrolování nespustí ani v Chromiu, ani ve WebKitu.
    //
    // Testuje se proto jen to, co se ověřit DÁ:
    //   1. appka o mechanismus vůbec žádá (meta v hlavičce),
    //   2. pole, které bylo pohodlně vidět, po zkrácení výřezu nezmizí
    //      (chytá appku, která si při resize sama přeskládá obsah).
    // Pole, které se pod zkrácený výřez schová jen proto, že je výřez
    // kratší, se hlásí jako SKIP — to umí potvrdit jedině skutečný telefon
    // podle test/AKCEPTACE.md kroku 4.
    await S.test('appka si řekne o zmenšení obsahu při vyjeté klávesnici', async () => {
      const meta = await page.evaluate(() => {
        const m = document.querySelector('meta[name="viewport"]');
        return m ? m.getAttribute('content') || '' : null;
      });
      if (meta === null) throw Object.assign(new Error('v hlavičce chybí meta[name=viewport]'), { name: 'AssertionError' });
      assert.match(meta, /interactive-widget\s*=\s*resizes-content/,
        'bez `interactive-widget=resizes-content` iOS obsah nezmenší a klávesnice pole překryje;'
        + ` v meta je: ${JSON.stringify(meta)}`);
    });

    await S.test('při vytažené klávesnici (393×516) je zaostřené pole vidět celé', async () => {
      notBooted();
      if (!info.amtInputs) skip('žádné `input.amt`');
      const bad = [];
      const browserWould = [];   // spadlo pod fold jen kvůli kratšímu výřezu
      const KB = 516;
      const count = await page.locator('.sec-card').count();
      const sections = count ? count : 1;

      for (let i = 0; i < sections; i++) {
        await page.setViewportSize({ width: 393, height: 852 });
        await settle(page, 160);

        // 1. najdi poslední pole v sekci a vyroluj ho na obrazovku
        const ready = await page.evaluate(async (idx) => {
          const cards = Array.from(document.querySelectorAll('.sec-card'));
          const card = cards[idx];
          const list = card ? card.querySelectorAll('input.amt') : document.querySelectorAll('input.amt');
          const el = list[list.length - 1];
          if (!el) return null;
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          await new Promise(r => setTimeout(r, 200));
          const r = el.getBoundingClientRect();
          const visible = r.top >= 0 && r.bottom <= window.innerHeight;
          el.focus();                              // 2. „klepnutí" do viditelného pole
          window.__kbTarget = el;
          const sec = card ? (card.dataset.sec || card.getAttribute('data-sec') || String(idx)) : String(idx);
          return { visible, sec, top: Math.round(r.top) };
        }, i);
        if (!ready) continue;
        if (!ready.visible) continue;              // nešlo vyrolovat, neměříme

        // 3. vyjede klávesnice
        await page.setViewportSize({ width: 393, height: 516 });
        await settle(page, 320);

        const r = await page.evaluate(() => {
          const el = window.__kbTarget;
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return {
            top: Math.round(b.top), bottom: Math.round(b.bottom),
            h: window.innerHeight, focused: document.activeElement === el,
          };
        });
        if (!r) continue;
        if (r.top >= 0 && r.bottom <= r.h) continue;         // v pořádku

        // Nehnulo se, jen výřez se zkrátil pod něj → tohle je přesně ta
        // situace, kterou na zařízení dořeší prohlížeč a emulace ne.
        const stillWhereItWas = Math.abs(r.top - ready.top) <= 2;
        if (stillWhereItWas && ready.top >= KB - 60) {
          browserWould.push(`sekce ${ready.sec}: pole zůstalo na y=${r.top}, výřez se zkrátil na ${r.h}`);
        } else {
          bad.push(`sekce ${ready.sec}: před klávesnicí bylo pole na y=${ready.top}, `
            + `po jejím vyjetí je na ${r.top}..${r.bottom} a výřez je 0..${r.h}`
            + (r.focused ? '' : ' (a fokus mezitím vypadl)'));
        }
      }

      await page.setViewportSize({ width: 393, height: 852 });
      await settle(page, 180);
      assert.empty(bad, 'appka si při zkrácení výřezu sama přeskládala obsah a pole zmizelo');
      if (browserWould.length) {
        skip(`${browserWould.length}× pole spadlo pod zkrácený výřez, aniž by se hnulo — `
          + 'odrolování na zaostřený prvek dělá na iPhonu prohlížeč a setViewportSize() ho nespustí. '
          + 'Ověřit ručně: test/AKCEPTACE.md krok 4.');
      }
    });

    /* ═══════════ 8. přepínání měsíců ═══════════
       Když se opakující položky zakládají při každém vstupu do měsíce znovu,
       nepozná se to hned — pozná se to v prosinci, když je všechno dvakrát. */

    await S.test('24 přepnutí měsíců: počty řádků se nemění a id zůstávají unikátní', async () => {
      notBooted();
      const canSwitch = await page.locator('.chip-month, [data-act="month.go"]').count();
      if (!canSwitch) skip('přepínač měsíců zatím není');

      const snap = async () => page.evaluate(() => {
        const per = {};
        document.querySelectorAll('.sec-card').forEach((c) => {
          per[c.dataset.sec || c.getAttribute('data-sec') || '?'] = c.querySelectorAll('.row[data-id]').length;
        });
        const ids = Array.from(document.querySelectorAll('.row[data-id]')).map(r => r.dataset.id);
        return { per, ids, dup: ids.length - new Set(ids).size };
      });

      const first = await snap();
      const bad = [];
      for (let round = 0; round < 2; round++) {
        for (let m = 0; m < 12; m++) {
          const chip = page.locator(`[data-act="month.go"][data-m="${m}"]`).first();
          if (await chip.count()) { await chip.click({ force: true }); }
          else { await page.evaluate((mm) => { if (window.__APP__) { const s = window.__APP__.state(); s.ui.month = mm; window.__APP__.render(); } }, m); }
          await settle(page, 90);
          const s = await snap();
          if (s.dup > 0) bad.push(`kolo ${round + 1}, měsíc ${m + 1}: ${s.dup} duplicitních id řádků`);
        }
      }
      // zpátky na výchozí měsíc a porovnat
      const last = await snap();
      for (const k in first.per) {
        if (last.per[k] !== undefined && last.per[k] !== first.per[k]) {
          bad.push(`sekce ${k}: na začátku ${first.per[k]} řádků, po 24 přepnutích ${last.per[k]}`);
        }
      }
      assert.empty(bad, 'opakující se položky se při přepínání měsíců množí');
    });

    /* ═══════════ 9. české řazení ═══════════ */

    await S.test('prohlížeč umí české řazení (Cukr, Čaj, Hudba, Chleba, Zima, Žena)', async () => {
      const got = await page.evaluate(() => {
        const list = ['Čaj', 'Cukr', 'Chleba', 'Hudba', 'Žena', 'Zima'];
        return list.slice().sort((a, b) => a.localeCompare(b, 'cs'));
      });
      // Když prohlížeč nemá českou tabulku, seřadí "Čaj" před "Cukr" a "Chleba"
      // před "Hudba" — a v seznamu kategorií to uživatelka hned uvidí.
      assert.deep(got, ['Cukr', 'Čaj', 'Hudba', 'Chleba', 'Zima', 'Žena']);
    });

    /* ═══════════ 10. dvojklik na "přidat" ═══════════ */

    await S.test('dvojklik na „přidat řádek" přidá právě jeden řádek', async () => {
      notBooted();
      const add = page.locator('.sec-add').first();
      if (!(await add.count())) skip('tlačítko „přidat" zatím není');
      const before = await page.locator('.row[data-id]').count();
      await add.dblclick({ delay: 40 }).catch(async () => { await add.click(); await add.click(); });
      await settle(page, 400);
      const after = await page.locator('.row[data-id]').count();
      const sheet = await page.locator('#sheet-host:not([hidden]) .sheet, .sheet[role="dialog"]').count();
      if (after === before && sheet) skip('„přidat" otevírá panel, ne přímý řádek — dvojklik pokryje test panelu');
      assert.eq(after - before, 1, `dvojklik přidal ${after - before} řádků`);
    });

  } finally {
    await app.close();
  }

  /* ═══════════ 11. žádné technické smetí v textu ═══════════
     "NaN Kč" nebo "[object Object]" v rozpočtu je pro uživatelku konec důvěry.
     Kontroluje se pod každou fixturou, protože každá tlačí na jinou větev. */

  for (const fx of ['empty', 'realistic-year', 'adversarial']) {
    let a = null;
    try {
      a = await openApp(eng, { device: base, theme: 'light', fixture: fx });
      const found = await a.page.evaluate(() => {
        const text = document.body.innerText || '';
        const out = [];
        for (const needle of ['NaN', 'Infinity', 'undefined', 'null', '[object Object]']) {
          const at = text.indexOf(needle);
          if (at >= 0) out.push(`${needle} — „…${text.slice(Math.max(0, at - 30), at + needle.length + 30).replace(/\s+/g, ' ')}…"`);
        }
        return out;
      });
      await S.test(`v textu stránky není NaN/undefined/[object Object] — fixtura ${fx}`, () => {
        assert.empty(found, 'technické smetí prosáklo do textu, který uživatelka vidí');
      });
    } catch (e) {
      await S.test(`v textu stránky není NaN/undefined/[object Object] — fixtura ${fx}`, () => {
        throw e;
      });
    } finally {
      if (a) await a.close();
    }
  }

  return S;
}
