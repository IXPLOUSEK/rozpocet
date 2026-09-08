// 51-journal.js — deník nákupů: rychlý zápis, filtr, seskupení po dnech — vlastní: L8
// Kvůli tomuhle appka poráží tabulku: místo odhadu měsíční sumy se každý
// nákup zapíše a součet kategorie se dopočítá sám.
//
// Fragment smí zabrat jen sedm jmen (viz _CONTRACT.md) a tady jsou všechna.
// Soukromí pomocníci proto visí na renderJournalScreen jako vlastnosti —
// nezakládají ve sdíleném scope nové jméno. Deklarace funkcí se vytahují
// nahoru, takže tenhle zápis smí stát před nimi.
renderJournalScreen.h = {

  cap: 200,   // kolik řádků najednou; zbytek přes „Načíst starší“

  // Aktivní rok z modelu, se záložní cestou přímo do state, aby deník
  // nespadl, dokud datová vrstva ještě není hotová.
  year: function () {
    try { const y = getYear(state.activeYear); if (y) return y; } catch (e) {}
    try { return state.years[String(state.activeYear)] || null; } catch (e) { return null; }
  },

  // Katalogová položka, nebo null.
  cat: function (id) {
    try { return id ? (getCat(id) || null) : null; } catch (e) { return null; }
  },

  // „Nezařazeno“ musí být přesně ta množina, kterou zná 34-derived.js:
  // nákup, který se nepromítá do žádného řádku měsíce (kategorie smazaná,
  // archivovaná, nebo řádek v tom měsíci prostě není). Kdyby deník počítal
  // jinak, ukazoval by peníze v koši, který na obrazovce Měsíc nikde není.
  orphanSet: function (m) {
    const key = state.rev + ':' + state.activeYear + ':' + m;
    if (this._oKey !== key) {
      const s = new Set();
      try { for (const t of orphanTx(state.activeYear, m)) s.add(t.id); }
      catch (e) { return null; }
      this._oKey = key; this._oSet = s;
    }
    return this._oSet;
  },
  isOrphan: function (t) {
    const s = this.orphanSet(t.m);
    return s ? s.has(t.id) : !this.cat(t.cat);
  },

  // Nabídka kategorií: bez archivovaných, po sekcích.
  catalogList: function () {
    const yr = this.year();
    const out = ((yr && Array.isArray(yr.catalog)) ? yr.catalog : [])
      .filter(function (c) { return c && c.id && !c.archived; });
    const rank = function (k) { return SECTIONS.findIndex(function (s) { return s.key === k; }); };
    out.sort(function (a, b) {
      return (rank(a.sec) - rank(b.sec)) || (num(a.order) - num(b.order)) || cmpCs(a.name, b.name);
    });
    return out;
  },

  // Bez diakritiky a malými písmeny — „jidlo“ musí najít „Jídlo“.
  norm: function (s) {
    return String(s === null || s === undefined ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  },

  // Nesmazané nákupy aktivního roku v rozpočtovém měsíci m.
  // Filtruje se na tx.m, NE na tx.d: nákup z 1. února, který patří do ledna,
  // musí zůstat v lednu.
  monthTx: function (m) {
    const yr = this.year();
    return ((yr && Array.isArray(yr.tx)) ? yr.tx : [])
      .filter(function (t) { return t && !t.del && t.m === m; });
  },

  // Stav filtru a hledání ze state.ui.
  ui: function () {
    const f = typeof state.ui.journalFilter === 'string' ? state.ui.journalFilter : 'all';
    const raw = typeof state.ui.journalSearch === 'string' ? state.ui.journalSearch : '';
    const q = this.norm(raw.trim());
    return { filter: f, raw: raw, q: q, on: f !== 'all' || q !== '' };
  },

  // Projde nákup filtrem a hledáním?
  match: function (t, filter, q) {
    const c = this.cat(t.cat);
    const orphan = this.isOrphan(t);
    if (filter === '__none') { if (!orphan) return false; }
    else if (filter !== 'all' && (orphan || !c || c.id !== filter)) return false;
    if (!q) return true;
    return this.norm((c ? c.name : 'Nezařazeno') + ' ' + (t.note || '')).indexOf(q) >= 0;
  },

  label: function (c) { return c ? ((c.icon ? c.icon + ' ' : '') + c.name) : 'Nezařazeno'; },

  chip: function (val, label, act) {
    const n = tpl('tpl-chip');
    n.setAttribute('type', 'button');
    n.dataset.val = val;
    if (act) n.dataset.act = act; else n.removeAttribute('data-act');
    setText(n.querySelector('[data-d="label"]'), label);
    return n;
  },

  // Vodorovný pás, ve kterém chipy nezalomí řádek.
  strip: function (attrs) {
    const a = attrs || {};
    a.style = 'display:flex;gap:var(--sp-2);overflow-x:auto;overscroll-behavior-x:contain;'
      + 'padding-block:2px;scrollbar-width:none';
    return el('div', a);
  },

  // Rozbalovací seznam všech kategorií, seskupený po sekcích.
  catSelect: function (cats, withNone) {
    const sel = el('select', { class: 'field-input' });
    sel.dataset.f = 'cat';
    if (withNone) sel.appendChild(el('option', { value: '' }, 'Nezařazeno'));
    for (const s of SECTIONS) {
      const inSec = cats.filter(function (c) { return c.sec === s.key; });
      if (!inSec.length) continue;
      const og = el('optgroup', { label: s.short });
      for (const c of inSec) og.appendChild(el('option', { value: c.id }, this.label(c)));
      sel.appendChild(og);
    }
    return sel;
  },

  // Pole z tpl-field s nastavenými atributy.
  field: function (label, name, attrs) {
    const f = tpl('tpl-field');
    setText(f.querySelector('[data-d="label"]'), label);
    const i = f.querySelector('input');
    i.dataset.f = name;
    for (const k in (attrs || {})) i.setAttribute(k, attrs[k]);
    return f;
  },

  // Chybová hláška u pole. Prázdná zpráva stav uklidí.
  mark: function (input, msg) {
    const field = input ? input.closest('.field') : null;
    if (field) field.classList.toggle('is-error', !!msg);
    if (field) setText(field.querySelector('.field-hint'), msg || '');
    if (msg) { announce(msg); try { input.focus({ preventScroll: true }); } catch (e) {} }
    return null;
  },
};

/* ======================= obrazovka Deník ============================== */

// Strukturální vykreslení. Skořápka (hlavička, filtr, hledání, hostitel
// seznamu) vzniká jen tady; seznam plní applyJournalFilter, aby psaní do
// hledání nezničilo pole, ve kterém je kurzor.
function renderJournalScreen() {
  const host = qs('#screen-journal');
  if (!host) return;
  const H = renderJournalScreen.h;
  const m = state.ui.month;

  // Strop řádků platí pro jeden měsíc; po přepnutí se vrací na základ.
  const stamp = state.activeYear + '-' + m;
  if (host.dataset.limitFor !== stamp) {
    host.dataset.limitFor = stamp;
    host.dataset.limit = String(H.cap);
  }
  const frag = document.createDocumentFragment();

  // --- hlavička: kolik a kolikrát ---
  const head = el('section', { class: 'card' });
  for (const k of [['Utraceno v deníku', 'jrn-total'], ['Zápisů', 'jrn-count']]) {
    const kpi = tpl('tpl-kpi');
    setText(kpi.querySelector('[data-d="label"]'), k[0]);
    kpi.querySelector('[data-d="value"]').id = k[1];
    kpi.querySelector('[data-d="hint"]').id = k[1] + '-hint';
    head.appendChild(kpi);
  }
  frag.appendChild(head);

  // --- filtr: Vše + kategorie se zápisem + Nezařazeno, když jsou sirotci ---
  const bar = H.strip({ id: 'jrn-filters', role: 'group', 'aria-label': 'Filtr kategorií' });
  const buckets = new Map();
  for (const t of H.monthTx(m)) {
    const c = H.cat(t.cat);
    const orphan = H.isOrphan(t) || !c;
    const key = orphan ? '__none' : c.id;
    const cur = buckets.get(key) || { sum: 0, label: orphan ? 'Nezařazeno' : H.label(c) };
    cur.sum += Number.isSafeInteger(t.amt) ? t.amt : 0;
    buckets.set(key, cur);
  }
  bar.appendChild(H.chip('all', 'Vše', 'journal.filter'));
  const keys = Array.from(buckets.keys()).filter(function (k) { return k !== '__none'; });
  keys.sort(function (a, b) {
    return (buckets.get(b).sum - buckets.get(a).sum)
      || cmpCs(buckets.get(a).label, buckets.get(b).label);
  });
  for (const k of keys) bar.appendChild(H.chip(k, buckets.get(k).label, 'journal.filter'));
  // Osiřelé nákupy musí být vidět, jinak by se po smazání kategorie ztratily
  // z filtru a součet košů by přestal sedět na celek měsíce.
  if (buckets.has('__none')) bar.appendChild(H.chip('__none', 'Nezařazeno', 'journal.filter'));
  frag.appendChild(bar);

  // --- hledání v poznámce a v názvu kategorie ---
  const fs = H.field('Hledat', '', { type: 'search', enterkeyhint: 'search',
    autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'Hledat v poznámce nebo kategorii' });
  fs.querySelector('[data-d="label"]').classList.add('sr-only');
  fs.querySelector('[data-d="hint"]').remove();
  const search = fs.querySelector('input');
  search.id = 'jrn-search';
  search.removeAttribute('data-f');
  search.value = H.ui().raw;
  search.addEventListener('input', function () {
    state.ui.journalSearch = search.value;
    applyJournalFilter();
  });
  frag.appendChild(fs);

  frag.appendChild(el('div', { id: 'jrn-list' }));
  const more = el('button', { class: 'btn', id: 'jrn-more', type: 'button',
    dataset: { act: 'journal.more' } }, 'Načíst starší');
  more.hidden = true;
  frag.appendChild(more);

  host.replaceChildren(frag);
  applyJournalFilter();
}

// Jeden řádek nákupu. Poznámka jde přes textContent, takže „<script>“
// skončí na obrazovce jako text a ne jako značka.
function renderTxItem(tx) {
  const H = renderJournalScreen.h;
  const node = tpl('tpl-tx-item');
  const c = H.cat(tx.cat);
  const orphan = H.isOrphan(tx);
  const name = c ? c.name : 'Nezařazeno';
  node.dataset.id = tx.id;
  node.setAttribute('type', 'button');
  setText(node.querySelector('[data-d="icon"]'), (c && c.icon) ? c.icon : '🧾');
  const nameNode = node.querySelector('[data-d="name"]');
  setText(nameNode, name);
  if (orphan) nameNode.classList.add('is-muted');
  // Nákup mimo řádky měsíce se nesmí tvářit, že se někam počítá.
  setText(node.querySelector('[data-d="note"]'),
    (tx.note || '') + (orphan ? ((tx.note ? ' · ' : '') + 'není v rozpočtu měsíce') : ''));
  setText(node.querySelector('[data-d="amt"]'), formatCzk(tx.amt));
  node.setAttribute('aria-label',
    name + ', ' + formatCzk(tx.amt) + ', ' + fmtDateShort(tx.d) + ', upravit');
  return node;
}

// Seskupení po dnech: nejnovější den nahoře, každý den má mezisoučet.
function txDayGroups(list) {
  const map = new Map();
  for (const t of (list || [])) {
    if (!t || typeof t.d !== 'string') continue;
    let g = map.get(t.d);
    if (!g) { g = { d: t.d, label: '', sum: 0, items: [] }; map.set(t.d, g); }
    g.items.push(t);
    g.sum += Number.isSafeInteger(t.amt) ? t.amt : 0;
  }
  const out = Array.from(map.values());
  // YYYY-MM-DD se porovná jako řetězec. Žádný Date, žádné UTC.
  out.sort(function (a, b) { return a.d < b.d ? 1 : (a.d > b.d ? -1 : 0); });
  const dnes = todayISO();
  for (const g of out) {
    g.items.sort(function (x, y) {
      const ax = String(x.updatedAt || ''), ay = String(y.updatedAt || '');
      return ax !== ay ? (ax < ay ? 1 : -1) : String(y.id).localeCompare(String(x.id));
    });
    const dd = daysBetween(g.d, dnes);
    if (dd === 0) g.label = 'Dnes';
    else if (dd === 1) g.label = 'Včera';
    else {
      // fmtDateLong dá „8. září 2026“; v deníku jednoho roku se rok neopakuje.
      const p = parseYmd(g.d), s = fmtDateLong(g.d), tail = p ? ' ' + p.y : '';
      g.label = (tail && s.slice(-tail.length) === tail) ? s.slice(0, s.length - tail.length) : s;
    }
  }
  return out;
}

// n naposledy použitých kategorií, nejčerstvější první.
function recentCats(n) {
  const H = renderJournalScreen.h;
  const yr = H.year();
  const src = (yr && Array.isArray(yr.tx)) ? yr.tx : [];
  const rows = [];
  for (let i = 0; i < src.length; i++) {
    const t = src[i];
    if (t && !t.del && t.cat) rows.push({ i: i, at: String(t.updatedAt || ''), cat: t.cat });
  }
  rows.sort(function (a, b) { return a.at !== b.at ? (a.at < b.at ? 1 : -1) : b.i - a.i; });
  const want = Number.isFinite(n) && n > 0 ? Math.round(n) : 5;
  const out = [];
  for (const r of rows) {
    if (out.indexOf(r.cat) >= 0) continue;
    const c = H.cat(r.cat);
    if (!c || c.archived) continue;      // smazanou ani archivovanou nenabízíme
    out.push(r.cat);
    if (out.length >= want) break;
  }
  return out;
}

// Přefiltruje a znovu naplní JEN seznam. Skořápka i pole hledání zůstávají
// stát, takže kurzor ani rozepsaný text nikam nezmizí.
function applyJournalFilter() {
  const host = qs('#screen-journal');
  const listHost = host ? qs('#jrn-list', host) : null;
  if (!listHost) return;
  const H = renderJournalScreen.h;
  const u = H.ui();
  const hit = H.monthTx(state.ui.month).filter(function (t) { return H.match(t, u.filter, u.q); });

  const limit = Math.max(H.cap, Number(host.dataset.limit) || H.cap);
  const frag = document.createDocumentFragment();
  let shown = 0;
  for (const g of txDayGroups(hit)) {
    if (shown >= limit) break;           // strop se počítá po celých dnech
    const day = tpl('tpl-tx-day');
    setText(day.querySelector('[data-d="label"]'), g.label);
    setText(day.querySelector('[data-d="sum"]'), formatCzk(g.sum));
    const dl = day.querySelector('[data-d="list"]');
    for (const t of g.items) { dl.appendChild(renderTxItem(t)); shown += 1; }
    frag.appendChild(day);
  }

  if (!hit.length) {
    const e = tpl('tpl-empty');
    setText(e.querySelector('[data-d="text"]'),
      u.on ? 'Nic takového tu není. Zkus jiné slovo nebo dej Vše.' : TXT.emptyJournal);
    listHost.replaceChildren(e);
    listHost.classList.remove('card');
  } else {
    listHost.replaceChildren(frag);
    listHost.classList.add('card');
  }
  host.dataset.shown = String(shown);
  host.dataset.hits = String(hit.length);

  const more = qs('#jrn-more', host);
  if (more) {
    const rest = hit.length - shown;
    more.hidden = rest <= 0;
    setText(more, rest > 0 ? 'Načíst starší (zbývá ' + rest + ')' : 'Načíst starší');
  }
  patchJournal();
}

// Dopočtová vrstva: jen textContent, classList a aria-*. Nesahá na žádný
// input, takže nemůže vyhodit kurzor z pole hledání.
function patchJournal() {
  const host = qs('#screen-journal.is-active');
  if (!host) return;
  const H = renderJournalScreen.h;
  const u = H.ui();
  let total = 0, n = 0, ftotal = 0, fn = 0;
  for (const t of H.monthTx(state.ui.month)) {
    const a = Number.isSafeInteger(t.amt) ? t.amt : 0;
    total += a; n += 1;
    if (H.match(t, u.filter, u.q)) { ftotal += a; fn += 1; }
  }
  setText(qs('#jrn-total', host), formatCzk(u.on ? ftotal : total));
  setText(qs('#jrn-total-hint', host), u.on ? 'z ' + formatCzk(total) + ' za měsíc' : '');
  setText(qs('#jrn-count', host), String(u.on ? fn : n));

  // Když se seznam ořízl, musí to být vidět — mlčky se nekrátí.
  const shown = Number(host.dataset.shown || 0), hits = Number(host.dataset.hits || 0);
  setText(qs('#jrn-count-hint', host), hits > shown ? 'zobrazeno ' + shown + ' z ' + hits : '');

  for (const c of qsa('#jrn-filters .chip', host)) {
    const on = (c.dataset.val || 'all') === u.filter;
    c.classList.toggle('is-active', on);
    setAttrIf(c, 'aria-pressed', on ? 'true' : 'false');
  }
}

/* ======================= rychlý zápis ================================= */

// Uloží jeden nákup z formuláře. Vrací nový záznam, nebo null, když se nic
// neuložilo. Do entry.act NEZAPISUJE — skutečnost se z deníku dopočítává.
function quickAddSubmit(form) {
  if (!form) return null;
  const H = renderJournalScreen.h;
  const amtIn = qs('[data-f="amt"]', form);
  const dateIn = qs('[data-f="date"]', form);
  const catIn = qs('[data-f="cat"]', form);
  const noteIn = qs('[data-f="note"]', form);
  if (!amtIn) return null;

  // Jediný povolený parser. Prázdné pole vrací null, nikdy nulu.
  const r = parseCzkInput(amtIn.value);
  if (!r.ok) return H.mark(amtIn, 'Tohle číslo neumím přečíst. Zkus 250 nebo 1 234,50.');
  if (r.minor === null) return H.mark(amtIn, 'Napiš částku, jinak nemám co zapsat.');
  if (r.minor === 0) return H.mark(amtIn, 'Nula se do deníku nezapisuje.');
  H.mark(amtIn, '');

  const d = (dateIn && parseYmd(dateIn.value)) ? dateIn.value : todayISO();
  // Rozpočtový měsíc řezem řetězce YYYY-MM-DD. Přes Date/toISOString by
  // 1. února v pražském čase spadl do ledna a nákup by zmizel o měsíc zpět.
  const mm = Number(d.slice(5, 7)) - 1;
  if (Number(d.slice(0, 4)) !== state.activeYear) {
    return H.mark(dateIn, 'Datum musí být v roce ' + state.activeYear + '. Rok se přepíná nahoře.');
  }
  H.mark(dateIn, '');
  const cat = (catIn && catIn.value) ? catIn.value : null;
  if (!cat) return H.mark(catIn, 'Vyber kategorii.');

  const amt = Math.abs(r.minor);   // model: částky se ukládají kladně, směr dá sekce
  const tx = addTx({ d: d, m: mm, cat: cat, amt: amt, note: noteIn ? String(noteIn.value).trim() : '' });
  if (!tx || !tx.id) return H.mark(amtIn, 'Zápis se nepodařilo uložit. Zkus jinou částku.');
  const newId = tx.id;

  toast('Zapsáno ' + formatCzk(amt) + ' — ' + H.label(H.cat(cat)), {
    action: TXT.undo,
    onAction: function () {
      if (newId) { try { removeTx(newId); } catch (e) {} }
      scheduleSave(); renderApp();
    },
  });

  // Panel zůstává otevřený: druhý nákup v řadě je jen částka a Uložit.
  amtIn.value = '';
  if (noteIn) noteIn.value = '';
  scheduleSave();
  renderApp();
  try { amtIn.focus({ preventScroll: true }); } catch (e) {}
  return tx;
}

/* ---------- panely ---------- */

// Rychlý zápis: dvě klepnutí a číslo.
renderJournalScreen.h.quick = function () {
  const H = this;
  const cats = H.catalogList();
  if (!cats.length) {
    toast('Nejdřív si na obrazovce Měsíc přidej kategorii, do které se má nákup zapsat.');
    return;
  }
  const recent = recentCats(5);
  const preselect = recent.length ? recent[0] : cats[0].id;

  openSheet({
    title: TXT.quickAdd,
    build: function (body) {
      const form = el('form', { id: 'qa-form', novalidate: true, autocomplete: 'off',
        style: 'display:flex;flex-direction:column;gap:var(--sp-4)' });

      // --- částka: první pole, samo se zaostří, decimální klávesnice ---
      const fa = H.field('Kolik to stálo', 'amt', { type: 'text', inputmode: 'decimal',
        enterkeyhint: 'done', autocorrect: 'off', autocapitalize: 'off',
        spellcheck: 'false', placeholder: '0',
        style: 'font-size:var(--fs-2xl);font-weight:var(--fw-bold)' });
      const amt = fa.querySelector('input');
      amt.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();                        // Enter ukládá, panel nezavírá
        quickAddSubmit(form);
      });
      form.appendChild(fa);

      // --- kategorie: pět naposledy použitých na klepnutí, pod tím všechny ---
      const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--sp-2)' });
      wrap.appendChild(el('span', { class: 'field-label' }, 'Kategorie'));
      const chips = H.strip({ role: 'group', 'aria-label': 'Naposledy použité kategorie' });
      const sel = H.catSelect(cats, false);
      sel.value = preselect;
      function syncChips() {
        for (const ch of qsa('.chip', chips)) {
          const on = ch.dataset.val === sel.value;
          ch.classList.toggle('is-active', on);
          setAttrIf(ch, 'aria-pressed', on ? 'true' : 'false');
        }
      }
      for (const id of recent) {
        const c = H.cat(id);
        if (!c) continue;
        const ch = H.chip(id, H.label(c), null);
        ch.addEventListener('click', function () { sel.value = id; syncChips(); });
        chips.appendChild(ch);
      }
      if (chips.childNodes.length) wrap.appendChild(chips);
      const selLabel = el('label', { class: 'field' });
      selLabel.appendChild(el('span', { class: 'field-label sr-only' }, 'Vybrat ze všech kategorií'));
      selLabel.appendChild(sel);
      selLabel.appendChild(el('span', { class: 'field-hint' }));
      wrap.appendChild(selLabel);
      sel.addEventListener('change', syncChips);
      syncChips();
      form.appendChild(wrap);

      // --- datum: dnešek přes todayISO(), nikdy přes toISOString ---
      const fd = H.field('Datum', 'date', { type: 'date' });
      fd.querySelector('input').value = todayISO();
      form.appendChild(fd);
      form.appendChild(H.field('Poznámka (nepovinná)', 'note',
        { enterkeyhint: 'done', placeholder: 'třeba kde' }));

      form.appendChild(el('button', { class: 'btn btn-primary', type: 'submit' }, 'Uložit a psát dál'));
      form.addEventListener('submit', function (e) { e.preventDefault(); quickAddSubmit(form); });
      body.appendChild(form);
    },
    foot: [{ label: TXT.close, kind: 'ghost', value: null }],
    onClose: function () { renderApp(); },
  });
};

// Úprava jednoho zápisu. Mazání je měkké a vrací se hláškou, ne oknem.
renderJournalScreen.h.edit = function (id) {
  const H = this;
  const yr = H.year();
  let tx = null;
  for (const t of ((yr && Array.isArray(yr.tx)) ? yr.tx : [])) if (t && t.id === id) { tx = t; break; }
  if (!tx || tx.del) return;
  const cats = H.catalogList();
  const m0 = String(clamp(num(tx.m), 0, 11));

  openSheet({
    title: 'Upravit zápis',
    build: function (body) {
      const form = el('form', { id: 'tx-form', novalidate: true, autocomplete: 'off',
        style: 'display:flex;flex-direction:column;gap:var(--sp-4)' });

      const fa = H.field('Částka', 'amt', { inputmode: 'decimal', enterkeyhint: 'done',
        autocorrect: 'off', spellcheck: 'false' });
      fa.querySelector('input').value = fmtEdit(tx.amt);
      form.appendChild(fa);

      const fd = H.field('Datum', 'date', { type: 'date' });
      const date = fd.querySelector('input');
      date.value = parseYmd(tx.d) ? tx.d : todayISO();
      form.appendChild(fd);

      const fm = el('label', { class: 'field' });
      fm.appendChild(el('span', { class: 'field-label' }, 'Rozpočtový měsíc'));
      const mon = el('select', { class: 'field-input' });
      mon.dataset.f = 'month';
      for (let i = 0; i < 12; i++) mon.appendChild(el('option', { value: String(i) }, MONTHS_NOM[i]));
      mon.value = m0;
      fm.appendChild(mon);
      fm.appendChild(el('span', { class: 'field-hint' },
        'Nákup z 1. února může patřit ještě do lednového rozpočtu.'));
      form.appendChild(fm);
      // Posun data táhne měsíc s sebou, dokud si ho uživatelka nepřepsala sama.
      date.addEventListener('change', function () {
        const p = parseYmd(date.value);
        if (p && mon.value === m0) mon.value = String(p.m);
      });

      const fc = el('label', { class: 'field' });
      fc.appendChild(el('span', { class: 'field-label' }, 'Kategorie'));
      const sel = H.catSelect(cats, true);
      // Archivovaná kategorie v nabídce není, ale zápis o ni nesmí přijít.
      if (tx.cat && !cats.some(function (c) { return c.id === tx.cat; })) {
        const keep = H.cat(tx.cat);
        if (keep) sel.appendChild(el('option', { value: keep.id }, H.label(keep)));
      }
      sel.value = tx.cat || '';
      fc.appendChild(sel);
      fc.appendChild(el('span', { class: 'field-hint' }));
      form.appendChild(fc);

      const fn = H.field('Poznámka', 'note', {});
      fn.querySelector('input').value = tx.note || '';
      form.appendChild(fn);

      form.addEventListener('submit', function (e) { e.preventDefault(); });
      body.appendChild(form);
    },
    foot: [
      {
        label: TXT.del, kind: 'danger',
        onClick: function () {
          try { removeTx(tx.id); } catch (e) {}
          scheduleSave();
          toast('Zápis smazán.', {
            action: TXT.undo,
            onAction: function () {
              // removeTx() si vrácení připravil sám, undoLast() ho jen spustí.
              const r = undoLast();
              if (!r || !r.ok) toast('Vrátit zpět se bohužel nepovedlo.');
              scheduleSave(); renderApp();
            },
          });
          return true;
        },
      },
      {
        label: TXT.save, kind: 'primary',
        onClick: function (bodyEl) {
          const form = qs('#tx-form', bodyEl) || bodyEl;
          const amtIn = qs('[data-f="amt"]', form), dateIn = qs('[data-f="date"]', form);
          const r = parseCzkInput(amtIn.value);
          if (!r.ok || r.minor === null || r.minor === 0) {
            H.mark(amtIn, 'Napiš platnou částku.');
            return false;
          }
          H.mark(amtIn, '');
          const d = (dateIn && parseYmd(dateIn.value)) ? dateIn.value : tx.d;
          if (Number(d.slice(0, 4)) !== state.activeYear) {
            H.mark(dateIn, 'Datum musí být v roce ' + state.activeYear + '.');
            return false;
          }
          try {
            updateTx(tx.id, {
              d: d,
              m: clamp(Math.round(Number(qs('[data-f="month"]', form).value)), 0, 11),
              cat: qs('[data-f="cat"]', form).value || null,
              amt: Math.abs(r.minor),
              note: String(qs('[data-f="note"]', form).value).trim(),
            });
          } catch (e) { toast('Zápis se nepodařilo uložit.'); return false; }
          scheduleSave();
          return true;
        },
      },
    ],
    onClose: function () { renderApp(); },
  });
};

/* ---------- zavěšení akcí ---------- */

Object.assign(ACTIONS, {
  'tx.quick': function () { renderJournalScreen.h.quick(); },
  'tx.open': function (ctx) { if (ctx.id) renderJournalScreen.h.edit(ctx.id); },
  'journal.filter': function (ctx) {
    state.ui.journalFilter = ctx.val || 'all';
    const host = qs('#screen-journal');
    if (host) host.dataset.limit = String(renderJournalScreen.h.cap);
    applyJournalFilter();
    scheduleSave();
  },
  'journal.more': function () {
    const host = qs('#screen-journal');
    if (!host) return;
    const cap = renderJournalScreen.h.cap;
    host.dataset.limit = String((Number(host.dataset.limit) || cap) + cap);
    applyJournalFilter();
  },
});
