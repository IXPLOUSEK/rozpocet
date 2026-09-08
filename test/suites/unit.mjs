// test/suites/unit.mjs — čisté funkce a statická kontrola kontraktu.
// Běží BEZ prohlížeče: fragmenty se načtou do vm sandboxu s minimálním
// DOM náhradníkem. Díky tomu tahle suita funguje i ve chvíli, kdy je
// polovina appky teprve rozepsaná.

import vm from 'node:vm';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Suite, assert, skip, header, sub } from '../lib/harness.mjs';
import { ROOT, FIXTURES } from '../lib/page.mjs';

const SRC = join(ROOT, 'src');
const read = (n) => readFileSync(join(SRC, n), 'utf8');
const has = (n) => existsSync(join(SRC, n));

/* ── sandbox ────────────────────────────────────────────────────────────── */

function makeSandbox() {
  const store = new Map();
  const fakeNode = () => ({
    style: {}, dataset: {}, classList: { add() { }, remove() { }, contains: () => false },
    setAttribute() { }, removeAttribute() { }, getAttribute: () => null,
    appendChild(x) { return x; }, cloneNode() { return fakeNode(); },
    addEventListener() { }, textContent: '', children: [], content: null,
    querySelector: () => null, querySelectorAll: () => [],
  });
  const doc = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: fakeNode,
    createElementNS: fakeNode,
    createDocumentFragment: fakeNode,
    addEventListener() { },
    documentElement: fakeNode(),
    body: fakeNode(),
    head: fakeNode(),
    readyState: 'complete',
  };
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  const win = {
    localStorage: ls, sessionStorage: ls,
    addEventListener() { }, removeEventListener() { },
    matchMedia: () => ({ matches: false, addEventListener() { }, addListener() { } }),
    requestAnimationFrame: (f) => setTimeout(f, 0),
    cancelAnimationFrame: () => { },
    location: { href: 'http://127.0.0.1:8173/rozpocet.html', hash: '', protocol: 'http:' },
    navigator: { userAgent: 'node', language: 'cs-CZ', standalone: false },
    devicePixelRatio: 2,
    innerWidth: 393, innerHeight: 852,
  };
  const ctx = {
    console: { log() { }, warn() { }, error() { }, info() { } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    document: doc, window: win, localStorage: ls, sessionStorage: ls,
    navigator: win.navigator, location: win.location, matchMedia: win.matchMedia,
    fetch: () => Promise.reject(new Error('žádná síť v testu')),
    __store: store,
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  return vm.createContext(ctx);
}

const WANTED = [
  // 31-util.js
  'uid', 'num', 'clamp', 'parseCzkInput', 'formatCzk', 'formatSigned', 'fmtEdit', 'pct',
  'monthKey', 'ymd', 'todayISO', 'parseYmd', 'daysInMonth', 'dueDateFor', 'isInMonth',
  'addMonths', 'monthLabelCs', 'monthShortCs', 'fmtDateShort', 'fmtDateLong', 'daysBetween',
  'daysUntil', 'relDaysCs', 'cmpCs', 'escapeCsv', 'deepEqual', 'roundMinor', 'sumMinor',
  // 30-config.js
  'SECTIONS', 'SECTION_BY_KEY', 'MONTHS_NOM', 'MONTHS_GEN', 'MONTHS_SHORT', 'DAYS_SHORT',
  'TXT', 'SCHEMA', 'STORE_KEY', 'BACKUP_KEY', 'SNAP_PREFIX', 'QUAR_PREFIX',
  'DEFAULT_CATALOG', 'NBSP', 'APP_VERSION',
  // 32-storage.js / 33 / 34 — když existují
  'emptyDoc', 'newYear', 'migrate', 'MIGRATIONS', 'validateDoc',
  'loadState', 'saveState', 'storageStatus', 'snapshotList', 'quarantineList',
  'state', 'getYear', 'getMonthObj', 'getCat', 'addTx', 'setPlanned', 'setActual',
  'txByCat', 'effActual', 'computeMonth', 'computeYear', 'computeGoals', 'orphanTx',
];

/** Načte fragmenty do sandboxu a vytáhne z nich jména. */
function loadFragments(names) {
  const parts = [];
  for (const n of names) {
    if (!has(n)) return { ok: false, missing: n, api: {}, loaded: [] };
    parts.push(`/* === ${n} === */\n` + read(n));
  }
  const probe = '\n;({' + WANTED.map(k => `${JSON.stringify(k)}: (typeof ${k} !== "undefined" ? ${k} : undefined)`).join(',') + '})';
  const code = '"use strict";\n' + parts.join('\n') + probe;
  const sandbox = makeSandbox();
  const api = vm.runInContext(code, sandbox, { filename: 'fragments.js', timeout: 15000 });
  return { ok: true, api, loaded: names, sandbox };
}

/* ── suita ──────────────────────────────────────────────────────────────── */

export async function run() {
  const S = new Suite('unit');
  header('unit — čisté funkce a kontrakt (bez prohlížeče)');

  // Načítáme postupně. Když další fragment spadne, předchozí zůstanou v platnosti.
  const LADDER = [
    ['30-config.js', '31-util.js'],
    ['30-config.js', '31-util.js', '32-storage.js'],
    ['30-config.js', '31-util.js', '32-storage.js', '33-model.js'],
    ['30-config.js', '31-util.js', '32-storage.js', '33-model.js', '34-derived.js'],
  ];
  let U = null, loadedNames = [], loadErr = null;
  for (const step of LADDER) {
    try {
      const r = loadFragments(step);
      if (!r.ok) { loadErr = loadErr || `${r.missing} ještě neexistuje`; break; }
      U = r.api; loadedNames = r.loaded;
    } catch (e) {
      loadErr = `${step[step.length - 1]}: ${String(e && e.message || e).split('\n')[0]}`;
      break;
    }
  }
  sub('načteno: ' + (loadedNames.join(', ') || 'nic') + (loadErr ? `  (dál ne: ${loadErr})` : ''));
  if (loadedNames.length) S.note(`fragmenty v sandboxu: ${loadedNames.length}` + (loadErr ? ` · stop na: ${loadErr}` : ''));

  const need = (name) => {
    if (!U || typeof U[name] === 'undefined') skip(`${name} ještě není napsaná`);
    return U[name];
  };

  /* ─── částky ─── */

  await S.test('parseCzkInput: prázdné pole je null, ne nula', () => {
    const p = need('parseCzkInput');
    for (const v of ['', '   ', null, undefined, ' ']) {
      const r = p(v);
      assert.eq(r.minor, null, `parseCzkInput(${JSON.stringify(v)}).minor`);
      assert.ok(r.ok, 'prázdné pole není chyba');
    }
    // tohle je ta chyba, kvůli které test existuje
    assert.ne(p('').minor, 0, 'smazané pole se nesmí stát nulou');
  });

  await S.test('parseCzkInput: české tvary částek', () => {
    const p = need('parseCzkInput');
    const cases = [
      ['1234', 123400], ['1 234', 123400], ['1 234,50', 123450],
      ['1 234,50', 123450], ['1.234', 123400], ['1.234.567', 123456700],
      ['12,', 1200], ['2500,-', 250000], ['1000 Kč', 100000], ['1000 kc', 100000],
      ['1000czk', 100000], ['-1 000', -100000], ['−1000', -100000],
      ['+50', 5000], ['0', 0], ['-0', 0], ['0,01', 1], ['1,999', 200],
      ['1.23', 123], ['1.2', 120], ['.5', 50],
    ];
    const bad = [];
    for (const [raw, want] of cases) {
      const r = p(raw);
      if (!r.ok || r.minor !== want) bad.push(`${JSON.stringify(raw)} → ${r.ok ? r.minor : r.reason}, čekal ${want}`);
    }
    assert.empty(bad, 'špatně rozparsované částky');
  });

  await S.test('parseCzkInput: nesmysly se odmítnou, nikdy nevrátí NaN', () => {
    const p = need('parseCzkInput');
    const bad = [];
    for (const raw of ['abc', '1e5', '1,2,3', '--5', '1..2', '1,2.3', '$5', '∞', 'NaN', '5%']) {
      const r = p(raw);
      if (r.ok) bad.push(`${JSON.stringify(raw)} prošlo jako ${r.minor}`);
      if (Number.isNaN(r.minor)) bad.push(`${JSON.stringify(raw)} vrátilo NaN`);
    }
    assert.empty(bad, 'nesmysly, které prošly');
  });

  await S.test('parseCzkInput: strop je miliarda Kč, výš už jen chyba', () => {
    const p = need('parseCzkInput');
    assert.eq(p('1000000000').minor, 100000000000, 'přesně miliarda Kč projde');
    assert.eq(p('1000000001').reason, 'range', 'miliarda a jedna už ne');
    assert.eq(p('9999999999999').reason, 'range', '13 číslic');
  });

  await S.test('parseCzkInput: výsledek je vždy bezpečné celé číslo', () => {
    const p = need('parseCzkInput');
    const bad = [];
    for (const raw of ['1', '0,05', '999999,99', '1 000 000', '123,45', '-77,7']) {
      const r = p(raw);
      if (r.minor !== null && !Number.isSafeInteger(r.minor)) bad.push(raw + ' → ' + r.minor);
    }
    assert.empty(bad, 'částky, které nejsou celé haléře');
  });

  await S.test('formatCzk: pevná mezera, žádné "-0 Kč"', () => {
    const f = need('formatCzk');
    assert.eq(f(1450000), '14 500 Kč');
    // Haléře se ukazují jen když nějaké jsou — díky tomu dávají řádky
    // dohromady přesně ten součet, který je pod nimi napsaný.
    assert.eq(f(123450), '1 234,50 Kč', 'haléře se neschovávají');
    assert.eq(f(123450, { decimals: 0 }), '1 235 Kč', 'vynucené koruny zaokrouhlí nahoru');
    assert.eq(f(-40), '-0,40 Kč', 'čtyřicet haléřů není nula');
    assert.eq(f(-40, { decimals: 0 }), '0 Kč', 'zaokrouhlená nula nesmí mít mínus');
    assert.eq(f(0), '0 Kč');
    assert.eq(f(null), '—');
    assert.eq(f(undefined), '—');
    assert.eq(f(NaN), '—', 'NaN se nikdy nesmí vypsat');
    assert.eq(f(Infinity), '—');
    assert.eq(f(123450, { decimals: 2 }), '1 234,50 Kč');
    assert.eq(f(-1450000), '-14 500 Kč');
  });

  // formatCzk ukazuje haléře jen když nějaké jsou. Orákulum běží na
  // vynucených celých korunách, aby se porovnával stejný režim.
  await S.test('formatCzk: shoda s Intl na náhodných částkách', () => {
    const f = need('formatCzk');
    const nf = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });
    const bad = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 300; i++) {
      const minor = Math.floor(rnd() * 5e8) * (rnd() < 0.2 ? -1 : 1);
      const mine = f(minor, { decimals: 0 }).replace(/ /g, ' ');
      const theirs = nf.format(minor / 100).replace(/[  ]/g, ' ');
      // Intl si občas přehodí mezeru; porovnáváme jen číslice a znaménko.
      const norm = (s) => s.replace(/[^0-9-]/g, '');
      if (norm(mine) !== norm(theirs)) bad.push(`${minor}: moje ${mine} / Intl ${theirs}`);
    }
    assert.empty(bad, 'formatCzk se rozchází s Intl');
  });

  await S.test('formatSigned: plus jen u nenulových', () => {
    const f = need('formatSigned');
    assert.eq(f(50000), '+500 Kč');
    assert.eq(f(-50000), '-500 Kč');
    assert.eq(f(0), '0 Kč', 'nula bez znaménka');
  });

  await S.test('fmtEdit: do políčka se vrací holé číslo s čárkou', () => {
    const f = need('fmtEdit');
    assert.eq(f(123400), '1234');
    assert.eq(f(123450), '1234,5');
    assert.eq(f(1), '0,01');
    assert.eq(f(-50), '-0,5');
    assert.eq(f(null), '');
    assert.eq(f(NaN), '');
  });

  await S.test('fmtEdit → parseCzkInput je kruh (nic se cestou neztratí)', () => {
    const f = need('fmtEdit'), p = need('parseCzkInput');
    const bad = [];
    for (const v of [0, 1, 50, 99, 100, 12345, 123450, 1450000, -450000, -1, 100000000000]) {
      const back = p(f(v));
      if (back.minor !== (v === 0 ? 0 : v)) bad.push(`${v} → "${f(v)}" → ${back.minor}`);
    }
    assert.empty(bad, 'kolečko fmtEdit/parse neuzavřelo');
  });

  await S.test('roundMinor: od nuly i u záporných', () => {
    const r = need('roundMinor');
    assert.eq(r(150), 200, '1,50 → 2');
    assert.eq(r(-150), -200, '-1,50 → -2, ne -1');
    assert.eq(r(149), 100);
    assert.eq(r(-149), -100);
    assert.eq(r(0), 0);
  });

  await S.test('sumMinor: NaN a nesmysly v seznamu součet nerozbijí', () => {
    const s = need('sumMinor');
    assert.eq(s([100, 200, 300]), 600);
    assert.eq(s([100, NaN, 200]), 300, 'NaN se přeskočí');
    assert.eq(s([100, null, undefined, '5', 1.5, Infinity, 200]), 300);
    assert.eq(s([]), 0);
  });

  await S.test('pct: dělení nulou vrací null, ne NaN', () => {
    const p = need('pct');
    assert.eq(p(0, 0), null);
    assert.eq(p(5, 0), null);
    assert.eq(p(NaN, 10), null);
    assert.eq(p(50, 200), 0.25);
  });

  /* ─── datumy ─── */

  await S.test('monthKey/ymd nesahají na toISOString (past s prosincem)', () => {
    const mk = need('monthKey'), y = need('ymd');
    assert.eq(mk(new Date(2026, 0, 1)), '2026-01', '1. leden musí být leden');
    assert.eq(y(new Date(2026, 0, 1)), '2026-01-01');
    assert.eq(y(new Date(2026, 11, 31)), '2026-12-31');
    assert.eq(mk(new Date(2026, 6, 1)), '2026-07', 'letní čas');
  });

  await S.test('dueDateFor: 31. v únoru je 28., ne 3. března', () => {
    const d = need('dueDateFor');
    assert.eq(d(2026, 1, 31), '2026-02-28');
    assert.eq(d(2028, 1, 31), '2028-02-29', 'přestupný rok');
    assert.eq(d(2026, 1, 29), '2026-02-28');
    assert.eq(d(2026, 3, 31), '2026-04-30', 'duben má 30');
    assert.eq(d(2026, 0, 31), '2026-01-31');
    assert.eq(d(2026, 1, NaN), null);
    assert.eq(d(2026, 1, 0), null);
  });

  await S.test('parseYmd: nesmyslné datum vrátí null', () => {
    const p = need('parseYmd');
    assert.deep(p('2026-09-08'), { y: 2026, m: 8, day: 8 });
    for (const bad of ['2026-13-01', '2026-00-10', '2026-09-32', '2026-9-8', '', 'dnes', null, 20260908]) {
      assert.eq(p(bad), null, `parseYmd(${JSON.stringify(bad)})`);
    }
  });

  await S.test('daysBetween: přechod na letní čas nesežere den', () => {
    const d = need('daysBetween');
    assert.eq(d('2026-03-28', '2026-03-30'), 2, 'přes 29. 3. (letní čas)');
    assert.eq(d('2026-10-24', '2026-10-26'), 2, 'přes 25. 10. (zimní čas)');
    assert.eq(d('2026-01-01', '2026-12-31'), 364);
    assert.eq(d('2026-02-28', '2026-03-01'), 1, '2026 není přestupný');
    assert.eq(d('2026-05-05', '2026-05-05'), 0);
    assert.eq(d('nesmysl', '2026-01-01'), null);
  });

  await S.test('addMonths: přes hranici roku dozadu i dopředu', () => {
    const a = need('addMonths');
    assert.deep(a(2026, 0, -1), { y: 2025, m: 11 });
    assert.deep(a(2026, 11, 1), { y: 2027, m: 0 });
    assert.deep(a(2026, 5, 0), { y: 2026, m: 5 });
    assert.deep(a(2026, 0, -13), { y: 2024, m: 11 });
  });

  await S.test('daysInMonth: únor 2026 má 28, 2028 má 29', () => {
    const d = need('daysInMonth');
    assert.eq(d(2026, 1), 28);
    assert.eq(d(2028, 1), 29);
    assert.eq(d(2026, 0), 31);
    assert.eq(d(2026, 3), 30);
  });

  await S.test('relDaysCs: české skloňování dní', () => {
    const r = need('relDaysCs');
    assert.eq(r(0), 'dnes');
    assert.eq(r(1), 'zítra');
    assert.eq(r(-1), 'včera');
    assert.eq(r(2), 'za 2 dny');
    assert.eq(r(4), 'za 4 dny');
    assert.eq(r(5), 'za 5 dní');
    assert.eq(r(-3), 'po splatnosti');
    assert.eq(r(null), '');
  });

  await S.test('fmtDateLong používá genitiv ("8. září")', () => {
    const f = need('fmtDateLong');
    assert.eq(f('2026-09-08'), '8. září 2026');
    assert.eq(f('2026-01-15'), '15. ledna 2026');
    assert.eq(f('2026-02-01'), '1. února 2026');
    assert.eq(f('nesmysl'), '');
  });

  /* ─── řazení, CSV, ostatní ─── */

  await S.test('cmpCs: české řazení (Cukr, Čaj, Hudba, Chleba, Zima, Žena)', () => {
    const c = need('cmpCs');
    const got = ['Čaj', 'Cukr', 'Chleba', 'Hudba', 'Žena', 'Zima'].slice().sort(c);
    assert.deep(got, ['Cukr', 'Čaj', 'Hudba', 'Chleba', 'Zima', 'Žena']);
  });

  await S.test('escapeCsv: Excel z toho neudělá vzorec', () => {
    const e = need('escapeCsv');
    assert.eq(e('=SUMA(A1)'), "'=SUMA(A1)");
    assert.eq(e('+420'), "'+420");
    assert.eq(e('-5'), "'-5");
    assert.eq(e('@ahoj'), "'@ahoj");
    assert.eq(e('a;b'), '"a;b"');
    assert.eq(e('a"b'), '"a""b"');
    assert.eq(e('a\r\nb'), '"a\r\nb"');
    assert.eq(e('Žluťoučký'), 'Žluťoučký', 'diakritika se nekomolí');
    assert.eq(e(null), '');
  });

  await S.test('deepEqual', () => {
    const d = need('deepEqual');
    assert.ok(d({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
    assert.not(d({ a: 1 }, { a: 1, b: undefined }));
    assert.not(d([1, 2], [2, 1]));
    assert.ok(d(NaN, NaN), 'NaN === NaN pro účely porovnání');
  });

  await S.test('uid: dva klíče za sebou nejsou stejné', () => {
    const u = need('uid');
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(u('e_'));
    assert.eq(seen.size, 500, 'kolize id');
    assert.match(u('t_'), /^t_/);
  });

  await S.test('SECTIONS: šest sekcí, směry sedí, klíče jsou unikátní', () => {
    const S6 = need('SECTIONS');
    assert.eq(S6.length, 6);
    const keys = S6.map(s => s.key);
    assert.deep(keys, ['income', 'fixed', 'daily', 'savings', 'debt', 'subs']);
    assert.eq(S6[0].dir, 1, 'příjmy jdou nahoru');
    assert.ok(S6.slice(1).every(s => s.dir === -1), 'všechno ostatní dolů');
    assert.eq(new Set(keys).size, 6);
  });

  await S.test('TXT: žádný text není prázdný a všechno je česky', () => {
    const T = need('TXT');
    const bad = [];
    for (const k in T) {
      const v = T[k];
      if (typeof v !== 'string' || v.trim() === '') bad.push(k + ' je prázdné');
      if (/[a-z]/.test(String(v)) && /\b(the|and|your|please|error|save|cancel)\b/i.test(String(v))) bad.push(k + ' vypadá anglicky: ' + v);
    }
    assert.empty(bad, 'vadné texty');
  });

  /* ─── model a odvozená čísla, když už existují ─── */

  await S.test('emptyDoc: nová appka je opravdu prázdná (žádná demo data)', () => {
    const e = need('emptyDoc');
    const d = e();
    assert.eq(d.isDemo, false, 'nová appka se nesmí tvářit jako demo');
    const years = Object.values(d.years || {});
    const cats = years.reduce((a, y) => a + (y.catalog ? y.catalog.length : 0), 0);
    assert.eq(cats, 0, 'nová appka nesmí sama od sebe založit kategorie');
    const tx = years.reduce((a, y) => a + (y.tx ? y.tx.length : 0), 0);
    assert.eq(tx, 0, 'ani zápisy v deníku');
  });

  // migrate() smí vracet buď hotový dokument, nebo obálku {ok, doc, reason}.
  const migResult = (out) => {
    if (!out || typeof out !== 'object') return { doc: null, reason: 'nic nevrátilo' };
    if ('doc' in out || 'ok' in out) return { doc: out.ok === false ? null : out.doc, reason: out.reason || '' };
    return { doc: out, reason: '' };
  };

  await S.test('migrate: dokument BEZ klíče schema se bere jako v1', () => {
    const mig = need('migrate');
    const legacy = JSON.parse(readFileSync(join(FIXTURES, 'legacy-v1.json'), 'utf8'));
    assert.eq(legacy.schema, undefined, 'fixtura musí být bez schema');
    const r = migResult(mig(legacy));
    assert.ok(r.doc, 'chybějící `schema` je první verze, ne poškozený soubor '
      + `(migrate vrátil reason=${JSON.stringify(r.reason)})`);
    assert.gte(r.doc.schema, 1, 'po migraci musí být schema doplněné');
  });

  // ROZHODNUTÍ: floaty se SCHVÁLNĚ nepřevádějí.
  // Schéma 1 je první vydaná verze, takže dokument s desetinnými částkami
  // ve skutečnosti nikdy nevznikl — legacy-v1.json je vymyšlený formát.
  // Slepý převod je nebezpečný na obě strany: kdyby skutečný v1 dokument
  // už držel celé haléře (1450000), vynásobením stem se ze 14 500 Kč stane
  // 1 450 000 Kč. A pravidlo "převádět jen neceločíselné" by z 14500,5 udělalo
  // koruny a ze sousedního 14500 haléře, což je ještě horší. Špatný odhad tady
  // potichu přečte cizí peníze stokrát jinak.
  // Poctivé chování: dokument PŘIJMOUT, a pak ho nechat hlasitě spadnout
  // na validaci s českou hláškou, která pojmenuje konkrétní cestu.
  await S.test('migrate: floaty v korunách projdou migrací, ale NEPROJDOU validací', () => {
    const mig = need('migrate');
    const val = need('validateDoc');
    const legacy = JSON.parse(readFileSync(join(FIXTURES, 'legacy-v1.json'), 'utf8'));
    const r = migResult(mig(legacy));
    assert.ok(r.doc, `migrace měla dokument přijmout (reason=${JSON.stringify(r.reason)})`);

    const problems = val(r.doc);
    assert.ok(Array.isArray(problems), 'validateDoc má vrátit pole problémů');
    assert.gte(problems.length, 1, 'desetinné částky musí validace odmítnout, ne je potichu spolknout');

    // Hláška musí ukázat prstem, ne jen říct "je to rozbité".
    const naming = problems.filter(p => /\.(plan|act|amt)\b/.test(String(p)));
    assert.gte(naming.length, 1,
      'žádná hláška nepojmenovala konkrétní částku; dostal jsem:\n        ' + problems.slice(0, 5).join('\n        '));
    assert.ok(problems.some(p => /halé|celé čísl|celá čísl/i.test(String(p))),
      'hláška má česky říct, že to nejsou celé haléře; dostal jsem:\n        ' + problems.slice(0, 5).join('\n        '));
  });

  await S.test('validateDoc: čistá fixtura projde bez jediné výhrady', () => {
    const val = need('validateDoc');
    const bad = [];
    for (const f of ['empty.json', 'realistic-year.json', 'adversarial.json']) {
      const doc = JSON.parse(readFileSync(join(FIXTURES, f), 'utf8'));
      const problems = val(doc) || [];
      for (const p of problems) bad.push(`${f}: ${p}`);
    }
    assert.empty(bad, 'validace si stěžuje na data, která jsou podle _MODEL.md v pořádku');
  });

  await S.test('migrate: originál se cestou nezmění a je idempotentní', () => {
    const mig = need('migrate');
    const raw = readFileSync(join(FIXTURES, 'legacy-v1.json'), 'utf8');
    const legacy = JSON.parse(raw);
    const r1 = migResult(mig(legacy));
    assert.eq(JSON.stringify(legacy), JSON.stringify(JSON.parse(raw)), 'migrate zmutoval vstupní dokument');
    if (!r1.doc) skip('migrate legacy dokument odmítl — viz test výše');
    const r2 = migResult(mig(JSON.parse(JSON.stringify(r1.doc))));
    assert.ok(r2.doc, 'druhý průchod migrací selhal');
    assert.eq(JSON.stringify(r2.doc), JSON.stringify(r1.doc), 'migrate není idempotentní');
  });

  await S.test('migrate: dokument z BUDOUCÍHO schématu se odmítne (data se nesmí poškodit)', () => {
    const mig = need('migrate');
    const SCH = need('SCHEMA');
    const future = JSON.parse(readFileSync(join(FIXTURES, 'empty.json'), 'utf8'));
    future.schema = SCH + 5;
    const r = migResult(mig(future));
    assert.eq(r.doc, null, 'novější dokument se musí odmítnout, ne zplošťovat');
  });

  await S.test('computeMonth: součty z fixtury sedí a nikde není NaN', () => {
    const cm = need('computeMonth');
    skip('computeMonth existuje, ale bez zavedeného `state` ho z sandboxu nezavolám bezpečně — pokryto v dom/storage suitě');
    void cm;
  });

  /* ─── statická kontrola železných pravidel z _CONTRACT.md ─── */

  const jsFiles = () => (existsSync(SRC) ? readdirSync(SRC).filter(f => f.endsWith('.js')) : []);
  const htmlFiles = () => (existsSync(SRC) ? readdirSync(SRC).filter(f => f.endsWith('.html')) : []);
  const cssFiles = () => (existsSync(SRC) ? readdirSync(SRC).filter(f => f.endsWith('.css')) : []);

  const scan = (files, re) => {
    const hits = [];
    for (const f of files) {
      const lines = read(f).split('\n');
      lines.forEach((l, i) => {
        if (l.trim().startsWith('//') || l.trim().startsWith('*')) return;
        if (re.test(l)) hits.push(`${f}:${i + 1}  ${l.trim().slice(0, 90)}`);
      });
    }
    return hits;
  };

  await S.test('kontrakt: nikde innerHTML', () => {
    assert.empty(scan([...jsFiles(), ...htmlFiles()], /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML/), 'innerHTML v kódu');
  });

  await S.test('kontrakt: nikde input[type=number]', () => {
    // V HTML hledáme atribut, v JS jen skutečné nastavení typu.
    // Řádky se selektorem (`querySelectorAll('input[type=number]')`) jsou v pořádku —
    // přesně tak si to hlídá i vlastní selftest appky.
    const hits = [
      ...scan(htmlFiles(), /<input[^>]*type\s*=\s*["']number["']/i),
      ...scan(jsFiles(), /\.type\s*=\s*["']number["']|type\s*:\s*["']number["']|setAttribute\(\s*["']type["']\s*,\s*["']number["']/),
    ];
    assert.empty(hits, 'input type=number (iOS ho zobrazí bez čárky a rozbije caret)');
  });

  await S.test('kontrakt: měsíc ani den se neodvozuje z toISOString()', () => {
    const hits = scan(jsFiles(), /toISOString\(\)\s*\.(slice|substr|substring|split)/);
    assert.empty(hits, 'toISOString použité k odvození data — v Praze to posune leden do prosince');
  });

  await S.test('kontrakt: uživatelský vstup nejde přes parseFloat/Number()', () => {
    // parseFloat na getComputedStyle / rozměry je v pořádku — jinak se px přečíst nedá.
    // Zakázané je jen sáhnout takhle na to, co uživatelka napsala.
    const styleish = /getComputedStyle|\.style\b|BoundingClientRect|offset(Width|Height|Top|Left)|client(Width|Height)|scroll(Width|Height|Top)|fontSize|['"]\d+px|matchMedia/;
    const hits = [
      ...scan(jsFiles(), /parseFloat\s*\(/).filter(l => !styleish.test(l)),
      ...scan(jsFiles(), /Number\s*\([^)]*\.value/),
      ...scan(jsFiles(), /parseInt\s*\([^)]*\.value/),
      ...scan(jsFiles(), /\+\s*[a-zA-Z_$][\w$]*\.value\b/),
    ];
    assert.empty(hits, 'částka z inputu se musí parsovat jen přes parseCzkInput()');
  });

  await S.test('kontrakt: každý fragment má hlavičkový komentář', () => {
    const bad = [];
    for (const f of jsFiles()) {
      const first = read(f).split('\n')[0] || '';
      if (!first.startsWith('// ' + f)) bad.push(`${f}: "${first.slice(0, 60)}"`);
    }
    assert.empty(bad, 'fragmenty bez hlavičky "// <soubor> — <co dělá>"');
  });

  await S.test('kontrakt: žádné síťové volání mimo 55-sync.js', () => {
    const files = jsFiles().filter(f => f !== '55-sync.js');
    const hits = scan(files, /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket|new\s+EventSource/);
    assert.empty(hits, 'appka nesmí nikam volat');
  });

  await S.test('kontrakt: input/select/textarea má v CSS 16px (jinak iOS zoomne)', () => {
    if (!has('11-base.css')) skip('11-base.css ještě neexistuje');
    const css = read('11-base.css').replace(/\s+/g, ' ');
    assert.match(css, /input[^{]*textarea[^{]*\{[^}]*font-size:\s*16px/, 'chybí nedotknutelné pravidlo font-size: 16px');
  });

  await S.test('kontrakt: barvy jen z tokenů, žádný hex mimo 10-tokens.css', () => {
    const others = cssFiles().filter(f => f !== '10-tokens.css');
    if (!others.length) skip('CSS fragmenty ještě neexistují');
    const hits = scan(others, /#[0-9a-fA-F]{3,8}\b/);
    assert.empty(hits, 'natvrdo zapsané barvy mimo tokeny');
  });

  await S.test('kontrakt: rezervovaná jména se mezi fragmenty nekříží', () => {
    const owners = parseContractTable();
    if (!owners) skip('_CONTRACT.md se nepodařilo přečíst');
    const declaredIn = new Map();   // jméno -> "soubor:řádek"
    const bad = [];
    for (const f of jsFiles()) {
      const lines = read(f).split('\n');
      lines.forEach((line, i) => {
        const m = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
        if (!m) return;
        const name = m[1];
        if (name.startsWith('_')) return;
        const where = `${f}:${i + 1}`;
        const prev = declaredIn.get(name);
        if (prev && prev.split(':')[0] !== f) bad.push(`${name}  ${prev}  i  ${where}`);
        else if (!prev) declaredIn.set(name, where);
      });
    }
    assert.empty(bad, 'kolize jmen ve sdílené IIFE — appka by se ani nespustila');
  });

  /* ─── fixtury ─── */

  await S.test('fixtury: všechny částky jsou celé haléře', () => {
    const bad = [];
    for (const f of ['empty.json', 'realistic-year.json', 'adversarial.json']) {
      const p = join(FIXTURES, f);
      if (!existsSync(p)) { bad.push(f + ' chybí — spusť node test/fixtures/gen.mjs'); continue; }
      walkAmounts(JSON.parse(readFileSync(p, 'utf8')), (path, v) => {
        if (!Number.isSafeInteger(v)) bad.push(`${f} ${path} = ${v}`);
      });
    }
    assert.empty(bad, 'necelé částky ve fixturách');
  });

  await S.test('fixtury: legacy-v1 SKUTEČNĚ obsahuje floaty (jinak nic netestuje)', () => {
    const legacy = JSON.parse(readFileSync(join(FIXTURES, 'legacy-v1.json'), 'utf8'));
    assert.eq(legacy.schema, undefined, 'legacy nesmí mít klíč schema');
    let floats = 0;
    walkAmounts(legacy, (_p, v) => { if (!Number.isInteger(v)) floats++; });
    assert.gte(floats, 3, 'legacy fixtura musí mít desetinné částky');
  });

  await S.test('fixtury: realistic-year má rok, na kterém se dá měřit', () => {
    const d = JSON.parse(readFileSync(join(FIXTURES, 'realistic-year.json'), 'utf8'));
    const y = d.years['2026'];
    const bySec = {};
    for (const c of y.catalog) bySec[c.sec] = (bySec[c.sec] || 0) + 1;
    assert.eq(bySec.income, 9, 'příjmů');
    assert.eq(bySec.fixed, 14, 'fixních');
    assert.eq(bySec.savings, 5, 'spořicích cílů');
    assert.eq(bySec.debt, 3, 'dluhů');
    assert.eq(bySec.subs, 7, 'předplatných');
    assert.gte(bySec.daily, 30, 'každodenních');
    assert.gte(y.tx.length, 590, 'zápisů v deníku');
    assert.lte(y.tx.length, 620, 'zápisů v deníku');
    assert.eq(y.months.length, 12);
    // schválně nastražené pasti
    assert.ok(y.catalog.some(c => c.dueDay === 31), 'chybí splatnost 31.');
    assert.ok(y.catalog.some(c => c.archived), 'chybí archivovaná kategorie');
    const catIds = new Set(y.catalog.map(c => c.id));
    assert.ok(y.tx.some(t => !catIds.has(t.cat)), 'chybí zápis na zmizelou kategorii');
    const archived = new Set(y.catalog.filter(c => c.archived).map(c => c.id));
    assert.ok(y.tx.some(t => archived.has(t.cat)), 'chybí osiřelý zápis archivované kategorie');
    assert.ok(y.tx.some(t => Number(t.d.slice(5, 7)) - 1 !== t.m), 'chybí zápis z vedlejšího měsíce');
    assert.ok(y.months[1].entries.length > 0, 'chybí únorové položky');
    const zero = y.catalog.find(c => c.goal && c.goal.startBalance === 0 && c.name === 'Nová kuchyň');
    assert.ok(zero, 'chybí spořicí cíl na přesné nule');
  });

  await S.test('fixtury: nikde doslova NaN / undefined / [object Object]', () => {
    const bad = [];
    for (const f of ['empty.json', 'realistic-year.json', 'adversarial.json', 'legacy-v1.json']) {
      const p = join(FIXTURES, f);
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, 'utf8');
      for (const needle of ['NaN', 'Infinity', '[object Object]', '"undefined"']) {
        if (raw.includes(needle)) bad.push(`${f} obsahuje ${needle}`);
      }
    }
    assert.empty(bad, 'fixtura by sama způsobila pád testu na innerText');
  });

  return S;
}

/* ── pomocníci ── */

const AMOUNT_KEYS = new Set(['plan', 'act', 'amt', 'amount', 'actual', 'target', 'startBalance']);
function walkAmounts(node, cb, path = '') {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((v, i) => walkAmounts(v, cb, `${path}[${i}]`)); return; }
  for (const k in node) {
    const v = node[k];
    const p = path ? `${path}.${k}` : k;
    if (AMOUNT_KEYS.has(k) && typeof v === 'number') cb(p, v);
    else walkAmounts(v, cb, p);
  }
}

function parseContractTable() {
  try {
    const md = readFileSync(join(SRC, '_CONTRACT.md'), 'utf8');
    return md.includes('Rezervace jmen') ? md : null;
  } catch { return null; }
}
