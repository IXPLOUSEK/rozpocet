import { createRequire } from 'node:module';
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
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
mkdirSync('test/artefakty',{recursive:true});
const ctx=await b.newContext({...pw.devices['iPhone 15'],locale:'cs-CZ',timezoneId:'Europe/Prague'});
const p=await ctx.newPage();
await p.goto(URL_,{waitUntil:'load',timeout:45000});
await p.waitForTimeout(1500);
await p.click('#tabbar .tab[data-screen="more"]');
await p.waitForTimeout(600);
const card = p.locator('#screen-more .card', { hasText: 'Soukromí' }).first();
if (await card.count()) { await card.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  await card.screenshot({path:'test/artefakty/soukromi.png'}); console.log('snímek Soukromí hotový'); }
else console.log('karta Soukromí nenalezena');
await b.close();
