#!/usr/bin/env node
// build.mjs — slepí fragmenty ze src/ do jednoho rozpocet.html
// Spuštění: node build.mjs
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'rozpocet.html');

// Pořadí je závazné. Každý fragment vlastní jedna dráha.
const HEAD_HTML = ['00-head.html'];
const CSS = [
  '10-tokens.css', '11-base.css', '12-shell.css',
  '13-components.css', '14-charts.css', '15-print.css',
];
const BODY_HTML = ['20-markup.html', '21-templates.html'];
// POZOR: pořadí NENÍ podle čísel. `60-events.js` deklaruje `const ACTIONS`
// a obrazovky do něj na konci svých souborů přidávají klíče, takže musí být
// načtený dřív než ony — jinak spadne na "Cannot access 'ACTIONS' before
// initialization". Čísla v názvech drží skupiny pohromadě, tenhle seznam
// drží běh.
const JS = [
  '30-config.js', '31-util.js',
  '32-storage.js', '33-model.js', '34-derived.js',
  '40-charts.js',
  '60-events.js', '61-sheets.js',
  '50-month.js', '51-journal.js', '52-due-goals.js',
  '53-io.js', '54-year-more.js', '55-sync.js',
  '70-selftest.js', '80-boot.js',
];

const missing = [];
function read(name) {
  const p = join(SRC, name);
  if (!existsSync(p)) { missing.push(name); return `/* CHYBÍ: ${name} */`; }
  return readFileSync(p, 'utf8').replace(/\s+$/, '');
}
const banner = (n) => `\n/* ======================= ${n} ======================= */\n`;
const bannerCss = banner;

const head = HEAD_HTML.map(read).join('\n');
const css = CSS.map(n => `/* === ${n} === */\n` + read(n)).join('\n\n');
const body = BODY_HTML.map(read).join('\n\n');
const js = JS.map(n => banner(n) + read(n)).join('\n');

// Syntaktická kontrola každého fragmentu zvlášť. Bez ní projde build i
// s rozbitým souborem a chyba se objeví až v prohlížeči jako prázdná appka.
const syntaxErrors = [];
for (const name of JS) {
  const code = read(name);
  if (code.startsWith('/* CHYBÍ')) continue;
  try { new Function(code); }
  catch (e) { syntaxErrors.push(name + ': ' + e.message); }
}

const html = `<!doctype html>
<html lang="cs">
<head>
${head}
<style>
${css}
</style>
</head>
<body>
${body}
<script>
"use strict";
(function () {
${js}
})();
<\/script>
</body>
</html>
`;

writeFileSync(OUT, html, 'utf8');
const kb = (statSync(OUT).size / 1024).toFixed(1);
console.log(`rozpocet.html  ${kb} kB  (${html.split('\n').length} řádků)`);
if (missing.length) {
  console.log('CHYBÍ fragmenty: ' + missing.join(', '));
}
if (syntaxErrors.length) {
  console.log('SYNTAKTICKÁ CHYBA:\n  ' + syntaxErrors.join('\n  '));
  process.exitCode = 1;
}
