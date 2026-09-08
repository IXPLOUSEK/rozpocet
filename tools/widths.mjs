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
let pass=0,fail=0;
const ok=(n,c,d)=>{c?pass++:(fail++,console.log('FAIL  '+n+(d!==undefined?'  '+d:'')));};
for (const fx of ['realistic-year','adversarial']) {
  const doc=JSON.parse(readFileSync('test/fixtures/'+fx+'.json','utf8'));
  for (const w of [320,375,393,430,768,1024]) {
    const ctx=await browser.newContext({viewport:{width:w,height:800},deviceScaleFactor:2,isMobile:w<700,hasTouch:w<700,locale:'cs-CZ',timezoneId:'Europe/Prague'});
    await ctx.addInitScript(d=>{try{localStorage.setItem('rozpocet:doc',JSON.stringify(d.doc||d));}catch(e){}},doc);
    const p=await ctx.newPage();
    await p.goto(`http://127.0.0.1:${PORT}/rozpocet.html`,{waitUntil:'load'});
    await p.waitForTimeout(500);
    for (const scr of ['month','year','journal','savings','more']) {
      await p.click(`#tabbar .tab[data-screen="${scr}"]`).catch(()=>{});
      await p.waitForTimeout(250);
      const over=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
      const culprit = over>1 ? await p.evaluate(()=>{
        const W=window.innerWidth; let worst=null,max=0;
        document.querySelectorAll('*').forEach(n=>{const r=n.getBoundingClientRect();
          if(r.right>W+1 && r.width>max){max=r.width;worst=n.tagName+'.'+(n.className||'').toString().slice(0,40)+' right='+Math.round(r.right);}});
        return worst;
      }) : null;
      ok(fx+' '+w+'px '+scr, over<=1, 'přesah '+over+'px '+(culprit||''));
    }
    await ctx.close();
  }
}
console.log((fail?'FAIL':'PASS')+' '+pass+'/'+(pass+fail));
await browser.close(); srv.close();
process.exit(fail?1:0);
