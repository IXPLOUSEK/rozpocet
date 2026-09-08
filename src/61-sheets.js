// 61-sheets.js — spodní panely, hlášky, potvrzení — vlastní: L0
// Žádný prompt() ani confirm() — v appce na ploše se chovají nespolehlivě.

let _sheetStack = [];
let _lastFocus = null;

function trapFocus(root) {
  const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    const items = qsa(sel, root).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

// openSheet({title, build(bodyEl), foot:[{label, act, kind, onClick}], onClose})
// Vrací Promise, která se naplní tím, co předá closeSheet().
function openSheet(opts) {
  const host = qs('#sheet-host');
  const backdrop = qs('#sheet-backdrop');
  if (!host) return Promise.resolve(null);
  _lastFocus = document.activeElement;

  const sheet = tpl('tpl-sheet');
  setText(sheet.querySelector('[data-d="title"]'), opts.title || '');
  const body = sheet.querySelector('[data-d="body"]');
  const foot = sheet.querySelector('[data-d="foot"]');

  let resolveFn = null;
  const p = new Promise(function (res) { resolveFn = res; });

  if (typeof opts.build === 'function') opts.build(body, sheet);

  (opts.foot || []).forEach(function (b) {
    const btn = el('button', { class: 'btn ' + (b.kind ? 'btn-' + b.kind : 'btn-ghost') }, b.label);
    btn.addEventListener('click', function () {
      if (typeof b.onClick === 'function') { const r = b.onClick(body, sheet); if (r === false) return; closeSheet(r); }
      else closeSheet(b.value === undefined ? null : b.value);
    });
    foot.appendChild(btn);
  });
  if (!(opts.foot || []).length) foot.remove();

  host.replaceChildren(sheet);
  host.hidden = false;
  if (backdrop) backdrop.hidden = false;
  document.body.classList.add('has-sheet');
  trapFocus(sheet);
  _sheetStack.push({ sheet: sheet, resolve: resolveFn, onClose: opts.onClose });

  requestAnimationFrame(function () {
    sheet.classList.add('is-open');
    const first = sheet.querySelector('input, button:not(.sheet-close)');
    if (first && opts.autofocus !== false) { try { first.focus({ preventScroll: true }); } catch (e) {} }
  });
  return p;
}

function closeSheet(result) {
  const top = _sheetStack.pop();
  const host = qs('#sheet-host');
  const backdrop = qs('#sheet-backdrop');
  if (!top) { if (host) host.hidden = true; if (backdrop) backdrop.hidden = true; return; }
  top.sheet.classList.remove('is-open');
  document.body.classList.remove('has-sheet');
  if (host) { host.hidden = true; host.replaceChildren(); }
  if (backdrop) backdrop.hidden = true;
  if (typeof top.onClose === 'function') top.onClose(result);
  top.resolve(result);
  if (_lastFocus && _lastFocus.isConnected) { try { _lastFocus.focus({ preventScroll: true }); } catch (e) {} }
}

// Potvrzení. Destruktivní tlačítko nese sloveso, druhé je jen "Zpět".
function confirmSheet(o) {
  return openSheet({
    title: o.title,
    build: function (body) {
      body.appendChild(el('p', { class: 'sheet-text' }, o.body || ''));
      if (o.typeToConfirm) {
        const f = tpl('tpl-field');
        setText(f.querySelector('[data-d="label"]'), o.typeToConfirm);
        const inp = f.querySelector('input');
        inp.setAttribute('autocapitalize', 'characters');
        inp.dataset.f = 'confirm';
        body.appendChild(f);
      }
    },
    foot: [
      { label: TXT.cancel, kind: 'ghost', value: false },
      {
        label: o.okLabel || TXT.ok, kind: o.danger ? 'danger' : 'primary',
        onClick: function (body) {
          if (o.typeToConfirm) {
            const v = body.querySelector('[data-f="confirm"]');
            if (!v || v.value.trim().toUpperCase() !== (o.typeWord || 'SMAZAT')) {
              v && v.classList.add('is-invalid');
              return false;
            }
          }
          return true;
        }
      },
    ],
  });
}

// Textový nebo číselný vstup místo prompt().
function inputSheet(o) {
  return openSheet({
    title: o.title,
    build: function (body) {
      const f = tpl('tpl-field');
      setText(f.querySelector('[data-d="label"]'), o.label || '');
      setText(f.querySelector('[data-d="hint"]'), o.hint || '');
      const inp = f.querySelector('input');
      inp.dataset.f = 'value';
      inp.value = o.value === undefined || o.value === null ? '' : String(o.value);
      if (o.numeric) { inp.setAttribute('inputmode', 'decimal'); inp.setAttribute('enterkeyhint', 'done'); }
      if (o.placeholder) inp.setAttribute('placeholder', o.placeholder);
      body.appendChild(f);
    },
    foot: [
      { label: TXT.cancel, kind: 'ghost', value: null },
      {
        label: o.okLabel || TXT.save, kind: 'primary',
        onClick: function (body) {
          const v = body.querySelector('[data-f="value"]').value;
          if (o.numeric) {
            const r = parseCzkInput(v);
            if (!r.ok) { body.querySelector('[data-f="value"]').classList.add('is-invalid'); return false; }
            return r.minor;
          }
          const t = String(v).trim();
          if (o.required && !t) { body.querySelector('[data-f="value"]').classList.add('is-invalid'); return false; }
          return t;
        }
      },
    ],
  });
}

/* ---------- hlášky ---------- */

function toast(msg, o) {
  const host = qs('#toast-host');
  if (!host) return;
  const opts = o || {};
  const node = tpl('tpl-toast');
  setText(node.querySelector('[data-d="text"]'), msg);
  const act = node.querySelector('[data-d="action"]');
  if (opts.action) {
    setText(act, opts.action);
    act.hidden = false;
    node._onAction = opts.onAction || null;
  } else if (act) act.remove();
  if (opts.kind) node.classList.add('toast-' + opts.kind);
  host.appendChild(node);
  requestAnimationFrame(function () { node.classList.add('is-in'); });
  setTimeout(function () {
    node.classList.remove('is-in');
    setTimeout(function () { if (node.isConnected) node.remove(); }, 250);
  }, opts.ms || 4200);
  announce(msg);
}

function announce(msg) {
  const live = qs('#sr-live');
  if (live) setText(live, msg);
}

// Trvalý pruh nahoře. `id` zabrání zdvojení, `dismissible` povolí křížek.
function sheetBanner(o) {
  const host = qs('#banner-host');
  if (!host) return null;
  if (o.id && qs('[data-banner="' + o.id + '"]', host)) return null;
  const b = tpl('tpl-banner');
  if (o.id) b.dataset.banner = o.id;
  if (o.kind) b.classList.add('banner-' + o.kind);
  setText(b.querySelector('[data-d="icon"]'), o.icon || 'ℹ️');
  setText(b.querySelector('[data-d="title"]'), o.title || '');
  setText(b.querySelector('[data-d="body"]'), o.body || '');
  const act = b.querySelector('[data-d="action"]');
  if (o.action) { setText(act, o.action); act.dataset.act = o.act || ''; act.hidden = false; }
  const close = b.querySelector('.banner-close');
  if (o.dismissible && close) close.hidden = false;
  host.appendChild(b);
  return b;
}

function sheetBannerClear(id) {
  const n = qs('[data-banner="' + id + '"]');
  if (n) n.remove();
}
