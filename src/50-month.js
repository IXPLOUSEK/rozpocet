// 50-month.js — obrazovka Měsíc: KPI, splatnosti, sekce, řádky, grafy — vlastní: L7
//
// Dvě vrstvy, které se nesmí míchat:
//   render*  staví uzly z <template>. Jediné místo, kde vzniká nebo mizí DOM.
//   patch*   dopočítává. Smí zapsat jen textContent, style.width, classList,
//            aria-* a hidden — a NIKDY nesáhne na buňku, ve které stojí kurzor.
// Díky tomu přepočet součtů nikdy nerozhodí rozepsané číslo.
//
// Osm veřejných jmen podle _CONTRACT.md. Všechny pomocné funkce žijí
// v soukromém scope uvnitř IIFE, aby do sdíleného scope nic neuniklo.

let renderMonthScreen, renderSectionCard, renderRow;
let patchMonth, patchRow, patchTotals, patchAlertCard, patchOrphanCard;
const rowIndex = new Map();   // id POLOŽKY -> uzel .row

(function () {

  /* ======================= soukromé pomůcky ============================= */

  // Výchozí ikona nové položky podle sekce. Uživatelka si ji hned přepíše.
  const SEC_ICON = { income: '💰', fixed: '🏠', daily: '🛒', savings: '🐖', debt: '🏦', subs: '🔁' };
  const EMPTY_SEC = { plan: 0, act: 0, diff: 0, rows: [] };

  // computeMonth() je memoizované na state.rev, takže se smí volat často.
  // Kdyby přesto spadlo (rozbitá data), obrazovka se vykreslí s nulami
  // místo toho, aby zmizela celá.
  function md(y, m) {
    try {
      const d = computeMonth(y, m);
      if (d && d.sections) return d;
    } catch (e) { console.error('computeMonth selhal', e); }
    return { sections: {}, incomeTotal: 0, outflow: 0, balance: 0, leftPerDay: null, daysLeft: 0 };
  }
  // md.income je SEKCE (objekt), skalární součet příjmů se jmenuje incomeTotal.
  function incomeOf(data) {
    return Number.isSafeInteger(data.incomeTotal) ? data.incomeTotal : num(sec(data, 'income').act);
  }
  function sec(data, key) { return (data.sections && data.sections[key]) || EMPTY_SEC; }

  function isCurrentMonth(y, m) {
    const t = parseYmd(todayISO());
    return !!t && t.y === y && t.m === m;
  }

  // Součet deníku pro kategorii. Map<catId, haléře> je memoizovaná.
  function txSum(y, m, catId) {
    try {
      const v = txByCat(y, m).get(catId);
      return Number.isSafeInteger(v) ? v : 0;
    } catch (e) { return 0; }
  }

  // Splatnost řádku: entry.due (den 1–31) přebíjí cat.dueDay, 31. v únoru
  // ořízne dueDateFor() na poslední den měsíce.
  function dueIso(entry, cat, y, m) {
    const day = (entry.due !== null && entry.due !== undefined) ? entry.due : cat.dueDay;
    return Number.isInteger(day) ? dueDateFor(y, m, day) : null;
  }

  // 1 položka / 2–4 položky / 5+ položek
  function csItems(n) {
    if (n === 1) return '1 položka';
    if (n >= 2 && n <= 4) return n + ' položky';
    return n + ' položek';
  }

  // Sbalené sekce si pamatuje state.ui. Sanitizer v 32-storage.js cizí klíče
  // v ui nemaže, takže to přežije uložení i načtení.
  function collapsedMap() {
    if (!state.ui.secCollapsed || typeof state.ui.secCollapsed !== 'object') state.ui.secCollapsed = {};
    return state.ui.secCollapsed;
  }

  function goalOf(cat) {
    try {
      const list = computeGoals(state.activeYear);
      for (let i = 0; i < list.length; i++) if (list[i].id === cat.id) return list[i];
    } catch (e) {}
    return null;
  }

  /* ============================ struktura =============================== */

  renderMonthScreen = function renderMonthScreen() {
    const host = qs('#screen-month');
    if (!host) return;
    const y = state.activeYear, m = state.ui.month;
    const data = md(y, m);
    rowIndex.clear();

    const frag = document.createDocumentFragment();

    // 1) Tři dlaždice. Zůstatek je hrdina — přes celou šířku a větším písmem.
    const kpis = el('div', { class: 'card kpi-row' });
    kpis.appendChild(kpiTile('income', TXT.kpiIncome));
    kpis.appendChild(kpiTile('expense', TXT.kpiExpense));
    const hero = kpiTile('left', TXT.kpiLeft);
    hero.classList.add('kpi-hero');
    hero.style.gridColumn = '1 / -1';
    hero.querySelector('[data-d="value"]').style.fontSize = 'var(--fs-3xl)';
    kpis.appendChild(hero);
    frag.appendChild(kpis);

    // 2) Upozornění na splatnosti. Obsah i schování řeší patchAlertCard().
    frag.appendChild(tpl('tpl-alert-card'));

    // 2b) Nezařazené nákupy. Peníze, které se počítají do výdajů, ale nemají
    //     v tomhle měsíci řádek — musí být vidět tady, ne jen v deníku.
    const orph = tpl('tpl-alert-card');
    orph.dataset.kind = 'orphan';
    orph.dataset.act = 'nav';
    orph.dataset.screen = 'journal';
    orph.hidden = true;
    frag.appendChild(orph);

    // 3) Šest sekcí v pořadí ze SECTIONS.
    for (const s of SECTIONS) frag.appendChild(renderSectionCard(s, sec(data, s.key).rows));

    // 4) Grafy. Kreslí se až po zavěšení do stránky, jinak by chartMount()
    //    měřil nulovou šířku.
    const draws = chartCards(frag, y, m, data);

    // 5) Tisk / PDF
    const print = el('button', { class: 'btn btn-ghost', 'data-act': 'io.print' }, TXT.print);
    frag.appendChild(print);

    host.replaceChildren(frag);
    for (const fn of draws) { try { fn(); } catch (e) { console.error('graf selhal', e); } }
  };

  function kpiTile(key, label) {
    const k = tpl('tpl-kpi');
    k.dataset.kpi = key;
    setText(k.querySelector('[data-d="label"]'), label);
    return k;
  }

  renderSectionCard = function renderSectionCard(secDef, rows) {
    const card = tpl('tpl-section-card');
    card.dataset.sec = secDef.key;
    setText(card.querySelector('[data-d="title"]'), secDef.label);
    setText(card.querySelector('[data-d="addlabel"]'), secDef.addLabel);

    const off = !!collapsedMap()[secDef.key];
    card.classList.toggle('is-collapsed', off);
    setAttrIf(card.querySelector('.sec-toggle'), 'aria-expanded', off ? 'false' : 'true');

    const host = card.querySelector('[data-d="rows"]');
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      const p = tpl('tpl-empty');          // kořen šablony sám nese data-d="text"
      setText(p, TXT.emptySection);
      host.appendChild(p);
    } else {
      for (const r of list) host.appendChild(renderRow(r.entry, r.cat, secDef));
    }
    return card;
  };

  renderRow = function renderRow(entry, cat, secDef) {
    const row = tpl('tpl-row');
    row.dataset.id = entry.id;             // POZOR: id POLOŽKY, ne kategorie
    setText(row.querySelector('[data-d="icon"]'), cat.icon || '•');
    setText(row.querySelector('[data-d="name"]'), cat.name);

    // Bez tohohle čte odečítač dvě bezejmenná textová pole za sebou.
    setText(row.querySelector('[data-d="a11yplan"]'), TXT.colPlan + ', ' + cat.name);
    setText(row.querySelector('[data-d="a11yact"]'), TXT.colActual + ', ' + cat.name);

    const planCell = row.querySelector('.cell-plan'), actCell = row.querySelector('.cell-act');
    planCell.querySelector('input.amt').value = fmtEdit(entry.plan);
    actCell.querySelector('input.amt').value = fmtEdit(entry.act);   // null = počítá se z deníku

    const sub = row.querySelector('[data-d="sub"]');
    const duePill = el('span', { class: 'pill', 'data-d': 'duepill', hidden: true });
    const paidPill = el('span', { class: 'pill is-pos', 'data-d': 'paidpill', hidden: true }, 'zaplaceno');
    const manual = el('span', { 'data-d': 'manual', hidden: true });
    sub.append(duePill, paidPill, manual);

    // Tlačítko „Použít deník" nesmí být uvnitř .row-main — to je samo <button>.
    // Dostane proto vlastní linku přes celou šířku řádku, jako pruh cíle.
    let jwrap = null;
    if (!secDef.hasDue) {
      jwrap = el('div', { class: 'row-goal', 'data-d': 'jwrap', hidden: true });
      jwrap.appendChild(el('button', { class: 'pill', 'data-act': 'row.useJournal' }, TXT.useJournal));
      row.appendChild(jwrap);
    }

    // Uzly si zapamatujeme, aby patchRow() nemusel ve smyčce hledat v DOMu.
    row._n = {
      planCell: planCell, actCell: actCell, jwrap: jwrap,
      planDisp: planCell.querySelector('.amt-display'), actDisp: actCell.querySelector('.amt-display'),
      paid: row.querySelector('.row-paid'), duePill: duePill, paidPill: paidPill, manual: manual,
      goalWrap: row.querySelector('[data-d="goalwrap"]'), goalBar: row.querySelector('[data-d="goalbar"]'),
      goalText: row.querySelector('[data-d="goaltext"]'),
    };
    rowIndex.set(entry.id, row);
    patchRow(entry, cat, secDef);           // texty, pilulky a stavy jen na jednom místě
    return row;
  };

  // Karty grafů. Vrací seznam funkcí, které se spustí až po zavěšení.
  function chartCards(frag, y, m, data) {
    const draws = [];
    // Když graf ještě neexistuje, karta se prostě nevyrobí — nic nespadne.
    const card = function (title, fn) {
      const c = tpl('tpl-chart-card');
      setText(c.querySelector('[data-d="title"]'), title);
      frag.appendChild(c);
      draws.push(function () { fn(c.querySelector('[data-d="host"]'), c.querySelector('[data-d="legend"]')); });
    };

    if (typeof chartBars === 'function') {
      const items = SECTIONS.map(function (s) {
        const v = sec(data, s.key);
        return { name: s.short, plan: num(v.plan), act: num(v.act) };
      });
      card('Plán a skutečnost', function (host) { chartBars(host, items, { title: 'Plán a skutečnost' }); });
    }

    // Výseče z 34-derived.js mají klíč `label`, grafy čtou `name`.
    let slices = [];
    try { slices = dailySlices(y, m) || []; } catch (e) { slices = []; }
    slices = slices.map(function (s) { return { name: s.label || s.name || '', value: num(s.value) }; });
    if (typeof chartPie === 'function' && slices.length) {
      card('Kam jdou každodenní výdaje', function (host, legend) {
        chartPie(host, slices, { title: 'Kam jdou každodenní výdaje', legend: legend });
      });
    }

    const sv = sec(data, 'savings');
    if (typeof chartDonut === 'function' && num(sv.plan) > 0) {
      card('Úspory tenhle měsíc', function (host) {
        chartDonut(host, { value: num(sv.act), max: num(sv.plan),
          title: 'Úspory tenhle měsíc', centerSub: formatCzk(num(sv.act)) });
      });
    }
    return draws;
  }

  /* ============================= dopočty ================================ */

  patchMonth = function patchMonth() {
    const screen = qs('#screen-month.is-active');
    if (!screen) return;
    const y = state.activeYear, m = state.ui.month;
    const data = md(y, m);

    const setKpi = function (key, value, hint) {
      const k = screen.querySelector('.kpi[data-kpi="' + key + '"]');
      if (!k) return null;
      setText(k.querySelector('[data-d="value"]'), value);
      setText(k.querySelector('[data-d="hint"]'), hint || '');
      return k;
    };

    setKpi('income', formatCzkRound(incomeOf(data)), '');
    setKpi('expense', formatCzkRound(num(data.outflow)), '');

    // Hrdina: znaménko slovy i barvou. Nápověda jen v běžícím měsíci —
    // „na den do konce měsíce" u dubna v září nedává smysl.
    // Poškozený zůstatek se NEPŘEVÁDÍ na nulu — formatCzk z něj udělá
    // pomlčku. Zelená nula by tvrdila, že je všechno v pořádku, i když není.
    const balOk = Number.isSafeInteger(data.balance);
    const bal = balOk ? data.balance : NaN;
    let hint = '';
    if (isCurrentMonth(y, m) && Number.isSafeInteger(data.leftPerDay)) {
      hint = formatCzkRound(data.leftPerDay) + ' ' + TXT.kpiLeftHint;
    }
    const hero = setKpi('left', formatSignedRound(bal), hint);
    if (hero) {
      const v = hero.querySelector('[data-d="value"]');
      v.classList.toggle('is-pos', bal >= 0);
      v.classList.toggle('is-neg', bal < 0);
    }

    patchAlertCard();
    patchOrphanCard(data);
    patchTotals();

    // Řádky se hledají v rowIndexu, ne v DOMu.
    for (const s of SECTIONS) {
      const rows = sec(data, s.key).rows;
      for (let i = 0; i < rows.length; i++) patchRow(rows[i].entry, rows[i].cat, s);
    }
  };

  patchTotals = function patchTotals() {
    const screen = qs('#screen-month.is-active');
    if (!screen) return;
    const data = md(state.activeYear, state.ui.month);

    // Společné měřítko, ať jsou proužky mezi sekcemi porovnatelné.
    let peak = 0;
    for (const s of SECTIONS) {
      const v = sec(data, s.key);
      peak = Math.max(peak, num(v.plan), num(v.act));
    }

    for (const s of SECTIONS) {
      const card = screen.querySelector('.sec-card[data-sec="' + s.key + '"]');
      if (!card) continue;
      const v = sec(data, s.key);
      const plan = num(v.plan), act = num(v.act);
      setText(card.querySelector('.sec-sums [data-d="plan"]'), formatCzk(plan));
      setText(card.querySelector('.sec-sums [data-d="act"]'), formatCzk(act));

      // U výdajů je „méně, než bylo v plánu" dobrá zpráva, proto obrácené znaménko.
      const diffVal = s.dir > 0 ? act - plan : plan - act;
      const diff = card.querySelector('.sec-sums [data-d="diff"]');
      setText(diff, formatSigned(diffVal));
      diff.classList.toggle('is-pos', diffVal > 0);
      diff.classList.toggle('is-neg', diffVal < 0);

      setBarWidth(card.querySelector('[data-d="barplan"]'), pct(plan, peak) || 0);
      const bar = card.querySelector('[data-d="baract"]');
      setBarWidth(bar, pct(act, peak) || 0);
      // Bez zadaného plánu není co přečerpat — červený pruh by lhal.
      bar.classList.toggle('is-over', s.dir < 0 && plan > 0 && act > plan);
    }
  };

  patchOrphanCard = function patchOrphanCard(data) {
    const node = qs('#screen-month [data-kind="orphan"]');
    if (!node) return;
    const total = (data && data.orphans && Number.isSafeInteger(data.orphans.total)) ? data.orphans.total : 0;
    const pocet = (data && data.orphans && data.orphans.count) | 0;
    if (!total) { node.hidden = true; return; }
    node.hidden = false;
    setText(node.querySelector('[data-d="title"]'), 'Nezařazené výdaje: ' + formatCzk(total));
    setText(node.querySelector('[data-d="sub"]'),
      pocet ? (pocet === 1 ? '1 nákup nemá v tomhle měsíci svůj řádek'
                           : pocet + ' nákupů nemá v tomhle měsíci svůj řádek')
            : 'Částka u smazané kategorie');
    node.classList.add('is-warn');
  };

  patchAlertCard = function patchAlertCard() {
    const screen = qs('#screen-month.is-active');
    if (!screen) return;
    const card = screen.querySelector('.alert-card');
    if (!card) return;

    let due = null;
    try { due = computeDue(state.activeYear, state.ui.month, state.settings.dueSoonDays); } catch (e) { due = null; }
    const n = due ? due.count : 0;
    card.hidden = n === 0;
    if (!n) return;

    const overdue = due.overdue.length;
    setText(card.querySelector('[data-d="title"]'),
      'Do zaplacení: ' + csItems(n) + ' · ' + formatCzk(due.total));
    setText(card.querySelector('[data-d="sub"]'), overdue
      ? (csItems(overdue) + (overdue === 1 ? ' je po splatnosti' : ' jsou po splatnosti'))
      : 'Klepni a odškrtej, co je zaplacené');
    card.classList.toggle('is-overdue', overdue > 0);
  };

  patchRow = function patchRow(entry, cat, secDef) {
    const row = rowIndex.get(entry && entry.id);
    const n = row && row._n;
    if (!n) return;
    const y = state.activeYear, m = state.ui.month;
    const focused = document.activeElement;

    // Buňku s kurzorem přeskakujeme — tohle jediné pravidlo chrání
    // rozepsané číslo před přepsáním uprostřed psaní.
    if (!n.planCell.contains(focused)) {
      setText(n.planDisp, entry.plan === null || entry.plan === undefined ? '—' : formatCzk(entry.plan));
    }

    const manual = entry.act !== null && entry.act !== undefined;
    const fromTx = txSum(y, m, cat.id);
    if (!n.actCell.contains(focused)) {
      const eff = effActual(entry, txByCat(y, m));
      setText(n.actDisp, (!manual && fromTx === 0) ? '—' : formatCzk(eff));
      n.actDisp.classList.toggle('is-auto', !manual);   // dopočítané číslo je kurzívou
    }

    n.paid.hidden = !secDef.hasDue;
    if (secDef.hasDue) setAttrIf(n.paid, 'aria-pressed', entry.paid ? 'true' : 'false');

    // Druhý řádek. Priorita: splatnost > „ručně, ale v deníku něco je" > nic.
    if (secDef.hasDue) {
      const iso = dueIso(entry, cat, y, m);
      const days = iso ? daysUntil(iso) : null;
      n.duePill.hidden = !iso;
      if (iso) {
        setText(n.duePill, fmtDateShort(iso) + ' · ' + relDaysCs(days));
        const soon = num(state.settings.dueSoonDays);
        n.duePill.classList.toggle('is-neg', !entry.paid && days !== null && days < 0);
        n.duePill.classList.toggle('is-warn', !entry.paid && days !== null && days >= 0 && days <= soon);
        n.duePill.classList.toggle('is-muted', !!entry.paid);
      }
      n.paidPill.hidden = !entry.paid;
      n.manual.hidden = true;
    } else {
      n.duePill.hidden = true;
      n.paidPill.hidden = true;
      const show = manual && fromTx !== 0;
      n.manual.hidden = !show;
      if (show) setText(n.manual, TXT.manualBadge + ' · z deníku ' + formatCzk(fromTx));
      if (n.jwrap) n.jwrap.hidden = !show;
    }

    // Pruh spořicího cíle.
    const hasGoal = !!(secDef.hasGoal && cat.goal);
    n.goalWrap.hidden = !hasGoal;
    if (hasGoal) {
      const g = goalOf(cat);
      const saved = g ? num(g.saved) : 0;
      const target = g ? num(g.target) : num(cat.goal.target);
      const ratio = pct(saved, target);
      setBarWidth(n.goalBar, ratio === null ? 0 : ratio);
      n.goalBar.classList.toggle('is-warn', !!(g && g.late));
      setText(n.goalText, formatCzk(saved) + ' z ' + formatCzk(target));
    }
  };

  /* ============================== akce ================================== */

  // Tři možnosti místo zaškrtávátka: ptáme se česky a bez žargonu.
  // Výchozí je celý rok — opakující se náklad je ten častější případ.
  function askScope(title, okLabel) {
    return openSheet({
      title: title,
      build: function (body) {
        body.appendChild(el('p', { class: 'sheet-text' }, 'Na které měsíce to má platit?'));
        const add = function (label, value, kind) {
          const b = el('button', { class: 'btn ' + kind }, label);
          b.addEventListener('click', function () { closeSheet(value); });
          body.appendChild(b);
        };
        add((okLabel ? okLabel + ' — ' : '') + 'celý rok', 'all', 'btn-primary');
        add((okLabel ? okLabel + ' — ' : '') + 'od tohoto měsíce dál', 'rest', 'btn-ghost');
        add((okLabel ? okLabel + ' — ' : '') + 'jen tento měsíc', 'this', 'btn-ghost');
      },
      foot: [{ label: TXT.cancel, kind: 'ghost', value: null }],
    });
  }

  // Nákupy z deníku v dané kategorii a měsíci — jen na čtení.
  function txListFor(cat, m) {
    const wrap = el('div', { class: 'tx-day-list' });
    let yr = null;
    try { yr = getYear(); } catch (e) { yr = null; }
    const list = (yr && yr.tx) ? yr.tx.filter(function (t) { return !t.del && t.m === m && t.cat === cat.id; }) : [];
    if (!list.length) return null;
    list.sort(function (a, b) { return a.d < b.d ? 1 : (a.d > b.d ? -1 : 0); });
    for (const t of list) {
      const node = tpl('tpl-tx-item');
      node.removeAttribute('data-act');       // uvnitř sheetu se nikam neproklikává
      node.dataset.id = t.id;
      setText(node.querySelector('[data-d="icon"]'), cat.icon || '•');
      setText(node.querySelector('[data-d="name"]'), fmtDateShort(t.d));
      setText(node.querySelector('[data-d="note"]'), t.note || '');
      setText(node.querySelector('[data-d="amt"]'), formatCzk(t.amt));
      wrap.appendChild(node);
    }
    return wrap;
  }

  function field(body, label, value, hint, mode) {
    const f = tpl('tpl-field');
    setText(f.querySelector('[data-d="label"]'), label);
    setText(f.querySelector('[data-d="hint"]'), hint || '');
    const i = f.querySelector('input');
    i.value = value === null || value === undefined ? '' : String(value);
    if (mode) i.setAttribute('inputmode', mode);
    body.appendChild(f);
    return i;
  }

  // "15" -> 15, prázdno -> null. Nikdy Number() na uživatelský vstup jinde.
  function dayFromText(raw) {
    const s = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!/^\d{1,2}$/.test(s)) return null;
    const d = parseInt(s, 10);
    return d >= 1 && d <= 31 ? d : null;
  }

  function openRowSheet(entryId) {
    const m = state.ui.month;
    const entry = getEntry(m, entryId);
    const cat = entry ? getCat(entry.cat) : null;
    if (!entry || !cat) return;
    const secDef = SECTION_BY_KEY[cat.sec] || SECTIONS[0];
    let fName = null, fIcon = null, fDue = null, fNote = null, fTarget = null, fStart = null, fDate = null;

    openSheet({
      title: cat.name,
      build: function (body) {
        fName = field(body, 'Název', cat.name);
        fIcon = field(body, 'Ikona', cat.icon, 'Jeden emoji.');
        if (secDef.hasDue) {
          fDue = field(body, TXT.colDue, cat.dueDay,
            'Den v měsíci, 1 až 31. V kratším měsíci se posune na poslední den.', 'numeric');
        }
        fNote = field(body, 'Poznámka', cat.note, 'Nepovinné, jen pro tebe.');
        if (secDef.hasGoal) {
          const g = cat.goal || {};
          fTarget = field(body, 'Cíl', g.target ? fmtEdit(g.target) : '', 'Kolik chceš mít dohromady.', 'decimal');
          fStart = field(body, 'Už naspořeno před lednem', g.startBalance ? fmtEdit(g.startBalance) : '', '', 'decimal');
          fDate = field(body, 'Do kdy', g.targetDate, 'Ve tvaru 2026-12-31.');
        }
        const txs = txListFor(cat, m);
        if (txs) {
          body.appendChild(el('p', { class: 'field-label' }, 'Nákupy v tomhle měsíci'));
          body.appendChild(txs);
        }
      },
      foot: [
        { label: TXT.del, kind: 'danger', value: 'del' },
        { label: TXT.save, kind: 'primary', value: 'save' },
      ],
    }).then(function (res) {
      if (res === 'del') {
        askScope('Smazat „' + cat.name + '"?', 'Smazat').then(function (scope) {
          if (!scope) return;
          removeEntry(m, entry.id, scope);
          renderApp();
          toast('Smazáno: ' + cat.name, {
            action: TXT.undo,
            onAction: function () { undoLast(); renderApp(); },
          });
        });
        return;
      }
      if (res !== 'save') return;

      updateCatalogItem(cat.id, {
        name: fName.value,
        icon: fIcon.value.trim(),
        dueDay: fDue ? dayFromText(fDue.value) : undefined,
      });
      // Katalog pole pro poznámku nemá a updateCatalogItem() ho neumí zapsat.
      // Píšeme ho proto přímo a necháme bump() zvednout revizi; sanitizer
      // v 32-storage.js cizí klíče nemaže, takže poznámka přežije uložení.
      const note = String(fNote.value || '').trim();
      if (note !== String(cat.note || '')) { cat.note = note; bump(cat); }

      if (secDef.hasGoal) {
        const t = parseCzkInput(fTarget.value);
        const s = parseCzkInput(fStart.value);
        const d = String(fDate.value || '').trim();
        if (t.ok && t.minor) {
          setGoal(cat.id, {
            target: t.minor,
            startBalance: (s.ok && s.minor) ? s.minor : 0,
            targetDate: parseYmd(d) ? d : null,
          });
        } else if (t.ok && t.minor === null) {
          setGoal(cat.id, null);
        }
      }
      renderApp();
      toast(TXT.saved);
    });
  }

  // ACTIONS žije v 60-events.js, které se slepuje AŽ ZA tímhle souborem.
  // Přímé Object.assign(ACTIONS, …) na úrovni souboru by spadlo do dočasné
  // mrtvé zóny `const ACTIONS`. Odložíme to o jeden mikroúkol — pořád je to
  // dávno před prvním klepnutím.
  Promise.resolve().then(function () {
    Object.assign(ACTIONS, {

      'row.add': function (ctx) {
        const secDef = SECTION_BY_KEY[ctx.sec];
        if (!secDef) return;
        inputSheet({
          title: secDef.addLabel, label: 'Název položky', required: true,
          placeholder: 'Třeba Nájem', okLabel: 'Pokračovat',
        }).then(function (name) {
          if (!name) return;
          askScope('Jak často „' + name + '" platíš?', '').then(function (scope) {
            if (!scope) return;
            addCatalogItem({ sec: secDef.key, name: name, icon: SEC_ICON[secDef.key] || '•' }, scope);
            renderApp();
            toast('Přidáno: ' + name, {
              action: TXT.undo,
              onAction: function () { undoLast(); renderApp(); },
            });
          });
        });
      },

      'row.open': function (ctx) { if (ctx.id) openRowSheet(ctx.id); },

      'row.paid': function (ctx) {
        const m = state.ui.month;
        const entry = getEntry(m, ctx.id);
        if (!entry) return;
        const was = !!entry.paid;
        togglePaid(m, ctx.id, !was);
        renderApp();                         // autofill mohl přepsat i pole skutečnosti
        toast(was ? 'Zaplacení zrušeno' : 'Zaplaceno', {
          action: TXT.undo,
          onAction: function () { togglePaid(m, ctx.id, was); renderApp(); },
        });
      },

      'row.useJournal': function (ctx) {
        const m = state.ui.month;
        const entry = getEntry(m, ctx.id);
        if (!entry) return;
        const was = entry.act;
        clearActual(m, ctx.id);
        renderApp();
        toast('Skutečnost se počítá z deníku.', {
          action: TXT.undo,
          onAction: function () { setActual(m, ctx.id, was); renderApp(); },
        });
      },

      'sec.toggle': function (ctx) {
        const card = ctx.node.closest('.sec-card');
        if (!card) return;
        const map = collapsedMap();
        const off = !map[card.dataset.sec];
        map[card.dataset.sec] = off;
        card.classList.toggle('is-collapsed', off);
        setAttrIf(ctx.node, 'aria-expanded', off ? 'false' : 'true');
        scheduleSave();
      },

    });
  });

})();
