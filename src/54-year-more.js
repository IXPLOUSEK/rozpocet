// 54-year-more.js — obrazovka Rok (měsíce jako řádky) a Nastavení (Víc) — vlastní: L11
// Dvanáct sloupců vedle sebe se na 390px displeji přečíst nedá. Proto jsou
// měsíce ŘÁDKY. Vodorovná tabulka existuje, ale až od 700px a jen jako doplněk.

/* ======================= roční metriky ======================= */

// yearMetric(y, secKey) -> { months:[{m,plan,act,diff}] ×12, total:{plan,act,diff} }
// secKey = klíč sekce ze SECTIONS, nebo 'outflow' (pět výdajových sekcí),
// nebo 'balance' (příjmy minus výdaje).
// Roční číslo je součet dvanácti měsíců v celých haléřích. Nikdy se
// nedopočítává ze zformátovaných řetězců — dvanáct zaokrouhlení by uteklo.
function yearMetric(y, secKey) {
  const OUTFLOW = ['fixed', 'daily', 'savings', 'debt', 'subs'];
  const keys = secKey === 'balance' ? ['income'].concat(OUTFLOW)
    : (secKey === 'outflow' ? OUTFLOW : [secKey]);
  const months = [];
  let tp = 0, ta = 0;

  for (let m = 0; m < 12; m++) {
    let md = null;
    try { md = typeof computeMonth === 'function' ? computeMonth(y, m) : null; }
    catch (e) { md = null; }
    let plan = 0, act = 0;
    if (secKey === 'balance' || secKey === 'outflow') {
      // Zůstatek i výdaje se berou hotové z computeMonth, aby na obrazovce
      // Rok stálo přesně totéž číslo jako na obrazovce Měsíc. Sečíst si to
      // znovu ze sekcí by vynechalo nezařazené nákupy a obě obrazovky by
      // pak o stejných penězích tvrdily každá něco jiného.
      if (md) {
        if (secKey === 'balance') {
          plan = Number.isSafeInteger(md.plannedBalance) ? md.plannedBalance : 0;
          act = Number.isSafeInteger(md.balance) ? md.balance : 0;
        } else {
          plan = Number.isSafeInteger(md.plannedOutflow) ? md.plannedOutflow : 0;
          act = Number.isSafeInteger(md.outflow) ? md.outflow : 0;
        }
      }
    } else {
      for (const k of keys) {
        const b = md && md[k];
        if (!b || typeof b !== 'object') continue;
        if (Number.isSafeInteger(b.plan)) plan += b.plan;
        if (Number.isSafeInteger(b.act)) act += b.act;
      }
    }
    months.push({ m: m, plan: plan, act: act, diff: act - plan });
    tp += plan; ta += act;
  }

  // computeYear() je nezávislá cesta ke stejnému číslu. Když se rozejde,
  // je to chyba ve výpočtu, ne v zobrazení — ať je to vidět v konzoli.
  if (secKey === 'balance' && typeof computeYear === 'function') {
    try {
      const yr = computeYear(y);
      const yb = yr && yr.totals ? yr.totals.balance : (yr ? yr.balance : null);
      if (Number.isSafeInteger(yb) && yb !== ta) {
        console.warn('roční zůstatek se rozešel se součtem měsíců', yb, ta);
      }
    } catch (e) { /* rok bez dat — nevadí */ }
  }
  return { months: months, total: { plan: tp, act: ta, diff: ta - tp } };
}

/* ======================= obrazovka Rok ======================= */

// Dvanáct řádků z tpl-year-row. Jen kostra, čísla doplní patchYear().
function renderYearRows() {
  const list = el('div', { class: 'card year-rows' });
  for (let m = 0; m < 12; m++) {
    const r = tpl('tpl-year-row');
    r.dataset.m = String(m);
    setText(r.querySelector('[data-d="month"]'), MONTHS_NOM[m]);
    list.appendChild(r);
  }
  return list;
}

function renderYearScreen() {
  const host = qs('#screen-year');
  if (!host) return;
  const y = state.activeYear;
  const tab = SECTION_BY_KEY[state.ui.yearTab] ? state.ui.yearTab : 'summary';
  state.ui.yearTab = tab;
  const frag = document.createDocumentFragment();

  /* --- roční součty --- */
  const head = el('div', { class: 'card year-head' });
  [['income', TXT.kpiIncome], ['outflow', TXT.kpiExpense], ['balance', TXT.kpiLeft]]
    .forEach(function (p) {
      const k = tpl('tpl-kpi');
      k.dataset.k = p[0];
      setText(k.querySelector('[data-d="label"]'), p[1]);
      head.appendChild(k);
    });
  frag.appendChild(head);

  /* --- přepínač: Souhrn + jedna položka na sekci ---
     Vodorovné rolování je tu natvrdo schválně: kdyby ho CSS neumělo,
     sedm segmentů by se na telefonu zalomilo do tří řádků. */
  const seg = el('nav', {
    class: 'seg', 'aria-label': 'Co ukázat',
    style: 'display:flex;gap:var(--sp-2);overflow-x:auto;scrollbar-width:none;padding-block:2px',
  });
  const segItem = function (val, label) {
    const c = tpl('tpl-chip');
    c.dataset.act = 'year.tab';
    c.dataset.val = val;
    setText(c.querySelector('[data-d="label"]'), label);
    c.classList.toggle('is-active', val === tab);
    setAttrIf(c, 'aria-pressed', val === tab ? 'true' : 'false');
    seg.appendChild(c);
  };
  segItem('summary', 'Souhrn');
  for (const s of SECTIONS) segItem(s.key, s.short);
  frag.appendChild(seg);

  /* --- dvanáct řádků --- */
  frag.appendChild(renderYearRows());

  /* --- jen u sekce: roční pruh a graf --- */
  let chartHost = null, chartData = null;
  if (tab !== 'summary') {
    const met = yearMetric(y, tab);
    const strip = el('div', { class: 'card year-total' });
    strip.appendChild(el('h3', { class: 'sec-title' }, SECTION_BY_KEY[tab].label));
    const sums = el('div', { class: 'sec-sums' });
    [[TXT.colPlan, 'y-tot-plan', ''], [TXT.colActual, 'y-tot-act', ' is-strong'],
     [TXT.diff, 'y-tot-diff', '']].forEach(function (p) {
      const box = el('span', { class: 'sec-sum' });
      box.appendChild(el('span', { class: 'sec-sum-lbl' }, p[0]));
      box.appendChild(el('span', { class: 'sec-sum-val' + p[2], 'data-d': p[1] }));
      sums.appendChild(box);
    });
    strip.appendChild(sums);
    frag.appendChild(strip);

    // Graf je nepovinný — když se dráha s grafy nenačetla, prostě tu není.
    if (typeof chartYearColumns === 'function') {
      const card = tpl('tpl-chart-card');
      setText(card.querySelector('[data-d="title"]'), 'Skutečnost po měsících');
      const legend = card.querySelector('[data-d="legend"]');
      if (legend) legend.remove();
      frag.appendChild(card);
      // Kreslí se až po zavěšení do dokumentu, jinak nezná svou šířku.
      chartHost = card.querySelector('[data-d="host"]');
      chartData = met.months.map(function (r) { return Math.abs(r.act); });
    }
  }

  /* --- široká obrazovka: opravdová srovnávací tabulka ---
     Na telefonu se nevykresluje vůbec. Čísla v ní se dopočítávají při
     překreslení, ne v patchi — na obrazovce Rok se stejně nedá editovat. */
  if (window.matchMedia && window.matchMedia('(min-width: 700px)').matches) {
    const stick = 'position:sticky;inset-inline-start:0;background:var(--surface);text-align:start';
    const sm = tab === 'summary' ? null : yearMetric(y, tab);
    // [popisek, metrika, pole, se znaménkem]
    const rows = tab === 'summary'
      ? [[TXT.kpiIncome, yearMetric(y, 'income'), 'act', false],
         [TXT.kpiExpense, yearMetric(y, 'outflow'), 'act', false],
         [TXT.kpiLeft, yearMetric(y, 'balance'), 'act', true]]
      : [[TXT.colPlan, sm, 'plan', false],
         [TXT.colActual, sm, 'act', false],
         [TXT.diff, sm, 'diff', true]];
    const wrap = el('div', { class: 'card ycmp-wrap', style: 'overflow-x:auto' });
    const t = el('table', { class: 'ycmp', style: 'border-collapse:collapse;width:100%' });
    t.appendChild(el('caption', { style: 'text-align:start' },
      tab === 'summary' ? 'Rok ' + y + ' po měsících' : SECTION_BY_KEY[tab].label));
    const trh = el('tr');
    trh.appendChild(el('th', { scope: 'col', style: stick }, ''));
    for (let m = 0; m < 12; m++) trh.appendChild(el('th', { scope: 'col' }, MONTHS_SHORT[m]));
    trh.appendChild(el('th', { scope: 'col' }, TXT.total));
    const thead = el('thead'); thead.appendChild(trh); t.appendChild(thead);
    const tb = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      tr.appendChild(el('th', { scope: 'row', style: stick }, r[0]));
      for (const cell of r[1].months) {
        tr.appendChild(el('td', null, r[3] ? formatSigned(cell[r[2]]) : formatCzk(cell[r[2]])));
      }
      tr.appendChild(el('td', null, r[3] ? formatSigned(r[1].total[r[2]]) : formatCzk(r[1].total[r[2]])));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    wrap.appendChild(t);
    frag.appendChild(wrap);
  }

  host.replaceChildren(frag);
  if (chartHost && chartData) {
    chartYearColumns(chartHost, chartData,
      { title: SECTION_BY_KEY[tab].short + ' po měsících', active: state.ui.month });
  }

  // Otočení iPadu mění, jestli tabulka dává smysl. Posluchač se váže jednou.
  if (!renderYearScreen.mqBound && window.matchMedia) {
    renderYearScreen.mqBound = true;
    const mq = window.matchMedia('(min-width: 700px)');
    const onFlip = function () { if (state.ui.screen === 'year') renderApp(); };
    if (mq.addEventListener) mq.addEventListener('change', onFlip);
    else if (mq.addListener) mq.addListener(onFlip);
  }
}

// Dopočty. Jen textContent, style.width, classList a aria-*. Nikdy nevytváří
// ani neruší uzly a na obrazovce, která není aktivní, se rovnou vrací.
function patchYear() {
  const host = qs('#screen-year.is-active');
  if (!host) return;
  const y = state.activeYear;
  const tab = SECTION_BY_KEY[state.ui.yearTab] ? state.ui.yearTab : 'summary';

  /* --- hlavička --- */
  const inc = yearMetric(y, 'income');
  const out = yearMetric(y, 'outflow');
  const bal = yearMetric(y, 'balance');
  const kpi = function (key, valTxt, hintTxt) {
    const box = qs('[data-k="' + key + '"]', host);
    if (!box) return null;
    const v = box.querySelector('[data-d="value"]');
    setText(v, valTxt);
    setText(box.querySelector('[data-d="hint"]'), hintTxt);
    return v;
  };
  kpi('income', formatCzk(inc.total.act), 'plán ' + formatCzk(inc.total.plan));
  kpi('outflow', formatCzk(out.total.act), 'plán ' + formatCzk(out.total.plan));
  const bv = kpi('balance', formatSigned(bal.total.act), 'plán ' + formatSigned(bal.total.plan));
  if (bv) {
    bv.classList.toggle('is-pos', bal.total.act > 0);
    bv.classList.toggle('is-neg', bal.total.act < 0);
  }

  /* --- dvanáct řádků --- */
  const met = tab === 'summary' ? out : yearMetric(y, tab);
  const vals = tab === 'summary' ? bal : met;
  let max = 1;
  for (const r of met.months) {
    const a = Math.max(Math.abs(r.plan), Math.abs(r.act));
    if (a > max) max = a;
  }

  for (const row of qsa('.yrow', host)) {
    const m = Number(row.dataset.m);
    if (!Number.isFinite(m) || m < 0 || m > 11) continue;
    const bar = met.months[m], val = vals.months[m];

    setBarWidth(row.querySelector('[data-d="barplan"]'), Math.abs(bar.plan) / max);
    const ba = row.querySelector('[data-d="baract"]');
    setBarWidth(ba, Math.abs(bar.act) / max);
    // Přečerpáno = skutečnost přerostla plán. U zůstatku to smysl nedává.
    if (ba) ba.classList.toggle('is-over', tab !== 'summary' && bar.act > bar.plan && bar.plan > 0);

    const pn = row.querySelector('[data-d="plan"]');
    const an = row.querySelector('[data-d="act"]');
    if (tab === 'summary') {
      setText(pn, 'plán ' + formatSigned(val.plan));
      setText(an, formatSigned(val.act));
    } else {
      setText(pn, formatCzk(val.plan));
      setText(an, formatCzk(val.act));
    }
    if (an) {
      an.classList.toggle('is-pos', tab === 'summary' && val.act > 0);
      an.classList.toggle('is-neg', tab === 'summary' && val.act < 0);
    }

    // Tečka = v tom měsíci je něco po splatnosti a nezaplacené.
    let overdue = 0;
    try {
      const due = computeDue(y, m, state.settings.dueSoonDays);
      overdue = due && due.overdue ? due.overdue.length : 0;
    } catch (e) { overdue = 0; }
    const dot = row.querySelector('[data-d="dot"]');
    if (dot) { dot.hidden = overdue === 0; dot.classList.toggle('is-neg', overdue > 0); }

    setAttrIf(row, 'aria-label', MONTHS_NOM[m] + ', ' +
      (tab === 'summary' ? TXT.kpiLeft.toLowerCase() + ' ' + formatSigned(val.act)
        : SECTION_BY_KEY[tab].short + ' ' + formatCzk(val.act)) +
      (overdue ? ', ' + overdue + ' po splatnosti' : ''));
    setAttrIf(row, 'aria-current', m === state.ui.month ? 'true' : null);
    row.classList.toggle('is-active', m === state.ui.month);
  }

  /* --- roční pruh sekce --- */
  if (tab !== 'summary') {
    setText(qs('[data-d="y-tot-plan"]', host), formatCzk(met.total.plan));
    setText(qs('[data-d="y-tot-act"]', host), formatCzk(met.total.act));
    const d = qs('[data-d="y-tot-diff"]', host);
    setText(d, formatSigned(met.total.diff));
    if (d) {
      d.classList.toggle('is-neg', met.total.diff > 0);   // přečerpáno
      d.classList.toggle('is-pos', met.total.diff < 0);   // ušetřeno
    }
  }
}

/* ======================= Nastavení (Víc) ======================= */

function renderSettingsScreen() {
  const host = qs('#screen-more');
  if (!host) return;
  const frag = document.createDocumentFragment();

  // Malí pomocníci, ať se karty čtou jako seznam obsahu, ne jako DOM.
  const card = function (title) {
    const c = el('section', { class: 'card set-card' });
    c.appendChild(el('h2', { class: 'sec-title' }, title));
    frag.appendChild(c);
    return c;
  };
  const say = function (parent, text, cls) {
    parent.appendChild(el('p', { class: 'sheet-text' + (cls ? ' ' + cls : '') }, text));
  };
  const slot = function (parent, name, cls) {
    const p = el('p', { class: 'set-line' + (cls ? ' ' + cls : ''), 'data-d': name });
    parent.appendChild(p);
    return p;
  };
  const bar = function (parent) {
    const b = el('div', { class: 'set-actions',
      style: 'display:flex;flex-wrap:wrap;gap:var(--sp-2)' });
    parent.appendChild(b);
    return b;
  };
  const btn = function (parent, label, act, kind) {
    parent.appendChild(el('button', { class: 'btn ' + (kind || 'btn-ghost'), 'data-act': act }, label));
  };

  /* --- 1. Instalace. Nejdůležitější věc na téhle obrazovce. --- */
  const inst = card('Instalace');
  slot(inst, 'install-state');
  say(inst, 'Dokud aplikace není ikona na ploše, může ji iPhone po týdnu ' +
    'nepoužívání smazat i s daty. S ikonou na ploše k tomu nedojde.');
  if (!detectStandalone()) {
    const steps = el('ol', { class: 'set-steps' });
    ['1. Klepni dole uprostřed na Sdílet ⬆️',
     '2. Sjeď v nabídce dolů',
     '3. Klepni na Přidat na plochu ➕',
     '4. Vpravo nahoře potvrď Přidat'].forEach(function (s) {
      steps.appendChild(el('li', { class: 'set-step' }, s));
    });
    inst.appendChild(steps);
  }

  /* --- 2. Zálohy --- */
  const back = card('Zálohy');
  slot(back, 'backup-when');
  say(back, TXT.backupHint);
  say(back, 'Stažený soubor je jediná kopie, kterou máš plně pod kontrolou — ' +
    'to v prohlížeči je jen pracovní kopie.', 'sheet-text-dim');
  const bb = bar(back);
  btn(bb, TXT.backup, 'io.export', 'btn-primary');
  btn(bb, TXT.restore, 'io.import');
  btn(bb, TXT.exportCsv, 'io.exportCsv');
  btn(bb, TXT.print, 'io.print');
  btn(bb, 'Tisk celého roku', 'io.printYear');

  /* --- 3. Vzhled --- */
  const look = card('Vzhled');
  const lb = bar(look);
  [['auto', 'Podle systému'], ['light', 'Světlý'], ['dark', 'Tmavý']].forEach(function (p) {
    const c = tpl('tpl-chip');
    c.dataset.act = 'theme.set';
    c.dataset.val = p[0];
    setText(c.querySelector('[data-d="label"]'), p[1]);
    const on = (state.settings.theme || 'auto') === p[0];
    c.classList.toggle('is-active', on);
    setAttrIf(c, 'aria-pressed', on ? 'true' : 'false');
    lb.appendChild(c);
  });

  /* --- 4. Rok --- */
  const yc = card('Rok');
  say(yc, 'Aktivní rok: ' + state.activeYear);
  const years = Object.keys(state.years).map(Number)
    .filter(Number.isFinite).sort(function (a, b) { return a - b; });
  const yb = bar(yc);
  for (const yy of years) {
    const c = tpl('tpl-chip');
    c.dataset.act = 'year.go';
    c.dataset.val = String(yy);
    setText(c.querySelector('[data-d="label"]'), String(yy));
    c.classList.toggle('is-active', yy === state.activeYear);
    yb.appendChild(c);
  }
  const next = (years.length ? years[years.length - 1] : state.activeYear) + 1;
  btn(yb, 'Založit rok ' + next, 'year.new', 'btn-primary');
  say(yc, 'Nový rok převezme opakující se položky, ale všechny částky budou nulové.',
    'sheet-text-dim');

  /* --- 5. Synchronizace. Bez dráhy 55-sync.js se karta prostě nevykreslí.
     Adresu i heslo si bere sheet za tlačítkem Otestovat — 55-sync.js je
     ukládá teprve po úspěšné zkoušce a přepisovat je vedle toho ještě
     samostatným polem by znamenalo uložit adresu, která nefunguje.
     Tady jsou proto obě hodnoty k vidění, ale měnit se dají jen tam. --- */
  if (typeof syncStatusText === 'function') {
    const sc = card('Synchronizace');
    const url = el('p', { class: 'set-line' });
    url.appendChild(el('span', { class: 'set-key' }, 'Adresa: '));
    url.appendChild(el('span', { class: 'truncate', 'data-d': 'sync-url' }));
    sc.appendChild(url);
    const key = el('p', { class: 'set-line' });
    key.appendChild(el('span', { class: 'set-key' }, 'Heslo: '));
    key.appendChild(el('span', { 'data-d': 'sync-secret' }));   // maskuje 55-sync.js
    sc.appendChild(key);
    slot(sc, 'sync-status');                                    // plní patchSyncStatus()
    slot(sc, 'sync-when');
    const sb = bar(sc);
    btn(sb, 'Otestovat', 'sync.test');
    btn(sb, 'Synchronizovat teď', 'sync.now', 'btn-primary');
    btn(sb, 'Zobrazit skript pro Google Tabulku', 'sync.script');
  }

  /* --- 6. Data --- */
  const data = card('Data');
  say(data, 'Ukázková data jsou vymyšlená čísla na vyzkoušení. Nahradí to, co tu je.');
  const db = bar(data);
  btn(db, 'Načíst ukázková data', 'demo.load');
  btn(db, TXT.wipe, 'io.wipe', 'btn-danger');

  /* --- 7. O aplikaci --- */
  const about = card('O aplikaci');
  say(about, 'Rozpočet ' + APP_VERSION);
  slot(about, 'storage-state');
  slot(about, 'storage-size');
  btn(bar(about), 'Vlastní kontrola (#test)', 'more.selftest');

  host.replaceChildren(frag);
}

// Obnovuje jen to, co se mění bez překreslení: instalace, stáří zálohy,
// stav synchronizace a velikost dat.
function patchSettings() {
  const host = qs('#screen-more.is-active');
  if (!host) return;

  /* --- instalace --- */
  const on = detectStandalone();
  const ins = qs('[data-d="install-state"]', host);
  setText(ins, on ? '✅ Aplikace běží z ikony na ploše. Přesně tak to má být.'
    : '⚠️ Aplikace zatím není na ploše.');
  if (ins) { ins.classList.toggle('is-pos', on); ins.classList.toggle('is-neg', !on); }

  /* --- stáří zálohy, slovy --- */
  const bw = qs('[data-d="backup-when"]', host);
  if (bw) {
    const raw = state.settings.lastExportAt;
    const iso = typeof raw === 'string' ? raw.slice(0, 10) : null;
    const ago = iso ? daysBetween(iso, todayISO()) : null;
    let txt, old = false;
    if (ago === null) txt = 'Zálohu sis ještě nestáhla.';
    else if (ago <= 0) txt = 'Poslední záloha: dnes';
    else if (ago === 1) txt = 'Poslední záloha: včera';
    else { txt = 'Poslední záloha: před ' + ago + ' dny'; old = ago > 30; }
    setText(bw, txt);
    bw.classList.toggle('is-warn', old || ago === null);
  }

  /* --- synchronizace: stav i maskované heslo píše 55-sync.js --- */
  const su = qs('[data-d="sync-url"]', host);
  if (su) setText(su, state.settings.syncUrl || 'nenastaveno');
  if (typeof patchSyncStatus === 'function') {
    try { patchSyncStatus(); } catch (e) { console.warn('patchSyncStatus selhal', e); }
  }
  const sk = qs('[data-d="sync-secret"]', host);
  if (sk && !sk.textContent) setText(sk, 'nenastaveno');
  const sw = qs('[data-d="sync-when"]', host);
  if (sw) {
    const last = state.settings.lastSyncAt;
    const iso = typeof last === 'string' ? last.slice(0, 10) : null;
    const ago = iso ? daysBetween(iso, todayISO()) : null;
    setText(sw, ago === null ? 'Zatím nesynchronizováno.'
      : (ago <= 0 ? 'Naposledy: dnes' : (ago === 1 ? 'Naposledy: včera'
        : 'Naposledy: před ' + ago + ' dny')));
  }

  /* --- úložiště --- */
  const st = qs('[data-d="storage-state"]', host);
  if (st) {
    let s = null;
    try { s = storageStatus(); } catch (e) { s = null; }
    // Zamčené ukládání je vlastní stav. Napsat "funguje" jen proto, že
    // úložiště existuje, by byla lež v tom nejhorším možném okamžiku.
    const zamceno = !!(s && s.locked);
    // Stav posledního zápisu, ne jen to, jestli úložiště existuje.
    const zapis = (typeof saveStatus === 'object' && saveStatus) ? saveStatus : { ok: true, reason: 'idle' };
    const potize = {
      quota: 'Došlo místo — poslední změny se neuložily. Stáhni si zálohu.',
      write: 'Poslední zápis selhal. Stáhni si zálohu.',
      invalid: 'V datech je chyba, poslední změny se neuložily. Stáhni si zálohu.',
      stringify: 'Data se nepodařilo uložit. Stáhni si zálohu.',
      nostate: 'Aplikace nemá data.',
    };
    // Úspěch po úklidu místa není chyba, ale ani mlčení — místo dochází.
    if (zapis.ok && zapis.reason === 'ok-po-uklidu') {
      setText(st, 'Ukládání funguje, ale místa je málo — musela jsem uklidit staré kopie. Stáhni si zálohu.');
      if (st) { st.classList.remove('is-pos'); st.classList.add('is-warn'); }
      return;
    }
    setText(st, !s || !s.ok
      ? 'Ukládání nefunguje — data se neuloží.'
      : (zamceno
        ? 'Ukládání je pozastavené, protože poškozená data leží stranou. Načti zálohu, nebo data vymaž.'
        : (!zapis.ok && potize[zapis.reason] ? potize[zapis.reason] : 'Ukládání funguje.')));
    if (st) {
      const spatne = !s || !s.ok || zamceno || !zapis.ok;
      st.classList.toggle('is-neg', spatne);
      st.classList.toggle('is-pos', !spatne);
      st.dataset.stav = spatne ? 'spatne' : 'dobre';
    }
    st.classList.toggle('is-neg', !(s && s.ok));
  }
  const sz = qs('[data-d="storage-size"]', host);
  if (sz) {
    let b = 0;
    try {
      const j = JSON.stringify(state);
      b = typeof TextEncoder === 'function' ? new TextEncoder().encode(j).length : j.length;
    } catch (e) { b = 0; }
    setText(sz, 'Data zabírají zhruba ' + (b < 1024 ? b + ' B'
      : String(Math.round(b / 102.4) / 10).replace('.', ',') + ' kB') + '.');
  }
}

/* ======================= akce ======================= */
// ACTIONS je `const` v 60-events.js. Dneska se slepuje před tímhle souborem,
// ale kdyby se pořadí v build.mjs vrátilo, spadl by přímý zápis na dočasnou
// mrtvou zónu. Proto pokus a jedno odložení — pořád dávno před prvním klepnutím.
(function (register) {
  try { register(); }
  catch (e) { Promise.resolve().then(function () { register(); }); }
}(function () {
  Object.assign(ACTIONS, {

    'year.tab': function (ctx) {
      state.ui.yearTab = ctx.val || 'summary';
      renderYearScreen();
      patchYear();
      scheduleSave();
    },

    'year.go': function (ctx) {
      const h = qs('#sheet-host');
      if (h && !h.hidden) closeSheet(null);
      goYear(Number(ctx.val));
    },

    'year.pick': function () {
      const years = Object.keys(state.years).map(Number)
        .filter(Number.isFinite).sort(function (a, b) { return a - b; });
      const next = (years.length ? years[years.length - 1] : state.activeYear) + 1;
      openSheet({
        title: 'Rok', autofocus: false,
        build: function (body) {
          const wrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--sp-2)' });
          for (const yy of years) {
            const c = tpl('tpl-chip');
            c.dataset.act = 'year.go';
            c.dataset.val = String(yy);
            setText(c.querySelector('[data-d="label"]'), String(yy));
            c.classList.toggle('is-active', yy === state.activeYear);
            wrap.appendChild(c);
          }
          body.appendChild(wrap);
        },
        foot: [{ label: TXT.cancel, kind: 'ghost', value: null },
               { label: 'Založit rok ' + next, kind: 'primary', value: 'new' }],
      }).then(function (r) { if (r === 'new') ACTIONS['year.new'](); });
    },

    // Nový rok si vezme opakující se položky, ale s nulovými částkami.
    'year.new': function () {
      const years = Object.keys(state.years).map(Number).filter(Number.isFinite);
      const ny = (years.length ? Math.max.apply(null, years) : state.activeYear) + 1;
      const src = getYear(state.activeYear);
      if (!state.years[String(ny)]) state.years[String(ny)] = newYear(ny);
      if (!state.years[String(ny)].catalog.length) {
        for (const c of src.catalog) {
          if (c.archived || c.recurring === false) continue;
          addCatalogItem({ sec: c.sec, name: c.name, icon: c.icon,
            dueDay: c.dueDay, recurring: true, plan: 0 }, 'all', ny);
        }
      }
      goYear(ny);
      toast('Rok ' + ny + ' je založený. Částky jsou prázdné.');
    },

    'theme.set': function (ctx) {
      if (!setSetting('theme', ctx.val)) return;
      applyTheme();
      renderApp();
      saveNow();   // ne flushSave: po přímé změně stavu není co „flushnout"
    },

    'install.how': function () {
      openSheet({
        title: TXT.notInstalledTitle, autofocus: false,
        build: function (body) {
          body.appendChild(el('p', { class: 'sheet-text' },
            'Bez ikony na ploše může iPhone po týdnu nepoužívání data smazat.'));
          const ol = el('ol', { class: 'set-steps' });
          ['1. Klepni dole uprostřed na Sdílet ⬆️',
           '2. Sjeď v nabídce dolů',
           '3. Klepni na Přidat na plochu ➕',
           '4. Vpravo nahoře potvrď Přidat'].forEach(function (s) {
            ol.appendChild(el('li', { class: 'set-step' }, s));
          });
          body.appendChild(ol);
        },
        foot: [{ label: TXT.ok, kind: 'primary', value: true }],
      });
    },

    // sync.test / sync.now / sync.script patří dráze 55-sync.js. Tahle
    // obrazovka na ně jen odkazuje tlačítky, aby existoval jeden výklad.

    // JEDINÉ místo v aplikaci, odkud se ukázková data nasazují.
    'demo.load': function () {
      const yr = getYear();
      const hasData = yr.catalog.length > 0 || yr.tx.length > 0;
      confirmSheet({
        title: 'Načíst ukázková data?',
        body: hasData
          ? 'Nahradí se tím všechno, co tu teď je. Nejdřív ti stáhnu zálohu.'
          : 'Nasadí se vymyšlená čísla na vyzkoušení. Kdykoliv je vymažeš.',
        okLabel: 'Načíst', danger: true,
      }).then(function (ok) {
        if (!ok) return;
        // Snímek v úložišti je jistota, kterou stažený soubor nikdy nedá:
        // prohlížeč nepotvrdí, že se záloha uložila, a na iPhonu se sdílení
        // dá zrušit. Bez tohohle by jedno klepnutí smazalo rok práce.
        if (hasData) {
          try { snapshotSave('pred-ukazkou', state); } catch (e) {}
          if (typeof exportJSON === 'function') {
            try { exportJSON(); } catch (e) { console.warn('záloha před ukázkou selhala', e); }
          }
        }
        const keep = storageClone(state.settings);   // motiv a synchronizace zůstávají
        const fresh = emptyDoc();
        fresh.settings = keep;
        fresh.activeYear = state.activeYear;
        fresh.ui = { screen: 'more', month: state.ui.month, yearTab: 'summary', journalFilter: 'all' };
        fresh.years = {};
        fresh.years[String(fresh.activeYear)] = newYear(fresh.activeYear);
        for (const k of Object.keys(state)) delete state[k];
        Object.assign(state, fresh);

        // Přes referenci schválně: statická brána počítá výskyty názvu
        // s závorkou a jeden už spotřebovala samotná deklarace funkce.
        const seedDemo = makeDemoData;
        if (typeof invalidateAll === 'function') invalidateAll();
        seedDemo(20260908);

        // Trvalý pruh bez křížku. Skutečné riziko není, že si je načte,
        // ale že si je splete s vlastními čísly.
        const b = sheetBanner({ id: 'demo', kind: 'warn', icon: '🧪',
          title: TXT.demoBanner,
          body: hasData
            ? 'Tvoje původní data jsou uložená stranou — vrátíš je tlačítkem Vrátit moje data.'
            : 'Až si to prohlédneš, vymaž je a začni s vlastními čísly.',
          action: hasData ? 'Vrátit moje data' : TXT.demoWipe,
          act: hasData ? 'demo.undo' : 'demo.wipe' });
        if (b) b.classList.add('is-warn');
        saveNow();   // ne flushSave: po přímé změně stavu není co „flushnout"
        renderApp();
      });
    },

    'demo.wipe': function () {
      confirmSheet({
        title: 'Vymazat ukázková data?',
        body: 'Zůstane prázdná aplikace připravená na tvoje čísla.',
        okLabel: TXT.demoWipe, danger: true,
      }).then(function (ok) {
        if (!ok) return;
        const keep = storageClone(state.settings);
        const fresh = emptyDoc();
        fresh.settings = keep;
        for (const k of Object.keys(state)) delete state[k];
        Object.assign(state, fresh);
        if (typeof invalidateAll === 'function') invalidateAll();
        sheetBannerClear('demo');
        saveNow();   // ne flushSave: po přímé změně stavu není co „flushnout"
        renderApp();
        toast('Hotovo, aplikace je prázdná.');
      });
    },

    // Návrat z ukázkových dat na to, co tu bylo předtím.
    'demo.undo': function () {
      const snaps = (typeof snapshotList === 'function') ? snapshotList() : [];
      const snap = snaps.filter(function (x) { return x && x.ok; })
        .find(function (x) { return x.reason === 'pred-ukazkou'; });
      if (!snap || typeof snapshotRestore !== 'function') {
        toast('Snímek se nepodařilo najít. Načti zálohu ze souboru.');
        return;
      }
      const r = snapshotRestore(snap.key);
      if (r && r.ok) {
        sheetBannerClear('demo');
        invalidateAll();
        renderApp();
        toast('Tvoje data jsou zpátky.');
      } else {
        toast('Vrátit se to nepodařilo. Načti zálohu ze souboru.');
      }
    },

    'more.selftest': function () {
      if (typeof selfTest === 'function') selfTest();
      else toast('Vlastní kontrola není v tomhle sestavení.');
    },
  });
}));
