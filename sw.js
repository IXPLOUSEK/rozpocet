// sw.js — aby appka na ploše fungovala i bez signálu.
// Bez service workeru iOS u appky na ploše offline hlásí "nejsi připojen".
// Registrovat relativně (./sw.js), aby fungoval i podadresář na GitHub Pages.
const CACHE = 'rozpocet-v1';
// Kandidáti na předvyplnění. Podle toho, jak je appka nasazená, některé
// z nich neexistují — proto se ukládá každý zvlášť. cache.addAll() by při
// jediné chybějící adrese zahodilo celou dávku a offline by tiše nefungovalo.
const SHELL = ['./', './index.html', './rozpocet.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: z cache hned, na pozadí se stáhne novější verze.
// Cizí původ (synchronizace přes Google) se nikdy neukládá ani neobsluhuje.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          // waitUntil drží worker naživu, dokud se kopie nedopíše. Bez toho
          // iOS vlákno ukončí a novější verze se nikdy neuloží.
          e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
        }
        return res;
      }).catch(() => hit);
      if (hit) e.waitUntil(net.catch(() => null));
      return hit || net;
    })
  );
});
