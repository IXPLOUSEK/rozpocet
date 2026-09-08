// 52-due-goals.js — splatnosti plateb a spořicí cíle — vlastní: L9
// Dvě témata, jedna dráha: co je potřeba zaplatit a kam se sype stranou.
// Soukromí pomocníci nesou prefix `_due` / `_goal`, aby se nikde nesrazili.

/* ======================= soukromí pomocníci ============================= */
// Čtení jde přímo přes _MODEL.md, ne přes getYear()/getCat(): ty chybějící
// rok tiše ZALOŽÍ, a to je v dopočtu i v patchi nežádoucí vedlejší účinek.
function _dueYear(y) {
  return (typeof state === 'object' && state && state.years && state.years[String(y)]) || null;
}
function _dueCat(yr, catId) {
  const list = (yr && yr.catalog) || [];
  for (let i = 0; i < list.length; i++) if (list[i].id === catId) return list[i];
  return null;
}
// entry.due je DEN (1–31), ne datum. null = ber ho z katalogu.
function _dueDayOf(entry, cat) {
  const ed = entry ? entry.due : null;
  if (Number.isFinite(ed) && ed >= 1) return Math.round(ed);
  const cd = cat ? cat.dueDay : null;
  return Number.isFinite(cd) && cd >= 1 ? Math.round(cd) : null;
}
// Únor v září nesmí křičet. Zvýrazňuje se jen měsíc, ve kterém opravdu jsme.
function _dueIsCurrentMonth(y, m) {
  const t = parseYmd(todayISO());
  return !!t && t.y === y && t.m === m;
}
function _dueSoon() { return num(state && state.settings && state.settings.dueSoonDays) || 7; }

/* ============================ splatnosti ================================ */
// 'paid' | 'overdue' | 'today' | 'week' | 'later' | 'none'
function dueStatus(entry, cat, y, m) {
  const day = _dueDayOf(entry, cat);
  if (day === null) return 'none';
  if (entry && entry.paid) return 'paid';
  const due = dueDateFor(y, m, day);        // 31. v únoru sám ořízne na 28./29.
  if (!due) return 'none';
  if (!_dueIsCurrentMonth(y, m)) return 'later';
  const d = daysBetween(todayISO(), due);
  if (d === null) return 'none';
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  return d <= _dueSoon() ? 'week' : 'later';
}

// Krátký text do pilulky: "15.", "dnes", "zítra", "za 3 dny", "po splatnosti".
function dueLabel(entry, cat, y, m) {
  const st = dueStatus(entry, cat, y, m);
  if (st === 'none') return '';
  if (st === 'paid') return 'zaplaceno';
  const due = dueDateFor(y, m, _dueDayOf(entry, cat));
  const p = parseYmd(due);
  const den = p ? p.day + '.' : '';
  return st === 'later' ? den : (relDaysCs(daysBetween(todayISO(), due)) || den);
}

// {overdue, soon, later, paid}; položka je {entry, cat, due, days, amount}.
function dueList(y, m, daysAhead) {
  const out = { overdue: [], soon: [], later: [], paid: [] };
  const yr = _dueYear(y);
  const mo = yr && yr.months ? yr.months[m] : null;
  if (!mo || !Array.isArray(mo.entries)) return out;
  const soon = Number.isFinite(daysAhead) ? daysAhead : _dueSoon();
  const today = todayISO();
  const cur = _dueIsCurrentMonth(y, m);
  for (const en of mo.entries) {
    if (en.del) continue;
    const cat = _dueCat(yr, en.cat);
    if (!cat || cat.archived) continue;
    const sec = SECTION_BY_KEY[cat.sec];
    if (!sec || !sec.hasDue) continue;
    const day = _dueDayOf(en, cat);
    const due = day === null ? null : dueDateFor(y, m, day);
    if (!due) continue;
    // Dokud není zaplaceno, dluží se plán. Skutečnost vyhrává, až když je.
    const amount = (en.act === null || en.act === undefined)
      ? (Number.isSafeInteger(en.plan) ? en.plan : 0) : en.act;
    const it = { entry: en, cat: cat, due: due, days: daysBetween(today, due), amount: amount };
    if (en.paid) out.paid.push(it);
    else if (cur && it.days < 0) out.overdue.push(it);
    else if (cur && it.days <= soon) out.soon.push(it);
    else out.later.push(it);
  }
  const byDate = function (a, b) { return a.due < b.due ? -1 : (a.due > b.due ? 1 : cmpCs(a.cat.name, b.cat.name)); };
  out.overdue.sort(byDate); out.soon.sort(byDate); out.later.sort(byDate); out.paid.sort(byDate);
  return out;
}

// Odkaz na překreslení otevřeného panelu splatností. null = panel je zavřený.
let _dueSheetRefresh = null;

// Obálka nad togglePaid. Fajfka a částka jsou dvě nezávislé věci — tahle
// funkce SAMA nikdy nic nedopisuje do act, jinak by odškrtnutí založilo
// druhý výdaj. Doplnění plánu i jeho úklid řeší model přes entry.autoFilled.
function markPaid(m, entryId, on) {
  const en = getEntry(m, entryId);
  if (!en) return null;
  const before = !!en.paid, next = !!on;
  if (before === next) return en;
  const apply = function (v) {
    togglePaid(m, entryId, v);
    scheduleSave();
    if (_dueSheetRefresh) _dueSheetRefresh();
    patch();
  };
  apply(next);
  toast(next ? 'Zaplaceno' : 'Zaplacení zrušeno', { action: TXT.undo, onAction: function () { apply(before); } });
  return en;
}

/* ========================== spořicí cíle ================================ */
// Skutečnost kategorie v měsíci podle _MODEL.md, pravidlo 1:
// ručně zadané act vyhrává, jinak se sečte deník.
function _goalCatActual(yr, m, catId) {
  if (!yr) return 0;
  const mo = yr.months ? yr.months[m] : null;
  let manual = null;
  if (mo && Array.isArray(mo.entries)) for (const en of mo.entries) {
    if (en.del || en.cat !== catId) continue;
    if (Number.isSafeInteger(en.act)) manual = (manual === null ? 0 : manual) + en.act;
  }
  if (manual !== null) return manual;
  // Deník se počítá jen tehdy, když ta kategorie v měsíci opravdu má řádek.
  // Bez toho by tentýž nákup byl na Měsíci „nezařazený výdaj" a na Úsporách
  // „naspořeno" zároveň.
  let maRadek = false;
  if (mo && Array.isArray(mo.entries)) for (const en of mo.entries) {
    if (!en.del && en.cat === catId) { maRadek = true; break; }
  }
  if (!maRadek) return 0;
  let s = 0;
  for (const t of (yr.tx || [])) {
    if (t.del || t.m !== m || t.cat !== catId) continue;
    if (Number.isSafeInteger(t.amt)) s += t.amt;
  }
  return s;
}

// Procenta česky: "32,5 %" s pevnou mezerou. null = pomlčka, nikdy NaN.
function _goalPctText(ratio) {
  if (ratio === null || !Number.isFinite(ratio)) return '—';
  return String(Math.round(ratio * 1000) / 10).replace('.', ',') + NBSP + '%';
}
// Částka bez "Kč" — do věty "24 000 z 45 000 Kč" patří jednotka jen jednou.
function _goalBare(minor) {
  const s = formatCzk(minor);
  return s === '—' ? s : s.replace(NBSP + 'Kč', '');
}
// Lokativ ("v lednu"). MONTHS_GEN je genitiv a "v ledna" by bylo hrozné.
function _goalMonthLoc(m) {
  return ['lednu', 'únoru', 'březnu', 'dubnu', 'květnu', 'červnu',
    'červenci', 'srpnu', 'září', 'říjnu', 'listopadu', 'prosinci'][clamp(m, 0, 11)];
}

// {saved, target, ratio, left, hasGoal}.
// 0/0 je NaN, 500/0 je Infinity — obojí by prosáklo až do šířky pruhu.
function goalProgress(catId, y) {
  const yr = _dueYear(y);
  const goal = (_dueCat(yr, catId) || {}).goal || null;
  const target = goal && Number.isSafeInteger(goal.target) ? goal.target : 0;
  let saved = goal && Number.isSafeInteger(goal.startBalance) ? goal.startBalance : 0;
  for (let m = 0; m < 12; m++) saved += _goalCatActual(yr, m, catId);
  return { saved: saved, target: target, hasGoal: !!goal,
    ratio: target > 0 ? saved / target : null,
    left: target > 0 ? Math.max(0, target - saved) : 0 };
}

// Kolik měsíčně, aby to do termínu vyšlo. null = nemá smysl to počítat.
function goalPace(catId, y) {
  const p = goalProgress(catId, y);
  if (!p.hasGoal || p.target <= 0 || p.left <= 0) return null;
  const goal = (_dueCat(_dueYear(y), catId) || {}).goal || null;
  const gd = goal ? parseYmd(goal.targetDate) : null;
  if (!gd) return null;
  const today = todayISO();
  const days = daysBetween(today, goal.targetDate);
  if (days === null || days < 0) return null;         // termín už je za námi
  const t = parseYmd(today);
  const months = Math.max(1, (gd.y * 12 + gd.m) - (t.y * 12 + t.m) + 1);
  return Math.ceil(p.left / months / 100) * 100;      // vždy nahoru, celé koruny
}

// Krátká věta pod pruh. Prázdný řetězec, když není co říct.
function goalEtaText(catId, y) {
  const p = goalProgress(catId, y);
  if (!p.hasGoal || p.target <= 0) return '';
  if (p.left <= 0) return 'hotovo 🎉';
  const t = parseYmd(todayISO());
  if (!t || t.y !== y) return 'zbývá ' + formatCzk(p.left);
  const yr = _dueYear(y);
  let sum = 0, n = 0;
  for (let m = 0; m <= t.m; m++) { const v = _goalCatActual(yr, m, catId); if (v > 0) { sum += v; n += 1; } }
  // Jeden měsíc není tempo. Odhad dáváme až ze dvou a jen do tří let dopředu.
  if (n >= 2) {
    const need = Math.ceil(p.left / (sum / n));
    if (need >= 1 && need <= 36) {
      const e = addMonths(y, t.m, need);
      return 'tímhle tempem to máš v ' + _goalMonthLoc(e.m) + (e.y !== y ? ' ' + e.y : '');
    }
  }
  return 'zbývá ' + formatCzk(p.left);
}

/* ---------- obrazovka Úspory ---------- */
// Přepsání čísel na kartě. Jen textContent, style.width, classList a aria-*,
// takže je to bezpečné i jako patch.
function _goalPaint(card, cat, y) {
  const p = goalProgress(cat.id, y), pace = goalPace(cat.id, y);
  setText(card.querySelector('[data-d="saved"]'), _goalBare(p.saved));
  setText(card.querySelector('[data-d="target"]'), p.target > 0 ? formatCzk(p.target) : '—');
  const bar = card.querySelector('[data-d="bar"]');
  setBarWidth(bar, p.ratio === null ? 0 : clamp(p.ratio, 0, 1));
  if (bar) {
    bar.classList.toggle('is-warn', p.ratio !== null && p.ratio < 0.25);
    setAttrIf(bar.parentNode, 'role', 'img');
    setAttrIf(bar.parentNode, 'aria-label', 'Naspořeno ' + _goalPctText(p.ratio));
  }
  const leftTxt = p.target > 0 ? (p.left > 0 ? 'zbývá ' + formatCzk(p.left) : 'cíl splněný') : '—';
  const paceTxt = pace !== null ? 'odkládej ' + formatCzk(pace) + ' měsíčně' : goalEtaText(cat.id, y);
  setText(card.querySelector('[data-d="left"]'), leftTxt);
  setText(card.querySelector('[data-d="pace"]'), paceTxt);
  const sep = card.querySelector('[data-d="sepvis"]');
  if (sep) sep.hidden = !(leftTxt && paceTxt);
}

function renderGoalCard(cat, y) {
  const card = tpl('tpl-goal-card');
  card.dataset.id = cat.id;
  setText(card.querySelector('[data-d="icon"]'), cat.icon || '🎯');
  setText(card.querySelector('[data-d="name"]'), cat.name);
  const host = card.querySelector('[data-d="months"]');
  if (host && typeof chartYearColumns === 'function') {
    const yr = _dueYear(y), series = [];
    for (let m = 0; m < 12; m++) series.push(_goalCatActual(yr, m, cat.id));
    host.removeAttribute('aria-hidden');   // skrytá tabulka pod grafem má smysl
    host.style.display = 'block';          // .goal-months je flex pro holé sloupky
    chartYearColumns(host, series, { mini: true, active: state.ui.month,
      title: 'Spoření po měsících', desc: cat.name + ' — dvanáct měsíců roku ' + y });
  } else if (host) {
    host.remove();                         // dráha grafů ještě není na světě
  }
  _goalPaint(card, cat, y);
  return card;
}

function renderSavingsScreen() {
  const host = qs('#screen-savings');
  if (!host) return;
  const y = state.activeYear, yr = _dueYear(y);
  const cats = ((yr && yr.catalog) || [])
    .filter(function (c) { return c.sec === 'savings' && !c.archived; })
    .sort(function (a, b) { return num(a.order) - num(b.order) || cmpCs(a.name, b.name); });
  const withGoal = cats.filter(function (c) { return !!c.goal; });
  const noGoal = cats.filter(function (c) { return !c.goal; });

  const frag = document.createDocumentFragment();
  for (const c of withGoal) frag.appendChild(renderGoalCard(c, y));
  if (!withGoal.length) {
    const e = tpl('tpl-empty');
    setText(e.querySelector('[data-d="text"]'), TXT.emptyGoals);
    frag.appendChild(e);
  }
  if (noGoal.length) {
    const box = el('section', { class: 'card goal-card' });
    box.appendChild(el('h3', { class: 'sec-title' }, 'ÚSPORY BEZ CÍLE'));
    for (const c of noGoal) {
      const row = el('div', { class: 'goal-head', dataset: { id: c.id } });
      row.appendChild(el('span', { class: 'goal-ico', 'aria-hidden': 'true' }, c.icon || '🐖'));
      row.appendChild(el('span', { class: 'goal-name' }, c.name));
      row.appendChild(el('button', { class: 'goal-edit', 'data-act': 'goal.edit' }, 'Nastavit cíl'));
      box.appendChild(row);
    }
    frag.appendChild(box);
  }
  const addBtn = el('button', { class: 'sec-add', 'data-act': 'goal.add' });
  addBtn.appendChild(el('span', { 'aria-hidden': 'true' }, '+'));
  addBtn.appendChild(el('span', null, 'Nový cíl'));
  const addBox = el('section', { class: 'card' });
  addBox.appendChild(addBtn);
  frag.appendChild(addBox);
  host.replaceChildren(frag);
}

// Patch vrstva: nevytváří ani neruší uzly a nesahá na prvek s kurzorem.
function patchSavings() {
  if (!qs('#screen-savings.is-active')) return;
  const y = state.activeYear, yr = _dueYear(y);
  for (const card of qsa('#screen-savings .goal-card[data-id]')) {
    const cat = _dueCat(yr, card.dataset.id);
    if (cat) _goalPaint(card, cat, y);
  }
}

/* ============================ akce ======================================
   ACTIONS je `const` v 60-events.js, které build slepuje AŽ ZA tenhle soubor
   — přímý zápis by tady spadl do temporální mrtvé zóny. Zkusíme to tedy
   rovnou (kdyby se pořadí někdy otočilo) a jinak o jeden mikroúkol později,
   pořád dávno předtím, než se dá na cokoliv klepnout. */

(function registerDueGoalActions(retried) {
  const self = registerDueGoalActions;
  const Y = function () { return state.activeYear; };

  /* ---------- panel splatností ---------- */
  function dueItemNode(it, m) {
    const node = tpl('tpl-due-item');
    node.dataset.id = it.entry.id;
    const st = dueStatus(it.entry, it.cat, Y(), m);
    node.classList.toggle('is-overdue', st === 'overdue');
    node.classList.toggle('is-soon', st === 'today' || st === 'week');
    const chk = node.querySelector('.due-check');
    setAttrIf(chk, 'aria-pressed', it.entry.paid ? 'true' : 'false');
    setAttrIf(chk, 'aria-label', (it.entry.paid ? 'Zrušit zaplacení: ' : 'Označit jako zaplacené: ') + it.cat.name);
    setText(node.querySelector('[data-d="name"]'), (it.cat.icon ? it.cat.icon + ' ' : '') + it.cat.name);
    setText(node.querySelector('[data-d="when"]'), fmtDateShort(it.due) + ' · ' + dueLabel(it.entry, it.cat, Y(), m));
    setText(node.querySelector('[data-d="amt"]'), formatCzk(it.amount));
    return node;
  }

  // Po odškrtnutí se panel překreslí: řádek zmizí z čekající skupiny a objeví
  // se dole mezi zaplacenými. Vrácení zpět ho zase posune nahoru.
  function paintDueSheet(body, m) {
    const d = dueList(Y(), m, _dueSoon());
    const frag = document.createDocumentFragment();
    let any = false;
    for (const g of [['PO SPLATNOSTI', d.overdue], ['TENTO TÝDEN', d.soon],
                     ['POZDĚJI', d.later], ['ZAPLACENO', d.paid]]) {
      if (!g[1].length) continue;
      any = true;
      frag.appendChild(el('h3', { class: 'sec-title' }, g[0]));
      const list = el('div', { class: 'card' });
      for (const it of g[1]) list.appendChild(dueItemNode(it, m));
      frag.appendChild(list);
    }
    if (!any) frag.appendChild(el('p', { class: 'empty' }, 'Tenhle měsíc nemáš nic se splatností.'));
    body.replaceChildren(frag);
  }

  /* ---------- panel cíle ---------- */
  function goalField(body, key, label, value, hint, numeric) {
    const f = tpl('tpl-field');
    setText(f.querySelector('[data-d="label"]'), label);
    setText(f.querySelector('[data-d="hint"]'), hint || '');
    const inp = f.querySelector('input');
    inp.dataset.f = key;
    inp.value = value === null || value === undefined ? '' : String(value);
    if (numeric) { inp.setAttribute('inputmode', 'decimal'); inp.setAttribute('enterkeyhint', 'next'); }
    body.appendChild(f);
    return inp;
  }

  function saveGoalSheet(body, cat) {
    const f = function (k) { return body.querySelector('[data-f="' + k + '"]'); };
    const bad = function (inp) { inp.classList.add('is-invalid'); inp.focus(); return false; };
    const name = String(f('name').value).trim();
    if (!name) return bad(f('name'));
    const t = parseCzkInput(f('target').value);          // nikdy Number()
    if (!t.ok) return bad(f('target'));
    const s = parseCzkInput(f('start').value);
    if (!s.ok) return bad(f('start'));
    const date = String(f('date').value).trim();
    if (date && !parseYmd(date)) return bad(f('date'));
    let id = cat ? cat.id : null;
    if (!id) id = addCatalogItem({ sec: 'savings', name: name, icon: '🎯' }, 'all').id;
    else if (name !== cat.name) updateCatalogItem(id, { name: name });
    setGoal(id, { target: num(t.minor), startBalance: num(s.minor), targetDate: date || null });
    scheduleSave();
    renderApp();
    toast('Cíl uložený');
    return true;
  }

  function openGoalSheet(cat) {
    const g = (cat && cat.goal) || null;
    openSheet({
      title: cat ? 'Cíl — ' + cat.name : 'Nový spořicí cíl',
      build: function (body) {
        goalField(body, 'name', 'Název', cat ? cat.name : '', 'Třeba Dovolená');
        goalField(body, 'target', 'Kolik chci našetřit', g ? fmtEdit(g.target) : '', 'Třeba 45 000', true);
        goalField(body, 'start', 'Co už mám stranou', g ? fmtEdit(g.startBalance) : '', 'Zůstatek na spořicím účtu', true);
        // Datum necháváme na prohlížeči — vlastní kalendář by byl zbytečná past.
        goalField(body, 'date', 'Chci to mít do', g ? g.targetDate : '', 'Ve tvaru 2026-12-31')
          .setAttribute('type', 'date');
      },
      foot: [{ label: TXT.cancel, kind: 'ghost', value: null },
             { label: TXT.save, kind: 'primary',
               onClick: function (body) { return saveGoalSheet(body, cat); } }],
    });
  }

  try {
    Object.assign(ACTIONS, {
      'due.open': function () {
        const m = state.ui.month;
        openSheet({
          title: 'Platby — ' + monthLabelCs(Y(), m),
          build: function (body) {
            _dueSheetRefresh = function () { paintDueSheet(body, m); };
            paintDueSheet(body, m);
          },
          onClose: function () { _dueSheetRefresh = null; },
          foot: [{ label: TXT.close, kind: 'ghost', value: null }],
        });
      },
      'due.toggle': function (ctx) {
        if (ctx.id) markPaid(state.ui.month, ctx.id, ctx.node.getAttribute('aria-pressed') !== 'true');
      },
    });
    Object.assign(ACTIONS, {
      'goal.edit': function (ctx) {
        const cat = _dueCat(_dueYear(Y()), ctx.id);
        if (cat) openGoalSheet(cat);
      },
      'goal.add': function () { openGoalSheet(null); },
    });
  } catch (err) {
    if (retried) { console.warn('52-due-goals: ACTIONS nedostupné', err); return; }
    Promise.resolve().then(function () { self(true); });
  }
}(false));
