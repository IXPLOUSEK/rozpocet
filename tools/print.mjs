// tools/print.mjs — tisk. page.pdf() umí jen Chromium, takže tenhle test
// jede tam; WebKit se ověřuje jen na CSS přes emulateMedia('print').
import { createRequire } from 'node:module';
import { readdirSync, existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
let browser; try { browser = await pw.chromium.launch(); }
catch(e){ browser = await pw.chromium.launch({executablePath:'/usr/bin/google-chrome'}); }
const doc=JSON.parse(readFileSync('test/fixtures/realistic-year.json','utf8'));
const ctx=await browser.newContext({locale:'cs-CZ',timezoneId:'Europe/Prague',viewport:{width:1280,height:900}});
await ctx.addInitScript(d=>{try{localStorage.setItem('rozpocet:doc',JSON.stringify(d.doc||d));}catch(e){}},doc);
const p=await ctx.newPage();
let pass=0,fail=0;
const ok=(n,c,d)=>{c?pass++:(fail++,console.log('FAIL  '+n+(d!==undefined?'  '+d:'')));};
await p.goto(`http://127.0.0.1:${PORT}/rozpocet.html`,{waitUntil:'load'});
await p.waitForTimeout(600);

// vyrobit tiskovou obrazovku
// Tisk se spouští tlačítkem, ne z konzole — funkce žijí uvnitř IIFE.
// window.print() se v testu zneškodní, jinak by Chromium čekal na dialog.
await p.addInitScript(()=>{ window.print = function(){ window.__printCalled = true; }; });
await p.reload({waitUntil:'load'}); await p.waitForTimeout(600);
const btn = p.locator('[data-act="io.print"]').first();
ok('tlačítko Tisk existuje', await btn.count()>0);
if (await btn.count()>0) { await btn.click(); await p.waitForTimeout(700); }
const built = await p.evaluate(()=>{
  const n=document.querySelector('#screen-print');
  return !!(n && n.children.length>0 && (n.innerText||'').length>50);
});
ok('tisková obrazovka se vyrobila', built===true, String(built));

await p.emulateMedia({media:'print'});
await p.waitForTimeout(300);
const bad = await p.evaluate(()=>{
  const out=[];
  for (const sel of ['html','body','#app','#main','.screen','.sec-rows']) {
    for (const n of document.querySelectorAll(sel)) { const cs=getComputedStyle(n);
      if (n.hidden || cs.display==='none') continue;   // skryté obrazovky se netisknou tak jako tak
      if (cs.overflow!=='visible'||cs.maxHeight!=='none') out.push(sel+':'+cs.overflow+'/'+cs.maxHeight); } }
  return out.slice(0,4);
});
ok('v tisku se nic neroluje', bad.length===0, bad.join(' | '));
const hidden = await p.evaluate(()=>['.app-header','.tabbar','.fab','.month-strip','.no-print']
  .filter(s=>{const n=document.querySelector(s); return n && getComputedStyle(n).display!=='none';}));
ok('ovládání se netiskne', hidden.length===0, hidden.join(' '));

mkdirSync('test/artefakty',{recursive:true});
const pdfPath='test/artefakty/mesic.pdf';
await p.pdf({path:pdfPath,format:'A4',printBackground:true});
await p.emulateMedia({media:'screen'});

const info=execFileSync('pdfinfo',[pdfPath],{encoding:'utf8'});
const pages=Number((/Pages:\s+(\d+)/.exec(info)||[])[1]||0);
ok('PDF má víc než jednu stránku', pages>1, 'stránek: '+pages);
const txt=execFileSync('pdftotext',[pdfPath,'-'],{encoding:'utf8'});
ok('v PDF není NaN ani [object Object]', !/\b(NaN|Infinity|\[object Object\]|undefined)\b/.test(txt),
   (txt.match(/\b(NaN|Infinity|\[object Object\]|undefined)\b/g)||[]).slice(0,3).join(','));
ok('PDF obsahuje název měsíce', /Září|Leden|Únor|Březen|Duben|Květen|Červen|Červenec|Srpen|Říjen|Listopad|Prosinec/.test(txt));
ok('PDF obsahuje sekce rozpočtu', /PŘÍJMY/i.test(txt)&&/FIXNÍ/i.test(txt), txt.slice(0,80).replace(/\n/g,' '));
ok('PDF obsahuje částky v Kč', /Kč/.test(txt));

// Tisk celého roku
await p.goto(`http://127.0.0.1:${PORT}/rozpocet.html`,{waitUntil:'load'});
await p.addInitScript(()=>{ window.print=function(){window.__printCalled=true;}; });
await p.reload({waitUntil:'load'}); await p.waitForTimeout(600);
await p.click('#tabbar .tab[data-screen="more"]'); await p.waitForTimeout(400);
const yb = p.locator('[data-act="io.printYear"]').first();
ok('tlačítko Tisk celého roku existuje', await yb.count()>0);
if (await yb.count()>0) {
  await yb.click(); await p.waitForTimeout(1500);
  await p.emulateMedia({media:'print'});
  const pdfY='test/artefakty/rok.pdf';
  await p.pdf({path:pdfY,format:'A4',printBackground:true});
  await p.emulateMedia({media:'screen'});
  const infoY=execFileSync('pdfinfo',[pdfY],{encoding:'utf8'});
  const pagesY=Number((/Pages:\s+(\d+)/.exec(infoY)||[])[1]||0);
  ok('roční sestava má aspoň 12 stránek', pagesY>=12, 'stránek: '+pagesY);
  const txtY=execFileSync('pdftotext',[pdfY,'-'],{encoding:'utf8'});
  const chybi=['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec']
    .filter(mn=>!txtY.includes(mn));
  ok('roční sestava obsahuje všech dvanáct měsíců', chybi.length===0, 'chybí: '+chybi.join(', '));
  ok('roční sestava bez NaN', !/\b(NaN|Infinity|\[object Object\]|undefined)\b/.test(txtY));
}

console.log((fail?'FAIL':'PASS')+' '+pass+'/'+(pass+fail)+'   ('+pages+' stránek za měsíc)');
await browser.close(); srv.close();
process.exit(fail?1:0);
