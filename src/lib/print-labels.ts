// src/lib/print-labels.ts — PRINT SCANNABLE LABELS (browser only): each label has a title, a barcode (handheld
// scanners), a square code (phone and tablet cameras) and the code in letters. Used for kits and linen bundle tags.
export async function printCodeLabels(labels: { title: string; code: string; sub?: string }[], pageTitle = 'Labels'): Promise<boolean> {
  const QRCode = (await import('qrcode')).default; const JsBarcode = (await import('jsbarcode')).default;
  const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const bar = (code: string) => { try { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); JsBarcode(svg, code, { format: 'CODE128', displayValue: false, height: 34, width: 1.6, margin: 0 }); return svg.outerHTML; } catch { return ''; } };
  const cells = await Promise.all(labels.map(async (l) => `<div class="l"><img src="${await QRCode.toDataURL(l.code, { margin: 1, width: 160 })}" alt=""/><div><b>${esc(l.title)}</b>${l.sub ? `<i>${esc(l.sub)}</i>` : ''}${bar(l.code)}<span>${esc(l.code)}</span></div></div>`));
  const w = window.open('', '_blank'); if (!w) return false;
  w.document.write(`<!doctype html><title>${esc(pageTitle)}</title><style>body{font-family:system-ui,sans-serif;margin:12px}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.l{display:flex;align-items:center;gap:10px;border:1px solid #999;border-radius:8px;padding:8px;break-inside:avoid}.l img{width:64px;height:64px}.l b{display:block;font-size:13px}.l i{display:block;font-size:11px;font-style:normal;color:#555;margin-bottom:4px}.l svg{display:block;max-width:100%}.l span{font:700 15px ui-monospace,monospace;letter-spacing:3px}</style><div class="g">${cells.join('')}</div><script>onload=()=>print()<\/script>`);
  w.document.close(); return true;
}
