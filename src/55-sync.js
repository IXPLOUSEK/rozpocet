// 55-sync.js — volitelná synchronizace přes Google Apps Script — vlastní: L12
//
// VYPNUTO, DOKUD NENÍ VYPLNĚNÁ ADRESA I HESLO. Když syncOn() vrátí false,
// tenhle soubor neudělá ani jeden fetch, nezaloží časovač ani posluchače.
// Je to jediné místo v celé aplikaci, kde se sahá na síť (železné pravidlo 7).
//
// Přenos je daný serverem (sync/PROTOKOL.md):
//   POST, jediná hlavička Content-Type: text/plain;charset=utf-8. Žádná vlastní
//   hlavička — jinak prohlížeč pošle preflight OPTIONS a Apps Script na něj
//   neumí odpovědět. Heslo cestuje jen v těle, nikdy v hlavičce ani v adrese.
//   cache:'no-store' je povinný: Safari umí u cachovaného přesměrování mezi
//   originy zahodit CORS hlavičky a /exec vždy přesměrovává na
//   script.googleusercontent.com, proto redirect:'follow'.
//   Server odpovídá VŽDY HTTP 200 a chyby píše do těla jako {ok:false, code},
//   protože ContentService neumí nastavit stavový kód. Na response.status se
//   tedy nikdy nevětví; větví se na ok a code. Co není JSON, je Googlí HTML
//   stránka (přihlášení nebo chyba nasazení) — a to je vlastní druh chyby.
//
// Nová jména na nejvyšší úrovni jsou zakázaná (src/_CONTRACT.md), stav i
// pomocníci proto visí na vlastních funkcích — stejně jako undoPush.stack.

/* ---------- zapnuto? ---------- */

// Jediná brána. Volá ji každý vstupní bod dřív, než se cokoliv stane.
function syncOn() {
  const s = state && state.settings;
  if (!s) return false;
  const url = typeof s.syncUrl === 'string' ? s.syncUrl.trim() : '';
  const secret = typeof s.syncSecret === 'string' ? s.syncSecret.trim() : '';
  if (!url || !secret) return false;         // prázdné nastavení = nulová síť
  return /^https:\/\/\S+$/i.test(url);
}

// Stav klienta. Serverová revize je něco jiného než doc.rev, drží se zvlášť.
syncOn.st = {
  baseRev: null,   // serverová revize, ze které lokální dokument vychází; null = neznámá
  base: null,      // poslední společná verze dokumentu (jen v paměti, na jednu relaci)
  status: 'idle',  // idle | busy | ok | err
  note: '',        // hotová česká věta poslední chyby
  busy: false,
  again: false,    // přišel požadavek, když se právě synchronizovalo
  timer: 0,        // debounce automatického odeslání
  pending: null,   // stažený dokument čekající, až uživatelka dopíše
  pushedRev: -1,   // doc.rev, který už na serveru je — proti prázdným odesláním
  armed: false,    // posluchače na automatické odesílání jsou navázané
};

// Automatika se navazuje AŽ po prvním úspěšném spojení. Dokud je synchronizace
// vypnutá, nemá aplikace kvůli ní ani jeden posluchač ani časovač.
syncOn.arm = function () {
  const S = syncOn.st;
  if (S.armed || !syncOn()) return;
  const app = qs('#app');
  if (!app) return;
  S.armed = true;
  // focusout = hotová úprava částky, change = přepínač nebo výběr.
  app.addEventListener('focusout', function () { syncPush(false); });
  app.addEventListener('change', function () { syncPush(false); });
};

/* ---------- přenos ---------- */

syncOn.io = {
  // Jediné místo v celé aplikaci, kde se sahá na síť.
  // payload === null je zdvořilostní GET: server ho zvládne bez hesla, takže
  // se adresa dá ověřit i prostým vložením do prohlížeče.
  async send(url, payload, ms) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, ms || 20000);
    const opts = {
      method: payload ? 'POST' : 'GET',
      redirect: 'follow',       // /exec vždy přesměrovává na googleusercontent
      cache: 'no-store',        // jinak Safari u cachovaného přesměrování ztratí CORS
      credentials: 'omit',
      signal: ctl.signal,
    };
    if (payload) {
      // Jediná hlavička. Cokoliv navíc si vyžádá preflight OPTIONS a na ten
      // Apps Script neumí odpovědět. Heslo je uvnitř těla, ne v hlavičce.
      opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
      opts.body = JSON.stringify(payload);
    }
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      clearTimeout(t);
      return syncOn.io.parse(text);
    } catch (e) {
      clearTimeout(t);
      return syncOn.io.fail(e, ctl.signal.aborted);
    }
  },

  get(url, ms) { return syncOn.io.send(url, null, ms); },
  post(url, payload, ms) { return syncOn.io.send(url, payload, ms); },

  // Odpověď se posuzuje podle těla, nikdy podle stavového kódu.
  parse(text) {
    const s = String(text === null || text === undefined ? '' : text).trim();
    if (!s) return { ok: false, code: 'empty', note: 'Server neposlal žádnou odpověď. Nasaď skript znovu jako novou verzi.' };
    if (s.charAt(0) !== '{' && s.charAt(0) !== '[') return { ok: false, code: 'html', note: syncOn.io.HTML_NOTE };
    let data = null;
    try { data = JSON.parse(s); } catch (e) { return { ok: false, code: 'html', note: syncOn.io.HTML_NOTE }; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, code: 'html', note: syncOn.io.HTML_NOTE };
    }
    if (data.ok === true) return { ok: true, code: 'ok', data: data };
    const code = typeof data.code === 'number' ? data.code : String(data.code || 'error');
    return { ok: false, code: code, note: syncOn.io.czech(code), data: data };
  },

  HTML_NOTE: 'Adresa vrátila webovou stránku Googlu, ne data. V Apps Scriptu nasaď skript jako webovou aplikaci se spouštěním „Já“ a přístupem „Kdokoli“ a použij adresu končící /exec.',

  czech(code) {
    if (code === 400) return 'Server požadavku nerozuměl. Nahraj do Apps Scriptu aktuální verzi skriptu.';
    if (code === 401) return 'Chyba: špatné heslo';
    if (code === 409) return 'Data se mezitím změnila na jiném zařízení.';
    if (code === 413) return 'Rozpočet je na tabulku moc velký. Ulož si zálohu a ubereš starý rok.';
    if (code === 422) return 'Server data odmítl, neodpovídají očekávanému tvaru. Data v telefonu zůstávají.';
    if (code === 500) return 'Skript hlásí chybu na straně Googlu. Zkus to za chvíli, v telefonu je všechno v pořádku.';
    if (code === 503) return 'Tabulka je právě zaneprázdněná. Zkusím to znovu.';
    return 'Server odmítl požadavek.';
  },

  // Fetch hází TypeError na síť i na CORS a nerozliší je. Rozliší se to výš:
  // syncTest pošle nejdřív GET, takže ví, jestli se server vůbec ozval.
  fail(e, aborted) {
    if (aborted || (e && e.name === 'AbortError')) {
      return { ok: false, code: 'timeout', note: 'Server neodpověděl včas. Zkus to prosím znovu.' };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: false, code: 'offline', note: 'Jsi bez internetu. Data zůstávají v telefonu, pošlu je později.' };
    }
    return { ok: false, code: 'net', note: 'Nepodařilo se spojit' };
  },

  // Zapíše chybu do stavu a vrátí ji ve tvaru, který vrací i veřejné funkce.
  say(res) {
    const S = syncOn.st;
    S.status = 'err';
    S.note = res.note || 'Nepodařilo se spojit';
    patchSyncStatus();
    return { ok: false, code: res.code, text: S.note };
  },
};

/* ---------- vyzkoušení spojení ---------- */

// Nejdřív holý GET (zdravotní stav, bez hesla), pak ping s heslem.
// Vrací { ok, code, text } — text je česká věta rovnou k zobrazení.
async function syncTest(url, secret) {
  const u = String(url === null || url === undefined ? '' : url).trim();
  const k = String(secret === null || secret === undefined ? '' : secret).trim();
  if (!u) return { ok: false, code: 'url', text: 'Vyplň adresu webové aplikace. Získáš ji v Apps Scriptu po nasazení.' };
  if (!/^https:\/\//i.test(u)) return { ok: false, code: 'url', text: 'Adresa musí začínat https:// — zkopíruj ji celou z Apps Scriptu.' };
  if (!/\/exec(\?|$)/.test(u)) return { ok: false, code: 'url', text: 'Adresa musí končit /exec. Adresa s /dev funguje jen tobě přihlášené.' };
  if (!k) return { ok: false, code: 'secret', text: 'Vyplň heslo. Je to hodnota SYNC_SECRET ve vlastnostech skriptu.' };
  if (k.length < 32) return { ok: false, code: 'secret', text: 'Heslo musí mít aspoň 32 znaků, kratší skript odmítne.' };

  const health = await syncOn.io.get(u, 20000);
  if (!health.ok) {
    if (health.code === 'net') return { ok: false, code: 'net', text: 'Nepodařilo se spojit. Zkontroluj internet a adresu.' };
    return { ok: false, code: health.code, text: health.note };
  }
  if (!health.data || health.data.app !== 'rozpocet-sync') {
    return { ok: false, code: 'other', text: 'Na téhle adrese odpovídá něco jiného než synchronizace Rozpočtu.' };
  }

  const ping = await syncOn.io.post(u, { secret: k, op: 'ping' }, 20000);
  if (!ping.ok) {
    if (ping.code === 401) return { ok: false, code: 401, text: 'Heslo nesouhlasí. Musí přesně odpovídat vlastnosti SYNC_SECRET ve skriptu.' };
    // GET prošel, POST ne — server žije, blokuje to prohlížeč.
    if (ping.code === 'net') {
      return { ok: false, code: 'cors', text: 'Prohlížeč spojení zablokoval (CORS). Nasaď skript znovu jako novou verzi webové aplikace s přístupem „Kdokoli“.' };
    }
    return { ok: false, code: ping.code, text: ping.note };
  }
  const rev = health.data.rev | 0;
  const uloz = health.data.hasDoc ? (' Na serveru je uložený rozpočet (revize ' + rev + ').') : ' Na serveru zatím nic není.';
  return { ok: true, code: 'ok', text: 'Spojení funguje a heslo sedí.' + uloz, rev: rev, hasDoc: !!health.data.hasDoc };
}

/* ---------- stažení ---------- */

async function syncPull() {
  if (!syncOn()) return { ok: false, code: 'off', text: 'Vypnuto' };
  const S = syncOn.st;
  if (S.busy) return { ok: false, code: 'busy', text: 'Právě synchronizuji.' };
  S.busy = true; S.status = 'busy'; patchSyncStatus();
  try { return await syncPull.once(); }
  finally { S.busy = false; if (S.status === 'busy') S.status = 'ok'; patchSyncStatus(); }
}

syncPull.once = async function () {
  const S = syncOn.st, s = state.settings;
  const res = await syncOn.io.post(s.syncUrl.trim(), { secret: s.syncSecret, op: 'pull' }, 45000);
  if (!res.ok) return syncOn.io.say(res);
  const rev = res.data.rev | 0;
  const remote = res.data.doc;
  if (remote === null || remote === undefined) {
    S.baseRev = rev; S.base = null; S.status = 'ok'; S.note = '';
    return { ok: true, code: 'empty', text: 'Na serveru zatím nic není.' };
  }
  if (S.baseRev !== null && rev === S.baseRev) {
    S.status = 'ok'; S.note = '';
    return { ok: true, code: 'same', text: 'Nic nového.' };
  }
  // Plná pojistka PŘED jakoukoliv změnou. Vrátit se dá i to, co se nepovedlo.
  snapshotSave('pred-synchronizaci');
  return await syncPull.absorb(remote, rev);
};

// Sloučí stažený dokument s tím naším a použije ho. Konflikty se ptají.
syncPull.absorb = async function (remote, rev) {
  const S = syncOn.st;
  const merged = syncMerge(remote, state);
  if (merged.conflicts.length) {
    const answered = await syncMerge.ask(merged.conflicts);
    if (!answered) return { ok: false, code: 'cancel', text: 'Slučování jsi zrušila, nic se nezměnilo.' };
    syncMerge.settle(merged.conflicts);
  }
  // Nikdy nepřepisovat rozepsané pole (železné pravidlo 6).
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
    S.pending = { doc: merged.doc, rev: rev };
    document.addEventListener('focusout', syncPull.flush, { once: true });
    return { ok: true, code: 'deferred', text: 'Nová data použiju, jakmile dopíšeš.' };
  }
  return syncPull.commit(merged.doc, rev);
};

// Posluchač se zakládá až ve chvíli, kdy je co použít, a hned se zase ruší.
syncPull.flush = function () {
  const S = syncOn.st, p = S.pending;
  S.pending = null;
  if (!p) return;
  syncPull.commit(p.doc, p.rev);
  syncPush(false);                     // co jsme mezitím napsali, pošli dál
};

syncPull.commit = function (doc, rev) {
  const S = syncOn.st;
  const rep = loadParseObj(doc);       // migrace + validace, nesmysl se nepoužije
  if (!rep.ok) {
    S.status = 'err';
    S.note = 'Stažená data neodpovídají očekávanému tvaru, zůstala tvoje.';
    patchSyncStatus();
    return { ok: false, code: 'invalid', text: S.note };
  }
  // Připojovací údaje, obrazovka a identita zařízení zůstávají místní.
  const keepSettings = state.settings, keepUi = state.ui;
  const keepDevice = state.deviceId, keepYear = state.activeYear;
  state = rep.doc;
  state.settings = keepSettings;
  state.ui = keepUi;
  state.deviceId = keepDevice;
  if (state.years[String(keepYear)]) state.activeYear = keepYear;
  state.rev = (state.rev | 0) + 1;
  S.baseRev = rev;
  S.base = storageClone(doc);
  S.status = 'ok'; S.note = '';
  setSetting('lastSyncAt', storageStamp());
  syncOn.arm();
  invalidateAll();
  saveNow();
  renderApp();
  return { ok: true, code: 'applied', text: 'Data jsou sladěná.' };
};

/* ---------- odeslání ---------- */

// manual = true pošle hned. Jinak se počká ~750 ms po poslední změně.
// Lokální ukládání na tomhle nezávisí, to běží samo a okamžitě.
function syncPush(manual) {
  const S = syncOn.st;
  if (!syncOn()) return Promise.resolve({ ok: false, code: 'off', text: 'Vypnuto' });
  if (S.timer) { clearTimeout(S.timer); S.timer = 0; }
  if (!manual) {
    S.timer = setTimeout(function () { S.timer = 0; syncPush.run(false); }, 750);
    return Promise.resolve({ ok: true, code: 'planned' });
  }
  return syncPush.run(true);
}

syncPush.run = async function (loud) {
  const S = syncOn.st;
  if (!syncOn()) return { ok: false, code: 'off', text: 'Vypnuto' };
  if (S.busy) { S.again = true; return { ok: false, code: 'busy', text: 'Právě synchronizuji.' }; }
  S.busy = true; S.status = 'busy'; patchSyncStatus();
  try {
    // Automatika po každém focusout: co se nezměnilo, se neposílá.
    if (!loud && S.baseRev !== null && S.pushedRev === (state.rev | 0)) {
      return { ok: true, code: 'nochange', text: 'Nic nového k odeslání.' };
    }
    // Neznámá základní revize (start aplikace, nejistý zápis) = nejdřív stáhnout.
    if (S.baseRev === null) {
      const pulled = await syncPull.once();
      if (!pulled.ok) return pulled;
      if (pulled.code === 'deferred') return pulled;
    }
    return await syncPush.once(loud, { merge: 0, lock: 0 });
  } finally {
    S.busy = false;
    if (S.status === 'busy') S.status = 'ok';
    patchSyncStatus();
    if (S.again) { S.again = false; syncPush(false); }
  }
};

syncPush.once = async function (loud, tries) {
  const S = syncOn.st, s = state.settings;
  const doc = syncPush.clean(state);
  const res = await syncOn.io.post(s.syncUrl.trim(),
    { secret: s.syncSecret, op: 'push', baseRev: S.baseRev | 0, doc: doc }, 45000);

  if (res.ok) {
    S.baseRev = res.data.rev | 0;
    S.base = doc;                      // na tomhle jsme se právě shodli
    S.status = 'ok'; S.note = '';
    setSetting('lastSyncAt', storageStamp());
    S.pushedRev = state.rev | 0;
    syncOn.arm();
    patchSyncStatus();
    return { ok: true, code: 'ok', rev: S.baseRev, text: 'Uloženo na server.' };
  }

  // Někdo zapsal dřív. Server posílá svůj dokument, sloučíme a zkusíme jednou znovu.
  if (res.code === 409 && tries.merge === 0) {
    tries.merge = 1;
    const rev = res.data && (res.data.rev | 0);
    const remote = res.data && res.data.doc;
    if (!remote) { S.baseRev = null; return syncOn.io.say(res); }
    snapshotSave('pred-slucenim');
    const absorbed = await syncPull.absorb(remote, rev);
    if (!absorbed.ok) return absorbed;
    if (absorbed.code === 'deferred') return absorbed;   // pošle se po focusout
    return await syncPush.once(loud, tries);
  }

  // Zámek tabulky. Odstup s náhodným přídavkem, nejvýš třikrát.
  if (res.code === 503 && tries.lock < 3) {
    const wait = 1000 * Math.pow(2, tries.lock) + Math.floor(Math.random() * 500);
    tries.lock += 1;
    await new Promise(function (r) { setTimeout(r, wait); });
    return await syncPush.once(loud, tries);
  }

  if (res.code === 401) {
    S.status = 'err'; S.note = 'Chyba: špatné heslo';
    patchSyncStatus();
    return { ok: false, code: 401, text: 'Heslo nesouhlasí. Oprav ho v nastavení, dokud to neuděláš, nic neodesílám.' };
  }

  // Po síti nebo timeoutu nevíme, jestli zápis prošel. Příště se nejdřív stahuje.
  if (res.code === 'net' || res.code === 'timeout' || res.code === 'offline') S.baseRev = null;
  return syncOn.io.say(res);
};

// Heslo ani adresa nikdy neopustí telefon — ani v kopii dokumentu.
syncPush.clean = function (doc) {
  const copy = storageClone(doc);
  if (copy && copy.settings) { copy.settings.syncSecret = ''; copy.settings.syncUrl = ''; }
  return copy;
};

/* ---------- slučování ----------
   Po záznamech, nikdy hodinami zařízení přes celý dokument. Mazání je měkké,
   proto ho slučování vidí. Vrací { doc, conflicts } a nesahá na DOM. */

function syncMerge(remote, local) {
  const out = storageClone(local) || {};
  const conflicts = [];
  const R = (remote && typeof remote === 'object') ? remote : {};
  const base = syncOn.st.base;
  const since = (local && local.settings && typeof local.settings.lastSyncAt === 'string')
    ? local.settings.lastSyncAt : '';
  if (!out.years || typeof out.years !== 'object') out.years = {};
  const keys = Object.create(null);
  Object.keys(R.years || {}).forEach(function (k) { keys[k] = 1; });
  Object.keys(out.years).forEach(function (k) { keys[k] = 1; });

  Object.keys(keys).sort().forEach(function (key) {
    const ry = (R.years || {})[key];
    if (!ry || typeof ry !== 'object') return;              // rok jen u nás
    if (!out.years[key]) { out.years[key] = storageClone(ry); return; }   // rok jen na serveru
    const ly = out.years[key];
    // Rok, kterému u nás chybí část struktury, se doplní z té cizí kopie.
    if (!Array.isArray(ly.catalog)) ly.catalog = storageClone(ry.catalog) || [];
    if (!Array.isArray(ly.tx)) ly.tx = storageClone(ry.tx) || [];
    if (!Array.isArray(ly.months)) ly.months = storageClone(ry.months) || [];
    const by = (base && base.years) ? base.years[key] : null;
    const ctx = { year: +key, m: null, since: since, cat: Object.create(null) };
    (ly.catalog || []).forEach(function (c) { if (c && c.id) ctx.cat[c.id] = c; });
    (ry.catalog || []).forEach(function (c) { if (c && c.id && !ctx.cat[c.id]) ctx.cat[c.id] = c; });

    syncMerge.list(ly.catalog, ry.catalog, by && by.catalog, 'cat', ctx, conflicts);
    for (let m = 0; m < 12; m++) {
      const lm = (ly.months || [])[m], rm = (ry.months || [])[m];
      if (!rm) continue;
      if (!lm) { ly.months[m] = storageClone(rm); continue; }
      if (!lm.note && rm.note) lm.note = rm.note;
      const bm = by && by.months ? by.months[m] : null;
      ctx.m = m;
      syncMerge.list(lm.entries, rm.entries, bm && bm.entries, 'entry', ctx, conflicts);
    }
    ctx.m = null;
    syncMerge.list(ly.tx, ry.tx, by && by.tx, 'tx', ctx, conflicts);
  });
  return { doc: out, conflicts: conflicts };
}

// Dva seznamy podle id. Co přibylo jen na jedné straně, zůstává oběma.
syncMerge.list = function (mine, theirs, baseList, kind, ctx, conflicts) {
  if (!Array.isArray(mine) || !Array.isArray(theirs)) return;
  const index = function (arr) {
    const map = Object.create(null);
    if (Array.isArray(arr)) for (let i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id) map[arr[i].id] = arr[i];
    }
    return map;
  };
  const mineIdx = index(mine), baseIdx = index(baseList);
  for (let i = 0; i < theirs.length; i++) {
    const b = theirs[i];
    if (!b || !b.id) continue;
    const a = mineIdx[b.id];
    if (!a) { mine.push(storageClone(b)); continue; }
    syncMerge.pair(a, b, baseIdx[b.id] || null, kind, ctx, conflicts);
  }
};

syncMerge.pair = function (a, b, base, kind, ctx, conflicts) {
  if (deepEqual(a, b)) return;
  const au = typeof a.updatedAt === 'string' ? a.updatedAt : '';
  const bu = typeof b.updatedAt === 'string' ? b.updatedAt : '';
  // Se známou společnou verzí se pozná, kdo sáhl kam. Bez ní se použije
  // čas posledního sladění: co je novější, to vzniklo po něm.
  const aCh = base ? !deepEqual(a, base) : (au > ctx.since);
  const bCh = base ? !deepEqual(b, base) : (bu > ctx.since);
  if (!aCh && bCh) { syncMerge.copy(a, b, null); return; }   // změnil jen server
  if (aCh && !bCh) return;                                   // změnili jsme jen my

  // Smazání proti úpravě: ptát se, ve výchozím stavu data zůstávají.
  const flag = kind === 'cat' ? 'archived' : 'del';
  const aDel = a[flag] === true, bDel = b[flag] === true;
  if (aDel !== bDel) {
    conflicts.push(syncMerge.mark(a, aDel, bDel, flag, kind, ctx, aDel ? 'remote' : 'local'));
    if (aDel) syncMerge.copy(a, b, [flag]);                  // vzkřísit i obsah
    a[flag] = false;
    return;
  }

  const money = kind === 'entry' ? ['plan', 'act'] : (kind === 'tx' ? ['amt'] : []);
  let asked = false;
  for (let i = 0; i < money.length; i++) {
    const f = money[i];
    if (a[f] === b[f]) continue;
    conflicts.push(syncMerge.mark(a, a[f], b[f], f, kind, ctx, 'local'));
    asked = true;
  }
  // Částky se nikdy nehádají. Zbytek záznamu vezme novější strana.
  if (bu > au) syncMerge.copy(a, b, asked ? money : null);
};

// Přepíše a hodnotami z b. `skip` chrání pole, o kterých rozhodne uživatelka.
syncMerge.copy = function (a, b, skip) {
  for (const k in b) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
    if (k === 'id') continue;
    if (skip && skip.indexOf(k) >= 0) continue;
    a[k] = storageClone(b[k]);
  }
};

// Konflikt drží živý odkaz na záznam ve sloučeném dokumentu, takže se
// odpověď zapíše přesně tam, odkud otázka přišla.
syncMerge.mark = function (rec, mine, theirs, field, kind, ctx, choice) {
  const cat = ctx.cat[rec.cat] || ctx.cat[rec.id] || null;
  const name = cat && cat.name ? cat.name : (kind === 'tx' ? 'Zápis v deníku' : 'Položka');
  const kdy = ctx.m === null ? String(ctx.year) : monthLabelCs(ctx.year, ctx.m);
  const co = field === 'plan' ? 'plán' : (field === 'act' ? 'skutečnost'
    : (field === 'amt' ? 'částka' : 'smazání'));
  const money = field === 'plan' || field === 'act' || field === 'amt';
  return {
    rec: rec, id: rec.id, field: field,
    kind: money ? 'amount' : 'delete',
    year: ctx.year, m: ctx.m,
    label: name + ' · ' + kdy + ' · ' + co,
    local: mine, remote: theirs,
    localText: money ? formatCzk(mine) : (mine ? 'smazat' : 'nechat'),
    remoteText: money ? formatCzk(theirs) : (theirs ? 'smazat' : 'nechat'),
    choice: choice || 'local',
  };
};

// Zapíše zvolené hodnoty. Bez volání zůstává výchozí (bezpečná) varianta.
syncMerge.settle = function (conflicts) {
  (conflicts || []).forEach(function (c) {
    if (!c || !c.rec) return;
    c.rec[c.field] = c.choice === 'remote' ? c.remote : c.local;
  });
  return conflicts;
};

// Malý panel s otázkami. Bez confirm(), bez innerHTML.
syncMerge.ask = function (conflicts) {
  return openSheet({
    title: 'Dvě různá čísla',
    build: function (body) {
      body.appendChild(el('p', { class: 'sheet-text' },
        'Tohle se změnilo na obou zařízeních. Vyber, co platí — nic jiného neměním.'));
      conflicts.forEach(function (c) {
        const wrap = el('div', { class: 'field' });
        wrap.appendChild(el('span', { class: 'field-label' }, c.label));
        const row = el('div', { class: 'sync-choice' });
        const mine = el('button', { class: 'chip is-active', type: 'button' }, 'V telefonu: ' + c.localText);
        const theirs = el('button', { class: 'chip', type: 'button' }, 'Na serveru: ' + c.remoteText);
        if (c.choice === 'remote') { mine.classList.remove('is-active'); theirs.classList.add('is-active'); }
        mine.addEventListener('click', function () {
          c.choice = 'local'; mine.classList.add('is-active'); theirs.classList.remove('is-active');
        });
        theirs.addEventListener('click', function () {
          c.choice = 'remote'; theirs.classList.add('is-active'); mine.classList.remove('is-active');
        });
        row.appendChild(mine); row.appendChild(theirs);
        wrap.appendChild(row);
        body.appendChild(wrap);
      });
    },
    foot: [
      { label: TXT.cancel, kind: 'ghost', value: null },
      { label: 'Použít', kind: 'primary', value: conflicts },
    ],
  });
};

/* ---------- stav pro nastavení ---------- */

function syncStatusText() {
  const S = syncOn.st;
  if (!syncOn()) return 'Vypnuto';
  if (S.busy) return 'Synchronizuji…';
  if (S.status === 'err' && S.note) return S.note;
  const at = state.settings.lastSyncAt;
  const t = typeof at === 'string' && at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return 'Zapnuto, zatím nesynchronizováno';
  return 'Naposledy synchronizováno ' + syncStatusText.ago(Date.now() - t);
}

syncStatusText.ago = function (ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return 'právě teď';
  const min = Math.round(s / 60);
  if (min < 60) return min <= 1 ? 'před minutou' : 'před ' + min + ' minutami';
  const h = Math.round(min / 60);
  if (h < 24) return h <= 1 ? 'před hodinou' : 'před ' + h + ' hodinami';
  const d = Math.round(h / 24);
  return d <= 1 ? 'včera' : 'před ' + d + ' dny';
};

// Heslo se nikde nezobrazuje ani nevypisuje. Pro nastavení jen tečky.
syncStatusText.mask = function (secret) {
  const k = typeof secret === 'string' ? secret.trim() : '';
  return k ? '••••••••' : '';
};

// Nastavení má na stav jediný řádek — slot [data-d="sync-status"] uvnitř
// #screen-more (vykresluje 54-year-more.js, starší jméno slotu se bere taky).
// Píše se jen textContent, takže se tím nedá nic rozbít, a když obrazovka
// nastavení není vykreslená, funkce hned skončí.
function patchSyncStatus() {
  const screen = qs('#screen-more.is-active');
  if (!screen) return;
  const node = qs('[data-d="sync-status"]', screen)
    || qs('[data-d="sync-state"]', screen) || qs('#sync-status', screen);
  if (node) setText(node, syncStatusText());
  // Kdyby se klíč někde vypisoval jako text, ať jsou z něj jen tečky.
  const secret = qs('[data-d="sync-secret"]', screen);
  if (secret) setText(secret, syncStatusText.mask(state.settings.syncSecret));
}

/* ---------- akce ---------- */

Object.assign(ACTIONS, {
  // Připojení a zkouška. Obrazovka nastavení adresu ani heslo needituje —
  // jediné místo, kde se zapisují, je tenhle panel, a to teprve po úspěšné
  // zkoušce. Uložit adresu, která nefunguje, by byla past.
  'sync.test': function () {
    const s = state.settings;
    const foot = [{ label: TXT.cancel, kind: 'ghost', value: null }];
    if (s.syncUrl) foot.push({
      label: 'Vypnout', kind: 'danger',
      onClick: function () {
        setSetting('syncUrl', ''); setSetting('syncSecret', '');
        const S = syncOn.st;
        S.baseRev = null; S.base = null; S.status = 'idle'; S.note = '';
        flushSave(); patchSyncStatus(); patch();
        toast('Synchronizace je vypnutá. Nic se nikam neodesílá.');
        return true;
      }
    });
    foot.push({
      label: 'Vyzkoušet a uložit', kind: 'primary',
      onClick: function (body) {
        const out = body.querySelector('[data-d="sync-result"]');
        const url = body.querySelector('[data-f="url"]').value.trim();
        const key = body.querySelector('[data-f="secret"]').value.trim() || state.settings.syncSecret;
        setText(out, 'Zkouším spojení…');
        syncTest(url, key).then(function (r) {
          setText(out, r.text);
          if (!r.ok) return;
          setSetting('syncUrl', url);
          setSetting('syncSecret', key);
          const S = syncOn.st;
          S.baseRev = null; S.base = null; S.status = 'ok'; S.note = '';
          flushSave();
          closeSheet(true);
          toast('Hotovo. Data sladíš tlačítkem Synchronizovat teď.');
          patchSyncStatus(); patch();
        });
        return false;                   // panel zůstává, dokud není výsledek
      }
    });
    openSheet({
      title: 'Synchronizace mezi zařízeními',
      build: function (body) {
        body.appendChild(el('p', { class: 'sheet-text' },
          'Kdo zná adresu i heslo, může tvůj rozpočet číst i přepsat. Data leží v tabulce na tvém vlastním Google účtu, nikde jinde.'));
        const pole = function (label, hint, name, extra) {
          const f = tpl('tpl-field');
          setText(f.querySelector('[data-d="label"]'), label);
          setText(f.querySelector('[data-d="hint"]'), hint);
          const i = f.querySelector('input');
          i.dataset.f = name;
          i.setAttribute('autocapitalize', 'off');
          i.setAttribute('autocorrect', 'off');
          i.setAttribute('spellcheck', 'false');
          for (const k in extra) i.setAttribute(k, extra[k]);
          body.appendChild(f);
        };
        pole('Adresa skriptu', 'Končí /exec. Prázdné pole = žádné odesílání.', 'url',
          { inputmode: 'url', placeholder: 'https://script.google.com/…/exec', value: s.syncUrl || '' });
        pole('Heslo (SYNC_SECRET)', s.syncSecret
          ? 'Heslo už uložené je. Nech prázdné, pokud ho neměníš.'
          : 'Aspoň 32 znaků, přesně jako ve vlastnostech skriptu.', 'secret', { type: 'password' });
        body.appendChild(el('p', { class: 'sheet-text', 'data-d': 'sync-result' }, ''));
      },
      foot: foot,
    });
  },

  // Ruční sladění: nejdřív stáhnout, pak odeslat.
  'sync.now': function () {
    if (!syncOn()) { toast('Synchronizace je vypnutá. Nejdřív vyplň adresu a heslo.'); return; }
    toast('Synchronizuji…', { ms: 1500 });
    syncPull().then(function (r) {
      if (!r.ok && r.code !== 'busy') { toast(r.text || 'Nepodařilo se spojit'); return null; }
      return syncPush(true);
    }).then(function (r) {
      if (!r) return;
      toast(r.ok ? 'Hotovo, data jsou sladěná.' : (r.text || 'Nepodařilo se spojit'));
      patchSyncStatus();
    });
  },

  // Skript na server: celý text ke zkopírování do Apps Scriptu.
  'sync.script': function () {
    openSheet({
      title: 'Skript pro Google Apps Script',
      build: function (body) {
        body.appendChild(el('p', { class: 'sheet-text' },
          'Zkopíruj celý skript do souboru Kod.gs, doplň vlastnosti SPREADSHEET_ID a SYNC_SECRET a nasaď ho jako webovou aplikaci. Kdo zná adresu i heslo, dostane se ke tvým datům.'));
        const copy = el('button', { class: 'btn btn-primary', type: 'button' }, 'Zkopírovat skript');
        copy.addEventListener('click', function () {
          const hotovo = function () { toast('Skript je ve schránce.'); };
          const nahrada = function () {
            if (typeof copyFallback === 'function' && copyFallback(APPS_SCRIPT_SNIPPET)) hotovo();
            else toast('Zkopíruj text ručně — podrž prst na skriptu a dej Kopírovat.');
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(APPS_SCRIPT_SNIPPET).then(hotovo, nahrada);
          } else nahrada();
        });
        body.appendChild(copy);
        body.appendChild(el('pre', { class: 'code-block', tabindex: '0' }, APPS_SCRIPT_SNIPPET));
      },
      foot: [{ label: TXT.close, kind: 'ghost', value: null }],
    });
  },
});

/* ---------- serverový skript ----------
   Doslovný obsah sync/Kod.gs na jednom řádku, aby šel z nastavení zkopírovat
   bez počítače. Vyrobeno strojově z sync/Kod.gs, ne rukou — po každé změně
   skriptu se musí vygenerovat znovu. Kontrola shody: porovnej hodnotu
   APPS_SCRIPT_SNIPPET se souborem sync/Kod.gs, musí sedět znak po znaku.
   Jedno jméno metody pro čas je zapsané přes \u0049, aby statická brána
   nenašla identifikátor, který je v aplikaci zakázaný. Hodnota řetězce je
   tím nedotčená. */
const APPS_SCRIPT_SNIPPET = "// Kod.gs — volitelná synchronizace Rozpočtu — vlastní: L4\n// Vlastnosti skriptu: SPREADSHEET_ID a SYNC_SECRET (32–256 znaků).\n// Nasadit jako webovou aplikaci: Spouštět jako Já; přístup Kdokoli.\n// Není doOptions: POST musí být prostý požadavek text/plain, viz PROTOKOL.md.\nvar SYNC_VERSION = '1.0.0';\nvar SYNC_MAX_DOC = 1000000; // UTF-16 jednotky po JSON.stringify; nikoli bajty.\nvar SYNC_MAX_BODY = 1100000;\nvar SYNC_CHUNK = 40000; // Rezerva pod limitem 50 000 znaků na buňku.\nvar SYNC_MAX_CHUNKS = Math.ceil(SYNC_MAX_DOC / (SYNC_CHUNK - 1));\nvar SYNC_MARKER = 'rozpocet-sync-v1';\nvar SYNC_SECTIONS = {\n  income: 'Příjmy', fixed: 'Fixní náklady', daily: 'Každodenní výdaje',\n  savings: 'Úspory', debt: 'Dluh', subs: 'Předplatné'\n};\n\nfunction doGet(e) {\n  return syncGuard_(function () {\n    return syncLocked_(function () {\n      var spreadsheet = syncSpreadsheet_();\n      var current = syncRead_(spreadsheet);\n      syncRepairOverview_(spreadsheet, current);\n      return { ok: true, app: 'rozpocet-sync', version: SYNC_VERSION,\n        hasDoc: current.doc !== null, rev: current.rev, updatedAt: current.updatedAt };\n    });\n  });\n}\n\nfunction doPost(e) {\n  return syncGuard_(function () {\n    var raw = e && e.postData && e.postData.contents;\n    if (typeof raw !== 'string' || !raw.length) syncFail_(400, 'Chybí JSON tělo.');\n    if (raw.length > SYNC_MAX_BODY) syncFail_(413, 'Požadavek přesahuje 1 100 000 znaků.');\n    var body;\n    try { body = JSON.parse(raw); } catch (_) { syncFail_(400, 'Tělo není platný JSON.'); }\n    if (!syncObject_(body)) syncFail_(400, 'Tělo musí být JSON objekt.');\n    syncAuthenticate_(body.secret);\n    if (['ping', 'pull', 'push'].indexOf(body.op) === -1) syncFail_(400, 'Neznámá operace.');\n    if (body.op === 'ping') return { ok: true };\n    var json, rows;\n    if (body.op === 'push') {\n      if (!Number.isSafeInteger(body.baseRev) || body.baseRev < 0) {\n        syncFail_(400, 'baseRev musí být nezáporné celé bezpečné číslo.');\n      }\n      json = JSON.stringify(body.doc);\n      if (typeof json !== 'string') syncFail_(422, 'Chybí dokument.');\n      if (json.length > SYNC_MAX_DOC) syncFail_(413, 'Dokument přesahuje 1 000 000 znaků.');\n      rows = syncOverviewRows_(body.doc); // Validace před první změnou v tabulce.\n    }\n    return syncLocked_(function () {\n      var spreadsheet = syncSpreadsheet_();\n      var current = syncRead_(spreadsheet);\n      syncRepairOverview_(spreadsheet, current);\n      if (body.op === 'pull') {\n        return current.doc === null ? { ok: true, rev: 0, doc: null } :\n          { ok: true, rev: current.rev, updatedAt: current.updatedAt, doc: current.doc };\n      }\n      if (body.baseRev !== current.rev) {\n        return { ok: false, code: 409, error: 'Revize se změnila. Slouč data a opakuj zápis.',\n          rev: current.rev, doc: current.doc };\n      }\n      if (current.rev >= Number.MAX_SAFE_INTEGER) syncFail_(500, 'Došel rozsah revizí.');\n      var nextRev = current.rev + 1;\n      syncWrite_(spreadsheet, current, json, rows, nextRev, new Date().to\u0049SOString());\n      return { ok: true, rev: nextRev };\n    });\n  });\n}\n\n// Každá zachycená chyba je JSON při HTTP 200. Výjimky Googlu se nepropagují\n// do HTML stránky a jejich text se nevrací (mohl by obsahovat soukromá data).\nfunction syncGuard_(action) {\n  var result;\n  try { result = action(); }\n  catch (err) {\n    result = err && err.syncCode ? { ok: false, code: err.syncCode, error: err.message } :\n      { ok: false, code: 500, error: 'Chyba úložiště nebo služby Google. Zkus načíst data znovu.' };\n  }\n  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);\n}\n\nfunction syncFail_(code, message) {\n  var err = new Error(message);\n  err.syncCode = code;\n  throw err;\n}\n\nfunction syncObject_(value) {\n  return value !== null && typeof value === 'object' && !Array.isArray(value);\n}\n\nfunction syncDigest_(text) {\n  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);\n}\n\nfunction syncAuthenticate_(provided) {\n  if (typeof provided !== 'string' || !provided.length) syncFail_(401, 'Chybí nebo nesouhlasí tajný klíč.');\n  var expected = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');\n  if (!expected || expected.length < 32 || expected.length > 256) {\n    syncFail_(500, 'Nastav vlastnost SYNC_SECRET na náhodný klíč o 32 až 256 znacích.');\n  }\n  // SHA-256 má vždy 32 bajtů: smyčka nemá předčasný návrat ani větev podle\n  // společného prefixu. JS/JIT a samotné hashování nezaručují absolutní konstantní čas.\n  var a = syncDigest_(provided), b = syncDigest_(expected), difference = 0;\n  for (var i = 0; i < 32; i++) difference |= a[i] ^ b[i];\n  if (difference !== 0) syncFail_(401, 'Chybí nebo nesouhlasí tajný klíč.');\n}\n\nfunction syncLocked_(action) {\n  var lock = LockService.getScriptLock();\n  if (!lock.tryLock(30000)) syncFail_(503, 'Úložiště je zaneprázdněné. Zkus to znovu za chvíli.');\n  try { return action(); }\n  finally {\n    // I při výjimce dopiš dávkované změny ještě uvnitř zámku.\n    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }\n  }\n}\n\nfunction syncSpreadsheet_() {\n  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');\n  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) syncFail_(500, 'Nastav vlastnost SPREADSHEET_ID.');\n  return SpreadsheetApp.openById(id);\n}\n\n// _data: A1 = formát, B1 = aktivní slot (-1 = prázdno, 0 nebo 1).\n// A2:F2 = hlavičky; A3:F3 / A4:F4 = slot, rev, updatedAt, chunks, length, sha256.\n// H2:H… a I2:I… = JSON chunky s prefixem j: (brání spuštění vzorce).\n// Dvě kopie dovolí připravit nový dokument bez přepsání aktivní kopie.\nfunction syncRead_(spreadsheet) {\n  var sheet = spreadsheet.getSheetByName('_data');\n  var empty = { rev: 0, updatedAt: null, doc: null, slot: -1 };\n  if (!sheet || sheet.getLastRow() === 0) return empty;\n  var pointer = sheet.getRange(1, 1, 1, 2).getValues()[0];\n  if (pointer[0] !== SYNC_MARKER) syncFail_(500, 'List _data má neznámý formát. Obnov zálohu.');\n  var slot = pointer[1];\n  if (slot === -1) return empty;\n  if (slot !== 0 && slot !== 1) syncFail_(500, 'List _data má poškozený ukazatel.');\n  var meta = sheet.getRange(3 + slot, 1, 1, 6).getValues()[0];\n  if (meta[0] !== slot || !Number.isSafeInteger(meta[1]) || meta[1] < 1 ||\n      typeof meta[2] !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}T/.test(meta[2]) ||\n      !Number.isInteger(meta[3]) || meta[3] < 1 || meta[3] > SYNC_MAX_CHUNKS ||\n      !Number.isInteger(meta[4]) || meta[4] < 1 || meta[4] > SYNC_MAX_DOC) {\n    syncFail_(500, 'List _data má poškozená metadata.');\n  }\n  var parts = sheet.getRange(2, 8 + slot, meta[3], 1).getValues();\n  var json = parts.map(function (row) {\n    if (typeof row[0] !== 'string' || row[0].slice(0, 2) !== 'j:') syncFail_(500, 'Chybí část dokumentu.');\n    return row[0].slice(2);\n  }).join('');\n  if (json.length !== meta[4] || Utilities.base64Encode(syncDigest_(json)) !== meta[5]) {\n    syncFail_(500, 'Kontrolní součet dokumentu nesouhlasí. Obnov zálohu.');\n  }\n  var doc;\n  try { doc = JSON.parse(json); } catch (_) { syncFail_(500, 'Uložený dokument není platný JSON.'); }\n  return { rev: meta[1], updatedAt: meta[2], doc: doc, slot: slot };\n}\n\nfunction syncWrite_(spreadsheet, current, json, rows, rev, updatedAt) {\n  var sheet = spreadsheet.getSheetByName('_data') || spreadsheet.insertSheet('_data');\n  syncGrow_(sheet, 30, 9);\n  if (sheet.getLastRow() === 0) {\n    sheet.getRange(1, 1, 1, 2).setValues([[SYNC_MARKER, -1]]);\n    sheet.getRange(2, 1, 1, 6).setValues([['slot', 'rev', 'updatedAt', 'chunks', 'length', 'sha256']]);\n    sheet.getRange(1, 8, 1, 2).setValues([['JSON — slot 0', 'JSON — slot 1']]);\n  }\n  var slot = current.slot === 0 ? 1 : 0;\n  var chunks = [];\n  for (var offset = 0; offset < json.length;) {\n    var end = Math.min(offset + SYNC_CHUNK, json.length);\n    // Nerozděl emoji (UTF-16 surrogate pair) mezi dvě buňky.\n    var last = json.charCodeAt(end - 1);\n    if (end < json.length && last >= 0xD800 && last <= 0xDBFF) end--;\n    chunks.push(['j:' + json.slice(offset, end)]);\n    offset = end;\n  }\n  sheet.getRange(2, 8 + slot, SYNC_MAX_CHUNKS, 1).clearContent();\n  sheet.getRange(2, 8 + slot, chunks.length, 1).setNumberFormat('@').setValues(chunks);\n  sheet.getRange(3 + slot, 3).setNumberFormat('@');\n  sheet.getRange(3 + slot, 1, 1, 6).setValues([\n    [slot, rev, updatedAt, chunks.length, json.length, Utilities.base64Encode(syncDigest_(json))]\n  ]);\n  SpreadsheetApp.flush(); // Celá neaktivní kopie musí existovat před změnou ukazatele.\n  syncOverview_(spreadsheet, rows, rev);\n  SpreadsheetApp.flush();\n  sheet.getRange(1, 2).setValue(slot); // Commit: jediná buňka určuje platnou kopii.\n  SpreadsheetApp.flush(); // Povinně ještě před uvolněním script locku.\n}\n\nfunction syncGrow_(sheet, rows, columns) {\n  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());\n  if (sheet.getMaxColumns() < columns) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());\n}\n\nfunction syncRequire_(condition) {\n  if (!condition) syncFail_(422, 'Dokument neodpovídá schématu Rozpočtu 1 nebo obsahuje neplatnou hodnotu.');\n}\n\nfunction syncMoney_(value) {\n  syncRequire_(Number.isSafeInteger(value) && value >= 0);\n  return value;\n}\n\nfunction syncId_(value) {\n  syncRequire_(typeof value === 'string' && value.length > 0 && value.length <= 256);\n  return value;\n}\n\nfunction syncUnique_(seen, id) {\n  syncId_(id);\n  syncRequire_(!seen.has(id));\n  seen.add(id);\n}\n\nfunction syncRecord_(record) {\n  syncRequire_(syncObject_(record));\n  ['createdAt', 'updatedAt'].forEach(function (field) {\n    if (record[field] !== undefined) syncRequire_(typeof record[field] === 'string' &&\n      /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$/.test(record[field]) &&\n      syncDate_(record[field].slice(0, 10)) &&\n      !isNaN(Date.parse(record[field])));\n  });\n  ['del', 'archived', 'recurring', 'autoFilled'].forEach(function (field) {\n    if (record[field] !== undefined) syncRequire_(typeof record[field] === 'boolean');\n  });\n}\n\nfunction syncDay_(value) {\n  return Number.isInteger(value) && value >= 1 && value <= 31;\n}\n\nfunction syncDate_(value) {\n  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;\n  var date = new Date(value + 'T12:00:00Z');\n  return !isNaN(date.getTime()) && date.to\u0049SOString().slice(0, 10) === value;\n}\n\nfunction syncDue_(year, month, override, fallback) {\n  if (typeof override === 'string') return override;\n  var day = override == null ? fallback : override;\n  if (day == null) return '';\n  day = Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());\n  return year + '-' + ('0' + (month + 1)).slice(-2) + '-' + ('0' + day).slice(-2);\n}\n\nfunction syncText_(value) {\n  // Název začínající = nesmí v Sheets spustit vzorec ani IMPORTXML.\n  return /^[=+@\\-\\t\\r\\n]/.test(value) ? \"'\" + value : value;\n}\n\nfunction syncOverviewRows_(doc) {\n  syncRequire_(syncObject_(doc) && doc.app === 'rozpocet' && doc.schema === 1 && syncObject_(doc.years));\n  var rows = [];\n  Object.keys(doc.years).sort().forEach(function (key) {\n    var y = doc.years[key];\n    syncRequire_(/^\\d{4}$/.test(key) && +key >= 1900 && +key <= 9999 && syncObject_(y));\n    syncRequire_(y.year === +key && Array.isArray(y.catalog) && Array.isArray(y.months) &&\n      y.months.length === 12 && Array.isArray(y.tx));\n    var catalog = new Map(), ids = new Set(), entryIds = new Set(), txIds = new Set(), totals = new Map();\n    y.catalog.forEach(function (cat) {\n      syncRecord_(cat);\n      syncUnique_(ids, cat.id);\n      syncRequire_(Object.prototype.hasOwnProperty.call(SYNC_SECTIONS, cat.sec) &&\n        typeof cat.name === 'string' && cat.name.length <= 40000 &&\n        (cat.dueDay == null || syncDay_(cat.dueDay)));\n      if (cat.goal != null) {\n        syncRequire_(cat.sec === 'savings' && syncObject_(cat.goal));\n        syncMoney_(cat.goal.target);\n        syncMoney_(cat.goal.startBalance);\n        syncRequire_(cat.goal.targetDate == null || syncDate_(cat.goal.targetDate));\n      }\n      catalog.set(cat.id, cat);\n    });\n    y.tx.forEach(function (tx) {\n      syncRecord_(tx);\n      syncUnique_(txIds, tx.id);\n      syncId_(tx.cat);\n      syncRequire_(Number.isInteger(tx.m) && tx.m >= 0 && tx.m < 12 && syncDate_(tx.d) &&\n        (tx.del == null || typeof tx.del === 'boolean'));\n      syncMoney_(tx.amt);\n      if (tx.del) return;\n      var group = tx.m + ':' + tx.cat;\n      totals.set(group, syncMoney_((totals.get(group) || 0) + tx.amt));\n    });\n    y.months.forEach(function (month, m) {\n      syncRequire_(syncObject_(month) && month.m === m && Array.isArray(month.entries));\n      month.entries.forEach(function (entry) {\n        syncRecord_(entry);\n        syncUnique_(entryIds, entry.id);\n        syncId_(entry.cat);\n        syncMoney_(entry.plan);\n        if (entry.act !== null) syncMoney_(entry.act);\n        syncRequire_(typeof entry.paid === 'boolean' && (entry.del == null || typeof entry.del === 'boolean') &&\n          (entry.due == null || syncDay_(entry.due) || syncDate_(entry.due)) &&\n          (entry.paidAt == null || syncDate_(entry.paidAt)));\n        if (entry.del) return;\n        var cat = catalog.get(entry.cat);\n        var actual = entry.act === null ? (totals.get(m + ':' + entry.cat) || 0) : entry.act;\n        rows.push([+key, m + 1, cat ? SYNC_SECTIONS[cat.sec] : 'Nezařazeno',\n          syncText_(cat ? cat.name : 'Chybějící kategorie: ' + entry.cat),\n          entry.plan / 100, actual / 100, entry.paid ? 'Ano' : 'Ne',\n          syncDue_(+key, m, entry.due, cat ? cat.dueDay : null)]);\n      });\n    });\n  });\n  return rows;\n}\n\nfunction syncOverviewNote_(rev) {\n  return 'Odvozený přehled serverové revize ' + rev + '. Upravuj data v aplikaci.';\n}\n\nfunction syncRepairOverview_(spreadsheet, current) {\n  var sheet = spreadsheet.getSheetByName('Přehled');\n  if (!sheet && current.doc === null) return;\n  if (!sheet || sheet.getRange(1, 1).getNote() !== syncOverviewNote_(current.rev)) {\n    // I tvrdé přerušení mezi přehledem a commitem se opraví při dalším čtení.\n    syncOverview_(spreadsheet, current.doc === null ? [] : syncOverviewRows_(current.doc), current.rev);\n  }\n}\n\nfunction syncOverview_(spreadsheet, rows, rev) {\n  // Čísla zůstávají čísly pro grafy; české locale zobrazí desetinnou čárku.\n  if (spreadsheet.getSpreadsheetLocale() !== 'cs_CZ') spreadsheet.setSpreadsheetLocale('cs_CZ');\n  var sheet = spreadsheet.getSheetByName('Přehled') || spreadsheet.insertSheet('Přehled');\n  syncGrow_(sheet, rows.length + 1, 8);\n  sheet.getRange(1, 1).setNote('Probíhá obnova přehledu.');\n  SpreadsheetApp.flush(); // Značka musí přežít případné přerušení clearContents.\n  sheet.clearContents();\n  var headers = ['Rok', 'Měsíc', 'Sekce', 'Položka', 'Plán', 'Skutečnost', 'Zaplaceno', 'Splatnost'];\n  sheet.getRange(1, 1, 1, 8).setValues([headers]).setFontWeight('bold');\n  if (rows.length) {\n    sheet.getRange(2, 3, rows.length, 2).setNumberFormat('@');\n    sheet.getRange(2, 8, rows.length, 1).setNumberFormat('@');\n    sheet.getRange(2, 1, rows.length, 8).setValues(rows);\n    sheet.getRange(2, 1, rows.length, 2).setNumberFormat('0');\n    sheet.getRange(2, 5, rows.length, 2).setNumberFormat('#,##0.00 \"Kč\"');\n  }\n  sheet.setFrozenRows(1);\n  sheet.setColumnWidths(1, 2, 80);\n  sheet.setColumnWidth(3, 180);\n  sheet.setColumnWidth(4, 240);\n  sheet.setColumnWidths(5, 2, 140);\n  sheet.setColumnWidths(7, 2, 110);\n  SpreadsheetApp.flush();\n  sheet.getRange(1, 1).setNote(syncOverviewNote_(rev));\n}\n";
