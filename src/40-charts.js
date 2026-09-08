// 40-charts.js — ruční inline SVG grafy, bez jakékoliv knihovny — vlastní: L3
// Pravidla: žádná barva natvrdo (jen var(--…) nebo currentColor), žádné innerHTML,
// každý text přes textContent, každý graf se dá volat opakovaně.

/* ==================== matematika ==================== */
// Zaokrouhlení na 1e-6. Bez něj z cos(-π/2) vyleze 6.1e-17 a v atributu
// pak straší "50.000000000000004". Zároveň nikdy nevrací -0.
function chartNum(v) {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

// Text z uživatelských dat: nikdy undefined/null v popisku.
function chartText(v) { return v === null || v === undefined ? '' : String(v); }

// Nula stupňů je na dvanáctce, roste po směru hodinových ručiček.
function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return { x: chartNum(cx + r * Math.cos(a)), y: chartNum(cy + r * Math.sin(a)) };
}

// Samotný oblouk (bez středu). Výseč = arcPath(...) + " L cx cy Z".
function arcPath(cx, cy, r, a0, a1) {
  const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
  const sweep = a1 - a0;
  const large = Math.abs(sweep) > 180 ? 1 : 0;   // delší půlka kruhu
  const dir = sweep < 0 ? 0 : 1;                 // 1 = po směru ručiček
  return 'M' + p0.x + ' ' + p0.y + ' A' + chartNum(r) + ' ' + chartNum(r) +
         ' 0 ' + large + ' ' + dir + ' ' + p1.x + ' ' + p1.y;
}

// stroke-dasharray pro prstenec, když prohlížeč neumí pathLength.
// donutDash(0, r) musí vrátit "0 obvod", nikdy NaN.
function donutDash(ratio, r) {
  const rad = Number.isFinite(r) && r > 0 ? r : 0;
  const c = 2 * Math.PI * rad;
  const rr = Number.isFinite(ratio) ? clamp(ratio, 0, 1) : 0;
  const f = function (v) { return v.toFixed(4).replace(/\.?0+$/, ''); };  // "0.0000" -> "0"
  return f(rr * c) + ' ' + f(c);
}

// Horní hranice osy. Nikdy nevrací 0 — nulová osa by dál dělila nulou.
function niceScale(max) {
  if (!Number.isFinite(max) || max <= 0) return [0, 100];
  let pow = Math.pow(10, Math.floor(Math.log10(max)));
  let f = max / pow;
  if (f >= 10) { f /= 10; pow *= 10; }   // pojistka proti driftu log10
  if (f < 1) { f *= 10; pow /= 10; }
  const LADDER = [1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 4, 5, 6, 8, 10];
  let nice = 10;
  for (let i = 0; i < LADDER.length; i++) {
    if (f <= LADDER[i] + 1e-9) { nice = LADDER[i]; break; }
  }
  const t = nice * pow;
  return [0, t >= 1e6 ? Math.round(t) : Math.round(t * 1e6) / 1e6];
}

// 0/0 je NaN, x/0 je Infinity — obojí by prosáklo až do šířky pruhu.
function progressPct(saved, target) {
  const t = Number.isFinite(target) ? target : 0;
  const s = Number.isFinite(saved) ? saved : 0;
  if (!(t > 0)) return { ratio: 0, label: '—' };
  const raw = s / t;
  if (!Number.isFinite(raw)) return { ratio: 0, label: '—' };
  // Popisek smí přelézt 100 % (750 z 500 = "150 %"), poměr pruhu ne.
  return { ratio: clamp(raw, 0, 1), label: Math.round(Math.max(raw, 0) * 100) + NBSP + '%' };
}

// Barva kategorie podle pořadí. Vrací odkaz na token, ne hodnotu.
function hueFor(i) {
  const n = Number.isFinite(i) ? Math.floor(i) : 0;
  return 'var(--cat-' + ((((n % 12) + 12) % 12) + 1) + ')';
}

/* ==================== společná kostra ==================== */
let chartSeq = 0;
function chartUid(p) { chartSeq += 1; return 'ch-' + p + '-' + chartSeq; }

const chartHasPathLength = (typeof SVGGeometryElement !== 'undefined' &&
  'pathLength' in SVGGeometryElement.prototype);

function chartReduced() {
  return typeof matchMedia === 'function' && !!matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// role="img" + <title> (musí být první dítě) a <desc>, obojí v aria-labelledby.
function chartSvgRoot(w, h, title, desc, cls) {
  const tid = chartUid('t'), did = chartUid('d');
  const svg = svgEl('svg', {
    viewBox: '0 0 ' + chartNum(w) + ' ' + chartNum(h), role: 'img',
    preserveAspectRatio: 'xMidYMid meet',   // nikdy "none" — deformoval by text i kruhy
    'aria-labelledby': tid + ' ' + did, class: 'chart-svg' + (cls ? ' ' + cls : ''),
    style: 'width:100%;height:auto;display:block;font-variant-numeric:tabular-nums'
  });
  svg.appendChild(svgEl('title', { id: tid }, title || ''));
  svg.appendChild(svgEl('desc', { id: did }, desc || ''));
  return svg;
}

// Skrytá tabulka se stejnými čísly — odečítátko dostane data, ne obrázek.
function chartTable(caption, cols, rows) {
  // Tabulka se BALÍ do skrytého bloku. Samotná <table> se totiž chová jako
  // tabulka i se width:1px — roste podle obsahu a stránka pak přetéká do
  // stran. Blok kolem ní je oříznutelný, tabulka uvnitř zůstane tabulkou.
  const wrap = el('div', { class: 'sr-only chart-data-wrap' });
  const t = el('table', { class: 'chart-data' }), thead = el('thead'), head = el('tr');
  t.appendChild(el('caption', null, caption));
  cols.forEach(function (c) { head.appendChild(el('th', { scope: 'col' }, c)); });
  thead.appendChild(head); t.appendChild(thead);
  const tb = el('tbody');
  rows.forEach(function (r) {
    const tr = el('tr');
    r.forEach(function (cell, i) { tr.appendChild(i === 0 ? el('th', { scope: 'row' }, cell) : el('td', null, cell)); });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  wrap.appendChild(t);
  return wrap;
}

// viewBox se přepočítává ze skutečné šířky hostitele — jinak by se s obrázkem
// škáloval i text a na iPadu by byl dvakrát větší než ve zbytku appky.
function chartMount(host, build) {
  const st = host.__chart || (host.__chart = {});
  st.build = build;
  st.w = -1;   // vynutí překreslení i při stejné šířce
  st.run = function () {
    const w = Math.round(host.clientWidth || 0) || 320;
    if (w === st.w) return;
    st.w = w;
    host.replaceChildren.apply(host, st.build(w) || []);
  };
  if (!st.bound) {
    st.bound = true;
    const tick = function () { if (host.__chart && host.__chart.run) host.__chart.run(); };
    // Překreslení se odloží o jeden snímek. Kdyby běželo přímo v callbacku,
    // prohlížeč hlásí "ResizeObserver loop completed with undelivered
    // notifications" — pozorovatel by měnil rozvržení, které právě měří.
    let roPending = 0;
    const tickDeferred = function () {
      if (roPending) return;
      roPending = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame(function () { roPending = 0; tick(); })
        : setTimeout(function () { roPending = 0; tick(); }, 0);
    };
    if (typeof ResizeObserver === 'function') { st.ro = new ResizeObserver(tickDeferred); st.ro.observe(host); }
    else if (typeof addEventListener === 'function') { addEventListener('resize', tick, { passive: true }); }
  }
  st.run();
}

// Popisek hodnoty: dovnitř pruhu, když je dost široký, jinak vedle něj.
// Obrácený inkoust jen na plném pruhu. Světlý plánový pruh je jen odstín
// podkladu — bílý text by na něm byl nečitelný ve světlém i tmavém režimu.
function chartValueLabel(barW, yTop, barH, txt, fs, solid) {
  const inside = barW > 64;
  return svgEl('text', {
    x: chartNum(inside ? barW - 6 : barW + 6),
    y: chartNum(yTop + barH / 2 + fs * 0.35),   // ruční baseline: iOS Safari
    'text-anchor': inside ? 'end' : 'start',    // si s dominant-baseline nerozumí
    'font-size': fs,
    fill: (inside && solid) ? 'var(--chart-ink-inv, currentColor)' : 'var(--chart-ink, currentColor)',
    'fill-opacity': inside ? 1 : 0.7
  }, txt);
}

/* ==================== vodorovné pruhy ==================== */
// Vodorovně schválně: české názvy kategorií jsou dlouhé a otočené popisky
// vypadají amatérsky. Název stojí nad dvojicí pruhů, takže má celou šířku.
function chartBars(host, items, opts) {
  if (!host) return;
  const o = opts || {};
  const data = (Array.isArray(items) ? items : []).map(function (it) {
    return { name: chartText(it && it.name), plan: num(it && it.plan), act: num(it && it.act) };
  });
  chartMount(host, function (W) {
    if (!data.length) return [];
    const padR = 8, padB = 18, nameH = 17, barH = 11, gapIn = 3, gapBand = 13;
    const bandH = nameH + barH + gapIn + barH + gapBand;
    const plotW = Math.max(48, W - padR);
    const H = data.length * bandH + padB, baseY = H - padB;
    let peak = 0;
    data.forEach(function (d) { peak = Math.max(peak, d.plan, d.act); });
    const top = niceScale(peak)[1];
    const svg = chartSvgRoot(W, H, o.title || 'Plán a skutečnost',
      o.desc || 'Vodorovné pruhy: u každé položky světlý plán a plný sloupec skutečnosti.');
    const grid = svgEl('g', { 'aria-hidden': 'true' });
    for (let i = 0; i <= 4; i++) {
      const x = chartNum(plotW * i / 4);
      grid.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: baseY, stroke: 'var(--grid, currentColor)',
        'stroke-opacity': i === 0 ? 1 : 0.35, 'stroke-width': 1,
        'shape-rendering': 'crispEdges', 'vector-effect': 'non-scaling-stroke' }));
      if (i % 2 === 0) grid.appendChild(svgEl('text', { x: x, y: H - 5, 'font-size': 10,
        fill: 'var(--chart-ink, currentColor)', 'fill-opacity': 0.6,
        'text-anchor': i === 0 ? 'start' : (i === 4 ? 'end' : 'middle') }, formatCzk(top * i / 4)));
    }
    svg.appendChild(grid);
    const plot = svgEl('g', { 'aria-hidden': 'true' });
    data.forEach(function (d, i) {
      const y0 = i * bandH;
      plot.appendChild(svgEl('text', { x: 0, y: y0 + 12, 'font-size': 12, fill: 'var(--chart-ink, currentColor)' }, d.name));
      const wPlan = chartNum(clamp(d.plan / top, 0, 1) * plotW);
      const wAct = chartNum(clamp(d.act / top, 0, 1) * plotW);
      const yPlan = y0 + nameH, yAct = yPlan + barH + gapIn;
      plot.appendChild(svgEl('rect', { x: 0, y: yPlan, width: wPlan, height: barH, rx: 3,
        fill: 'var(--bar-plan, currentColor)' }));
      plot.appendChild(svgEl('rect', { x: 0, y: yAct, width: wAct, height: barH, rx: 3,
        fill: d.act > d.plan ? 'var(--bar-over, currentColor)' : 'var(--bar-act, currentColor)' }));
      plot.appendChild(chartValueLabel(wPlan, yPlan, barH, formatCzk(d.plan), 10, false));
      plot.appendChild(chartValueLabel(wAct, yAct, barH, formatCzk(d.act), 10, true));
    });
    svg.appendChild(plot);

    return [svg, chartTable(o.title || 'Plán a skutečnost',
      ['Položka', TXT.colPlan, TXT.colActual, TXT.diff],
      data.map(function (d) {
        return [d.name, formatCzk(d.plan), formatCzk(d.act), formatSigned(d.act - d.plan)];
      }))];
  });
}

/* ==================== koláč ==================== */

// Úhly výsečí. Nulové a záporné díly se přeskakují (ne kreslí prázdné),
// poslední díl se dorovná přesně na 360°, ať součet nedrhne na zaokrouhlení.
function chartPieAngles(slices) {
  const src = (Array.isArray(slices) ? slices : []).map(function (s, i) {
    return { i: i, name: chartText(s && s.name), value: num(s && s.value), color: (s && s.color) || hueFor(i) };
  }).filter(function (s) { return s.value > 0; });
  let total = 0;
  src.forEach(function (s) { total += s.value; });
  let a = 0;
  return src.map(function (s, k) {
    const ratio = pct(s.value, total) || 0;
    const a0 = a;
    const a1 = (k === src.length - 1) ? 360 : chartNum(a0 + ratio * 360);
    a = a1;
    return { i: s.i, name: s.name, value: s.value, color: s.color, ratio: ratio, a0: a0, a1: a1 };
  });
}

function chartPie(host, slices, opts) {
  if (!host) return;
  const o = opts || {};
  const arcs = chartPieAngles(slices);
  chartMount(host, function (W) {
    if (!arcs.length) return [];
    const size = Math.min(W, num(o.size) || 220) || 220;
    const cx = W / 2, cy = size / 2, r = size / 2 - 4;
    const svg = chartSvgRoot(W, size, o.title || 'Rozdělení výdajů',
      o.desc || 'Koláčový graf; přesná čísla jsou v legendě a v tabulce pod grafem.');
    const g = svgEl('g', { 'aria-hidden': 'true' });
    arcs.forEach(function (s) {
      // Jediný stoprocentní díl má stejný začátek i konec oblouku a path by
      // nenakreslil vůbec nic — proto v tom případě obyčejná kružnice.
      g.appendChild(s.ratio >= 0.9999
        ? svgEl('circle', { cx: chartNum(cx), cy: chartNum(cy), r: chartNum(r), fill: s.color })
        : svgEl('path', { d: arcPath(cx, cy, r, s.a0, s.a1) + ' L' + chartNum(cx) + ' ' + chartNum(cy) + ' Z',
            fill: s.color }));
    });
    // Uvnitř popisujeme jen díly od zhruba 8 % výš, jinak se text nevejde.
    arcs.forEach(function (s) {
      if (s.ratio < 0.08) return;
      const p = polar(cx, cy, r * 0.62, (s.a0 + s.a1) / 2);
      g.appendChild(svgEl('text', { x: p.x, y: chartNum(p.y + 4), 'text-anchor': 'middle',
        'font-size': 11, fill: 'var(--chart-ink-inv, currentColor)' }, Math.round(s.ratio * 100) + NBSP + '%'));
    });
    svg.appendChild(g);
    if (o.legend) renderLegend(o.legend, slices);
    return [svg, chartTable(o.title || 'Rozdělení výdajů', ['Kategorie', 'Částka', 'Podíl'],
      arcs.map(function (s) { return [s.name, formatCzk(s.value), Math.round(s.ratio * 100) + NBSP + '%']; }))];
  });
}

// Legenda ve dvou sloupcích: barevný čtvereček + název + částka.
function renderLegend(host, slices) {
  if (!host) return;
  const list = el('ul', { class: 'chart-legend-list' });
  (Array.isArray(slices) ? slices : []).forEach(function (s, i) {
    const v = num(s && s.value);
    if (!(v > 0)) return;
    const li = el('li', { class: 'chart-legend-item' });
    const sw = el('span', { class: 'chart-swatch', 'aria-hidden': 'true' });
    sw.style.background = (s && s.color) || hueFor(i);
    li.appendChild(sw);
    li.appendChild(el('span', { class: 'chart-legend-name' }, chartText(s && s.name)));
    li.appendChild(el('span', { class: 'chart-legend-val' }, formatCzk(v)));
    list.appendChild(li);
  });
  host.replaceChildren(list);
}

/* ==================== prstenec ==================== */
function chartDonut(host, cfg) {
  if (!host) return;
  const c = cfg || {};
  const value = num(c.value), max = num(c.max);
  const p = progressPct(value, max);
  chartMount(host, function (W) {
    const size = Math.min(W, num(c.size) || 168) || 168;
    const sw = Math.max(8, Math.round(size * 0.11)), r = (size - sw) / 2 - 1;
    const svg = chartSvgRoot(size, size, c.title || 'Postup', c.desc ||
      (formatCzk(value) + ' z ' + formatCzk(max)));
    // Otáčíme celé <svg>, ne kružnici. Kdyby se točila kružnice, text ve
    // středu by se točil s ní; takhle je střed obyčejné HTML nad obrázkem.
    svg.setAttribute('style', 'width:100%;height:auto;display:block;max-width:' + size +
      'px;margin:0 auto;transform:rotate(-90deg)');
    const g = svgEl('g', { 'aria-hidden': 'true' });
    g.appendChild(svgEl('circle', { cx: chartNum(size / 2), cy: chartNum(size / 2), r: chartNum(r),
      fill: 'none', stroke: 'var(--track, currentColor)', 'stroke-opacity': 0.35, 'stroke-width': sw }));
    const arc = svgEl('circle', { cx: chartNum(size / 2), cy: chartNum(size / 2), r: chartNum(r),
      fill: 'none', 'stroke-width': sw, 'stroke-linecap': 'round',
      stroke: (max > 0 && value > max) ? 'var(--bar-over, currentColor)' : 'var(--bar-act, currentColor)' });
    // pathLength="100" udělá z dasharray rovnou procenta — obvod se nepočítá.
    const on = chartNum(p.ratio * 100);
    const full = chartHasPathLength ? on + ' ' + chartNum(100 - on) : donutDash(p.ratio, r);
    if (chartHasPathLength) arc.setAttribute('pathLength', '100');
    arc.setAttribute('stroke-dasharray', full);
    if (!chartReduced() && p.ratio > 0 && typeof requestAnimationFrame === 'function') {
      arc.setAttribute('stroke-dasharray', chartHasPathLength ? '0 100' : donutDash(0, r));
      arc.style.transition = 'stroke-dasharray .45s ease-out';
      requestAnimationFrame(function () { arc.setAttribute('stroke-dasharray', full); });
    }
    g.appendChild(arc);
    svg.appendChild(g);
    const wrap = el('div', { class: 'chart-donut', style: 'position:relative' });
    const mid = el('div', { class: 'chart-donut-center',
      style: 'position:absolute;inset:0;display:flex;flex-direction:column;' +
             'align-items:center;justify-content:center;text-align:center;pointer-events:none' });
    const big = el('strong', { class: 'chart-donut-value' });
    setText(big, c.centerText !== null && c.centerText !== undefined ? c.centerText : p.label);
    mid.appendChild(big);
    if (c.centerSub) { const sub = el('span', { class: 'chart-donut-sub' }); setText(sub, c.centerSub); mid.appendChild(sub); }
    wrap.appendChild(svg); wrap.appendChild(mid);
    return [wrap, chartTable(c.title || 'Postup', ['Ukazatel', 'Hodnota'],
      [['Naspořeno', formatCzk(value)], ['Cíl', formatCzk(max)], ['Hotovo', p.label]])];
  });
}

/* ==================== dvanáct měsíčních sloupků ==================== */
function chartYearColumns(host, series, opts) {
  if (!host) return;
  const o = opts || {};
  const mini = !!o.mini, vals = [];
  for (let i = 0; i < 12; i++) {
    const s = Array.isArray(series) ? series[i] : null;
    vals.push(num(s && typeof s === 'object' ? s.v : s));
  }
  chartMount(host, function (W) {
    const padB = mini ? 2 : 14, H = (mini ? 32 : 92) + padB, baseY = H - padB;
    // niceScale nikdy nevrátí nulu, takže rok bez jediné částky vykreslí
    // rovné dno a dvanáct nulových sloupků — ne dělení nulou.
    const top = niceScale(Math.max.apply(null, vals))[1];
    const cw = W / 12, bw = Math.max(3, cw - (mini ? 2 : 5));
    const svg = chartSvgRoot(W, H, o.title || 'Přehled roku',
      o.desc || 'Dvanáct sloupků, jeden za každý měsíc.');
    const g = svgEl('g', { 'aria-hidden': 'true' });
    g.appendChild(svgEl('line', { x1: 0, y1: baseY, x2: chartNum(W), y2: baseY,
      stroke: 'var(--grid, currentColor)', 'stroke-width': 1,
      'shape-rendering': 'crispEdges', 'vector-effect': 'non-scaling-stroke' }));
    vals.forEach(function (v, m) {
      const h = chartNum(clamp(v / top, 0, 1) * (baseY - 2));
      g.appendChild(svgEl('rect', { x: chartNum(m * cw + (cw - bw) / 2), y: chartNum(baseY - h),
        width: chartNum(bw), height: h, rx: 2,
        fill: m === o.active ? 'var(--bar-act, currentColor)' : 'var(--bar-plan, currentColor)' }));
      if (!mini) g.appendChild(svgEl('text', { x: chartNum(m * cw + cw / 2), y: H - 3,
        'text-anchor': 'middle', 'font-size': 9, fill: 'var(--chart-ink, currentColor)',
        'fill-opacity': 0.65 }, monthShortCs(m)));
    });
    svg.appendChild(g);
    return [svg, chartTable(o.title || 'Přehled roku', ['Měsíc', 'Částka'],
      vals.map(function (v, m) { return [monthShortCs(m), formatCzk(v)]; }))];
  });
}

/* ==================== útlý pruh cíle ==================== */
function chartGoalBar(host, saved, target) {
  if (!host) return;
  const p = progressPct(saved, target);
  chartMount(host, function (W) {
    const H = 10, rx = 5, w = Math.max(1, W);
    const svg = chartSvgRoot(w, H, 'Postup spoření',
      formatCzk(num(saved)) + ' z ' + formatCzk(num(target)) + ', hotovo ' + p.label);
    const g = svgEl('g', { 'aria-hidden': 'true' });
    g.appendChild(svgEl('rect', { x: 0, y: 0, width: chartNum(w), height: H, rx: rx,
      fill: 'var(--track, currentColor)', 'fill-opacity': 0.35 }));
    const fill = chartNum(p.ratio * w);
    if (fill > 0) g.appendChild(svgEl('rect', { x: 0, y: 0, width: fill, height: H, rx: rx,
      fill: 'var(--bar-act, currentColor)' }));
    svg.appendChild(g);
    return [svg, chartTable('Postup spoření', ['Ukazatel', 'Hodnota'],
      [['Naspořeno', formatCzk(num(saved))], ['Cíl', formatCzk(num(target))], ['Hotovo', p.label]])];
  });
}
