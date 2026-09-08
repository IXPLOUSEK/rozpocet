# Návod na nasazení aplikace Rozpočet

Tento průvodce tě krok za krokem provede tím, jak aplikaci **Rozpočet** publikovat na internetu zcela zdarma, bez programování a bez použití příkazové řádky.

Aplikace funguje jako tzv. PWA (progresivní webová aplikace) – to znamená, že ji nemusíš nahrávat do App Storu ani platit za drahý webhosting. Stačí ji umístit na bezplatný web, otevřít na iPhonu v prohlížeči Safari a přidat na plochu.

---

## Co budeš nahrávat

Oba soubory najdeš ve složce projektu, v podsložce `dist/`:

| Soubor | Kam s ním |
|---|---|
| `dist/index.html` | Nahraješ na GitHub pod tímto názvem. Je to celá aplikace v jednom souboru. |
| `dist/sw.js` | Nahraješ vedle něj, beze změny názvu. Bez něj appka offline nenaběhne. |

`dist/index.html` je už přejmenovaná kopie `rozpocet.html` — nemusíš nic
přejmenovávat, jen ji nahrát. Vyrábí ji příkaz `node tools/release.mjs`,
který zároveň projede kontroly.


## 1. Jak publikovat aplikaci zdarma na GitHub Pages

GitHub je celosvětová služba pro ukládání kódu, která nabízí funkci **GitHub Pages** – bezplatný hosting pro jednoduché webové stránky a aplikace. Vše naklikáš přímo ve webovém prohlížeči.

### Krok 1: Vytvoření účtu na GitHubu
1. Jdi na stránku [github.com](https://github.com/).
2. Vpravo nahoře klikni na **Sign up** (Registrace).
3. Zadej svůj e-mail, zvol si heslo a uživatelské jméno (username).
4. Účet je **zcela zdarma** a GitHub po tobě **nebude chtít žádnou platební kartu**.

### Krok 2: Vytvoření nového veřejného repozitáře
1. Po přihlášení klikni v pravém horním rohu na ikonu **`+`** a vyber **New repository** (případně klikni na zelené tlačítko *Create repository* na hlavní stránce).
2. Do pole **Repository name** zadej název, například `rozpocet`.
3. Ujisti se, že je zaškrtnutá volba **Public** (veřejný). To je nutná podmínka, aby bezplatné GitHub Pages fungovaly.
4. Ostatní políčka (např. *Add a README file*) nech nezaškrtnutá.
5. Klikni dole na zelené tlačítko **Create repository**.

### Krok 3: Nahrání souborů aplikace přes web
1. Na nově otevřené stránce repozitáře klikni na odkaz **uploading an existing file** (pokud už v repozitáři něco je, najdeš tuto volbu pod tlačítkem **Add file** → **Upload files**).
2. **Důležitý krok:** Vezmi vygenerovaný soubor `rozpocet.html` na svém počítači a **přejmenuj ho na `index.html`**. Webové servery vyžadují název `index.html`, aby poznaly, co mají zobrazit jako hlavní stránku.
3. Přetáhni myší do okna prohlížeče tyto dva soubory:
   - `index.html` (přejmenovaný `rozpocet.html`)
   - `sw.js` (service worker, který zajišťuje ukládání do mezipaměti a běh offline)
4. Dole pod seznamem nahraných souborů klikni na zelené tlačítko **Commit changes** (Uložit změny).

### Krok 4: Zapnutí GitHub Pages
1. V horní vodorovné liště repozitáře klikni na **Settings** (ikona ozubeného kolečka).
2. V levém bočním menu klikni na sekci **Pages**.
3. V části nazvané **Build and deployment**:
   - U položky **Source** vyber: `Deploy from a branch`.
   - Pod nápisem **Branch** zvol větev: `main` (případně `master`, podle toho, jak se větev jmenuje).
   - Složku vedle větve ponech nastavenou na `/ (root)`.
   - Klikni na tlačítko **Save**.

### Krok 5: Výsledná adresa a spuštění
- Po kliknutí na Save počkej zhruba **1 až 2 minuty**, než GitHub aplikaci připraví a vystaví na web.
- Výsledná adresa tvé aplikace bude:
  ```text
  https://<tvoje-uzivatelske-jmeno>.github.io/rozpocet/
  ```
  *(kde `<tvoje-uzivatelske-jmeno>` je tvoje přihlašovací jméno na GitHubu)*
- Tuto adresu najdeš také přímo v záložce *Settings → Pages* v horním zeleném rámečku, jakmile sestavení doběhne.

### Jak aplikaci později aktualizovat
1. Kdykoli vygeneruješ novou verzi `rozpocet.html`, opět ji přejmenuj na `index.html`.
2. Jdi do svého repozitáře na GitHubu, klikni na **Add file** → **Upload files**, přetáhni nový soubor se stejným názvem `index.html` a potvrď přes **Commit changes**.
3. **Pozor na mezipaměť v telefonu:** Service worker (`sw.js`) ukládá aplikaci do paměti telefonu, aby fungovala okamžitě a bez internetu. Proto se nová verze nemusí objevit hned. Obvykle je potřeba aplikaci na iPhonu jednou úplně ukončit (v přepínači aplikací švihnout prstem nahoru) a znovu otevřít, případně v prohlížeči stránku obnovit.

---

## 2. Proč aplikaci nelze jednoduše poslat e-mailem jako soubor

Může tě napadnout poslat si soubor `rozpocet.html` jednoduše e-mailem, přes AirDrop nebo uložit do iCloudu a otevřít přímo v mobilu. To však z několika technických důvodů na iPhonu nebude fungovat:

1. **Safari nepodporuje lokální protokol `file://`**  
   Mobilní Safari z bezpečnostních důvodů neumožňuje spouštět webové stránky a webové aplikace přímo ze souborového systému telefonu.

2. **Aplikace Soubory (Files) nespouští JavaScript**  
   Když soubor HTML otevřeš v nativní aplikaci Soubory na iOS, otevře se pouze rychlý náhled (Quick Look). Tento náhled z bezpečnostních důvodů blokuje spouštění JavaScriptu. Aplikace Rozpočet by se vůbec nerozběhla a zůstala by prázdná či zcela nefunkční, protože veškerá její logika a výpočty závisejí na JavaScriptu.

3. **WebKit ITP pravidlo: automatické smazání dat po 7 dnech**  
   Prohlížeč Safari má zabudovanou ochranu soukromí (WebKit Intelligent Tracking Prevention – ITP). Ta má striktní pravidlo: **pokud web 7 dní nenavštívíš, systém automaticky smaže veškerá jeho lokální data** (LocalStorage a skriptem zapisovaná úložiště).  
   **Jedinou výjimkou je přidání webu na plochu telefonu!**  
   Přidání aplikace na plochu (ikona Sdílet → *Přidat na plochu*) tedy není jen kosmetická vychytávka nebo hezký zástupce, ale **naprosto zásadní ochrana tvých finančních záznamů před smazáním systémem iOS**. Jakmile je aplikace na ploše, běží v izolovaném režimu PWA a iOS data nemaže.

---

## 3. Alternativa: Cloudflare Pages (pokud je GitHub příliš složitý)

Pokud se ti rozhraní GitHubu zdá zbytečně komplikované, skvělou a ještě přímočařejší alternativou je **Cloudflare Pages**.

- **Výhody:**
  - Zcela zdarma a bez platební karty.
  - Nahrávání funguje stylem **drag & drop** (přetažení složky myší).
  - Okamžité nasazení během několika sekund.
  - Vlastní adresa ve tvaru `https://rozpocet-<neco>.pages.dev`.

### Postup nasazení na Cloudflare Pages:
1. Zaregistruj se zdarma na [pages.cloudflare.com](https://pages.cloudflare.com/).
2. V administračním panelu přejdi do sekce **Workers & Pages** a klikni na **Create application** → záložka **Pages**.
3. Zvol možnost **Upload assets** (Nahrát přímo soubory).
4. Zadej název projektu (např. `rozpocet`).
5. Na počítači si vytvoř prázdnou složku a vlož do ní:
   - `index.html` (přejmenovaný soubor `rozpocet.html`)
   - `sw.js`
6. Celou tuto složku přetáhni myší do vyznačeného okna v prohlížeči.
7. Klikni na **Deploy site**. Během pár vteřin máš hotovo a získáš funkční odkaz.

---

## 4. Řešení problémů (Troubleshooting)

### Stránka hlásí chybu 404 (Not Found) ihned po zapnutí GitHub Pages
- **Proč se to děje:** GitHub Pages potřebují 1 až 2 minuty na první vygenerování a rozeslání stránky na servery.
- **Jak to vyřešit:** Počkej chvíli, zachovej klid a po 2 minutách stránku v prohlížeči obnov. Zároveň zkontroluj, že se soubor v repozitáři jmenuje přesně `index.html` (vše malými písmeny), a ne `rozpocet.html`.

### Změny se po nahrání nové verze neprojevují
- **Proč se to děje:** V telefonu je aktivní service worker a mezipaměť, které záměrně drží původní verzi, aby aplikace startovala okamžitě i bez sítě.
- **Jak to vyřešit:**
  - V Safari zkus vynucené obnovení stránky (zatáhni za stránku směrem dolů pro reload, případně v Nastavení Safari vymaž historii a mezipaměť).
  - Pokud máš aplikaci spuštěnou z plochy, úplně ji zavři v přepínači aplikací a znovu otevři. Service worker na pozadí stáhne novou verzi a při dalším otevření ji aktivuje.

### Jak ověřit, že je aplikace skutečně správně nainstalovaná
Aplikaci otestuješ podle těchto tří znaků:
1. **Samostatné zobrazení (Standalone):** Po kliknutí na ikonu na ploše se aplikace otevře bez adresního řádku Safari a bez spodních navigačních šipek. Vypadá a chová se jako plnohodnotná nativní aplikace.
2. **Vlastní ikona na ploše:** Na domovské obrazovce má své vlastní logo a název Rozpočet.
3. **Funkčnost bez internetu:** Zapni na telefonu **režim Letadlo** (odpoj se od Wi-Fi i mobilních dat) a aplikaci otevři. Pokud se bez potíží načte, můžeš listovat měsíci a zapisovat výdaje, vše je nastaveno na 100 % správně.
