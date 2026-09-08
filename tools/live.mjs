// tools/live.mjs — ověření nasazené adresy. Bez lokálního serveru:
// testuje se přesně to, co uvidí ona.
import { createRequire } from 'node:module';
import { readdirSync, existsSync } from 'node:fs';
const r = createRequire(import.meta.url);
let pw; try { pw = r('playwright'); } catch (e) {
  const npx='/home/ixp/.npm/_npx'; const c=[];
  for (const d of readdirSync(npx)) { const p=npx+'/'+d+'/node_modules/playwright'; if (existsSync(p+'/package.json')) c.push(p); }
  c.sort((a,b)=>r(b+'/package.json').version.localeCompare(r(a+'/package.json').version,'en',{numeric:true}));
  pw=r(c[0]);
}
const URL_ = process.argv.find(a => a.startsWith('http')) || 'https://ixplousek.github.io/rozpocet/';
let b; try{b=await (process.argv.includes('--webkit')?pw.webkit:pw.chromium).launch();}
catch(e){b=await pw.chromium.launch({executablePath:'/usr/bin/google-chrome'});}
const ctx=await b.newContext({...pw.devices['iPhone 15'],locale:'cs-CZ',timezoneId:'Europe/Prague'});
const p=await ctx.newPage();
const errs=[], reqs=[];
p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/interactive-widget/i.test(m.text())) errs.push('console: '+m.text()); });
p.on('response',res=>reqs.push(res.status()+' '+res.url()));
let pass=0,fail=0;
const ok=(n,c,d)=>{c?pass++:(fail++,console.log('FAIL  '+n+(d!==undefined?'  '+d:'')));};

console.log('adresa: ' + URL_);
const resp = await p.goto(URL_, {waitUntil:'load', timeout:45000}).catch(e=>null);
ok('stránka se načte', !!resp && resp.status()===200, resp ? String(resp.status()) : 'bez odpovědi');
await p.waitForTimeout(1500);

ok('žádná chyba', errs.length===0, errs.slice(0,3).join(' | '));
ok('je to Rozpočet', (await p.title())==='Rozpočet', await p.title());
ok('appka naběhla', await p.locator('#app').count()===1);
ok('__APP__ existuje', await p.evaluate(()=>!!window.__APP__));
ok('úložiště funguje', await p.evaluate(()=>window.__APP__ && window.__APP__.storageOk===true));
ok('startuje prázdná', await p.evaluate(()=>{const s=window.__APP__.state();
  const y=s.years[String(s.activeYear)]; return y.catalog.length===0 && y.tx.length===0;}));
ok('12 měsíců', await p.locator('#month-strip .chip-month').count()===12);
ok('žádné cizí volání', reqs.every(u=>/github\.io|data:/.test(u.split(' ')[1])),
   reqs.filter(u=>!/github\.io|data:/.test(u.split(' ')[1])).slice(0,2).join(' | '));

const sw = await p.evaluate(()=>navigator.serviceWorker
  ? navigator.serviceWorker.ready.then(r=>!!(r&&r.active)).catch(()=>false) : false);
ok('service worker je aktivní', sw===true, String(sw));

const st = await p.evaluate(()=>window.__APP__.selfTest());
ok('vlastní kontrola ('+st.pass+'/'+(st.pass+st.fail)+')', st.fail===0);

// offline po instalaci
await ctx.setOffline(true);
const znovu = await p.goto(URL_,{waitUntil:'load',timeout:20000}).catch(()=>null);
ok('funguje i bez sítě', !!znovu, 'bez odpovědi');
await ctx.setOffline(false);

console.log((fail?'FAIL':'PASS')+' '+pass+'/'+(pass+fail));
await b.close();
process.exit(fail?1:0);
