#!/usr/bin/env node
// test/fixtures/gen.mjs — deterministický generátor testovacích dat.
//
// Seed je 42 a nikde není Date.now(), Math.random() ani crypto.randomUUID().
// Přegenerování musí dát BAJT ZA BAJT stejné soubory — jinak by každý běh
// testů hlásil falešný rozdíl a nikdo by tomu po týdnu nevěřil.
//
// Částky jsou VŽDY celé haléře (integer minor units). 14 500 Kč = 1450000.
//
// Spuštění:  node test/fixtures/gen.mjs
//            node test/fixtures/gen.mjs --check   (jen ověří determinismus)

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = 42;
const YEAR = 2026;
const T0 = '2026-01-04T09:00:00.000Z';   // pevné razítko, žádné "teď"

/* ───────────────────────── PRNG ───────────────────────── */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rnd = mulberry32(SEED);
let idN = 0;
function resetRng() { rnd = mulberry32(SEED); idN = 0; }

const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));      // celé číslo <lo,hi>
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function id(prefix) { idN += 1; return prefix + idN.toString(36).padStart(4, '0'); }

/* ───────────────────── skeleton dokumentu ───────────────────── */

function emptyYear(y) {
  return {
    year: y,
    catalog: [],
    months: Array.from({ length: 12 }, (_, m) => ({ m, note: '', entries: [] })),
    tx: [],
  };
}

function emptyDoc(y = YEAR) {
  return {
    app: 'rozpocet',
    schema: 1,
    rev: 0,
    savedAt: T0,
    deviceId: 'd_fix42',
    activeYear: y,
    isDemo: false,
    settings: {
      theme: 'auto',
      dueSoonDays: 7,
      autofillOnPaid: true,
      syncUrl: '', syncSecret: '', lastSyncAt: null,
      lastExportAt: null,
      installNagDismissedAt: null,
    },
    ui: { screen: 'month', month: 8, yearTab: 'summary', journalFilter: 'all' },
    years: { [String(y)]: emptyYear(y) },
  };
}

function cat(o) {
  return {
    id: o.id || id('c_'),
    sec: o.sec,
    name: o.name,
    icon: o.icon || '•',
    order: o.order,
    recurring: o.recurring !== false,
    dueDay: o.dueDay === undefined ? null : o.dueDay,
    goal: o.goal === undefined ? null : o.goal,
    archived: !!o.archived,
    createdAt: T0,
    updatedAt: T0,
  };
}

// POZOR na dvě věci, na kterých se dá snadno seknout (a validateDoc je hlídá):
//   · `plan` je VŽDY celé číslo. Prázdné políčko plánu je 0, ne null.
//     Nullable je jen `act` — tam null znamená "spočítej z deníku".
//   · `due` je DEN V MĚSÍCI (1..31), ne datum. Přebíjí `cat.dueDay`
//     a na 28./29. ho ořízne až dueDateFor() při zobrazení.
function entry(o) {
  return {
    id: o.id || id('e_'),
    cat: o.cat,
    plan: Number.isSafeInteger(o.plan) ? o.plan : 0,
    act: o.act === undefined ? null : o.act,
    paid: !!o.paid,
    paidAt: o.paidAt === undefined ? null : o.paidAt,
    due: o.due === undefined ? null : o.due,
    autoFilled: !!o.autoFilled,
    del: !!o.del,
    updatedAt: T0,
  };
}

function tx(o) {
  return {
    id: o.id || id('t_'),
    d: o.d,
    m: o.m === undefined ? Number(o.d.slice(5, 7)) - 1 : o.m,
    cat: o.cat,
    amt: o.amt,
    note: o.note === undefined ? '' : o.note,
    del: !!o.del,
    updatedAt: T0,
  };
}

const p2 = (n) => (n < 10 ? '0' + n : String(n));
const ymd = (y, m, d) => `${y}-${p2(m + 1)}-${p2(d)}`;
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const kc = (koruny) => Math.round(koruny) * 100;   // Kč → haléře

/* ───────────────────── 1. empty.json ───────────────────── */

function buildEmpty() {
  resetRng();
  return emptyDoc(YEAR);
}

/* ─────────────────── 2. realistic-year.json ───────────────────
   Rok, jak ho bude mít skutečná uživatelka: 9 příjmů, 14 fixních,
   30 každodenních, 5 spořicích cílů, 3 dluhy, 7 předplatných
   a ~600 zápisů v deníku s opravdovými českými obchody.          */

const INCOME = [
  ['Výplata', '💰', 4200000], ['Prémie', '🎯', 800000], ['Brigáda', '💵', 450000],
  ['Prodej na Vinted', '👗', 62000], ['Vratka daní', '🧾', 1180000],
  ['Doučování', '📚', 240000], ['Dárek od rodičů', '🎁', 300000],
  ['Cashback z karty', '💳', 18000], ['Úroky ze spořáku', '🏦', 9500],
];

const FIXED = [
  ['Nájem', '🏠', 1450000, 15], ['Energie – záloha', '⚡', 280000, 20],
  ['Voda – záloha', '🚿', 68000, 20], ['Internet', '🌐', 49900, 18],
  ['Telefon', '📱', 39900, 12], ['Pojištění domácnosti', '🛡️', 32500, 10],
  ['Životní pojištění', '❤️', 55000, 10], ['Poplatky bance', '🏦', 9900, 1],
  ['Odvoz odpadu', '🗑️', 12000, 28], ['SVJ fond oprav', '🔧', 85000, 31],
  ['MHD kupón', '🚇', 55000, 1], ['Penzijko', '🐷', 100000, 25],
  ['Poplatek za parkování', '🅿️', 120000, 5], ['Kurz angličtiny', '🇬🇧', 180000, 8],
];

const DAILY = [
  ['Jídlo a potraviny', '🛒', 800000], ['Restaurace', '🍽️', 180000],
  ['Kafe a svačiny', '☕', 90000], ['Drogerie', '🧴', 70000],
  ['Kosmetika', '💄', 60000], ['Doprava', '🚌', 45000],
  ['Taxi a Bolt', '🚕', 50000], ['Benzín', '⛽', 150000],
  ['Oblečení', '👕', 200000], ['Boty', '👟', 90000],
  ['Zdraví a léky', '💊', 55000], ['Zubař', '🦷', 80000],
  ['Kadeřník', '💇', 90000], ['Nehty', '💅', 60000],
  ['Zábava a kino', '🎟️', 70000], ['Knihy', '📖', 45000],
  ['Dárky', '🎁', 120000], ['Domácí potřeby', '🧹', 65000],
  ['Květiny', '💐', 30000], ['Zvířata', '🐈', 85000],
  ['Sport a fitko', '🏋️', 75000], ['Bazén', '🏊', 30000],
  ['Elektronika', '💻', 250000], ['Papírnictví', '✏️', 20000],
  ['Charita', '🤝', 30000], ['Poštovné', '📦', 25000],
  ['Výlety', '🥾', 120000], ['Alkohol a párty', '🍷', 80000],
  ['Nákup online', '📱', 180000], ['Nezařazené', '❔', 50000],
];

const SAVINGS = [
  ['Nouzová rezerva', '🛟', 15000000, 3200000, '2026-12-31', 550000],
  ['Dovolená u moře', '✈️', 4500000, 0, '2026-06-30', 400000],
  ['Nové auto', '🚗', 25000000, 8000000, '2027-09-30', 300000],
  ['Fond pro radost', '🎈', 2000000, 150000, '2026-12-31', 150000],
  ['Nová kuchyň', '🍳', 12000000, 0, '2027-03-31', 0],   // schválně 0 % postupu
];

const DEBT = [
  ['Půjčka na auto', '🏦', 780000, 5],
  ['Kreditka', '💳', 250000, 20],
  ['Dluh ségře', '👭', 100000, 28],
];

const SUBS = [
  ['Netflix', '🎬', 27900, 12], ['Spotify', '🎵', 19900, 3],
  ['iCloud 200 GB', '☁️', 7900, 7], ['Disney+', '🏰', 19900, 14],
  ['Alza Plus+', '📦', 12900, 22], ['Zdravotní appka', '🩺', 9900, 9],
  ['Kurz jógy online', '🧘', 34900, 17],
];

// Obchod → typická částka v Kč <lo,hi>, přiřazený k názvu kategorie.
const MERCHANTS = {
  'Jídlo a potraviny': [['Albert', 180, 1400], ['Lidl', 150, 1200], ['Kaufland', 250, 1900],
  ['Billa', 120, 900], ['Tesco', 180, 1100], ['Penny', 110, 750],
  ['Rohlík', 400, 2600], ['Košík', 380, 2400], ['Globus', 500, 3100]],
  'Restaurace': [['Bageterie Boulevard', 120, 260], ['Lokál', 240, 620], ['Pizza Nuova', 280, 740],
  ['McDonald\'s', 130, 340], ['KFC', 150, 380], ['Vietnamská bistro', 160, 320]],
  'Kafe a svačiny': [['Costa Coffee', 65, 190], ['Starbucks', 90, 220], ['Kafíčko na rohu', 55, 140],
  ['Paul', 80, 260]],
  'Drogerie': [['dm drogerie', 120, 780], ['Teta drogerie', 90, 600], ['Rossmann', 110, 690]],
  'Kosmetika': [['Notino', 250, 1900], ['Douglas', 300, 2400], ['Marionnaud', 280, 1600]],
  'Doprava': [['DPP', 30, 550], ['ČD', 60, 480], ['RegioJet', 90, 690], ['DPMB', 30, 350]],
  'Taxi a Bolt': [['Bolt', 90, 420], ['Uber', 110, 460], ['Liftago', 130, 520]],
  'Benzín': [['Benzina', 700, 1800], ['Shell', 800, 2100], ['MOL', 650, 1700]],
  'Oblečení': [['H&M', 290, 1900], ['Reserved', 350, 2200], ['Zalando', 400, 3400], ['About You', 380, 2800]],
  'Boty': [['Deichmann', 490, 1800], ['Sportisimo', 690, 2900], ['Baťa', 800, 3200]],
  'Zdraví a léky': [['Lékárna Dr. Max', 90, 850], ['BENU lékárna', 110, 720], ['Pilulka', 150, 980]],
  'Zubař': [['Zubní ordinace', 500, 4500]],
  'Kadeřník': [['Kadeřnictví Anna', 450, 1600]],
  'Nehty': [['Nehtové studio', 400, 900]],
  'Zábava a kino': [['Kino Světozor', 150, 320], ['CineStar', 180, 380], ['Divadlo Na zábradlí', 250, 690]],
  'Knihy': [['Knihy Dobrovský', 190, 890], ['Luxor', 220, 940], ['Kosmas', 180, 760]],
  'Dárky': [['Alza', 300, 3900], ['Notino', 250, 1500], ['Bonami', 400, 2600]],
  'Domácí potřeby': [['IKEA', 250, 3800], ['Tescoma', 190, 1400], ['JYSK', 290, 2200]],
  'Květiny': [['Květinářství', 150, 700]],
  'Zvířata': [['Super zoo', 250, 1500], ['Pet Center', 200, 1300]],
  'Sport a fitko': [['Form Factory', 350, 1290], ['Fitness Blue Gym', 300, 990]],
  'Bazén': [['Plavecký stadion', 90, 260]],
  'Elektronika': [['Alza', 400, 9000], ['Datart', 600, 12000], ['CZC.cz', 350, 7000]],
  'Papírnictví': [['McPen', 60, 400], ['Papírnictví Domino', 45, 320]],
  'Charita': [['Člověk v tísni', 200, 1000], ['Nadace Krása pomoci', 200, 800]],
  'Poštovné': [['Zásilkovna', 60, 190], ['Balíkovna', 70, 160], ['PPL', 90, 240]],
  'Výlety': [['Vstupné hrad', 120, 400], ['Penzion', 900, 3200], ['Lanovka', 200, 600]],
  'Alkohol a párty': [['Vinotéka', 250, 1300], ['Bar Hemingway', 300, 1200]],
  'Nákup online': [['Alza', 200, 4500], ['Mall.cz', 250, 3800], ['Zalando', 300, 3000], ['Temu', 90, 900]],
  'Nezařazené': [['Neznámý obchod', 50, 900]],
};

function buildRealistic() {
  resetRng();
  const doc = emptyDoc(YEAR);
  const y = doc.years[String(YEAR)];
  let order = 0;
  const byName = {};

  const add = (o) => {
    order += 10;
    const c = cat({ ...o, order });
    y.catalog.push(c);
    byName[c.name] = c;
    return c;
  };

  for (const [name, icon] of INCOME) add({ sec: 'income', name, icon });
  for (const [name, icon, , dueDay] of FIXED) add({ sec: 'fixed', name, icon, dueDay });
  for (const [name, icon] of DAILY) add({ sec: 'daily', name, icon });
  for (const [name, icon, target, startBalance, targetDate] of SAVINGS) {
    add({ sec: 'savings', name, icon, goal: { target, startBalance, targetDate } });
  }
  for (const [name, icon, , dueDay] of DEBT) add({ sec: 'debt', name, icon, dueDay });
  for (const [name, icon, , dueDay] of SUBS) add({ sec: 'subs', name, icon, dueDay });

  // Archivovaná kategorie — zůstanou po ní osiřelé zápisy v deníku.
  const ghost = add({ sec: 'daily', name: 'Zrušené předplatné časopisu', icon: '📰', archived: true });

  const planOf = {};
  for (const [name, , plan] of INCOME) planOf[name] = plan;
  for (const [name, , plan] of FIXED) planOf[name] = plan;
  for (const [name, , plan] of DAILY) planOf[name] = plan;
  for (const [name, , , , , monthly] of SAVINGS) planOf[name] = monthly;
  for (const [name, , plan] of DEBT) planOf[name] = plan;
  for (const [name, , plan] of SUBS) planOf[name] = plan;

  // Položky ve všech 12 měsících.
  for (let m = 0; m < 12; m++) {
    const mo = y.months[m];
    for (const c of y.catalog) {
      if (c.archived) continue;
      const plan = planOf[c.name] ?? 0;
      const sec = c.sec;
      let act = null;
      let paid = false, paidAt = null;

      if (sec === 'income') {
        // Výplata chodí každý měsíc, ostatní jen občas.
        if (c.name === 'Výplata') act = plan + ri(-2, 6) * 1000;
        else if (rnd() < 0.35) act = Math.round(plan * (0.6 + rnd() * 0.8) / 100) * 100;
        else act = null;
      } else if (sec === 'fixed' || sec === 'subs' || sec === 'debt') {
        // Fixní výdaje jsou zaplacené a rovnají se plánu (energie kolísají).
        const jitter = (c.name === 'Energie – záloha' || c.name === 'Voda – záloha')
          ? Math.round(plan * (0.85 + rnd() * 0.35) / 100) * 100 : plan;
        act = jitter;
        paid = m <= 8;                       // do září zaplaceno
        if (paid) paidAt = ymd(YEAR, m, Math.min(c.dueDay || 10, daysInMonth(YEAR, m)));
      } else if (sec === 'savings') {
        act = plan === 0 ? null : plan;      // "Nová kuchyň" má plán 0 → 0 % postupu
      } else {
        act = null;                          // každodenní se počítají z deníku
      }

      const e = entry({ cat: c.id, plan, act, paid, paidAt });
      // SVJ má v katalogu splatnost 31. Únor 31. nemá, takže tenhle měsíc
      // má vlastní `due` = 28. den; zbytek roku dědí z katalogu.
      if (c.name === 'SVJ fond oprav' && m === 1) e.due = 28;
      mo.entries.push(e);
    }
  }

  // Deník: ~600 zápisů, jen do každodenních kategorií.
  const dailyCats = y.catalog.filter(c => c.sec === 'daily' && !c.archived);
  const weights = dailyCats.map(c => (
    c.name === 'Jídlo a potraviny' ? 9 :
      c.name === 'Kafe a svačiny' ? 6 :
        c.name === 'Restaurace' ? 5 :
          c.name === 'Doprava' ? 4 :
            c.name === 'Drogerie' ? 3 : 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const pickCat = () => {
    let r = rnd() * wsum;
    for (let i = 0; i < dailyCats.length; i++) { r -= weights[i]; if (r <= 0) return dailyCats[i]; }
    return dailyCats[dailyCats.length - 1];
  };

  const TARGET_TX = 596;   // + 4 speciální níž = 600
  for (let i = 0; i < TARGET_TX; i++) {
    const m = ri(0, 11);
    const d = ri(1, daysInMonth(YEAR, m));
    const c = pickCat();
    const list = MERCHANTS[c.name] || [['Obchod', 100, 900]];
    const [shop, lo, hi] = pick(list);
    const koruny = ri(lo, hi);
    const halere = kc(koruny) - (rnd() < 0.45 ? ri(1, 99) : 0);  // ceny typu 249,90
    y.tx.push(tx({ d: ymd(YEAR, m, d), m, cat: c.id, amt: halere, note: shop }));
  }

  // ── záměrné pasti ──
  const jidlo = byName['Jídlo a potraviny'];

  // 1) nákup z konce srpna započtený do zářijového rozpočtu
  y.tx.push(tx({ d: '2026-08-31', m: 8, cat: jidlo.id, amt: 78450, note: 'Kaufland (velký nákup na září)' }));
  // 2) nákup z 1. října započtený zpátky do září
  y.tx.push(tx({ d: '2026-10-01', m: 8, cat: jidlo.id, amt: 24990, note: 'Albert (ještě zářijové peníze)' }));
  // 3) osiřelý zápis — kategorie je archivovaná
  y.tx.push(tx({ d: '2026-03-11', m: 2, cat: ghost.id, amt: 14900, note: 'Předplatné časopisu' }));
  // 4) zápis do kategorie, která v katalogu vůbec není
  y.tx.push(tx({ d: '2026-05-19', m: 4, cat: 'c_zmizela', amt: 33000, note: 'Neznámá kategorie' }));

  // 29. února 2026 neexistuje — 2026 není přestupný. Únorové zápisy končí 28.
  y.tx.push(tx({ d: '2026-02-28', m: 1, cat: jidlo.id, amt: 51200, note: 'Lidl (poslední únorový den)' }));

  y.tx.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.id < b.id ? -1 : 1)));

  doc.ui.month = 8;
  doc.rev = 1;
  return doc;
}

/* ─────────────────── 3. adversarial.json ───────────────────
   Jedna řádka na jeden způsob, jak to může spadnout. Díky tomu je
   každý lovecký test jednořádkový a při pádu je hned vidět kdo za to může.

   POZOR: v žádném názvu nesmí být doslova "NaN", "Infinity", "undefined",
   "null" ani "[object Object]" — na to je vlastní test nad innerText. */

function buildAdversarial() {
  resetRng();
  const doc = emptyDoc(YEAR);
  const y = doc.years[String(YEAR)];
  let order = 0;
  const rows = [];

  const add = (o, e) => {
    order += 10;
    const c = cat({ ...o, order });
    y.catalog.push(c);
    rows.push({ c, e: e || {} });
    return c;
  };

  // ── částky ──
  add({ sec: 'income', name: 'Nula ručně zadaná', icon: '0️⃣' }, { plan: 0, act: 0 });
  // Prázdný plán se ukládá jako 0, prázdná skutečnost jako null
  // (null = "spočítej z deníku"). Tenhle rozdíl se plete nejčastěji.
  add({ sec: 'income', name: 'Prázdný plán i skutečnost', icon: '␀' }, { plan: 0, act: null });
  add({ sec: 'fixed', name: 'Jeden haléř', icon: '🪙' }, { plan: 1, act: 1 });
  add({ sec: 'fixed', name: 'Devadesát devět haléřů', icon: '💱' }, { plan: 99, act: 99 });
  add({ sec: 'fixed', name: 'Zaokrouhlení nahoru 0,50', icon: '⤴️' }, { plan: 50, act: 50 });
  add({ sec: 'fixed', name: 'Miliarda korun (strop)', icon: '🗻' }, { plan: 100000000000, act: 100000000000 });
  add({ sec: 'debt', name: 'Záporná částka', icon: '➖' }, { plan: -450000, act: -450000 });
  add({ sec: 'debt', name: 'Záporných padesát haléřů', icon: '🔻' }, { plan: -50, act: -50 });

  // ── splatnost ──
  add({ sec: 'fixed', name: 'Splatnost 31. každý měsíc', icon: '📅', dueDay: 31 }, { plan: 990000, act: 990000 });
  add({ sec: 'fixed', name: 'Splatnost 29. (únor 2026 nemá)', icon: '🗓️', dueDay: 29 }, { plan: 120000 });
  add({ sec: 'fixed', name: 'Splatnost 1.', icon: '1️⃣', dueDay: 1 }, { plan: 55000 });
  // `due` je den, ne datum: v katalogu 12., ale v únoru výjimečně 3.
  add({ sec: 'subs', name: 'Vlastní splatnost přebíjí katalog', icon: '🔁', dueDay: 12 },
    { plan: 27900, due: 3 });
  add({ sec: 'subs', name: 'Zaplaceno bez data', icon: '✔️', dueDay: 3 }, { plan: 19900, act: 19900, paid: true, paidAt: null });

  // ── text a diakritika ──
  add({ sec: 'daily', name: 'Žluťoučký kůň úpěl ďábelské ódy', icon: '🐴' }, { plan: 120000 });
  add({ sec: 'daily', name: 'Řetízek "v uvozovkách"; se středníkem', icon: '🔗' }, { plan: 45000 });
  add({ sec: 'daily', name: '=SUMA(A1:A9) vzorec do Excelu', icon: '🧮' }, { plan: 33000 });
  add({ sec: 'daily', name: '+420 na začátku', icon: '☎️' }, { plan: 12000 });
  add({ sec: 'daily', name: '@zavináč a -pomlčka', icon: '📧' }, { plan: 8000 });
  add({ sec: 'daily', name: 'Velmi dlouhý název kategorie, který se do jednoho řádku na iPhonu rozhodně nevejde a musí se někde zalomit nebo oříznout', icon: '📏' }, { plan: 77000 });
  add({ sec: 'daily', name: 'Emoji v názvu 🎉🎊🥳', icon: '🎉' }, { plan: 15000 });
  add({ sec: 'daily', name: '   ', icon: '␣' }, { plan: 5000 });          // jen mezery
  add({ sec: 'daily', name: 'Kombinovaná diakritika é', icon: '🔤' }, { plan: 6000 });

  // ── řazení podle češtiny ──
  for (const n of ['Čaj', 'Cukr', 'Chleba', 'Hudba', 'Žena', 'Zima']) {
    add({ sec: 'daily', name: n, icon: '🔠' }, { plan: 10000 });
  }

  // ── měkké mazání ──
  add({ sec: 'daily', name: 'Smazaná položka (nesmí být vidět)', icon: '🗑️' }, { plan: 999900, del: true });
  const archived = add({ sec: 'daily', name: 'Archivovaná kategorie', icon: '📦', archived: true }, { plan: 40000 });

  // ── spořicí cíle ──
  add({ sec: 'savings', name: 'Cíl s nulovým targetem', icon: '⭕', goal: { target: 0, startBalance: 0, targetDate: `${YEAR}-12-31` } }, { plan: 0 });
  add({ sec: 'savings', name: 'Cíl na přesně nule', icon: '🫙', goal: { target: 5000000, startBalance: 0, targetDate: `${YEAR}-12-31` } }, { plan: 0, act: 0 });
  add({ sec: 'savings', name: 'Cíl přeplněný přes sto procent', icon: '🏔️', goal: { target: 1000000, startBalance: 2500000, targetDate: `${YEAR}-12-31` } }, { plan: 100000, act: 100000 });
  add({ sec: 'savings', name: 'Cíl s datem v minulosti', icon: '⏮️', goal: { target: 3000000, startBalance: 1000000, targetDate: '2025-01-31' } }, { plan: 50000, act: 50000 });
  add({ sec: 'savings', name: 'Cíl bez data', icon: '♾️', goal: { target: 3000000, startBalance: 0, targetDate: null } }, { plan: 50000, act: 50000 });

  // Položky do všech 12 měsíců, ať se dá projít celý rok.
  for (let m = 0; m < 12; m++) {
    for (const { c, e } of rows) {
      if (c.archived) continue;
      const ee = entry({ cat: c.id, ...e });
      if (e.due && m !== 1) ee.due = null;
      if (e.paidAt && m > 0) ee.paidAt = ymd(YEAR, m, 3);
      y.months[m].entries.push(ee);
    }
  }

  // ── deník ──
  const food = y.catalog.find(c => c.name === 'Žluťoučký kůň úpěl ďábelské ódy');
  y.tx.push(tx({ d: `${YEAR}-01-15`, m: 0, cat: food.id, amt: 12345, note: 'Albert' }));
  y.tx.push(tx({ d: `${YEAR}-02-28`, m: 1, cat: food.id, amt: 100, note: 'Poslední únorový den' }));
  y.tx.push(tx({ d: `${YEAR}-12-31`, m: 11, cat: food.id, amt: 250000, note: 'Silvestr' }));
  y.tx.push(tx({ d: `${YEAR}-01-01`, m: 0, cat: food.id, amt: 9900, note: 'Novoroční' }));
  // zápis z jiného měsíce, než do kterého se počítá
  y.tx.push(tx({ d: `${YEAR}-06-30`, m: 6, cat: food.id, amt: 55000, note: 'Konec června, počítá se do července' }));
  // osiřelý zápis — kategorie archivovaná
  y.tx.push(tx({ d: `${YEAR}-04-04`, m: 3, cat: archived.id, amt: 40000, note: 'Osiřelý zápis' }));
  // zápis na neexistující kategorii
  y.tx.push(tx({ d: `${YEAR}-05-05`, m: 4, cat: 'c_neexistuje', amt: 10000, note: 'Zmizelá kategorie' }));
  // smazaný zápis
  y.tx.push(tx({ d: `${YEAR}-07-07`, m: 6, cat: food.id, amt: 777700, note: 'Smazaný zápis', del: true }));
  // nulový zápis
  y.tx.push(tx({ d: `${YEAR}-08-08`, m: 7, cat: food.id, amt: 0, note: 'Nulový zápis' }));
  // zápis s prázdnou poznámkou
  y.tx.push(tx({ d: `${YEAR}-09-09`, m: 8, cat: food.id, amt: 33300, note: '' }));
  // zápis s velmi dlouhou poznámkou
  y.tx.push(tx({
    d: `${YEAR}-09-10`, m: 8, cat: food.id, amt: 4200,
    note: 'Poznámka, která je opravdu hodně dlouhá, protože si uživatelka ráda píše celé věty o tom, co a proč koupila, a čeká, že se to nikde nerozbije',
  }));

  y.months[8].note = 'Poznámka k měsíci — taky může být dlouhá a s diakritikou: příliš žluťoučký kůň.';
  doc.ui.month = 1;   // únor: tam se láme splatnost 29. i 31.
  doc.rev = 2;
  return doc;
}

/* ─────────────────── 4. legacy-v1.json ───────────────────
   Zdroj pro migraci. Dvě věci ho dělají "starým":
     1) NENÍ v něm klíč `schema` (ani `version`) — první verze ho neměla,
        migrace ho musí umět považovat za v1;
     2) částky jsou FLOATY V KORUNÁCH (14500.5), ne celé haléře.
   Tvar dokumentu je jinak dnešní, takže migrace řeší přesně ty dvě věci
   a nic jiného. Kdyby fixtura měla i jiný tvar, test by měřil fantazii. */

const LEG_YEAR = 2025;

function buildLegacy() {
  resetRng();
  const cats = [
    { id: 'c_vyplata', sec: 'income', name: 'Výplata', icon: '💰', order: 10, dueDay: null },
    { id: 'c_najem', sec: 'fixed', name: 'Nájem', icon: '🏠', order: 20, dueDay: 15 },
    { id: 'c_jidlo', sec: 'daily', name: 'Jídlo a potraviny', icon: '🛒', order: 30, dueDay: null },
    { id: 'c_rezerva', sec: 'savings', name: 'Rezerva', icon: '🛟', order: 40, dueDay: null },
  ].map(c => ({
    id: c.id, sec: c.sec, name: c.name, icon: c.icon, order: c.order,
    recurring: true, dueDay: c.dueDay,
    goal: c.sec === 'savings' ? { target: 50000, startBalance: 0, targetDate: '2025-12-31' } : null,
    archived: false,
    createdAt: '2025-01-02T10:00:00.000Z', updatedAt: '2025-11-30T21:44:03.000Z',
  }));

  // plán/skutečnost v KORUNÁCH jako float — přesně to, co migrace opravuje
  const perMonth = [
    { cat: 'c_vyplata', plan: 38000, act: 38000 },
    { cat: 'c_najem', plan: 14500.5, act: 14500.5, paid: true },
    { cat: 'c_jidlo', plan: 7000, act: 6842.35 },
    { cat: 'c_rezerva', plan: 2000, act: 1999.99 },
  ];

  const months = [];
  for (let m = 0; m < 12; m++) {
    const entries = (m === 9 || m === 10) ? perMonth.map((p, i) => ({
      id: `e_leg${m}${i}`,
      cat: p.cat,
      plan: p.plan,
      act: m === 10 && p.cat === 'c_vyplata' ? 39250.75 : p.act,
      paid: !!p.paid,
      paidAt: p.paid ? ymd(LEG_YEAR, m, 15) : null,
      due: null,
      autoFilled: false,
      del: false,
      updatedAt: '2025-11-30T21:44:03.000Z',
    })) : [];
    months.push({ m, note: '', entries });
  }

  return {
    app: 'rozpocet',
    // ŽÁDNÝ `schema` ani `version` — podle toho se pozná první verze
    rev: 12,
    savedAt: '2025-11-30T21:44:03.000Z',
    deviceId: 'd_legacy',
    activeYear: LEG_YEAR,
    isDemo: false,
    settings: { theme: 'light', dueSoonDays: 5 },
    ui: { screen: 'month', month: 10 },
    years: {
      '2025': {
        year: LEG_YEAR,
        catalog: cats,
        months,
        tx: [
          { id: 't_leg1', d: '2025-11-03', m: 10, cat: 'c_jidlo', amt: 389.5, note: 'Lidl', del: false, updatedAt: '2025-11-03T18:00:00.000Z' },
          { id: 't_leg2', d: '2025-11-08', m: 10, cat: 'c_jidlo', amt: 1204.9, note: 'Rohlík', del: false, updatedAt: '2025-11-08T09:12:00.000Z' },
          { id: 't_leg3', d: '2025-11-19', m: 10, cat: 'c_jidlo', amt: 62, note: 'Kafe', del: false, updatedAt: '2025-11-19T11:30:00.000Z' },
        ],
      },
    },
  };
}

/* ─────────── hustá data pro test velikosti úložiště ───────────
   Nezapisuje se na disk — používá ho storage suita přímo. */

export function denseDoc(txCount = 2000) {
  resetRng();
  const doc = buildRealistic();
  const y = doc.years[String(YEAR)];
  const dailyCats = y.catalog.filter(c => c.sec === 'daily' && !c.archived);
  y.tx.length = 0;
  for (let i = 0; i < txCount; i++) {
    const m = i % 12;
    const d = ri(1, daysInMonth(YEAR, m));
    const c = dailyCats[i % dailyCats.length];
    const list = MERCHANTS[c.name] || [['Obchod', 100, 900]];
    const [shop, lo, hi] = pick(list);
    y.tx.push(tx({ d: ymd(YEAR, m, d), m, cat: c.id, amt: kc(ri(lo, hi)) - ri(0, 99), note: shop }));
  }
  return doc;
}

/* ───────────────────────── zápis ───────────────────────── */

const FILES = [
  ['empty.json', buildEmpty, 2],
  ['realistic-year.json', buildRealistic, 0],
  ['adversarial.json', buildAdversarial, 2],
  ['legacy-v1.json', buildLegacy, 2],
];

function render(build, indent) {
  const json = JSON.stringify(build(), null, indent || undefined);
  return json + '\n';
}

export function generate({ check = false } = {}) {
  if (!existsSync(HERE)) mkdirSync(HERE, { recursive: true });
  const report = [];
  for (const [name, build, indent] of FILES) {
    const body = render(build, indent);
    const p = join(HERE, name);
    const old = existsSync(p) ? readFileSync(p, 'utf8') : null;
    const same = old === body;
    if (!check) writeFileSync(p, body, 'utf8');
    report.push({ name, bytes: Buffer.byteLength(body), same, existed: old !== null });
  }
  return report;
}

/** Ověří, že dvě generování za sebou dají bajt za bajt totéž. */
export function selfCheckDeterminism() {
  const a = FILES.map(([n, b, i]) => [n, render(b, i)]);
  const bb = FILES.map(([n, b, i]) => [n, render(b, i)]);
  const bad = [];
  for (let i = 0; i < a.length; i++) if (a[i][1] !== bb[i][1]) bad.push(a[i][0]);
  return bad;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const check = process.argv.includes('--check');
  const drift = selfCheckDeterminism();
  if (drift.length) {
    console.error('CHYBA: generátor není deterministický: ' + drift.join(', '));
    process.exit(1);
  }
  const rep = generate({ check });
  for (const r of rep) {
    const flag = !r.existed ? 'nový' : (r.same ? 'beze změny' : (check ? 'LIŠÍ SE' : 'přepsán'));
    console.log(`  ${r.name.padEnd(22)} ${String(r.bytes).padStart(8)} B  ${flag}`);
  }
  const stats = statsOf();
  console.log(`\n  realistic-year: ${stats.cats} kategorií, ${stats.entries} položek, ${stats.tx} zápisů`);
  console.log('  seed 42 — dvě generování za sebou dala bajt za bajt totéž.');
  if (check && rep.some(r => !r.same)) process.exit(2);
}

function statsOf() {
  const d = buildRealistic();
  const y = d.years[String(YEAR)];
  return {
    cats: y.catalog.length,
    entries: y.months.reduce((a, m) => a + m.entries.length, 0),
    tx: y.tx.length,
  };
}

export { buildEmpty, buildRealistic, buildAdversarial, buildLegacy, YEAR, SEED };
