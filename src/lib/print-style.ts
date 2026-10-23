// src/lib/print-style.ts — THE LOOK OF EVERYTHING THE SHOP PRINTS, the app's own (the same as the smart packing slip,
// components/print/SmartSlip): Plus Jakarta Sans; light headings with at most one semibold word; small labels in
// sentence case and muted grey, never spaced-out capitals; thin #ececee lines instead of black rules; soft #f5f5f7
// panels with rounded corners; ink #16171a; green for good news, amber for "look at this", red only for something gone
// wrong. Weights stay between 300 and 600.
// Two ways in: PRINT_CSS (with PRINT_FONT_HREF) for the /print pages drawn as React, and printPage() for documents
// built as an HTML string and opened in a new window (the Money reports). Everything is scoped under .pp so a preview
// inside the app isn't restyled by it.

export const PRINT = {
  ink: '#16171a', body: '#45474c', muted: '#6d7075', faint: '#9a9ca1', line: '#ececee', soft: '#f5f5f7',
  green: '#1f7a4d', greenSoft: '#eaf6ef', amber: '#b45309', amberSoft: '#fdf3e7', red: '#b42318', redSoft: '#fdecea',
} as const;

export const PRINT_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600&display=swap';
export const PRINT_FONT_STACK = "'Plus Jakarta Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export const PRINT_CSS = `
.pp { font-family: ${PRINT_FONT_STACK}; color: ${PRINT.ink}; font-size: 12px; line-height: 1.5; font-weight: 400; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pp *, .pp *::before, .pp *::after { box-sizing: border-box; }
.pp h1 { font-size: 26px; font-weight: 300; letter-spacing: -0.02em; line-height: 1.15; margin: 0; }
.pp h1 b, .pp h2 b { font-weight: 600; }
.pp h2 { font-size: 13px; font-weight: 600; margin: 22px 0 8px; }
.pp h3 { font-size: 12px; font-weight: 600; margin: 14px 0 6px; }
.pp p { margin: 0; }
.pp b, .pp strong { font-weight: 600; }
.pp .muted { color: ${PRINT.muted}; } .pp .faint { color: ${PRINT.faint}; } .pp .body { color: ${PRINT.body}; }
.pp .lbl { font-size: 11px; font-weight: 500; color: ${PRINT.muted}; }
.pp .num, .pp td, .pp .amt { font-variant-numeric: tabular-nums; }
.pp .r { text-align: right; } .pp .c { text-align: center; } .pp .nowrap { white-space: nowrap; }
.pp .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid ${PRINT.line}; margin-bottom: 18px; }
.pp .head .sub { color: ${PRINT.muted}; margin-top: 4px; }
.pp .shop { font-size: 13px; font-weight: 600; }
.pp .meta { font-size: 11px; color: ${PRINT.muted}; text-align: right; line-height: 1.6; }
.pp table { width: 100%; border-collapse: collapse; }
.pp thead { display: table-header-group; }
.pp th { text-align: left; font-size: 11px; font-weight: 500; color: ${PRINT.muted}; padding: 6px 8px; border-bottom: 1px solid ${PRINT.line}; }
.pp td { padding: 7px 8px; border-bottom: 1px solid ${PRINT.line}; vertical-align: top; }
.pp tr { break-inside: avoid; }
.pp .panel { background: ${PRINT.soft}; border-radius: 14px; padding: 12px 14px; break-inside: avoid; }
.pp .box { border: 1px solid ${PRINT.line}; border-radius: 14px; padding: 12px 14px; break-inside: avoid; }
.pp .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 500; border-radius: 999px; padding: 2px 8px; background: ${PRINT.soft}; color: ${PRINT.body}; white-space: nowrap; }
.pp .pill.ok { background: ${PRINT.greenSoft}; color: ${PRINT.green}; } .pp .pill.warn { background: ${PRINT.amberSoft}; color: ${PRINT.amber}; } .pp .pill.bad { background: ${PRINT.redSoft}; color: ${PRINT.red}; }
.pp .ok { color: ${PRINT.green}; } .pp .warn { color: ${PRINT.amber}; } .pp .bad { color: ${PRINT.red}; }
.pp .line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 5px 0; border-bottom: 1px solid ${PRINT.line}; }
.pp .line > :last-child { font-variant-numeric: tabular-nums; white-space: nowrap; }
.pp .line.sub { padding-left: 14px; color: ${PRINT.muted}; }
.pp .line.total { border-bottom: none; border-top: 1px solid ${PRINT.ink}; margin-top: 4px; padding-top: 8px; font-weight: 600; }
.pp .line.memo { color: ${PRINT.muted}; }
.pp .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.pp .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.pp .grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.pp .stat .v { font-size: 20px; font-weight: 300; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.pp .stat .l { font-size: 11px; color: ${PRINT.muted}; }
.pp .note { font-size: 10.5px; color: ${PRINT.muted}; line-height: 1.6; }
.pp .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid ${PRINT.line}; font-size: 10.5px; color: ${PRINT.muted}; display: flex; justify-content: space-between; gap: 12px; }
.pp .cut { border: 0; border-top: 1.5px dashed #c9cacd; margin: 18px 0; }
.pp .break { break-before: page; }
.pp .keep { break-inside: avoid; }
@media screen { body.pp-screen { background: ${PRINT.soft}; margin: 0; } .pp.page { background: #fff; max-width: 840px; margin: 24px auto; padding: 32px 36px; border-radius: 20px; } }
@media print { body.pp-screen { margin: 0; } .pp.page { padding: 0; } .no-print { display: none !important; } }
`;

export const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export const printMoney = (n: number, currency = 'USD') => {
  const v = Number(n) || 0;
  const s = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Math.abs(v));
  return v < -0.004 ? `−${s}` : s;
};

/** A label-and-amount row. `kind`: 'sub' (indented, muted), 'total' (a line above, semibold), 'memo' (muted). */
export const printLine = (label: string, amount: number | string, kind: '' | 'sub' | 'total' | 'memo' = '', tone: '' | 'ok' | 'warn' | 'bad' = '') =>
  `<div class="line ${kind}"><span>${label}</span><span class="${tone}">${typeof amount === 'number' ? printMoney(amount) : amount}</span></div>`;

/** Waits for the font and any pictures, then opens the print dialog. */
export const AUTO_PRINT = `<script>(function(){var w=[document.fonts&&document.fonts.ready?document.fonts.ready:0].concat([].slice.call(document.images).map(function(i){return i.complete?0:new Promise(function(r){i.onload=i.onerror=r;})}));Promise.all(w).then(function(){setTimeout(function(){window.print()},250)});})()</script>`;

/** A whole printable document as an HTML string: the heading, the body, a quiet footer. */
export function printPage(o: {
  title: string; heading?: string; subtitle?: string; meta?: string[]; shopName?: string; body: string; footNote?: string;
  footRight?: string; css?: string; autoPrint?: boolean;
}): string {
  const meta = [...(o.meta || []), `Printed ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(o.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="${PRINT_FONT_HREF}" rel="stylesheet">
<style>@page { margin: 0.55in; } ${PRINT_CSS} ${o.css || ''}</style></head>
<body class="pp-screen"><div class="pp page">
<div class="head"><div>${o.shopName ? `<p class="shop">${esc(o.shopName)}</p>` : ''}<h1>${o.heading || esc(o.title)}</h1>${o.subtitle ? `<p class="sub">${o.subtitle}</p>` : ''}</div>
<div class="meta">${meta.map((m) => `<div>${m}</div>`).join('')}</div></div>
${o.body}
<div class="foot"><span>${o.footNote || ''}</span><span>${o.footRight || ''}</span></div>
</div>${o.autoPrint === false ? '' : AUTO_PRINT}</body></html>`;
}
