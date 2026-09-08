// test/lib/harness.mjs — mikro test runner. Nulové závislosti.
// PASS / FAIL / SKIP. SKIP je první třída: většina appky se právě píše
// a "ještě není hotovo" nesmí vypadat jako "je to rozbité".

const C = {
  reset: '\u001b[0m', dim: '\u001b[2m', bold: '\u001b[1m',
  green: '\u001b[32m', red: '\u001b[31m', yellow: '\u001b[33m',
  cyan: '\u001b[36m', gray: '\u001b[90m',
};
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = new Proxy(C, { get: (t, k) => (useColor ? (t[k] || '') : '') });

export class Skip extends Error {
  constructor(msg) { super(msg || 'not yet implemented'); this.name = 'Skip'; }
}
/** Označ tvrzení jako "funkce ještě neexistuje" a pokračuj dál. */
export function skip(msg) { throw new Skip(msg); }

export class AssertionError extends Error {
  constructor(msg) { super(msg); this.name = 'AssertionError'; }
}

function fmt(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'bigint') return String(v) + 'n';
  if (v === undefined) return 'undefined';
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : (s.length > 400 ? s.slice(0, 400) + '…' : s);
  } catch { return String(v); }
}

export const assert = {
  ok(v, msg) { if (!v) throw new AssertionError((msg || 'čekal jsem pravdu') + `\n      dostal jsem: ${fmt(v)}`); },
  not(v, msg) { if (v) throw new AssertionError((msg || 'čekal jsem nepravdu') + `\n      dostal jsem: ${fmt(v)}`); },
  eq(a, b, msg) {
    if (!Object.is(a, b)) {
      throw new AssertionError((msg || 'nerovná se')
        + `\n      dostal jsem: ${fmt(a)}\n      čekal jsem:  ${fmt(b)}`);
    }
  },
  ne(a, b, msg) {
    if (Object.is(a, b)) throw new AssertionError((msg || 'má se lišit') + `\n      obojí: ${fmt(a)}`);
  },
  deep(a, b, msg) {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) {
      throw new AssertionError((msg || 'struktury se liší')
        + `\n      dostal jsem: ${(sa || '').slice(0, 600)}\n      čekal jsem:  ${(sb || '').slice(0, 600)}`);
    }
  },
  match(str, re, msg) {
    if (!re.test(String(str))) {
      throw new AssertionError((msg || 'nesedí vzor')
        + `\n      dostal jsem: ${fmt(str)}\n      vzor:        ${re}`);
    }
  },
  noMatch(str, re, msg) {
    if (re.test(String(str))) {
      throw new AssertionError((msg || 'nemá sedět vzor')
        + `\n      dostal jsem: ${fmt(str)}\n      vzor:        ${re}`);
    }
  },
  lte(a, b, msg) {
    if (!(a <= b)) throw new AssertionError((msg || 'má být <=') + `\n      ${fmt(a)} <= ${fmt(b)}`);
  },
  gte(a, b, msg) {
    if (!(a >= b)) throw new AssertionError((msg || 'má být >=') + `\n      ${fmt(a)} >= ${fmt(b)}`);
  },
  /** Prázdné pole = OK. Jinak vypíše až `max` provinilců. */
  empty(list, msg, max = 8) {
    const arr = Array.from(list || []);
    if (arr.length === 0) return;
    const head = arr.slice(0, max).map(x => '        · ' + (typeof x === 'string' ? x : fmt(x))).join('\n');
    throw new AssertionError(`${msg || 'čekal jsem prázdný seznam'} (${arr.length}×)\n${head}`
      + (arr.length > max ? `\n        … a dalších ${arr.length - max}` : ''));
  },
};

export class Suite {
  constructor(name) {
    this.name = name;
    this.results = [];   // {name, status, ms, error, note}
    this._notes = [];
  }
  note(s) { this._notes.push(s); }

  async test(name, fn) {
    const t0 = Date.now();
    try {
      await fn();
      this.results.push({ name, status: 'pass', ms: Date.now() - t0 });
      line('pass', name, Date.now() - t0);
    } catch (e) {
      const ms = Date.now() - t0;
      if (e && e.name === 'Skip') {
        this.results.push({ name, status: 'skip', ms, note: e.message });
        line('skip', name, ms, e.message);
      } else {
        this.results.push({ name, status: 'fail', ms, error: e });
        line('fail', name, ms, (e && e.stack) || String(e));
      }
    }
  }

  get counts() {
    const n = { pass: 0, fail: 0, skip: 0 };
    for (const r of this.results) n[r.status]++;
    return n;
  }
}

function line(status, name, ms, extra) {
  const tag = status === 'pass' ? `${c.green}ok  ${c.reset}`
    : status === 'fail' ? `${c.red}FAIL${c.reset}`
      : `${c.yellow}skip${c.reset}`;
  const t = ms > 400 ? ` ${c.gray}${ms}ms${c.reset}` : '';
  console.log(`  ${tag} ${name}${t}`);
  if (extra) {
    const body = String(extra).split('\n').slice(0, status === 'fail' ? 14 : 2);
    const col = status === 'fail' ? c.red : c.gray;
    for (const l of body) console.log(`       ${col}${l}${c.reset}`);
  }
}

export function header(s) {
  console.log(`\n${c.bold}${c.cyan}▌ ${s}${c.reset}`);
}
export function sub(s) {
  console.log(`  ${c.gray}${s}${c.reset}`);
}
export function warn(s) {
  console.log(`  ${c.yellow}⚠ ${s}${c.reset}`);
}

export function summarize(suites) {
  const total = { pass: 0, fail: 0, skip: 0 };
  console.log(`\n${c.bold}════════ SOUHRN ════════${c.reset}`);
  for (const s of suites) {
    const n = s.counts;
    total.pass += n.pass; total.fail += n.fail; total.skip += n.skip;
    const bad = n.fail > 0;
    const mark = bad ? `${c.red}✗${c.reset}` : `${c.green}✓${c.reset}`;
    console.log(`${mark} ${s.name.padEnd(10)} ${String(n.pass).padStart(3)} ok  `
      + `${c.red}${String(n.fail).padStart(3)} fail${c.reset}  `
      + `${c.yellow}${String(n.skip).padStart(3)} skip${c.reset}`);
    for (const note of s._notes) console.log(`  ${c.gray}${note}${c.reset}`);
  }
  console.log(`${c.bold}CELKEM     ${String(total.pass).padStart(3)} ok  `
    + `${String(total.fail).padStart(3)} fail  ${String(total.skip).padStart(3)} skip${c.reset}`);
  if (total.fail === 0) console.log(`${c.green}Žádná chyba.${c.reset}`);
  const failed = [];
  for (const s of suites) for (const r of s.results) if (r.status === 'fail') failed.push(`${s.name}: ${r.name}`);
  if (failed.length) {
    console.log(`\n${c.red}${c.bold}Spadlo:${c.reset}`);
    for (const f of failed) console.log(`  ${c.red}· ${f}${c.reset}`);
  }
  return total;
}
