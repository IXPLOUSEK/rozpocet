import { createRequire } from 'node:module';
import { readdirSync, existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
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
const ctx=await browser.newContext({...pw.devices['iPhone 15'],locale:'cs-CZ',timezoneId:'Europe/Prague'});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
let pass=0,fail=0; const ok=(n,c,d)=>{c?pass++:(fail++,console.log('FAIL  '+n+(d!==undefined?'  '+d:'')));};
mkdirSync('test/artefakty',{recursive:true});

await p.goto(`http://127.0.0.1:${PORT}/rozpocet.html`,{waitUntil:'load'});
await p.waitForTimeout(900);
ok('bez chyb při prvním spuštění', errs.length===0, errs.slice(0,3).join(' | '));
ok('uvítací panel se ukáže', await p.locator('#sheet-host .sheet').count()===1);
await p.screenshot({path:'test/artefakty/prvni-spusteni.png'});

const txt=await p.locator('#sheet-host .sheet').innerText().catch(()=>'');
ok('nabízí obě cesty', /Doporučené kategorie/.test(txt) && /Začít od nuly/.test(txt), txt.slice(0,90).replace(/\n/g,' / '));

// úložiště musí zůstat netknuté, dokud uživatelka neklepne
const untouched = await p.evaluate(()=>{ try { return localStorage.length; } catch(e){ return -1; } });
ok('úložiště je před prvním klepnutím prázdné', untouched===0, 'klíčů: '+untouched);

// volba "doporučené kategorie"
await p.locator('#sheet-host .btn-primary').first().click();
await p.waitForTimeout(700);
const seeded = await p.evaluate(()=>{
  const A=window.__APP__, s=A.state(), y=s.years[String(s.activeYear)];
  const md=A.computeMonth(s.activeYear, s.ui.month);
  return {kategorii:y.catalog.length, nakupu:y.tx.length, prijmy:md.incomeTotal, vydaje:md.outflow, zustatek:md.balance};
});
ok('kategorie se založily', seeded.kategorii>15, JSON.stringify(seeded));
ok('ale všechny částky jsou nulové', seeded.prijmy===0 && seeded.vydaje===0 && seeded.zustatek===0, JSON.stringify(seeded));
ok('žádné nákupy', seeded.nakupu===0);
await p.waitForTimeout(400);
await p.screenshot({path:'test/artefakty/po-zalozeni.png'});
ok('pořád bez chyb', errs.length===0, errs.slice(0,3).join(' | '));

console.log((fail?'FAIL':'PASS')+' '+pass+'/'+(pass+fail));
await browser.close(); srv.close();
process.exit(fail?1:0);
