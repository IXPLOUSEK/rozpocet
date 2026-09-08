#!/usr/bin/env node
// tools/release.mjs — složí, zkontroluje a připraví balíček k předání.
import { execFileSync } from 'node:child_process';
import { existsSync, renameSync, rmSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';

const run = (cmd, args) => {
  try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8' }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
};

console.log('1) build');
const b = run('node', ['build.mjs']);
process.stdout.write('   ' + b.out.trim().split('\n').join('\n   ') + '\n');
if (!b.ok) process.exit(1);

console.log('2) úklid vývojových zbytků z kořene');
for (const junk of ['node_modules', 'light-390.png', 'dark-390.png', '.playwright']) {
  if (existsSync(junk)) {
    const st = statSync(junk);
    if (st.isDirectory() && readdirSync(junk).length === 0) { rmSync(junk, { recursive: true }); console.log('   smazán prázdný ' + junk); }
    else if (!st.isDirectory()) { rmSync(junk); console.log('   smazán ' + junk); }
    else console.log('   PONECHÁN neprázdný ' + junk + ' — zkontroluj ručně');
  }
}
// Screenshoty z testů patří do test/, ne do kořene.
for (const f of readdirSync('.')) {
  if (/\.(png|jpg|jpeg|webp)$/i.test(f)) {
    mkdirSync('test/artefakty', { recursive: true });
    renameSync(f, 'test/artefakty/' + f);
    console.log('   přesunut ' + f + ' -> test/artefakty/');
  }
}

console.log('3) návody do kořene');
for (const f of ['NASAZENI.md', 'NAVOD-pro-ni.md']) {
  if (existsSync('docs/' + f)) { copyFileSync('docs/' + f, f); console.log('   ' + f); }
  else console.log('   CHYBÍ docs/' + f);
}

console.log('4) statické brány');
const g = run('node', ['tools/gate.mjs']);
process.stdout.write('   ' + g.out.trim().split('\n').join('\n   ') + '\n');

console.log('5) balíček pro ni');
mkdirSync('dist', { recursive: true });
copyFileSync('rozpocet.html', 'dist/index.html');   // GitHub Pages chce index.html
copyFileSync('rozpocet.html', 'dist/rozpocet.html');
copyFileSync('sw.js', 'dist/sw.js');
for (const f of ['NAVOD-pro-ni.md', 'NASAZENI.md']) if (existsSync(f)) copyFileSync(f, 'dist/' + f);
const kb = (statSync('dist/index.html').size / 1024).toFixed(1);
console.log('   dist/index.html  ' + kb + ' kB');
console.log('   dist/sw.js, dist/rozpocet.html, návody');

console.log(g.ok ? '\nHOTOVO — brány prošly.' : '\nPOZOR — brány nahlásily problém, viz výš.');
process.exit(g.ok ? 0 : 1);
