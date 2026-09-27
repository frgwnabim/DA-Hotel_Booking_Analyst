/* Dashboard Pembatalan Booking Hotel
 * Membaca data.json (diekspor oleh notebook) dan merender grafik SVG tanpa library eksternal.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- utilities
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (sel, root = document) => root.querySelector(sel);

  function svgEl(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'style') Object.assign(e.style, v);
      else e.setAttribute(k, v);
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  function htmlEl(tag, attrs = {}, parent) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k === 'style') Object.assign(e.style, v);
      else e.setAttribute(k, v);
    }
    if (parent) parent.appendChild(e);
    return e;
  }

  const LOCALE = 'id-ID';
  const fmtInt = (v) => Math.round(v).toLocaleString(LOCALE);
  const fmtDec = (v, d = 2) => v.toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPct = (v, d = 1) => fmtDec(v * 100, d) + '%';
  const fmtEurCompact = (v) => {
    if (v >= 1e6) return '€' + fmtDec(v / 1e6, 1) + ' jt';
    if (v >= 1e3) return '€' + fmtDec(v / 1e3, 1) + ' rb';
    return '€' + fmtInt(v);
  };
  const fmtP = (p) => (p < 0.001 ? '< 0,001' : fmtDec(p, 3));

  const MONTH_ID = {
    January: 'Jan', February: 'Feb', March: 'Mar', April: 'Apr', May: 'Mei', June: 'Jun',
    July: 'Jul', August: 'Agu', September: 'Sep', October: 'Okt', November: 'Nov', December: 'Des',
  };
  const COUNTRY_ID = {
    PRT: 'Portugal', GBR: 'Inggris', FRA: 'Prancis', ESP: 'Spanyol', DEU: 'Jerman', ITA: 'Italia',
    IRL: 'Irlandia', BEL: 'Belgia', BRA: 'Brasil', NLD: 'Belanda', USA: 'Amerika Serikat', CHE: 'Swiss',
    CN: 'Tiongkok', CHN: 'Tiongkok', AUT: 'Austria', SWE: 'Swedia', POL: 'Polandia', ISR: 'Israel',
    RUS: 'Rusia', NOR: 'Norwegia', Unknown: 'Tidak diketahui',
  };
  const CAT_COLS = ['hotel', 'meal', 'country', 'market_segment', 'distribution_channel',
    'reserved_room_type', 'deposit_type', 'customer_type'];
  const MODEL_COLOR = { 'Logistic Regression': 'var(--s1)', 'Random Forest': 'var(--s2)', 'XGBoost': 'var(--s3)' };
  // Sequential blue ramp (100 -> 700) untuk sel confusion matrix
  const SEQ_BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
    '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

  function featureLabel(name) {
    let n = name.replace(/^(num|cat)__/, '');
    for (const c of CAT_COLS) {
      if (n.startsWith(c + '_')) {
        let v = n.slice(c.length + 1);
        if (v === 'infrequent_sklearn') v = 'lainnya';
        return `${c} = ${v}`;
      }
    }
    return n;
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function niceTicks(min, max, count = 4) {
    const step = niceStep((max - min) / count || 1);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return ticks;
  }

  // Bentuk bar: ujung data membulat 4px, sisi baseline tetap siku
  function hBarPath(x0, x1, y, h) {
    const r = Math.min(4, Math.abs(x1 - x0), h / 2);
    if (x1 >= x0) return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
    return `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}H${x0}Z`;
  }
  function vBarPath(x, w, yBase, yTop) {
    const r = Math.min(4, yBase - yTop, w / 2);
    return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`;
  }

  let measureCtx;
  function textWidth(str, size = 12.5) {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    measureCtx.font = `${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    return measureCtx.measureText(str).width;
  }

  // Potong label yang melebihi lebar tersedia; label lengkap tetap ada di tooltip dan tabel
  function fitLabel(str, maxW, size = 12.5) {
    if (textWidth(str, size) <= maxW) return str;
    let s = str;
    while (s.length > 1 && textWidth(s + '…', size) > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  // ---------------------------------------------------------------- tooltip
  const tip = $('#tooltip');
  function showTip(x, y, content) {
    tip.replaceChildren();
    if (content.title) htmlEl('div', { class: 'tt-title', text: content.title }, tip);
    for (const r of content.rows) {
      const row = htmlEl('div', { class: 'tt-row' }, tip);
      if (r.color) htmlEl('span', { class: 'tt-key', style: { background: r.color } }, row);
      htmlEl('span', { class: 'tt-val', text: r.value }, row);
      if (r.label) htmlEl('span', { class: 'tt-lbl', text: r.label }, row);
    }
    tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + pad, top = y + pad;
    if (left + w > window.innerWidth - 8) left = x - w - pad;
    if (top + h > window.innerHeight - 8) top = y - h - pad;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { tip.hidden = true; }
  function bindTip(el, getContent, label) {
    el.setAttribute('tabindex', '0');
    if (label) el.setAttribute('aria-label', label);
    el.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, getContent()));
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('focus', () => {
      const b = el.getBoundingClientRect();
      showTip(b.left + b.width / 2, b.top + b.height / 2, getContent());
    });
    el.addEventListener('blur', hideTip);
  }

  // ---------------------------------------------------------------- data table (tampilan tabel)
  function dataTable(parent, headers, rows, numericCols = []) {
    const d = htmlEl('details', { class: 'data-table' }, parent);
    htmlEl('summary', { text: 'Lihat tabel data' }, d);
    const wrap = htmlEl('div', { class: 'table-wrap' }, d);
    buildTable(wrap, headers, rows, numericCols);
  }
  function buildTable(parent, headers, rows, numericCols = [], rowClass) {
    const t = htmlEl('table', {}, parent);
    const tr = htmlEl('tr', {}, htmlEl('thead', {}, t));
    headers.forEach((h, i) => htmlEl('th', { text: h, class: numericCols.includes(i) ? 'num' : '' }, tr));
    const tb = htmlEl('tbody', {}, t);
    rows.forEach((r, ri) => {
      const row = htmlEl('tr', { class: rowClass ? rowClass(ri) : '' }, tb);
      r.forEach((c, i) => {
        const td = htmlEl('td', { class: numericCols.includes(i) ? 'num' : '' }, row);
        if (c instanceof Node) td.appendChild(c); else td.textContent = c;
      });
    });
    return t;
  }

  function legend(parent, items, kind = 'swatch') {
    parent.replaceChildren();
    for (const it of items) {
      const s = htmlEl('span', { class: 'legend-item' }, parent);
      htmlEl('span', { class: kind === 'line' ? 'legend-line' : 'legend-swatch', style: { background: it.color } }, s);
      htmlEl('span', { text: it.name }, s);
    }
  }

  // ---------------------------------------------------------------- charts
  /** Bar horizontal satu seri. rows: [{label, value, ...}] */
  function hBar(container, rows, opt = {}) {
    container.replaceChildren();
    const width = container.clientWidth || 480;
    const rowH = 30, barH = 16, axisH = 22;
    const fmt = opt.fmt || fmtPct;
    const labelW = Math.min(Math.max(...rows.map((r) => textWidth(r.label))) + 14, width * 0.42);
    const valW = Math.max(...rows.map((r) => textWidth(fmt(r.value), 12))) + 10;
    const plotW = Math.max(60, width - labelW - valW);
    const maxV = opt.max ?? Math.max(...rows.map((r) => r.value), ...(opt.refLines || []).map((l) => l.v));
    const ticks = niceTicks(0, maxV, width < 420 ? 3 : 4);
    const xMax = ticks[ticks.length - 1];
    const x = (v) => labelW + (v / xMax) * plotW;
    const height = rows.length * rowH + axisH;
    const svg = svgEl('svg', { width, height, role: 'img', 'aria-label': opt.aria || '' }, container);

    for (const t of ticks) {
      svgEl('line', { x1: x(t), x2: x(t), y1: 0, y2: rows.length * rowH, style: { stroke: t === 0 ? 'var(--axis)' : 'var(--grid)' }, 'stroke-width': 1 }, svg);
      svgEl('text', { x: x(t), y: height - 6, 'text-anchor': 'middle', class: 'axis-text', text: (opt.axisFmt || fmt)(t) }, svg);
    }
    for (const l of opt.refLines || []) {
      svgEl('line', { x1: x(l.v), x2: x(l.v), y1: 0, y2: rows.length * rowH, style: { stroke: 'var(--muted)' }, 'stroke-width': 1 }, svg);
    }
    rows.forEach((r, i) => {
      const y = i * rowH + (rowH - barH) / 2;
      svgEl('text', { x: labelW - 10, y: y + barH / 2 + 4, 'text-anchor': 'end', class: 'cat-text', text: fitLabel(r.label, labelW - 12) }, svg);
      const hit = svgEl('rect', { x: 0, y: i * rowH, width, height: rowH, class: 'hit' }, svg);
      svgEl('path', { d: hBarPath(x(0), x(r.value), y, barH), class: 'mark', style: { fill: opt.color ? opt.color(r) : 'var(--s1)' } }, svg);
      svgEl('text', { x: x(r.value) + 6, y: y + barH / 2 + 4, class: 'val-text', text: fmt(r.value) }, svg);
      bindTip(hit, () => opt.tip ? opt.tip(r) : { title: r.label, rows: [{ value: fmt(r.value) }] }, `${r.label}: ${fmt(r.value)}`);
    });
    if (opt.table) dataTable(container, opt.table.headers, opt.table.rows(rows), opt.table.num || []);
  }

  /** Bar divergen di sekitar nol (koefisien Logit) */
  function divergingBar(container, rows, opt = {}) {
    container.replaceChildren();
    const width = container.clientWidth || 480;
    const rowH = 24, barH = 14, axisH = 22;
    const labelW = Math.min(Math.max(...rows.map((r) => textWidth(r.label, 12))) + 14, width * 0.45);
    const plotW = Math.max(80, width - labelW - 12);
    const minV = Math.min(0, ...rows.map((r) => r.value));
    const maxV = Math.max(0, ...rows.map((r) => r.value));
    const ticks = niceTicks(minV, maxV, width < 420 ? 3 : 5);
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const x = (v) => labelW + ((v - lo) / (hi - lo)) * plotW;
    const height = rows.length * rowH + axisH;
    const svg = svgEl('svg', { width, height, role: 'img', 'aria-label': opt.aria || '' }, container);
    for (const t of ticks) {
      svgEl('line', { x1: x(t), x2: x(t), y1: 0, y2: rows.length * rowH, style: { stroke: t === 0 ? 'var(--axis)' : 'var(--grid)' }, 'stroke-width': 1 }, svg);
      svgEl('text', { x: x(t), y: height - 6, 'text-anchor': 'middle', class: 'axis-text', text: fmtDec(t, Math.abs(ticks[1] - ticks[0]) < 1 ? 1 : 0) }, svg);
    }
    rows.forEach((r, i) => {
      const y = i * rowH + (rowH - barH) / 2;
      svgEl('text', { x: labelW - 10, y: y + barH / 2 + 4, 'text-anchor': 'end', class: 'cat-text', style: { fontSize: '12px' }, text: fitLabel(r.label, labelW - 12, 12) }, svg);
      const hit = svgEl('rect', { x: 0, y: i * rowH, width, height: rowH, class: 'hit' }, svg);
      svgEl('path', { d: hBarPath(x(0), x(r.value), y, barH), class: 'mark', style: { fill: opt.color(r) } }, svg);
      bindTip(hit, () => opt.tip(r), `${r.label}: ${fmtDec(r.value, 3)}`);
    });
    if (opt.table) dataTable(container, opt.table.headers, opt.table.rows(rows), opt.table.num || []);
  }

  /** Kolom vertikal satu seri (kategori berurutan) */
  function columns(container, rows, opt = {}) {
    container.replaceChildren();
    const width = container.clientWidth || 480;
    const height = opt.height || 230;
    const fmt = opt.fmt || fmtPct;
    const axisFmt = opt.axisFmt || fmt;
    const top = 22, bottom = 26;
    const maxV = Math.max(...rows.map((r) => r.value));
    const ticks = niceTicks(0, maxV, 4);
    const yMax = ticks[ticks.length - 1];
    const leftW = Math.max(...ticks.map((t) => textWidth(axisFmt(t), 11.5))) + 10;
    const plotW = width - leftW - 4;
    const band = plotW / rows.length;
    const barW = Math.min(24, band * 0.6);
    const y = (v) => top + (1 - v / yMax) * (height - top - bottom);
    const svg = svgEl('svg', { width, height, role: 'img', 'aria-label': opt.aria || '' }, container);
    for (const t of ticks) {
      svgEl('line', { x1: leftW, x2: width, y1: y(t), y2: y(t), style: { stroke: t === 0 ? 'var(--axis)' : 'var(--grid)' }, 'stroke-width': 1 }, svg);
      svgEl('text', { x: leftW - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-text', text: axisFmt(t) }, svg);
    }
    const showVals = band > textWidth(fmt(maxV), 12) + 4;
    rows.forEach((r, i) => {
      const cx = leftW + band * i + band / 2;
      const hit = svgEl('rect', { x: leftW + band * i, y: top, width: band, height: height - top - bottom, class: 'hit' }, svg);
      svgEl('path', { d: vBarPath(cx - barW / 2, barW, y(0), y(r.value)), class: 'mark', style: { fill: 'var(--s1)' } }, svg);
      if (showVals) svgEl('text', { x: cx, y: y(r.value) - 6, 'text-anchor': 'middle', class: 'val-text', text: fmt(r.value) }, svg);
      svgEl('text', { x: cx, y: height - 8, 'text-anchor': 'middle', class: 'axis-text', style: { fill: 'var(--ink-2)' }, text: r.label }, svg);
      bindTip(hit, () => opt.tip ? opt.tip(r) : { title: r.label, rows: [{ value: fmt(r.value) }] }, `${r.label}: ${fmt(r.value)}`);
    });
    if (opt.table) dataTable(container, opt.table.headers, opt.table.rows(rows), opt.table.num || []);
  }

  /** Bar berkelompok (beberapa seri per kategori) */
  function groupedBars(container, groups, series, opt = {}) {
    container.replaceChildren();
    const width = container.clientWidth || 480;
    const height = opt.height || 260;
    const top = 12, bottom = 26;
    const fmt = opt.fmt || ((v) => fmtDec(v, 3));
    const ticks = [0, 0.25, 0.5, 0.75, 1];
    const leftW = Math.max(...ticks.map((t) => textWidth(fmtDec(t, 2), 11.5))) + 10;
    const plotW = width - leftW - 4;
    const band = plotW / groups.length;
    const barW = Math.min(20, (band * 0.72 - 2 * (series.length - 1)) / series.length);
    const groupW = barW * series.length + 2 * (series.length - 1);
    const y = (v) => top + (1 - v) * (height - top - bottom);
    const svg = svgEl('svg', { width, height, role: 'img', 'aria-label': opt.aria || '' }, container);
    for (const t of ticks) {
      svgEl('line', { x1: leftW, x2: width, y1: y(t), y2: y(t), style: { stroke: t === 0 ? 'var(--axis)' : 'var(--grid)' }, 'stroke-width': 1 }, svg);
      svgEl('text', { x: leftW - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-text', text: fmtDec(t, 2) }, svg);
    }
    groups.forEach((g, gi) => {
      const gx = leftW + band * gi + (band - groupW) / 2;
      const hit = svgEl('rect', { x: leftW + band * gi, y: top, width: band, height: height - top - bottom, class: 'hit' }, svg);
      series.forEach((s, si) => {
        svgEl('path', { d: vBarPath(gx + si * (barW + 2), barW, y(0), y(s.values[gi])), style: { fill: s.color } }, svg);
      });
      svgEl('text', { x: leftW + band * gi + band / 2, y: height - 8, 'text-anchor': 'middle', class: 'axis-text', style: { fill: 'var(--ink-2)' }, text: g }, svg);
      bindTip(hit, () => ({ title: g, rows: series.map((s) => ({ color: s.color, value: fmt(s.values[gi]), label: s.name })) }), g);
    });
    if (opt.table) dataTable(container, ['Metrik', ...series.map((s) => s.name)],
      groups.map((g, gi) => [g, ...series.map((s) => fmt(s.values[gi]))]), series.map((_, i) => i + 1));
  }

  /** Grafik garis dengan crosshair; x bisa kategori (label) atau numerik */
  function lineChart(container, cfg) {
    container.replaceChildren();
    const width = container.clientWidth || 480;
    const height = cfg.height || 240;
    const top = 14, bottom = 26;
    const n = cfg.x.length;
    const [yMin, yMax] = cfg.yDomain;
    const yTicks = cfg.yTicks || niceTicks(yMin, yMax, 4);
    const yFmt = cfg.yFmt || fmtPct;
    const leftW = Math.max(...yTicks.map((t) => textWidth(yFmt(t), 11.5))) + 10;
    const rightPad = cfg.numeric ? 10 : 14;
    const plotW = width - leftW - rightPad;
    const xPos = cfg.numeric
      ? (i) => leftW + ((cfg.x[i] - cfg.x[0]) / (cfg.x[n - 1] - cfg.x[0])) * plotW
      : (i) => leftW + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const lo = yTicks[0], hi = yTicks[yTicks.length - 1];
    const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (height - top - bottom);
    const svg = svgEl('svg', { width, height, role: 'img', 'aria-label': cfg.aria || '' }, container);

    for (const t of yTicks) {
      svgEl('line', { x1: leftW, x2: width - rightPad, y1: y(t), y2: y(t), style: { stroke: t === lo ? 'var(--axis)' : 'var(--grid)' }, 'stroke-width': 1 }, svg);
      svgEl('text', { x: leftW - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-text', text: yFmt(t) }, svg);
    }
    const xTickIdx = cfg.xTickIdx || cfg.x.map((_, i) => i);
    const minGap = Math.max(...xTickIdx.map((i) => textWidth(cfg.xFmt ? cfg.xFmt(cfg.x[i]) : String(cfg.x[i]), 11.5))) + 8;
    let lastX = -Infinity;
    for (const i of xTickIdx) {
      const px = xPos(i);
      if (px - lastX < minGap) continue;
      lastX = px;
      svgEl('text', { x: px, y: height - 8, 'text-anchor': 'middle', class: 'axis-text', text: cfg.xFmt ? cfg.xFmt(cfg.x[i]) : cfg.x[i] }, svg);
    }
    if (cfg.diagonal) {
      svgEl('line', { x1: xPos(0), y1: y(lo), x2: xPos(n - 1), y2: y(hi), style: { stroke: 'var(--muted)' }, 'stroke-width': 1 }, svg);
    }
    if (cfg.marker != null) {
      svgEl('line', { x1: xPos(cfg.marker), x2: xPos(cfg.marker), y1: top, y2: height - bottom, style: { stroke: 'var(--ink-2)' }, 'stroke-width': 1 }, svg);
    }
    for (const s of cfg.series) {
      if (cfg.area && cfg.series.length === 1) {
        const pts = s.values.map((v, i) => `${xPos(i)},${y(v)}`).join('L');
        svgEl('path', { d: `M${xPos(0)},${y(lo)}L${pts}L${xPos(n - 1)},${y(lo)}Z`, style: { fill: s.color, opacity: 0.1 } }, svg);
      }
      svgEl('path', {
        d: 'M' + s.values.map((v, i) => `${xPos(i)},${y(v)}`).join('L'),
        fill: 'none', style: { stroke: s.color }, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }, svg);
      if (cfg.dots) {
        s.values.forEach((v, i) => svgEl('circle', { cx: xPos(i), cy: y(v), r: 4, style: { fill: s.color, stroke: 'var(--surface)' }, 'stroke-width': 2 }, svg));
      }
    }
    // Crosshair
    const cross = svgEl('g', { style: { display: 'none' } }, svg);
    const vline = svgEl('line', { y1: top, y2: height - bottom, style: { stroke: 'var(--muted)' }, 'stroke-width': 1 }, cross);
    const dots = cfg.series.map((s) => svgEl('circle', { r: 4.5, style: { fill: s.color, stroke: 'var(--surface)' }, 'stroke-width': 2 }, cross));
    const overlay = svgEl('rect', { x: leftW, y: top, width: plotW, height: height - top - bottom, class: 'hit' }, svg);
    overlay.setAttribute('tabindex', '0');
    overlay.setAttribute('aria-label', cfg.aria || 'Grafik garis. Gunakan tombol panah untuk menelusuri.');
    let cur = null;
    const nearest = (px) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = Math.abs(xPos(i) - px); if (d < bd) { bd = d; best = i; } }
      return best;
    };
    const show = (i, cx, cy) => {
      cur = i;
      cross.style.display = '';
      vline.setAttribute('x1', xPos(i)); vline.setAttribute('x2', xPos(i));
      cfg.series.forEach((s, si) => { dots[si].setAttribute('cx', xPos(i)); dots[si].setAttribute('cy', y(s.values[i])); });
      showTip(cx, cy, {
        title: cfg.tipTitle ? cfg.tipTitle(i) : String(cfg.x[i]),
        rows: cfg.series.map((s) => ({ color: s.color, value: yFmt(s.values[i], true), label: s.name })),
      });
    };
    const hide = () => { cross.style.display = 'none'; hideTip(); };
    overlay.addEventListener('pointermove', (e) => {
      const b = svg.getBoundingClientRect();
      show(nearest(e.clientX - b.left), e.clientX, e.clientY);
    });
    overlay.addEventListener('pointerleave', hide);
    overlay.addEventListener('blur', hide);
    const focusAt = (i) => {
      const b = svg.getBoundingClientRect();
      show(i, b.left + xPos(i), b.top + y(cfg.series[0].values[i]));
    };
    overlay.addEventListener('focus', () => focusAt(cur ?? (cfg.marker ?? 0)));
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      focusAt(Math.min(n - 1, Math.max(0, (cur ?? 0) + (e.key === 'ArrowRight' ? step : -step))));
    });
    if (cfg.table) dataTable(container, cfg.table.headers, cfg.table.rows(), cfg.table.num || []);
  }

  // ---------------------------------------------------------------- state
  let DATA = null;
  let segment = 'Semua';
  let cmModel = null;
  let threshold = 0.5;

  const rateTip = (r, titleFmt) => ({
    title: titleFmt ? titleFmt(r.label) : r.label,
    rows: [
      { value: fmtPct(r.rate), label: 'cancellation rate' },
      { value: fmtInt(r.n), label: 'booking' },
    ],
  });
  const rateTable = (catName, labelFmt) => ({
    headers: [catName, 'Jumlah booking', 'Cancellation rate'],
    rows: (rows) => rows.map((r) => [labelFmt ? labelFmt(r.raw ?? r.label) : r.label, fmtInt(r.n), fmtPct(r.rate)]),
    num: [1, 2],
  });
  const asRows = (arr, labelFmt) => arr.map((r) => ({ ...r, raw: r.label, label: labelFmt ? labelFmt(r.label) : r.label, value: r.rate }));

  // ---------------------------------------------------------------- sections
  function renderSummary() {
    const S = DATA.segments[segment];
    const k = S.kpi;
    $('#heroRate').textContent = fmtPct(k.cancel_rate);
    $('#heroSub').textContent = `${fmtInt(k.canceled)} dari ${fmtInt(k.bookings)} booking dibatalkan` +
      (segment === 'Semua' ? '' : ` di ${segment}`);
    const [p0, p1] = DATA.meta.period;
    const fmtMonth = (s) => new Date(s).toLocaleDateString(LOCALE, { month: 'short', year: 'numeric' });
    const tiles = [
      { label: 'Total booking', value: fmtInt(k.bookings), sub: 'setelah deduplikasi & pembersihan' },
      { label: 'Booking dibatalkan', value: fmtInt(k.canceled), sub: `${fmtInt(k.bookings - k.canceled)} tidak batal` },
      { label: 'Median lead time', value: `${fmtInt(k.lead_cancel)} vs ${fmtInt(k.lead_not_cancel)} hari`, sub: 'booking batal vs tidak batal' },
      { label: 'Rata-rata ADR', value: '€' + fmtDec(k.adr_mean, 0), sub: 'average daily rate per malam' },
      { label: 'Estimasi nilai booking batal', value: fmtEurCompact(k.lost_revenue), sub: 'ADR x jumlah malam booking batal' },
      { label: 'Periode kedatangan', value: `${fmtMonth(p0)} - ${fmtMonth(p1)}`, sub: 'City Hotel & Resort Hotel, Portugal' },
    ];
    const box = $('#kpiTiles');
    box.replaceChildren();
    for (const t of tiles) {
      const d = htmlEl('div', { class: 'tile' }, box);
      htmlEl('p', { class: 'tile-label', text: t.label }, d);
      htmlEl('p', { class: 'tile-value', text: t.value }, d);
      htmlEl('p', { class: 'tile-sub', text: t.sub }, d);
    }
  }

  function renderPatterns() {
    const S = DATA.segments[segment];
    columns($('#chLead'), asRows(S.lead_time), {
      aria: 'Cancellation rate per rentang lead time',
      tip: (r) => rateTip(r, (l) => `Lead time ${l} hari`),
      axisFmt: (v) => fmtPct(v, 0),
      table: rateTable('Lead time (hari)'),
    });
    columns($('#chReq'), asRows(S.special_req), {
      aria: 'Cancellation rate per jumlah special request',
      tip: (r) => rateTip(r, (l) => `${l} special request`),
      axisFmt: (v) => fmtPct(v, 0),
      table: rateTable('Special request'),
    });
    const hb = (el, arr, cat, labelFmt) => hBar(el, asRows(arr, labelFmt), {
      aria: `Cancellation rate per ${cat}`, tip: (r) => rateTip(r), axisFmt: (v) => fmtPct(v, 0),
      table: rateTable(cat, labelFmt),
    });
    hb($('#chSegment'), S.market_segment, 'Market segment');
    hb($('#chDeposit'), S.deposit_type, 'Tipe deposit');
    hb($('#chCustomer'), S.customer_type, 'Tipe pelanggan');
    hb($('#chCountry'), S.country, 'Negara', (c) => `${COUNTRY_ID[c] || c} (${c})`);
    hb($('#chParking'), S.parking, 'Parkir');
    hb($('#chRepeated'), S.repeated, 'Status tamu');

    const months = S.monthly;
    columns($('#chMonthVol'), months.map((m) => ({ label: MONTH_ID[m.label], value: m.n, rate: m.rate, n: m.n, full: m.label })), {
      aria: 'Jumlah booking per bulan kedatangan',
      fmt: fmtInt,
      axisFmt: (v) => (v >= 1000 ? fmtDec(v / 1000, v % 1000 ? 1 : 0) + ' rb' : fmtInt(v)),
      tip: (r) => ({ title: r.label, rows: [{ value: fmtInt(r.n), label: 'booking' }, { value: fmtPct(r.rate), label: 'cancellation rate' }] }),
      table: { headers: ['Bulan', 'Jumlah booking'], rows: (rows) => rows.map((r) => [r.label, fmtInt(r.n)]), num: [1] },
    });
    const rates = months.map((m) => m.rate);
    const lo = Math.max(0, Math.floor((Math.min(...rates) - 0.03) * 20) / 20);
    const hi = Math.ceil((Math.max(...rates) + 0.02) * 20) / 20;
    lineChart($('#chMonthRate'), {
      aria: 'Cancellation rate per bulan kedatangan',
      x: months.map((m) => MONTH_ID[m.label]),
      series: [{ name: 'cancellation rate', color: 'var(--s1)', values: rates }],
      yDomain: [lo, hi], yFmt: (v) => fmtPct(v, 0), dots: true, area: true,
      tipTitle: (i) => MONTH_ID[months[i].label],
      table: { headers: ['Bulan', 'Cancellation rate', 'Jumlah booking'], rows: () => months.map((m) => [MONTH_ID[m.label], fmtPct(m.rate), fmtInt(m.n)]), num: [1, 2] },
    });
  }

  function renderHypothesis() {
    const H = DATA.hypothesis;
    const effect = (r) => { const a = Math.abs(r); return a < 0.1 ? 'sangat kecil' : a < 0.3 ? 'kecil' : a < 0.5 ? 'sedang' : 'besar'; };
    const mw = $('#tblMW');
    mw.replaceChildren();
    buildTable(mw, ['Variabel', 'Median batal', 'Median tidak batal', 'p-value', 'r', 'Effect size'],
      H.mann_whitney.map((m) => [m.var, fmtDec(m.med_cancel, m.med_cancel % 1 ? 1 : 0), fmtDec(m.med_not, m.med_not % 1 ? 1 : 0), fmtP(m.p), fmtDec(m.r, 3), effect(m.r)]),
      [1, 2, 3, 4]);
    htmlEl('p', { class: 'tile-sub', text: 'r positif: nilai pada booking batal cenderung lebih tinggi. r negatif: cenderung lebih rendah.' }, mw);

    hBar($('#chChi'), H.chi_square.map((c) => ({ ...c, label: c.feature, value: c.v })), {
      aria: "Cramer's V tiap fitur kategorikal",
      fmt: (v) => fmtDec(v, 3), axisFmt: (v) => fmtDec(v, 2),
      refLines: [{ v: 0.1 }, { v: 0.3 }], max: Math.max(0.3, ...H.chi_square.map((c) => c.v)),
      tip: (r) => ({ title: r.label, rows: [{ value: fmtDec(r.v, 3), label: "Cramer's V" }, { value: fmtP(r.p), label: 'p-value' }, { value: fmtInt(r.chi2), label: `Chi² (dof ${r.dof})` }] }),
      table: { headers: ['Fitur', 'Chi²', 'dof', 'p-value', "Cramer's V"], rows: (rows) => rows.map((r) => [r.label, fmtDec(r.chi2, 1), r.dof, fmtP(r.p), fmtDec(r.v, 3)]), num: [1, 2, 3, 4] },
    });

    const L = H.logit;
    $('#logitSub').textContent = `Koefisien log-odds (fitur numerik distandarisasi). Pseudo R² ${fmtDec(L.pseudo_r2, 3)}, model ${L.converged ? 'konvergen' : 'tidak konvergen'}.`;
    const col = (r) => (!r.sig ? 'var(--neutral)' : r.value > 0 ? 'var(--pos)' : 'var(--neg)');
    legend($('#lgLogit'), [
      { name: 'Menaikkan peluang batal (p < 0,05)', color: 'var(--pos)' },
      { name: 'Menurunkan peluang batal (p < 0,05)', color: 'var(--neg)' },
      { name: 'Tidak signifikan', color: 'var(--neutral)' },
    ]);
    divergingBar($('#chLogit'), L.coef.map((c) => ({ ...c, label: c.feature, value: c.coef })), {
      aria: 'Koefisien Logit per fitur',
      color: col,
      tip: (r) => ({ title: r.label, rows: [{ value: fmtDec(r.coef, 3), label: 'koefisien' }, { value: fmtDec(r.or, 3), label: 'odds ratio' }, { value: fmtP(r.p), label: r.sig ? 'p-value (signifikan)' : 'p-value (tidak signifikan)' }] }),
      table: { headers: ['Fitur', 'Koefisien', 'Odds ratio', 'p-value', 'Signifikan'], rows: (rows) => rows.map((r) => [r.label, fmtDec(r.coef, 3), fmtDec(r.or, 3), fmtP(r.p), r.sig ? 'Ya' : 'Tidak']), num: [1, 2, 3] },
    });
  }

  function renderModels() {
    const M = DATA.models;
    const best = M.find((m) => m.name === DATA.meta.best_model);
    $('#modelLead').textContent = `Tiga model dilatih pada ${fmtInt(DATA.meta.train_rows)} booking dan diuji pada ${fmtInt(DATA.meta.test_rows)} booking yang belum pernah dilihat. ` +
      `Model terbaik dipilih dari ROC-AUC cross-validation, bukan dari data uji.`;

    const tiles = [
      { label: 'Model terbaik', value: best.name, sub: 'dipilih dari CV ROC-AUC' },
      { label: 'ROC-AUC data uji', value: fmtDec(best.tuned['ROC-AUC'], 3), sub: `baseline ${fmtDec(best.baseline['ROC-AUC'], 3)}` },
      { label: 'F1-score kelas batal', value: fmtDec(best.tuned['F1-Score'], 3), sub: `precision ${fmtDec(best.tuned.Precision, 3)} · recall ${fmtDec(best.tuned.Recall, 3)}` },
      { label: 'CV ROC-AUC (5-fold)', value: fmtDec(best.cv_tuned.mean, 3), sub: `± ${fmtDec(best.cv_tuned.std, 4)} antar fold` },
    ];
    const box = $('#modelTiles');
    box.replaceChildren();
    for (const t of tiles) {
      const d = htmlEl('div', { class: 'tile' }, box);
      htmlEl('p', { class: 'tile-label', text: t.label }, d);
      htmlEl('p', { class: 'tile-value', text: t.value }, d);
      htmlEl('p', { class: 'tile-sub', text: t.sub }, d);
    }

    const metricKeys = ['Accuracy', 'Precision', 'Recall', 'F1-Score', 'ROC-AUC'];
    const series = M.map((m) => ({ name: m.name, color: MODEL_COLOR[m.name], values: metricKeys.map((k) => m.tuned[k]) }));
    legend($('#lgMetrics'), series);
    groupedBars($('#chMetrics'), metricKeys.map((k) => (k === 'F1-Score' ? 'F1' : k)), series, { aria: 'Perbandingan metrik model tuned', table: true });

    const R = DATA.roc;
    const rocSeries = M.map((m) => ({ name: `${m.name} (AUC ${fmtDec(R.curves[m.name].auc, 3)})`, color: MODEL_COLOR[m.name], values: R.curves[m.name].tpr }));
    legend($('#lgRoc'), rocSeries, 'line');
    lineChart($('#chRoc'), {
      aria: 'ROC curve ketiga model', x: R.fpr, numeric: true, diagonal: true,
      series: rocSeries.map((s) => ({ ...s, name: s.name.replace(/ \(AUC.*/, '') })),
      yDomain: [0, 1], yTicks: [0, 0.25, 0.5, 0.75, 1], yFmt: (v) => fmtDec(v, 2),
      xTickIdx: [0, 25, 50, 75, 100], xFmt: (v) => fmtDec(v, 2), height: 280,
      tipTitle: (i) => `False positive rate ${fmtDec(R.fpr[i], 2)}`,
      table: {
        headers: ['FPR', ...M.map((m) => `TPR ${m.name}`)],
        rows: () => R.fpr.filter((_, i) => i % 10 === 0).map((f, j) => [fmtDec(f, 2), ...M.map((m) => fmtDec(R.curves[m.name].tpr[j * 10], 3))]),
        num: [0, 1, 2, 3],
      },
    });

    const tbl = $('#tblModels');
    tbl.replaceChildren();
    const rows = [];
    for (const m of M) {
      for (const v of ['baseline', 'tuned']) {
        const dot = htmlEl('span');
        htmlEl('span', { class: 'dot', style: { background: MODEL_COLOR[m.name] } }, dot);
        dot.appendChild(document.createTextNode(m.name));
        const cv = v === 'baseline' ? m.cv_baseline : m.cv_tuned;
        rows.push([dot, v === 'baseline' ? 'Baseline' : 'Tuned', ...metricKeys.map((k) => fmtDec(m[v][k], 4)), `${fmtDec(cv.mean, 4)} ± ${fmtDec(cv.std, 4)}`]);
      }
    }
    buildTable(tbl, ['Model', 'Versi', ...metricKeys, 'CV ROC-AUC'], rows, [2, 3, 4, 5, 6, 7],
      (ri) => (M[Math.floor(ri / 2)].name === best.name && ri % 2 === 1 ? 'best' : ''));

    const picker = $('#cmPicker');
    picker.replaceChildren();
    cmModel = cmModel || best.name;
    for (const m of M) {
      const b = htmlEl('button', { type: 'button', text: m.name, 'aria-pressed': String(m.name === cmModel) }, picker);
      b.addEventListener('click', () => { cmModel = m.name; renderModels(); });
    }
    renderConfusion($('#cmGrid'), DATA.confusion[cmModel]);

    $('#impTitle').textContent = `Feature importance: ${best.name}`;
    hBar($('#chImp'), DATA.importance.map((f) => ({ label: featureLabel(f.feature), value: f.value })), {
      aria: 'Feature importance model terbaik', fmt: (v) => fmtDec(v, 3), axisFmt: (v) => fmtDec(v, 2),
      table: { headers: ['Fitur', 'Importance'], rows: (rows) => rows.map((r) => [r.label, fmtDec(r.value, 4)]), num: [1] },
    });

    const pt = $('#tblParams');
    pt.replaceChildren();
    const prow = [];
    for (const m of M) for (const [k, v] of Object.entries(m.params)) prow.push([m.name, k, v === null ? 'None' : String(v)]);
    buildTable(pt, ['Model', 'Parameter', 'Nilai terbaik'], prow);
  }

  function renderConfusion(box, cm) {
    box.replaceChildren();
    const total = cm.tn + cm.fp + cm.fn + cm.tp;
    const maxV = Math.max(cm.tn, cm.fp, cm.fn, cm.tp);
    const cell = (v, lbl, desc) => {
      const idx = Math.round((v / maxV) * (SEQ_BLUE.length - 1) * 0.85);
      const bg = SEQ_BLUE[idx];
      const lum = relLum(bg);
      const d = htmlEl('div', { class: 'cm-cell', style: { background: bg, color: lum > 0.35 ? '#0b0b0b' : '#ffffff' } }, box);
      htmlEl('span', { class: 'cm-val', text: fmtInt(v) }, d);
      htmlEl('span', { class: 'cm-lbl', text: `${lbl} · ${fmtPct(v / total)}` }, d);
      bindTip(d, () => ({ title: lbl, rows: [{ value: fmtInt(v), label: desc }] }), `${lbl}: ${fmtInt(v)}`);
    };
    htmlEl('div', {}, box);
    htmlEl('div', { class: 'cm-head', text: 'Prediksi: tidak batal' }, box);
    htmlEl('div', { class: 'cm-head', text: 'Prediksi: batal' }, box);
    htmlEl('div', { class: 'cm-row', text: 'Aktual: tidak batal' }, box);
    cell(cm.tn, 'True negative', 'booking aman, diprediksi aman');
    cell(cm.fp, 'False positive', 'booking aman, salah ditandai batal');
    htmlEl('div', { class: 'cm-row', text: 'Aktual: batal' }, box);
    cell(cm.fn, 'False negative', 'pembatalan yang terlewat');
    cell(cm.tp, 'True positive', 'pembatalan yang tertangkap');
  }
  function relLum(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function renderThreshold() {
    const T = DATA.threshold;
    const i = Math.max(0, T.findIndex((t) => Math.abs(t.t - threshold) < 0.005));
    const cur = T[i];
    const bestF1 = T.reduce((a, b) => (b.f1 > a.f1 ? b : a));
    $('#thrLead').textContent = `Geser threshold untuk melihat trade-off model ${DATA.meta.best_model} pada data uji. ` +
      `Threshold lebih rendah menangkap lebih banyak pembatalan (recall naik) tetapi menambah false alarm (precision turun). ` +
      `F1 tertinggi dicapai pada threshold ${fmtDec(bestF1.t, 2)}.`;
    $('#thrOut').textContent = fmtDec(cur.t, 2);
    const actualCancel = cur.tp + cur.fn;
    const tiles = [
      { label: 'Precision', value: fmtPct(cur.precision), sub: 'dari yang ditandai batal, benar batal' },
      { label: 'Recall', value: fmtPct(cur.recall), sub: `${fmtInt(cur.tp)} dari ${fmtInt(actualCancel)} pembatalan tertangkap` },
      { label: 'F1-score', value: fmtDec(cur.f1, 3), sub: `maksimum ${fmtDec(bestF1.f1, 3)} @ ${fmtDec(bestF1.t, 2)}` },
      { label: 'False alarm', value: fmtInt(cur.fp), sub: 'booking aman yang ditandai batal' },
    ];
    const box = $('#thrTiles');
    box.replaceChildren();
    for (const t of tiles) {
      const d = htmlEl('div', { class: 'tile' }, box);
      htmlEl('p', { class: 'tile-label', text: t.label }, d);
      htmlEl('p', { class: 'tile-value', text: t.value }, d);
      htmlEl('p', { class: 'tile-sub', text: t.sub }, d);
    }
    const series = [
      { name: 'Precision', color: 'var(--s1)', values: T.map((t) => t.precision) },
      { name: 'Recall', color: 'var(--s2)', values: T.map((t) => t.recall) },
      { name: 'F1-score', color: 'var(--s3)', values: T.map((t) => t.f1) },
    ];
    legend($('#lgThr'), series, 'line');
    lineChart($('#chThr'), {
      aria: 'Precision, recall, dan F1 terhadap threshold',
      x: T.map((t) => t.t), numeric: true, marker: i,
      series, yDomain: [0, 1], yTicks: [0, 0.25, 0.5, 0.75, 1], yFmt: (v) => fmtDec(v, 2),
      xTickIdx: T.map((_, j) => j).filter((j) => Math.round(T[j].t * 100) % 10 === 0), xFmt: (v) => fmtDec(v, 1),
      tipTitle: (j) => `Threshold ${fmtDec(T[j].t, 2)}`, height: 260,
      table: {
        headers: ['Threshold', 'Precision', 'Recall', 'F1', 'TP', 'FP', 'FN', 'TN'],
        rows: () => T.filter((t) => Math.round(t.t * 100) % 5 === 0).map((t) => [fmtDec(t.t, 2), fmtDec(t.precision, 3), fmtDec(t.recall, 3), fmtDec(t.f1, 3), fmtInt(t.tp), fmtInt(t.fp), fmtInt(t.fn), fmtInt(t.tn)]),
        num: [0, 1, 2, 3, 4, 5, 6, 7],
      },
    });
  }

  function renderInsights() {
    const S = DATA.segments['Semua'];
    const find = (arr, l) => arr.find((r) => r.label === l) || { rate: 0, n: 0 };
    const lead = S.lead_time;
    const best = DATA.models.find((m) => m.name === DATA.meta.best_model);
    const bestF1 = DATA.threshold.reduce((a, b) => (b.f1 > a.f1 ? b : a));
    const items = [
      { t: 'Pantau booking jauh hari', p: `Cancellation rate naik dari ${fmtPct(lead[0].rate)} (lead time 0-7 hari) menjadi ${fmtPct(lead[lead.length - 1].rate)} (> 365 hari). Kirim reminder konfirmasi berkala atau terapkan deposit bertahap untuk booking dengan lead time panjang.` },
      { t: 'Special request dan parkir = komitmen', p: `Booking tanpa special request batal ${fmtPct(find(S.special_req, '0').rate)}, sedangkan dengan 3+ request hanya ${fmtPct(find(S.special_req, '3+').rate)}. Tamu yang minta parkir batal ${fmtPct(find(S.parking, 'Minta parkir').rate)}. Dorong tamu melengkapi preferensi saat booking.` },
      { t: 'Evaluasi kontrak grup dan agen', p: `Deposit Non Refund batal ${fmtPct(find(S.deposit_type, 'Non Refund').rate)} dan segmen Groups ${fmtPct(find(S.market_segment, 'Groups').rate)}. Pola ini didominasi booking grup, sehingga perlu release date dan batas pembatalan yang lebih ketat pada kontrak.` },
      { t: 'Perhatikan tamu lokal dan riwayat batal', p: `Tamu asal Portugal batal ${fmtPct(find(S.country, 'PRT').rate)}, tertinggi di antara negara utama. Riwayat pembatalan sebelumnya juga meningkatkan peluang batal secara signifikan (uji Logit).` },
      { t: 'Gunakan probabilitas untuk overbooking terukur', p: `${best.name} mencapai ROC-AUC ${fmtDec(best.tuned['ROC-AUC'], 3)} pada data uji. Jumlahkan probabilitas batal per tanggal kedatangan untuk memperkirakan kamar yang kemungkinan kosong, lalu sesuaikan kapasitas jual.` },
      { t: 'Pilih threshold sesuai biaya bisnis', p: `F1 tertinggi pada threshold ${fmtDec(bestF1.t, 2)} (recall ${fmtPct(bestF1.recall)}). Jika melewatkan pembatalan lebih mahal daripada false alarm, turunkan threshold. Keterbatasan: data 2015-2017 dari dua hotel di Portugal, perlu divalidasi ulang dengan data terbaru.` },
    ];
    const grid = $('#insightGrid');
    grid.replaceChildren();
    items.forEach((it, i) => {
      const c = htmlEl('div', { class: 'card insight' }, grid);
      htmlEl('span', { class: 'insight-num', text: String(i + 1) }, c);
      const body = htmlEl('div', {}, c);
      htmlEl('h3', { text: it.t }, body);
      htmlEl('p', { text: it.p }, body);
    });
  }

  function renderAll() {
    renderSummary();
    renderPatterns();
    renderHypothesis();
    renderModels();
    renderThreshold();
    renderInsights();
  }

  // ---------------------------------------------------------------- interactions
  function initFilter() {
    const btns = document.querySelectorAll('#hotelFilter button');
    btns.forEach((b) => b.addEventListener('click', () => {
      segment = b.dataset.seg;
      btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      hideTip();
      renderSummary();
      renderPatterns();
    }));
  }

  function initThreshold() {
    const input = $('#thrInput');
    input.addEventListener('input', () => { threshold = parseFloat(input.value); renderThreshold(); });
  }

  function initTheme() {
    const root = document.documentElement;
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
    } catch (_) { /* storage tidak tersedia */ }
    $('#themeToggle').addEventListener('click', () => {
      const isDark = root.dataset.theme
        ? root.dataset.theme === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = isDark ? 'light' : 'dark';
      try { localStorage.setItem('theme', root.dataset.theme); } catch (_) { /* abaikan */ }
      if (cmModel) renderConfusion($('#cmGrid'), DATA.confusion[cmModel]);
    });
  }

  function initNav() {
    const links = [...document.querySelectorAll('.sectionnav a')];
    const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          links.forEach((a) => a.classList.remove('active'));
          map.get(e.target.id)?.classList.add('active');
        }
      }
    }, { rootMargin: '-40% 0px -55% 0px' });
    map.forEach((_, id) => { const s = document.getElementById(id); if (s) obs.observe(s); });
  }

  function initResize() {
    let lastW = window.innerWidth, timer;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (window.innerWidth === lastW) return;
        lastW = window.innerWidth;
        hideTip();
        renderAll();
      }, 150);
    });
  }

  // ---------------------------------------------------------------- boot
  initTheme();
  fetch('data.json')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((data) => {
      DATA = data;
      const m = DATA.meta;
      $('#subtitle').textContent = `${fmtInt(m.clean_rows)} booking bersih dari ${fmtInt(m.raw_rows)} data mentah · target is_canceled · alur CRISP-DM`;
      $('#footerMeta').textContent = `${fmtInt(m.duplicates)} baris duplikat dihapus · ${m.n_features} fitur (${m.n_encoded} setelah encoding) · split 80:20 stratified`;
      renderAll();
      initFilter();
      initThreshold();
      initNav();
      initResize();
    })
    .catch((err) => {
      $('#subtitle').textContent = `Gagal memuat data.json (${err.message}). Jalankan notebook untuk membuat file ini.`;
    });
})();
