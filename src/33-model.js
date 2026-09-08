// 33-model.js — stav a mutace, žádné vykreslování, žádný DOM — vlastní: L2
// Každá změna jde přes bump(): orazítkuje záznam, zvedne state.rev a naplánuje uložení.
// Částky jsou vždy celé haléře a vždy KLADNÉ. Směr určuje SECTIONS[sec].dir.

let state = emptyDoc();

/* ---------- jádro ---------- */

function bump(rec) {
  if (rec && typeof rec === 'object') rec.updatedAt = storageStamp();
  state.rev = (state.rev | 0) + 1;
  scheduleSave();
  return rec;
}

/* ---------- vratné kroky ----------
   Zásobník žije jen v paměti (funkce se neserializují), proto visí na
   undoPush a ne na state — jinak by to bylo další jméno navíc. */
undoPush.stack = [];

function undoPush(label, undoFn) {
  if (typeof undoFn !== 'function') return null;
  const item = { label: String(label || ''), fn: undoFn, at: Date.now() };
  undoPush.stack.push(item);
  while (undoPush.stack.length > 20) undoPush.stack.shift();
  return item;
}

function undoLast() {
  const item = undoPush.stack.pop();
  if (!item) return { ok: false, reason: 'empty' };
  try { item.fn(); } catch (e) { return { ok: false, reason: 'error', label: item.label }; }
  return { ok: true, label: item.label };
}

/* ---------- čtení ----------
   getYear() rok v případě potřeby založí (líně, idempotentně, bez bumpu) —
   renderery se nesmí lámat na tom, že se uživatelka přepnula do roku,
   který ještě neexistuje. */

function getYear(y) {
  const key = String(Number.isInteger(y) ? y : state.activeYear);
  let yr = state.years[key];
  if (!yr) { yr = newYear(parseInt(key, 10)); state.years[key] = yr; }
  return yr;
}

function getMonthObj(m, y) {
  const yr = getYear(y);
  const i = clamp(Number.isInteger(m) ? m : state.ui.month, 0, 11);
  let mo = yr.months[i];
  if (!mo || typeof mo !== 'object') { mo = { m: i, note: '', entries: [] }; yr.months[i] = mo; }
  if (!Array.isArray(mo.entries)) mo.entries = [];
  mo.m = i;
  return mo;
}

function getCat(catId, y) {
  const list = getYear(y).catalog;
  for (let i = 0; i < list.length; i++) if (list[i].id === catId) return list[i];
  return null;
}

function getEntry(m, entryId, y) {
  const list = getMonthObj(m, y).entries;
  for (let i = 0; i < list.length; i++) if (list[i].id === entryId) return list[i];
  return null;
}

/* ---------- zakládání ----------
   IDEMPOTENTNÍ. Pětkrát zavolané ensureMonth() musí dát totéž co jednou —
   opakovaně se množící trvalka je jedna z nejhorších možných chyb. */

function ensureEntry(m, catId, y) {
  const mo = getMonthObj(m, y);
  for (let i = 0; i < mo.entries.length; i++) {
    // Smazaný záznam se VRACÍ tak, jak je: náhrobek brání tomu, aby
    // ensureMonth() vzkřísil položku, kterou uživatelka z měsíce vyhodila.
    if (mo.entries[i].cat === catId) return mo.entries[i];
  }
  const cat = getCat(catId, y);
  if (!cat) return null;
  const e = {
    id: uid('e_'), cat: catId, plan: 0, act: null,
    paid: false, paidAt: null, due: null,
    autoFilled: false, del: false, updatedAt: storageStamp()
  };
  mo.entries.push(e);
  bump(e);
  return e;
}

function ensureMonth(y, m) {
  const yr = getYear(y);
  const mo = getMonthObj(m, y);
  for (let i = 0; i < yr.catalog.length; i++) {
    const c = yr.catalog[i];
    if (!c || c.archived || c.recurring === false) continue;
    ensureEntry(mo.m, c.id, y);
  }
  return mo;
}

/* ---------- katalog ----------
   Pořadí je na katalogu, tedy společné pro celý rok — všech dvanáct měsíců
   vypisuje řádky stejně. Krok 10, aby šlo mezi ně vsunout. */

function addCatalogItem(def, scope, y) {
  const d = def || {};
  const yr = getYear(y);
  const sec = SECTION_BY_KEY[d.sec] ? d.sec : 'daily';
  const meta = SECTION_BY_KEY[sec];
  let maxOrder = 0;
  for (let i = 0; i < yr.catalog.length; i++) {
    const c = yr.catalog[i];
    if (c.sec === sec && Number.isInteger(c.order) && c.order > maxOrder) maxOrder = c.order;
  }
  const stamp = storageStamp();
  const cat = {
    id: uid('c_'),
    sec: sec,
    name: String(d.name === undefined || d.name === null ? '' : d.name).trim(),
    icon: typeof d.icon === 'string' ? d.icon : '',
    order: maxOrder + 10,
    recurring: d.recurring !== false,
    dueDay: (meta.hasDue && Number.isInteger(d.dueDay) && d.dueDay >= 1 && d.dueDay <= 31) ? d.dueDay : null,
    goal: null,
    archived: false,
    createdAt: stamp,
    updatedAt: stamp
  };
  yr.catalog.push(cat);

  if (meta.hasGoal && d.goal) setGoal(cat.id, d.goal, y);

  // scope je jediné místo, kde se odpovídá na otázku "a co ostatní měsíce?"
  const base = Number.isInteger(d.month) ? clamp(d.month, 0, 11) : state.ui.month;
  const sc = (scope === 'this' || scope === 'rest' || scope === 'all') ? scope : 'all';
  const from = sc === 'all' ? 0 : base;
  const to = sc === 'this' ? base : 11;
  const plan = Number.isSafeInteger(d.plan) ? Math.abs(d.plan) : 0;
  for (let m = from; m <= to; m++) {
    const e = ensureEntry(m, cat.id, y);
    if (e && plan) { e.plan = plan; bump(e); }
  }
  bump(cat);
  undoPush('Přidání položky', function () { archiveCatalogItem(cat.id, y); });
  return cat;
}

function updateCatalogItem(catId, patch, y) {
  const cat = getCat(catId, y);
  if (!cat || !patch) return null;
  let changed = false;
  if (typeof patch.name === 'string' && patch.name.trim() !== cat.name) { cat.name = patch.name.trim(); changed = true; }
  if (typeof patch.icon === 'string' && patch.icon !== cat.icon) { cat.icon = patch.icon; changed = true; }
  if (patch.recurring !== undefined && (patch.recurring !== false) !== cat.recurring) {
    cat.recurring = patch.recurring !== false; changed = true;
  }
  if (patch.dueDay !== undefined) {
    const ok = SECTION_BY_KEY[cat.sec].hasDue;
    const v = (ok && Number.isInteger(patch.dueDay) && patch.dueDay >= 1 && patch.dueDay <= 31) ? patch.dueDay : null;
    if (v !== cat.dueDay) { cat.dueDay = v; changed = true; }
  }
  if (patch.archived !== undefined && (patch.archived === true) !== cat.archived) {
    cat.archived = patch.archived === true; changed = true;
  }
  if (patch.goal !== undefined) { setGoal(catId, patch.goal, y); }
  if (!changed) return cat;
  return bump(cat);
}

// Měkce. Transakce se NIKDY nemažou kaskádou — peníze zůstanou vidět
// v "nezařazených" (viz orphanTx), nezmizí.
function archiveCatalogItem(catId, y) {
  const cat = getCat(catId, y);
  if (!cat || cat.archived) return cat;
  cat.archived = true;
  bump(cat);
  undoPush('Smazání kategorie', function () {
    const c = getCat(catId, y);
    if (c) { c.archived = false; bump(c); }
  });
  return cat;
}

function reorderSection(sec, orderedIds, y) {
  const yr = getYear(y);
  const ids = Array.isArray(orderedIds) ? orderedIds : [];
  const inSec = yr.catalog.filter(function (c) { return c.sec === sec; });
  const seq = [];
  ids.forEach(function (id) {
    const c = inSec.find(function (x) { return x.id === id; });
    if (c && seq.indexOf(c) < 0) seq.push(c);
  });
  inSec.sort(function (a, b) { return (a.order | 0) - (b.order | 0); })
       .forEach(function (c) { if (seq.indexOf(c) < 0) seq.push(c); });
  let changed = 0;
  seq.forEach(function (c, i) {
    const o = (i + 1) * 10;
    if (c.order !== o) { c.order = o; bump(c); changed += 1; }
  });
  return changed;
}

function setGoal(catId, goal, y) {
  const cat = getCat(catId, y);
  if (!cat) return null;
  if (!SECTION_BY_KEY[cat.sec].hasGoal) return cat;
  if (goal === null || goal === undefined) {
    if (cat.goal === null) return cat;
    cat.goal = null;
    return bump(cat);
  }
  const target = Number.isSafeInteger(goal.target) ? Math.abs(goal.target) : 0;
  const startBalance = Number.isSafeInteger(goal.startBalance) ? Math.abs(goal.startBalance) : 0;
  const targetDate = (typeof goal.targetDate === 'string' && parseYmd(goal.targetDate)) ? goal.targetDate : null;
  const next = { target: target, startBalance: startBalance, targetDate: targetDate };
  if (cat.goal && deepEqual(cat.goal, next)) return cat;
  cat.goal = next;
  return bump(cat);
}

/* ---------- řádky měsíce ---------- */

function setPlanned(m, entryId, minor, y) {
  const e = getEntry(m, entryId, y);
  if (!e) return null;
  // Prázdné pole je "nezadáno", ne nula. Do součtů se stejně počítá jako
  // nula, ale na obrazovce je pomlčka místo sebevědomého 0 Kč.
  if (minor === null || minor === undefined) {
    if (e.plan === null) return e;
    e.plan = null;
    return bump(e);
  }
  const v = Number.isSafeInteger(minor) ? Math.abs(minor) : null;
  if (v === null) return null;               // NaN ani string se do dokumentu nedostane
  if (e.plan === v) return e;
  e.plan = v;
  return bump(e);
}

// null = "počítej z deníku". Číslo = ruční zápis, ten vyhrává.
// Sčítat se nesmí NIKDY: ruční 300 a deník 250 dá 250 nebo 300, ne 550.
function setActual(m, entryId, minor, y) {
  const e = getEntry(m, entryId, y);
  if (!e) return null;
  if (minor === null || minor === undefined) {
    if (e.act === null && e.autoFilled === false) return e;
    e.act = null; e.autoFilled = false;
    return bump(e);
  }
  if (!Number.isSafeInteger(minor)) return null;
  const v = Math.abs(minor);
  if (e.act === v && e.autoFilled === false) return e;
  e.act = v; e.autoFilled = false;
  return bump(e);
}

function clearActual(m, entryId, y) { return setActual(m, entryId, null, y); }

function togglePaid(m, entryId, want, y) {
  const e = getEntry(m, entryId, y);
  if (!e) return null;
  const to = (want === undefined || want === null) ? !e.paid : !!want;
  if (to === !!e.paid) return e;
  e.paid = to;
  if (to) {
    e.paidAt = todayISO();
    // Doplnit smí jen do prázdného pole a musí si to označit, jinak by po
    // odškrtnutí zůstalo strašidelné číslo, které nikdo nezadal.
    // A hlavně NESMÍ přepsat skutečnost dopočítanou z deníku: act === null
    // znamená "počítej z nákupů", takže když nějaké nákupy jsou, je to
    // reálná útrata a plán by ji přebil. Zaplaceno je stav platby, ne částka.
    let zDeniku = 0;
    try { zDeniku = (typeof txByCat === 'function') ? (txByCat(y || state.activeYear, m).get(e.cat) || 0) : 0; }
    catch (err) { zDeniku = 0; }
    if (state.settings.autofillOnPaid && e.act === null && zDeniku === 0
        && Number.isSafeInteger(e.plan) && e.plan > 0) {
      e.act = e.plan; e.autoFilled = true;
    }
  } else {
    e.paidAt = null;
    if (e.autoFilled) { e.act = null; e.autoFilled = false; }
  }
  return bump(e);
}

function setEntryDue(m, entryId, day, y) {
  const e = getEntry(m, entryId, y);
  if (!e) return null;
  const v = (day === null || day === undefined) ? null
          : (Number.isInteger(day) && day >= 1 && day <= 31 ? day : null);
  if (e.due === v) return e;
  e.due = v;
  return bump(e);
}

// Měkce, nikdy splice. scope: 'this' | 'rest' | 'all'.
function removeEntry(m, entryId, scope, y) {
  const e0 = getEntry(m, entryId, y);
  if (!e0) return null;
  const catId = e0.cat;
  const cat = getCat(catId, y);
  const base = clamp(Number.isInteger(m) ? m : state.ui.month, 0, 11);
  const sc = (scope === 'rest' || scope === 'all') ? scope : 'this';
  const from = sc === 'all' ? 0 : base;
  const to = sc === 'this' ? base : 11;

  const hidden = [];      // existující řádky, které jen zmizely
  const created = [];     // náhrobky, aby ensureMonth() trvalku nevzkřísil
  for (let i = from; i <= to; i++) {
    const mo = getMonthObj(i, y);
    let e = null;
    for (let k = 0; k < mo.entries.length; k++) if (mo.entries[k].cat === catId) { e = mo.entries[k]; break; }
    if (!e) {
      if (i === base || !cat || cat.recurring === false) continue;
      e = ensureEntry(i, catId, y);
      if (!e) continue;
      created.push({ mo: mo, e: e });
    } else if (e.del) {
      continue;
    } else {
      hidden.push(e);
    }
    e.del = true;
    bump(e);
  }
  const archived = (sc === 'all' && cat && !cat.archived);
  if (archived) { cat.archived = true; bump(cat); }

  undoPush('Smazání položky', function () {
    hidden.forEach(function (e) { e.del = false; bump(e); });
    created.forEach(function (rec) {
      const i = rec.mo.entries.indexOf(rec.e);
      if (i >= 0) rec.mo.entries.splice(i, 1);   // ruší se jen to, co vzniklo teď
    });
    if (archived) { const c = getCat(catId, y); if (c) { c.archived = false; bump(c); } }
    bump(null);
  });
  return e0;
}

/* ---------- deník ----------
   addTx() do entry.act NIKDY nezapisuje. Řádek si skutečnost dopočítá sám
   přes effActual(), dokud má act === null. */

function addTx(def, y) {
  const d = def || {};
  const yr = getYear(y);
  const iso = (typeof d.d === 'string' && parseYmd(d.d)) ? d.d : todayISO();
  const p = parseYmd(iso);
  const m = Number.isInteger(d.m) ? clamp(d.m, 0, 11) : p.m;
  if (!Number.isSafeInteger(d.amt)) return null;
  const catId = (typeof d.cat === 'string' && d.cat) ? d.cat : null;
  const tx = {
    id: uid('t_'), d: iso, m: m, cat: catId,
    amt: Math.abs(d.amt),
    note: typeof d.note === 'string' ? d.note : '',
    del: false, updatedAt: storageStamp()
  };
  yr.tx.push(tx);
  // Aby peníze byly hned vidět i na měsíci, ne jen v deníku. Smazaný řádek
  // se ale nekřísí — uživatelka ho vyhodila schválně a peníze se ukážou
  // mezi nezařazenými.
  if (catId) {
    const cat = getCat(catId, y);
    if (cat && !cat.archived) ensureEntry(m, catId, y);
  }
  bump(tx);
  undoPush('Zápis do deníku', function () { removeTx(tx.id, y); });
  return tx;
}

function updateTx(txId, patch, y) {
  const yr = getYear(y);
  let tx = null;
  for (let i = 0; i < yr.tx.length; i++) if (yr.tx[i].id === txId) { tx = yr.tx[i]; break; }
  if (!tx || !patch) return null;
  let changed = false;

  if (typeof patch.d === 'string' && parseYmd(patch.d) && patch.d !== tx.d) {
    const old = parseYmd(tx.d);
    const followed = !!old && old.m === tx.m;   // měsíc dosud nebyl ručně přehozený
    tx.d = patch.d;
    if (patch.m === undefined && followed) tx.m = parseYmd(patch.d).m;
    changed = true;
  }
  if (Number.isInteger(patch.m)) {
    const v = clamp(patch.m, 0, 11);
    if (v !== tx.m) { tx.m = v; changed = true; }
  }
  if (patch.cat !== undefined) {
    const v = (typeof patch.cat === 'string' && patch.cat) ? patch.cat : null;
    if (v !== tx.cat) {
      tx.cat = v; changed = true;
      if (v) { const c = getCat(v, y); if (c && !c.archived) ensureEntry(tx.m, v, y); }
    }
  }
  if (patch.amt !== undefined) {
    if (!Number.isSafeInteger(patch.amt)) return null;
    const v = Math.abs(patch.amt);
    if (v !== tx.amt) { tx.amt = v; changed = true; }
  }
  if (typeof patch.note === 'string' && patch.note !== tx.note) { tx.note = patch.note; changed = true; }
  // Vrácení smazaného zápisu bez toho, aby se sahalo na zásobník undo.
  if (patch.del !== undefined && (patch.del === true) !== tx.del) {
    tx.del = patch.del === true;
    changed = true;
    if (!tx.del && tx.cat) {
      const c = getCat(tx.cat, y);
      if (c && !c.archived) ensureEntry(tx.m, tx.cat, y);
    }
  }
  if (!changed) return tx;
  return bump(tx);
}

function removeTx(txId, y) {
  const yr = getYear(y);
  let tx = null;
  for (let i = 0; i < yr.tx.length; i++) if (yr.tx[i].id === txId) { tx = yr.tx[i]; break; }
  if (!tx || tx.del) return tx;
  tx.del = true;                       // měkce, nikdy splice
  bump(tx);
  undoPush('Smazání zápisu', function () {
    const t = tx; if (t) { t.del = false; bump(t); }
  });
  return tx;
}

/* ---------- nastavení ---------- */

function setSetting(key, value) {
  const s = state.settings;
  if (!s || !Object.prototype.hasOwnProperty.call(s, key)) return null;
  let v = value;
  if (key === 'theme') { if (['auto', 'light', 'dark'].indexOf(v) < 0) return null; }
  else if (key === 'dueSoonDays') { if (!Number.isInteger(v)) return null; v = clamp(v, 0, 60); }
  else if (key === 'autofillOnPaid' || key === 'welcomeDone') { v = v === true; }
  else if (key === 'syncUrl' || key === 'syncSecret') { v = String(v === undefined || v === null ? '' : v); }
  else { if (v !== null && typeof v !== 'string') return null; }
  if (s[key] === v) return s;
  s[key] = v;
  bump(null);
  return s;
}
