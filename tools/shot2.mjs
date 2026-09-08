import { createRequire } from 'node:module';
import { readdirSync, existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
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
mkdirSync('test/artefakty',{recursive:true});
const ctx=await b.newContext({...pw.devices['iPhone 15'],locale:'cs-CZ',timezoneId:'Europe/Prague',colorScheme:'dark'});
await ctx.addInitScript(d=>{try{localStorage.setItem('rozpocet:doc',JSON.stringify(d.doc||d));}catch(e){}},doc);
const p=await ctx.newPage();
await p.goto(`http://127.0.0.1:${P}/rozpocet.html`,{waitUntil:'load'});
await p.waitForTimeout(700);
for (const sec of ['income','debt']) {
  const btn=p.locator(`#screen-month .sec-card[data-sec="${sec}"] .sec-add`).first();
  await btn.scrollIntoViewIfNeeded(); await btn.click(); await p.waitForTimeout(500);
  const sheet=p.locator('#sheet-host .sheet');
  await sheet.screenshot({path:`test/artefakty/pridat-${sec}.png`});
  await p.evaluate(()=>{const x=document.querySelector('.sheet-close'); if(x)x.click();});
  await p.waitForTimeout(350);
}
console.log('snímky dialogů hotové');
await b.close(); srv.close();
