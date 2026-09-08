// Kod.gs — volitelná synchronizace Rozpočtu — vlastní: L4
// Vlastnosti skriptu: SPREADSHEET_ID a SYNC_SECRET (32–256 znaků).
// Nasadit jako webovou aplikaci: Spouštět jako Já; přístup Kdokoli.
// Není doOptions: POST musí být prostý požadavek text/plain, viz PROTOKOL.md.
var SYNC_VERSION = '1.0.0';
var SYNC_MAX_DOC = 1000000; // UTF-16 jednotky po JSON.stringify; nikoli bajty.
var SYNC_MAX_BODY = 1100000;
var SYNC_CHUNK = 40000; // Rezerva pod limitem 50 000 znaků na buňku.
var SYNC_MAX_CHUNKS = Math.ceil(SYNC_MAX_DOC / (SYNC_CHUNK - 1));
var SYNC_MARKER = 'rozpocet-sync-v1';
var SYNC_SECTIONS = {
  income: 'Příjmy', fixed: 'Fixní náklady', daily: 'Každodenní výdaje',
  savings: 'Úspory', debt: 'Dluh', subs: 'Předplatné'
};

function doGet(e) {
  return syncGuard_(function () {
    return syncLocked_(function () {
      var spreadsheet = syncSpreadsheet_();
      var current = syncRead_(spreadsheet);
      syncRepairOverview_(spreadsheet, current);
      return { ok: true, app: 'rozpocet-sync', version: SYNC_VERSION,
        hasDoc: current.doc !== null, rev: current.rev, updatedAt: current.updatedAt };
    });
  });
}

function doPost(e) {
  return syncGuard_(function () {
    var raw = e && e.postData && e.postData.contents;
    if (typeof raw !== 'string' || !raw.length) syncFail_(400, 'Chybí JSON tělo.');
    if (raw.length > SYNC_MAX_BODY) syncFail_(413, 'Požadavek přesahuje 1 100 000 znaků.');
    var body;
    try { body = JSON.parse(raw); } catch (_) { syncFail_(400, 'Tělo není platný JSON.'); }
    if (!syncObject_(body)) syncFail_(400, 'Tělo musí být JSON objekt.');
    syncAuthenticate_(body.secret);
    if (['ping', 'pull', 'push'].indexOf(body.op) === -1) syncFail_(400, 'Neznámá operace.');
    if (body.op === 'ping') return { ok: true };
    var json, rows;
    if (body.op === 'push') {
      if (!Number.isSafeInteger(body.baseRev) || body.baseRev < 0) {
        syncFail_(400, 'baseRev musí být nezáporné celé bezpečné číslo.');
      }
      json = JSON.stringify(body.doc);
      if (typeof json !== 'string') syncFail_(422, 'Chybí dokument.');
      if (json.length > SYNC_MAX_DOC) syncFail_(413, 'Dokument přesahuje 1 000 000 znaků.');
      rows = syncOverviewRows_(body.doc); // Validace před první změnou v tabulce.
    }
    return syncLocked_(function () {
      var spreadsheet = syncSpreadsheet_();
      var current = syncRead_(spreadsheet);
      syncRepairOverview_(spreadsheet, current);
      if (body.op === 'pull') {
        return current.doc === null ? { ok: true, rev: 0, doc: null } :
          { ok: true, rev: current.rev, updatedAt: current.updatedAt, doc: current.doc };
      }
      if (body.baseRev !== current.rev) {
        return { ok: false, code: 409, error: 'Revize se změnila. Slouč data a opakuj zápis.',
          rev: current.rev, doc: current.doc };
      }
      if (current.rev >= Number.MAX_SAFE_INTEGER) syncFail_(500, 'Došel rozsah revizí.');
      var nextRev = current.rev + 1;
      syncWrite_(spreadsheet, current, json, rows, nextRev, new Date().toISOString());
      return { ok: true, rev: nextRev };
    });
  });
}

// Každá zachycená chyba je JSON při HTTP 200. Výjimky Googlu se nepropagují
// do HTML stránky a jejich text se nevrací (mohl by obsahovat soukromá data).
function syncGuard_(action) {
  var result;
  try { result = action(); }
  catch (err) {
    result = err && err.syncCode ? { ok: false, code: err.syncCode, error: err.message } :
      { ok: false, code: 500, error: 'Chyba úložiště nebo služby Google. Zkus načíst data znovu.' };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function syncFail_(code, message) {
  var err = new Error(message);
  err.syncCode = code;
  throw err;
}

function syncObject_(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function syncDigest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
}

function syncAuthenticate_(provided) {
  if (typeof provided !== 'string' || !provided.length) syncFail_(401, 'Chybí nebo nesouhlasí tajný klíč.');
  var expected = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');
  if (!expected || expected.length < 32 || expected.length > 256) {
    syncFail_(500, 'Nastav vlastnost SYNC_SECRET na náhodný klíč o 32 až 256 znacích.');
  }
  // SHA-256 má vždy 32 bajtů: smyčka nemá předčasný návrat ani větev podle
  // společného prefixu. JS/JIT a samotné hashování nezaručují absolutní konstantní čas.
  var a = syncDigest_(provided), b = syncDigest_(expected), difference = 0;
  for (var i = 0; i < 32; i++) difference |= a[i] ^ b[i];
  if (difference !== 0) syncFail_(401, 'Chybí nebo nesouhlasí tajný klíč.');
}

function syncLocked_(action) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) syncFail_(503, 'Úložiště je zaneprázdněné. Zkus to znovu za chvíli.');
  try { return action(); }
  finally {
    // I při výjimce dopiš dávkované změny ještě uvnitř zámku.
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}

function syncSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) syncFail_(500, 'Nastav vlastnost SPREADSHEET_ID.');
  return SpreadsheetApp.openById(id);
}

// _data: A1 = formát, B1 = aktivní slot (-1 = prázdno, 0 nebo 1).
// A2:F2 = hlavičky; A3:F3 / A4:F4 = slot, rev, updatedAt, chunks, length, sha256.
// H2:H… a I2:I… = JSON chunky s prefixem j: (brání spuštění vzorce).
// Dvě kopie dovolí připravit nový dokument bez přepsání aktivní kopie.
function syncRead_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('_data');
  var empty = { rev: 0, updatedAt: null, doc: null, slot: -1 };
  if (!sheet || sheet.getLastRow() === 0) return empty;
  var pointer = sheet.getRange(1, 1, 1, 2).getValues()[0];
  if (pointer[0] !== SYNC_MARKER) syncFail_(500, 'List _data má neznámý formát. Obnov zálohu.');
  var slot = pointer[1];
  if (slot === -1) return empty;
  if (slot !== 0 && slot !== 1) syncFail_(500, 'List _data má poškozený ukazatel.');
  var meta = sheet.getRange(3 + slot, 1, 1, 6).getValues()[0];
  if (meta[0] !== slot || !Number.isSafeInteger(meta[1]) || meta[1] < 1 ||
      typeof meta[2] !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(meta[2]) ||
      !Number.isInteger(meta[3]) || meta[3] < 1 || meta[3] > SYNC_MAX_CHUNKS ||
      !Number.isInteger(meta[4]) || meta[4] < 1 || meta[4] > SYNC_MAX_DOC) {
    syncFail_(500, 'List _data má poškozená metadata.');
  }
  var parts = sheet.getRange(2, 8 + slot, meta[3], 1).getValues();
  var json = parts.map(function (row) {
    if (typeof row[0] !== 'string' || row[0].slice(0, 2) !== 'j:') syncFail_(500, 'Chybí část dokumentu.');
    return row[0].slice(2);
  }).join('');
  if (json.length !== meta[4] || Utilities.base64Encode(syncDigest_(json)) !== meta[5]) {
    syncFail_(500, 'Kontrolní součet dokumentu nesouhlasí. Obnov zálohu.');
  }
  var doc;
  try { doc = JSON.parse(json); } catch (_) { syncFail_(500, 'Uložený dokument není platný JSON.'); }
  return { rev: meta[1], updatedAt: meta[2], doc: doc, slot: slot };
}

function syncWrite_(spreadsheet, current, json, rows, rev, updatedAt) {
  var sheet = spreadsheet.getSheetByName('_data') || spreadsheet.insertSheet('_data');
  syncGrow_(sheet, 30, 9);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 2).setValues([[SYNC_MARKER, -1]]);
    sheet.getRange(2, 1, 1, 6).setValues([['slot', 'rev', 'updatedAt', 'chunks', 'length', 'sha256']]);
    sheet.getRange(1, 8, 1, 2).setValues([['JSON — slot 0', 'JSON — slot 1']]);
  }
  var slot = current.slot === 0 ? 1 : 0;
  var chunks = [];
  for (var offset = 0; offset < json.length;) {
    var end = Math.min(offset + SYNC_CHUNK, json.length);
    // Nerozděl emoji (UTF-16 surrogate pair) mezi dvě buňky.
    var last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 0xD800 && last <= 0xDBFF) end--;
    chunks.push(['j:' + json.slice(offset, end)]);
    offset = end;
  }
  sheet.getRange(2, 8 + slot, SYNC_MAX_CHUNKS, 1).clearContent();
  sheet.getRange(2, 8 + slot, chunks.length, 1).setNumberFormat('@').setValues(chunks);
  sheet.getRange(3 + slot, 3).setNumberFormat('@');
  sheet.getRange(3 + slot, 1, 1, 6).setValues([
    [slot, rev, updatedAt, chunks.length, json.length, Utilities.base64Encode(syncDigest_(json))]
  ]);
  SpreadsheetApp.flush(); // Celá neaktivní kopie musí existovat před změnou ukazatele.
  syncOverview_(spreadsheet, rows, rev);
  SpreadsheetApp.flush();
  sheet.getRange(1, 2).setValue(slot); // Commit: jediná buňka určuje platnou kopii.
  SpreadsheetApp.flush(); // Povinně ještě před uvolněním script locku.
}

function syncGrow_(sheet, rows, columns) {
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < columns) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
}

function syncRequire_(condition) {
  if (!condition) syncFail_(422, 'Dokument neodpovídá schématu Rozpočtu 1 nebo obsahuje neplatnou hodnotu.');
}

function syncMoney_(value) {
  syncRequire_(Number.isSafeInteger(value) && value >= 0);
  return value;
}
// Plán smí být prázdný (null = nezadáno), stejně jako skutečnost.
function syncMoneyOrNull_(value) {
  if (value === null || value === undefined) return null;
  return syncMoney_(value);
}


function syncId_(value) {
  syncRequire_(typeof value === 'string' && value.length > 0 && value.length <= 256);
  return value;
}

function syncUnique_(seen, id) {
  syncId_(id);
  syncRequire_(!seen.has(id));
  seen.add(id);
}

function syncRecord_(record) {
  syncRequire_(syncObject_(record));
  ['createdAt', 'updatedAt'].forEach(function (field) {
    if (record[field] !== undefined) syncRequire_(typeof record[field] === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(record[field]) &&
      syncDate_(record[field].slice(0, 10)) &&
      !isNaN(Date.parse(record[field])));
  });
  ['del', 'archived', 'recurring', 'autoFilled'].forEach(function (field) {
    if (record[field] !== undefined) syncRequire_(typeof record[field] === 'boolean');
  });
}

function syncDay_(value) {
  return Number.isInteger(value) && value >= 1 && value <= 31;
}

function syncDate_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  var date = new Date(value + 'T12:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function syncDue_(year, month, override, fallback) {
  if (typeof override === 'string') return override;
  var day = override == null ? fallback : override;
  if (day == null) return '';
  day = Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return year + '-' + ('0' + (month + 1)).slice(-2) + '-' + ('0' + day).slice(-2);
}

function syncText_(value) {
  // Název začínající = nesmí v Sheets spustit vzorec ani IMPORTXML.
  return /^[=+@\-\t\r\n]/.test(value) ? "'" + value : value;
}

function syncOverviewRows_(doc) {
  syncRequire_(syncObject_(doc) && doc.app === 'rozpocet' && doc.schema === 1 && syncObject_(doc.years));
  var rows = [];
  Object.keys(doc.years).sort().forEach(function (key) {
    var y = doc.years[key];
    syncRequire_(/^\d{4}$/.test(key) && +key >= 1900 && +key <= 9999 && syncObject_(y));
    syncRequire_(y.year === +key && Array.isArray(y.catalog) && Array.isArray(y.months) &&
      y.months.length === 12 && Array.isArray(y.tx));
    var catalog = new Map(), ids = new Set(), entryIds = new Set(), txIds = new Set(), totals = new Map();
    y.catalog.forEach(function (cat) {
      syncRecord_(cat);
      syncUnique_(ids, cat.id);
      syncRequire_(Object.prototype.hasOwnProperty.call(SYNC_SECTIONS, cat.sec) &&
        typeof cat.name === 'string' && cat.name.length <= 40000 &&
        (cat.dueDay == null || syncDay_(cat.dueDay)));
      if (cat.goal != null) {
        syncRequire_(cat.sec === 'savings' && syncObject_(cat.goal));
        syncMoney_(cat.goal.target);
        syncMoney_(cat.goal.startBalance);
        syncRequire_(cat.goal.targetDate == null || syncDate_(cat.goal.targetDate));
      }
      catalog.set(cat.id, cat);
    });
    y.tx.forEach(function (tx) {
      syncRecord_(tx);
      syncUnique_(txIds, tx.id);
      syncId_(tx.cat);
      syncRequire_(Number.isInteger(tx.m) && tx.m >= 0 && tx.m < 12 && syncDate_(tx.d) &&
        (tx.del == null || typeof tx.del === 'boolean'));
      syncMoney_(tx.amt);
      if (tx.del) return;
      var group = tx.m + ':' + tx.cat;
      totals.set(group, syncMoney_((totals.get(group) || 0) + tx.amt));
    });
    y.months.forEach(function (month, m) {
      syncRequire_(syncObject_(month) && month.m === m && Array.isArray(month.entries));
      month.entries.forEach(function (entry) {
        syncRecord_(entry);
        syncUnique_(entryIds, entry.id);
        syncId_(entry.cat);
        syncMoneyOrNull_(entry.plan);
        if (entry.act !== null) syncMoney_(entry.act);
        syncRequire_(typeof entry.paid === 'boolean' && (entry.del == null || typeof entry.del === 'boolean') &&
          (entry.due == null || syncDay_(entry.due) || syncDate_(entry.due)) &&
          (entry.paidAt == null || syncDate_(entry.paidAt)));
        if (entry.del) return;
        var cat = catalog.get(entry.cat);
        var actual = entry.act === null ? (totals.get(m + ':' + entry.cat) || 0) : entry.act;
        rows.push([+key, m + 1, cat ? SYNC_SECTIONS[cat.sec] : 'Nezařazeno',
          syncText_(cat ? cat.name : 'Chybějící kategorie: ' + entry.cat),
          entry.plan / 100, actual / 100, entry.paid ? 'Ano' : 'Ne',
          syncDue_(+key, m, entry.due, cat ? cat.dueDay : null)]);
      });
    });
  });
  return rows;
}

function syncOverviewNote_(rev) {
  return 'Odvozený přehled serverové revize ' + rev + '. Upravuj data v aplikaci.';
}

function syncRepairOverview_(spreadsheet, current) {
  var sheet = spreadsheet.getSheetByName('Přehled');
  if (!sheet && current.doc === null) return;
  if (!sheet || sheet.getRange(1, 1).getNote() !== syncOverviewNote_(current.rev)) {
    // I tvrdé přerušení mezi přehledem a commitem se opraví při dalším čtení.
    syncOverview_(spreadsheet, current.doc === null ? [] : syncOverviewRows_(current.doc), current.rev);
  }
}

function syncOverview_(spreadsheet, rows, rev) {
  // Čísla zůstávají čísly pro grafy; české locale zobrazí desetinnou čárku.
  if (spreadsheet.getSpreadsheetLocale() !== 'cs_CZ') spreadsheet.setSpreadsheetLocale('cs_CZ');
  var sheet = spreadsheet.getSheetByName('Přehled') || spreadsheet.insertSheet('Přehled');
  syncGrow_(sheet, rows.length + 1, 8);
  sheet.getRange(1, 1).setNote('Probíhá obnova přehledu.');
  SpreadsheetApp.flush(); // Značka musí přežít případné přerušení clearContents.
  sheet.clearContents();
  var headers = ['Rok', 'Měsíc', 'Sekce', 'Položka', 'Plán', 'Skutečnost', 'Zaplaceno', 'Splatnost'];
  sheet.getRange(1, 1, 1, 8).setValues([headers]).setFontWeight('bold');
  if (rows.length) {
    sheet.getRange(2, 3, rows.length, 2).setNumberFormat('@');
    sheet.getRange(2, 8, rows.length, 1).setNumberFormat('@');
    sheet.getRange(2, 1, rows.length, 8).setValues(rows);
    sheet.getRange(2, 1, rows.length, 2).setNumberFormat('0');
    sheet.getRange(2, 5, rows.length, 2).setNumberFormat('#,##0.00 "Kč"');
  }
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, 2, 80);
  sheet.setColumnWidth(3, 180);
  sheet.setColumnWidth(4, 240);
  sheet.setColumnWidths(5, 2, 140);
  sheet.setColumnWidths(7, 2, 110);
  SpreadsheetApp.flush();
  sheet.getRange(1, 1).setNote(syncOverviewNote_(rev));
}
