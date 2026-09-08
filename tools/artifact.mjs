#!/usr/bin/env node
// tools/artifact.mjs — varianta pro publikaci jako Claude Artifact.
// Publikační obal si dodává vlastní <!doctype>, <html>, <head> a <body>,
// takže se posílá jen obsah: <title>, <style>, značkování a skript.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync('rozpocet.html', 'utf8');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>') + 8);
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
mkdirSync('dist', { recursive: true });
const out = '<title>Rozpočet</title>\n' + style + '\n' + body.trim() + '\n';
writeFileSync('dist/artifact.html', out, 'utf8');
console.log('dist/artifact.html  ' + (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1) + ' kB');
