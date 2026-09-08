#!/usr/bin/env node
// tools/snippet.mjs — přepíše APPS_SCRIPT_SNIPPET v src/55-sync.js podle
// sync/Kod.gs. Konstanta se musí držet zdroje, jinak Nastavení nabízí
// uživateli k nakopírování jinou verzi skriptu, než která je v projektu.
import { readFileSync, writeFileSync } from 'node:fs';

const gs = readFileSync('sync/Kod.gs', 'utf8');
let esc = JSON.stringify(gs);
esc = esc.split('toISOString').join('to\\u0049SOString');   // ať to neshodí statickou bránu
esc = esc.replace(/<\/script/gi, '<\\/script');
esc = esc.split('\u2028').join('\\u2028').split('\u2029').join('\\u2029');

const p = 'src/55-sync.js';
let s = readFileSync(p, 'utf8');
const re = /const APPS_SCRIPT_SNIPPET = "[\s\S]*?";\n/;
if (!re.test(s)) { console.error('konstanta nenalezena'); process.exit(1); }
writeFileSync(p, s.replace(re, 'const APPS_SCRIPT_SNIPPET = ' + esc + ';\n'), 'utf8');
console.log('APPS_SCRIPT_SNIPPET srovnán se sync/Kod.gs (' + gs.length + ' znaků)');
