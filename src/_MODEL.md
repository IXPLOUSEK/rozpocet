# Datový model — závazný

Částky = **celé haléře**. 14 500 Kč → `1450000`.

```jsonc
{
  "app": "rozpocet", "schema": 1, "rev": 0,
  "savedAt": "2026-09-08T08:12:44.120Z",
  "deviceId": "d_m4k9x1",
  "activeYear": 2026,
  "isDemo": false,
  "settings": {
    "theme": "auto",            // auto | light | dark
    "dueSoonDays": 7,
    "autofillOnPaid": true,
    "syncUrl": "", "syncSecret": "", "lastSyncAt": null,
    "lastExportAt": null,
    "installNagDismissedAt": null
  },
  "ui": { "screen": "month", "month": 8, "yearTab": "summary", "journalFilter": "all" },
  "years": {
    "2026": {
      "year": 2026,
      "catalog": [
        { "id":"c_x", "sec":"fixed", "name":"Nájem", "icon":"🏠", "order":10,
          "recurring":true, "dueDay":15, "goal":null,
          "archived":false, "createdAt":"...", "updatedAt":"..." }
      ],
      "months": [ /* vždy 12 položek, index 0..11 */
        { "m":0, "note":"", "entries":[
          { "id":"e_x", "cat":"c_x", "plan":1450000, "act":1450000,
            "paid":true, "paidAt":"2026-01-03", "due":null,
            "autoFilled":false, "del":false, "updatedAt":"..." }
        ] }
      ],
      "tx": [
        { "id":"t_x", "d":"2026-09-08", "m":8, "cat":"c_jidlo",
          "amt":38950, "note":"Lidl", "del":false, "updatedAt":"..." }
      ]
    }
  }
}
```

## Pravidla

1. `entry.act === null` → **skutečnost se počítá z deníku** (součet `tx` té
   kategorie v tom měsíci). `entry.act === číslo` → **ručně zadáno, vyhrává**.
   `addTx()` do `entry.act` NIKDY nezapisuje.
2. Částky se ukládají **kladně**. Směr určuje `SECTIONS[sec].dir`.
   `zůstatek = příjmy − (fixed + daily + savings + debt + subs)`.
3. `tx.m` = rozpočtový měsíc (0–11), odvozený z `tx.d` při vzniku, ale
   samostatně měnitelný.
4. `entry.due` přebíjí `cat.dueDay`. `null` = použij katalog.
   Den 29–31 se ořezává funkcí `dueDateFor()`.
5. Mazání je měkké: `entry.del`, `tx.del`, `cat.archived`.
6. Odvozená čísla se **neukládají**. Rok = součet měsíců.
7. `cat.goal = { target, startBalance, targetDate }` jen pro `sec:"savings"`.
   Naspořeno = `startBalance` + součet skutečností té kategorie za celý rok.
8. `bump(rec)` nastaví `rec.updatedAt` a zvýší `state.rev`. Memoizace
   v `34-derived.js` je klíčovaná na `state.rev`.
