// 31-util.js — parser částek, formátování, datumy, DOM pomocníci — vlastní: L0
// POZOR: tenhle soubor je smlouva pro všechny ostatní. Neměnit bez testu.

// Pozastavení zápisu. Vlastní kontrola si na chvíli sahá do stavu a po tu
// dobu se nesmí nic uložit — debounce umí vystřelit i synchronně.
let saveSuspended = false;

/* ---------- identita ---------- */
let _uidN = 0;
function uid(prefix) {
  _uidN += 1;
  const r = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return (prefix || 'x_') + r + _uidN.toString(36);
}

function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }
function num(v) { return Number.isFinite(v) ? v : 0; }

/* ---------- částky (celé haléře) ---------- */

// Všechny varianty mezer, které se dají do pole dostat vložením ze schránky.
const _SPACE_RE = /[\s\u00A0\u202F\u2000-\u200B\u2028\u2029\u3000\uFEFF]/g;

// parseCzkInput(raw) -> { ok, minor, reason }
//   minor = celé haléře, nebo null
//   reason = 'ok' | 'blank' | 'invalid' | 'range'
// PRÁZDNÉ POLE VRACÍ null, NIKDY 0. Number("") je nula a přesně tak se
// smazané pole tiše stane skutečnou nulou.
function parseCzkInput(raw) {
  if (raw === null || raw === undefined) return { ok: true, minor: null, reason: 'blank' };
  let s = String(raw);
  s = s.replace(/[−–—‐‑]/g, '-'); // typografické minusy a pomlčky
  s = s.replace(_SPACE_RE, '');
  s = s.replace(/(?:kč|kc|czk)/gi, '');
  s = s.replace(/,[-–—]$/, '');   // česká zkratka "2500,-"
  // Samotná čárka nebo tečka není nula. Jedno klepnutí vedle by jinak
  // natrvalo odpojilo řádek od deníku a ukazovalo 0 Kč.
  if (/^[+-]?[.,]+$/.test(s)) return { ok: false, minor: null, reason: 'invalid' };
  s = s.replace(/,$/, ',0');      // "12," -> "12,0"
  if (s === '') return { ok: true, minor: null, reason: 'blank' };

  let sign = 1;
  if (s[0] === '+') s = s.slice(1);
  else if (s[0] === '-') { sign = -1; s = s.slice(1); }
  if (s === '') return { ok: false, minor: null, reason: 'invalid' };
  if (!/^[0-9.,]+$/.test(s)) return { ok: false, minor: null, reason: 'invalid' };

  const commas = (s.match(/,/g) || []).length;
  if (commas > 1) return { ok: false, minor: null, reason: 'invalid' };

  let intPart, fracPart = '';
  if (commas === 1) {
    const i = s.indexOf(',');
    intPart = s.slice(0, i).replace(/\./g, '');   // tečky před čárkou = tisíce
    fracPart = s.slice(i + 1);
    if (fracPart.indexOf('.') >= 0) return { ok: false, minor: null, reason: 'invalid' };
  } else {
    const dots = (s.match(/\./g) || []).length;
    if (dots === 0) {
      intPart = s;
    } else if (dots === 1) {
      const i = s.indexOf('.');
      const head = s.slice(0, i), after = s.slice(i + 1);
      if (head === '') { intPart = '0'; fracPart = after; }
      else if (after.length === 3) { intPart = head + after; }   // "1.234" = tisíce
      else if (after.length >= 1 && after.length <= 2) { intPart = head; fracPart = after; }
      else return { ok: false, minor: null, reason: 'invalid' };
    } else {
      if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return { ok: false, minor: null, reason: 'invalid' };
      intPart = s.replace(/\./g, '');
    }
  }

  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart)) return { ok: false, minor: null, reason: 'invalid' };
  if (fracPart !== '' && !/^\d+$/.test(fracPart)) return { ok: false, minor: null, reason: 'invalid' };
  if (intPart.length > 12) return { ok: false, minor: null, reason: 'range' };

  const f3 = (fracPart + '000').slice(0, 3);
  let minor = Number(intPart) * 100 + Number(f3.slice(0, 2));
  if (Number(f3[2]) >= 5) minor += 1;              // zaokrouhlení od nuly
  if (!Number.isSafeInteger(minor)) return { ok: false, minor: null, reason: 'range' };
  if (minor > 1e11) return { ok: false, minor: null, reason: 'range' };   // strop 1 mld. Kč
  minor = minor === 0 ? 0 : sign * minor;          // nikdy -0
  return { ok: true, minor, reason: 'ok' };
}

// Zaokrouhlení haléřů na celé koruny, vždy od nuly (i pro záporná čísla).
// Math.round(-1.5) je -1, což je špatně a u dluhů to je vidět.
function roundMinor(minor, step) {
  const st = step || 100;
  const a = Math.abs(minor);
  const r = Math.floor(a / st) * st + (a % st >= st / 2 ? st : 0);
  return minor < 0 ? -r : r;
}

function sumMinor(list) {
  let t = 0;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (Number.isSafeInteger(v)) t += v;
  }
  return t;
}

function _group(digits) {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += NBSP;
    out += digits[i];
  }
  return out;
}

// formatCzk(minor, opts) -> "26 000 Kč"  (obě mezery jsou U+00A0)
// Ručně psané schválně: ICU u některých jazyků mezeru už přehodilo na jinou
// a na iOS bychom to nezjistili. Intl se používá jen jako orákulum v testech.
function formatCzk(minor, opts) {
  const o = opts || {};
  // Výchozí chování: haléře se ukazují jen tehdy, když nějaké jsou. Bez toho
  // se řádky zaokrouhlují na koruny, ale součet ne, a tabulka pak vizuálně
  // nedává dohromady to, co je pod ní napsané.
  let decimals;
  if (o.decimals === 2) decimals = 2;
  else if (o.decimals === 0) decimals = 0;
  else decimals = (Number.isFinite(minor) && Math.abs(minor) % 100 !== 0) ? 2 : 0;
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  const neg = minor < 0;
  let a = Math.abs(minor);
  let whole, frac = '';
  if (decimals === 0) {
    whole = Math.floor(a / 100) + (a % 100 >= 50 ? 1 : 0);
  } else {
    whole = Math.floor(a / 100);
    frac = String(a % 100).padStart(2, '0');
  }
  // Zaokrouhlená nula nesmí mít znaménko: -0,4 Kč je "0 Kč", ne "-0 Kč".
  const isZero = whole === 0 && (decimals === 0 || frac === '00');
  const sign = (neg && !isZero) ? '-' : (o.sign && !isZero ? '+' : '');
  const body = _group(String(whole)) + (decimals === 2 ? ',' + frac : '');
  return sign + body + NBSP + 'Kč';
}

function formatSigned(minor) { return formatCzk(minor, { sign: true }); }

// Podoba pro editaci: holé číslo, česká čárka, bez oddělovačů a bez "Kč".
function fmtEdit(minor) {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '';
  const neg = minor < 0, a = Math.abs(minor);
  const whole = Math.floor(a / 100), h = a % 100;
  let s = String(whole);
  if (h !== 0) s += ',' + (h % 10 === 0 ? String(h / 10) : String(h).padStart(2, '0'));
  return (neg ? '-' : '') + s;
}

// Podíl v procentech, odolný vůči 0/0 a x/0.
function pct(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return null;
  return part / whole;
}

/* ---------- datumy ----------
   NIKDE toISOString(). V pražském čase vrací new Date(2026,0,1).toISOString()
   měsíc 2025-12 — leden by spadl do prosince. Na americkém stroji je ta chyba
   neviditelná, proto se to hlídá testem i grepem. */

function _p2(n) { return n < 10 ? '0' + n : String(n); }

function ymd(d) { return d.getFullYear() + '-' + _p2(d.getMonth() + 1) + '-' + _p2(d.getDate()); }
function monthKey(d) { return d.getFullYear() + '-' + _p2(d.getMonth() + 1); }
function todayISO() { return ymd(new Date()); }

// "2026-09-08" -> {y:2026, m:8 (0..11), day:8}  |  null když je to nesmysl
function parseYmd(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = +m[1], mo = +m[2], da = +m[3];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return { y, m: mo - 1, day: da };
}

function daysInMonth(y, m /* 0..11 */) { return new Date(y, m + 1, 0).getDate(); }

// Splatnost 31. v únoru musí být 28. (nebo 29.), ne 3. března.
// new Date(2026,0,31) + setMonth(+1) dá 3. března — proto tahle funkce.
function dueDateFor(y, m, dueDay) {
  if (!Number.isFinite(dueDay) || dueDay < 1) return null;
  const last = daysInMonth(y, m);
  return y + '-' + _p2(m + 1) + '-' + _p2(Math.min(Math.round(dueDay), last));
}

function isInMonth(iso, y, m) {
  const p = parseYmd(iso);
  return !!p && p.y === y && p.m === m;
}

function addMonths(y, m, delta) {
  const t = y * 12 + m + delta;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}

function monthLabelCs(y, m) { return MONTHS_NOM[m] + ' ' + y; }
function monthShortCs(m) { return MONTHS_SHORT[m]; }

function fmtDateShort(iso) {
  const p = parseYmd(iso);
  return p ? p.day + '. ' + (p.m + 1) + '.' : '';
}
function fmtDateLong(iso) {
  const p = parseYmd(iso);
  return p ? p.day + '. ' + MONTHS_GEN[p.m] + ' ' + p.y : '';
}

// Rozdíl ve dnech. Přes UTC půlnoc, aby 23hodinový den při přechodu na letní
// čas (29. 3.) nezpůsobil o den míň.
function daysBetween(isoA, isoB) {
  const a = parseYmd(isoA), b = parseYmd(isoB);
  if (!a || !b) return null;
  const ua = Date.UTC(a.y, a.m, a.day), ub = Date.UTC(b.y, b.m, b.day);
  return Math.round((ub - ua) / 86400000);
}
function daysUntil(iso) { return daysBetween(todayISO(), iso); }

function relDaysCs(n) {
  if (n === null) return '';
  if (n === 0) return 'dnes';
  if (n === 1) return 'zítra';
  if (n === -1) return 'včera';
  if (n < 0) return 'po splatnosti';
  if (n >= 2 && n <= 4) return 'za ' + n + ' dny';
  return 'za ' + n + ' dní';
}

function cmpCs(a, b) { return String(a).localeCompare(String(b), 'cs'); }

/* ---------- plánování ---------- */
function debounce(fn, wait, maxWait) {
  let t = 0, first = 0;
  return function debounced() {
    const now = Date.now();
    if (!first) first = now;
    clearTimeout(t);
    if (maxWait && now - first >= maxWait) { first = 0; fn(); return; }
    t = setTimeout(function () { first = 0; fn(); }, wait);
  };
}

function rafOnce(fn) {
  let id = 0;
  return function () {
    if (id) return;
    id = requestAnimationFrame(function () { id = 0; fn(); });
  };
}

/* ---------- DOM ----------
   Nikde innerHTML. Text jen přes textContent. */
function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function el(tag, attrs, text) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'dataset') { for (const d in v) n.dataset[d] = v[d]; }
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  if (text !== null && text !== undefined) n.textContent = String(text);
  return n;
}

function svgEl(tag, attrs, text) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    n.setAttribute(k, String(v));
  }
  if (text !== null && text !== undefined) n.textContent = String(text);
  return n;
}

function tpl(id) {
  const t = document.getElementById(id);
  if (!t) throw new Error('chybí šablona ' + id);
  return t.content.firstElementChild.cloneNode(true);
}

// Zápis textu, který nic nedělá, když se nic nezměnilo — šetří překreslení.
function setText(node, str) {
  if (!node) return;
  const s = str === null || str === undefined ? '' : String(str);
  if (node.textContent !== s) node.textContent = s;
}

function setAttrIf(node, name, val) {
  if (!node) return;
  if (val === null || val === undefined || val === false) node.removeAttribute(name);
  else if (node.getAttribute(name) !== String(val)) node.setAttribute(name, String(val));
}

function setBarWidth(node, ratio) {
  if (!node) return;
  const r = Number.isFinite(ratio) ? clamp(ratio, 0, 1) : 0;
  const s = (r * 100).toFixed(2) + '%';
  if (node.style.width !== s) node.style.width = s;
}

/* ---------- CSV ---------- */
// Buňka pro Excel v češtině: středník, CRLF, BOM řeší volající.
// Text začínající =, +, - nebo @ se musí odzbrojit, jinak z něj Excel udělá vzorec.
function escapeCsv(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) { if (!deepEqual(a[k], b[k])) return false; }
  return true;
}
