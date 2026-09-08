# Propoj rozpočet v telefonu a notebooku přes Google Tabulky

Za přibližně 10 minut si nastavíš společné úložiště rozpočtu ve vlastním Google účtu. Potřebuješ Google účet, prohlížeč a soubor [Kod.gs](./Kod.gs). Běžný osobní účet umožňuje tento postup bez platební karty a bez zapínání fakturace; platí ale limity Googlu.

1. **Vytvoř tabulku.** Otevři [Google Tabulky](https://sheets.google.com) a založ prázdnou tabulku, třeba „Můj rozpočet“. Nech ji soukromou. Z její adresy si zkopíruj ID: část mezi `/spreadsheets/d/` a `/edit`. Nepoužívej číslo `gid` za koncem adresy.

2. **Otevři editor skriptu.** V tabulce vyber **Rozšíření → Apps Script** (**Extensions → Apps Script**). Projekt si pojmenuj třeba „Synchronizace rozpočtu“. Skript tak bude navázaný na tuto tabulku.

3. **Vlož kód.** Otevři soubor `Kod.gs` z tohoto adresáře a zkopíruj celý jeho obsah do výchozího souboru v editoru. Nahraď výchozí ukázku `myFunction` a změnu ulož. Do kódu nevpisuj heslo ani ID tabulky. Není potřeba spouštět žádnou instalační funkci.

4. **Nastav dvě vlastnosti skriptu.** V levém panelu otevři ozubené kolečko **Nastavení projektu** (**Project Settings**). V části **Vlastnosti skriptu** (**Script Properties**) přidej následující položky a ulož je:

   | Vlastnost | Hodnota |
   | --- | --- |
   | `SYNC_SECRET` | Nově vygenerované náhodné heslo dlouhé 32 až 256 znaků, například ze správce hesel |
   | `SPREADSHEET_ID` | ID tabulky z kroku 1 |

   Heslo si ulož do správce hesel. Budeš potřebovat přesně stejnou hodnotu v telefonu i notebooku. Tento návod záměrně neobsahuje žádné hotové heslo.

5. **Nasaď webovou aplikaci.** Vpravo nahoře vyber **Nasadit → Nové nasazení** (**Deploy → New deployment**). Přes ozubené kolečko zvol typ **Webová aplikace** (**Web app**). Nastav **Spouštět jako: Já** (**Execute as: Me**) a **Kdo má přístup: Kdokoli** (**Who has access: Anyone**). Volba **Kdokoli** je nezbytná i pro zařízení, kde nejsi přihlášený ke Googlu. Varianta vyžadující Google účet synchronizaci z aplikace blokuje. Klikni na **Nasadit**.

6. **Povol přístup ke své tabulce.** Při autorizaci vyber svůj Google účet a zkontroluj požadovaná oprávnění. U vlastního neověřeného projektu se může objevit upozornění „Google tuto aplikaci neověřil“. Pro tento právě vytvořený projekt otevři **Pokročilé → Přejít na název projektu** (**Advanced → Go to project**) a přístup povol. Pokud spravovaný pracovní nebo školní účet nedovoluje veřejné nasazení, použij osobní účet.

7. **Ověř adresu nasazení.** Zkopíruj **URL webové aplikace**, která končí `/exec`. Otevři ji v anonymním okně prohlížeče. Před prvním uložením dokumentu očekávej následující odpověď:

   ```json
   {
     "ok": true,
     "app": "rozpocet-sync",
     "version": "1.0.0",
     "hasDoc": false,
     "rev": 0,
     "updatedAt": null
   }
   ```

   Jde o veřejnou kontrolu dostupnosti, která nevrací obsah rozpočtu. Po synchronizaci se `hasDoc`, `rev` a `updatedAt` mohou změnit. Do adresy nepřidávej heslo. Adresa končící `/dev` je testovací a do aplikace nepatří.

8. **Připoj obě zařízení.** V nastavení rozpočtové aplikace na telefonu vlož URL končící `/exec` a heslo z `SYNC_SECRET` do jejich samostatných polí. Stejné údaje nastav na notebooku. Spusť synchronizaci na zařízení se svým aktuálním rozpočtem, potom na druhém zařízení. Pokud aplikace nabídne řešení souběžných změn, přečti si rozdíly před potvrzením.

9. **Zkontroluj přenos a tabulku.** Udělej drobnou změnu v aplikaci, synchronizuj ji a ověř výsledek na druhém zařízení. V Google Tabulce slouží list `_data` jako úložiště původního dokumentu JSON rozděleného do částí. List `Přehled` zobrazuje čitelné údaje a skript ho při ukládání znovu vytváří. Částky jsou číselné buňky s českým formátováním měny. Ruční úpravy tabulky se do aplikace neimportují; rozpočet upravuj v aplikaci. Změny v `Přehled` může další synchronizace přepsat a úpravy `_data` mohou poškodit uložená data.

   `_data` uchovává dvě střídající se kopie; buňka B1 určuje aktivní slot. Sloupce H a I obsahují části JSON s technickým prefixem `j:`. Nepřepisuj je. Když Google přeruší zápis přehledu, příští kontrola URL nebo načtení obnoví přehled z posledního potvrzeného dokumentu. Skript nastaví celé tabulce české národní prostředí, aby čísla měla desetinnou čárku.

10. **Při aktualizaci kódu nasaď novou verzi.** Po změně `Kod.gs` otevři **Nasadit → Spravovat nasazení** (**Deploy → Manage deployments**), uprav stávající nasazení tužkou a vyber **Nová verze** (**New version**). Potvrď nasazení; stávající URL zůstane zachovaná. Samotné změny vlastností `SYNC_SECRET` nebo `SPREADSHEET_ID` nové nasazení nepotřebují. Po změně hesla ho aktualizuj na obou zařízeních.

## Když synchronizace nefunguje

Začni kontrolou `/exec` v anonymním okně. Pokud místo JSON uvidíš přihlášení nebo stránku HTML, ověř adresu, přístup **Kdokoli** a nasazenou verzi. HTML může znamenat také chybu Googlu nebo vyčerpanou kvótu; podrobnosti hledej v části **Spuštění** (**Executions**) v Apps Script.

Chyba CORS, tedy omezení přístupu mezi různými weby v prohlížeči, může zakrývat špatné nasazení, přihlašovací stránku nebo HTML chybu. Pro požadavek z aplikace musí zůstat `Content-Type: text/plain;charset=utf-8`, bez vlastních hlaviček. Tělo je JSON a obsahuje také heslo; heslo nepatří do URL ani do hlavičky. `application/json` nebo vlastní hlavičky mohou vyvolat předběžný požadavek OPTIONS, který toto nasazení neobsluhuje. Klient má následovat přesměrování (`redirect: 'follow'`) a nepoužívat mezipaměť (`cache: 'no-store'`). Při potížích po novém nasazení zkus anonymní okno nebo vymaž mezipaměť: prohlížeč může držet staré přesměrování. Pokud tyto volby aplikace nenabízí, jde o nastavení jejího klientského kódu.

Skript vrací své zachycené chyby jako JSON při **HTTP 200**. Rozhoduje `ok` a chybový `code` uvnitř odpovědi, ne samotný stav HTTP. Toto pravidlo neplatí pro chyby vytvořené Googlem ještě před spuštěním skriptu. Kódy znamenají:

| `code` | Význam a další krok |
| --- | --- |
| `400` | Nečitelný JSON, neplatná operace nebo `baseRev`. Zkontroluj verzi aplikace a formát požadavku. |
| `401` | Nesouhlasí heslo. Porovnej samostatné pole v aplikaci s `SYNC_SECRET`, včetně případných mezer. |
| `409` | Mezitím uložilo změny jiné zařízení. Načti aktuální verzi a nech aplikaci sloučit změny. Při souběžné změně stejné plánované částky výslovně vyber správnou hodnotu. Nepřepisuj celý dokument naslepo. |
| `413` | Dokument překročil 1 000 000 znaků UTF-16, případně celé tělo požadavku 1 100 000. Počítají se jednotky UTF-16, nikoli bajty; některé emoji zabírají dvě. Zmenši dokument. |
| `422` | Dokument neodpovídá očekávanému schématu. Ověř kompatibilitu aplikace a skriptu; neopravuj ho ručně v `_data`. |
| `500` | Chybí konfigurace nebo selhalo úložiště. Ověř obě vlastnosti skriptu, ID tabulky, přístup vlastníka a záznam v **Spuštění**. |
| `503` | Úložiště právě zamkl jiný požadavek. Chvíli počkej a synchronizaci zopakuj. |

## Co znamená provoz zdarma

Pro osobní Google účet nepotřebuješ v tomto postupu placený tarif ani fakturaci. Google však omezuje službu kvótami a může je změnit. Aktuální hodnoty ověř v [přehledu kvót Google Apps Script](https://developers.google.com/apps-script/guides/services/quotas).

Pro představu: 600 operací denně při předpokládané délce jedné operace 1 sekunda znamená 10 minut běhu. To je přibližně 11 % z 90 minut. **Dokumentovaný limit 90 minut denně se týká celkového běhu spouštěčů**, nikoli obecného denního přídělu procesorového času pro webové aplikace. Tento výpočet proto negarantuje kapacitu 600 operací ani dostupnost služby. Jedno spuštění má limit 6 minut; skutečnou kapacitu ovlivňuje délka požadavků, souběh a další kvóty služeb.

## Jak chránit přístup

Kdokoli zná URL nasazení a `SYNC_SECRET`, může přes skript číst a zapisovat rozpočet v tabulce pod oprávněním tvého Google účtu. Chraň obě hodnoty; tabulku ani projekt nesdílej veřejně. URL s heslem ve sdíleném odkazu nebo adresním řádku není silné ověřování a tento postup ji nepoužívá. Heslo posílej pouze v těle JSON přes HTTPS, nikdy v URL nebo hlavičce, a při úniku ho změň v nastavení projektu i obou zařízení.
