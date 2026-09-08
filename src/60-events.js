// 60-events.js — router, delegované události, pole s částkou, patch smyčka — vlastní: L0
// Šest posluchačů na #app. Žádné onclick, žádné navazování při překreslení.

const ACTIONS = Object.create(null);

/* ---------- router ---------- */

const SCREENS = ['month', 'year', 'journal', 'savings', 'more'];

function goScreen(name) {
  if (SCREENS.indexOf(name) < 0) name = 'month';
  // Jen otevřít appku není změna dat. Bez téhle podmínky se při každém
  // spuštění zapisuje do úložiště, i když uživatelka na nic nesáhla.
  const zmena = state.ui.screen !== name;
  state.ui.screen = name;
  for (const s of SCREENS) {
    const node = qs('#screen-' + s);
    if (!node) continue;
    const on = s === name;
    node.classList.toggle('is-active', on);
    node.hidden = !on;
  }
  for (const t of qsa('#tabbar .tab')) {
    const on = t.dataset.screen === name;
    t.classList.toggle('is-active', on);
    setAttrIf(t, 'aria-current', on ? 'page' : null);
  }
  const fab = qs('#fab');
  if (fab) fab.hidden = !(name === 'month' || name === 'journal');
  renderApp();
  if (zmena) scheduleSave();
}

function goMonth(m) {
  const mm = clamp(Math.round(m), 0, 11);
  if (state.ui.month === mm) return;
  state.ui.month = mm;
  renderApp();
  scheduleSave();
}

function goYear(y) {
  const yy = Math.round(y);
  if (!Number.isFinite(yy) || state.activeYear === yy) return;
  if (!state.years[String(yy)]) state.years[String(yy)] = newYear(yy);
  state.activeYear = yy;
  invalidateAll();
  renderApp();
  scheduleSave();
}

// Strukturální vykreslení. Jediné, co smí vytvářet a rušit uzly.
function renderApp() {
  const y = state.activeYear, m = state.ui.month;
  setText(qs('#hdr-year'), String(y));
  setText(qs('#hdr-month'), monthLabelCs(y, m));
  renderMonthStrip();
  switch (state.ui.screen) {
    case 'year':    renderYearScreen(); break;
    case 'journal': renderJournalScreen(); break;
    case 'savings': renderSavingsScreen(); break;
    case 'more':    renderSettingsScreen(); break;
    default:        renderMonthScreen(); break;
  }
  patchNow();
}

// Dopočty. Zapisuje jen textContent, style.width, classList a aria-*.
// NIKDY nesahá na prvek, ve kterém je kurzor.
function patchNow() {
  try {
    patchMonthStrip();
    patchTabBadges();
    switch (state.ui.screen) {
      case 'year':    patchYear(); break;
      case 'journal': patchJournal(); break;
      case 'savings': patchSavings(); break;
      case 'more':    patchSettings(); break;
      default:        patchMonth(); break;
    }
  } catch (err) {
    console.error('patch selhal', err);
  }
}
const patch = rafOnce(patchNow);

function patchTabBadges() {
  const badge = qs('#hdr-badge');
  if (!badge) return;
  let n = 0;
  try {
    // Stejný zdroj jako panel plateb, jinak zvonek hlásí jiné číslo, než
    // co se pod ním po klepnutí objeví — a svítí i u minulých měsíců.
    if (typeof dueList === 'function') {
      const d = dueList(state.activeYear, state.ui.month, state.settings.dueSoonDays);
      n = d.overdue.length + d.soon.length;
    } else {
      const due = computeDue(state.activeYear, state.ui.month, state.settings.dueSoonDays);
      n = due.overdue.length + due.soon.length;
    }
  } catch (e) { n = 0; }
  setText(badge, String(n));
  badge.hidden = n === 0;
}

/* ---------- pole s částkou ----------
   Smlouva, která chrání kurzor:
     focusin  -> input.value = holé číslo, span se schová (CSS)
     input    -> přečti, zapiš do modelu, přepočítej součty; do pole NESAHEJ
     focusout -> zapiš, přeformátuj pole i span
   Formátovaná podoba žije v sousedním <span class="amt-display">, ne v poli. */

function amtContext(input) {
  const row = input.closest('[data-id]');
  if (!row) return null;
  return { id: row.dataset.id, field: input.dataset.f, row };
}

function writeAmount(ctx, minorOrNull) {
  if (!ctx) return;
  const m = state.ui.month;
  if (ctx.field === 'plan') setPlanned(m, ctx.id, minorOrNull);
  else if (ctx.field === 'act') setActual(m, ctx.id, minorOrNull);
}

function onFocusIn(e) {
  const input = e.target.closest && e.target.closest('input.amt');
  if (!input) return;
  input.classList.remove('is-invalid');
  // Označit obsah, aby se dal rovnou přepsat. Nejdřív hned — Safari na iOS
  // to při klepnutí občas přebije, proto ještě jednou v dalším snímku, ALE
  // jen když se hodnota mezitím nezměnila. Bez té podmínky se označí právě
  // napsaná číslice a další stisk ji přepíše: z „1500" bylo „500".
  const puvodni = input.value;
  if (puvodni) {
    try { input.setSelectionRange(0, puvodni.length); } catch (_) {}
    requestAnimationFrame(function () {
      if (document.activeElement !== input) return;
      if (input.value !== puvodni) return;          // už píše, nesahat
      try { input.setSelectionRange(0, input.value.length); } catch (_) {}
    });
  }
}

function onInput(e) {
  const input = e.target.closest && e.target.closest('input.amt');
  if (!input) return;
  const ctx = amtContext(input);
  if (!ctx) return;
  const r = parseCzkInput(input.value);
  if (r.ok) {
    input.classList.remove('is-invalid');
    writeAmount(ctx, r.minor);
    patch();                       // jen dopočty, pole zůstává jak je
  } else {
    input.classList.add('is-invalid');
  }
}

function onFocusOut(e) {
  const input = e.target.closest && e.target.closest('input.amt');
  if (!input) return;
  const ctx = amtContext(input);
  const r = parseCzkInput(input.value);
  if (r.ok) {
    if (ctx) writeAmount(ctx, r.minor);
    input.value = r.minor === null ? '' : fmtEdit(r.minor);
    input.classList.remove('is-invalid');
    const disp = input.parentNode && input.parentNode.querySelector('.amt-display');
    setText(disp, r.minor === null ? '—' : formatCzk(r.minor));
  } else {
    // Neplatný vstup se NEPŘEVÁDÍ na nulu. Vrátíme poslední platnou hodnotu.
    input.classList.remove('is-invalid');
    const cur = currentAmountOf(ctx);
    input.value = cur === null ? '' : fmtEdit(cur);
    toast('Tohle číslo se nepodařilo přečíst, zůstala původní hodnota.');
  }
  flushSave();
  patch();
}

function currentAmountOf(ctx) {
  if (!ctx) return null;
  try {
    const en = getEntry(state.ui.month, ctx.id);
    if (!en) return null;
    return ctx.field === 'plan' ? (en.plan === undefined ? null : en.plan) : en.act;
  } catch (e) { return null; }
}

function onKeyDown(e) {
  if (e.key === 'Escape') { if (closeSheet) closeSheet(null); return; }
  const input = e.target.closest && e.target.closest('input.amt');
  if (!input) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    const inputs = qsa('input.amt', qs('#main'));
    const i = inputs.indexOf(input);
    input.blur();
    if (i >= 0 && i + 1 < inputs.length) inputs[i + 1].focus({ preventScroll: false });
  }
}

/* ---------- kliknutí ---------- */

function onClick(e) {
  const node = e.target.closest && e.target.closest('[data-act]');
  if (!node) return;
  const act = node.dataset.act;
  const fn = ACTIONS[act];
  if (!fn) return;
  const ctx = {
    node,
    id: node.dataset.id || (node.closest('[data-id]') ? node.closest('[data-id]').dataset.id : null),
    m: node.dataset.m !== undefined ? Number(node.dataset.m) : null,
    sec: node.dataset.sec || (node.closest('[data-sec]') ? node.closest('[data-sec]').dataset.sec : null),
    val: node.dataset.val !== undefined ? node.dataset.val : null,
    screen: node.dataset.screen || null,
  };
  fn(ctx, e);
}

function onChange(e) {
  const node = e.target.closest && e.target.closest('[data-change]');
  if (!node) return;
  const fn = ACTIONS[node.dataset.change];
  if (fn) fn({ node, value: node.value, checked: node.checked }, e);
}

/* ---------- gesta ---------- */

function bindSwipe(el, onPrev, onNext) {
  let x0 = 0, y0 = 0, dx = 0, locked = null, pid = null;
  el.addEventListener('pointerdown', function (e) {
    if (e.target.closest('input, textarea, .sheet, .month-strip')) return;
    pid = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = 0; locked = null;
  }, { passive: true });
  el.addEventListener('pointermove', function (e) {
    if (e.pointerId !== pid) return;
    dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (locked === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      locked = Math.abs(dx) > Math.abs(dy) * 1.7 ? 'x' : 'y';
    }
  }, { passive: true });
  const end = function (e) {
    if (e.pointerId !== pid) return;
    pid = null;
    if (locked === 'x' && Math.abs(dx) > 60) { (dx > 0 ? onPrev : onNext)(); }
    dx = 0; locked = null;
  };
  el.addEventListener('pointerup', end, { passive: true });
  el.addEventListener('pointercancel', function () { pid = null; dx = 0; locked = null; }, { passive: true });
}

/* ---------- navázání ---------- */

function bindGlobalEvents() {
  const app = qs('#app');
  app.addEventListener('click', onClick);
  app.addEventListener('input', onInput);
  app.addEventListener('change', onChange);
  app.addEventListener('focusin', onFocusIn);
  app.addEventListener('focusout', onFocusOut);
  app.addEventListener('keydown', onKeyDown);

  const main = qs('#main');
  if (main) bindSwipe(main, function () { goMonth(state.ui.month - 1); },
                            function () { goMonth(state.ui.month + 1); });

  // Tvrdý zápis. Tohle jsou tři události, které na iOS opravdu padnou,
  // když appka jde do pozadí. beforeunload se na iOS spolehnout nedá.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushSave();
  });
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('blur', flushSave);
  window.addEventListener('hashchange', function () {
    if (location.hash === '#test' && typeof selfTest === 'function') selfTest();
  });
}

/* ---------- základní akce ---------- */

Object.assign(ACTIONS, {
  'nav': function (ctx) { goScreen(ctx.screen); },
  'month.go': function (ctx) { if (ctx.m !== null) { goMonth(ctx.m); goScreen(state.ui.screen === 'year' ? 'month' : state.ui.screen); } },
  'month.prev': function () { goMonth(state.ui.month - 1); },
  'month.next': function () { goMonth(state.ui.month + 1); },
  'undo': function () { undoLast(); renderApp(); },

  // Velký název měsíce v hlavičce otevře mřížku 3×4 se zůstatkem u každého
  // měsíce. Bez téhle akce bylo tlačítko mrtvé.
  'month.pick': function () {
    const y = state.activeYear;
    openSheet({
      title: 'Vyber měsíc',
      autofocus: false,
      build: function (body) {
        const grid = el('div', { class: 'month-grid' });
        for (let m = 0; m < 12; m++) {
          const b = el('button', { class: 'month-cell', 'data-act': 'month.goto', 'data-m': String(m) });
          if (m === state.ui.month) b.classList.add('is-active');
          b.appendChild(el('span', { class: 'month-cell-name' }, MONTHS_NOM[m]));
          let bal = null;
          try { bal = computeMonth(y, m).balance; } catch (e) { bal = null; }
          const v = el('span', { class: 'month-cell-val' }, bal === null ? '' : formatSigned(bal));
          if (Number.isSafeInteger(bal)) v.classList.add(bal >= 0 ? 'is-pos' : 'is-neg');
          b.appendChild(v);
          grid.appendChild(b);
        }
        body.appendChild(grid);
      },
      foot: [{ label: TXT.cancel, kind: 'ghost', value: null }],
    });
  },

  'month.goto': function (ctx) {
    if (ctx.m === null || !Number.isFinite(ctx.m)) return;
    goMonth(ctx.m);
    closeSheet(ctx.m);
    if (state.ui.screen !== 'month' && state.ui.screen !== 'journal') goScreen('month');
  },

  'sheet.close': function () { closeSheet(null); },
  'banner.dismiss': function (ctx) { const b = ctx.node.closest('.banner'); if (b) b.remove(); },
  'toast.action': function (ctx) {
    const t = ctx.node.closest('.toast');
    if (t && t._onAction) t._onAction();
    if (t) t.remove();
  },
});

/* ---------- pruh měsíců ---------- */

function renderMonthStrip() {
  const host = qs('#month-strip');
  if (!host) return;
  const frag = document.createDocumentFragment();
  for (let m = 0; m < 12; m++) {
    const chip = tpl('tpl-month-chip');
    chip.dataset.m = String(m);
    setText(chip.querySelector('[data-d="label"]'), MONTHS_SHORT[m]);
    frag.appendChild(chip);
  }
  host.replaceChildren(frag);
}

function patchMonthStrip() {
  const host = qs('#month-strip');
  if (!host) return;
  const y = state.activeYear;
  for (const chip of qsa('.chip-month', host)) {
    const m = Number(chip.dataset.m);
    const on = m === state.ui.month;
    chip.classList.toggle('is-active', on);
    setAttrIf(chip, 'aria-current', on ? 'true' : null);
    let bal = 0;
    try { bal = computeMonth(y, m).balance; } catch (e) { bal = 0; }
    const bar = chip.querySelector('[data-d="bar"]');
    if (bar) {
      bar.classList.toggle('is-pos', bal > 0);
      bar.classList.toggle('is-neg', bal < 0);
      bar.classList.toggle('is-zero', bal === 0);
    }
    if (on) {
      try { chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) {}
    }
  }
}
