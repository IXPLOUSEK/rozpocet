// 30-config.js — konstanty, sekce, české texty — vlastní: L0
// Žádné funkce, jen zmrazená data.

// Záchyt chyb se instaluje jako úplně první věc v celém skriptu. boot() běží
// až na konci; kdyby se cokoliv dřív rozbilo při načítání, bez tohohle by
// zůstala jen bílá stránka bez jediného slova vysvětlení.
(function () {
  if (typeof window === 'undefined' || window.__rozpocetEarlyGuard) return;
  window.__rozpocetEarlyGuard = true;
  window.addEventListener('error', function (ev) {
    if (window.__rozpocetBooted) return;          // po startu si to bere boot()
    try {
      const d = document.createElement('div');
      d.setAttribute('role', 'alert');
      d.style.cssText = 'margin:16px;padding:16px;border-radius:12px;background:#FFE4E6;'
        + 'color:#0B0B0C;font:16px/1.5 -apple-system,system-ui,sans-serif';
      d.textContent = 'Aplikaci se nepodařilo spustit. Data jsou pořád uložená v telefonu. '
        + 'Zavři ji a otevři znovu; když to nepomůže, napiš mi. (' + (ev && ev.message ? ev.message : '') + ')';
      document.body.appendChild(d);
    } catch (e) { /* i tohle může selhat, pak už opravdu nejde nic */ }
  });
})();

const APP_VERSION = '1.0.0';
const SCHEMA = 1;
const STORE_KEY = 'rozpocet:doc';
const BACKUP_KEY = 'rozpocet:doc:backup';
const SNAP_PREFIX = 'rozpocet:snap:';
const QUAR_PREFIX = 'rozpocet:quarantine:';
const NBSP = ' ';

const SECTIONS = Object.freeze([
  { key: 'income',  label: 'PŘÍJMY',            short: 'Příjmy',     dir:  1, hasDue: false, hasGoal: false, addLabel: 'Přidat příjem' },
  { key: 'fixed',   label: 'FIXNÍ NÁKLADY',     short: 'Fixní',      dir: -1, hasDue: true,  hasGoal: false, addLabel: 'Přidat fixní náklad' },
  { key: 'daily',   label: 'KAŽDODENNÍ VÝDAJE', short: 'Každodenní', dir: -1, hasDue: false, hasGoal: false, addLabel: 'Přidat výdaj' },
  { key: 'savings', label: 'ÚSPORY',            short: 'Úspory',     dir: -1, hasDue: false, hasGoal: true,  addLabel: 'Přidat úsporu' },
  { key: 'debt',    label: 'DLUH',              short: 'Dluh',       dir: -1, hasDue: true,  hasGoal: false, addLabel: 'Přidat dluh' },
  { key: 'subs',    label: 'PŘEDPLATNÉ',        short: 'Předplatné', dir: -1, hasDue: true,  hasGoal: false, addLabel: 'Přidat předplatné' },
]);
const SECTION_BY_KEY = Object.freeze(Object.fromEntries(SECTIONS.map(s => [s.key, s])));

// Nominativ — pro nadpis a přepínač měsíců.
const MONTHS_NOM = Object.freeze(['Leden','Únor','Březen','Duben','Květen','Červen',
  'Červenec','Srpen','Září','Říjen','Listopad','Prosinec']);
// Genitiv — jen když před názvem stojí den ("15. ledna").
const MONTHS_GEN = Object.freeze(['ledna','února','března','dubna','května','června',
  'července','srpna','září','října','listopadu','prosince']);
const MONTHS_SHORT = Object.freeze(['Led','Úno','Bře','Dub','Kvě','Čvn',
  'Čvc','Srp','Zář','Říj','Lis','Pro']);
const DAYS_SHORT = Object.freeze(['po','út','st','čt','pá','so','ne']);

// Doporučené kategorie. Nasadí se JEN když si to uživatelka na uvítací
// obrazovce vybere. Aplikace sama od sebe nic nezakládá.
const DEFAULT_CATALOG = Object.freeze([
  { sec:'income',  name:'Výplata',                    icon:'💰' },
  { sec:'income',  name:'Brigáda a přivýdělek',       icon:'💵' },
  { sec:'fixed',   name:'Nájem',                      icon:'🏠', dueDay: 15 },
  { sec:'fixed',   name:'Zálohy (voda, elektřina)',   icon:'⚡', dueDay: 20 },
  { sec:'fixed',   name:'Internet',                   icon:'🌐', dueDay: 18 },
  { sec:'fixed',   name:'Telefon',                    icon:'📱', dueDay: 12 },
  { sec:'fixed',   name:'Pojištění',                  icon:'🛡️', dueDay: 10 },
  { sec:'daily',   name:'Jídlo a potraviny',          icon:'🛒' },
  { sec:'daily',   name:'Restaurace a kafe',          icon:'☕' },
  { sec:'daily',   name:'Drogerie',                   icon:'🧴' },
  { sec:'daily',   name:'Doprava',                    icon:'🚌' },
  { sec:'daily',   name:'Oblečení',                   icon:'👕' },
  { sec:'daily',   name:'Zdraví a léky',              icon:'💊' },
  { sec:'daily',   name:'Zábava',                     icon:'🎟️' },
  { sec:'daily',   name:'Dárky',                      icon:'🎁' },
  { sec:'savings', name:'Nouzová rezerva',            icon:'🛟' },
  { sec:'savings', name:'Dovolená',                   icon:'✈️' },
  { sec:'savings', name:'Fond pro radost',            icon:'🎈' },
  { sec:'debt',    name:'Půjčka',                     icon:'🏦', dueDay: 5 },
  { sec:'subs',    name:'Netflix',                    icon:'🎬', dueDay: 12 },
  { sec:'subs',    name:'Spotify',                    icon:'🎵', dueDay: 3 },
]);

// Všechny české texty na jednom místě. Tykání, infinitivy na tlačítkách,
// věty velkým jen na začátku.
const TXT = Object.freeze({
  appName: 'Rozpočet',

  // navigace
  navMonth: 'Měsíc', navYear: 'Rok', navJournal: 'Deník',
  navSavings: 'Úspory', navMore: 'Víc',

  // souhrn
  kpiIncome: 'Příjmy', kpiExpense: 'Výdaje', kpiLeft: 'Zůstatek',
  kpiLeftHint: 'na den do konce měsíce',
  colPlan: 'Plán', colActual: 'Skutečnost', colActualShort: 'Skut.',
  colDue: 'Splatnost', colPaid: 'Zaplaceno', total: 'Celkem', diff: 'Rozdíl',

  // akce
  addItem: 'Přidat položku', save: 'Uložit', cancel: 'Zpět', del: 'Smazat',
  edit: 'Upravit', undo: 'Vrátit zpět', close: 'Zavřít', ok: 'Rozumím',
  copyFromLast: 'Zkopírovat z minulého měsíce',
  thisMonth: 'Tento měsíc',
  quickAdd: 'Rychlý zápis',
  useJournal: 'Použít deník',
  manualBadge: 'ručně',

  // zálohy
  backup: 'Stáhnout zálohu', restore: 'Načíst zálohu',
  exportCsv: 'Stáhnout jako tabulku (CSV)',
  print: 'Tisk / PDF',
  wipe: 'Vymazat všechna data',
  backupHint: 'Zálohu si ulož do iCloudu. Je to jediná kopie, kterou máš plně pod kontrolou.',

  // prázdné stavy
  emptySection: 'Zatím tu nic není.',
  emptyJournal: 'Tenhle měsíc jsi ještě nic nezapsala.',
  emptyGoals: 'Zatím nemáš žádný spořicí cíl.',

  // varování
  notInstalledTitle: 'Přidej si mě na plochu',
  notInstalledBody: 'Dokud tu nejsem jako ikona, iPhone může po týdnu tvoje data smazat. Klepni na Sdílet a pak na Přidat na plochu.',
  storageDeadTitle: 'Data se neukládají',
  storageDeadBody: 'Tenhle způsob otevření neumí nic uložit. Otevři aplikaci přes její webovou adresu nebo z ikony na ploše.',
  quotaTitle: 'Došlo místo',
  quotaBody: 'Prohlížeč odmítl uložit další data. Stáhni si zálohu, ať o nic nepřijdeš.',
  demoBanner: 'Ukázková data — nejsou to tvoje čísla.',
  demoWipe: 'Vymazat',
  corruptTitle: 'Uložená data byla poškozená',
  corruptBody: 'Nic jsme nesmazali — původní soubor je odložený stranou. Můžeš načíst zálohu.',

  // potvrzení
  wipeConfirmTitle: 'Opravdu vymazat všechna data?',
  wipeConfirmBody: 'Přijdeš o všechny měsíce, položky i částky. Vrátit to nejde. Nejdřív si stáhni zálohu.',
  wipeConfirmType: 'Napiš SMAZAT',
  importConfirmTitle: 'Nahradit současná data?',
  importConfirmBody: 'Načtením zálohy přepíšeš všechno, co tu teď je.',

  saved: 'Uloženo',
});
