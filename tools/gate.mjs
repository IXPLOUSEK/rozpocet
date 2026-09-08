#!/usr/bin/env node
// tools/gate.mjs — statické brány nad slepeným rozpocet.html.
// Kontroluje železná pravidla z src/_CONTRACT.md. Spouští se před vydáním.
import { readFileSync, existsSync } from 'node:fs';

const F = process.argv[2] || 'rozpocet.html';
if (!existsSync(F)) { console.error('chybí ' + F + ' — spusť nejdřív node build.mjs'); process.exit(2); }
const html = readFileSync(F, 'utf8');
const js = html.slice(html.indexOf('<script>'), html.lastIndexOf('</scr' + 'ipt>'));

let fail = 0, pass = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; return; }
  fail++; console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
};
const countOutsideComments = (re) => {
  const stripped = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return (stripped.match(re) || []);
};

// --- železná pravidla ---
check('nikde innerHTML', countOutsideComments(/\.innerHTML\b/g).length === 0,
  countOutsideComments(/.{0,60}\.innerHTML.{0,40}/g).slice(0, 3).join('\n      '));
const markup = html.replace(/<script>[\s\S]*?<\/scr' + 'ipt>/g, '');
check('nikde input[type=number]', !/<input[^>]*type\s*=\s*["']number["']/i.test(markup));
check('nikde toISOString pro datum', countOutsideComments(/\.toISOString\s*\(/g).length === 0);
const pf = js.split('\n').filter(l => /parseFloat\s*\(/.test(l) && !/getComputedStyle/.test(l));
check('nikde parseFloat na uživatelský vstup', pf.length === 0, pf.slice(0,3).join('\n      '));
check('nikde eval', countOutsideComments(/\beval\s*\(/g).length === 0);
check('nikde document.write', !/document\.write/.test(js));
check('nikde alert/confirm/prompt', countOutsideComments(/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/g).length === 0);

// --- soběstačnost ---
const ext = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/gi)].map(m => m[0]);
check('žádný externí soubor', ext.length === 0, ext.slice(0, 5).join('\n      '));
check('žádný @import', !/@import/.test(html));
check('žádný @font-face', !/@font-face/.test(html));
check('žádná pevně zadaná adresa skriptu', !/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/.test(js));

// --- start naprázdno ---
const demoStart = js.indexOf('function makeDemoData');
const demoEnd = demoStart < 0 ? -1 : js.indexOf('\nfunction ', demoStart + 10);
const demoBody = demoStart < 0 ? '' : js.slice(demoStart, demoEnd < 0 ? demoStart + 6000 : demoEnd);
const outsideDemo = demoStart < 0 ? js : js.slice(0, demoStart) + js.slice(demoEnd < 0 ? js.length : demoEnd);
const demoWords = ['Albert', 'Lidl', 'Rohlík', 'Kaufland', 'Billa', 'Penny', 'Globus'];
const leaked = demoWords.filter(w => outsideDemo.includes(w));
check('ukázková data jen uvnitř makeDemoData', leaked.length === 0, 'uniklo: ' + leaked.join(', '));
check('makeDemoData má jediné volací místo',
  countOutsideComments(/makeDemoData\s*\(/g).length <= 1,
  'volání: ' + countOutsideComments(/makeDemoData\s*\(/g).length);

// --- velikost a tvar ---
const kb = Buffer.byteLength(html, 'utf8') / 1024;
check('soubor pod 900 kB', kb < 900, kb.toFixed(1) + ' kB');
check('má lang="cs"', /<html lang="cs">/.test(html));
check('má viewport-fit=cover', /viewport-fit=cover/.test(html));
check('má apple-mobile-web-app-title', /apple-mobile-web-app-title/.test(html));
check('vstupy mají 16px pravidlo', /input[^{]*\{[^}]*font-size:\s*16px/.test(html) || /font-size:\s*16px[^}]*\}/.test(html));
check('tiskové CSS ruší rolování', /@media print[\s\S]{0,3000}overflow:\s*visible\s*!important/.test(html));
check('registruje sw relativně', /register\((['"])\.\/sw\.js\1\)/.test(js));

console.log((fail === 0 ? 'PASS' : 'FAIL') + ' ' + pass + '/' + (pass + fail) + '   (' + kb.toFixed(1) + ' kB)');
process.exit(fail ? 1 : 0);
