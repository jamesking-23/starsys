/* ============================================================================
   Starsys Print
   ----------------------------------------------------------------------------
   A print screen with a live preview, designed for paper (not copied from the Excel layout):

     * tables are stacked vertically, never side by side
     * the text size is chosen automatically so every column fits the page width
     * every page has a header and footer ("Page 3 of 9", generated date and person)
     * a table that continues on the next page repeats its column headings
     * a total row is never left alone on a page
     * the preview shows the SAME pages that are printed (we paginate ourselves, so what you see is what prints)

   The figures come from the same bucketing code as the Excel exports (injected via ctx), so a printout can
   never disagree with a workbook.  This module has no imports; main.js injects what it needs.
   ============================================================================ */

const MM = 96 / 25.4;   // CSS pixels per millimetre

export const PAPERS = {
  A4: { w: 210, h: 297, label: 'A4 (210 \u00D7 297 mm)' },
  Letter: { w: 215.9, h: 279.4, label: 'Letter (8.5 \u00D7 11 in)' },
  Legal: { w: 215.9, h: 355.6, label: 'Legal (8.5 \u00D7 14 in)' },
  A3: { w: 297, h: 420, label: 'A3 (297 \u00D7 420 mm)' }
};
export const MARGINS = { normal: { mm: 14, label: 'Normal' }, narrow: { mm: 8, label: 'Narrow' }, wide: { mm: 22, label: 'Wide' } };
const HEADER_MM = 10, FOOTER_MM = 8, BODY_PAD_MM = 3;   // reserved inside the margins when header/footer are on
const GAP_PX = 16;                     // space between tables
const SAFE_PX = 3;                     // safety margin when packing a page
const MIN_PT = 6, MAX_PT = 10;         // text size range for tables

const nf = new Intl.NumberFormat('en-US');
export const fmtNum = (n, dash) => ((!n || !isFinite(n)) && dash ? '\u2013' : nf.format(n || 0));
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n, a, b) => (n === 1 ? a : b);

/* ============================== 1. report model ============================== */
/** P = {report:'district'|'all'|'cumulative', district, year, from, to, basis, sections:{overall,summary,month,church}}
    D = {OFFERINGS, MONTHS, districts:[{name,churches:[]}], value(d,c,m,y,key), serial(d,c,m,y), modeLabel(basis)} */
export function buildTables(P, D) {
  const offs = D.OFFERINGS;
  const fi = D.MONTHS.indexOf(P.from), ti = D.MONTHS.indexOf(P.to);
  const months = fi < 0 || ti < 0 || fi > ti ? [] : D.MONTHS.slice(fi, ti + 1);
  const range = months.length > 1 ? months[0] + ' \u2013 ' + months[months.length - 1] : months[0] || '';
  const year = P.year;
  const basisName = D.modeLabel(P.basis);
  const meta = range + ' ' + year + ' \u00B7 ' + basisName + ' basis \u00B7 Figures in UGX';
  const note = P.basis === 'sunplus'
    ? 'SunPlus basis: late catch-up figures are attributed to the month they were reported in.'
    : 'Management basis: late catch-up figures are restated into the month they belong to.';
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const numCols = () => offs.map((o) => ({ t: 'num', label: o.label })).concat([{ t: 'num', label: 'Total', total: true }]);
  const withTotal = (vals) => vals.concat([sum(vals)]);
  const colSums = (rows, from) => { const n = rows.length ? rows[0].cells.length : 0; const out = []; for (let c = from; c < n; c++) out.push(sum(rows.map((r) => r.cells[c]))); return out; };
  const tables = [];
  let seq = 0;
  const add = (t) => { t.id = 't' + (seq++); tables.push(t); return t; };

  const districtTables = (dist, withTitle) => {
    const { name, churches } = dist;
    const startLen = tables.length;
    const base = { group: name };
    if (P.sections.summary) {
      const rows = churches.map((c) => ({ cells: [c].concat(withTotal(offs.map((o) => sum(months.map((m) => D.value(name, c, m, year, o.key)))))) }));
      add(Object.assign({}, base, {
        heading: 'Cumulative summary', sub: range + ' ' + year,
        cols: [{ t: 'name', label: 'Church' }].concat(numCols()), rows,
        totals: [{ label: 'DISTRICT TOTAL', cells: ['DISTRICT TOTAL'].concat(colSums(rows, 1)) }]
      }));
    }
    if (P.sections.month) {
      months.forEach((m) => {
        const rows = churches.map((c) => {
          const e = D.serial(name, c, m, year);
          return { cells: [c, e].concat(withTotal(offs.map((o) => D.value(name, c, m, year, o.key)))) };
        });
        add(Object.assign({}, base, {
          heading: m.toUpperCase() + ' ' + year, sub: 'By month',
          cols: [{ t: 'name', label: 'Church' }, { t: 'serial', label: 'Serial No' }].concat(numCols()), rows,
          totals: [{ label: 'TOTAL', cells: ['TOTAL', ''].concat(colSums(rows, 2)) }]
        }));
      });
    }
    if (P.sections.church) {
      churches.forEach((c) => {
        const rows = months.map((m) => ({ cells: [m, D.serial(name, c, m, year)].concat(withTotal(offs.map((o) => D.value(name, c, m, year, o.key)))) }));
        add(Object.assign({}, base, {
          heading: c, sub: 'By church \u00B7 ' + range + ' ' + year,
          cols: [{ t: 'name', label: 'Month' }, { t: 'serial', label: 'Serial No' }].concat(numCols()), rows,
          totals: [{ label: 'TOTAL', cells: ['TOTAL', ''].concat(colSums(rows, 2)) }]
        }));
      });
    }
    if (tables.length > startLen) {
      tables[startLen].newPage = true;
      if (withTitle) tables[startLen].titleBlock = withTitle;
    }
  };
  const districtTitle = (name) => ({ kicker: 'District financial report', title: name, meta, note });
  const districtSummaryTable = (list, heading) => {
    const rows = list.map((d) => ({
      cells: [d.name].concat(withTotal(offs.map((o) => sum(d.churches.map((c) => sum(months.map((m) => D.value(d.name, c, m, year, o.key))))))))
    }));
    return { heading, sub: range + ' ' + year, cols: [{ t: 'name', label: 'District' }].concat(numCols()), rows, totals: [{ label: 'GRAND TOTAL', cells: ['GRAND TOTAL'].concat(colSums(rows, 1)) }] };
  };

  if (months.length) {
    if (P.report === 'district') {
      const dist = D.districts.find((d) => d.name === P.district);
      if (dist) districtTables(dist, districtTitle(dist.name));
    } else if (P.report === 'all') {
      if (P.sections.overall && D.districts.length) {
        const t = add(Object.assign({ group: 'All districts', newPage: true, titleBlock: { kicker: 'All districts', title: 'Consolidated summary', meta, note } }, districtSummaryTable(D.districts, 'Summary by district')));
        t.id = t.id;
      }
      D.districts.forEach((d) => districtTables(d, districtTitle(d.name)));
    } else {   // cumulative: the same two tables as the Excel "Cumulative" workbook
      const byMonthRows = months.map((m) => ({ cells: [m].concat(withTotal(offs.map((o) => sum(D.districts.map((d) => sum(d.churches.map((c) => D.value(d.name, c, m, year, o.key)))))))) }));
      add({
        group: 'All districts', newPage: true,
        titleBlock: { kicker: 'Cumulative offertory report', title: 'All districts', meta, note },
        heading: 'By month', sub: range + ' ' + year, cols: [{ t: 'name', label: 'Month' }].concat(numCols()), rows: byMonthRows,
        totals: [{ label: 'GRAND TOTAL', cells: ['GRAND TOTAL'].concat(colSums(byMonthRows, 1)) }]
      });
      add(Object.assign({ group: 'All districts' }, districtSummaryTable(D.districts, 'By district')));
    }
  }
  const title = P.report === 'district' ? P.district : P.report === 'all' ? 'All districts' : 'Cumulative';
  return { tables, months, range, title, meta };
}

/* ============================== 2. fitting the text size ============================== */
export function canvasMeasure() {
  const c = document.createElement('canvas').getContext('2d');
  return (text, weight, px, family) => { c.font = weight + ' ' + px + 'px ' + family; return c.measureText(text).width; };
}
const SANS = '"DM Sans", system-ui, sans-serif';
const MONO = '"JetBrains Mono", monospace';

function columnPlan(t, fs, innerW, measure, opts, padX) {
  const pad = padX * 2 + 1;
  const nameCells = t.rows.map((r) => String(r.cells[0])).concat(t.totals.map((x) => x.label), [t.cols[0].label]);
  const nameWMeasured = Math.max.apply(null, nameCells.map((s) => measure(s, 600, fs, SANS))) + pad + 2;
  const nameW = Math.min(nameWMeasured, innerW * 0.34);
  let serialW = 0;
  const hasSerial = t.cols[1] && t.cols[1].t === 'serial';
  if (hasSerial) {
    const cells = t.rows.map((r) => String(r.cells[1])).concat([t.cols[1].label]);
    serialW = Math.max.apply(null, cells.map((s) => measure(s, 400, fs * 0.92, SANS))) + pad;
  }
  const firstNum = hasSerial ? 2 : 1;
  const numNeeds = [];
  for (let c = firstNum; c < t.cols.length; c++) {
    const strs = t.rows.map((r) => fmtNum(r.cells[c], opts.dash)).concat(t.totals.map((x) => fmtNum(x.cells[c], opts.dash)));
    const digits = Math.max.apply(null, strs.map((s) => s.length)) * 0.6 * fs * 1.0 + pad;
    const words = t.cols[c].label.split(/\s+/);
    const header = Math.max.apply(null, words.map((w) => measure(w, 700, fs * 0.88, SANS))) + pad;
    numNeeds.push(Math.max(digits, header));
  }
  const need = nameW + serialW + numNeeds.reduce((a, b) => a + b, 0);
  return { nameW, serialW, numNeeds, need, hasSerial, pad: padX };
}

/** Choose the layout: the largest text size (10pt down to 6pt) at which every table fits the page width.
    At each size the gaps between columns are tightened (6 -> 4 -> 3 px) before the text is made smaller, because
    smaller text hurts readability more than narrower gaps do.  If even 6pt with tight gaps is too wide the tables
    are scaled down (with a warning) rather than cut off. */
export function fitLayout(tables, innerW, measure, opts) {
  if (!tables.length) return { fs: MAX_PT * 96 / 72, pt: MAX_PT, scale: 1, tableW: innerW, padX: 6, warnings: [] };
  const pads = opts.compact ? [4, 3] : [6, 4, 3];
  const needAt = (fs, padX) => Math.max.apply(null, tables.map((t) => columnPlan(t, fs, innerW, measure, opts, padX).need));
  for (let pt = MAX_PT; pt >= MIN_PT - 0.001; pt -= 0.25) {
    const fs = pt * 96 / 72;
    for (const padX of pads) {
      if (needAt(fs, padX) <= innerW) return { fs, pt, scale: 1, tableW: innerW, padX, warnings: pt < 7 ? ['small'] : [] };
    }
  }
  const fs = MIN_PT * 96 / 72, padX = pads[pads.length - 1];
  const need = needAt(fs, padX);
  return { fs, pt: MIN_PT * innerW / need, scale: innerW / need, tableW: need, padX, warnings: ['scaled'] };
}

/* ============================== 3. rendering pieces ============================== */
function tableHTML(t, rows, rowOffset, plan, L, opts, withTotals) {
  const nNum = t.cols.length - (plan.hasSerial ? 2 : 1);
  const sumNeeds = plan.numNeeds.reduce((a, b) => a + b, 0) || 1;
  const extra = Math.max(0, L.tableW - plan.nameW - plan.serialW - sumNeeds);   // spare room, shared in proportion to need
  let h = '<table class="pp-table' + (opts.shading ? ' shaded' : '') + (opts.compact ? ' compact' : '') + '" style="width:' + L.tableW.toFixed(1) + 'px;font-size:' + L.fs.toFixed(2) + 'px;--cpx:' + plan.pad + 'px"><colgroup>';
  h += '<col style="width:' + plan.nameW.toFixed(1) + 'px">';
  if (plan.hasSerial) h += '<col style="width:' + plan.serialW.toFixed(1) + 'px">';
  for (let i = 0; i < nNum; i++) h += '<col style="width:' + (plan.numNeeds[i] + extra * plan.numNeeds[i] / sumNeeds).toFixed(2) + 'px">';
  h += '</colgroup><thead><tr>' + t.cols.map((c) => '<th class="' + (c.t === 'name' ? 'c-name' : c.t === 'serial' ? 'c-ser' : 'c-num') + (c.total ? ' c-tot' : '') + '">' + esc(c.label) + '</th>').join('') + '</tr></thead><tbody>';
  rows.forEach((r, i) => {
    h += '<tr class="' + ((rowOffset + i) % 2 ? 'alt' : '') + '">' + r.cells.map((v, ci) => cellHTML(t.cols[ci], v, opts)).join('') + '</tr>';
  });
  h += '</tbody>';
  if (withTotals) h += '<tfoot>' + t.totals.map((x) => '<tr class="tot">' + x.cells.map((v, ci) => cellHTML(t.cols[ci], v, opts)).join('') + '</tr>').join('') + '</tfoot>';
  return h + '</table>';
}
function cellHTML(col, v, opts) {
  if (col.t === 'name') return '<td class="c-name">' + esc(v) + '</td>';
  if (col.t === 'serial') return '<td class="c-ser">' + esc(v) + '</td>';
  const zero = (!v || !isFinite(v));
  return '<td class="c-num' + (col.total ? ' c-tot' : '') + (zero && opts.dash ? ' z' : '') + '">' + fmtNum(v, opts.dash) + '</td>';
}
const titleBlockHTML = (tb) =>
  '<div class="pp-title"><div class="pp-kicker">' + esc(tb.kicker) + '</div><div class="pp-h1">' + esc(tb.title) + '</div><div class="pp-meta">' + esc(tb.meta) + '</div><div class="pp-note">' + esc(tb.note) + '</div></div>';
const headingHTML = (t, contd) =>
  '<div class="pp-th"><span class="pp-th-t">' + esc(t.heading) + (contd ? ' <em>(continued)</em>' : '') + '</span><span class="pp-th-s">' + esc(t.sub) + '</span></div>';
function fragHTML(frag, plans, L, opts) {
  const t = frag.t, plan = plans[t.id];
  const body = tableHTML(t, t.rows.slice(frag.from, frag.to), frag.from, plan, L, opts, frag.last);
  const wrapped = L.scale < 1 ? '<div class="pp-tw" style="zoom:' + L.scale.toFixed(4) + '">' + body + '</div>' : body;
  return '<div class="pp-frag" data-t="' + t.id + '" data-g="' + esc(t.group || '') + '">' + (frag.first && t.titleBlock ? titleBlockHTML(t.titleBlock) : '') + headingHTML(t, !frag.first) + wrapped + '</div>';
}

/* ============================== 4. pagination ============================== */
/** Packs tables onto pages using REAL measured heights (built in a hidden container at the final width and font). */
export function paginate(tables, plans, L, opts, bodyPx, measureHost) {
  const measured = {};
  measureHost.innerHTML = '';
  tables.forEach((t) => {
    const holder = document.createElement('div');
    holder.className = 'pp-measure-one';
    holder.innerHTML = fragHTML({ t, from: 0, to: t.rows.length, first: true, last: true }, plans, L, opts);
    measureHost.appendChild(holder);
    measured[t.id] = {
      title: (() => { const t0 = holder.querySelector('.pp-title'); return t0 ? t0.getBoundingClientRect().height + (parseFloat(getComputedStyle(t0).marginBottom) || 0) : 0; })(),
      heading: holder.querySelector('.pp-th').getBoundingClientRect().height,
      thead: holder.querySelector('thead').getBoundingClientRect().height,
      rows: Array.from(holder.querySelectorAll('tbody tr')).map((r) => r.getBoundingClientRect().height),
      totals: Array.from(holder.querySelectorAll('tfoot tr')).map((r) => r.getBoundingClientRect().height).reduce((a, b) => a + b, 0)
    };
  });
  measureHost.innerHTML = '';
  const avail = bodyPx - SAFE_PX;
  const pages = [];
  let page = null, used = 0;
  const start = () => { page = { frags: [] }; pages.push(page); used = 0; };
  start();
  tables.forEach((t) => {
    const m = measured[t.id];
    const n = t.rows.length;
    const keep = Math.min(n, 2);                                   // a piece always carries at least 2 rows (or all of them)
    const headH = (first) => (first ? m.title : 0) + m.heading + m.thead;
    const rowsH = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += m.rows[i]; return s; };
    // the first piece needs heading + header + `keep` rows (+ totals if the whole table is that short)
    const firstNeed = headH(true) + rowsH(0, keep) + (keep === n ? m.totals : 0);
    if ((t.newPage && page.frags.length) || (used + firstNeed > avail && page.frags.length)) start();
    let i = 0, first = true;
    while (true) {
      const room = avail - used;
      const fixed = headH(first);
      let j = i, h = fixed;
      while (j < n && h + m.rows[j] <= room) { h += m.rows[j]; j++; }
      if (j >= n) {                                                  // all remaining rows fit: do the totals fit too?
        if (h + m.totals <= room) { page.frags.push({ t, from: i, to: n, first, last: true }); used += h + m.totals + GAP_PX; break; }
        j = Math.max(i + (j - i > 2 ? j - i - 2 : 0), i);            // no: hand the last 2 rows to the next page, with the totals
        if (j <= i && page.frags.length) { start(); continue; }
      } else if (n - j < 2 && j - i > 2) {
        j = n - 2;                                                   // never strand a single row on the next page
      }
      if (j <= i) {                                                  // not even one row fits
        if (page.frags.length) { start(); continue; }
        j = i + 1;                                                   // a single row taller than a page: place it anyway
      }
      page.frags.push({ t, from: i, to: j, first, last: false });
      first = false; i = j;
      start();
      if (i >= n) { page.frags.pop(); pages.pop(); break; }
    }
  });
  while (pages.length > 1 && !pages[pages.length - 1].frags.length) pages.pop();
  return pages.filter((p) => p.frags.length);
}

/* ============================== 5. assembling pages ============================== */
const LOGO = '<svg viewBox="18 18 84 84" width="20" height="20" aria-hidden="true"><circle cx="60" cy="60" r="34" fill="none" stroke="#1d1c18" stroke-width="3"/><circle cx="60" cy="60" r="25" fill="none" stroke="#1d1c18" stroke-opacity=".5" stroke-width="2"/><g fill="#b9822a" transform="translate(60 60) scale(1.35) translate(-60 -60)"><path id="ppP" d="M60 60 C57.2 54.5 57.2 49 60 42 C62.8 49 62.8 54.5 60 60 Z"/><path d="M60 60 C57.2 54.5 57.2 49 60 42 C62.8 49 62.8 54.5 60 60 Z" transform="rotate(90 60 60)"/><path d="M60 60 C57.2 54.5 57.2 49 60 42 C62.8 49 62.8 54.5 60 60 Z" transform="rotate(180 60 60)"/><path d="M60 60 C57.2 54.5 57.2 49 60 42 C62.8 49 62.8 54.5 60 60 Z" transform="rotate(270 60 60)"/></g></svg>';

export function renderPages(pages, plans, L, opts, info) {
  const total = pages.length;
  return pages.map((p, i) => {
    const group = p.frags[0].t.group || info.title;
    const head = opts.headerFooter
      ? '<header class="pp-head"><span class="pp-brand">' + LOGO + '<b>STARSYS</b><span>Financial Reporting</span></span><span class="pp-headr">' + esc(group) + ' \u00B7 ' + esc(info.year) + '</span></header>' : '';
    const foot = opts.headerFooter
      ? '<footer class="pp-foot"><span>Generated ' + esc(info.generated) + (info.user ? ' by ' + esc(info.user) : '') + '</span><span>' + esc(info.basisLabel) + ' basis</span><span class="pp-pg">Page ' + (i + 1) + ' of ' + total + '</span></footer>' : '';
    return '<section class="pp-page' + (opts.headerFooter ? '' : ' no-hf') + '" data-n="' + (i + 1) + '" aria-label="Page ' + (i + 1) + ' of ' + total + '">' + head
      + '<div class="pp-body">' + p.frags.map((f) => fragHTML(f, plans, L, opts)).join('') + '</div>' + foot + '</section>';
  }).join('');
}

/** Everything needed to turn settings into pages: returns { html, pageCount, landscape, pt, warnings, ... } */
export function buildDocument(P, S, D, env) {
  const model = buildTables(P, D);
  const paper = PAPERS[S.paper] || PAPERS.A4;
  const maxCols = model.tables.reduce((m, t) => Math.max(m, t.cols.length), 0);
  const landscape = S.orient === 'landscape' ? true : S.orient === 'portrait' ? false : maxCols > 8;
  const pw = landscape ? paper.h : paper.w, ph = landscape ? paper.w : paper.h;
  const m = (MARGINS[S.margin] || MARGINS.normal).mm;
  const innerW = (pw - 2 * m) * MM;
  const bodyPx = (ph - 2 * m - (S.headerFooter ? HEADER_MM + FOOTER_MM + BODY_PAD_MM : 0)) * MM;
  const opts = { compact: !!S.compact, dash: !!S.dash, shading: !!S.shading, headerFooter: !!S.headerFooter };
  const L = fitLayout(model.tables, innerW, env.measure, opts);
  const plans = {};
  model.tables.forEach((t) => { plans[t.id] = columnPlan(t, L.fs, L.scale < 1 ? L.tableW : innerW, env.measure, opts, L.padX); });
  env.measureHost.style.width = innerW + 'px';
  env.measureHost.style.setProperty('--pw', pw + 'mm');
  const pages = model.tables.length ? paginate(model.tables, plans, L, opts, bodyPx, env.measureHost) : [];
  const info = { title: model.title, year: P.year, generated: env.generated, user: env.user, basisLabel: D.modeLabel(P.basis) };
  return {
    html: renderPages(pages, plans, L, opts, info), pageCount: pages.length, landscape, pw, ph, margin: m, pt: L.pt, scale: L.scale,
    warnings: L.warnings.slice(), model, paperKey: S.paper in PAPERS ? S.paper : 'A4', title: model.title, meta: model.meta
  };
}

/* ============================== 6. the print screen ============================== */
const PREFS_KEY = 'starsys_print_prefs_v1';
const SECTIONS_FOR = { district: ['summary', 'month', 'church'], all: ['overall', 'summary', 'month', 'church'], cumulative: [] };

export function createPrint(ctx) {
  const DEFAULTS = { report: 'district', basis: 'management', paper: 'A4', orient: 'auto', margin: 'normal', headerFooter: true, shading: true, dash: true, compact: false, sections: { overall: true, summary: true, month: true, church: false } };
  let S = null, overlay = null, built = null, open_ = false, prevFocus = null, zoomMode = 'fit', zoom = 1, buildTimer = null, buildSeq = 0, measureHost = null, pageStyleEl = null;
  const $ = (sel) => overlay.querySelector(sel);

  function loadPrefs() {
    try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ paper: S.paper, orient: S.orient, margin: S.margin, headerFooter: S.headerFooter, shading: S.shading, dash: S.dash, compact: S.compact, sections: S.sections })); } catch (e) { /* ignore */ }
  }

  /* ------------------------------ DOM ------------------------------ */
  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function ensureDom() {
    if (overlay) return;
    overlay = el(
      '<div id="printOverlay" class="pp-overlay" role="dialog" aria-modal="true" aria-label="Print" hidden>'
      + '<aside class="pp-side"><div class="pp-side-scroll">'
      + '<div class="pp-top"><button type="button" class="pp-back" data-pp="close" aria-label="Close print screen"><i data-lucide="arrow-left" class="w-4 h-4"></i></button><h2>Print</h2></div>'
      + '<div class="pp-actions"><button type="button" class="pp-printbtn" data-pp="print"><i data-lucide="printer" class="w-6 h-6"></i><span>Print</span></button>'
      + '<button type="button" class="pp-pdfbtn" data-pp="pdf" hidden><i data-lucide="file-down" class="w-4 h-4"></i><span>Save as PDF</span></button></div>'
      + '<p class="pp-hint" id="ppHint"></p>'
      + '<div class="pp-row pp-range"><label for="ppPgFrom">Pages</label><input id="ppPgFrom" type="number" min="1" inputmode="numeric" placeholder="1"><span>to</span><input id="ppPgTo" type="number" min="1" inputmode="numeric" placeholder="all"></div>'
      + '<h3 class="pp-h">Report</h3><div class="pp-cards" role="radiogroup" aria-label="Report">'
      + card('district', 'One district', 'Summary, months and churches of one district')
      + card('all', 'All districts', 'A consolidated summary, then every district')
      + card('cumulative', 'Cumulative', 'Totals by month and by district on one page') + '</div>'
      + '<h3 class="pp-h">Data</h3><div class="pp-grid2">'
      + '<div id="ppDistrictWrap" class="pp-span2"><label for="ppDistrict">District</label><select id="ppDistrict"></select></div>'
      + '<div><label for="ppFrom">From month</label><select id="ppFrom"></select></div><div><label for="ppTo">To month</label><select id="ppTo"></select></div>'
      + '<div><label for="ppYear">Year</label><select id="ppYear"></select></div>'
      + '<div><label for="ppBasis">Accounting basis</label><select id="ppBasis"><option value="management">Management</option><option value="sunplus">SunPlus</option></select></div></div>'
      + '<div id="ppSectionsWrap"><h3 class="pp-h">Include</h3><div class="pp-checks">'
      + check('overall', 'Overall summary of all districts', 'ppChkOverall') + check('summary', 'Cumulative summary', 'ppChkSummary')
      + check('month', 'One table per month', 'ppChkMonth') + check('church', 'One table per church', 'ppChkChurch') + '</div></div>'
      + '<h3 class="pp-h">Page setup</h3><div class="pp-grid2">'
      + '<div class="pp-span2"><label for="ppPaper">Paper size</label><select id="ppPaper">' + Object.keys(PAPERS).map((k) => '<option value="' + k + '">' + PAPERS[k].label + '</option>').join('') + '</select></div>'
      + '<div class="pp-span2"><span class="pp-lbl" id="ppOrientLbl">Orientation</span><div class="pp-seg" role="radiogroup" aria-labelledby="ppOrientLbl">'
      + seg('auto', 'Auto') + seg('portrait', 'Portrait') + seg('landscape', 'Landscape') + '</div></div>'
      + '<div class="pp-span2"><label for="ppMargin">Margins</label><select id="ppMargin">' + Object.keys(MARGINS).map((k) => '<option value="' + k + '">' + MARGINS[k].label + ' (' + MARGINS[k].mm + ' mm)</option>').join('') + '</select></div></div>'
      + '<div class="pp-toggles">' + toggle('headerFooter', 'Header and footer', 'Page numbers, date and who printed') + toggle('shading', 'Row shading', 'Light alternate rows, easier to follow') + toggle('dash', 'Show zero as \u2013', 'Cleaner than a column of zeros') + toggle('compact', 'Compact rows', 'Fits more rows on a page') + '</div>'
      + '</div></aside>'
      + '<main class="pp-stage"><div class="pp-info" id="ppInfo" aria-live="polite"></div><div class="pp-warn" id="ppWarn" hidden></div>'
      + '<div class="pp-scroll" id="ppScroll" tabindex="0" aria-label="Print preview"><div class="pp-pages" id="ppPages"></div><div class="pp-busy" id="ppBusy" hidden>Preparing preview\u2026</div></div>'
      + '<div class="pp-bar" role="toolbar" aria-label="Preview controls"><button type="button" data-pp="prev" aria-label="Previous page"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>'
      + '<span id="ppPageNo">0 of 0</span><button type="button" data-pp="next" aria-label="Next page"><i data-lucide="chevron-right" class="w-4 h-4"></i></button><span class="pp-sep"></span>'
      + '<button type="button" data-pp="zout" aria-label="Zoom out"><i data-lucide="minus" class="w-4 h-4"></i></button><button type="button" data-pp="fit" id="ppZoomLbl" aria-label="Fit to width">Fit</button><button type="button" data-pp="zin" aria-label="Zoom in"><i data-lucide="plus" class="w-4 h-4"></i></button></div>'
      + '</main></div>');
    document.body.appendChild(overlay);
    measureHost = el('<div class="pp-measure pp-body-like" aria-hidden="true"></div>');
    document.body.appendChild(measureHost);
    pageStyleEl = document.createElement('style'); pageStyleEl.id = 'ppPageStyle'; document.head.appendChild(pageStyleEl);
    wire();
  }
  const card = (v, t, d) => '<label class="pp-card" data-report="' + v + '"><input type="radio" name="ppReport" value="' + v + '" class="sr-only"><span class="pp-radio"></span><b>' + t + '</b><span>' + d + '</span></label>';
  const check = (k, label, id) => '<label class="pp-check"><input type="checkbox" id="' + id + '" data-sec="' + k + '"><span class="pp-box"></span><span>' + label + '</span></label>';
  const seg = (v, label) => '<label class="pp-segopt"><input type="radio" name="ppOrient" value="' + v + '" class="sr-only"><span>' + label + '</span></label>';
  const toggle = (k, t, d) => '<label class="pp-toggle"><span><b>' + t + '</b><span>' + d + '</span></span><input type="checkbox" role="switch" class="pp-switch" data-tog="' + k + '"></label>';

  function fillSelects() {
    const opt = (v, l) => '<option value="' + esc(v) + '">' + esc(l == null ? v : l) + '</option>';
    $('#ppDistrict').innerHTML = ctx.districtNames().map((d) => opt(d)).join('');
    $('#ppFrom').innerHTML = ctx.MONTHS.map((m) => opt(m)).join('');
    $('#ppTo').innerHTML = ctx.MONTHS.map((m) => opt(m)).join('');
    $('#ppYear').innerHTML = ctx.years().map((y) => opt(y)).join('');
  }
  function syncControls() {
    $('#ppDistrict').value = S.district; $('#ppFrom').value = S.from; $('#ppTo').value = S.to; $('#ppYear').value = S.year; $('#ppBasis').value = S.basis;
    $('#ppPaper').value = S.paper; $('#ppMargin').value = S.margin;
    overlay.querySelectorAll('.pp-card').forEach((c) => { const on = c.dataset.report === S.report; c.classList.toggle('selected', on); c.querySelector('input').checked = on; });
    overlay.querySelectorAll('[name="ppOrient"]').forEach((r) => { r.checked = r.value === S.orient; r.closest('.pp-segopt').classList.toggle('on', r.checked); });
    overlay.querySelectorAll('[data-tog]').forEach((t) => { t.checked = !!S[t.dataset.tog]; });
    overlay.querySelectorAll('[data-sec]').forEach((c) => { c.checked = !!S.sections[c.dataset.sec]; });
    const secs = SECTIONS_FOR[S.report];
    $('#ppDistrictWrap').hidden = S.report !== 'district';
    $('#ppSectionsWrap').hidden = secs.length === 0;
    overlay.querySelectorAll('[data-sec]').forEach((c) => { c.closest('.pp-check').hidden = !secs.includes(c.dataset.sec); });
    $('#ppHint').textContent = ctx.canSavePdf() ? 'Next, choose your printer and number of copies, or use Save as PDF if no printer is available.' : 'Next, your browser\u2019s print window lets you choose a printer and copies, or Save as PDF.';
    $('[data-pp="pdf"]').hidden = !ctx.canSavePdf();
  }

  /* ------------------------------ building the preview ------------------------------ */
  function schedule() { clearTimeout(buildTimer); buildTimer = setTimeout(build, 140); }

  async function build() {
    if (!open_) return;
    const seq = ++buildSeq;
    $('#ppBusy').hidden = false;
    await new Promise((r) => setTimeout(r, 20));
    try {
      await ctx.fontsReady();
      const names = ctx.districtNames();
      const dists = (S.report === 'district' ? names.filter((n) => n === S.district) : names).map((name) => ({ name, churches: ctx.churchesOf(name) }));
      const data = ctx.buildData(S.basis, dists.map((d) => d.name));
      const D = { OFFERINGS: ctx.offerings(), MONTHS: ctx.MONTHS, districts: dists, value: data.value, serial: data.serial, modeLabel: ctx.modeLabel };
      const P = { report: S.report, district: S.district, year: S.year, from: S.from, to: S.to, basis: S.basis, sections: S.sections };
      const env = { measure: canvasMeasure(), measureHost, generated: new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), user: ctx.userName() };
      const doc = buildDocument(P, S, D, env);
      if (seq !== buildSeq) return;
      built = doc;
      applyDocument();
    } catch (e) {
      console.error(e);
      $('#ppPages').innerHTML = '';
      showWarn(['Could not prepare the preview: ' + (e && e.message ? e.message : 'unknown error')], true);
    }
    if (seq === buildSeq) $('#ppBusy').hidden = true;
  }

  function showWarn(list, isError) {
    const w = $('#ppWarn');
    w.hidden = !list.length;
    w.classList.toggle('error', !!isError);
    w.innerHTML = list.map((t) => '<span>' + esc(t) + '</span>').join('');
  }

  function applyDocument() {
    const d = built;
    const pages = $('#ppPages');
    pages.style.setProperty('--pw', d.pw + 'mm'); pages.style.setProperty('--ph', d.ph + 'mm'); pages.style.setProperty('--m', d.margin + 'mm');
    pages.style.setProperty('--hf', S.headerFooter ? '1' : '0');
    pages.classList.toggle('no-hf', !S.headerFooter);
    pages.innerHTML = d.html || '<div class="pp-empty"><b>Nothing to print</b><span>Check the month range, district and sections you selected.</span></div>';
    pageStyleEl.textContent = '@page { size: ' + d.pw + 'mm ' + d.ph + 'mm; margin: 0 }';
    const warns = [];
    if (d.warnings.includes('scaled')) warns.push('This report has too many columns for ' + d.paperKey + ' ' + (d.landscape ? 'landscape' : 'portrait') + '. The text was scaled down to fit and is very small. Try a larger paper size.');
    else if (d.warnings.includes('small')) warns.push('Text is small (' + d.pt.toFixed(1) + ' pt) so every column fits.' + (d.landscape ? ' A larger paper size would make it easier to read.' : ' Landscape would make it easier to read.'));
    if (d.pageCount > 120) warns.push('This will print ' + d.pageCount + ' pages. Check the report and sections, or set a page range.');
    showWarn(warns, false);
    $('#ppInfo').innerHTML = '<b>' + d.pageCount + ' ' + plural(d.pageCount, 'page', 'pages') + '</b><span>' + d.paperKey + ' \u00B7 ' + (d.landscape ? 'Landscape' : 'Portrait') + '</span><span>Text ' + d.pt.toFixed(1) + ' pt</span><span>' + esc(d.title) + '</span>';
    applyRange(); fitZoom(); updatePageNo(); ctx.refreshIcons();
  }

  /* ------------------------------ range / zoom / navigation ------------------------------ */
  function range() {
    const n = built ? built.pageCount : 0;
    let a = parseInt($('#ppPgFrom').value, 10), b = parseInt($('#ppPgTo').value, 10);
    if (!(a >= 1)) a = 1; if (!(b >= 1)) b = n; a = Math.min(a, Math.max(n, 1)); b = Math.min(Math.max(b, a), Math.max(n, 1));
    return [a, b];
  }
  function applyRange() {
    const [a, b] = range();
    overlay.querySelectorAll('.pp-page').forEach((p) => { const k = +p.dataset.n; p.classList.toggle('pp-skip', k < a || k > b); });
    const n = built ? built.pageCount : 0;
    const printing = Math.max(0, b - a + 1);
    $('[data-pp="print"] span').textContent = n && printing !== n ? 'Print ' + printing + ' of ' + n : 'Print';
  }
  function pageWidthPx() { return built ? built.pw * MM : 794; }
  function fitZoom() {
    const stage = $('#ppScroll');
    if (zoomMode === 'fit') zoom = Math.max(0.2, Math.min(1.4, (stage.clientWidth - 56) / pageWidthPx()));
    $('#ppPages').style.zoom = String(zoom);
    $('#ppZoomLbl').textContent = zoomMode === 'fit' ? 'Fit' : Math.round(zoom * 100) + '%';
  }
  function currentPage() {
    const pgs = [...overlay.querySelectorAll('.pp-page')]; if (!pgs.length) return 0;
    const sc = $('#ppScroll').getBoundingClientRect(); const mid = sc.top + sc.height * 0.35;
    let best = 0, bd = Infinity;
    pgs.forEach((p, i) => { const r = p.getBoundingClientRect(); const d = Math.abs((r.top + r.bottom) / 2 - mid); if (r.top <= mid && r.bottom >= mid) { best = i; bd = -1; } else if (bd >= 0 && d < bd) { best = i; bd = d; } });
    return best + 1;
  }
  function updatePageNo() { const n = built ? built.pageCount : 0; $('#ppPageNo').textContent = (n ? currentPage() : 0) + ' of ' + n; }
  function goPage(k) { const p = overlay.querySelector('.pp-page[data-n="' + k + '"]'); if (p) p.scrollIntoView({ block: 'start', behavior: 'smooth' }); }

  /* ------------------------------ printing ------------------------------ */
  function docTitle() { return 'Starsys \u2013 ' + (built ? built.title : 'Report') + ' \u2013 ' + S.year + ' \u2013 ' + ctx.modeLabel(S.basis); }
  async function doPrint() {
    if (!built || !built.pageCount) return;
    const prevTitle = document.title;
    document.body.classList.add('printing-report');
    document.title = docTitle();
    const finish = () => { document.title = prevTitle; document.body.classList.remove('printing-report'); window.removeEventListener('afterprint', finish); };
    window.addEventListener('afterprint', finish);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      if (ctx.desktop && ctx.desktop.print) {
        const res = await ctx.desktop.print({ paper: built.paperKey, landscape: built.landscape });
        finish();
        if (res && res.success === false && res.reason && !/cancel/i.test(res.reason)) showWarn(['Printing did not start: ' + res.reason], true);
      } else window.print();
    } catch (e) { finish(); showWarn(['Printing failed: ' + (e && e.message ? e.message : e)], true); }
  }
  async function doPdf() {
    if (!built || !built.pageCount || !ctx.desktop || !ctx.desktop.savePdf) return;
    document.body.classList.add('printing-report');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const res = await ctx.desktop.savePdf({ paper: built.paperKey, landscape: built.landscape, name: docTitle() });
      if (res && res.ok) showWarn(['Saved to ' + res.path], false);
      else if (res && !res.canceled) showWarn(['Could not save the PDF.'], true);
    } catch (e) { showWarn(['Could not save the PDF: ' + (e && e.message ? e.message : e)], true); }
    document.body.classList.remove('printing-report');
  }

  /* ------------------------------ events ------------------------------ */
  function wire() {
    overlay.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-pp]'); if (!b) return;
      const k = b.dataset.pp;
      if (k === 'close') close();
      else if (k === 'print') doPrint();
      else if (k === 'pdf') doPdf();
      else if (k === 'prev') goPage(Math.max(1, currentPage() - 1));
      else if (k === 'next') goPage(Math.min(built ? built.pageCount : 1, currentPage() + 1));
      else if (k === 'fit') { zoomMode = 'fit'; fitZoom(); }
      else if (k === 'zin') { zoomMode = 'custom'; zoom = Math.min(2, +(zoom + 0.1).toFixed(2)); fitZoom(); }
      else if (k === 'zout') { zoomMode = 'custom'; zoom = Math.max(0.2, +(zoom - 0.1).toFixed(2)); fitZoom(); }
    });
    overlay.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.name === 'ppReport') S.report = t.value;
      else if (t.id === 'ppDistrict') S.district = t.value;
      else if (t.id === 'ppFrom') { S.from = t.value; if (ctx.MONTHS.indexOf(S.to) < ctx.MONTHS.indexOf(S.from)) S.to = S.from; }
      else if (t.id === 'ppTo') { S.to = t.value; if (ctx.MONTHS.indexOf(S.to) < ctx.MONTHS.indexOf(S.from)) S.from = S.to; }
      else if (t.id === 'ppYear') S.year = t.value;
      else if (t.id === 'ppBasis') S.basis = t.value;
      else if (t.id === 'ppPaper') S.paper = t.value;
      else if (t.id === 'ppMargin') S.margin = t.value;
      else if (t.name === 'ppOrient') S.orient = t.value;
      else if (t.dataset && t.dataset.tog) S[t.dataset.tog] = t.checked;
      else if (t.dataset && t.dataset.sec) S.sections[t.dataset.sec] = t.checked;
      else if (t.id === 'ppPgFrom' || t.id === 'ppPgTo') { applyRange(); return; }
      savePrefs(); syncControls(); schedule();
    });
    overlay.addEventListener('input', (ev) => { if (ev.target.id === 'ppPgFrom' || ev.target.id === 'ppPgTo') applyRange(); });
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
      if (ev.key === 'Tab') {   // keep Tab inside the dialog
        const f = [...overlay.querySelectorAll('button, select, input, [tabindex="0"]')].filter((x) => !x.disabled && !x.hidden && x.offsetParent !== null && !x.classList.contains('sr-only'));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    });
    $('#ppScroll').addEventListener('scroll', () => { updatePageNo(); }, { passive: true });
    window.addEventListener('resize', () => { if (open_) { fitZoom(); updatePageNo(); } });
  }

  /* ------------------------------ open / close ------------------------------ */
  function open(opts) {
    ensureDom();
    const init = ctx.initial();
    const saved = loadPrefs();
    const names = ctx.districtNames();
    S = Object.assign({}, DEFAULTS, saved, { sections: Object.assign({}, DEFAULTS.sections, saved.sections || {}) });
    S.report = (opts && opts.report) || 'district';
    S.district = names.includes(init.district) ? init.district : names[0] || '';
    S.year = init.year; S.from = init.from; S.to = init.to; S.basis = init.basis === 'sunplus' ? 'sunplus' : 'management';
    fillSelects(); syncControls();
    $('#ppPgFrom').value = ''; $('#ppPgTo').value = '';
    zoomMode = 'fit'; built = null;
    prevFocus = (opts && opts.opener) || document.activeElement;   // focus goes back to whatever opened the screen
    overlay.hidden = false; open_ = true;
    document.body.classList.add('pp-open');
    ctx.refreshIcons();
    $('[data-pp="print"]').focus();
    build();
  }
  function close() {
    if (!open_) return;
    open_ = false; overlay.hidden = true;
    document.body.classList.remove('pp-open', 'printing-report');
    $('#ppPages').innerHTML = ''; measureHost.innerHTML = ''; built = null;
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus(); } catch (e) { /* ignore */ } }
  }

  return { open, close, print: doPrint, get isOpen() { return open_; }, _state: () => ({ S, built }), _build: build };
}
