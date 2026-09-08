// 34-derived.js — čistý výpočet, memoizace na state.rev — vlastní: L2
// Nic se tu nemění a nic se neukládá. Rok je vždycky součet měsíců.
// Memo tabulky visí na samotných funkcích, aby nepřibylo top-level jméno.

txByCat.memo = new Map();
computeMonth.memo = new Map();
computeYear.memo = new Map();
computeGoals.memo = new Map();
computeDue.memo = new Map();
orphanTx.memo = new Map();
dailySlices.memo = new Map();
savingsSlices.memo = new Map();

invalidateAll.all = [txByCat, computeMonth, computeYear, computeGoals,
                     computeDue, orphanTx, dailySlices, savingsSlices];

function invalidate(y, m) {
  if (y === undefined) return invalidateAll();
  const needle = (m === undefined) ? String(y) + ':' : String(y) + ':' + String(m) + ':';
  const exact = String(y);           // computeYear a savingsSlices klíčují jen rokem
  invalidateAll.all.forEach(function (fn) {
    Array.from(fn.memo.keys()).forEach(function (k) {
      if (k.indexOf(needle) === 0 || k === exact) fn.memo.delete(k);
    });
  });
}

function invalidateAll() {
  invalidateAll.all.forEach(function (fn) { fn.memo.clear(); });
}

/* Memo drží { rev, val } pod klíčem bez rev, takže se sama přepisuje
   a neroste do nekonečna. */
function _dMemo(fn, key, make) {
  const hit = fn.memo.get(key);
  if (hit && hit.rev === state.rev) return hit.val;
  const val = make();
  fn.memo.set(key, { rev: state.rev, val: val });
  return val;
}

// Čtení bez zakládání — odvozený kód do state nesahá.
function _dYear(y) {
  const yr = state.years[String(Number.isInteger(y) ? y : state.activeYear)];
  return (yr && typeof yr === 'object') ? yr : null;
}
function _dCats(yr) {
  const map = new Map();
  if (yr) for (let i = 0; i < yr.catalog.length; i++) map.set(yr.catalog[i].id, yr.catalog[i]);
  return map;
}
function _dEntries(yr, m) {
  if (!yr) return [];
  const mo = yr.months[m];
  return (mo && Array.isArray(mo.entries)) ? mo.entries : [];
}

/* ---------- deník po kategoriích ---------- */

// Živý řádek = nesmazaný záznam, jehož kategorie existuje a není archivovaná.
function _dLive(yr, m) {
  const live = new Set();
  if (!yr) return live;
  const cats = _dCats(yr);
  _dEntries(yr, m).forEach(function (e) {
    if (!e || e.del) return;
    const c = cats.get(e.cat);
    if (c && !c.archived) live.add(e.cat);
  });
  return live;
}

// Map<catId, součet haléřů> pro kategorie, které v tom měsíci mají živý řádek.
// Zbytek (smazaná kategorie, vyhozený řádek, zápis bez kategorie) patří do
// orphanTx — tyhle dvě množiny se nepřekrývají a dohromady dají všechno,
// takže "koše + osiřelé === všechny zápisy" platí i po sečtení celé mapy.
function txByCat(y, m) {
  return _dMemo(txByCat, y + ':' + m, function () {
    const map = new Map();
    const yr = _dYear(y);
    if (!yr) return map;
    const live = _dLive(yr, m);
    for (let i = 0; i < yr.tx.length; i++) {
      const t = yr.tx[i];
      if (!t || t.del || t.m !== m) continue;
      if (!Number.isSafeInteger(t.amt)) continue;
      if (!t.cat || !live.has(t.cat)) continue;
      map.set(t.cat, (map.get(t.cat) || 0) + t.amt);
    }
    return map;
  });
}

/* ---------- pravidlo přednosti ----------
   act === null  -> součet z deníku (chybí-li, nula)
   act === číslo -> ruční hodnota
   NIKDY se nesčítají. 300 ručně a 250 v deníku dá 250, nebo 300. Ne 550. */
function effActual(entry, txMap) {
  if (!entry) return 0;
  if (entry.act !== null && entry.act !== undefined) {
    return Number.isSafeInteger(entry.act) ? entry.act : 0;
  }
  if (!txMap) return 0;
  const v = txMap.get(entry.cat);
  return Number.isSafeInteger(v) ? v : 0;
}

/* ---------- nezařazené peníze ----------
   Zápisy, na které se v tom měsíci nedá napojit žádný živý řádek: kategorie
   byla smazaná, archivovaná, řádek vyhozený, nebo tam kategorie vůbec není.
   Bez tohohle kbelíku by peníze po smazání kategorie tiše zmizely. */
function orphanTx(y, m) {
  return _dMemo(orphanTx, y + ':' + m, function () {
    const yr = _dYear(y);
    if (!yr) return [];
    const live = _dLive(yr, m);
    const out = [];
    for (let i = 0; i < yr.tx.length; i++) {
      const t = yr.tx[i];
      if (!t || t.del || t.m !== m) continue;
      if (t.cat && live.has(t.cat)) continue;
      out.push(t);
    }
    return out;
  });
}

/* ---------- měsíc ---------- */

function computeMonth(y, m) {
  return _dMemo(computeMonth, y + ':' + m, function () {
    const yr = _dYear(y);
    const cats = _dCats(yr);
    const txMap = txByCat(y, m);

    const sections = {};
    for (let i = 0; i < SECTIONS.length; i++) {
      const s = SECTIONS[i];
      sections[s.key] = { key: s.key, dir: s.dir, plan: 0, act: 0, diff: 0,
                          count: 0, paidCount: 0, dueCount: 0, rows: [] };
    }

    // Ručně zadaná skutečnost u archivované kategorie. Řádek se nezobrazuje,
    // ale peníze utracené byly — musí zůstat ve výdajích, jinak by smazání
    // kategorie zvedlo zůstatek o částku, kterou uživatelka opravdu vydala.
    let archivovaneRucne = 0;
    _dEntries(yr, m).forEach(function (e) {
      if (!e || e.del) return;
      const c = cats.get(e.cat);
      if (c && c.archived && c.sec !== 'income'
          && Number.isSafeInteger(e.act) && e.act !== 0) archivovaneRucne += e.act;
    });

    _dEntries(yr, m).forEach(function (e) {
      if (!e || e.del) return;
      const cat = cats.get(e.cat);
      if (!cat || cat.archived) return;          // archivovaná kategorie řádek nemá
      const sec = sections[cat.sec];
      if (!sec) return;
      const plan = Number.isSafeInteger(e.plan) ? e.plan : 0;
      const act = effActual(e, txMap);
      const txSum = txMap.get(e.cat) || 0;
      const dueDay = (e.due !== null && e.due !== undefined) ? e.due : cat.dueDay;
      const due = (SECTION_BY_KEY[cat.sec].hasDue && Number.isInteger(dueDay))
        ? dueDateFor(y, m, dueDay) : null;
      sec.plan += plan;
      sec.act += act;
      sec.count += 1;
      if (e.paid) sec.paidCount += 1;
      if (due) sec.dueCount += 1;
      sec.rows.push({
        id: e.id, entry: e, cat: cat, order: cat.order | 0,
        plan: plan, act: act, txSum: txSum,
        diff: act - plan,
        manual: e.act !== null && e.act !== undefined,
        autoFilled: e.autoFilled === true,
        paid: e.paid === true, paidAt: e.paidAt || null,
        dueDay: Number.isInteger(dueDay) ? dueDay : null, due: due
      });
    });

    SECTIONS.forEach(function (s) {
      const sec = sections[s.key];
      sec.diff = sec.act - sec.plan;
      sec.rows.sort(function (a, b) { return a.order - b.order || cmpCs(a.cat.name, b.cat.name); });
    });

    const income = sections.income.act;
    const plannedIncome = sections.income.plan;
    let outflow = 0, plannedOutflow = 0;
    SECTIONS.forEach(function (s) {
      if (s.key === 'income') return;
      outflow += sections[s.key].act;              // úspory se počítají jako odliv
      plannedOutflow += sections[s.key].plan;
    });

    const orph = orphanTx(y, m);
    let orphanTotal = 0;
    for (let i = 0; i < orph.length; i++) {
      // Stejná pojistka jako v txByCat: poškozená částka nesmí otrávit součet.
      if (Number.isSafeInteger(orph[i].amt)) orphanTotal += orph[i].amt;
    }

    // Nezařazené nákupy PATŘÍ do výdajů. Bez toho tři čísla na hlavní
    // obrazovce nesedí (příjmy − výdaje ≠ zůstatek) a po smazání kategorie
    // by zůstatek vyskočil nahoru o částku, kterou reálně utratila.
    // Přísná rovnost přes sekce zůstává dostupná jako outflowSections
    // a balanceSections.
    const outflowSections = outflow;
    const nezarazeno = orphanTotal + archivovaneRucne;
    outflow += nezarazeno;

    // Nezařazené nákupy do zůstatku NEPATŘÍ: závazná rovnost zní
    //   příjmy − (fixed + daily + savings + debt + subs) === zůstatek
    // a ta musí sedět na haléř. Peníze se ale nesmí ztratit z očí, proto se
    // vydávají zvlášť v `orphans` (a v pesimistické variantě níž), aby je
    // obrazovka mohla nabídnout k zařazení.
    // Kolik dní ještě zbývá utrácet. Minulý měsíc nemá kolik, tam je to null.
    const t = parseYmd(todayISO());
    const cur = t ? t.y * 12 + t.m : y * 12 + m;
    const here = y * 12 + m;
    let daysLeft;
    if (here > cur) daysLeft = daysInMonth(y, m);
    else if (here < cur) daysLeft = 0;
    else daysLeft = daysInMonth(y, m) - t.day + 1;

    const balance = income - outflow;                 // to, co vidí uživatelka
    const balanceSections = income - outflowSections; // přísná rovnost přes sekce
    // Sekce visí i přímo na výsledku (md.fixed.act), vedle mapy md.sections.
    // Skalární součet příjmů je incomeTotal, protože md.income je sekce.
    const res = {
      y: y, m: m, rev: state.rev,
      sections: sections,
      incomeTotal: income,
      outflow: outflow,
      outflowSections: outflowSections,
      balance: balance,
      balanceSections: balanceSections,
      plannedIncome: plannedIncome,
      plannedOutflow: plannedOutflow,
      plannedBalance: plannedIncome - plannedOutflow,
      daysLeft: daysLeft,
      leftPerDay: daysLeft > 0 ? Math.trunc(balance / daysLeft) : null,
      orphans: { count: orph.length, total: nezarazeno, txTotal: orphanTotal, manualTotal: archivovaneRucne },
      balanceWithOrphans: balance,
      note: (yr && yr.months[m] && typeof yr.months[m].note === 'string') ? yr.months[m].note : ''
    };
    SECTIONS.forEach(function (s) { res[s.key] = sections[s.key]; });
    return res;
  });
}

/* ---------- rok ----------
   Součet dvanácti měsíců, nikdy uložené číslo. */
function computeYear(y) {
  return _dMemo(computeYear, String(y), function () {
    const months = [];
    const totals = {
      sections: {}, income: 0, outflow: 0, balance: 0,
      plannedIncome: 0, plannedOutflow: 0, plannedBalance: 0,
      orphans: { count: 0, total: 0 }
    };
    SECTIONS.forEach(function (s) { totals.sections[s.key] = { key: s.key, plan: 0, act: 0, diff: 0 }; });

    for (let m = 0; m < 12; m++) {
      const mm = computeMonth(y, m);
      months.push(mm);
      SECTIONS.forEach(function (s) {
        totals.sections[s.key].plan += mm.sections[s.key].plan;
        totals.sections[s.key].act += mm.sections[s.key].act;
      });
      totals.income += mm.incomeTotal;
      totals.outflow += mm.outflow;
      totals.plannedIncome += mm.plannedIncome;
      totals.plannedOutflow += mm.plannedOutflow;
      totals.orphans.count += mm.orphans.count;
      totals.orphans.total += mm.orphans.total;
    }
    SECTIONS.forEach(function (s) {
      const t = totals.sections[s.key];
      t.diff = t.act - t.plan;
    });
    totals.balance = totals.income - totals.outflow;
    totals.balanceSections = totals.balance + totals.orphans.total;
    totals.plannedBalance = totals.plannedIncome - totals.plannedOutflow;
    const res = {
      year: y, months: months, totals: totals, sections: totals.sections,
      incomeTotal: totals.income, outflow: totals.outflow, balance: totals.balance,
      plannedIncome: totals.plannedIncome, plannedOutflow: totals.plannedOutflow,
      plannedBalance: totals.plannedBalance, orphans: totals.orphans
    };
    SECTIONS.forEach(function (s) { res[s.key] = totals.sections[s.key]; });
    return res;
  });
}

/* ---------- spořicí cíle ----------
   Naspořeno = startBalance + součet skutečností té kategorie za celý rok.
   0/0 je NaN a 500/0 je Infinity — obojí se musí vrátit jako null, aby to
   šlo vykreslit pomlčkou a ne jako číslo. */
function computeGoals(y) {
  return _dMemo(computeGoals, String(y), function () {
    const yr = _dYear(y);
    if (!yr) return [];
    const maps = [];
    for (let m = 0; m < 12; m++) maps.push(txByCat(y, m));

    const t = parseYmd(todayISO());
    const nowIdx = t ? t.y * 12 + t.m : y * 12;
    const elapsed = clamp((nowIdx - (y * 12)) + 1, 0, 12);   // kolik měsíců roku už proběhlo

    const out = [];
    yr.catalog.forEach(function (cat) {
      if (cat.sec !== 'savings' || cat.archived) return;
      let contributed = 0;
      for (let m = 0; m < 12; m++) {
        const mo = yr.months[m];
        if (!mo) continue;
        for (let i = 0; i < mo.entries.length; i++) {
          const e = mo.entries[i];
          if (!e || e.del || e.cat !== cat.id) continue;
          contributed += effActual(e, maps[m]);
        }
      }
      const goal = cat.goal || null;
      const target = goal && Number.isSafeInteger(goal.target) ? goal.target : 0;
      const startBalance = goal && Number.isSafeInteger(goal.startBalance) ? goal.startBalance : 0;
      const targetDate = goal ? (goal.targetDate || null) : null;
      const saved = startBalance + contributed;
      const ratio = target > 0 ? saved / target : null;      // ne NaN, ne Infinity
      const left = target > 0 ? Math.max(0, target - saved) : null;

      const perMonth = elapsed > 0 ? Math.trunc(contributed / elapsed) : null;
      let monthsToTarget = null, needPerMonth = null, late = false;
      if (targetDate) {
        const td = parseYmd(targetDate);
        if (td) {
          monthsToTarget = (td.y * 12 + td.m) - nowIdx;
          if (monthsToTarget <= 0) { late = left !== null && left > 0; monthsToTarget = 0; needPerMonth = null; }
          else needPerMonth = left === null ? null : Math.ceil(left / monthsToTarget);
        }
      }
      let etaMonths = null;
      if (left !== null && left > 0 && perMonth !== null && perMonth > 0) etaMonths = Math.ceil(left / perMonth);
      else if (left === 0) etaMonths = 0;
      let etaISO = null;
      if (etaMonths !== null && t) {
        const p = addMonths(t.y, t.m, etaMonths);
        etaISO = dueDateFor(p.y, p.m, daysInMonth(p.y, p.m));
      }

      out.push({
        id: cat.id, cat: cat, name: cat.name, icon: cat.icon,
        target: target, startBalance: startBalance, targetDate: targetDate,
        contributed: contributed, saved: saved,
        ratio: ratio, left: left, done: target > 0 && saved >= target,
        perMonth: perMonth, monthsToTarget: monthsToTarget,
        needPerMonth: needPerMonth, late: late,
        etaMonths: etaMonths, etaISO: etaISO
      });
    });
    out.sort(function (a, b) { return (a.cat.order | 0) - (b.cat.order | 0) || cmpCs(a.name, b.name); });
    return out;
  });
}

/* ---------- splatnosti ----------
   Splatnost 31. v únoru je 28. (nebo 29.), nikdy 3. března — to řeší
   dueDateFor(). Rozdíl dnů přes daysBetween(), kvůli letnímu času. */
function computeDue(y, m, daysAhead) {
  const ahead = Number.isInteger(daysAhead) ? daysAhead
    : (Number.isInteger(state.settings.dueSoonDays) ? state.settings.dueSoonDays : 7);
  return _dMemo(computeDue, y + ':' + m + ':' + ahead, function () {
    const res = { overdue: [], soon: [], later: [], paid: [], count: 0, total: 0, daysAhead: ahead };
    const mm = computeMonth(y, m);
    const today = todayISO();
    SECTIONS.forEach(function (s) {
      if (!s.hasDue) return;
      mm.sections[s.key].rows.forEach(function (r) {
        if (!r.due) return;
        const days = daysBetween(today, r.due);
        const item = {
          id: r.id, entry: r.entry, cat: r.cat, sec: s.key,
          due: r.due, dueDay: r.dueDay, days: days,
          plan: r.plan, act: r.act, paid: r.paid, m: m
        };
        if (r.paid) { res.paid.push(item); return; }
        if (days !== null && days < 0) res.overdue.push(item);
        else if (days !== null && days <= ahead) res.soon.push(item);
        else res.later.push(item);
      });
    });
    const bySoonest = function (a, b) { return a.due < b.due ? -1 : (a.due > b.due ? 1 : 0); };
    res.overdue.sort(bySoonest); res.soon.sort(bySoonest);
    res.later.sort(bySoonest); res.paid.sort(bySoonest);
    res.count = res.overdue.length + res.soon.length;
    res.total = sumMinor(res.overdue.map(function (i) { return i.plan; })
      .concat(res.soon.map(function (i) { return i.plan; })));
    return res;
  });
}

/* ---------- výseče ----------
   Nejvýš 11 dílků a zbytek do "Ostatní", nulové pryč. */
function _dSlices(items) {
  const list = items.filter(function (s) { return s.value > 0; })
                    .sort(function (a, b) { return b.value - a.value; });
  let out = list;
  if (list.length > 12) {
    const head = list.slice(0, 11);
    let rest = 0;
    for (let i = 11; i < list.length; i++) rest += list[i].value;
    head.push({ id: '_rest', label: 'Ostatní', icon: '', value: rest, ratio: 0 });
    out = head;
  }
  const total = sumMinor(out.map(function (s) { return s.value; }));
  out.forEach(function (s) { s.ratio = total > 0 ? s.value / total : 0; });
  return out;
}

function dailySlices(y, m) {
  return _dMemo(dailySlices, y + ':' + m, function () {
    const mm = computeMonth(y, m);
    return _dSlices(mm.sections.daily.rows.map(function (r) {
      return { id: r.cat.id, label: r.cat.name, icon: r.cat.icon, value: r.act, ratio: 0 };
    }));
  });
}

function savingsSlices(y) {
  return _dMemo(savingsSlices, String(y), function () {
    return _dSlices(computeGoals(y).map(function (g) {
      return { id: g.id, label: g.name, icon: g.icon, value: g.contributed, ratio: 0 };
    }));
  });
}
