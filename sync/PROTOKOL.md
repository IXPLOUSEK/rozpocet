# Rozpočet — synchronizační protokol 1.0.0

Klient používá URL publikované webové aplikace Google Apps Script (`/exec`). Server ukládá celý dokument a hlídá souběh pomocí revize (CAS). Sdílené tajemství patří pouze do těla POST; nikdy do URL ani hlavičky. Z odesílané kopie dokumentu odstraň `settings.syncSecret`; připojovací nastavení zachovej lokálně.

## Přenos

| Volba `fetch` pro operace | Hodnota |
| --- | --- |
| `method` | `POST` |
| `headers` | Pouze `Content-Type: text/plain;charset=utf-8` |
| `body` | JSON převedený na řetězec; obsahuje `secret` a `op` |
| `redirect` | `follow` |
| `cache` | Povinně `no-store`; Safari může u cachovaného přesměrování mezi originy ztratit CORS hlavičky. |
| `credentials` | Doporučeno `omit` |
| `mode` | `cors` nebo výchozí režim; nikdy `no-cors` |
| Časový limit klienta | Nejméně 45 s; server čeká na zámek až 30 s. |

Všechny odpovědi zpracované skriptem jsou JSON s HTTP **200**, včetně chyb. Vyhodnocuj `ok` a případné `code`, nestačí HTTP status. Infrastruktura může vrátit HTML, jiný status nebo síťovou chybu; neplatný JSON se nepovažuje za úspěch.

## Operace a skutečné JSON příklady

**GET** bez tajemství vrací veřejný stav; `hasDoc`, `rev` a `updatedAt` popisují uložená data. Prázdný server:

```json
{"ok":true,"app":"rozpocet-sync","version":"1.0.0","hasDoc":false,"rev":0,"updatedAt":null}
```

POST povoluje pouze operace v tabulce. `TAJEMSTVI` nahraď nastaveným tajemstvím. Čas v příkladu je ilustrativní.

| Operace | Tělo požadavku | Odpověď |
| --- | --- | --- |
| `ping` | `{"secret":"TAJEMSTVI","op":"ping"}` | `{"ok":true}` |
| `pull`, prázdný server | `{"secret":"TAJEMSTVI","op":"pull"}` | `{"ok":true,"rev":0,"doc":null}` |
| `pull`, uložený dokument | `{"secret":"TAJEMSTVI","op":"pull"}` | `{"ok":true,"rev":1,"updatedAt":"2026-09-08T08:12:44.120Z","doc":{"app":"rozpocet","schema":1,"years":{}}}` |
| `push`, první zápis | `{"secret":"TAJEMSTVI","op":"push","baseRev":0,"doc":{"app":"rozpocet","schema":1,"years":{}}}` | `{"ok":true,"rev":1}` |
| `push`, zastaralá revize | `{"secret":"TAJEMSTVI","op":"push","baseRev":0,"doc":{"app":"rozpocet","schema":1,"years":{}}}` | `{"ok":false,"code":409,"error":"Revize se změnila. Slouč data a opakuj zápis.","rev":1,"doc":{"app":"rozpocet","schema":1,"years":{}}}` |

## Dokument a sloučení

Závazný model je v [src/_MODEL.md](../src/_MODEL.md). Minimální platný dokument je `{"app":"rozpocet","schema":1,"years":{}}`. Vyplněný rok obsahuje `catalog`, přesně 12 `months` s indexy 0–11 a `tx`. Částky jsou nezáporná celá čísla v haléřích; směr určuje sekce. `entry.act:null` znamená součet deníku, číselná hodnota ruční skutečnost; přidání transakce ji nepřepisuje. `tx.m` je samostatný rozpočtový měsíc. Odvozené součty se neukládají. Mazání zachovává `entry.del`, `tx.del` a `cat.archived`.

Serverová `rev` je oddělená od lokální `doc.rev`; `baseRev` musí být nezáporné bezpečné celé číslo získané ze serveru. Úspěšný zápis zvýší serverovou revizi. Uchovávej poslední společnou verzi dokumentu. Při 409 použij vrácený dokument nebo proveď `pull`, sluč lokální změny a opakuj `push` s novou `baseRev`. Server sám neslučuje.

Slučuj záznamy podle stabilních ID a jejich `updatedAt`; různé nově přidané ID sjednoť, příznaky smazání zachovej. Porovnej obě strany se společnou základní verzí: pokud obě změnily stejný plán, **vyžaduj výslovnou volbu uživatele**, nerozhoduj automaticky časem. Stejné časové značky s různým obsahem rovněž vyžadují volbu uživatele. Hodiny zařízení ani nejnovější čas celého dokumentu nesmějí přepsat druhou verzi jako celek.

## Chyby a opakování

Kromě konfliktu má chyba tvar `{"ok":false,"code":400,"error":"Popis chyby"}`; text `error` je pro zobrazení, rozhodování řiď číslem `code`.

| `code` | Význam a postup klienta |
| --- | --- |
| 400 | Neplatný JSON, tělo není objekt, neznámá operace nebo neplatné `baseRev`; oprav požadavek. |
| 401 | Chybějící nebo nesprávné tajemství; oprav místní nastavení. |
| 409 | Revize se změnila; odpověď navíc obsahuje aktuální `rev` a `doc`; sluč a opakuj. |
| 413 | Serializovaný dokument přesahuje 1 000 000 jednotek UTF-16 nebo požadavek 1 100 000; zmenši data. |
| 422 | Neplatné schéma nebo hodnoty dokumentu; oprav data podle modelu. |
| 500 | Chyba konfigurace, interní chyba nebo poškozené uložené údaje; zachovej lokální data a řeš příčinu. |
| 503 | Zámek nebyl získán přes `tryLock(30000)`; opakuj nejvýše 5× po 1/2/4/8/16 s s náhodným přídavkem (jitter). |

Při chybě zachovej lokální změny. Po síťové chybě či timeoutu může být zápis už uložený: před dalším odesláním proveď `pull` a porovnej/sluč stav. Nikdy slepě neopakuj zápis, jehož výsledek není znám.
