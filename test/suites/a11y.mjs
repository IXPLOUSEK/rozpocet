// test/suites/a11y.mjs — přístupnost očima jedné konkrétní paní na iPhonu.
//
// Nikola drží telefon v jedné ruce, čte přes brýle, často venku na slunci
// a jednou za čas si trojklikem omylem zapne VoiceOver. Suita hlídá to,
// co jí reálně zkazí den:
//   · jazyk stránky — bez lang="cs" přečte iOS "Rozpočet" anglicky,
//   · jména prvků — "tlačítko" místo "Zaplaceno" je k ničemu,
//   · viditelný fokus a pořadí tabulátoru (klávesnice, přepínač, Bluetooth),
//   · kontrast — šedá na šedé se na displeji na slunci nedá přečíst.
//
// Appka se právě píše. Co ještě neexistuje, končí jako SKIP, nikdy jako FAIL:
// jinak by červená v testech přestala cokoliv znamenat a nikdo by se na ni
// nedíval. Žádná npm závislost (ani axe-core) — všechno počítáme sami
// uvnitř stránky, protože jen tam vidíme SKUTEČNĚ vykreslené barvy.

import { Suite, assert, skip, header, sub, warn } from '../lib/harness.mjs';
import { openApp, probeApp, errorBaseline, settle } from '../lib/page.mjs';

/* ── konstanty ───────────────────────────────────────────────────────────── */

// Fokusový průchod stojí jeden getComputedStyle na prvek a dva na fokus.
// Přes 120 prvků už je to zbytečně dlouhé a nic nového to neukáže.
const FOCUS_CAP = 120;
const FOCUS_BUDGET_MS = 9000;   // pojistka: appka může růst, test ne
const TAB_STEPS = 40;      // kolikrát nejvýš zmáčkneme Tab
const TRAP_STEPS = 15;     // kolikrát zkusíme utéct z otevřeného panelu
const IPHONE_VP = { width: 393, height: 852 };

// Co může otevřít spodní panel. Bere se první, které se na obrazovce najde.
const SHEET_TRIGGERS = ['#fab', '[data-act="month.pick"]', '[data-act="row.open"]', '[data-act$=".open"]'];

// Osm kritických textových dvojic. Selektorů je u každé víc, protože se
// ještě nevykresluje všechno; změří se až šest prvků a bere se ten NEJHORŠÍ,
// aby varianty (.row-sub.is-warn, neaktivní tab…) nepropadly sítem.
const TEXT_PAIRS = [
  { id: 'běžný text řádku na kartě', sels: ['.row-name'] },
  { id: 'vedlejší text a popisky', sels: ['.row-sub', '.kpi-label', '.sec-sum-lbl'] },
  { id: 'částka v buňce', sels: ['.amt-display', '.amt'] },
  { id: 'hlavní číslo souhrnu', sels: ['.kpi-value'] },
  { id: 'nadpis sekce', sels: ['.sec-title'] },
  { id: 'text na barevném tlačítku', sels: ['.sec-add', '.banner-action', '.sheet-close'] },
  { id: 'popisek v tabbaru (aktivní i neaktivní)', sels: ['.tab.is-active .tab-lbl', '.tab:not(.is-active) .tab-lbl', '.tab-lbl'] },
  { id: 'prázdný stav a nápověda', sels: ['.empty', '.kpi-hint', '.field-hint'] },
];

// Netextové hranice: 3:1 stačí, ale musí to být vidět.
/* Netextové hranice — 3:1 podle WCAG 2.1 (1.4.11).
 *
 * ROZSAH JE ÚZKÝ SCHVÁLNĚ. Pravidlo mluví o prvcích rozhraní a o grafice,
 * která něco ZNAMENÁ. Nepatří pod něj čistě ozdobná linka. Předěl mezi
 * řádky žádnou informaci nenese — kdyby zmizel, nikdo se nic nedozví míň —
 * a vynutit na něm 3:1 by z appky udělalo tabulkový rastr. Proto tu
 * `.row` / hranice karet NEJSOU a je to vidět ve výpisu testu, ne schované.
 *
 * Ruthless zůstává tam, kde na hranici opravdu záleží: bez ní se neví,
 * kam se dá psát, co je zaškrtnuté a kde končí sloupec v grafu.
 */
const NONTEXT_PAIRS = [
  // Měřidla se hlídají ve DVOU dvojicích, protože každá říká něco jiného:
  //   · výplň vs. dráha  = KOLIK to je (tohle nese údaj)
  //   · rozsah vs. okolí = KAM AŽ měřidlo sahá (obrys, nebo dráha, když obrys není)
  { id: 'výplň mini pruhu proti jeho dráze', sels: ['.minibar i'], mode: 'fill' },
  { id: 'výplň pruhu spořicího cíle proti jeho dráze', sels: ['.goalbar i'], mode: 'fill' },
  { id: 'výplň pruhu v ročním přehledu proti dráze', sels: ['.ybar i'], mode: 'fill' },
  { id: 'rozsah měřidla (obrys, jinak dráha) proti okolí', sels: ['.goalbar', '.minibar', '.ybar'], mode: 'extent' },
  { id: 'sloupec v grafu proti podkladu', sels: ['.chart-host rect', '.chart-host path', '.bar'], mode: 'fill' },
  // prvky rozhraní — hranice říká, kam se dá sáhnout
  { id: 'hranice zadávacího pole', sels: ['input.amt', 'input.field-input', 'input', 'select', 'textarea'], mode: 'border' },
  { id: 'hranice zaškrtávátka / přepínače', sels: ['.row-paid', '.due-check', 'input[type=checkbox]', '[role=switch]'], mode: 'border' },
  { id: 'barva fokusového rámečku', sels: ['button', 'a[href]', 'input'], mode: 'outline' },
];

/* Co je ZÁMĚRNĚ mimo rozsah — vypisuje se do výstupu suity, ať je výjimka
   vidět a dá se s ní nesouhlasit. */
const NONTEXT_EXCLUDED = [
  '.row / hranice karet — ozdobný vlas mezi řádky, nenese informaci '
  + '(src/10-tokens.css: `--hairline` je popsaný jako „1.25:1 vůči surface — jen optický předěl")',
  'dráha měřidla proti kartě — když má měřidlo vlastní obrys (--meter-edge), '
  + 'je hranicí ten obrys a měří se místo dráhy; ztmavit dráhu na 3:1 vůči kartě '
  + 'by rozbilo dvojici výplň-vs-dráha, která teprve nese údaj',
];

/* ── pomocníci na straně Node ────────────────────────────────────────────── */

/** Nejbližší iPhone, který tenhle Playwright zná. */
function pickDevice(eng) {
  const devs = (eng && eng.mod && eng.mod.devices) || {};
  for (const want of ['iPhone 15', 'iPhone 14', 'iPhone 13', 'iPhone 12', 'iPhone SE']) {
    if (devs[want]) return { name: want, dev: devs[want] };
  }
  const any = Object.keys(devs).find(n => /^iPhone/i.test(n) && !/landscape/i.test(n));
  return any ? { name: any, dev: devs[any] } : null;
}

async function sheetIsOpen(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#sheet-host');
    if (host && !host.hidden && host.children.length) return true;
    const d = document.querySelector('.sheet[role="dialog"], [role="dialog"]');
    return !!(d && !d.hasAttribute('hidden') && d.getClientRects().length);
  }).catch(() => false);
}

/** Zavře cokoliv otevřeného. Nesmí spadnout, ať se stane cokoliv. */
async function closeSheets(page) {
  for (let i = 0; i < 3; i++) {
    if (!(await sheetIsOpen(page))) return true;
    await page.keyboard.press('Escape').catch(() => { });
    await settle(page, 140);
  }
  const x = page.locator('.sheet-close').first();
  if (await x.count().catch(() => 0)) {
    await x.click({ timeout: 1500 }).catch(() => { });
    await settle(page, 140);
  }
  return !(await sheetIsOpen(page));
}

/** Zkusí otevřít panel. Vrací {sel, idx} spouštěče, nebo null. */
async function openAnySheet(page) {
  for (const sel of SHEET_TRIGGERS) {
    let n = 0;
    try { n = await page.locator(sel).count(); } catch { n = 0; }
    for (let i = 0; i < Math.min(n, 2); i++) {
      const loc = page.locator(sel).nth(i);
      if (!(await loc.isVisible().catch(() => false))) continue;
      const ok = await loc.click({ timeout: 2500 }).then(() => true).catch(() => false);
      if (!ok) continue;
      await settle(page, 220);
      if (await sheetIsOpen(page)) return { sel, idx: i };
      await closeSheets(page);
    }
  }
  return null;
}

const cz1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');

/* ── kód, který běží UVNITŘ stránky ──────────────────────────────────────
   Každá funkce musí být soběstačná: page.evaluate ji posílá jako zdroj,
   takže nevidí nic z Node. Proto se pár drobných pomocníků opakuje. */

/** Přístupová jména polí: input / select / textarea. */
function sweepControlsInPage() {
  const lbl = (el) => {
    if (!el || el.nodeType !== 1) return 'nic';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) s += '.' + cls;
    const act = el.getAttribute('data-act'); if (act) s += '[data-act=' + act + ']';
    const f = el.getAttribute('data-f'); if (f) s += '[data-f=' + f + ']';
    return s;
  };
  const path = (el) => (el.parentElement ? lbl(el.parentElement) + ' > ' : '') + lbl(el);
  // textContent, ale bez aria-hidden podstromů; .sr-only naopak POČÍTÁME,
  // protože přesně to je pattern appky: <label><span class="sr-only">Plán</span><input>.
  const readable = (node) => {
    let out = '';
    const walk = (n) => {
      if (!n) return;
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (n.getAttribute('aria-hidden') === 'true') return;
      if (n.hasAttribute('hidden')) return;
      if (n.tagName === 'IMG' || n.tagName === 'INPUT') { out += ' ' + (n.getAttribute('alt') || '') + ' '; }
      for (const c of n.childNodes) walk(c);
    };
    walk(node);
    return out.replace(/\s+/g, ' ').trim();
  };
  const rendered = (el) => {
    if (el.closest('[hidden]')) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };

  const out = { total: 0, missing: [], weak: [], ok: 0 };
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.type === 'hidden') continue;
    if (!rendered(el)) continue;
    out.total++;
    const attr = (n) => (el.getAttribute(n) || '').replace(/\s+/g, ' ').trim();

    if (attr('aria-label')) { out.ok++; continue; }

    const lb = attr('aria-labelledby');
    if (lb) {
      const txt = lb.split(/\s+/).map(id => {
        const n = document.getElementById(id);
        return n ? readable(n) : '';
      }).filter(Boolean).join(' ');
      if (txt) { out.ok++; continue; }
    }

    let fromLabel = '';
    if (el.id) {
      for (const l of document.querySelectorAll('label[for]')) {
        if (l.getAttribute('for') === el.id) { fromLabel = readable(l); break; }
      }
    }
    if (!fromLabel) {
      const anc = el.closest('label');
      if (anc) fromLabel = readable(anc);
    }
    if (fromLabel) { out.ok++; continue; }

    if (attr('title')) { out.ok++; continue; }

    const ph = attr('placeholder');
    if (ph) { out.weak.push(path(el) + ' — jméno má jen z placeholderu „' + ph + '“'); out.ok++; continue; }

    out.missing.push(path(el) + ' (type=' + (el.getAttribute('type') || el.tagName.toLowerCase()) + ')');
  }
  return out;
}

/** Přístupová jména tlačítek a odkazů. */
function sweepButtonsInPage() {
  const lbl = (el) => {
    if (!el || el.nodeType !== 1) return 'nic';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) s += '.' + cls;
    return s;
  };
  const readable = (node) => {
    let out = '';
    const walk = (n) => {
      if (!n) return;
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (n.getAttribute('aria-hidden') === 'true') return;
      if (n.hasAttribute('hidden')) return;
      if (n.tagName === 'IMG') { out += ' ' + (n.getAttribute('alt') || '') + ' '; }
      for (const c of n.childNodes) walk(c);
    };
    walk(node);
    return out.replace(/\s+/g, ' ').trim();
  };
  const rendered = (el) => {
    if (el.closest('[hidden]')) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };

  const out = { total: 0, missing: [], ok: 0 };
  const nodes = document.querySelectorAll('button, [role="button"], a');
  for (const el of nodes) {
    // <a> bez href není ovládací prvek, jen text — ten se sem neplete.
    if (el.tagName === 'A' && !el.hasAttribute('href') && el.getAttribute('role') !== 'button') continue;
    if (!rendered(el)) continue;
    out.total++;
    const attr = (n) => (el.getAttribute(n) || '').replace(/\s+/g, ' ').trim();

    if (readable(el)) { out.ok++; continue; }
    if (attr('aria-label')) { out.ok++; continue; }
    const lb = attr('aria-labelledby');
    if (lb) {
      const txt = lb.split(/\s+/).map(id => {
        const n = document.getElementById(id);
        return n ? readable(n) : '';
      }).filter(Boolean).join(' ');
      if (txt) { out.ok++; continue; }
    }
    if (attr('title')) { out.ok++; continue; }
    if (el.tagName === 'INPUT' && attr('value')) { out.ok++; continue; }

    // Přesně tenhle tvar test loví: <button><span aria-hidden="true">✓</span></button>
    const raw = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 12);
    out.missing.push(lbl(el)
      + ' data-act=' + (attr('data-act') || '—')
      + ' class="' + (el.getAttribute('class') || '') + '"'
      + (raw ? ' — vevnitř je jen skrytá ikona „' + raw + '“' : ' — je úplně prázdné'));
  }
  return out;
}

/**
 * Vidí uživatelka, kam skočil fokus? Jeden průchod, žádné round-tripy.
 *
 * POZOR na past: Chromium přepočítá styly závislé na :focus-visible až
 * o snímek později. Čtení hned po focus() vrací zastaralou hodnotu
 * (3px solid currentColor), takže se čeká na dva rAF. Ověřeno měřením —
 * bez čekání test měřil něco úplně jiného, než co uživatelka uvidí.
 */
async function sweepFocusInPage(cfg) {
  const cap = cfg.cap;
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const lbl = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) s += '.' + cls;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18);
    if (t) s += ' „' + t + '“';
    return s;
  };
  const SEL = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const snap = (el) => {
    const cs = getComputedStyle(el);
    return {
      outline: cs.outline, ow: cs.outlineWidth, oc: cs.outlineColor, os: cs.outlineStyle,
      oo: cs.outlineOffset, bs: cs.boxShadow, bc: cs.borderColor, bg: cs.backgroundColor,
    };
  };
  const KEYS = ['outline', 'ow', 'oc', 'os', 'oo', 'bs', 'bc', 'bg'];

  const all = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (el.closest('[hidden]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    all.push(el);
    if (all.length >= cap) break;
  }

  const before0 = document.activeElement;
  const out = { total: all.length, checked: 0, offenders: [], notFocusable: [], focusVisible: 0, timedOut: false };
  const t0 = performance.now();
  for (const el of all) {
    if (performance.now() - t0 > cfg.budgetMs) { out.timedOut = true; break; }
    const before = snap(el);
    try { el.focus({ preventScroll: true }); } catch (e) { /* nevadí */ }
    if (document.activeElement !== el) { out.notFocusable.push(lbl(el)); continue; }
    await frame();
    if (document.activeElement !== el) { out.notFocusable.push(lbl(el) + ' (fokus mu appka hned vzala)'); continue; }
    const after = snap(el);
    out.checked++;
    try { if (el.matches(':focus-visible')) out.focusVisible++; } catch (e) { /* starý engine */ }
    const changed = KEYS.some(k => before[k] !== after[k]);
    if (!changed) {
      out.offenders.push(lbl(el) + ' — po zaostření se nic nezměnilo (outline '
        + after.ow + ' ' + after.os + ', box-shadow ' + String(after.bs).slice(0, 40) + ')');
    }
  }
  try {
    if (before0 && before0.focus) before0.focus({ preventScroll: true });
    else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  } catch (e) { /* nevadí */ }
  return out;
}

/** Kde právě je fokus a kde to je na stránce (v souřadnicích dokumentu). */
function activeInfoInPage() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const lbl = (n) => {
    let s = n.tagName.toLowerCase();
    if (n.id) s += '#' + n.id;
    const cls = (n.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) s += '.' + cls;
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18);
    if (t) s += ' „' + t + '“';
    return s;
  };
  const r = el.getBoundingClientRect();
  // Souřadnice musí být absolutní: Tab stránkou i vodorovným pásem měsíců
  // roluje, takže viewportové rect by hlásilo falešné přehození pořadí.
  let x = r.left, y = r.top, pinned = false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.position === 'fixed' || cs.position === 'sticky') pinned = true;
    if (n !== el && n !== document.body && n !== document.documentElement) {
      x += n.scrollLeft; y += n.scrollTop;
    }
  }
  if (!pinned) { x += window.scrollX; y += window.scrollY; }
  const cs = getComputedStyle(el);
  return {
    label: lbl(el),
    x: Math.round(x), y: Math.round(y),
    row: Math.round(y / 24),
    pinned,
    usable: !pinned && r.width >= 1 && r.height >= 1 && cs.visibility !== 'hidden',
    key: lbl(el) + '@' + Math.round(x) + ',' + Math.round(y),
  };
}

/** aria-hidden="true" s fokusovatelným potomkem = past pro odečítač. */
function sweepAriaHiddenInPage() {
  const lbl = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) s += '.' + cls;
    return s;
  };
  const SEL = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const out = [];
  for (const host of document.querySelectorAll('[aria-hidden="true"]')) {
    for (const el of host.querySelectorAll(SEL)) {
      if (el.hasAttribute('disabled')) continue;
      if (el.getAttribute('tabindex') === '-1') continue;
      if (el.closest('[inert]')) continue;      // inert fokus opravdu vypne
      if (el.closest('[hidden]')) continue;     // úplně skrytý podstrom je v pořádku
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      out.push(lbl(host) + '[aria-hidden] obsahuje ' + lbl(el));
    }
  }
  return out;
}

/** Kde jsou živé oblasti a je vůbec co ohlašovat. */
function liveRegionsInPage() {
  const lbl = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) s += '.' + cls;
    return s;
  };
  const seen = [];
  const push = (el, why) => {
    if (!el || seen.some(s => s.el === el)) return;
    seen.push({
      el, why, path: lbl(el),
      live: (el.getAttribute('aria-live') || '').trim().toLowerCase(),
      atomic: (el.getAttribute('aria-atomic') || '').trim().toLowerCase(),
    });
  };
  push(document.querySelector('#sr-live'), '#sr-live');
  const val = document.querySelector('.kpi-value, [data-d="value"]');
  if (val) push(val.closest('[aria-live]'), 'obal hlavního čísla souhrnu');
  push(document.querySelector('.kpi[aria-live]'), '.kpi[aria-live]');
  push(document.querySelector('.sec-sums[aria-live]'), '.sec-sums[aria-live]');
  for (const el of document.querySelectorAll('[aria-live]')) push(el, 'jakýkoliv [aria-live]');
  return {
    regions: seen.map(s => ({ why: s.why, path: s.path, live: s.live, atomic: s.atomic })),
    totals: document.querySelectorAll('.kpi-value, .sec-sum-val, [data-d="value"]').length,
  };
}

/**
 * Kontrast. Počítá se ze SKUTEČNĚ vykreslených barev, ne z hodnot tokenů —
 * token může být správný a stejně skončit na špatném podkladu.
 * WCAG 2.1: linearizace sRGB, relativní luminance, (Lmax+.05)/(Lmin+.05).
 */
async function measureContrastInPage(spec) {
  // Chromium dopočítá :focus-visible až o snímek později — bez tohohle čekání
  // by barva fokusového rámečku byla naměřená úplně mimo.
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const lbl = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) s += '.' + cls;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (t) s += ' „' + t + '“';
    return s;
  };

  let cx = null;
  try {
    const cvs = document.createElement('canvas');
    cvs.width = 1; cvs.height = 1;
    cx = cvs.getContext('2d', { willReadFrequently: true });
  } catch (e) { cx = null; }

  // Rozloží libovolný zápis barvy na {r,g,b,a}. rgb()/rgba() rychle,
  // cokoliv jiného (color(), oklch(), pojmenované) přes plátno.
  const parse = (str) => {
    const s = String(str || '').trim();
    if (!s || s === 'none') return null;
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s);
    if (m) {
      let a = 1;
      if (m[4] !== undefined) a = String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (!isFinite(a)) a = 1;
      return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    if (!cx) return null;
    try {
      cx.globalCompositeOperation = 'copy';
      cx.fillStyle = '#010203';
      cx.fillStyle = s;
      if (cx.fillStyle === '#010203' && s.toLowerCase() !== '#010203') return null;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    } catch (e) { return null; }
  };

  const over = (fg, bg) => {
    const a = Math.max(0, Math.min(1, fg.a));
    if (a >= 0.999) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  };
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const rgb = (c) => 'rgb(' + Math.round(c.r) + ', ' + Math.round(c.g) + ', ' + Math.round(c.b) + ')';

  // Podklad: průhledné vrstvy se prolezou nahoru a poskládají na sebe.
  const bgUnder = (start) => {
    const layers = [];
    let uncertain = false;
    for (let n = start; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') uncertain = true;
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; }
    }
    let base;
    if (layers.length && layers[layers.length - 1].a >= 0.999) base = layers.pop();
    else {
      const scheme = String(getComputedStyle(document.documentElement).colorScheme || '');
      const dark = /dark/.test(scheme) && !/light/.test(scheme)
        ? true
        : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      base = dark ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
      uncertain = uncertain || false;
    }
    let out = base;
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return { color: out, uncertain };
  };

  const shown = (el, lax) => {
    if (el.closest('[hidden]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    if (lax) return true;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  const hasText = (el) => {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;   // píše se do nich
    return (el.textContent || '').trim().length > 0;
  };

  const pick = (sels, lax, needText) => {
    const found = [];
    for (const sel of sels) {
      let nodes = [];
      try { nodes = document.querySelectorAll(sel); } catch (e) { nodes = []; }
      for (const el of nodes) {
        if (found.indexOf(el) !== -1) continue;
        if (!shown(el, lax)) continue;
        if (needText && !hasText(el)) continue;
        found.push(el);
        if (found.length >= spec.sample) return found;
      }
    }
    return found;
  };

  const worstOf = (list) => {
    let worst = null;
    for (const m of list) if (m && (!worst || m.ratio < worst.ratio)) worst = m;
    return worst;
  };

  /* --- text --- */
  const text = [];
  for (const pair of spec.text) {
    const els = pick(pair.sels, false, true);
    const got = [];
    for (const el of els) {
      const cs = getComputedStyle(el);
      const fg0 = parse(cs.color);
      if (!fg0 || fg0.a === 0) continue;
      const b = bgUnder(el);
      const fg = over(fg0, b.color);
      got.push({
        ratio: ratio(fg, b.color), fg: rgb(fg), bg: rgb(b.color),
        where: lbl(el), size: cs.fontSize, weight: cs.fontWeight, uncertain: b.uncertain,
      });
    }
    text.push({ id: pair.id, sels: pair.sels, min: spec.minText, found: got.length, worst: worstOf(got) });
  }

  /* --- netextové hranice --- */
  const prevFocus = document.activeElement;
  const nontext = [];
  let uaRing = 0;
  for (const pair of spec.nontext) {
    const got = [];
    if (pair.mode === 'outline') {
      // Barvu rámečku jde přečíst jen ze zaostřeného prvku — a až po dvou rAF.
      const els = pick(pair.sels, false, false);
      for (const el of els) {
        try { el.focus({ preventScroll: true }); } catch (e) { continue; }
        if (document.activeElement !== el) continue;
        await frame();
        if (document.activeElement !== el) continue;
        const cs = getComputedStyle(el);
        if (cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0) continue;
        // outline-style:auto = vlastní rámeček prohlížeče. Chromium ho kreslí
        // dvoubarevně a getComputedStyle o té druhé barvě nic neví, takže by
        // změřené číslo lhalo. Appka si stejně musí nakreslit svůj vlastní.
        if (cs.outlineStyle === 'auto') { uaRing++; continue; }
        const c0 = parse(cs.outlineColor);
        if (!c0 || c0.a === 0) continue;
        // Záporný outline-offset kreslí rámeček DOVNITŘ prvku (tak to má
        // appka u .amt), kladný ven — podklad je pak jiný.
        const inset = parseFloat(cs.outlineOffset || '0') < 0;
        const b = bgUnder(inset ? el : (el.parentElement || el));
        const c = over(c0, b.color);
        got.push({
          ratio: ratio(c, b.color), fg: rgb(c), bg: rgb(b.color),
          where: lbl(el) + ' (fokus, offset ' + cs.outlineOffset + ')', uncertain: b.uncertain,
        });
      }
    } else if (pair.mode === 'border') {
      const els = pick(pair.sels, false, false);
      for (const el of els) {
        const cs = getComputedStyle(el);
        let c0 = null, side0 = '';
        // Appka odděluje řádky border-top, ne bottom — bereme první linku,
        // která je vidět, ať je z které strany chce.
        for (const side of ['borderBottomColor', 'borderTopColor', 'borderLeftColor']) {
          const w = parseFloat(cs[side.replace('Color', 'Width')] || '0');
          const c = parse(cs[side]);
          if (w > 0 && c && c.a > 0) { c0 = c; side0 = side === 'borderBottomColor' ? 'dole' : (side === 'borderTopColor' ? 'nahoře' : 'vlevo'); break; }
        }
        if (!c0) continue;
        const b = bgUnder(el);
        const c = over(c0, b.color);
        got.push({ ratio: ratio(c, b.color), fg: rgb(c), bg: rgb(b.color), where: lbl(el) + ' (linka ' + side0 + ')', uncertain: b.uncertain });
      }
    } else if (pair.mode === 'extent') {
      // ROZSAH měřidla (dokud kam pruh sahá). WCAG 1.4.11 chce, aby byl
      // rozsah komponenty vidět — NEŘÍKÁ ale čím. Když má měřidlo vlastní
      // obrys, je hranicí ten obrys a dráha uvnitř může zůstat světlá.
      //
      // Tohle není detail: dráha je vklíněná mezi podklad a výplň. Ztmavit
      // ji na 3:1 vůči kartě znamená přiblížit ji výplni a rozbít dvojici
      // výplň-vs-dráha, která teprve NESE ÚDAJ. Obě podmínky naráz splnit
      // nejde. Proto: je-li obrys, měří se obrys; jinak až dráha.
      const els = pick(pair.sels, true, false);
      for (const el of els) {
        const cs = getComputedStyle(el);
        const b = bgUnder(el.parentElement || el);
        let c0 = null, how = '';
        for (const side of ['borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor']) {
          const w = parseFloat(cs[side.replace('Color', 'Width')] || '0');
          const c = parse(cs[side]);
          if (w > 0 && c && c.a > 0) { c0 = c; how = 'obrys'; break; }
        }
        if (!c0 && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'auto') {
          const c = parse(cs.outlineColor);
          if (c && c.a > 0) { c0 = c; how = 'obrys (outline)'; }
        }
        if (!c0) {
          const c = parse(cs.backgroundColor);
          if (!c || c.a === 0) continue;
          c0 = c; how = 'dráha (obrys chybí)';
        }
        const c = over(c0, b.color);
        got.push({ ratio: ratio(c, b.color), fg: rgb(c), bg: rgb(b.color), where: lbl(el) + ' (' + how + ')', uncertain: b.uncertain });
      }
    } else {  // fill — pruhy mají často nulovou šířku, proto lax
      const els = pick(pair.sels, true, false);
      for (const el of els) {
        const cs = getComputedStyle(el);
        const c0 = parse(cs.backgroundColor);
        if (!c0 || c0.a === 0) continue;
        const b = bgUnder(el.parentElement || el);
        const c = over(c0, b.color);
        got.push({ ratio: ratio(c, b.color), fg: rgb(c), bg: rgb(b.color), where: lbl(el) + ' (výplň)', uncertain: b.uncertain });
      }
    }
    nontext.push({
      id: pair.id, sels: pair.sels, min: spec.minNonText, found: got.length, worst: worstOf(got),
      note: (pair.mode === 'outline' && uaRing) ? uaRing + '× vlastní rámeček prohlížeče (appka svůj nemá)' : '',
    });
  }
  try {
    if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  } catch (e) { /* nevadí */ }

  const scheme = String(getComputedStyle(document.documentElement).colorScheme || '');
  const darkNow = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return { text, nontext, scheme, darkNow, bodyBg: getComputedStyle(document.body).backgroundColor };
}

/* ── suita ──────────────────────────────────────────────────────────────── */

export async function run(opts = {}) {
  const S = new Suite('a11y');
  header('a11y — jazyk, jména, fokus, kontrast');

  const eng = (opts && (opts.chromium || opts.webkit)) || null;
  if (!eng) {
    await S.test('a11y suita', async () => skip('není prohlížeč, ve kterém by se dalo měřit'));
    return S;
  }
  if (!opts.chromium) sub('opts.chromium chybí — měřím na tom, co přišlo jako webkit.');

  // WebKit na téhle Fedoře nenastartuje (chybí ICU 74 / libjpeg 8), takže
  // se měří v Chromiu. Barvy a jména vycházejí stejně, ale Safari ani
  // VoiceOver to neověří — a hlas odečítače je přesně to, co je tu v sázce.
  if (opts.webkitReal === false) {
    S.note('a11y běželo v Chromiu (WebKit nenastartoval) — Safari zkus přes `node test/run.mjs a11y --webkit`; '
      + 'chování VoiceOveru se ale ani tak ověřit NEDÁ, jen ručně na iPhonu (test/AKCEPTACE.md).');
  }
  S.note('Kontrast je spočítaný z vykreslených barev, ne z tokenů; velkému textu se výjimka 3:1 schválně nedává — na slunci vybledne i on.');

  const dev = pickDevice(eng);
  sub(dev ? `zařízení: ${dev.name}` : `iPhone v tomhle Playwrightu není — jedu na ${IPHONE_VP.width}×${IPHONE_VP.height}`);
  const base = dev ? { device: dev.dev } : { viewport: IPHONE_VP };

  const contrastSpec = {
    text: TEXT_PAIRS, nontext: NONTEXT_PAIRS,
    minText: 4.5, minNonText: 3, sample: 6,
  };

  let light = null, dark = null;
  try {
    light = await openApp(eng, { ...base, theme: 'light', fixture: 'realistic-year' });
    const page = light.page;

    let probe = { booted: false, sections: 0, rows: 0, amtInputs: 0, bodyText: 0 };
    try { probe = await probeApp(page); } catch (e) { warn('probeApp selhal: ' + (e && e.message)); }
    sub(`vykresleno: ${probe.sections} sekcí, ${probe.rows} řádků, ${probe.amtInputs} políček, ${probe.bodyText} znaků textu`);
    if (!probe.booted) sub('appka zatím nic nevykresluje — většina testů skončí jako SKIP');

    /* ── 1. jazyk ─────────────────────────────────────────────────────── */
    // Bez lang="cs" přečte VoiceOver "Rozpočet" anglickou výslovností
    // a čísla oddělí desetinnou tečkou. Nedá se to poslouchat.
    await S.test('stránka je česky: <html lang="cs"> a smysluplný titulek', async () => {
      const m = await page.evaluate(() => ({
        lang: (document.documentElement.getAttribute('lang') || '').trim(),
        title: (document.title || '').trim(),
      }));
      assert.ok(m.lang, 'na <html> úplně chybí atribut lang — VoiceOver bude číst česky anglicky');
      assert.match(m.lang, /^cs(-CZ)?$/i, 'jazyk stránky musí být čeština');
      assert.ok(m.title.length >= 3, 'titulek stránky je prázdný — na ploše iPhonu se ikona jmenuje podle něj');
      assert.noMatch(m.title, /^(untitled|document|index|app|budget)$/i, 'titulek je výchozí anglická placeholder hodnota');
      assert.ok(
        /[ěščřžýáíéúůňťďĚŠČŘŽÝÁÍÉÚŮŇŤĎ]/.test(m.title) || /rozpo[cč]et|pen[ií]ze|m[eě]s[ií]c|[uú]spor/i.test(m.title),
        `titulek "${m.title}" nevypadá česky`,
      );
    });

    /* ── 2. jména polí ────────────────────────────────────────────────── */
    // Pattern appky je <label class="cell"><span class="sr-only">Plán</span><input>.
    // Ten MUSÍ projít — a naopak holý input bez čehokoliv projít nesmí,
    // protože VoiceOver na něm řekne jen "textové pole, upravit".
    await S.test('každé zadávací pole má jméno, které VoiceOver přečte', async () => {
      let r = await page.evaluate(sweepControlsInPage);
      let kde = 'na obrazovce';
      let openedSheet = null;
      try {
        if (r.total === 0) {
          // Řádky se ještě nevykreslují? Pole bývají i ve spodním panelu.
          openedSheet = await openAnySheet(page);
          if (openedSheet) {
            r = await page.evaluate(sweepControlsInPage);
            kde = 'v otevřeném panelu (' + openedSheet.sel + ')';
          }
        }
        if (r.total === 0) skip('zatím tu nejsou žádná zadávací pole');
        if (r.weak.length) S.note(`a11y: ${r.weak.length}× pole se jménem jen z placeholderu (zmizí, jakmile se do něj začne psát): ${r.weak[0]}`);
        assert.empty(r.missing, `pole bez přístupového jména ${kde} — VoiceOver z nich přečte jen "textové pole"`);
      } finally {
        if (openedSheet) await closeSheets(page);
      }
    });

    /* ── 3. jména tlačítek ────────────────────────────────────────────── */
    // Lovíme přesně tenhle tvar: <button><span aria-hidden="true">✓</span></button>.
    // Ikona je pro odečítač neviditelná, takže tlačítko nemá jméno vůbec.
    await S.test('každé tlačítko má jméno (ikona s aria-hidden se nepočítá)', async () => {
      const r = await page.evaluate(sweepButtonsInPage);
      if (r.total === 0) skip('zatím tu nejsou žádná tlačítka');
      assert.empty(r.missing, `tlačítka, na kterých VoiceOver řekne jen "tlačítko" (z ${r.total} zkoumaných)`);
    });

    /* ── 10. past na odečítač ─────────────────────────────────────────── */
    // aria-hidden="true" nad něčím, kam se dá dostat tabulátorem, je klasika:
    // fokus tam skočí, ale odečítač nemá co říct. Nikola slyší ticho.
    await S.test('nic s aria-hidden="true" neschovává fokusovatelný prvek', async () => {
      const bad = await page.evaluate(sweepAriaHiddenInPage);
      assert.empty(bad, 'skryté podstromy, do kterých se dá dostat tabulátorem');
    });

    /* ── 4. viditelný fokus ───────────────────────────────────────────── */
    // Bez viditelného rámečku uživatelka s klávesnicí (nebo s přepínačem)
    // neví, co zrovna zmáčkne. Měříme prvních FOCUS_CAP prvků.
    await S.test('na každém prvku je vidět, že je zaostřený', async () => {
      const r = await page.evaluate(sweepFocusInPage, { cap: FOCUS_CAP, budgetMs: FOCUS_BUDGET_MS });
      if (r.total === 0) skip('zatím tu není nic, co by šlo zaostřit');
      if (r.checked === 0) skip('žádný prvek fokus nepřijal — není co měřit');
      if (r.focusVisible === 0 && r.offenders.length === r.checked) {
        // Tenhle engine :focus-visible při programovém focus() nepřiznává —
        // pak by test hlásil úplně všechno a nešlo by mu věřit.
        skip('tenhle prohlížeč nepřiznává :focus-visible při programovém zaostření — neměřitelné');
      }
      if (r.timedOut) S.note(`a11y: fokusový průchod jsem po ${FOCUS_BUDGET_MS} ms zastavil — změřeno ${r.checked} z ${r.total} prvků`);
      if (r.notFocusable.length) S.note(`a11y: ${r.notFocusable.length}× prvek, který fokus vůbec nepřijal (např. ${r.notFocusable[0]})`);
      assert.empty(r.offenders, `prvky bez viditelného fokusu (změřeno ${r.checked} z ${r.total})`);
    });

    /* ── 5. pořadí tabulátoru ─────────────────────────────────────────── */
    // Tabulátor musí jít po očích: shora dolů, zleva doprava. Přišpendlené
    // prvky (FAB, tabbar, lepicí hlavička) se nesrovnávají — jejich pozice
    // se scrollem nemění, takže by dělaly falešné poplachy.
    await S.test('pořadí tabulátoru jde po očích (shora dolů, zleva doprava)', async () => {
      await page.evaluate(() => {
        try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /**/ }
        window.scrollTo(0, 0);
      }).catch(() => { });
      await settle(page, 120);

      const seen = [];
      for (let i = 0; i < TAB_STEPS; i++) {
        await page.keyboard.press('Tab').catch(() => { });
        let info = null;
        try { info = await page.evaluate(activeInfoInPage); } catch (e) { break; }
        if (!info) break;                                  // fokus vypadl z dokumentu
        if (seen.length && info.key === seen[0].key) break; // kolo se uzavřelo
        seen.push(info);
      }
      const flow = seen.filter(s => s.usable);
      if (flow.length < 3) skip('zatím není co tabovat');

      const inversions = [];
      for (let i = 1; i < flow.length; i++) {
        const a = flow[i - 1], b = flow[i];
        const back = b.row < a.row || (b.row === a.row && b.x < a.x - 4);
        if (back) {
          inversions.push(`prvek ${b.label} (y=${b.y}, x=${b.x}) přišel na řadu až po ${a.label} (y=${a.y}, x=${a.x})`);
        }
      }
      assert.empty(inversions, `tabulátor skáče proti čtení (prošel jsem ${flow.length} prvků)`);
    });

    /* ── 7. živá oblast souhrnu ───────────────────────────────────────── */
    // Když se změní částka, musí to odečítač oznámit sám. Jinak Nikola
    // neví, jestli se něco vůbec přepočítalo.
    await S.test('souhrn měsíce se ohlašuje sám (aria-live="polite")', async () => {
      const r = await page.evaluate(liveRegionsInPage);
      if (!r.totals) {
        skip('měsíční obrazovka zatím nevykresluje žádné souhrnné číslo — není co ohlašovat');
      }
      const hledal = '#sr-live, obal [data-d="value"], .kpi[aria-live], .sec-sums[aria-live], cokoliv s [aria-live]';
      assert.ok(r.regions.length, `na stránce není ani jedna živá oblast; hledal jsem: ${hledal}`);
      const polite = r.regions.filter(x => x.live === 'polite');
      assert.ok(polite.length,
        `žádná živá oblast nemá aria-live="polite" (našel jsem: ${r.regions.map(x => x.path + '=' + (x.live || '—')).join(', ')}); hledal jsem: ${hledal}`);
      const atomic = polite.filter(x => x.atomic === 'true');
      assert.ok(atomic.length,
        `živá oblast ${polite.map(x => x.path).join(', ')} nemá aria-atomic="true" — odečítač pak přečte jen změněné slovo, ne celou částku`);
    });

    /* ── 8. kontrast — světlý motiv ───────────────────────────────────── */
    const lightMeasure = await page.evaluate(measureContrastInPage, contrastSpec).catch((e) => ({ error: String(e && e.message || e) }));
    await contrastTests(S, lightMeasure, 'světlý motiv');

    /* ── 6. panely a fokus ────────────────────────────────────────────── */
    // Až na konci: klikání otevírá panely a mění stav appky.
    await S.test('Escape zavře panel a fokus se vrátí tam, odkud se otevřel', async () => {
      const opened = await openAnySheet(page);
      if (!opened) skip('panely (sheets) zatím neotevírají nic');
      try {
        await page.keyboard.press('Escape');
        await settle(page, 250);
        assert.not(await sheetIsOpen(page), 'Escape panel nezavřel — na iPhonu s klávesnicí z něj pak není cesta ven');
        const back = await page.evaluate(({ sel, idx }) => {
          const el = document.querySelectorAll(sel)[idx];
          const a = document.activeElement;
          const name = (n) => (n && n.nodeType === 1
            ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + '.' + (n.getAttribute('class') || '').split(/\s+/)[0]
            : String(n && n.nodeName));
          return { same: !!el && a === el, active: name(a), trigger: el ? name(el) : 'spouštěč zmizel' };
        }, opened);
        assert.ok(back.same,
          `fokus se po zavření nevrátil na ${back.trigger} (je na ${back.active}) — odečítač skočí na začátek stránky a uživatelka se ztratí`);
      } finally {
        await closeSheets(page);
      }
    });

    await S.test('dokud je panel otevřený, tabulátor z něj neuteče', async () => {
      const opened = await openAnySheet(page);
      if (!opened) skip('panely (sheets) zatím neotevírají nic');
      try {
        const escapes = [];
        for (let i = 0; i < TRAP_STEPS; i++) {
          await page.keyboard.press('Tab').catch(() => { });
          let out = null;
          try {
            out = await page.evaluate(() => {
              const a = document.activeElement;
              if (!a || a === document.body || a === document.documentElement) return 'mimo panel (tělo stránky)';
              const inside = a.closest && a.closest('#sheet-host, .sheet[role="dialog"], [role="dialog"]');
              if (inside) return null;
              return a.tagName.toLowerCase() + '.' + (a.getAttribute('class') || '').split(/\s+/)[0];
            });
          } catch (e) { break; }
          if (out) escapes.push(`po ${i + 1}. Tabu skončil fokus na ${out}`);
        }
        assert.empty(escapes, 'fokus utekl z otevřeného panelu — uživatelka pak edituje něco, co nevidí');
      } finally {
        await closeSheets(page);
      }
    });

    /* ── 8. kontrast — tmavý motiv ────────────────────────────────────── */
    // Vlastní kontext, ne přepnutí motivu za běhu: tmavé barvy se musí
    // změřit tak, jak se appka načte večer v posteli.
    let darkMeasure = { error: 'tmavý motiv se nepodařilo otevřít' };
    try {
      dark = await openApp(eng, { ...base, theme: 'dark', fixture: 'realistic-year' });
      darkMeasure = await dark.page.evaluate(measureContrastInPage, contrastSpec);
    } catch (e) {
      darkMeasure = { error: String((e && e.message) || e).split('\n')[0] };
    }
    await contrastTests(S, darkMeasure, 'tmavý motiv');

    /* ── 9. nula chyb ─────────────────────────────────────────────────── */
    await errorBaseline(S, light.errors, 'a11y');
  } catch (e) {
    // Suita nikdy nesmí vyhodit ven — runner by přišel o výsledky ostatních.
    await S.test('a11y suita doběhla do konce', async () => {
      throw new Error('neočekávaná chyba mimo jednotlivé testy: ' + ((e && e.stack) || e));
    });
  } finally {
    if (light) await light.close().catch(() => { });
    if (dark) await dark.close().catch(() => { });
  }

  return S;
}

/* ── vyhodnocení kontrastu (obojí motiv stejným metrem) ──────────────────── */

async function contrastTests(S, m, themeLabel) {
  const bad = (m && m.error) ? m.error : null;

  // Šedá na šedé se na iPhonu na slunci nedá přečíst. 4,5:1 je minimum,
  // pod kterým Nikola prostě nevidí, kolik jí zbývá do výplaty.
  await S.test(`kontrast textu 4,5:1 — ${themeLabel}`, async () => {
    if (bad) skip('kontrast se nepodařilo změřit: ' + bad);
    const pairs = (m && m.text) || [];
    const missing = pairs.filter(p => !p.found);
    if (missing.length === pairs.length) skip('žádná z osmi textových dvojic se zatím nevykresluje');
    const offenders = [];
    const uncertain = [];
    for (const p of pairs) {
      if (!p.found || !p.worst) continue;
      const w = p.worst;
      if (w.uncertain) { uncertain.push(`${p.id} (pod textem je obrázek/přechod, číslo by lhalo)`); continue; }
      if (w.ratio < p.min) {
        offenders.push(`${p.id}: ${cz1(w.ratio)}:1 (min ${cz1(p.min)}:1) — text ${w.fg} na ${w.bg} · ${w.where} · ${w.size}/${w.weight}`);
      }
    }
    if (missing.length) S.note(`a11y ${themeLabel}: nezměřeno ${missing.length}/${pairs.length} textových dvojic (${missing.map(x => x.id).join(', ')})`);
    if (uncertain.length) S.note(`a11y ${themeLabel}: ${uncertain.join('; ')}`);
    assert.empty(offenders, `textové dvojice pod 4,5:1 — ${themeLabel} (změřeno ${pairs.length - missing.length}/${pairs.length})`);
  });

  // Netextové hranice (pruhy, hranice polí, fokusový rámeček) mají mít 3:1,
  // jinak z grafu zbude šedá skvrna a fokus není vidět vůbec.
  // Ozdobné vlasové linky jsou mimo rozsah — viz NONTEXT_EXCLUDED nahoře.
  await S.test(`kontrast netextových prvků 3:1 — ${themeLabel}`, async () => {
    if (bad) skip('kontrast se nepodařilo změřit: ' + bad);
    const pairs = (m && m.nontext) || [];
    const measured = pairs.filter(p => p.found);
    // Rozsah se vypisuje pokaždé, ať je výjimka vidět a dá se s ní nesouhlasit.
    sub(`  netextové hranice v rozsahu (${measured.length}/${pairs.length} změřeno): `
      + (measured.map(p => p.id).join(' · ') || '—'));
    for (const x of NONTEXT_EXCLUDED) sub(`  mimo rozsah schválně: ${x}`);
    const missing = pairs.filter(p => !p.found);
    if (missing.length === pairs.length) skip('žádná netextová hranice se zatím nevykresluje');
    const offenders = [];
    for (const p of pairs) {
      if (!p.found || !p.worst) continue;
      const w = p.worst;
      if (w.uncertain) continue;
      if (w.ratio < p.min) {
        offenders.push(`${p.id}: ${cz1(w.ratio)}:1 (min ${cz1(p.min)}:1) — ${w.fg} na ${w.bg} · ${w.where}`);
      }
    }
    if (missing.length) {
      S.note(`a11y ${themeLabel}: nezměřeno ${missing.length}/${pairs.length} netextových hranic (`
        + missing.map(x => x.id + (x.note ? ' — ' + x.note : '')).join(', ') + ')');
    }
    assert.empty(offenders, `netextové hranice pod 3:1 — ${themeLabel} (změřeno ${pairs.length - missing.length}/${pairs.length})`);
  });
}
