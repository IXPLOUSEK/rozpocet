# Rozpočet

Česká appka na osobní rozpočet. **Jeden soubor**, funguje offline, na iPhonu,
iPadu i na počítači. Náhrada za tabulku „ROZPOČET A SKUTEČNOST" v Google
Tabulkách.

## Co dostane ona

| Soubor | K čemu |
|---|---|
| `rozpocet.html` | Celá aplikace. Startuje prázdná. |
| `sw.js` | Aby fungovala i bez signálu. Nahraj vedle ní. |
| `NAVOD-pro-ni.md` | Návod pro ni: na plochu, zápis výdaje, záloha. |

## Co potřebuješ ty

| Soubor | K čemu |
|---|---|
| `NASAZENI.md` | Nahrání na GitHub Pages, klik po kliku. Zdarma, bez karty. |
| `sync/` | Volitelná synchronizace přes Google Tabulku. Skript, návod, protokol. |
| `test/AKCEPTACE.md` | 12 kroků, co si projít na skutečném iPhonu a Macu. |

> **Na iPhone ji nelze poslat jako soubor.** Safari na iOS neumí otevřít
> soubor z disku a náhled v Souborech nespouští JavaScript. Musí přijít přes
> webovou adresu a ona si ji přidá na plochu. Přidání na plochu zároveň brání
> tomu, aby Safari po sedmi dnech nepoužívání data smazalo.

## Soukromí

Data jsou v prohlížeči toho zařízení, kde se zapsala, a nikam neodcházejí.
Na hostingu leží jen program. Ověřuje to `node tools/soukromi.mjs`, který
proti nasazené adrese zkontroluje, že si dvě různá zařízení navzájem do dat
nevidí, že na serveru žádná data nejsou, a že appka za celou relaci neudělá
jediné volání mimo vlastní doménu.

**Cookies se schválně nepoužívají.** Cookie se posílá na server při každém
požadavku, takže by data ze zařízení odcházela. `localStorage` se neposílá
nikdy. Je to tedy o stupeň lepší, ne horší.

Jedno omezení stojí za vědomí: GitHub Pages dává všem projektům jednoho účtu
stejnou doménu `<jmeno>.github.io`. Kdyby na ní vznikl další web, technicky
by na cizím zařízení mohl číst stejné úložiště — ale jen tehdy, kdyby ho
uživatelka na svém telefonu otevřela. Kdo tohle chce vyloučit úplně, nasadí
appku na doménu, kterou nic jiného nesdílí (Cloudflare Pages dává každému
projektu vlastní `<projekt>.pages.dev`).

## Vývoj

Aplikace se skládá z fragmentů v `src/`, aby na ní mohlo pracovat víc lidí
najednou. Výsledek je pořád jeden soubor.

```bash
node build.mjs          # src/*  ->  rozpocet.html
node tools/gate.mjs     # statické brány: žádné innerHTML, žádné cizí odkazy, prázdný start
node tools/smoke.mjs    # integrační test v prohlížeči
./tools/wk.sh tools/smoke.mjs --webkit   # totéž v opravdovém WebKitu (kontejner)
node test/run.mjs all   # celá testovací sada
```

Otevři aplikaci s `#test` na konci adresy a spustí se vlastní kontrola —
funguje i na jejím telefonu.

Pravidla, kterými se řídí každý fragment, jsou v `src/_CONTRACT.md`,
datový model v `src/_MODEL.md`.

### Proč WebKit v kontejneru

Playwright dodává WebKit slinkovaný proti `libicu74`. Fedora má ICU 77 a ABI
nesedí, takže se nespustí. `tools/wk.sh` proto pouští testy v oficiálním
obrazu `mcr.microsoft.com/playwright`, kde běží skutečný engine Safari.
