'use client';
// src/lib/shelf-labels-client.ts — SHELF LABELS. One small label per bin: the bin in large type, the product name, and
// a barcode of the bin, so scanning the shelf during a pick confirms the right spot. Prints at 2 × 1 in, one per
// label, which suits a label printer; on regular paper they flow down the page to cut out.
import JsBarcode from 'jsbarcode';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function shelfLabelHtml(labels: { bin: string; name: string }[], paper: 'label' | 'sheet' = 'label'): string {
  const items = labels.filter((l) => l.bin.trim()).map((l) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    try { JsBarcode(svg, l.bin.trim(), { format: 'CODE128', displayValue: false, margin: 0, height: 40, width: 1.6 }); } catch { /* bin text still prints */ }
    return `<div class="l"><div class="t"><b>${esc(l.bin)}</b><span>${esc(l.name).slice(0, 40)}</span></div>${svg.outerHTML}</div>`;
  }).join('');
  const page = paper === 'label' ? '@page{size:2in 1in;margin:0}.l{page-break-after:always}' : '@page{size:letter;margin:0.4in}body{display:flex;flex-wrap:wrap;gap:0.15in}.l{border:1px dashed #999}';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shelf labels</title><style>${page}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#000}.l{width:2in;height:1in;padding:0.06in 0.1in;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}.t{display:flex;justify-content:space-between;align-items:baseline;gap:6px}.t b{font:700 18px ui-monospace,Menlo,monospace}.t span{font-size:7px;font-weight:600;text-transform:uppercase;text-align:right;line-height:1.1}svg{width:100%;height:0.42in}</style></head><body>${items}<script>window.onload=function(){setTimeout(function(){window.print()},200)}</script></body></html>`;
}

export function printShelfLabels(labels: { bin: string; name: string }[], paper: 'label' | 'sheet' = 'label'): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open(); w.document.write(shelfLabelHtml(labels, paper)); w.document.close();
  return true;
}

// Tote tags: a big number and a barcode of TOTE-NN, one per 3 × 2 in label, or a sheet of them on letter paper.
export function toteTagHtml(from: number, to: number, paper: 'label' | 'sheet' = 'sheet'): string {
  const tags: string[] = [];
  for (let n = Math.max(1, from); n <= Math.min(99, to); n++) {
    const code = `TOTE-${String(n).padStart(2, '0')}`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    try { JsBarcode(svg, code, { format: 'CODE128', displayValue: false, margin: 0, height: 50, width: 2 }); } catch { /* the number still prints */ }
    tags.push(`<div class="g"><div class="t"><span>TOTE</span><b>${n}</b></div>${svg.outerHTML}</div>`);
  }
  const page = paper === 'label' ? '@page{size:3in 2in;margin:0}.g{page-break-after:always}' : '@page{size:letter;margin:0.4in}body{display:grid;grid-template-columns:repeat(2,3in);gap:0.2in 0.4in;justify-content:center}.g{border:1px dashed #999}';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tote tags</title><style>${page}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#000}.g{width:3in;height:2in;padding:0.12in 0.16in;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;break-inside:avoid}.t{display:flex;justify-content:space-between;align-items:center}.t span{font-size:14px;font-weight:800;letter-spacing:.08em}.t b{font-size:72px;line-height:1;font-weight:800}svg{width:100%;height:0.6in}</style></head><body>${tags.join('')}<script>window.onload=function(){setTimeout(function(){window.print()},200)}</script></body></html>`;
}

export function printToteTags(count = 12, paper: 'label' | 'sheet' = 'sheet'): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open(); w.document.write(toteTagHtml(1, count, paper)); w.document.close();
  return true;
}
