// src/lib/print-labels.ts — PRINT SCANNABLE LABELS (browser only), in the business's own look: its name or logo, its
// accent colour and the app's typeface. Each label has a title, a barcode (handheld scanners), a square code (phone and
// tablet cameras) and the code in letters. Used for kits and linen bundle tags. Codes stay black on white so they scan.
export interface LabelBrand { name?: string | null; accent?: string | null; logoUrl?: string | null }
export const brandOf = (tenant: any): LabelBrand => ({ name: tenant?.name || tenant?.businessName || null, accent: tenant?.bookingPageSettings?.cfPageConfig?.accentColor || tenant?.brandColor || null, logoUrl: tenant?.logoUrl || tenant?.bookingPageSettings?.logoUrl || null });
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const safeColor = (c: any) => (/^#[0-9a-fA-F]{3,8}$/.test(String(c || '')) ? String(c) : '#16171a');

/** The label sheet's HTML (also used for the on-screen preview). `cells` are ready-made label bodies. */
export function labelSheetHtml(cells: string[], brand: LabelBrand, pageTitle: string, autoPrint = true): string {
  const accent = safeColor(brand.accent);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(pageTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page{margin:10mm}*{box-sizing:border-box}body{font-family:"Plus Jakarta Sans",system-ui,sans-serif;margin:0;color:#16171a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.g{display:grid;grid-template-columns:repeat(2,1fr);gap:4mm}
.l{position:relative;display:grid;grid-template-columns:22mm 1fr;gap:4mm;align-items:center;border:.3mm solid #d9d4cc;border-radius:4mm;padding:4mm 4mm 4mm 6mm;background:#fff;overflow:hidden;break-inside:avoid;min-height:34mm}
.l:before{content:"";position:absolute;left:0;top:0;bottom:0;width:2.2mm;background:${accent}}
.q{width:22mm;height:22mm}
.b{display:flex;align-items:center;gap:1.5mm;font-size:6.5pt;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:${accent};margin-bottom:1mm}
.b img{height:4mm;width:auto;border-radius:1mm}
.t{font-size:11pt;font-weight:700;line-height:1.15}.s{font-size:7.5pt;color:#6b6760;margin-top:.5mm}
.bar{margin-top:2mm}.bar svg{display:block;height:8mm;width:auto;max-width:100%}
.c{font:700 10pt ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.22em;margin-top:1mm}
</style></head><body><div class="g">${cells.join('')}</div>${autoPrint ? '<script>document.fonts&&document.fonts.ready?document.fonts.ready.then(()=>setTimeout(()=>print(),150)):onload=()=>print()<\/script>' : ''}</body></html>`;
}
export function labelCell(l: { title: string; code: string; sub?: string }, qrDataUrl: string, barcodeSvg: string, brand: LabelBrand): string {
  const brandLine = brand.name || brand.logoUrl ? `<div class="b">${brand.logoUrl ? `<img src="${esc(brand.logoUrl)}" alt=""/>` : ''}${esc(brand.name || '')}</div>` : '';
  return `<div class="l"><img class="q" src="${qrDataUrl}" alt=""/><div>${brandLine}<div class="t">${esc(l.title)}</div>${l.sub ? `<div class="s">${esc(l.sub)}</div>` : ''}<div class="bar">${barcodeSvg}</div><div class="c">${esc(l.code)}</div></div></div>`;
}
export async function printCodeLabels(labels: { title: string; code: string; sub?: string }[], pageTitle = 'Labels', brand: LabelBrand = {}): Promise<boolean> {
  const QRCode = (await import('qrcode')).default; const JsBarcode = (await import('jsbarcode')).default;
  const bar = (code: string) => { try { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); JsBarcode(svg, code, { format: 'CODE128', displayValue: false, height: 34, width: 1.6, margin: 0 }); return svg.outerHTML; } catch { return ''; } };
  const cells = await Promise.all(labels.map(async (l) => labelCell(l, await QRCode.toDataURL(l.code, { margin: 0, width: 240 }), bar(l.code), brand)));
  const w = window.open('', '_blank'); if (!w) return false;
  w.document.write(labelSheetHtml(cells, brand, pageTitle)); w.document.close(); return true;
}
