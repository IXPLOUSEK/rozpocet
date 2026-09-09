// tools/pisecky.mjs — tři lidé, jeden odkaz, tři oddělené písečky.
// Přesně scénář: poskytovatel dá adresu víc lidem, každý si zapíše svoje.
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

// Tři různá zařízení, každé jiné, jak to bude ve skutečnosti.
const lide = [
  { kdo:'poskytovatel', zarizeni:'Desktop Chrome', kategorie:'Servis auta',  castka:1850000, pozn:'Škodovka' },
  { kdo:'kamarádka',    zarizeni:'iPhone 15',      kategorie:'Terapie',      castka:1200000, pozn:'čtvrtky' },
  { kdo:'kamarád',      zarizeni:'iPad (gen 7)',   kategorie:'Kytara',       castka: 640000, pozn:'na splátky' },
];

const kontexty = [];
for (const os of lide) {
  const zar = pw.devices[os.zarizeni] || {};
  const ctx = await b.newContext({...zar, locale:'cs-CZ', timezoneId:'Europe/Prague'});
  const p = await ctx.newPage();
  await p.goto(URL_, {waitUntil:'load', timeout:60000});
  await p.waitForTimeout(1200);
  await p.evaluate(o=>{
    const A=window.__APP__, s=A.state(), y=s.years[String(s.activeYear)];
    y.catalog.push({id:'c_x',sec:'daily',name:o.kategorie,icon:'🔒',order:10,recurring:true,
      dueDay:null,goal:null,archived:false,createdAt:new Date().toJSON(),updatedAt:new Date().toJSON()});
    y.months[s.ui.month].entries.push({id:'e_x',cat:'c_x',plan:o.castka,act:o.castka,
      paid:false,paidAt:null,due:null,autoFilled:false,del:false,updatedAt:new Date().toJSON()});
    y.tx.push({id:'t_x',d:new Date().getFullYear()+'-09-08',m:s.ui.month,cat:'c_x',
      amt:Math.round(o.castka/4),note:o.pozn,del:false,updatedAt:new Date().toJSON()});
    s.rev++; A.saveNow(); A.render();
  }, os);
  await p.waitForTimeout(800);
  kontexty.push({os, ctx, p});
}

// Každý vidí svoje
for (const {os, p} of kontexty) {
  const moje = await p.evaluate(()=>{
    const s=window.__APP__.state(), y=s.years[String(s.activeYear)];
    return { kategorii:y.catalog.map(c=>c.name), surove:(localStorage.getItem('rozpocet:doc')||'') };
  });
  ok(os.kdo + ' vidí svoji položku', moje.kategorii.includes(os.kategorie), moje.kategorii.join(','));
  // a NEVIDÍ cizí
  for (const jiny of lide) {
    if (jiny.kdo === os.kdo) continue;
    ok(os.kdo + ' nevidí „' + jiny.kategorie + '" od ' + jiny.kdo,
       !moje.surove.includes(jiny.kategorie) && !moje.surove.includes(jiny.pozn));
  }
  // ani cizí částku
  for (const jiny of lide) {
    if (jiny.kdo === os.kdo) continue;
    ok(os.kdo + ' nevidí částku ' + jiny.castka, !moje.surove.includes(String(jiny.castka)));
  }
}

// Znovuotevření: každý si najde svoje i po restartu appky
for (const {os, p} of kontexty) {
  await p.reload({waitUntil:'load', timeout:60000});
  await p.waitForTimeout(1200);
  const po = await p.evaluate(()=>{
    const s=window.__APP__.state(), y=s.years[String(s.activeYear)];
    return y.catalog.map(c=>c.name);
  });
  ok(os.kdo + ' má svoje i po restartu', po.includes(os.kategorie) && po.length===1, po.join(','));
}

// Nový člověk, kterému teprve dáš odkaz: musí dostat prázdno
{
  const ctx = await b.newContext({...pw.devices['iPhone 15'], locale:'cs-CZ', timezoneId:'Europe/Prague'});
  const p = await ctx.newPage();
  await p.goto(URL_, {waitUntil:'load', timeout:60000});
  await p.waitForTimeout(1200);
  const novy = await p.evaluate(()=>{
    const s=window.__APP__.state(), y=s.years[String(s.activeYear)];
    return { kat:y.catalog.length, tx:y.tx.length, surove:(localStorage.getItem('rozpocet:doc')||'') };
  });
  ok('nový člověk začíná úplně prázdný', novy.kat===0 && novy.tx===0, novy.kat+' kategorií, '+novy.tx+' nákupů');
  ok('a nevidí nikoho z těch tří',
     lide.every(o=>!novy.surove.includes(o.kategorie)));
  await ctx.close();
}

console.log((fail?'FAIL':'PASS')+' '+pass+'/'+(pass+fail));
await b.close();
process.exit(fail?1:0);
