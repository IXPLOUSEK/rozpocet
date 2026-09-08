// 80-boot.js — start aplikace, motiv, instalace na plochu, ukázková data — vlastní: L0

/* ---------- pojistka proti bílé stránce ---------- */

function installErrorHandler() {
  let shown = false;
  function fail(msg) {
    if (shown) return;
    shown = true;
    try { flushSave(); } catch (e) {}
    const host = qs('#banner-host') || document.body;
    const b = el('div', { class: 'banner banner-error', role: 'alert' });
    b.appendChild(el('span', { class: 'banner-ico' }, '⚠️'));
    const t = el('span', { class: 'banner-text' });
    t.appendChild(el('span', { class: 'banner-title' }, 'Něco se pokazilo'));
    t.appendChild(el('span', { class: 'banner-body' },
      'Tvoje data jsou v pořádku uložená. Zkus aplikaci zavřít a otevřít znovu. ' +
      'Když to nepomůže, stáhni si zálohu v Nastavení.'));
    b.appendChild(t);
    const btn = el('button', { class: 'banner-action', 'data-act': 'io.export' }, 'Stáhnout zálohu');
    b.appendChild(btn);
    host.appendChild(b);
    console.error(msg);
  }
  window.addEventListener('error', function (e) { fail(e.message || e); });
  window.addEventListener('unhandledrejection', function (e) { fail(e.reason); });
}

/* ---------- úložiště ---------- */

function guardStorage() {
  let probe = { ok: false, reason: 'neznámé' };
  try { probe = storageProbe(); } catch (e) { probe = { ok: false, reason: String(e && e.name || e) }; }
  if (probe.ok) return true;

  // Nepředstírat, že se ukládá. Tohle je přesně ten způsob, jak se ztratí rok práce.
  const fromFile = location.protocol === 'file:';
  sheetBanner({
    id: 'storage-dead', kind: 'error', icon: '⚠️',
    title: TXT.storageDeadTitle,
    body: fromFile
      ? 'Otevřela jsi soubor z disku. Safari z tohohle místa neumí nic uložit. Otevři aplikaci přes její webovou adresu nebo z ikony na ploše.'
      : TXT.storageDeadBody,
  });
  return false;
}

/* ---------- motiv ---------- */

function applyTheme() {
  const t = (state && state.settings && state.settings.theme) || 'auto';
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

function watchScheme() {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const h = function () { if (!state.settings || state.settings.theme === 'auto') applyTheme(); };
  if (mq.addEventListener) mq.addEventListener('change', h);
  else if (mq.addListener) mq.addListener(h);
}

/* ---------- instalace na plochu ----------
   Safari maže všechna data webu po 7 dnech nepoužívání. Jediná výjimka,
   kterou WebKit sám dokumentuje, je stránka přidaná na plochu. Proto to
   není kosmetika a proto na to appka upozorňuje, dokud se to nestane. */

function detectStandalone() {
  const mm = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  return !!(mm || window.navigator.standalone);
}

function isApple() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
}

function maybeInstallNag() {
  if (detectStandalone()) { sheetBannerClear('install'); return; }
  if (location.protocol === 'file:') return;
  const d = state.settings.installNagDismissedAt;
  if (d && daysBetween(d, todayISO()) !== null && daysBetween(d, todayISO()) < 3) return;
  sheetBanner({
    id: 'install', kind: 'accent', icon: '📲', dismissible: true,
    title: TXT.notInstalledTitle,
    body: isApple()
      ? TXT.notInstalledBody
      : 'Přidej si aplikaci na plochu, ať ji máš po ruce a prohlížeč ti data nesmaže.',
    action: 'Jak na to', act: 'install.how',
  });
}

// Připomínka zálohy. Musí být vidět na hlavní obrazovce, ne schovaná
// v nastavení — jinak ji uvidí právě ten, kdo zálohy už řeší.
function maybeBackupNag() {
  const last = state.settings.lastExportAt;
  const dnu = last ? daysBetween(String(last).slice(0, 10), todayISO()) : null;
  const prazdna = (function () {
    try { const y = getYear(); return !y || (y.catalog.length === 0 && y.tx.length === 0); }
    catch (e) { return true; }
  })();
  if (prazdna) return;                       // není co zálohovat
  if (dnu !== null && dnu < 21) return;
  sheetBanner({
    id: 'backup', kind: 'warn', icon: '🛟', dismissible: true,
    title: last ? 'Zálohu sis dělala naposledy před ' + dnu + ' dny' : 'Ještě nemáš zálohu',
    body: 'Prohlížeč umí data smazat sám. Stažený soubor je jediná kopie, kterou máš plně pod kontrolou.',
    action: TXT.backup, act: 'io.export',
  });
}

// Hlásí, že se přestalo ukládat. Pruh je trvalý a nedá se odklepnout —
// je to nejdůležitější informace, jakou appka může mít.
// Zápis se zase povedl. Pruh o chybě musí pryč; když se to podařilo až
// po úklidu místa, řekne se to jednou nahlas.
function saveRecovered(poUklidu) {
  sheetBannerClear('save');
  if (poUklidu && Date.now() - (saveRecovered.last || 0) > 60000) {
    saveRecovered.last = Date.now();
    toast('Došlo místo, tak jsem uklidila staré kopie. Uložilo se to. Stáhni si zálohu.', { ms: 8000 });
  }
}

function saveProblemNotify(st) {
  const teksty = {
    quota: ['Došlo místo', 'Prohlížeč odmítl uložit další data. Stáhni si zálohu, ať o nic nepřijdeš, a smaž staré měsíce nebo ukázková data.'],
    write: ['Data se neukládají', 'Zápis do prohlížeče selhal. Stáhni si zálohu a zkus aplikaci zavřít a otevřít znovu.'],
    locked: ['Ukládání je pozastavené', 'Poškozená data leží stranou. Načti zálohu, nebo data vymaž — teprve pak se zase ukládá.'],
    invalid: ['V datech je chyba', 'Něco v datech neodpovídá očekávanému tvaru, tak se radši neuložila. Stáhni si zálohu.'],
    stringify: ['Data nejdou uložit', 'Nepodařilo se z nich udělat zápis. Stáhni si zálohu.'],
    nostate: ['Aplikace nemá data', 'Zkus ji zavřít a otevřít znovu.'],
  };
  const t = teksty[st && st.reason] || ['Data se neukládají', 'Stáhni si zálohu, ať o nic nepřijdeš.'];
  sheetBannerClear('save');
  sheetBanner({ id: 'save', kind: 'error', icon: '⚠️', title: t[0], body: t[1],
    action: TXT.backup, act: 'io.export' });
  const now = Date.now();
  // Čas posledního upozornění visí na funkci, ne na proměnné vedle ní:
  // funkce se hoistuje, `let` ne, a volající by ji trefil v mrtvé zóně.
  if (now - (saveProblemNotify.last || 0) > 20000) {
    saveProblemNotify.last = now;
    toast(t[0] + ' — stáhni si zálohu.', { ms: 8000 });
  }
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  // Relativní cesta, aby fungoval i podadresář na GitHub Pages.
  navigator.serviceWorker.register('./sw.js').catch(function (e) {
    console.warn('service worker se nepodařilo zaregistrovat:', e && e.message);
  });
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () {});
  }
}

/* ---------- první spuštění ----------
   Aplikace startuje ÚPLNĚ prázdná. Kategorie se zakládají jedině tehdy,
   když si to uživatelka na uvítací obrazovce sama vybere. */

function firstRunSeed() {
  const y = getYear();
  if (!y) return;
  if (y.catalog.length > 0) return;
  if (state.settings.welcomeDone) return;

  openSheet({
    title: 'Vítej v Rozpočtu',
    autofocus: false,
    build: function (body) {
      body.appendChild(el('p', { class: 'sheet-text' },
        'Můžeš začít s doporučenými kategoriemi a jen si je upravit, nebo úplně od nuly.'));
      body.appendChild(el('p', { class: 'sheet-text sheet-text-dim' },
        'Částky budou v obou případech prázdné. Kategorie si můžeš kdykoliv přejmenovat, přidat i smazat.'));
    },
    foot: [
      { label: 'Začít od nuly', kind: 'ghost', value: 'empty' },
      { label: 'Doporučené kategorie', kind: 'primary', value: 'seed' },
    ],
  }).then(function (choice) {
    setSetting('welcomeDone', true);
    if (choice === 'seed') {
      for (const def of DEFAULT_CATALOG) {
        addCatalogItem({ sec: def.sec, name: def.name, icon: def.icon, dueDay: def.dueDay || null }, 'all');
      }
      toast('Kategorie jsou připravené. Doplň si k nim částky.');
    }
    invalidateAll();
    renderApp();
  });
}

/* ---------- ukázková data ----------
   Čistá funkce s jediným volacím místem: tlačítko v Nastavení.
   Nikde v inicializaci, nikde jako výchozí hodnota. */

function makeDemoData(seed) {
  let s = (seed || 42) >>> 0;
  const rnd = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
  const around = function (base, spread) {
    return roundMinor(Math.round(base * 100 * (1 + (rnd() - 0.5) * spread)), 100);
  };

  const y = state.activeYear;
  const plan = [
    ['income', 'Výplata', '💰', 3800000, null],
    ['income', 'Brigáda', '💵', 450000, null],
    ['fixed', 'Nájem', '🏠', 1450000, 15],
    ['fixed', 'Zálohy (voda, elektřina)', '⚡', 320000, 20],
    ['fixed', 'Internet', '🌐', 45000, 18],
    ['fixed', 'Telefon', '📱', 39900, 12],
    ['daily', 'Jídlo a potraviny', '🛒', 800000, null],
    ['daily', 'Restaurace a kafe', '☕', 180000, null],
    ['daily', 'Drogerie', '🧴', 90000, null],
    ['daily', 'Doprava', '🚌', 55000, null],
    ['savings', 'Nouzová rezerva', '🛟', 300000, null],
    ['savings', 'Dovolená', '✈️', 200000, null],
    ['debt', 'Půjčka', '🏦', 480000, 5],
    ['subs', 'Netflix', '🎬', 27900, 12],
    ['subs', 'Spotify', '🎵', 19900, 3],
  ];
  const ids = {};
  for (const p of plan) {
    const cat = addCatalogItem({ sec: p[0], name: p[1], icon: p[2], dueDay: p[4] }, 'all');
    ids[p[1]] = cat.id;
    for (let m = 0; m < 12; m++) {
      const en = ensureEntry(m, cat.id);
      setPlanned(m, en.id, p[3]);
      if (m <= state.ui.month && p[0] !== 'daily') {
        setActual(m, en.id, around(p[3] / 100, 0.06));
        if (p[4]) togglePaid(m, en.id, true);
      }
    }
  }
  setGoal(ids['Dovolená'], { target: 4500000, startBalance: 0, targetDate: y + '-08-31' });
  setGoal(ids['Nouzová rezerva'], { target: 10000000, startBalance: 2400000, targetDate: y + '-12-31' });

  const shops = ['Albert', 'Lidl', 'Rohlík', 'Kaufland', 'Billa', 'Penny', 'Globus'];
  const cafes = ['kafe', 'oběd', 'snídaně s Terkou', 'rozvoz'];
  const dailyIds = [ids['Jídlo a potraviny'], ids['Restaurace a kafe'], ids['Drogerie'], ids['Doprava']];
  for (let m = 0; m <= state.ui.month; m++) {
    const n = 18 + Math.floor(rnd() * 14);
    for (let i = 0; i < n; i++) {
      const day = 1 + Math.floor(rnd() * daysInMonth(y, m));
      const cat = pick(dailyIds);
      addTx({
        d: y + '-' + (m + 1 < 10 ? '0' : '') + (m + 1) + '-' + (day < 10 ? '0' : '') + day,
        m: m, cat: cat,
        amt: cat === ids['Jídlo a potraviny'] ? around(420, 0.9) : around(180, 1.2),
        note: cat === ids['Jídlo a potraviny'] ? pick(shops) : pick(cafes),
      });
    }
  }
  state.isDemo = true;
  bump(state);
  invalidateAll();
}

/* ---------- start ---------- */

function boot() {
  installErrorHandler();
  // Jazyk stránky nastavujeme i z kódu — appka může běžet vloženě v cizí
  // stránce, kde <html lang> není náš.
  try { document.documentElement.lang = 'cs'; } catch (e) {}

  const storageOk = (function () {
    try { return storageProbe().ok; } catch (e) { return false; }
  })();

  let load = null;
  try { load = loadState(); } catch (e) { console.error('loadState selhal', e); }

  // loadState() si `state` nastaví sám a vrací jen zprávu o tom, odkud data
  // přišla. Kdyby cokoliv selhalo, ať appka naběhne prázdná místo bílé stránky.
  if (!state || !state.app) {
    try { state = emptyDoc(); } catch (e) { console.error('emptyDoc selhal', e); }
  }
  if (!state.ui) state.ui = { screen: 'month', month: new Date().getMonth(), yearTab: 'summary', journalFilter: 'all' };
  if (!state.settings) state.settings = {};

  guardStorage();
  applyTheme();
  watchScheme();
  bindGlobalEvents();

  // Poškozená data: loadState je odloží stranou a naběhne ze zálohy nebo
  // ze snapshotu. Uživatelka se to musí dozvědět, ne to jen tak přejít.
  if (load && load.quarantineKey) {
    const src = load.source === 'backup' ? 'Aplikace naběhla ze zálohy.'
      : load.source === 'snapshot' ? 'Aplikace naběhla z poslední uložené verze.'
      : 'Aplikace musela začít prázdná.';
    sheetBanner({ id: 'corrupt', kind: 'warn', icon: '🛟',
      title: TXT.corruptTitle,
      body: TXT.corruptBody + ' ' + src
        + ' Původní soubor si můžeš stáhnout tlačítkem níž a poslat mi ho.',
      action: 'Stáhnout poškozený soubor', act: 'io.rescue' });
  }
  if (load && load.source === 'newer') {
    sheetBanner({ id: 'newer', kind: 'error', icon: '⏭️',
      title: 'Data jsou z novější verze aplikace',
      body: 'Nic se nepřepsalo a leží to odložené stranou. Otevři aplikaci na '
        + 'aktuální adrese, nebo si data stáhni a pošli mi je.',
      action: 'Stáhnout data', act: 'io.rescue' });
  }
  if (state.isDemo) {
    // Existuje-li snímek stavu před ukázkou, nabídne se návrat i po
    // restartu. Bez toho zbylo po zavření appky jediné tlačítko: Vymazat.
    let lzeVratit = false;
    try {
      lzeVratit = (typeof snapshotList === 'function') &&
        snapshotList().some(function (x) { return x && x.ok && x.reason === 'pred-ukazkou'; });
    } catch (e) { lzeVratit = false; }
    sheetBanner({ id: 'demo', kind: 'warn', icon: '🧪',
      title: TXT.demoBanner,
      body: lzeVratit
        ? 'Tvoje původní data leží stranou — vrátíš je jedním klepnutím.'
        : 'Až si to prohlédneš, vymaž je a začni s vlastními čísly.',
      action: lzeVratit ? 'Vrátit moje data' : TXT.demoWipe,
      act: lzeVratit ? 'demo.undo' : 'demo.wipe' });
  }

  goScreen(state.ui && state.ui.screen ? state.ui.screen : 'month');
  maybeInstallNag();
  maybeBackupNag();
  registerSW();
  firstRunSeed();

  // Testovací šev. Osobní appka, žádná bezpečnostní hranice.
  window.__APP__ = {
    state: function () { return state; },
    parseCzkInput: parseCzkInput, formatCzk: formatCzk, fmtEdit: fmtEdit,
    monthKey: monthKey, dueDateFor: dueDateFor, daysBetween: daysBetween,
    computeMonth: computeMonth, computeYear: computeYear, computeDue: computeDue,
    emptyDoc: emptyDoc, makeDemoData: makeDemoData,
    render: renderApp, patch: patchNow, save: flushSave, saveNow: saveNow,
    selfTest: function () { return typeof selfTest === 'function' ? selfTest() : null; },
    storageOk: storageOk, version: APP_VERSION,
  };

  window.__rozpocetBooted = true;
  if (location.hash === '#test' && typeof selfTest === 'function') selfTest();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
