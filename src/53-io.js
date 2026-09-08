// 53-io.js — záloha, export, import a tisk — vlastní: L10
// Chrání jedinou skutečnou kopii jejích dat, takže tu vede jistota nad
// elegancí. Soukromí pomocníci visí jako vlastnosti na deklarovaných
// funkcích — kontrakt nedovoluje přidat do společného scope další jméno.

/* ======================= doručení souboru =======================
   Kaskáda přesně v tomhle pořadí. Otevřená sdílecí nabídka NENÍ důkaz
   uložené zálohy, proto se lastExportAt nastaví jen na cestě, která
   opravdu doběhla. */

function deliverFile(blob, filename, shareTitle) {
  // 1) Prázdný soubor je nejhorší možný výsledek: tváří se jako hotová
  //    záloha a přijde se na to až ve chvíli, kdy je potřeba.
  if (!blob || !blob.size) {
    toast('Záloha vyšla prázdná, nic se neuložilo. Zkus to prosím znovu.');
    return Promise.resolve({ ok: false, via: 'empty' });
  }
  let file = null;
  try { file = new File([blob], filename, { type: blob.type || 'application/octet-stream' }); }
  catch (e) { file = null; }

  // 1b) Běží-li appka vložená v prohlížeči artefaktů Claude, odkaz se
  //     stažením ani sdílení nic neudělají — soubor musí projít hostitelem.
  //     Na normálním hostingu tahle větev neexistuje a nic nedělá.
  if (typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function') {
    return window.claude.use('downloads').then(function (dl) {
      if (!dl || typeof dl.save !== 'function') return deliverFile.share(blob, file, filename, shareTitle);
      return dl.save({ filename: filename, data: blob }).then(
        function () { return { ok: true, via: 'host' }; },
        function (err) {
          const code = err && err.code;
          if (code === 'declined') return { ok: false, via: 'cancel' };
          return deliverFile.share(blob, file, filename, shareTitle);
        });
    }, function () { return deliverFile.share(blob, file, filename, shareTitle); });
  }
  return deliverFile.share(blob, file, filename, shareTitle);
}

// 2) Sdílení souboru a náhradní cesty. Vyčleněno, aby na to šlo skočit
//    i z větve pro prohlížeč artefaktů.
deliverFile.share = function (blob, file, filename, shareTitle) {

  // 2) Sdílení souboru — na iPhonu jediná cesta, která spolehlivě nabídne
  //    "Uložit do Souborů", a funguje i v appce na ploše. Do payloadu jde
  //    JEN pole files (+ titulek); text nebo url iOS soubor tiše zahodí.
  let can = false;
  if (file && navigator.share && navigator.canShare) {
    try { can = navigator.canShare({ files: [file] }); } catch (e) { can = false; }
  }
  if (!can) return Promise.resolve(deliverFile.download(blob, filename));
  const payload = { files: [file] };
  if (shareTitle) payload.title = shareTitle;
  return navigator.share(payload).then(
    function () { return { ok: true, via: 'share' }; },
    function (err) {
      // Zrušené sdílení není chyba, ale ani hotová záloha.
      if (err && err.name === 'AbortError') return { ok: false, via: 'cancel' };
      return deliverFile.download(blob, filename);
    });
};

// 3) Odkaz se stažením. Musí padnout uvnitř jejího klepnutí, jinak ho iOS
//    ignoruje. Objektová adresa se odvolává až po 30 s — dřív by měl
//    stažený soubor 0 kB. Že se opravdu uložil, prohlížeč neřekne, proto
//    je pod hláškou ještě ruční úniková cesta.
deliverFile.download = function (blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename, rel: 'noopener' });
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e) {}
      if (a.isConnected) a.remove();
    }, 30000);
  } catch (e) { return deliverFile.rescue(blob); }
  toast('Soubor je stažený. Ulož si ho do iCloudu.', {
    action: 'Nestáhlo se?', ms: 9000,
    onAction: function () { deliverFile.rescue(blob); }
  });
  return { ok: true, via: 'download' };
};

// 4) Poslední záchrana: celý obsah k ručnímu zkopírování.
deliverFile.rescue = function (blob) {
  try { blob.text().then(copyFallback, function () { copyFallback(''); }); }
  catch (e) { copyFallback(''); }
  return { ok: false, via: 'rescue' };
};

// Ošklivé, ale neselže to nikdy. U nenahraditelných dat je úniková cesta
// funkce, ne ostuda.
function copyFallback(text) {
  const payload = String(text === null || text === undefined ? '' : text);
  const copy = function (ta) {
    const say = function (ok) { toast(ok ? 'Zkopírováno.' : 'Nešlo to zkopírovat. Vyber text prstem, podrž a dej Kopírovat.'); };
    const legacy = function () { let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} say(ok); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(function () { say(true); }, legacy);
    else legacy();
  };
  return openSheet({
    title: 'Zkopíruj zálohu ručně', autofocus: false,
    build: function (body, sheet) {
      sheet.classList.add('sheet-copy');
      body.appendChild(el('p', { class: 'sheet-text' },
        'Stažení se nepovedlo. Celá záloha je tady — zkopíruj ji a vlož si ji třeba do Poznámek nebo do e-mailu sama sobě.'));
      const ta = el('textarea', { class: 'copy-box', readonly: true, rows: 10, spellcheck: 'false',
        autocapitalize: 'off', autocorrect: 'off', 'aria-label': 'Text zálohy' });
      ta.value = payload;
      Object.assign(ta.style, { width: '100%', minHeight: '38vh', fontSize: '12px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' });
      body.appendChild(ta);
      requestAnimationFrame(function () { copyFallback.selectAll(ta); });
    },
    foot: [
      { label: TXT.close, kind: 'ghost', value: false },
      { label: 'Zkopírovat', kind: 'primary',
        onClick: function (body) { const ta = body.querySelector('textarea'); copyFallback.selectAll(ta); copy(ta); return true; } },
    ],
  });
}

// Na iOS nestačí select() — readonly pole potřebuje ještě rozsah výběru.
copyFallback.selectAll = function (ta) {
  if (!ta) return;
  try {
    ta.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(ta);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(r); }
    ta.setSelectionRange(0, ta.value.length);
  } catch (e) { try { ta.select(); } catch (e2) {} }
};

/* ======================= JSON záloha ======================= */

function exportJSON() {
  if (!state || typeof state !== 'object' || !state.years) {
    toast('Není co zálohovat.');
    return Promise.resolve({ ok: false, via: 'nodata' });
  }
  const stamp = (typeof storageStamp === 'function') ? storageStamp() : todayISO();
  const doc = storageClone(state);
  // NaN nebo Infinity musí zálohu ZASTAVIT. JSON.stringify z nich tiše udělá
  // null a to null pak při načtení otráví každý součet, aniž by kde co hlásilo.
  const bad = exportJSON.nonFinite(doc, 'záloha');
  if (bad) {
    toast('V datech je poškozené číslo (' + bad + '). Záloha se neuložila — po načtení by z něj byla prázdná hodnota a součty by přestaly sedět.', { ms: 9000 });
    return Promise.resolve({ ok: false, via: 'nan', where: bad });
  }
  // Hlavička jde dopředu, ať se dá soubor otevřít a přečíst okem. Počty
  // jdou ze stejné funkce, která je při načtení znovu spočítá, takže co
  // je v souboru napsané, to import doopravdy uvidí.
  const sm = validateImport(doc).summary;
  const head = { app: 'rozpocet', schema: SCHEMA, appVersion: APP_VERSION,
    exportedAt: stamp, deviceId: doc.deviceId || '',
    counts: { years: sm.years, months: sm.months, catalog: sm.catalog, entries: sm.entries, tx: sm.tx } };
  delete doc.app; delete doc.schema; delete doc.deviceId;
  // Heslo a adresa synchronizace do zálohy NEPATŘÍ. Soubor jde do iCloudu,
  // mailem i do schránky; kdo ho má, mohl by rozpočet číst i přepisovat.
  if (doc.settings) {
    doc.settings = Object.assign({}, doc.settings);
    doc.settings.syncUrl = '';
    doc.settings.syncSecret = '';
  }
  let json = '';
  try { json = JSON.stringify(Object.assign(head, doc), null, 2); }
  catch (e) { toast('Zálohu se nepodařilo sestavit.'); return Promise.resolve({ ok: false, via: 'stringify' }); }
  // todayISO(), ne toISOString() — v Praze by 1. ledna spadl do prosince.
  const name = 'rozpocet-zaloha-' + todayISO() + '.json';
  return deliverFile(new Blob([json], { type: 'application/json' }), name, 'Záloha rozpočtu')
    .then(function (res) {
      if (res && res.ok) { state.settings.lastExportAt = stamp; saveNow(); }
      return res;
    });
}

// Cesta k prvnímu neplatnému číslu v dokumentu, jinak null.
// Hlídané klíče musí být celé haléře. Řetězec "100" se do součtu dostane
// jako text a v prohlížeči se z něj tiše stane spojování, ne sčítání.
exportJSON.AMOUNT_KEYS = { plan: 1, act: 1, amt: 1, target: 1, startBalance: 1 };

exportJSON.nonFinite = function (v, path, key) {
  if (typeof v === 'number') return Number.isFinite(v) ? null : path;
  if (v !== null && v !== undefined && key && exportJSON.AMOUNT_KEYS[key]
      && typeof v !== 'number') return path;
  if (!v || typeof v !== 'object') return null;
  const arr = Array.isArray(v);
  for (const k in v) {
    const r = exportJSON.nonFinite(v[k], path + (arr ? '[' + k + ']' : '.' + k), arr ? key : k);
    if (r) return r;
  }
  return null;
};

/* ======================= CSV pro Excel a Numbers ======================= */

function exportCSVMonth(y, m) {
  const yr = state.years[String(y)];
  if (!yr) { toast('Pro tenhle rok tu zatím nic není.'); return Promise.resolve({ ok: false, via: 'nodata' }); }
  const cats = Object.create(null);
  (yr.catalog || []).forEach(function (c) { if (c && c.id) cats[c.id] = c; });
  const lines = [['Sekce', 'Položka', 'Splatnost', 'Plán', 'Skutečnost', 'Zaplaceno'].map(escapeCsv).join(';')];
  SECTIONS.forEach(function (sec) {
    exportCSVMonth.rows(yr, m, sec, cats).forEach(function (e) {
      const c = cats[e.cat];
      const day = (e.due === null || e.due === undefined) ? c.dueDay : e.due;
      lines.push([
        escapeCsv(sec.short),
        escapeCsv(c.name),                                    // odzbrojí i "=SUM(A1)"
        escapeCsv(sec.hasDue ? exportCSVMonth.date(dueDateFor(y, m, day)) : ''),
        exportCSVMonth.num(e.plan),                           // čísla NESMÍ přes escapeCsv:
        exportCSVMonth.num(renderPrintView.actual(yr, m, e)), // apostrof by z nich udělal text
        escapeCsv(sec.hasDue ? (e.paid ? 'ano' : 'ne') : ''),
      ].join(';'));
    });
  });
  // Nezařazené nákupy a součet. Bez nich se tabulka v Excelu nedá srovnat
  // s tím, co appka ukazuje na obrazovce.
  let md = null;
  try { md = computeMonth(y, m); } catch (e) { md = null; }
  if (md && md.orphans && Number.isSafeInteger(md.orphans.total) && md.orphans.total) {
    lines.push([escapeCsv('Nezařazeno'), escapeCsv('Nákupy bez řádku v tomhle měsíci'),
      '', '', exportCSVMonth.num(md.orphans.total), ''].join(';'));
  }
  if (md) {
    lines.push('');
    lines.push([escapeCsv('Souhrn'), escapeCsv('Příjmy'), '', '',
      exportCSVMonth.num(md.incomeTotal), ''].join(';'));
    lines.push([escapeCsv('Souhrn'), escapeCsv('Výdaje'), '', '',
      exportCSVMonth.num(md.outflow), ''].join(';'));
    lines.push([escapeCsv('Souhrn'), escapeCsv('Zůstatek'), '', '',
      exportCSVMonth.num(md.balance), ''].join(';'));
  }

  // BOM první, středník, CRLF — jinak česká Excel rozseká diakritiku
  // a celý řádek nacpe do jednoho sloupce.
  const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const name = 'rozpocet-' + y + '-' + (m < 9 ? '0' : '') + (m + 1) + '.csv';
  return deliverFile(blob, name, 'Rozpočet — tabulka');
}

// Živé řádky jedné sekce, seřazené jako na obrazovce.
exportCSVMonth.rows = function (yr, m, sec, cats) {
  const mo = (yr.months || [])[m];
  return ((mo && mo.entries) || []).filter(function (e) {
    const c = e && !e.del ? cats[e.cat] : null;
    if (!c || c.sec !== sec.key) return false;
    if (!c.archived) return true;
    // Archivovaná kategorie zůstává, dokud v tom měsíci něco má — stejně
    // jako na obrazovce a v tisku.
    return (Number.isSafeInteger(e.plan) && e.plan !== 0)
        || (Number.isSafeInteger(e.act) && e.act !== 0)
        || !!e.paid
        || (yr.tx || []).some(function (t) { return t && !t.del && t.m === m && t.cat === e.cat; });
  }).sort(function (a, b) { return (cats[a.cat].order | 0) - (cats[b.cat].order | 0); });
};

// Desetinná čárka a ŽÁDNÝ oddělovač tisíců. Jediná U+00A0 uvnitř čísla
// udělá z celého sloupce text a SUM pak tiše vrátí nulu.
exportCSVMonth.num = function (minor) {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '';
  const a = Math.abs(Math.round(minor));
  return (minor < 0 ? '-' : '') + Math.floor(a / 100) + ',' + String(a % 100).padStart(2, '0');
};

exportCSVMonth.date = function (iso) {
  const p = parseYmd(iso);
  return p ? p.day + '.' + (p.m + 1) + '.' + p.y : '';
};

/* ======================= import ======================= */

// ŽÁDNÝ atribut accept. Na iOS kvůli němu zešednou přesně ty soubory
// z iCloud Drive, které potřebuje vybrat. Ověřuje se až parsováním.
function pickImportFile() {
  return new Promise(function (resolve) {
    const input = el('input', { type: 'file' });
    Object.assign(input.style, { position: 'fixed', left: '-9999px', opacity: '0' });
    let done = false;
    const finish = function (r) {
      if (done) return;
      done = true;
      input.value = '';               // bez resetu se stejný soubor podruhé nevybere
      if (input.isConnected) input.remove();
      resolve(r);
    };
    input.addEventListener('change', function () {
      const f = input.files && input.files[0];
      if (!f) return finish({ ok: false, reason: 'cancel' });
      if (!f.size) return finish({ ok: false, reason: 'empty', name: f.name });
      f.text().then(
        function (t) { finish({ ok: true, text: String(t), name: f.name, size: f.size }); },
        function () { finish({ ok: false, reason: 'read', name: f.name }); });
    });
    input.addEventListener('cancel', function () { finish({ ok: false, reason: 'cancel' }); });
    document.body.appendChild(input);
    input.click();
  });
}

// validateImport(obj) -> { ok, errors[], warnings[], summary }
function validateImport(obj) {
  const errors = [], warnings = [];
  const sum = { years: 0, catalog: 0, entries: 0, tx: 0, months: 0, dropped: 0, schema: null, exportedAt: null };
  const bad = function (s) { if (errors.length < 12) errors.push(s); };
  const amt = function (v) { return Number.isSafeInteger(v); };
  const out = function () { return { ok: errors.length === 0, errors: errors, warnings: warnings, summary: sum }; };

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { bad('Tohle není záloha rozpočtu.'); return out(); }
  sum.schema = obj.schema;
  sum.exportedAt = typeof obj.exportedAt === 'string' ? obj.exportedAt
    : (typeof obj.savedAt === 'string' ? obj.savedAt : null);
  if (obj.app !== undefined && obj.app !== 'rozpocet') bad('Soubor je z jiné aplikace.');
  if (!Number.isInteger(obj.schema)) bad('Chybí verze dat — tohle není záloha rozpočtu.');
  else if (obj.schema > SCHEMA) bad('Záloha je z novější verze aplikace (' + obj.schema + '). Nejdřív aktualizuj aplikaci.');
  const ys = obj.years;
  if (!ys || typeof ys !== 'object' || Array.isArray(ys)) { bad('V souboru chybí data roků.'); return out(); }

  Object.keys(ys).forEach(function (yk) {
    const yr = ys[yk], at = 'rok ' + yk;
    if (!yr || typeof yr !== 'object') return bad(at + ': není objekt.');
    if (!Array.isArray(yr.catalog)) return bad(at + ': chybí seznam položek.');
    if (!Array.isArray(yr.months) || yr.months.length !== 12) return bad(at + ': nemá dvanáct měsíců.');
    if (!Array.isArray(yr.tx)) return bad(at + ': chybí deník.');
    sum.years += 1;
    yr.catalog.forEach(function (c) {
      if (!c || typeof c !== 'object') return bad(at + ': položka není objekt.');
      if (!c.archived) sum.catalog += 1;
      if (c.goal && typeof c.goal === 'object' && (!amt(c.goal.target) || !amt(c.goal.startBalance))) {
        bad(at + ' / ' + String(c.name) + ': částky u cíle nejsou celé haléře.');
      }
    });
    yr.months.forEach(function (mo, m) {
      if (!mo || !Array.isArray(mo.entries)) return bad(at + ': měsíc ' + (m + 1) + ' nemá položky.');
      let live = 0;
      mo.entries.forEach(function (e) {
        if (!e || typeof e !== 'object') return bad(at + ': řádek v měsíci ' + (m + 1) + ' není objekt.');
        if (!e.del) { live += 1; sum.entries += 1; }
        // Plán smí být null — znamená to „nezadáno", ne nulu. Bez téhle
        // výjimky by appka odmítla vlastní zálohu, jakmile v ní bude
        // jediné vyprázdněné pole.
        if (e.plan !== null && e.plan !== undefined && !amt(e.plan)) bad(at + ' / měsíc ' + (m + 1) + ': plán nejsou celé haléře (' + String(e.plan) + ').');
        if (e.act !== null && e.act !== undefined && !amt(e.act)) bad(at + ' / měsíc ' + (m + 1) + ': skutečnost nejsou celé haléře (' + String(e.act) + ').');
      });
      if (live) sum.months += 1;
    });
    yr.tx.forEach(function (t) {
      if (!t || typeof t !== 'object') return bad(at + ': zápis v deníku není objekt.');
      if (!t.del) sum.tx += 1;
      if (!amt(t.amt)) bad(at + ': částka v deníku nejsou celé haléře (' + String(t.amt) + ').');
    });
  });

  // Osiřelý nákup se NEZAHAZUJE. Appka ho umí ukázat v koši "Nezařazeno"
  // a počítá ho do výdajů; kdyby ho import vypustil, obnova ze zálohy by
  // tiše ubrala peníze, které uživatelka opravdu utratila.
  sum.orphans = validateImport.orphans(obj).size;
  sum.dropped = 0;
  if (sum.orphans) {
    warnings.push(sum.orphans + '× nákup patří ke kategorii, která už neexistuje. '
      + 'Načtou se a najdeš je v deníku pod „Nezařazeno".');
  }
  return out();
}

// Klíč je "rok|id", protože id je unikátní jen uvnitř roku.
validateImport.orphans = function (doc) {
  const out = new Set();
  const ys = (doc && doc.years) || {};
  for (const yk in ys) {
    const yr = ys[yk];
    if (!yr || !Array.isArray(yr.catalog) || !Array.isArray(yr.tx)) continue;
    const ids = new Set();
    yr.catalog.forEach(function (c) { if (c && typeof c.id === 'string') ids.add(c.id); });
    yr.tx.forEach(function (t) {
      if (t && typeof t === 'object' && !t.del && typeof t.cat === 'string' && t.cat && !ids.has(t.cat)) out.add(yk + '|' + t.id);
    });
  }
  return out;
};

// Starý tvar musí dostat šanci projít migrací dřív, než ho validace
// odmítne kvůli chybějícímu schema nebo korunám místo haléřů.
validateImport.upgrade = function (obj) {
  if (typeof migrate !== 'function') return obj;
  try { const mg = migrate(obj); return mg.ok ? mg.doc : obj; } catch (e) { return obj; }
};

function importJSON(text, name) {
  let obj = null;
  try { obj = JSON.parse(String(text)); }
  catch (e) {
    return importJSON.reject(name, ['Soubor není platný JSON — nejspíš to není záloha rozpočtu.'])
      .then(function () { return { ok: false, reason: 'parse' }; });
  }
  obj = validateImport.upgrade(obj);
  const v = validateImport(obj);
  if (!v.ok) return importJSON.reject(name, v.errors).then(function () { return { ok: false, reason: 'invalid', errors: v.errors }; });
  return applyImport(obj, 'replace');
}

importJSON.reject = function (name, errors) {
  return openSheet({
    title: 'Tuhle zálohu načíst nejde',
    build: function (body) {
      body.appendChild(el('p', { class: 'sheet-text' },
        'Soubor ' + (name || '') + ' zůstal nedotčený a tvoje data taky.'));
      const ul = el('ul', { class: 'sheet-list' });
      (errors || []).slice(0, 5).forEach(function (e) { ul.appendChild(el('li', null, e)); });
      body.appendChild(ul);
    },
    foot: [{ label: TXT.ok, kind: 'primary', value: true }],
  });
};

// 'replace' je výchozí a v UI jediný režim. Sloučení by tiše zdvojilo
// každý řádek i každý součet — a obě kopie by přitom vypadaly správně.
function applyImport(obj, mode) {
  if (mode && mode !== 'replace') toast('Slučování zatím neumím, záloha se načte jako náhrada.');
  obj = validateImport.upgrade(obj);
  const v = validateImport(obj);
  if (!v.ok) return importJSON.reject('', v.errors).then(function () { return { ok: false, reason: 'invalid' }; });
  const s = v.summary;
  const body = 'Nahradí ' + applyImport.plural(s.months, 'měsíc', 'měsíce', 'měsíců')
    + ', ' + applyImport.plural(s.entries, 'položku', 'položky', 'položek')
    + ' a ' + applyImport.plural(s.tx, 'nákup', 'nákupy', 'nákupů')
    + '. Současná data se ztratí.';

  return confirmSheet({ title: TXT.importConfirmTitle, body: body, okLabel: 'Nahradit', danger: true })
    .then(function (yes) {
      if (!yes) return { ok: false, reason: 'cancel' };
      // Snapshot PŘED záměnou — kdyby se ukázalo, že to nebyla ta pravá záloha.
      // Snímek se dělá z toho, co je NA DISKU, ne z toho, co je v paměti.
      // Po havarijním načtení je v paměti prázdný dokument a snímek z něj
      // by nezachránil nic — originál přitom pořád leží v úložišti.
      try {
        const naDisku = storageGet(STORE_KEY);
        snapshotSave('pred-importem', (naDisku && naDisku.length > 2) ? naDisku : state);
      } catch (e) {}
      const clean = storageClone(obj);
      // Osiřelé nákupy se nechávají být — viz komentář ve validateImport.
      delete clean.appVersion; delete clean.exportedAt; delete clean.counts;
      const rep = loadParseObj(clean);      // migrace + tvrdá validace úložiště
      if (!rep.ok) {
        toast('Zálohu se nepodařilo načíst (' + rep.reason + '). Tvoje data zůstala beze změny.');
        return { ok: false, reason: rep.reason };
      }
      state = rep.doc;                      // NAHRAZUJE. Nikdy nespojuje.
      if (typeof loadUnblock === 'function') loadUnblock(false);
      invalidateAll();
      goScreen('month');
      const st = saveNow();
      toast(st && st.ok ? 'Záloha je načtená.' : 'Záloha je načtená, ale uložit ji do telefonu se nepovedlo.');
      if (v.warnings.length) toast(v.warnings[0]);
      return { ok: true, reason: 'ok', summary: s };
    });
}

// Čeština: 1 → jednotné, 2–4 → množné, jinak druhý pád (41 položek).
applyImport.plural = function (n, one, few, many) {
  const k = Math.max(0, Math.round(Number(n) || 0));
  return k + ' ' + (k === 1 ? one : (k >= 2 && k <= 4 ? few : many));
};

/* ======================= tisk ======================= */

// Tisk celého roku: dvanáct měsíčních sestav za sebou. Uživatel chtěl mít
// rok pohromadě, takže ho musí jít pohromadě i vytisknout.
function renderPrintYear(y) {
  const host = qs('#screen-print');
  if (!host) return null;
  const all = document.createDocumentFragment();
  for (let m = 0; m < 12; m++) {
    renderPrintView(y, m, true);
    const kids = Array.prototype.slice.call(host.childNodes);
    for (const n of kids) {
      // Nápovědu i patičku bere jen první měsíc, ať se to neopakuje 12×.
      if (m > 0 && n.classList && (n.classList.contains('print-hint') || n.classList.contains('pv-sub'))) continue;
      all.appendChild(n);
    }
    if (m < 11) {
      const br = el('div', { class: 'pv-break' });
      br.style.breakAfter = 'page';
      br.style.pageBreakAfter = 'always';
      all.appendChild(br);
    }
  }
  host.replaceChildren(all);
  return host;
}

function renderPrintView(y, m, keepTitle) {
  const host = qs('#screen-print');
  if (!host) return null;
  const frag = document.createDocumentFragment();
  // Nápověda pro appku na ploše. V tisku ji schová .no-print z 15-print.css.
  const hint = el('div', { class: 'print-hint no-print' });
  Object.assign(hint.style, { display: 'flex', gap: 'var(--sp-3)', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 'var(--sp-4)', padding: 'var(--sp-3)',
    border: '1px solid var(--hairline-strong)', borderRadius: 'var(--r-md)' });
  hint.appendChild(el('span', null, 'Pro PDF klepni na Sdílet → Tisk'));
  hint.appendChild(el('button', { class: 'btn btn-primary', type: 'button', 'data-act': 'io.printClose' }, TXT.close));
  frag.appendChild(hint);
  frag.appendChild(el('h1', { class: 'pv-title' }, monthLabelCs(y, m) + (keepTitle ? '' : '')));   // nominativ
  frag.appendChild(el('p', { class: 'pv-sub' }, TXT.appName + ' · vytištěno ' + fmtDateLong(todayISO())));

  const yr = state.years[String(y)];
  if (!yr) { frag.appendChild(el('p', null, TXT.emptySection)); host.replaceChildren(frag); return host; }
  const cats = Object.create(null);
  (yr.catalog || []).forEach(function (c) { if (c && c.id) cats[c.id] = c; });
  const sums = Object.create(null);
  const tables = document.createDocumentFragment();

  SECTIONS.forEach(function (sec) {
    tables.appendChild(el('h2', { class: 'pv-sec' }, sec.label));
    const list = exportCSVMonth.rows(yr, m, sec, cats);
    sums[sec.key] = { plan: 0, act: 0 };
    if (!list.length) { tables.appendChild(el('p', { class: 'pv-empty' }, TXT.emptySection)); return; }
    const t = renderPrintView.table(['Položka', TXT.colDue, TXT.colPlan, TXT.colActual, TXT.colPaid]);
    const tb = el('tbody');
    let sp = 0, sa = 0;
    list.forEach(function (e) {
      const c = cats[e.cat], act = renderPrintView.actual(yr, m, e);
      sp += Number.isSafeInteger(e.plan) ? e.plan : 0;
      sa += Number.isSafeInteger(act) ? act : 0;
      const day = (e.due === null || e.due === undefined) ? c.dueDay : e.due;
      tb.appendChild(renderPrintView.row('td', [
        (c.icon ? c.icon + ' ' : '') + c.name,
        sec.hasDue ? fmtDateShort(dueDateFor(y, m, day)) : '',
        formatCzk(e.plan), formatCzk(act),
        sec.hasDue ? (e.paid ? 'ano' : 'ne') : '']));
    });
    t.appendChild(tb);
    const tf = el('tfoot');
    tf.appendChild(renderPrintView.row('th', [TXT.total, '', formatCzk(sp), formatCzk(sa), '']));
    t.appendChild(tf);
    tables.appendChild(t);
    sums[sec.key] = { plan: sp, act: sa };
  });

  // KPI se počítají ze sekcí, proto se skládají až teď — ale patří nad ně.
  let op = 0, oa = 0;
  SECTIONS.forEach(function (s) { if (s.dir < 0) { op += sums[s.key].plan; oa += sums[s.key].act; } });
  // Nezařazené výdaje musí být i na papíře, jinak by tištěný zůstatek
  // nesouhlasil s tím, co appka ukazuje na obrazovce.
  let nezarazeno = 0;
  try {
    const md = computeMonth(y, m);
    const t = md.orphans && md.orphans.total;
    nezarazeno = Number.isSafeInteger(t) ? t : 0;   // ne |0, to přeteče nad 21 mil. Kč
  } catch (e) { nezarazeno = 0; }
  oa += nezarazeno;
  const kpi = renderPrintView.table(['', TXT.colPlan, TXT.colActual]);
  const kb = el('tbody');
  kb.appendChild(renderPrintView.row('td', [TXT.kpiIncome, formatCzk(sums.income.plan), formatCzk(sums.income.act)]));
  kb.appendChild(renderPrintView.row('td', [TXT.kpiExpense, formatCzk(op), formatCzk(oa)]));
  if (nezarazeno) {
    kb.appendChild(renderPrintView.row('td', ['z toho nezařazené nákupy', '', formatCzk(nezarazeno)]));
  }
  kb.appendChild(renderPrintView.row('th', [TXT.kpiLeft, formatCzk(sums.income.plan - op), formatCzk(sums.income.act - oa)]));
  kpi.appendChild(kb);
  frag.appendChild(kpi);
  frag.appendChild(tables);

  // Seznam plateb — co má v tomhle měsíci splatnost.
  const pay = [];
  SECTIONS.forEach(function (sec) {
    if (!sec.hasDue) return;
    exportCSVMonth.rows(yr, m, sec, cats).forEach(function (e) {
      const c = cats[e.cat];
      const iso = dueDateFor(y, m, (e.due === null || e.due === undefined) ? c.dueDay : e.due);
      if (iso) pay.push({ iso: iso, name: c.name, amt: e.plan, paid: !!e.paid });
    });
  });
  pay.sort(function (a, b) { return a.iso < b.iso ? -1 : (a.iso > b.iso ? 1 : 0); });
  frag.appendChild(el('h2', { class: 'pv-sec' }, 'Platby v měsíci'));
  if (!pay.length) frag.appendChild(el('p', { class: 'pv-empty' }, TXT.emptySection));
  else {
    const pt = renderPrintView.table([TXT.colDue, 'Položka', TXT.colPlan, TXT.colPaid]);
    const pb = el('tbody');
    pay.forEach(function (p) {
      pb.appendChild(renderPrintView.row('td', [fmtDateLong(p.iso), p.name, formatCzk(p.amt), p.paid ? 'ano' : 'ne']));
    });
    pt.appendChild(pb);
    frag.appendChild(pt);
  }
  host.replaceChildren(frag);
  return host;
}

// Skutečnost: act === null znamená "spočítej z deníku" (viz _MODEL.md).
renderPrintView.actual = function (yr, m, entry) {
  if (entry.act !== null && entry.act !== undefined) return entry.act;
  let t = 0;
  const tx = (yr && Array.isArray(yr.tx)) ? yr.tx : [];
  for (let i = 0; i < tx.length; i++) {
    const x = tx[i];
    if (x && !x.del && x.m === m && x.cat === entry.cat && Number.isSafeInteger(x.amt)) t += x.amt;
  }
  return t;
};

// <thead> zajistí, že se hlavička opakuje na každé stránce.
renderPrintView.table = function (headCells) {
  const t = el('table', { class: 'pv-table' });
  Object.assign(t.style, { width: '100%', borderCollapse: 'collapse', marginBottom: 'var(--sp-4)' });
  const th = el('thead');
  th.appendChild(renderPrintView.row('th', headCells));
  t.appendChild(th);
  return t;
};

renderPrintView.row = function (tag, cells) {
  const tr = el('tr');
  cells.forEach(function (v, i) {
    const c = el(tag, null, v);
    Object.assign(c.style, { borderBottom: '1px solid var(--hairline)', padding: '3px 4px',
      textAlign: i === 0 ? 'left' : 'right' });
    tr.appendChild(c);
  });
  return tr;
};

// window.print() musí padnout uvnitř jejího klepnutí, jinak iOS hlásí
// "blokován automatický tisk". A protože v appce na ploše stejně často
// neudělá nic, je nad přehledem ještě ruční návod.
function printMonth(y, m) {
  renderPrintView(y, m);
  printMonth.overlay(true);
  try { window.print(); } catch (e) {}
}

function printYear(y) {
  renderPrintYear(y);
  printMonth.overlay(true);
  try { window.print(); } catch (e) {}
}

printMonth.overlay = function (on) {
  const node = qs('#screen-print');
  if (!node) return;
  const s = node.style;
  if (on) {
    document.body.classList.add('is-print-preview');
    s.setProperty('display', 'block', 'important');    // přebije .print-only
    Object.assign(s, { position: 'fixed', left: '0', right: '0', top: '0', bottom: '0',
      zIndex: '60', overflow: 'auto', background: 'var(--bg)', color: 'var(--ink)',
      padding: 'calc(var(--safe-t) + 12px) 12px calc(var(--safe-b) + 24px)' });
    node.setAttribute('aria-hidden', 'false');
  } else {
    document.body.classList.remove('is-print-preview');
    s.removeProperty('display');
    Object.assign(s, { position: '', left: '', right: '', top: '', bottom: '',
      zIndex: '', overflow: '', background: '', color: '', padding: '' });
    node.setAttribute('aria-hidden', 'true');
  }
};

// Na papír patří přehled, ne appka. A pevná pozice by vytiskla jen
// první stránku, proto se pro tisk zruší.
function beforePrintHook() {
  const node = qs('#screen-print');
  if (!node || !node.firstChild) return;      // není co tisknout — na appku nesahat
  const main = qs('#main');
  if (main) main.classList.add('no-print');
  Object.assign(node.style, { position: 'static', overflow: 'visible', zIndex: '',
    padding: '0', left: '', right: '', top: '', bottom: '' });
}

function afterPrintHook() {
  const main = qs('#main');
  if (main) main.classList.remove('no-print');
  if (document.body.classList.contains('is-print-preview')) printMonth.overlay(true);
}

// Safari beforeprint/afterprint nemá — chytá se přepnutí tiskového média.
printMonth.wire = function () {
  if (printMonth.wired) return;
  printMonth.wired = true;
  window.addEventListener('beforeprint', beforePrintHook);
  window.addEventListener('afterprint', afterPrintHook);
  try {
    const mq = window.matchMedia('print');
    const fn = function (e) { if (e.matches) beforePrintHook(); else afterPrintHook(); };
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
  } catch (e) {}
};
if (typeof window !== 'undefined' && window.addEventListener) printMonth.wire();

/* ======================= akce ======================= */

(function () {
  function wipeNow() {
    // Poslední záchranná síť. Prohlížeč neumí potvrdit, že se stažená
    // záloha opravdu uložila, takže se před vymazáním pořídí ještě snímek
    // v úložišti. Snímky ani odložené poškozené kopie se NEMAŽOU — kdyby
    // se ukázalo, že soubor nikde není, je z čeho vrátit.
    // Snímek se dělá jen tehdy, když je co zachraňovat. Druhé vymazání
    // hned po prvním by jinak přepsalo dobrý snímek prázdným dokumentem
    // a tlačítko „Přece jen vrátit" by vrátilo nic.
    let snapKey = null, maData = false;
    try {
      const y0 = state.years[String(state.activeYear)];
      maData = !!(y0 && (y0.catalog.length || y0.tx.length));
      if (maData) snapKey = snapshotSave('pred-vymazanim', JSON.stringify(state));
    } catch (e) { snapKey = null; }
    // snapshotSave při plném úložišti nic nevyhodí — vrátí null. Bez téhle
    // kontroly by se mazalo i tehdy, když záchranná kopie nevznikla.
    if (maData && !snapKey) {
      toast('Zálohu do paměti se nepodařilo udělat, tak jsem nic nesmazala. '
        + 'Stáhni si zálohu do souboru a zkus to znovu.', { ms: 9000 });
      return;
    }
    try {
      storageRemove(STORE_KEY);
      storageRemove(BACKUP_KEY);
    } catch (e) {}
    state = emptyDoc();
    if (typeof loadUnblock === 'function') loadUnblock(false);
    invalidateAll();
    saveNow();
    goScreen('month');
    toast('Hotovo. Aplikace je prázdná.', {
      ms: 9000, action: 'Přece jen vrátit',
      onAction: function () {
        // snapshotList() vrací nejnovější první; ten z vymazání je na špici.
        const snaps = (typeof snapshotList === 'function') ? snapshotList() : [];
        // JEN snímek z tohohle vymazání. Vrátit „něco, co zbylo" a napsat
        // u toho „Data jsou zpátky" je horší než neudělat nic — přestala by
        // hledat skutečnou zálohu.
        const usable = snaps.filter(function (x) { return x && x.ok; });
        const last = (snapKey && usable.find(function (x) { return x.key === snapKey; })) || null;
        if (!last) { toast('Není z čeho vrátit. Načti zálohu ze souboru.'); return; }
        if (!last || typeof snapshotRestore !== 'function') {
          toast('Vrátit už to nejde. Načti zálohu ze souboru.');
          return;
        }
        const r = snapshotRestore(last.key || last);
        if (r && r.ok) { invalidateAll(); renderApp(); toast('Data jsou zpátky.'); }
        else toast('Vrátit se to nepodařilo. Načti zálohu ze souboru.');
      }
    });
  }

  const acts = {
    'io.export': function () { exportJSON(); },
    'io.exportCsv': function () { exportCSVMonth(state.activeYear, state.ui.month); },
    'io.print': function () { printMonth(state.activeYear, state.ui.month); },
    'io.printYear': function () { printYear(state.activeYear); },
    'io.printClose': function () { printMonth.overlay(false); },

    // Výběr souboru musí odstartovat uvnitř klepnutí, jinak se dialog
    // na iOS vůbec neotevře.
    'io.import': function () {
      pickImportFile().then(function (p) {
        if (p && p.ok) return importJSON(p.text, p.name);
        if (p && p.reason === 'empty') toast('Ten soubor je prázdný.');
        else if (p && p.reason === 'read') toast('Soubor se nepodařilo přečíst.');
      });
    },

    // Záloha VŽDY dřív než mazání. Bez ní se maže až po druhém vědomém ano.
    // Poškozená data se dají dostat z appky ven. Bez tohohle byly odložené
    // bajty vaultem bez dveří: uložily se a nikdo se k nim nedostal.
    'io.rescue': function () {
      const list = (typeof quarantineList === 'function') ? quarantineList() : [];
      if (!list.length) { toast('Žádná poškozená data tu neleží.'); return; }
      const raw = storageGet(list[0].key);
      if (!raw) { toast('Odloženou kopii se nepodařilo přečíst.'); return; }
      const name = 'rozpocet-poskozena-data-' + todayISO() + '.txt';
      deliverFile(new Blob([raw], { type: 'text/plain;charset=utf-8' }), name, 'Poškozená data')
        .then(function (res) {
          if (!res || !res.ok) copyFallback(raw);
        });
    },

    'io.wipe': function () {
      confirmSheet({ title: TXT.wipeConfirmTitle, body: TXT.wipeConfirmBody, okLabel: TXT.wipe,
        danger: true, typeToConfirm: TXT.wipeConfirmType, typeWord: 'SMAZAT' })
        .then(function (yes) {
          if (!yes) return;
          exportJSON().then(function (res) {
            if (res && res.ok) return wipeNow();
            confirmSheet({ title: 'Zálohu se nepodařilo uložit',
              body: 'Můžeš to zkusit znovu, nebo smazat i bez zálohy. Vrátit to pak už nepůjde.',
              okLabel: 'Smazat i bez zálohy', danger: true })
              .then(function (ok) { if (ok) wipeNow(); });
          });
        });
    },
  };

  // ACTIONS se deklaruje až v 60-events.js, které se slepuje ZA tenhle
  // soubor — do té doby je ten const v dočasné mrtvé zóně. Registrace se
  // proto zkusí hned a při chybě se odloží za doběhnutí celé IIFE.
  const put = function () { Object.assign(ACTIONS, acts); };
  try { put(); } catch (e) { Promise.resolve().then(put); }
})();
