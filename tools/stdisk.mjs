// Ověření, že vlastní kontrola nezapíše svůj pískovištní rok na disk.
import { createRequire } from 'node:module';
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
const r = createRequire(import.meta.url);
let pw; try { pw = r('playwright'); } catch (e) {
  const npx='/home/ixp/.npm/_npx'; const c=[];
  for (const d of readdirSync(npx)) { const p=npx+'/'+d+'/node_modules/playwright'; if (existsSync(p+'/package.json')) c.push(p); }
  c.sort((a,b)=>r(b+'/package.json').version.localeCompare(r(a+'/package.json').version,'en',{numeric:true}));
  pw=r(c[0]);
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
const srv=createServer((q,s)=>{let rel=decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,'')||'rozpocet.html';
 try{const f=join(process.cwd(),rel); if(!statSync(f).isFile())throw 0;
 s.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});s.end(readFileSync(f));}catch(e){s.writeHead(404);s.end('404');}});
await new Promise(x=>srv.listen(0,'127.0.0.1',x));
const P=srv.address().port;
let b; try{b=await (process.argv.includes('--webkit')?pw.webkit:pw.chromium).launch();}catch(e){b=await pw.chromium.launch({executablePath:'/usr/bin/google-chrome'});}
const doc=JSON.parse(readFileSync('test/fixtures/realistic-year.json','utf8'));
const ctx=await b.newContext({...pw.devices['iPhone 15'],locale:'cs-CZ',timezoneId:'Europe/Prague'});
await ctx.addInitScript(d=>{try{localStorage.setItem('rozpocet:doc',JSON.stringify(d.doc||d));}catch(e){}},doc);
const p=await ctx.newPage();
await p.goto(`http://127.0.0.1:${P}/rozpocet.html`,{waitUntil:'load'});
await p.waitForTimeout(600);
let pass=0,fail=0; const ok=(n,c,d)=>{c?pass++:(fail++,console.log('FAIL  '+n+(d!==undefined?'  '+d:'')));};

// Nastražit debounce tak, aby při dalším bumpu vystřelil synchronně.
await p.evaluate(()=>{ const A=window.__APP__, st=A.state();
  st.settings.dueSoonDays = st.settings.dueSoonDays === 7 ? 8 : 7;   // vyvolá scheduleSave
});
await p.waitForTimeout(3200);   // překročit maxWait, aby další volání šlo hned

const res = await p.evaluate(()=>{
  const A=window.__APP__;
  const r = A.selfTest();
  const st = A.state();
  let disk = null;
  try { disk = JSON.parse(localStorage.getItem('rozpocet:doc')||'null'); } catch(e){}
  return { pass:r.pass, fail:r.fail, pametRok: st.activeYear, pametRoky: Object.keys(st.years),
           diskRok: disk && disk.activeYear, diskRoky: disk ? Object.keys(disk.years) : [] };
});
ok('vlastní kontrola prošla ('+res.pass+' tvrzení)', res.fail===0);
ok('v paměti není rok 1900', res.pametRoky.indexOf('1900')<0, res.pametRoky.join(','));
ok('na disku není rok 1900', res.diskRoky.indexOf('1900')<0, res.diskRoky.join(','));
ok('aktivní rok v paměti sedí', res.pametRok!==1900, String(res.pametRok));
ok('aktivní rok na disku sedí', res.diskRok!==1900, String(res.diskRok));

// a po obnovení stránky taky
await p.reload({waitUntil:'load'}); await p.waitForTimeout(600);
const po = await p.evaluate(()=>{const st=window.__APP__.state();
  return {rok:st.activeYear, roky:Object.keys(st.years)};});
ok('po obnovení stránky žádný rok 1900', po.roky.indexOf('1900')<0 && po.rok!==1900, JSON.stringify(po));

console.log((fail?'FAIL':'PASS')+' '+pass+'/'+(pass+fail));
await b.close(); srv.close();
process.exit(fail?1:0);
