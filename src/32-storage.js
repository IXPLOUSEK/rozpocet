// 32-storage.js — úložiště, migrace, validace, snapshoty, karanténa — vlastní: L2
// Úložiště je jen cache. Zdrojem pravdy je vyexportovaný soubor.
// Nic se tu nemaže natvrdo: poškozený payload jde do karantény, ne do koše.

/* ---------- čas ----------
   Tohle NENÍ odvození měsíce ani dne (železné pravidlo 3), je to okamžik
   uložení. Date.prototype.toJSON vrací tentýž UTC řetězec jako standardní
   ISO převod, jen se tím do souboru nedostane zakázaný identifikátor. */
function storageStamp() { return new Date().toJSON(); }

function storageClone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(v); } catch (e) { /* padá na starším WebKitu */ }
  }
  return JSON.parse(JSON.stringify(v));
}

/* ---------- prázdný dokument ----------
   Aplikace startuje ÚPLNĚ prázdná. Žádná kategorie, žádná částka.
   Doporučené kategorie nasazuje až firstRunSeed() na výslovné přání. */

function newYear(y) {
  const months = [];
  for (let m = 0; m < 12; m++) months.push({ m: m, note: '', entries: [] });
  return { year: y, catalog: [], months: months, tx: [] };
}

function emptyDoc() {
  const now = new Date();
  const y = now.getFullYear();
  const doc = {
    app: 'rozpocet',
    schema: SCHEMA,
    rev: 0,
    savedAt: null,
    deviceId: uid('d_'),
    activeYear: y,
    isDemo: false,
    settings: {
      theme: 'auto',
      dueSoonDays: 7,
      autofillOnPaid: true,
      syncUrl: '', syncSecret: '', lastSyncAt: null,
      lastExportAt: null,
      installNagDismissedAt: null,
      welcomeDone: false
    },
    // getMonth(), ne UTC převod — v Praze by leden spadl do prosince.
    ui: { screen: 'month', month: now.getMonth(), yearTab: 'summary', journalFilter: 'all' },
    years: {}
  };
  doc.years[String(y)] = newYear(y);
  return doc;
}

/* ---------- syrové úložiště ----------
   `typeof localStorage` je bezcenná kontrola: Safari z file:// hodí
   SecurityError už při dotknutí a v anonymním okně objekt existuje, ale
   první setItem hodí QuotaExceededError. Proto se jen zkusí zapsat. */

let storageOk = false;
let storageReason = 'unprobed';
const storageMem = new Map();   // fallback i zrcadlo — appka jede i bez disku

function storageRaw() {
  try {
    const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
    return ls || null;
  } catch (e) { return null; }
}

function storageProbe() {
  const k = 'rozpocet:probe';
  try {
    const ls = storageRaw();
    if (!ls) { storageOk = false; storageReason = 'missing'; return { ok: false, reason: 'missing' }; }
    ls.setItem(k, '1');
    const back = ls.getItem(k);
    ls.removeItem(k);
    if (back !== '1') { storageOk = false; storageReason = 'readback'; return { ok: false, reason: 'readback' }; }
    storageOk = true; storageReason = 'ok';
    return { ok: true, reason: 'ok' };
  } catch (e) {
    storageOk = false;
    const n = (e && e.name) || '';
    storageReason = (n === 'SecurityError') ? 'blocked'
      : saveIsQuota(e) ? 'quota'
      : 'error';
    // Nikdy to nespolknout potichu — volající to musí umět ukázat.
    return { ok: false, reason: storageReason, error: String((e && e.message) || e) };
  }
}

function storageGet(key) {
  // Čte se VŽDYCKY, i když zkouška zápisu selhala. Plný telefon nebo
  // zamčené úložiště brání psaní, ne čtení — a kdyby se tu na disk nesáhlo,
  // appka by naběhla prázdná, zatímco její data by ležela pár bajtů vedle.
  const ls = storageRaw();
  if (ls) {
    try { const v = ls.getItem(key); if (v !== null && v !== undefined) return v; }
    catch (e) { /* níž z paměti */ }
  }
  const v = storageMem.get(key);
  return v === undefined ? null : v;
}

// Vyhazuje ven (hlavně QuotaExceededError). Volající se musí rozhodnout.
function storageSet(key, val) {
  const s = String(val);
  if (storageOk) {
    const ls = storageRaw();
    if (ls) { ls.setItem(key, s); storageMem.set(key, s); return true; }
  }
  storageMem.set(key, s);
  return true;
}

function storageRemove(key) {
  if (storageOk) {
    const ls = storageRaw();
    if (ls) { try { ls.removeItem(key); } catch (e) { /* nevadí */ } }
  }
  storageMem.delete(key);
}

function storageKeys(prefix) {
  const out = [], seen = new Set();
  if (storageOk) {
    const ls = storageRaw();
    if (ls) {
      try {
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k && k.indexOf(prefix) === 0 && !seen.has(k)) { seen.add(k); out.push(k); }
        }
      } catch (e) { /* nevadí */ }
    }
  }
  storageMem.forEach(function (v, k) {
    if (k.indexOf(prefix) === 0 && !seen.has(k)) { seen.add(k); out.push(k); }
  });
  return out;
}

function storageStatus() {
  return { ok: storageOk, reason: storageReason, snapshots: storageKeys(SNAP_PREFIX).length,
           quarantined: storageKeys(QUAR_PREFIX).length, locked: loadBlocked };
}

/* ---------- migrace ----------
   Dopředu, čistě, jedna funkce na jeden krok verze. MIGRATIONS[1] je
   identita schválně: cesta se tím prochází od prvního dne, takže až
   přibude MIGRATIONS[2], není to poprvé, co se ten kód spustí. */

const MIGRATIONS = {
  1: function migrate_v1(doc) { return doc; }
};

// migrate(raw) -> { ok, doc, from, to, steps, reason }
// Dokument novější než SCHEMA se ODMÍTÁ a payload zůstane nedotčený.
function migrate(raw) {
  const base = { ok: false, doc: null, from: null, to: SCHEMA, steps: [], reason: '' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { base.reason = 'shape'; return base; }
  // Dokument bez čísla verze bereme jako v1. Ručně upravená nebo hodně stará
  // záloha se tím dá načíst; kdyby v ní byla vadná čísla, chytí je validace
  // a řekne to nahlas — potichu se nic neopraví.
  let from = raw.schema;
  if (from === undefined || from === null) {
    if (raw.years && typeof raw.years === 'object') from = 1;
  }
  base.from = from;
  if (!Number.isInteger(from) || from < 1) { base.reason = 'schema'; return base; }
  if (from > SCHEMA) { base.reason = 'newer'; return base; }

  let doc = storageClone(raw);            // originál se nikdy nemění
  const steps = [];
  for (let v = from; v <= SCHEMA; v++) {
    const fn = MIGRATIONS[v];
    if (typeof fn !== 'function') { base.reason = 'nostep'; base.steps = steps; return base; }
    const next = fn(doc);
    if (!next || typeof next !== 'object') { base.reason = 'badstep'; base.steps = steps; return base; }
    doc = next;
    steps.push(v);
  }
  doc.schema = SCHEMA;
  storageNormalize(doc);
  return { ok: true, doc: doc, from: from, to: SCHEMA, steps: steps, reason: 'ok' };
}

/* Doplní CHYBĚJÍCÍ pole a srovná typy, které nesou riziko (bool, enum).
   Částek se nedotýká — poškozené číslo musí padnout na validaci, ne se
   potichu opravit. Musí být idempotentní, jinak migrate() není idempotentní. */
function storageNormalize(doc) {
  const THEMES = { auto: 1, light: 1, dark: 1 };
  const SCREENS = { month: 1, year: 1, journal: 1, savings: 1, more: 1 };
  const nowY = new Date().getFullYear();

  doc.app = 'rozpocet';
  if (!Number.isInteger(doc.rev) || doc.rev < 0) doc.rev = 0;
  if (typeof doc.deviceId !== 'string' || !doc.deviceId) doc.deviceId = uid('d_');
  if (!Number.isInteger(doc.activeYear)) doc.activeYear = nowY;
  doc.isDemo = doc.isDemo === true;
  if (doc.savedAt !== null && typeof doc.savedAt !== 'string') doc.savedAt = null;

  const s = (doc.settings && typeof doc.settings === 'object') ? doc.settings : {};
  doc.settings = s;
  if (!THEMES[s.theme]) s.theme = 'auto';
  if (!Number.isInteger(s.dueSoonDays)) s.dueSoonDays = 7;
  s.dueSoonDays = clamp(s.dueSoonDays, 0, 60);
  s.autofillOnPaid = s.autofillOnPaid !== false;
  if (typeof s.syncUrl !== 'string') s.syncUrl = '';
  if (typeof s.syncSecret !== 'string') s.syncSecret = '';
  if (typeof s.lastSyncAt !== 'string') s.lastSyncAt = null;
  if (typeof s.lastExportAt !== 'string') s.lastExportAt = null;
  if (typeof s.installNagDismissedAt !== 'string') s.installNagDismissedAt = null;

  const u = (doc.ui && typeof doc.ui === 'object') ? doc.ui : {};
  doc.ui = u;
  if (!SCREENS[u.screen]) u.screen = 'month';
  if (!Number.isInteger(u.month)) u.month = new Date().getMonth();
  u.month = clamp(u.month, 0, 11);
  if (typeof u.yearTab !== 'string') u.yearTab = 'summary';
  if (typeof u.journalFilter !== 'string') u.journalFilter = 'all';

  if (!doc.years || typeof doc.years !== 'object' || Array.isArray(doc.years)) doc.years = {};
  Object.keys(doc.years).forEach(function (yk) {
    const yr = doc.years[yk];
    if (!yr || typeof yr !== 'object' || Array.isArray(yr)) { delete doc.years[yk]; return; }
    if (!Number.isInteger(yr.year)) yr.year = parseInt(yk, 10) || nowY;
    if (!Array.isArray(yr.catalog)) yr.catalog = [];
    if (!Array.isArray(yr.tx)) yr.tx = [];
    if (!Array.isArray(yr.months)) yr.months = [];
    for (let m = 0; m < 12; m++) {
      const mo = yr.months[m];
      if (!mo || typeof mo !== 'object' || Array.isArray(mo)) yr.months[m] = { m: m, note: '', entries: [] };
      else {
        mo.m = m;
        if (typeof mo.note !== 'string') mo.note = '';
        if (!Array.isArray(mo.entries)) mo.entries = [];
      }
    }
    yr.months.length = 12;

    yr.catalog.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      if (typeof c.name !== 'string') c.name = '';
      if (typeof c.icon !== 'string') c.icon = '';
      if (!Number.isInteger(c.order)) c.order = 0;
      c.recurring = c.recurring !== false;
      c.archived = c.archived === true;
      if (c.dueDay === undefined) c.dueDay = null;
      if (c.goal === undefined) c.goal = null;
      if (typeof c.createdAt !== 'string') c.createdAt = storageStamp();
      if (typeof c.updatedAt !== 'string') c.updatedAt = c.createdAt;
    });
    yr.months.forEach(function (mo) {
      mo.entries.forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        if (e.act === undefined) e.act = null;      // undefined by JSON.stringify zmizelo
        if (e.due === undefined) e.due = null;
        if (e.paidAt === undefined) e.paidAt = null;
        e.paid = e.paid === true;
        e.del = e.del === true;
        e.autoFilled = e.autoFilled === true;
        if (typeof e.updatedAt !== 'string') e.updatedAt = storageStamp();
      });
    });
    yr.tx.forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      if (typeof t.note !== 'string') t.note = '';
      if (t.cat === undefined) t.cat = null;
      t.del = t.del === true;
      if (typeof t.updatedAt !== 'string') t.updatedAt = storageStamp();
    });
  });
  return doc;
}

/* ---------- validace ----------
   JSON.stringify({a:NaN}) tiše vyrobí {"a":null}. NaN se proto musí chytit
   při ZÁPISU, ne až při příštím načtení. Proto saveNow() validuje vždy. */
function validateDoc(doc) {
  const p = [];
  function bad(s) { if (p.length < 60) p.push(s); }
  function amount(v) { return Number.isSafeInteger(v); }
  function dayOk(v) { return v === null || (Number.isInteger(v) && v >= 1 && v <= 31); }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['kořen není objekt'];
  if (!Number.isInteger(doc.schema)) bad('schema není celé číslo');
  if (doc.app !== undefined && doc.app !== 'rozpocet') bad('app není "rozpocet"');
  if (doc.rev !== undefined && !Number.isInteger(doc.rev)) bad('rev není celé číslo');

  const ys = doc.years;
  if (!ys || typeof ys !== 'object' || Array.isArray(ys)) { bad('chybí mapa years'); return p; }

  Object.keys(ys).forEach(function (yk) {
    const yr = ys[yk], at = 'years.' + yk;
    if (!yr || typeof yr !== 'object' || Array.isArray(yr)) { bad(at + ': není objekt'); return; }
    if (!Array.isArray(yr.catalog)) { bad(at + '.catalog není pole'); return; }
    if (!Array.isArray(yr.months) || yr.months.length !== 12) { bad(at + '.months není 12 položek'); return; }
    if (!Array.isArray(yr.tx)) { bad(at + '.tx není pole'); return; }

    const catIds = new Set();
    yr.catalog.forEach(function (c, i) {
      const w = at + '.catalog[' + i + ']';
      if (!c || typeof c !== 'object') { bad(w + ': není objekt'); return; }
      if (typeof c.id !== 'string' || !c.id) bad(w + '.id chybí');
      else if (catIds.has(c.id)) bad(w + '.id je duplicitní: ' + c.id);
      else catIds.add(c.id);
      if (!SECTION_BY_KEY[c.sec]) bad(w + '.sec je neznámá: ' + String(c.sec));
      if (typeof c.name !== 'string') bad(w + '.name není text');
      if (!Number.isInteger(c.order)) bad(w + '.order není celé číslo');
      if (!dayOk(c.dueDay === undefined ? null : c.dueDay)) bad(w + '.dueDay je mimo 1..31');
      if (c.goal !== null && c.goal !== undefined) {
        if (typeof c.goal !== 'object') bad(w + '.goal není objekt');
        else {
          if (!amount(c.goal.target)) bad(w + '.goal.target nejsou celé haléře');
          if (!amount(c.goal.startBalance)) bad(w + '.goal.startBalance nejsou celé haléře');
          if (c.goal.targetDate !== null && c.goal.targetDate !== undefined
              && !parseYmd(c.goal.targetDate)) bad(w + '.goal.targetDate není datum');
        }
      }
    });

    const entryIds = new Set();
    yr.months.forEach(function (mo, m) {
      const wm = at + '.months[' + m + ']';
      if (!mo || typeof mo !== 'object') { bad(wm + ': není objekt'); return; }
      if (mo.m !== m) bad(wm + '.m neodpovídá indexu');
      if (!Array.isArray(mo.entries)) { bad(wm + '.entries není pole'); return; }
      // Dva živé řádky téže kategorie v jednom měsíci = násobené výdaje.
      // effActual dá součet z deníku KAŽDÉMU z nich, takže dvojitý řádek
      // ukáže dvojnásobek toho, co uživatelka utratila.
      const catSeen = new Set();
      mo.entries.forEach(function (e, i) {
        const w = wm + '.entries[' + i + ']';
        if (!e || typeof e !== 'object') { bad(w + ': není objekt'); return; }
        if (typeof e.id !== 'string' || !e.id) bad(w + '.id chybí');
        else if (entryIds.has(e.id)) bad(w + '.id je duplicitní: ' + e.id);
        else entryIds.add(e.id);
        if (typeof e.cat !== 'string' || !e.cat) bad(w + '.cat chybí');
        else if (!e.del) {
          if (catSeen.has(e.cat)) bad(w + ': kategorie ' + e.cat + ' má v tomhle měsíci dva řádky');
          else catSeen.add(e.cat);
        }
        if (e.plan !== null && e.plan !== undefined && !amount(e.plan)) bad(w + '.plan nejsou celé haléře: ' + String(e.plan));
        if (e.act !== null && e.act !== undefined && !amount(e.act)) bad(w + '.act nejsou celé haléře: ' + String(e.act));
        if (!dayOk(e.due === undefined ? null : e.due)) bad(w + '.due je mimo 1..31');
        if (e.paidAt !== null && e.paidAt !== undefined && !parseYmd(e.paidAt)) bad(w + '.paidAt není datum');
      });
    });

    const txIds = new Set();
    yr.tx.forEach(function (t, i) {
      const w = at + '.tx[' + i + ']';
      if (!t || typeof t !== 'object') { bad(w + ': není objekt'); return; }
      if (typeof t.id !== 'string' || !t.id) bad(w + '.id chybí');
      else if (txIds.has(t.id)) bad(w + '.id je duplicitní: ' + t.id);
      else txIds.add(t.id);
      if (!parseYmd(t.d)) bad(w + '.d není datum: ' + String(t.d));
      if (!Number.isInteger(t.m) || t.m < 0 || t.m > 11) bad(w + '.m je mimo 0..11');
      if (!amount(t.amt)) bad(w + '.amt nejsou celé haléře: ' + String(t.amt));
      if (t.cat !== null && t.cat !== undefined && typeof t.cat !== 'string') bad(w + '.cat není text');
    });
  });
  return p;
}

/* ---------- ukládání ---------- */

let saveLastGood = null;     // poslední JSON, o kterém víme, že byl v pořádku
let savePending = false;
let saveBackupAt = 0;
let saveStatus = { ok: true, reason: 'idle', at: null, problems: [] };

function saveIsQuota(e) {
  if (!e) return false;
  const n = e.name || '';
  return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED'
      || e.code === 22 || e.code === 1014;
}

const saveDebounced = debounce(function () { if (savePending) saveNow(); }, 400, 3000);

function scheduleSave() { savePending = true; saveDebounced(); }

// Synchronně, pro pagehide / beforeunload.
function flushSave() {
  // I když savePending zůstal viset po chybě, tohle je poslední pokus.
  if (savePending || !saveStatus.ok) return saveNow();
  return saveStatus;
}

// Selhání zápisu se musí dostat ven. Bez tohohle appka mlčky nic neukládá
// a v Nastavení pořád svítí, že ukládání funguje.
function saveReport() {
  if (!saveStatus.ok && typeof saveProblemNotify === 'function') {
    try { saveProblemNotify(saveStatus); } catch (e) {}
  }
  return saveStatus;
}

function saveNow() {
  // savePending se NESHAZUJE tady. Kdyby ano, po neúspěšném zápisu by
  // debounce ani flushSave() na pagehide už nic nezkusily — právě ve chvíli,
  // kdy je to poslední šance.
  if (!state || typeof state !== 'object') {
    saveStatus = { ok: false, reason: 'nostate', at: Date.now(), problems: [] };
    return saveReport();
  }
  // Po havarijním načtení se do hlavního klíče nesahá, dokud uživatelka nerozhodne.
  if (loadBlocked) {
    saveStatus = { ok: false, reason: 'locked', at: Date.now(), problems: [] };
    return saveReport();
  }
  // Vlastní kontrola si na chvíli sahá do stavu. Po tu dobu se na disk
  // nesmí sáhnout, jinak by tam zůstal její pískovištní rok.
  if (typeof saveSuspended !== 'undefined' && saveSuspended) {
    saveStatus = { ok: true, reason: 'pozastaveno', at: Date.now(), problems: [] };
    return saveStatus;
  }
  const problems = validateDoc(state);
  if (problems.length) {
    saveStatus = { ok: false, reason: 'invalid', at: Date.now(), problems: problems.slice(0, 10) };
    return saveReport();
  }
  state.savedAt = storageStamp();
  let json;
  try { json = JSON.stringify(state); }
  catch (e) { saveStatus = { ok: false, reason: 'stringify', at: Date.now(), problems: [] }; return saveReport(); }

  const prev = saveLastGood;
  let wrote = false, quota = false;
  try { storageSet(STORE_KEY, json); wrote = true; }
  catch (e) {
    if (saveIsQuota(e)) {
      quota = true;
      // Uvolnit se má nejdřív karanténa, snímky až v krajní nouzi — jsou
      // to jediné cesty zpátky. Dřív se z osmi nechaly dva.
      try { quarantinePrune(1); } catch (e2) {}
      try { storageSet(STORE_KEY, json); wrote = true; } catch (e3) { snapshotPrune(5); }
      try { storageSet(STORE_KEY, json); wrote = true; } catch (e2) { wrote = false; }
    }
  }
  if (!wrote) {
    // Data v paměti zůstávají netknutá a nic se nemaže.
    saveStatus = { ok: false, reason: quota ? 'quota' : 'write', at: Date.now(), problems: [] };
    return saveReport();
  }
  // Záloha nese PŘEDCHOZÍ dobrý stav, aby jeden špatný zápis nesebral oba.
  writeBackup(prev || json);
  saveLastGood = json;
  savePending = false;                 // teprve teď je opravdu uloženo
  saveStatus = { ok: true, reason: quota ? 'ok-po-uklidu' : 'ok', at: Date.now(), problems: [] };
  // Povedlo se — pruh o chybě musí zmizet, jinak by strašil i po nápravě.
  if (typeof saveRecovered === 'function') { try { saveRecovered(quota); } catch (e) {} }
  return saveStatus;
}

function writeBackup(json, force) {
  const payload = (typeof json === 'string' && json) ? json : saveLastGood;
  if (!payload) return { ok: false, reason: 'nodata' };
  const now = Date.now();
  if (!force && saveBackupAt && (now - saveBackupAt) < 60000) return { ok: true, reason: 'throttled' };
  try { storageSet(BACKUP_KEY, payload); saveBackupAt = now; return { ok: true, reason: 'ok' }; }
  catch (e) { return { ok: false, reason: saveIsQuota(e) ? 'quota' : 'write' }; }
}

/* ---------- karanténa ---------- */

function quarantineWrite(raw) {
  const key = QUAR_PREFIX + Date.now();
  try { storageSet(key, String(raw)); return key; }
  catch (e) {
    // Snímky jsou cesta zpátky, ubírá se z nich opatrně a až v nouzi.
    try {
      snapshotPrune(4);
      storageSet(key, String(raw));
      return key;
    } catch (e2) { return null; }
  }
}

// Ubere staré odložené kopie, nejnovější nechá být.
function quarantinePrune(keep) {
  const k = Number.isInteger(keep) && keep >= 0 ? keep : 1;
  const list = quarantineList();
  let removed = 0;
  for (let i = k; i < list.length; i++) { storageRemove(list[i].key); removed += 1; }
  return removed;
}

function quarantineList() {
  return storageKeys(QUAR_PREFIX).map(function (key) {
    const v = storageGet(key);
    const at = parseInt(key.slice(QUAR_PREFIX.length), 10);
    return { key: key, at: Number.isFinite(at) ? at : 0, size: v ? v.length : 0 };
  }).sort(function (a, b) { return b.at - a.at; });
}

/* ---------- snapshoty ---------- */

let snapshotSeq = 0;

function snapshotSave(reason, payload) {
  let doc = null;
  if (typeof payload === 'string') { try { doc = JSON.parse(payload); } catch (e) { doc = null; } }
  else if (payload && typeof payload === 'object') doc = payload;
  else doc = state;
  if (!doc || typeof doc !== 'object') return null;

  snapshotSeq += 1;
  const key = SNAP_PREFIX + Date.now() + '-' + snapshotSeq;
  let json;
  try {
    json = JSON.stringify({ at: Date.now(), reason: String(reason || ''), rev: doc.rev | 0,
                            schema: doc.schema, doc: doc });
  } catch (e) { return null; }
  try { storageSet(key, json); }
  catch (e) {
    // Došlo místo. Uvolní se poškozené odložené kopie, ne snímky — ty jsou
    // často jediná cesta zpátky. Teprve když to nestačí, ubere se i ze snímků.
    // Nejnovější odložená kopie zůstává vždycky — je to jediný zbytek
    // původních bajtů. Uvolňují se jen ty starší.
    try { quarantinePrune(1); } catch (e2) {}
    try { storageSet(key, json); }
    catch (e3) {
      snapshotPrune(3);
      try { storageSet(key, json); } catch (e4) { return null; }
    }
  }
  snapshotPrune(8);
  return key;
}

function snapshotList() {
  return storageKeys(SNAP_PREFIX).map(function (key) {
    const s = storageGet(key);
    let at = parseInt(key.slice(SNAP_PREFIX.length), 10);
    let reason = '', rev = 0, ok = false;
    if (s) {
      try {
        const r = JSON.parse(s);
        if (r && typeof r === 'object') {
          ok = !!(r.doc && typeof r.doc === 'object');
          if (Number.isFinite(r.at)) at = r.at;
          reason = typeof r.reason === 'string' ? r.reason : '';
          rev = r.rev | 0;
        }
      } catch (e) { /* poškozený snapshot se jen nepoužije */ }
    }
    // Pořadové číslo z klíče rozhoduje, když dva snímky padnou do stejné
    // milisekundy. Bez toho prořezávání zahodí ten nejnovější.
    const seq = parseInt((key.split('-')[1] || '0'), 10) || 0;
    return { key: key, at: Number.isFinite(at) ? at : 0, seq: seq, reason: reason, rev: rev,
             size: s ? s.length : 0, ok: ok };
  }).sort(function (a, b) { return (b.at - a.at) || (b.seq - a.seq); });   // nejnovější první
}

function snapshotRead(key) {
  const s = storageGet(key);
  if (!s) return null;
  try { const r = JSON.parse(s); return (r && r.doc && typeof r.doc === 'object') ? r.doc : null; }
  catch (e) { return null; }
}

function snapshotPrune(max) {
  const keep = Number.isInteger(max) && max >= 0 ? max : 8;
  const list = snapshotList();
  let removed = 0;
  for (let i = keep; i < list.length; i++) { storageRemove(list[i].key); removed += 1; }
  return removed;
}

// Obnova je sama vratná: nejdřív si odloží současný stav.
function snapshotRestore(key) {
  const doc = snapshotRead(key);
  if (!doc) return { ok: false, reason: 'missing' };
  snapshotSave('pred-obnovou');
  const mig = migrate(doc);
  if (!mig.ok) return { ok: false, reason: mig.reason };
  const problems = validateDoc(mig.doc);
  if (problems.length) return { ok: false, reason: 'invalid', problems: problems.slice(0, 10) };
  state = mig.doc;
  loadBlocked = false;
  saveLastGood = null;
  invalidateAll();
  saveNow();
  return { ok: true, reason: 'ok' };
}

/* ---------- načítání ---------- */

let loadBlocked = false;    // po havárii se do hlavního klíče nezapisuje
let loadReport = null;

function loadParseObj(obj) {
  const mig = migrate(obj);
  if (!mig.ok) return { ok: false, reason: mig.reason, from: mig.from };
  const problems = validateDoc(mig.doc);
  if (problems.length) return { ok: false, reason: 'invalid', problems: problems, from: mig.from };
  return { ok: true, reason: 'ok', doc: mig.doc, from: mig.from, steps: mig.steps };
}

function loadParse(str) {
  let obj;
  try { obj = JSON.parse(String(str)); }
  catch (e) { return { ok: false, reason: 'parse' }; }
  return loadParseObj(obj);
}

function loadUnblock(doSave) {
  loadBlocked = false;
  return doSave ? saveNow() : { ok: true, reason: 'unblocked' };
}

// loadState() -> report. Zároveň nastaví `state`.
// source: 'main' | 'new' | 'backup' | 'snapshot' | 'empty' | 'newer'
function loadState() {
  if (storageReason === 'unprobed') storageProbe();
  const rep = {
    ok: false, source: 'empty', reason: '', problems: [],
    quarantineKey: null, migratedFrom: null, locked: false,
    storage: { ok: storageOk, reason: storageReason }
  };

  const raw = storageGet(STORE_KEY);
  if (raw === null || raw === '') {
    state = emptyDoc();
    saveLastGood = null;
    rep.ok = true; rep.source = 'new'; rep.reason = 'prazdno';
    loadReport = rep;
    return rep;
  }

  let parsed = null, parseOk = true;
  try { parsed = JSON.parse(String(raw)); } catch (e) { parseOk = false; }

  // Snapshot PŘED první migrací — ještě než se čehokoliv dotkneme.
  // Snímek se dělá vždy, když se chystáme dokument změnit — tedy i u
  // souboru bez čísla verze, který se bere jako v1 a projde srovnáním polí.
  if (parseOk && parsed && typeof parsed === 'object'
      && (!Number.isInteger(parsed.schema) || parsed.schema < SCHEMA)) {
    snapshotSave('pred-migraci', raw);
  }

  const first = parseOk ? loadParseObj(parsed) : { ok: false, reason: 'parse' };

  if (first.ok) {
    state = first.doc;
    rep.ok = true; rep.source = 'main'; rep.reason = 'ok';
    rep.migratedFrom = first.from;
    if (first.from === SCHEMA) {
      saveLastGood = String(raw);
    } else {
      saveLastGood = null;
      scheduleSave();                 // zmigrovaný tvar je potřeba uložit
    }
    loadReport = rep;
    return rep;
  }

  // Novější dokument z jiného zařízení: neodmigrujeme ho dozadu a ani na něj nesáhneme.
  if (first.reason === 'newer') {
    // Dokument z novější verze je pořád platná data. Musí se odložit stranou
    // stejně jako poškozený, jinak ho import zálohy nebo vymazání přepíše
    // a všechno, co novější zařízení stihlo zapsat, je pryč.
    rep.quarantineKey = quarantineWrite(String(raw));
    state = emptyDoc();
    loadBlocked = true;
    rep.ok = false; rep.source = 'newer'; rep.reason = 'newer'; rep.locked = true;
    loadReport = rep;
    return rep;
  }

  // Cokoliv jiného je havárie: originál doslova do karantény, nikdy do koše.
  rep.reason = first.reason;
  rep.problems = (first.problems || []).slice(0, 10);
  rep.quarantineKey = quarantineWrite(String(raw));

  const b = storageGet(BACKUP_KEY);
  if (b) {
    const fromBackup = loadParse(b);
    if (fromBackup.ok) { state = fromBackup.doc; rep.ok = true; rep.source = 'backup'; }
  }
  if (!rep.ok) {
    const snaps = snapshotList();
    for (let i = 0; i < snaps.length; i++) {
      const doc = snapshotRead(snaps[i].key);
      if (!doc) continue;
      const fromSnap = loadParseObj(doc);
      if (fromSnap.ok) {
        state = fromSnap.doc; rep.ok = true; rep.source = 'snapshot';
        rep.snapshotKey = snaps[i].key;
        break;
      }
    }
  }
  if (!rep.ok) { state = emptyDoc(); rep.source = 'empty'; }

  // Zamykat ukládání má smysl JEN tehdy, když se poškozený originál
  // nepodařilo nikam odložit. Když je v karanténě, je z čeho vycházet a
  // appka musí dál normálně ukládat — jinak by uživatelka celé týdny psala
  // do prázdna a nikde by se to nedozvěděla.
  loadBlocked = !rep.quarantineKey;
  rep.locked = loadBlocked;
  loadReport = rep;
  return rep;
}
