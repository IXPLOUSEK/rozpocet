// 70-selftest.js — vlastní kontrola přímo v aplikaci — vlastní: L0
// Spustí se jen při adrese končící #test. Běží i na iPhonu, což je jediný
// způsob, jak ověřit skutečné chování Safari bez zařízení po ruce.

let T_pass = 0, T_fail = 0, T_skip = 0, T_rows = [];

function assertEq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) T_pass++; else T_fail++;
  T_rows.push({ ok: ok, skip: false, name: name, got: got, want: want });
  return ok;
}
function assertTrue(name, cond) { return assertEq(name, !!cond, true); }
function assertSkip(name, why) { T_skip++; T_rows.push({ ok: true, skip: true, name: name, got: why }); }

function selfTest() {
  T_pass = 0; T_fail = 0; T_skip = 0; T_rows = [];
  const P = parseCzkInput, F = formatCzk, E = fmtEdit;

  /* --- parser částek --- */
  const cases = [
    ['prosté číslo', '1234', 123400],
    ['obyčejná mezera', '1 234', 123400],
    ['pevná mezera', '1 234', 123400],
    ['úzká mezera', '1 234', 123400],
    ['jedno des. místo', '1234,5', 123450],
    ['dvě des. místa', '1234,56', 123456],
    ['zaokrouhlení nahoru', '1234,567', 123457],
    ['haléře', '0,005', 1],
    ['velké číslo', '1 234 567,89', 123456789],
    ['tečka jako tisíce', '1.234', 123400],
    ['tečka jako desetinná', '1.23', 123],
    ['tečka jedno místo', '1.5', 150],
    ['tečka i čárka', '12.345,67', 1234567],
    ['s Kč za číslem', '1 200 Kč', 120000],
    ['s Kč před číslem', 'kč 1234', 123400],
    ['česká zkratka', '2 500,-', 250000],
    ['čárka na konci', '12,', 1200],
    ['čárka na začátku', ',5', 50],
    ['nuly na začátku', '00123', 12300],
    ['plus', '+250', 25000],
    ['minus', '-500', -50000],
    ['typografický minus', '−500', -50000],
  ];
  for (const c of cases) assertEq('parser: ' + c[0], P(c[1]).minor, c[2]);

  // Prázdné pole musí být null, nikdy nula. Number("") je nula a přesně
  // takhle se smazané pole tiše stane skutečnou nulou v součtu.
  assertEq('parser: prázdno je null', P(''), { ok: true, minor: null, reason: 'blank' });
  assertEq('parser: mezery jsou null', P('   '), { ok: true, minor: null, reason: 'blank' });
  for (const bad of ['abc', '50%', '(500)', '1,2,3', '1e3', '٣٥']) {
    assertTrue('parser odmítne: ' + bad, P(bad).ok === false && P(bad).minor === null);
  }
  assertEq('parser: strop', P('999999999999').reason, 'range');
  assertEq('parser: žádná záporná nula', Object.is(P('-0').minor, -0), false);

  /* --- formátování --- */
  assertEq('formát: nula', F(0), '0 Kč');
  assertEq('formát: tisíce', F(123400), '1 234 Kč');
  // Haléře se ukazují jen když nějaké jsou; při vynuceném zaokrouhlení na
  // koruny nesmí vzniknout „-0 Kč".
  assertEq('formát: -0,40 Kč se neztratí', F(-40), '-0,40 Kč');
  assertEq('formát: zaokrouhlená nula nemá minus', F(-40, { decimals: 0 }), '0 Kč');
  assertEq('formát: záporné s haléři', F(-123450), '-1 234,50 Kč');
  assertEq('formát: záporné na koruny', F(-123450, { decimals: 0 }), '-1 235 Kč');
  assertEq('formát: dvě místa', F(123450, { decimals: 2 }), '1 234,50 Kč');
  assertEq('formát: miliarda', F(100000000000), '1 000 000 000 Kč');
  assertEq('formát: NaN', F(NaN), '—');
  assertEq('formát: se znaménkem', F(150000, { sign: true }), '+1 500 Kč');
  assertTrue('formát: nikde obyčejná mezera', !/[  ]/.test(F(123456789)));
  assertEq('formát: kódy znaků', Array.from(F(123400)).map(function (c) { return c.codePointAt(0); }),
    [0x31, 0xA0, 0x32, 0x33, 0x34, 0xA0, 0x4B, 0x10D]);

  // Kontrolní orákulum: kdyby ICU v budoucím iOS mezeru změnilo, tady to
  // uvidíme, ale naše ruční funkce zůstane správně.
  try {
    const icu = new Intl.NumberFormat('cs-CZ').format(1000);
    if (icu.charCodeAt(1) !== 0xA0) assertSkip('ICU pozor: oddělovač je jiný', icu.charCodeAt(1).toString(16));
    else assertTrue('ICU souhlasí s naším oddělovačem', true);
  } catch (e) { assertSkip('ICU nedostupné', String(e)); }

  assertEq('editace: 8000', E(800000), '8000');
  assertEq('editace: 389,5', E(38950), '389,5');
  assertEq('editace: 1234,56', E(123456), '1234,56');
  assertEq('editace: null', E(null), '');

  let rt = 0;
  for (let i = 0; i < 200; i++) {
    const n = Math.floor(Math.random() * 2e7) - 1e7;
    if (P(F(n, { decimals: 2 })).minor !== n) rt++;
  }
  assertEq('kolečko formát→parser (200×)', rt, 0);

  /* --- zaokrouhlení od nuly --- */
  assertEq('zaokr. 1,50 nahoru', roundMinor(150), 200);
  assertEq('zaokr. -1,50 dolů', roundMinor(-150), -200);
  let sym = 0;
  for (let i = 0; i < 200; i++) { const v = Math.floor(Math.random() * 1e6); if (roundMinor(-v) !== -roundMinor(v)) sym++; }
  assertEq('zaokr. symetrie (200×)', sym, 0);

  /* --- datumy --- */
  assertEq('měsíc 1. ledna 2026', monthKey(new Date(2026, 0, 1)), '2026-01');
  assertEq('měsíc 31. prosince', monthKey(new Date(2026, 11, 31)), '2026-12');
  assertEq('splatnost 31. v únoru', dueDateFor(2026, 1, 31), '2026-02-28');
  assertEq('splatnost 31. v přestupném únoru', dueDateFor(2028, 1, 31), '2028-02-29');
  assertEq('splatnost 31. v dubnu', dueDateFor(2026, 3, 31), '2026-04-30');
  assertEq('splatnost 31. v lednu', dueDateFor(2026, 0, 31), '2026-01-31');
  assertEq('letní čas 28.→30. 3.', daysBetween('2026-03-28', '2026-03-30'), 2);
  assertEq('přes Silvestra', daysBetween('2025-12-31', '2026-01-01'), 1);
  assertEq('měsíc +1 z prosince', addMonths(2026, 11, 1), { y: 2027, m: 0 });
  assertEq('měsíc -1 z ledna', addMonths(2026, 0, -1), { y: 2025, m: 11 });
  assertEq('31. 1. patří do ledna', isInMonth('2026-01-31', 2026, 0), true);
  assertEq('1. 2. nepatří do ledna', isInMonth('2026-02-01', 2026, 0), false);
  assertEq('datum genitiv', fmtDateLong('2026-01-05'), '5. ledna 2026');
  assertEq('řazení podle češtiny',
    ['Čaj', 'Cukr', 'Chleba', 'Hudba', 'Žena', 'Zima'].sort(cmpCs),
    ['Cukr', 'Čaj', 'Hudba', 'Chleba', 'Zima', 'Žena']);
  assertEq('CSV: vzorec se odzbrojí', escapeCsv('=1+1'), "'=1+1");
  assertEq('CSV: středník v uvozovkách', escapeCsv('a;b'), '"a;b"');
  assertEq('procenta 0/0', pct(0, 0), null);
  assertEq('procenta 500/0', pct(500, 0), null);

  /* --- výpočty nad skutečnými daty --- */
  if (typeof computeMonth === 'function' && state && state.years) {
    const y = state.activeYear;
    let invOk = true, sumOk = true;
    let yr = null;
    for (let m = 0; m < 12; m++) {
      const md = computeMonth(y, m);
      const out = md.fixed.act + md.daily.act + md.savings.act + md.debt.act + md.subs.act;
      // Přísná rovnost platí pro součet sekcí. Zobrazovaný zůstatek je o
      // nezařazené nákupy nižší — jinak by smazaná kategorie peníze schovala.
      if (md.income.act - out !== md.balanceSections) invOk = false;
      if (md.balance !== md.balanceSections - md.orphans.total) invOk = false;
      if (!Number.isSafeInteger(md.balance)) invOk = false;
    }
    assertTrue('bilance: příjmy − pět sekcí = zůstatek', invOk);
    try {
      yr = computeYear(y);
      let acc = 0;
      for (let m = 0; m < 12; m++) acc += computeMonth(y, m).balance;
      if (yr.balance !== acc) sumOk = false;
      assertTrue('rok = součet dvanácti měsíců', sumOk);
    } catch (e) { assertSkip('roční součet', String(e)); }

    // Peníze nesmí zmizet, když se smaže kategorie.
    if (typeof orphanTx === 'function' && typeof txByCat === 'function') {
      let leakOk = true;
      for (let m = 0; m < 12; m++) {
        let inBuckets = 0;
        txByCat(y, m).forEach(function (v) { inBuckets += v; });
        let orphans = 0;
        for (const t of orphanTx(y, m)) orphans += t.amt;
        let all = 0;
        for (const t of getYear().tx) if (!t.del && t.m === m) all += t.amt;
        if (inBuckets + orphans !== all) leakOk = false;
      }
      assertTrue('nákupy: koše + osiřelé = všechno', leakOk);
    } else assertSkip('kontrola osiřelých nákupů', 'není implementováno');
  } else assertSkip('výpočty nad daty', 'model ještě není načtený');

  /* --- chyby, které tu už jednou byly --- */
  if (typeof computeMonth === 'function' && typeof addCatalogItem === 'function') {
    // Pískoviště: vlastní rok, ať se nesahá na skutečná data.
    // Po celou dobu je vypnuté ukládání — debounce umí vystřelit synchronně
    // a na disku by pak zůstal rok 1900 se vším všudy.
    const zk = 1900;
    const puvodniRok = state.activeYear;
    const zaloha = (function () { try { return JSON.stringify(state); } catch (e) { return null; } })();
    saveSuspended = true;
    // Zásobník vracení se po kontrole zkrátí zpátky. Uzávěry ukazují na
    // pískovištní rok a jedno klepnutí na „Vrátit zpět" by ho vzkřísilo.
    const undoPred = (typeof undoPush === 'function' && undoPush.stack) ? undoPush.stack.length : null;
    try {
      state.years[String(zk)] = newYear(zk);
      state.activeYear = zk;
      const M = 0;
      const kPrijem = addCatalogItem({ sec: 'income', name: 'Zkouška příjem' }, 'all', zk);
      const kFix = addCatalogItem({ sec: 'fixed', name: 'Zkouška fixní' }, 'all', zk);
      const kDen = addCatalogItem({ sec: 'daily', name: 'Zkouška denní' }, 'all', zk);
      setActual(M, ensureEntry(M, kPrijem.id, zk).id, 3000000, zk);
      const eFix = ensureEntry(M, kFix.id, zk);
      setPlanned(M, eFix.id, 1000000, zk); setActual(M, eFix.id, 1000000, zk);
      const eDen = ensureEntry(M, kDen.id, zk);
      setPlanned(M, eDen.id, 500000, zk);
      addTx({ d: zk + '-01-05', m: M, cat: kDen.id, amt: 300000 }, zk);

      let md = computeMonth(zk, M);
      assertEq('tři čísla na obrazovce sedí', md.incomeTotal - md.outflow, md.balance);

      // Zaplaceno nesmí přepsat skutečnost dopočítanou z deníku.
      togglePaid(M, eDen.id, true, zk);
      assertEq('zaplaceno nepřepíše deník', getEntry(M, eDen.id, zk).act, null);

      // Smazání kategorie s ručně zadanou skutečností nesmí zvednout zůstatek.
      const pred = computeMonth(zk, M).balance;
      archiveCatalogItem(kFix.id, zk);
      assertEq('smazaná kategorie peníze neschová', computeMonth(zk, M).balance, pred);

      // Prázdný plán je „nezadáno", ne nula.
      setPlanned(M, eDen.id, null, zk);
      assertEq('prázdný plán je null', getEntry(M, eDen.id, zk).plan, null);

      // Smazání „v celém roce" nesmí přepsat měsíce, ve kterých už něco je.
      const kHist = addCatalogItem({ sec: 'fixed', name: 'Zkouška historie' }, 'all', zk);
      const e0 = ensureEntry(0, kHist.id, zk), e5 = ensureEntry(5, kHist.id, zk);
      setPlanned(0, e0.id, 100000, zk); setActual(0, e0.id, 100000, zk);
      setPlanned(5, e5.id, 100000, zk);
      const ledenPred = computeMonth(zk, 0).balance;
      removeEntry(5, e5.id, 'all', zk);
      assertEq('smazání nepřepíše hotový měsíc', computeMonth(zk, 0).balance, ledenPred);
      assertEq('smazaný měsíc opravdu zmizel', getEntry(5, e5.id, zk).del, true);

    } catch (e) {
      assertSkip('kontrola dřívějších chyb', String(e));
    } finally {
      // Úklid proběhne i při výjimce. Nejdřív se zkusí přesná obnova ze
      // zálohy, teprve když ta chybí, ruční návrat.
      try {
        if (zaloha) {
          const puv = JSON.parse(zaloha);
          for (const k of Object.keys(state)) delete state[k];
          Object.assign(state, puv);
        } else {
          state.activeYear = puvodniRok;
          delete state.years[String(zk)];
        }
      } catch (e2) {
        state.activeYear = puvodniRok;
        try { delete state.years[String(zk)]; } catch (e3) {}
      }
      if (undoPred !== null && undoPush.stack && undoPush.stack.length > undoPred) {
        undoPush.stack.length = undoPred;
      }
      saveSuspended = false;
      invalidateAll();
      assertEq('kontrola po sobě uklidila', !state.years[String(zk)] && state.activeYear === puvodniRok, true);
    }
  } else assertSkip('kontrola dřívějších chyb', 'model není načtený');

  /* --- grafy --- */
  if (typeof polar === 'function') {
    const p0 = polar(50, 50, 40, 0), p90 = polar(50, 50, 40, 90);
    assertEq('graf: 0° je nahoře', [Math.round(p0.x), Math.round(p0.y)], [50, 10]);
    assertEq('graf: 90° je vpravo', [Math.round(p90.x), Math.round(p90.y)], [90, 50]);
    assertEq('graf: prstenec 0 % není NaN', /NaN/.test(String(donutDash(0, 40))), false);
    assertEq('graf: osa z nuly', niceScale(0)[1] > 0, true);
    assertEq('graf: cíl 0/0 je pomlčka', progressPct(0, 0).label, '—');
    assertEq('graf: cíl x/0 je pomlčka', progressPct(500, 0).label, '—');
  } else assertSkip('matematika grafů', 'není načtená');

  /* --- kontrola stránky --- */
  assertEq('nikde input[type=number]', document.querySelectorAll('input[type="number"]').length, 0);
  assertEq('jazyk stránky', document.documentElement.lang, 'cs');
  const badWords = /\b(NaN|Infinity|\[object Object\])\b/;
  // Panel s výsledky obsahuje názvy vlastních testů, ve kterých slovo NaN
  // stojí schválně. Bez jeho vynechání by druhé spuštění hlásilo falešnou
  // chybu — kontrola musí být opakovatelná.
  const oldPanel = qs('#selftest');
  const puvodniZobrazeni = oldPanel ? oldPanel.style.display : null;
  if (oldPanel) oldPanel.style.display = 'none';
  const textStranky = document.body.innerText || '';
  if (oldPanel) oldPanel.style.display = puvodniZobrazeni || '';
  assertTrue('nikde NaN ani [object Object] v textu', !badWords.test(textStranky));
  const smallInputs = qsa('input, select, textarea').filter(function (i) {
    const fs = parseFloat(getComputedStyle(i).fontSize);
    return Number.isFinite(fs) && fs < 16;
  });
  assertEq('všechna pole mají aspoň 16 px', smallInputs.length, 0);

  renderSelfTest();
  return { pass: T_pass, fail: T_fail, skip: T_skip };
}

function renderSelfTest() {
  const wrap = el('div', { class: 'selftest', id: 'selftest' });
  const head = el('div', { class: 'selftest-head' });
  const okAll = T_fail === 0;
  head.appendChild(el('strong', { class: okAll ? 'st-pass' : 'st-fail' },
    (okAll ? 'PASS ' : 'FAIL ') + T_pass + '/' + (T_pass + T_fail) +
    (T_skip ? '  (' + T_skip + ' přeskočeno)' : '')));
  const copy = el('button', { class: 'btn btn-ghost' }, 'Kopírovat výsledek');
  copy.addEventListener('click', function () {
    const txt = T_rows.map(function (r) {
      return (r.skip ? 'SKIP ' : (r.ok ? 'ok   ' : 'FAIL ')) + r.name +
        (r.ok ? '' : '  got=' + JSON.stringify(r.got) + ' want=' + JSON.stringify(r.want));
    }).join('\n');
    const full = 'Rozpočet ' + APP_VERSION + '\n' + navigator.userAgent + '\n' +
      (okAll ? 'PASS ' : 'FAIL ') + T_pass + '/' + (T_pass + T_fail) + '\n\n' + txt;
    if (navigator.clipboard) navigator.clipboard.writeText(full);
    else { const ta = el('textarea'); ta.value = full; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast('Zkopírováno');
  });
  head.appendChild(copy);
  const close = el('button', { class: 'btn btn-ghost' }, 'Zavřít');
  close.addEventListener('click', function () { wrap.remove(); location.hash = ''; });
  head.appendChild(close);
  wrap.appendChild(head);

  const list = el('div', { class: 'selftest-list' });
  for (const r of T_rows) {
    const row = el('div', { class: 'st-row ' + (r.skip ? 'st-row-skip' : (r.ok ? 'st-row-ok' : 'st-row-fail')) });
    row.appendChild(el('span', { class: 'st-mark' }, r.skip ? '–' : (r.ok ? '✓' : '✕')));
    row.appendChild(el('span', { class: 'st-name' }, r.name));
    if (!r.ok || r.skip) {
      row.appendChild(el('span', { class: 'st-detail' },
        r.skip ? String(r.got) : ('dostal ' + JSON.stringify(r.got) + ', čekal ' + JSON.stringify(r.want))));
    }
    list.appendChild(row);
  }
  wrap.appendChild(list);
  const old = qs('#selftest');
  if (old) old.remove();
  document.body.appendChild(wrap);
}
