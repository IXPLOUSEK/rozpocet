import { createRequire } from 'node:module';
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
const r = createRequire(import.meta.url);
let pw; try { pw = r('playwright'); } catch (e) {
  const npx='/home/ixp/.npm/_npx'; const c=[];
  for (const d of readdirSync(npx)) { const p=npx+'/'+d+'/node_modules/playwright'; if (existsSync(p+'/package.json')) c.push(p); }
  c.sort((a,b)=>r(b+'/package.json').version.localeCompare(r(a+'/package.json').version,'en',{numeric:true}));
  pw = r(c[0]);
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
const srv=createServer((req,res)=>{const rel=decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'')||'rozpocet.html';
 try{const f=join(process.cwd(),rel); if(!statSync(f).isFile())throw 0;
 res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});res.end(readFileSync(f));}catch(e){res.writeHead(404);res.end('404');}});
await new Promise(x=>srv.listen(0,'127.0.0.1',x));
const PORT=srv.address().port;
const b=await (process.argv.includes('--webkit')?pw.webkit:pw.chromium).launch().catch(()=>pw.chromium.launch({executablePath:'/usr/bin/google-chrome'}));
const doc=JSON.parse(readFileSync('test/fixtures/realistic-year.json','utf8'));
const ctx=await b.newContext({...pw.devices['iPhone 15'],locale:'cs-CZ',timezoneId:'Europe/Prague'});
await ctx.addInitScript(d=>{try{localStorage.setItem('rozpocet:doc',JSON.stringify(d.doc||d));}catch(e){}},doc);
const p=await ctx.newPage();
await p.goto(`http://127.0.0.1:${PORT}/rozpocet.html`,{waitUntil:'load'});
await p.waitForTimeout(500);

await p.click('#tabbar .tab[data-screen="savings"]');
await p.waitForTimeout(600);

console.log('--- A: mini sloupce u cíle ---');
console.log(await p.evaluate(()=>{
  const host=document.querySelector('.goal-months');
  if(!host) return 'žádný .goal-months';
  const svg=host.querySelector('svg');
  const rects=Array.from(host.querySelectorAll('rect')).slice(0,4).map(x=>({
    fill:x.getAttribute('fill'), computed:getComputedStyle(x).fill,
    h:x.getAttribute('height'), y:x.getAttribute('y')}));
  return {maHost:!!host, maSvg:!!svg, viewBox:svg&&svg.getAttribute('viewBox'),
    hostH:host.getBoundingClientRect().height, rects,
    tokenCat1:getComputedStyle(document.documentElement).getPropertyValue('--cat-1'),
    tokenAccent:getComputedStyle(document.documentElement).getPropertyValue('--accent')};
}));

console.log('--- B: zvýraznění záložek ---');
console.log(await p.evaluate(()=>Array.from(document.querySelectorAll('#tabbar .tab')).map(t=>({
  scr:t.dataset.screen, active:t.classList.contains('is-active'),
  aria:t.getAttribute('aria-current'), color:getComputedStyle(t).color,
  lblColor:getComputedStyle(t.querySelector('.tab-lbl')).color,
  weight:getComputedStyle(t.querySelector('.tab-lbl')).fontWeight}))));

await p.waitForTimeout(2000);
console.log('--- B3: barva po 2 s ---');
console.log(await p.evaluate(()=>Array.from(document.querySelectorAll('#tabbar .tab')).map(t=>t.dataset.screen+' '+getComputedStyle(t).color+' active='+t.classList.contains('is-active')).join(' | ')));
console.log('--- B2: co barví neaktivní záložku ---');
console.log(JSON.stringify(await p.evaluate(()=>{
  const t=document.querySelector('#tabbar .tab[data-screen="month"]');
  const out={cls:t.className, inline:t.getAttribute('style')||null, matched:[]};
  for(const sheet of document.styleSheets){ let rules; try{rules=sheet.cssRules}catch(e){continue}
    for(const r of rules){ if(!r.selectorText) continue;
      try{ if(t.matches(r.selectorText)&&r.style.color) out.matched.push(r.selectorText+' -> '+r.style.color); }catch(e){} } }
  return out;
}),null,1));

console.log('--- C: zalomení částky v ročním KPI ---');
await p.click('#tabbar .tab[data-screen="year"]'); await p.waitForTimeout(400);
console.log(await p.evaluate(()=>Array.from(document.querySelectorAll('#screen-year .kpi-value')).map(n=>({
  text:n.textContent, w:Math.round(n.getBoundingClientRect().width),
  h:Math.round(n.getBoundingClientRect().height),
  wrap:getComputedStyle(n).overflowWrap, ws:getComputedStyle(n).whiteSpace,
  wordBreak:getComputedStyle(n).wordBreak, fs:getComputedStyle(n).fontSize}))));

console.log('--- E: struktura ročního KPI ---');
console.log(JSON.stringify(await p.evaluate(()=>{
  const v=document.querySelector('#screen-year .kpi-value');
  const tile=v.closest('.kpi'); const row=tile.parentElement;
  return {rowCls:row.className, rowInline:row.getAttribute('style'),
    rowCols:getComputedStyle(row).gridTemplateColumns, rowDisplay:getComputedStyle(row).display,
    tileCls:tile.className, tileW:Math.round(tile.getBoundingClientRect().width),
    valCls:v.className, valFs:getComputedStyle(v).fontSize, valWrap:getComputedStyle(v).overflowWrap};
}),null,1));
console.log('--- D: překrývá FAB obsah? ---');
await p.click('#tabbar .tab[data-screen="journal"]'); await p.waitForTimeout(400);
console.log(await p.evaluate(()=>{
  const fab=document.querySelector('#fab').getBoundingClientRect();
  const main=document.querySelector('#main');
  const cs=getComputedStyle(main);
  const last=Array.from(document.querySelectorAll('#screen-journal .tx')).pop();
  return {fab:{x:Math.round(fab.x),y:Math.round(fab.y),w:Math.round(fab.width)},
    mainPadBottom:cs.paddingBottom, scrollPadBottom:cs.scrollPaddingBottom,
    posledniZapisY: last?Math.round(last.getBoundingClientRect().y):null};
}));
await b.close(); srv.close();
