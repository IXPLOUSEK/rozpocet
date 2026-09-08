# Kontrakt fragmentů — čti PŘED psaním jakéhokoliv fragmentu

Všechny JS fragmenty se slepí do **jedné IIFE** v jednom `<script>`.
Sdílí tedy jeden lexikální scope. Kolize jmen = rozbitá appka.

## Železná pravidla

1. **Nikde `innerHTML`.** Jen `tpl(id)` klony, `el()`, `svgEl()`, `textContent`.
2. **Nikde `input[type=number]`.** Vždy `type="text" inputmode="decimal"`.
3. **Nikde `toISOString()`** pro odvození měsíce nebo dne. Používej `monthKey()`,
   `todayISO()`, `ymd()` z `31-util.js`.
4. **Nikde `parseFloat` / `Number(x)` na uživatelský vstup.** Jen `parseCzkInput()`.
5. **Částky jsou vždy celé haléře** (integer minor units). 1 450 000 = 14 500 Kč.
   Nikdy float. Nikdy string. `Number.isSafeInteger` musí platit.
6. **Patch funkce nesmí sáhnout na prvek, ve kterém je `document.activeElement`.**
7. **Žádné síťové volání** kromě `55-sync.js`, a to jen když je `syncUrl` neprázdné.
8. Každý fragment začíná komentářem `// <soubor> — <co dělá> — vlastní: <dráha>`.

## Rezervace jmen (top-level `const`/`let`/`function`)

| Fragment | Smí deklarovat prefix / jména |
|---|---|
| `30-config.js` | `SECTIONS SECTION_BY_KEY MONTHS_NOM MONTHS_GEN MONTHS_SHORT DAYS_SHORT TXT SCHEMA STORE_KEY BACKUP_KEY SNAP_PREFIX QUAR_PREFIX DEFAULT_CATALOG NBSP APP_VERSION` |
| `31-util.js` | `uid num clamp parseCzkInput formatCzk formatSigned fmtEdit pct monthKey ymd todayISO parseYmd daysInMonth dueDateFor isInMonth addMonths monthLabelCs monthShortCs fmtDateShort fmtDateLong daysBetween daysUntil relDaysCs cmpCs debounce rafOnce el svgEl qs qsa tpl setText setAttrIf setBarWidth escapeCsv deepEqual roundMinor sumMinor` |
| `32-storage.js` | `storage*` `save*` `load*` `snapshot*` `quarantine*` `migrate` `MIGRATIONS` `emptyDoc` `newYear` |
| `33-model.js` | `state` `getYear getMonthObj getCat getEntry ensureEntry ensureMonth addCatalogItem updateCatalogItem archiveCatalogItem setPlanned setActual clearActual togglePaid setEntryDue removeEntry reorderSection addTx updateTx removeTx setGoal setSetting bump undoPush undoLast` |
| `34-derived.js` | `txByCat effActual computeMonth computeYear computeGoals computeDue dailySlices savingsSlices invalidate invalidateAll orphanTx` |
| `40-charts.js` | `chart*` `polar arcPath donutDash niceScale progressPct renderLegend hueFor` |
| `50-month.js` | `renderMonthScreen renderSectionCard renderRow patchMonth patchRow patchTotals patchAlertCard rowIndex renderMonthStrip patchMonthStrip` |
| `51-journal.js` | `renderJournalScreen renderTxItem patchJournal quickAddSubmit txDayGroups recentCats applyJournalFilter` |
| `52-due-goals.js` | `dueStatus dueList dueLabel markPaid renderSavingsScreen renderGoalCard patchSavings goalProgress goalPace goalEtaText` |
| `53-io.js` | `exportJSON exportCSVMonth deliverFile copyFallback pickImportFile importJSON validateImport applyImport printMonth printYear renderPrintView renderPrintYear beforePrintHook afterPrintHook` |
| `54-year-more.js` | `renderYearScreen renderYearRows patchYear renderSettingsScreen patchSettings yearMetric` |
| `55-sync.js` | `syncOn syncPush syncPull syncMerge syncTest syncStatusText patchSyncStatus APPS_SCRIPT_SNIPPET` |
| `60-events.js` | `ACTIONS bindGlobalEvents onClick onInput onChange onFocusIn onFocusOut onKeyDown bindSwipe route goScreen goMonth goYear patch renderApp` |
| `61-sheets.js` | `openSheet closeSheet sheet* trapFocus toast announce confirmSheet inputSheet` |
| `70-selftest.js` | `selfTest assert* T_*` |
| `80-boot.js` | `boot guardStorage applyTheme watchScheme detectStandalone maybeInstallNag registerSW firstRunSeed installErrorHandler makeDemoData` |

Cokoliv dalšího uvnitř funkce je volné. **Nepřidávej top-level jméno mimo svůj řádek.**

## Datový model — viz `src/_MODEL.md`

## Kde se co zavěsí

- `60-events.js` drží `ACTIONS`. Jiný fragment do něj přidává klíče takto:
  `Object.assign(ACTIONS, { 'tx.add': (ctx, e) => {...} });` — **na konci svého souboru**.
- `renderApp()` v `60-events.js` volá `render<Obrazovka>()` podle `state.ui.screen`.
- `patch()` v `60-events.js` volá `patchMonth/patchYear/patchJournal/patchSavings`
  podle aktivní obrazovky. Patch funkce musí být bezpečné i když jejich
  obrazovka není vykreslená (na začátku `if (!qs('#screen-x.is-active')) return;`).

## CSS

- Vše přes tokeny z `10-tokens.css`. Žádný natvrdo zapsaný hex mimo tokeny.
- Třídy jsou `kebab-case`, stavy `is-*`, bloky podle komponenty.
- `input, select, textarea { font-size: 16px }` je v `11-base.css` a je nedotknutelné.
