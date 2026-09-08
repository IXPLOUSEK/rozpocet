// tools/claims.mjs — ověření tvrzení třetího verifikátora měřením.
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
const srv=createServer((req,res)=>{let rel=decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'')||'rozpocet.html';
 try{const f=join(process.cwd(),rel); if(!statSync(f).isFile())throw 0;
 res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});res.end(readFileSync(f));}catch(e){res.writeHead(404);res.end('404');}});
await new Promise(x=>srv.listen(0,'127.0.0.1',x));
const PORT=srv.address().port;
let browser; try{browser=await (process.argv.includes('--webkit')?pw.webkit:pw.chromium).launch();}
catch(e){browser=await pw.chromium.launch({executablePath:'/usr/bin/google-chrome'});}
const doc=JSON.parse(readFileSync('test/fixtures/realistic-year.json','utf8'));
const ctx=await browser.newContext({...pw.devices['iPhone 15'],locale:'cs-CZ',timezoneId:'Europe/Prague'});
await ctx.addInitScript(d=>{try{localStorage.setItem('rozpocet:doc',JSON.stringify(d.doc||d));}catch(e){}},doc);
const p=await ctx.newPage();
await p.goto(`http://127.0.0.1:${PORT}/rozpocet.html`,{waitUntil:'load'});
await p.waitForTimeout(600);
const R={};

// 1) #app overflow a lepivost hlavičky
R.tvrzeni1 = await p.evaluate(()=>{
  const app=document.querySelector('#app'), main=document.querySelector('#main');
  return {appOverflow:getComputedStyle(app).overflow, mainOverflow:getComputedStyle(main).overflow,
    headerPos:getComputedStyle(document.querySelector('.app-header')).position,
    headerParent:document.querySelector('.app-header').parentElement.id};
});
await p.evaluate(()=>{const m=document.querySelector('#main'); m.scrollTop=1200;});
await p.waitForTimeout(300);
R.tvrzeni1.headerYpo1200 = await p.evaluate(()=>Math.round(document.querySelector('.app-header').getBoundingClientRect().y));
R.tvrzeni1.stripYpo1200 = await p.evaluate(()=>Math.round(document.querySelector('#month-strip').getBoundingClientRect().y));

// 3) písmo v textareách uvnitř panelů
await p.click('#tabbar .tab[data-screen="more"]'); await p.waitForTimeout(400);
R.tvrzeni3 = await p.evaluate(()=>{
  const out=[]; document.querySelectorAll('textarea, input, select').forEach(n=>{
    const fs=parseFloat(getComputedStyle(n).fontSize);
    if (fs<16) out.push((n.className||n.tagName)+' '+fs+'px'); });
  return out;
});
// vynutit zobrazení kopírovacího panelu, pokud existuje
R.tvrzeni3b = await p.evaluate(()=>{
  const css=[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules]}catch(e){return []}})
    .filter(x=>x.selectorText&&/copy-box|code-block/.test(x.selectorText)&&x.style.fontSize)
    .map(x=>x.selectorText+' -> '+x.style.fontSize);
  return css;
});

// 4) dotykové cíle
R.tvrzeni4 = await p.evaluate(()=>{
  const bad=[];
  document.querySelectorAll('button, a, input[type=checkbox], label').forEach(n=>{
    const r=n.getBoundingClientRect();
    if (r.width===0&&r.height===0) return;
    if (r.width<44||r.height<44) bad.push((n.className||n.tagName).toString().slice(0,30)+' '+Math.round(r.width)+'x'+Math.round(r.height));
  });
  return bad.slice(0,10);
});

// 5) reduced motion
R.tvrzeni5 = await p.evaluate(()=>{
  const css=[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules]}catch(e){return []}})
    .filter(x=>x.conditionText&&/reduced-motion/.test(x.conditionText))
    .flatMap(x=>[...x.cssRules].map(y=>y.cssText));
  return css;
});

// 6) tisk: je #screen-print v odrolovacím resetu?
R.tvrzeni6 = await p.evaluate(()=>{
  const css=[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules]}catch(e){return []}})
    .filter(x=>x.media&&/print/.test(x.conditionText||''))
    .flatMap(x=>[...x.cssRules].filter(y=>y.selectorText&&/height/.test(y.cssText)).map(y=>y.selectorText));
  return css.slice(0,6);
});

console.log(JSON.stringify(R,null,1));
await browser.close(); srv.close();
