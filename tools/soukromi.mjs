// tools/soukromi.mjs — důkaz, že data neopouštějí zařízení.
// Testuje se NASAZENÁ adresa, ne lokální kopie.
import { createRequire } from 'node:module';
import { readdirSync, existsSync } from 'node:fs';
const r = createRequire(import.meta.url);
let pw; try { pw = r('playwright'); } catch (e) {
  const npx='/home/ixp/.npm/_npx'; const c=[];
  for (const d of readdirSync(npx)) { const p=npx+'/'+d+'/node_modules/playwright'; if (existsSync(p+'/package.json')) c.push(p); }
  c.sort((a,b)=>r(b+'/package.json').version.localeCompare(r(a+'/package.json').version,'en',{numeric:true}));
  pw=r(c[0]);
}
const URL_ = process.argv.find(a=>a.startsWith('http')) || 'https://ixplousek.github.io/rozpocet/';
let b; try{b=await (process.argv.includes('--webkit')?pw.webkit:pw.chromium).launch();}
catch(e){b=await pw.chromium.launch({executablePath:'/usr/bin/google-chrome'});}
let pass=0,fail=0;
const ok=(n,c,d)=>{c?pass++:(fail++,console.log('FAIL  '+n+(d!==undefined?'  '+d:'')));};
const HOST = new URL(URL_).host;

// --- ZAŘÍZENÍ A: "ona". Zadá si data. ---
const A = await b.newContext({...pw.devices['iPhone 15'],locale:'cs-CZ',timezoneId:'Europe/Prague'});
const odchozi=[];
A.on('request', q => { const h=new URL(q.url()).host; if (h!==HOST) odchozi.push(q.method()+' '+q.url()); });
const pa = await A.newPage();
await pa.goto(URL_,{waitUntil:'load',timeout:45000});
await pa.waitForTimeout(1200);
await pa.evaluate(()=>{
  const A=window.__APP__, s=A.state(), y=s.years[String(s.activeYear)];
  y.catalog.push({id:'c_taj',sec:'daily',name:'Terapie',icon:'🤫',order:10,recurring:true,
    dueDay:null,goal:null,archived:false,createdAt:new Date().toJSON(),updatedAt:new Date().toJSON()});
  y.months[s.ui.month].entries.push({id:'e_taj',cat:'c_taj',plan:1200000,act:1150000,
    paid:false,paidAt:null,due:null,autoFilled:false,del:false,updatedAt:new Date().toJSON()});
  y.tx.push({id:'t_taj',d:new Date().getFullYear()+'-09-08',m:s.ui.month,cat:'c_taj',
    amt:250000,note:'soukromá poznámka',del:false,updatedAt:new Date().toJSON()});
  s.rev++; A.saveNow(); A.render();
});
await pa.waitForTimeout(1200);
const ulozeno = await pa.evaluate(()=>localStorage.getItem('rozpocet:doc')||'');
ok('data se uložila u ní', ulozeno.includes('Terapie'), String(ulozeno.length)+' znaků');
ok('žádné volání mimo ' + HOST, odchozi.length===0, odchozi.slice(0,3).join(' | '));

// --- ZAŘÍZENÍ B: "on". Stejná adresa, jiné zařízení. ---
const B = await b.newContext({...pw.devices['iPhone 15'],locale:'cs-CZ',timezoneId:'Europe/Prague'});
const pb = await B.newPage();
await pb.goto(URL_,{waitUntil:'load',timeout:45000});
await pb.waitForTimeout(1200);
const uNej = await pb.evaluate(()=>{
  const s=window.__APP__.state(), y=s.years[String(s.activeYear)];
  return { kategorii:y.catalog.length, nakupu:y.tx.length,
    surove: (localStorage.getItem('rozpocet:doc')||''), klicu: Object.keys(localStorage).length };
});
ok('druhé zařízení nevidí její kategorie', uNej.kategorii===0, String(uNej.kategorii));
ok('druhé zařízení nevidí její nákupy', uNej.nakupu===0, String(uNej.nakupu));
ok('slovo „Terapie" se u něj nikde neobjeví', !uNej.surove.includes('Terapie'));
ok('a ani „soukromá poznámka"', !uNej.surove.includes('soukromá poznámka'));

// --- co je vůbec na serveru ---
const stazene = await (await fetch(URL_)).text();
ok('na serveru není její kategorie', !stazene.includes('Terapie'));
ok('na serveru není žádná částka z jejího rozpočtu', !stazene.includes('1150000'));

// --- synchronizace je vypnutá a nic neposílá ---
const sync = await pa.evaluate(()=>{
  const s=window.__APP__.state();
  return { url:s.settings.syncUrl, heslo:s.settings.syncSecret };
});
ok('synchronizace nemá adresu', sync.url==='');
ok('synchronizace nemá heslo', sync.heslo==='');

// projít appku a hlídat, jestli něco neodejde
for (const scr of ['month','year','journal','savings','more']) {
  await pa.click(`#tabbar .tab[data-screen="${scr}"]`).catch(()=>{});
  await pa.waitForTimeout(350);
}
await pa.waitForTimeout(2000);
ok('ani po projití celé appky nic neodešlo', odchozi.length===0, odchozi.slice(0,3).join(' | '));

// --- cookies: nesmí existovat žádná, natož s daty ---
const cookiesA = await A.cookies();
ok('appka nepoužívá cookies', cookiesA.length===0,
   cookiesA.map(c=>c.name).join(',') || '');

console.log((fail?'FAIL':'PASS')+' '+pass+'/'+(pass+fail));
await b.close();
process.exit(fail?1:0);
