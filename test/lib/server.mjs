// test/lib/server.mjs — statický server na 127.0.0.1:8173.
//
// PROČ vůbec server: Safari/WebKit hodí na localStorage z file:// SecurityError.
// Kdyby testy běžely přes file://, tiše by testovaly nouzovou větev v paměti
// a tvrdily, že ukládání funguje. Proto všechno kromě jednoho schválně
// file:// testu jede přes http://127.0.0.1:8173.
//
// PROČ node:http a ne `python3 -m http.server`: WebKit se na téhle Fedoře
// nedá spustit (chybí libicu74) a jede se v kontejneru přes tools/wk.sh.
// V tom obrazu python3 na PATH být nemusí. Tenhle server je součást procesu,
// takže skončí s ním.
//
// PROČ NIKDY PEVNÝ PORT: pevné číslo je sdílený zdroj. Když ho drží něco
// jiného nebo po sobě nechal viset dřívější běh, testy spadnou na
// ERR_CONNECTION_REFUSED nebo — mnohem hůř — se připojí na CIZÍ server
// a tiše testují cizí stránku. `listen(0)` si nechá port přidělit
// systémem a nikomu do zelí neleze.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';

export const HOST = '127.0.0.1';

// Živé vazby: nastaví se, až server naslouchá. Importující moduly
// (page.mjs) je vidí aktualizované — proto `let`, ne `const`.
export let PORT = 0;
export let ORIGIN = '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

export async function startServer(root) {
  const srv = createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url || '/').split('?')[0].split('#')[0])
      .replace(/^\/+/, '') || 'rozpocet.html';
    // Ven z kořene se nedostaneš.
    const safe = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
    if (safe.split(sep).includes('..')) { res.writeHead(403); res.end('403'); return; }
    const file = join(root, safe);
    stat(file)
      .then((st) => {
        if (!st.isFile()) throw new Error('není soubor');
        return readFile(file);
      })
      .then((buf) => {
        res.writeHead(200, {
          'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(buf);
      })
      .catch(() => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); });
  });

  // listen(0) = "dej mi jakýkoli volný port". Nikdy pevné číslo.
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, HOST, resolve);
  });
  PORT = srv.address().port;
  ORIGIN = `http://${HOST}:${PORT}`;

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await new Promise((r) => srv.close(r));
    // Spojení, která drží keep-alive, by server nechala viset i po close().
    srv.closeAllConnections?.();
  };
  return { origin: ORIGIN, stop, reused: false, server: srv };
}
