# Testy

Appka je jednosouborová, offline a má jednu uživatelku. Testy jsou tu proto,
že chyba se tady neprojeví jako výpadek serveru, ale jako **tiše ztracená
data nebo špatné číslo v rozpočtu** — a to se pozná až za měsíc.

Nulové závislosti. Žádný `npm install`, žádný jest, žádné axe-core.
Jen Node 22, Playwright, který už na stroji je, a `python3` s PIL na porovnání
snímků.

---

## Jak to spustit

```bash
node test/run.mjs all          # všechno
node test/run.mjs unit         # jen čisté funkce, ~1 s, bez prohlížeče
node test/run.mjs dom storage  # jen vybrané suity
```

Driver si sám:

1. sestaví appku (`node build.mjs` → `rozpocet.html`),
2. dogeneruje chybějící fixtury,
3. najde funkční Playwright a prohlížeč,
4. **zmrazí kopii** appky do `test/.out/serve/` a servíruje ji
   na `127.0.0.1` na **volném portu, který přidělí systém**,
5. na konci vypíše souhrn a skončí nenulově, když něco spadlo.

Dvě věci na tomhle stojí za vysvětlení:

- **Port nikdy není pevný.** Pevné číslo je sdílený zdroj: buď ho drží něco
  jiného (`ERR_CONNECTION_REFUSED`), nebo — mnohem hůř — se testy připojí
  na cizí server a tiše testují cizí stránku. `listen(0)` si nechá port
  přidělit systémem a server umře s procesem.
- **Servíruje se zmrazená kopie, ne živý soubor.** Na projektu pracuje víc
  lidí naráz a `rozpocet.html` se přestavuje i během běhu testů. Bez kopie
  si suita v půlce běhu sáhne na jiný soubor, než na kterém začala, a
  vizuální testy pak hlásí desítky rozdílů, které nikdo neudělal. Otisk
  kopie (`zmrazená kopie 6c35f0aa`) je ve výpisu, takže je vždycky jasné,
  co přesně se testovalo.

### Přepínače

| přepínač | co dělá |
|---|---|
| `--webkit` | pustí celý běh **v kontejneru s opravdovým WebKitem** (viz níž) |
| `--update-baseline` | přepíše referenční snímky pro vizuální suitu |
| `--no-build` | přeskočí `build.mjs` (rychlejší opakované spouštění) |
| `--list` | vypíše jména suit |

### Fixtury

```bash
node test/fixtures/gen.mjs           # přegeneruje testovací data
node test/fixtures/gen.mjs --check   # jen ověří, že se nic nezměnilo
```

Seed je 42 a nikde není `Date.now()` ani `Math.random()`. Dvě generování za
sebou musí dát **bajt za bajt stejné soubory** — jinak by každý běh hlásil
falešný rozdíl a po týdnu by tomu nikdo nevěřil. Generátor si to sám ověří
a při rozjezdu skončí chybou.

---

## Co která suita hlídá

### `unit` — čisté funkce a kontrakt (bez prohlížeče)

Fragmenty `30-config.js` … `34-derived.js` se načtou do `vm` sandboxu
s náhradním DOM. Díky tomu tahle suita funguje i ve chvíli, kdy je zbytek
appky rozepsaný.

- **Částky.** `parseCzkInput` na českých tvarech (`1 234,50`, `2500,-`,
  `1.234`, `−1000`), odmítnutí nesmyslů, strop miliardy Kč, a hlavně:
  **prázdné pole vrací `null`, nikdy `0`** — `Number("")` je nula a přesně
  tak se smazané pole tiše stane skutečnou nulou.
- **Formátování.** `formatCzk` proti `Intl` na 300 náhodných částkách,
  pevná mezera, a že zaokrouhlená nula není `-0 Kč`.
- **Kolečko** `fmtEdit → parseCzkInput` — cestou se nesmí nic ztratit.
- **Datumy.** `monthKey`/`ymd` bez `toISOString()` (v Praze by 1. leden spadl
  do prosince), splatnost 31. v únoru, přechod na letní čas v `daysBetween`.
- **Řazení** podle češtiny: `Cukr, Čaj, Hudba, Chleba, Zima, Žena`.
- **CSV** `escapeCsv` — Excel si z `=SUMA(A1)` nesmí udělat vzorec.
- **Migrace.** Dokument bez klíče `schema` se bere jako v1. Starý soubor
  s korunovými floaty se **schválně nepřepočítává** — musí ho hlasitě
  odmítnout validace, ne tichý odhad. Špatný odhad tady přečte cizí peníze
  stokrát jinak.
- **Statická kontrola `_CONTRACT.md`:** nikde `innerHTML`, nikde
  `input[type=number]`, nikde `toISOString().slice()`, žádný `parseFloat`
  ani `Number()` na uživatelský vstup, žádné síťové volání mimo `55-sync.js`,
  `font-size: 16px` v `11-base.css`, žádný hex mimo `10-tokens.css`,
  žádná kolize jmen mezi fragmenty. **Každá hláška ukáže `soubor:řádek`.**
- **Fixtury samotné** — všechny částky jsou celé haléře a nikde není
  doslova `NaN` ani `[object Object]`.

### `dom` — ovládání na iPhonu

iPhone 15, čeština, Praha.

- **Caret — hlavní test celé appky.** Napíše `1 234,50` znak po znaku
  s pauzou 60 ms a po **každém** stisku kontroluje trojici: fokus zůstal
  v poli, hodnota je přesně napsaná předpona, kurzor je na správném indexu.
  Pak vloží číslici doprostřed (`1234`, kurzor na 2, napiš `9` → `12934`,
  kurzor 3). Formátování za běhu kurzor přesune na konec a uživatelka místo
  `1 234` napíše `4321`.
- Nikde `input[type=number]` — **ani uvnitř `<template>`**, protože z nich se
  řádky teprve klonují. Každý `input.amt` je `type=text` + `inputmode=decimal`.
- Každý `input`/`select`/`textarea` má aspoň **16 px** (pod tím Safari
  při zaostření zoomne celou stránku).
- Každé tlačítko, odkaz a zaškrtávátko má **44×44 px**.
- Žádné vodorovné posouvání na 320 / 375 / 393 / 430 / 768 / 1024.
- **Sticky hlavička** drží po posunutí o 1200 px — a žádný mezilehlý předek
  nemá `overflow` jiné než `visible`. Sticky se totiž málokdy rozbije samo;
  rozbije ho obal se `overflow: hidden`.
- Při **zmenšeném výřezu kvůli klávesnici** (393×516) je zaostřené pole
  v každé sekci celé vidět.
- **24 přepnutí měsíců** — počty řádků se nemění a id zůstávají unikátní.
  Tohle chytá opakující se položky, které se při každém vstupu do měsíce
  tiše zakládají znovu. Pozná se to jinak až v prosinci.
- Dvojklik na „přidat řádek" přidá právě jeden řádek.
- Pod **žádnou** fixturou se v textu stránky neobjeví `NaN`, `Infinity`,
  `undefined`, `null` ani `[object Object]`.

### `storage` — ukládání

**Všechno jede přes `http://`, ne `file://`.** První tvrzení v suitě to
kontroluje. Není to formalita: Safari na `localStorage` z `file://` hodí
`SecurityError`, appka spadne do nouzové větve v paměti — a testy by pak
hlásily, že ukládání funguje, přestože by testovaly úplně jinou cestu.

- Zápis → znovunačtení → data **bajt za bajt** stejná, a nechybí ani položka.
- **Poškozený obsah** (rozsypaný text, ořezaný ale věrohodný JSON, cizí JSON)
  se odloží do karantény, původní text zůstane zachovaný, appka se otevře
  a česky řekne, co se stalo. Nic se nesmí zahodit — i rozsypaný soubor může
  být to jediné, z čeho se dá něco zachránit.
- **v1** (bez klíče `schema`) se načte a nechá po sobě snímek stavu před
  migrací, aby bylo kam couvnout.
- **Došlo místo** (`QuotaExceededError` podstrčený přes `addInitScript`):
  česká hláška, nabídne se záloha, v paměti se neztratí ani koruna
  a s appkou se dá dál pracovat.
- **Zamčené úložiště** (`SecurityError` už na prvním zápisu): jede se dál
  v paměti a je vidět proužek.
- Otevřeno z **`file://`**: český proužek „data se neukládají".
- **12 měsíců plných dat + 2000 zápisů** se vejde pod 1,5 MiB (Safari má
  strop kolem 5 MB a musí zbýt i na zálohu a karanténu).

### `io` — záloha, obnova, tabulka

Testuje se **skutečně stažený soubor**, ne to, že se funkce zavolala.
Prázdná záloha se pozná až ve chvíli, kdy z ní chce uživatelka obnovit.

- Jméno `rozpocet-zaloha-RRRR-MM-DD.json`, soubor **není 0 B**, dá se
  přeparsovat, a žádná vyplněná částka se cestou nezměnila na `null`.
- Záloha si nechá i **archivované kategorie a osiřelé zápisy** — mazání je
  v tomhle modelu měkké, takže jejich vynechání by udělalo obnovu ztrátovou.
- Když je ve stavu `NaN`, záloha se **nevytvoří** a řekne se proč. Záloha
  s `NaN` je horší než žádná: uživatelka má pocit, že je v bezpečí.
- **export → import → export** dá bajt za bajt stejný soubor. Když ne,
  hláška vypíše **jmenovitě, co se cestou ztratilo**.
- **Import nahrazuje, nesleje.** 5 řádků za 12 000 Kč, načti zálohu se
  3 řádky za 7 000 Kč → zůstanou přesně 3 řádky, 7 000 Kč a nula původních id.
- Cizí JSON se odmítne a data zůstanou nedotčená.
- **CSV pro českou Excel:** začíná `EF BB BF`, odděluje `;`, končí `CRLF`,
  částka je `1234,50` (čárka, žádná mezera v čísle — jediná U+00A0 udělá
  z celého sloupce text a `SUM` vrátí nulu), diakritika celá, `=` odzbrojené.

### `print` — tisk do PDF

- V tiskovém médiu se nikde neroluje, nikde nezůstala `max-height`
  a nic není `position: fixed` ani `sticky`.
- Ovládací prvky (tabbar, `+`, panely, pruh měsíců, „přidat") se netisknou.
- Vygenerované A4 PDF má **aspoň dvě stránky**, `pdftotext` v něm najde
  všech dvanáct českých měsíců a **žádné** `NaN` / `undefined` /
  `[object Object]`. PDF plné prázdných stránek by jinak prošlo.
- Nic nepřetéká za pravý okraj A4.

### `visual` — 30 snímků

`{světlý, tmavý}` × `{iPhone 15, iPad, 1440×900}` × `{měsíc, sekce, deník,
úspory, tisk}`. Čerstvé a rozdílové snímky jdou do `test/.out/`.
Porovnává `test/visual.py` (PIL) a suita spadne nad **0,5 %** změněných pixelů.

Referenční snímky leží v **`test/baseline/<engine>-<prostředí>/`**, například
`test/baseline/chromium-host/`. Baseline patří konkrétnímu enginu a prostředí:
Chromium na hostiteli a Chromium v kontejneru mají jiný fontconfig a stejná
stránka v nich vypadá jinak. Kdyby se snímky porovnávaly napříč, každý běh
v kontejneru by hlásil 30 falešných rozdílů — a po druhém takovém běhu by
téhle suitě nikdo nevěřil.

**Při prvním běhu bez baseline se snímky založí a suita to řekne** — nespadne.

Snímky se pořizují po zamrazení animací a přechodů, ale **čas se nemrazí**.
Snímek, na kterém appka ukazuje „dnes" nebo „za 3 dny", se den ode dne mění —
po půlnoci může být rozdíl legitimní.

```bash
python3 test/visual.py baseline.png aktualni.png rozdil.png [tolerance]
```

### `a11y` — přístupnost

- `<html lang="cs">`, každý formulářový prvek má jméno, každé tlačítko má
  čitelný text (past: `<button><span aria-hidden="true">✓</span></button>`).
- Fokus je vidět u **každého** interaktivního prvku.
- Pořadí tabulátoru odpovídá pořadí na obrazovce.
- `Escape` zavře panel a fokus se vrátí tam, odkud se otevřel; dokud je
  panel otevřený, fokus z něj neuteče.
- Souhrn je `aria-live="polite"`.
- **Osm kontrastních dvojic se počítá v stránce z DOOPRAVDY VYKRESLENÝCH
  barev**, ne z hodnot tokenů — průhledné pozadí se skládá přes předky.
  Vzorec podle WCAG 2.1, práh 4,5:1 pro text a 3:1 pro netextové hranice,
  **v obou motivech**.
- **Rozsah netextových hranic je úzký schválně.** WCAG 1.4.11 mluví o prvcích
  rozhraní a o grafice, která něco *znamená*. Hlídají se proto hranice
  zadávacích polí, zaškrtávátek a přepínačů, fokusový rámeček, výplně
  a dráhy pruhů a sloupce v grafu. **Ozdobný vlas mezi řádky se nehlídá** —
  nenese informaci a vynutit na něm 3:1 by z appky udělalo tabulkový rastr.
  Suita při každém běhu vypíše, co do rozsahu patří a co je z něj vyjmuté,
  aby ta výjimka byla vidět a dalo se s ní nesouhlasit.

---

## WebKit: běží, ale jen v kontejneru

Playwrightí WebKit chce `libicu74`, `libjpeg.so.8`, `libjxl.so.0.8`
a `libbacktrace.so.0`. Fedora 44 má ICU **77**, libjpeg **62** a libjxl
**0.11**, a `libbacktrace` nemá vůbec. ABI nesedí a nasymlinkovat se to nedá
(ICU má symboly verzované příponou). `npx playwright install-deps` je jen pro
`apt`, takže na Fedoře nepomůže.

**WebKit ale není nedostupný** — běží v obrazu `mcr.microsoft.com/playwright`:

```bash
node test/run.mjs all --webkit     # pustí běh v kontejneru přes tools/wk.sh
```

Bez `--webkit` všechno běží v Chromiu a chování skutečného Safari nikdo
neověřil; driver to hlásí u každého běhu i s hotovým příkazem.

**Safari se chová jinak a už to párkrát ukázalo.** V Chromiu projde, ve WebKitu
ne: vodorovné přetečení na 320 px. A naopak — `mouse.wheel` mobilní WebKit
vůbec neumí a `el.focus()` v něm neroluje vnořené oblasti, takže testy, které
se o tohle opíraly, měřily prohlížeč, ne appku. Obojí je opravené.

### Co se v kontejneru ověřit nedá

Tohle jsou omezení nástrojů, ne chyby appky. Nikdy se nesmí hlásit jako
vada produktu — proto na ně suity padají SKIPem s důvodem, ne FAILem:

- **Service workery** Playwrightí WebKit v téhle sestavě nespouští. Kdyby
  sem přibyla offline suita, projde v Chromiu a ve WebKitu ne — z důvodu
  na straně nástroje.
- **Pillow v obrazu není**, takže `visual` v kontejneru snímky jen uloží
  a neporovnává. Referenční snímky mají proto vlastní adresář
  `baseline/chromium-container/` a s hostitelskými se nikdy nemíchají.
- **`mouse.wheel` mobilní WebKit neumí.** Testy, které potřebují posun,
  proto měří rozměry a `scrollTop`, ne gesto.
- **Klávesnici nejde emulovat.** `setViewportSize()` výřez zkrátí, ale
  prohlížeči neřekne „vyjela klávesnice", takže se nespustí odrolování na
  zaostřené pole, které na iPhonu dělá Safari samo. Suita proto ověří jen
  to, že si appka o mechanismus řekne
  (`interactive-widget=resizes-content`) a že si při zkrácení výřezu sama
  nepřeskládá obsah; zbytek patří na zařízení — `AKCEPTACE.md` krok 4.

---

## Co emulace neumí a musí se zkusit na zařízení

Na tohle je `test/AKCEPTACE.md` — dvanáct kroků, které projde majitel
na kamarádčině iPhonu a na svém Macu asi za deset minut.

1. **Přidání na plochu a spuštění z ikony.** Jestli je pryč adresní řádek
   a jestli appka přežije zamčení telefonu, se v prohlížeči na počítači
   nezjistí.
2. **Skutečná klávesnice na iOS.** Emulace umí zmenšit výřez, ale ne
   předvést, že se objeví číselná klávesnice s čárkou a ne písmenková.
3. **Chování Safari při nedostatku místa a v soukromém režimu.** Limity
   i tvar výjimky má Safari vlastní.
4. **Že iOS po týdnu nesmaže data appce, která není na ploše.** Tohle je
   důvod, proč krok 1 existuje.
5. **Otevření DALŠÍ DEN.** Jediný test, který chytí tiše mizející data.
   Nedá se uspěchat.
6. **Sdílení zálohy do Souborů / iCloudu.** V prohlížeči je to `download`,
   na iPhonu systémové sdílení — jiná cesta, jiné chyby.
7. **Tisk z opravdového Safari na Macu.** Sazbu stránek dělá každý engine
   trochu jinak.
8. **VoiceOver.** Testy ověří jména a kontrast, ale ne to, jestli se to
   dá poslouchat.

---

## Adresáře

```
test/
  run.mjs            driver — sestaví, zvedne server, pustí suity, sečte
  lib/
    harness.mjs      mikro runner: PASS / FAIL / SKIP
    pw.mjs           najde Playwright a prohlížeč, který opravdu nastartuje
    server.mjs       statický server (node:http, volný port od systému)
    page.mjs         otevření appky, nasypání fixtury, hlídání chyb
  fixtures/
    gen.mjs          deterministický generátor (seed 42)
    empty.json       panenský dokument
    realistic-year.json  celý rok: 69 kategorií, 816 položek, 601 zápisů
    adversarial.json jedna řádka na jeden způsob, jak to může spadnout
    legacy-v1.json   starý soubor bez `schema` a s korunovými floaty
  suites/            unit · dom · storage · io · print · visual · a11y
  baseline/
    chromium-host/   referenční snímky — vlastní adresář na engine a prostředí
  .out/              čerstvé snímky, rozdíly, vygenerované PDF (nekomituje se)
  visual.py          porovnání snímků přes PIL
  AKCEPTACE.md       dvanáct kroků na opravdovém zařízení
```

## SKIP není PASS

Appka vzniká po částech. Když nějaká funkce ještě neexistuje, tvrzení se
označí **SKIP** s důvodem, ne PASS — aby se „ještě to není napsané"
nedalo splést s „je to ověřené". Souhrn počítá všechny tři stavy zvlášť.
