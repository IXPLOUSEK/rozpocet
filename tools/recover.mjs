// tools/recover.mjs — záchranné cesty: poškozená data, novější verze,
// vymazání s návratem. Všechno se ověřuje na skutečném úložišti prohlížeče.
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
let b; try{b=await (process.argv.includes('--webkit')?pw.webkit:pw.chromium).launch();}
catch(e){b=await pw.chromium.launch({executablePath:'/usr/bin/google-chrome'});}
const doc=JSON.parse(readFileSync('test/fixtures/realistic-year.json','utf8'));
let pass=0,fail=0;
const ok=(n,c,d)=>{c?pass++:(fail++,console.log('FAIL  '+n+(d!==undefined?'  '+d:'')));};
const open_=async (seed)=>{
  const ctx=await b.newContext({...pw.devices['iPhone 15'],locale:'cs-CZ',timezoneId:'Europe/Prague'});
  if (seed) await ctx.addInitScript(v=>{try{localStorage.setItem('rozpocet:doc',v);}catch(e){}},seed);
  const p=await ctx.newPage();
  await p.goto(`http://127.0.0.1:${P}/rozpocet.html`,{waitUntil:'load'});
  await p.waitForTimeout(700);
  return {ctx,p};
};

// 1) Poškozená data se odloží, hlavní klíč zůstane, jde je dostat ven
{
  const {ctx,p}=await open_('{tohle-neni-json');
  const st=await p.evaluate(()=>{
    const keys=Object.keys(localStorage);
    return {hlavni: localStorage.getItem('rozpocet:doc'),
      karantena: keys.filter(k=>k.indexOf('rozpocet:quarantine:')===0),
      pruh: !!document.querySelector('[data-banner="corrupt"]'),
      akce: Array.from(document.querySelectorAll('[data-banner="corrupt"] [data-act]')).map(n=>n.dataset.act)};
  });
  ok('poškozený hlavní klíč zůstal nedotčený', st.hlavni==='{tohle-neni-json', String(st.hlavni).slice(0,20));
  ok('poškozená data jsou odložená', st.karantena.length===1, st.karantena.join(','));
  ok('appka to řekne pruhem', st.pruh);
  ok('pruh nabízí stažení dat', st.akce.indexOf('io.rescue')>=0, st.akce.join(','));
  await ctx.close();
}

// 2) Dokument z novější verze se neztratí
{
  const novy=JSON.stringify({app:'rozpocet',schema:99,rev:5,years:{}});
  const {ctx,p}=await open_(novy);
  const st=await p.evaluate(()=>({
    hlavni: localStorage.getItem('rozpocet:doc'),
    karantena: Object.keys(localStorage).filter(k=>k.indexOf('rozpocet:quarantine:')===0).length,
    pruh: !!document.querySelector('[data-banner="newer"]')}));
  ok('novější dokument zůstal na disku', st.hlavni===novy);
  ok('novější dokument je i v karanténě', st.karantena===1, String(st.karantena));
  ok('appka na to upozorní', st.pruh);
  await ctx.close();
}

// 3) Vymazání: snímek vznikne a vrací se JEN ten svůj
{
  const {ctx,p}=await open_(JSON.stringify(doc.doc||doc));
  // podstrčit starý cizí snímek, ať je co splést si
  await p.evaluate(()=>{ localStorage.setItem('rozpocet:snap:1000000000000-1',
    JSON.stringify({at:1000000000000,reason:'pred-migraci',rev:1,schema:1,doc:{app:'rozpocet',schema:1,rev:1,years:{}}})); });
  const pred=await p.evaluate(()=>{const y=window.__APP__.state(); return y.years[String(y.activeYear)].catalog.length;});
  ok('výchozí data jsou tam', pred>10, String(pred));
  await p.click('#tabbar .tab[data-screen="more"]'); await p.waitForTimeout(500);
  const po=await p.evaluate(()=>({ maTlacitko: !!document.querySelector('[data-act="io.wipe"]'),
    maZachranu: !!document.querySelector('[data-act="io.export"]') }));
  ok('tlačítko vymazat je v Nastavení', po.maTlacitko);
  ok('a vedle něj stažení zálohy', po.maZachranu);

  // Skutečné vymazání: potvrdit napsáním SMAZAT
  await p.click('[data-act="io.wipe"]'); await p.waitForTimeout(600);
  const pole = p.locator('#sheet-host input').first();
  if (await pole.count()) { await pole.fill('SMAZAT'); }
  const potvrd = p.locator('#sheet-host .btn-danger, #sheet-host .btn-primary').first();
  if (await potvrd.count()) { await potvrd.click(); await p.waitForTimeout(1500); }
  const stav = await p.evaluate(()=>{
    const A=window.__APP__, s=A.state();
    const snaps=Object.keys(localStorage).filter(k=>k.indexOf('rozpocet:snap:')===0);
    let vymaz=0;
    for (const k of snaps) { try { const r=JSON.parse(localStorage.getItem(k));
      if (r && r.reason==='pred-vymazanim') vymaz++; } catch(e){} }
    return { kategorii: s.years[String(s.activeYear)].catalog.length,
      snimkuVymazani: vymaz, cizichSnimku: snaps.length - vymaz,
      toast: (document.querySelector('#toast-host')||{}).innerText || '' };
  });
  ok('po vymazání je appka prázdná', stav.kategorii===0, String(stav.kategorii));
  ok('vznikl snímek z vymazání', stav.snimkuVymazani===1, String(stav.snimkuVymazani));
  ok('cizí snímek se nesmazal', stav.cizichSnimku>=1, String(stav.cizichSnimku));
  ok('nabízí se návrat', /vrátit/i.test(stav.toast), JSON.stringify(stav.toast).slice(0,80));

  // Návrat musí obnovit TA data, ne cizí snímek
  const diag = await p.evaluate(()=>{
    const t=document.querySelector('#toast-host .toast');
    return { toastu: document.querySelectorAll('#toast-host .toast').length,
      maAkci: !!(t && t.querySelector('.toast-action')),
      akceText: t && t.querySelector('.toast-action') ? t.querySelector('.toast-action').textContent : null,
      maHandler: !!(t && t._onAction) };
  });
  console.log('   diagnostika toastu:', JSON.stringify(diag));
  // Toastů může viset víc (např. „Nestáhlo se?" z automatické zálohy).
  const vrat = p.locator('#toast-host .toast-action', { hasText: /vrátit/i }).first();
  if (await vrat.count()) { await vrat.click(); await p.waitForTimeout(1500); }
  else console.log('   POZOR: tlačítko návratu nenalezeno');
  const diag2 = await p.evaluate(()=>{
    const snaps=Object.keys(localStorage).filter(k=>k.indexOf('rozpocet:snap:')===0);
    return { snimku: snaps.length, toast: (document.querySelector('#toast-host')||{}).innerText||'' };
  });
  console.log('   po kliknutí:', JSON.stringify(diag2).slice(0,200));
  const zpet = await p.evaluate(()=>{const s=window.__APP__.state();
    return s.years[String(s.activeYear)].catalog.length;});
  ok('návrat obnovil původní data', zpet===pred, zpet + ' místo ' + pred);
  await ctx.close();
}

console.log((fail?'FAIL':'PASS')+' '+pass+'/'+(pass+fail));
await b.close(); srv.close();
process.exit(fail?1:0);
