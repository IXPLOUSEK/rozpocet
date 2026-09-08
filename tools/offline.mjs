// tools/offline.mjs — appka na ploše musí naběhnout i bez signálu.
// Bez service workeru iOS v tomhle případě ukáže "nejsi připojen".
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
// Servírujeme jako index.html — přesně tak, jak to bude na GitHub Pages.
const srv=createServer((req,res)=>{
  let rel=decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'');
  if (rel==='' || rel==='index.html') rel='rozpocet.html';
  try{const f=join(process.cwd(),rel); if(!statSync(f).isFile())throw 0;
    res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});res.end(readFileSync(f));}
  catch(e){res.writeHead(404);res.end('404');}});
await new Promise(x=>srv.listen(0,'127.0.0.1',x));
const PORT=srv.address().port;
const wantWebkit=process.argv.includes('--webkit');
let browser; try{ browser=await (wantWebkit?pw.webkit:pw.chromium).launch(); }
catch(e){ browser=await pw.chromium.launch({executablePath:'/usr/bin/google-chrome'}); }
const ctx=await browser.newContext({...pw.devices['iPhone 15'],locale:'cs-CZ',timezoneId:'Europe/Prague'});
const p=await ctx.newPage();
let pass=0,fail=0;
const ok=(n,c,d)=>{c?pass++:(fail++,console.log('FAIL  '+n+(d!==undefined?'  '+d:'')));};

await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'load'});
await p.waitForTimeout(1200);
const swReady = await p.evaluate(()=>navigator.serviceWorker
  ? navigator.serviceWorker.ready.then(r=>!!(r&&r.active)).catch(()=>false) : false);
ok('service worker je aktivní', swReady===true, String(swReady));

// něco zapsat, ať je co ověřit po restartu
await p.evaluate(()=>{
  const A=window.__APP__, st=A.state();
  const y=st.years[String(st.activeYear)];
  y.catalog.push({id:'c_off',sec:'daily',name:'Test offline',icon:'🛒',order:10,recurring:true,
    dueDay:null,goal:null,archived:false,createdAt:new Date().toJSON(),updatedAt:new Date().toJSON()});
  y.months[st.ui.month].entries.push({id:'e_off',cat:'c_off',plan:123400,act:null,paid:false,
    paidAt:null,due:null,autoFilled:false,del:false,updatedAt:new Date().toJSON()});
  st.rev++; A.saveNow(); A.render();
});
await p.waitForTimeout(400);

await ctx.setOffline(true);
await p.waitForTimeout(200);
let loaded=true;
try { await p.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'load',timeout:15000}); }
catch(e){ loaded=false; }
ok('appka naběhne i bez sítě', loaded===true);
await p.waitForTimeout(800);

if (loaded) {
  ok('je to opravdu naše appka', await p.locator('#app').count()===1);
  const keep = await p.evaluate(()=>{
    const A=window.__APP__; if(!A) return null;
    const st=A.state(); const y=st.years[String(st.activeYear)];
    const e=y.months[st.ui.month].entries.find(x=>x.id==='e_off');
    return e ? e.plan : null;
  });
  ok('data přežila restart bez sítě', keep===123400, String(keep));
  const err = await p.evaluate(()=>(document.body.innerText||'').slice(0,200));
  ok('nikde chybová hláška o připojení', !/nejsi p|not connected|offline/i.test(err), err.slice(0,60));
}

await ctx.setOffline(false);
console.log((fail?'FAIL':'PASS')+' '+pass+'/'+(pass+fail));
await browser.close(); srv.close();
process.exit(fail?1:0);
