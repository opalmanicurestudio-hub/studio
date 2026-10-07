// src/lib/print-labels.ts — PRINT SCANNABLE LABELS AND TAGS (browser only), in the business's own look: its name or
// logo, its accent colour and the app's typeface. Three shapes, because a sticker doesn't suit everything:
//   sticker — a flat label for a tray, pouch or bottle;
//   hang    — a tag to tie on: front and back printed side by side; cut out, fold on the line, punch the hole, thread a tie.
//             The back carries the steps, so whoever picks it up knows when to scan;
//   band    — a long strip that wraps around a folded stack or a bag and sticks to itself; the code shows at both ends
//             so it can be scanned whichever way the bundle is stacked.
// Every one has a barcode (handheld scanners), a square code (phone and tablet cameras) and the code in letters.
// Codes stay black on white so they scan.
export interface LabelBrand { name?: string | null; accent?: string | null; logoUrl?: string | null }
export type LabelFormat = 'sticker' | 'hang' | 'band';
export const LABEL_FORMATS: { id: LabelFormat; label: string; hint: string }[] = [
  { id: 'sticker', label: 'Stickers', hint: 'Flat labels for trays, pouches and bottles' },
  { id: 'hang', label: 'Tie-on tags', hint: 'Cut, fold, punch and tie on — steps printed on the back' },
  { id: 'band', label: 'Wrap bands', hint: 'A strip that wraps around a stack or bag' } ];
export interface LabelData { title: string; code: string; sub?: string; steps?: string[] }
export const KIT_STEPS = ['Scan when you take it for a client', 'Scan when the visit ends', 'Scan when cleaning starts', 'Check the contents, then scan: clean'];
export const BUNDLE_STEPS = ['Scan when it goes out', 'Scan when it comes back', 'Scan into the wash', 'Scan when clean and folded'];
export const brandOf = (tenant: any): LabelBrand => ({ name: tenant?.name || tenant?.businessName || null, accent: tenant?.bookingPageSettings?.cfPageConfig?.accentColor || tenant?.brandColor || null, logoUrl: tenant?.logoUrl || tenant?.bookingPageSettings?.logoUrl || null });
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const safeColor = (c: any) => (/^#[0-9a-fA-F]{3,8}$/.test(String(c || '')) ? String(c) : '#16171a');

/** The sheet's HTML (also used for previews). `cells` are ready-made label bodies from `labelCell`. */
export function labelSheetHtml(cells: string[], brand: LabelBrand, pageTitle: string, autoPrint = true, format: LabelFormat = 'sticker'): string {
  const accent = safeColor(brand.accent);
  const how = format === 'hang' ? 'Cut around each tag · fold on the dotted line · punch the hole through both sides · thread a tie.' : format === 'band' ? 'Cut each strip · wrap it around the stack or bag · stick the shaded end under the other end.' : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(pageTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page{margin:10mm}*{box-sizing:border-box}body{font-family:"Plus Jakarta Sans",system-ui,sans-serif;margin:0;color:#16171a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.how{font-size:8pt;color:#6b6760;margin:0 0 4mm}
.g{display:grid;gap:4mm}.g.sticker{grid-template-columns:repeat(2,1fr)}.g.hang{grid-template-columns:repeat(2,max-content);gap:6mm 8mm}.g.band{grid-template-columns:1fr;gap:5mm}
.b{display:flex;align-items:center;gap:1.5mm;font-size:6.5pt;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:${accent}}
.b img{height:4mm;width:auto;border-radius:1mm}
.t{font-size:11pt;font-weight:700;line-height:1.15}.s{font-size:7.5pt;color:#6b6760;margin-top:.5mm}
.bar svg{display:block;height:8mm;width:auto;max-width:100%}
.c{font:700 10pt ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.22em}
ol{margin:0;padding:0;list-style:none;counter-reset:n}ol li{counter-increment:n;display:flex;gap:1.6mm;align-items:baseline;font-size:7.5pt;line-height:1.3}
ol li:before{content:counter(n);flex:none;width:3.6mm;height:3.6mm;border-radius:50%;background:${accent};color:#fff;font-size:6pt;font-weight:700;display:inline-flex;align-items:center;justify-content:center;transform:translateY(.6mm)}
/* sticker */
.l{position:relative;display:grid;grid-template-columns:22mm 1fr;gap:4mm;align-items:center;border:.3mm solid #d9d4cc;border-radius:4mm;padding:4mm 4mm 4mm 6mm;background:#fff;overflow:hidden;break-inside:avoid;min-height:34mm}
.l:before{content:"";position:absolute;left:0;top:0;bottom:0;width:2.2mm;background:${accent}}
.l .q{width:22mm;height:22mm}.l .b{margin-bottom:1mm}.l .bar{margin-top:2mm}.l .c{margin-top:1mm}
/* tie-on tag: front | back, folded on the line between them */
.h{display:grid;grid-template-columns:48mm 48mm;break-inside:avoid;border:.3mm dashed #b9b3a8;border-radius:5mm}
.h .f{position:relative;height:86mm;padding:13mm 5mm 5mm;display:flex;flex-direction:column;align-items:center;text-align:center;background:#fff;overflow:hidden}
.h .f:first-child{border-right:.3mm dotted #8a857c;border-radius:5mm 0 0 5mm}.h .f:last-child{border-radius:0 5mm 5mm 0;align-items:stretch;text-align:left;background:color-mix(in srgb, ${accent} 7%, #fff)}
.h .f:before{content:"";position:absolute;left:50%;top:4mm;width:5mm;height:5mm;margin-left:-2.5mm;border-radius:50%;border:.3mm dashed #8a857c;background:#fff}
.h .top{position:absolute;left:0;right:0;top:0;height:2.4mm;background:${accent}}
.h .b{justify-content:center;margin-bottom:1.5mm}.h .q{width:30mm;height:30mm;margin:3mm 0 2.5mm}.h .bar svg{height:7mm;margin:0 auto}.h .c{margin-top:1.2mm;font-size:11pt}
.h .hd{font-size:7pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${accent};margin-bottom:2.5mm}.h ol{display:grid;gap:2.2mm}.h .ft{margin-top:auto;font-size:6.5pt;color:#6b6760}
/* wrap band */
.w{display:grid;grid-template-columns:14mm 30mm 1fr 44mm 26mm;align-items:center;gap:4mm;height:30mm;border:.3mm dashed #b9b3a8;border-radius:3mm;padding:0 4mm 0 0;background:#fff;overflow:hidden;break-inside:avoid;border-top:1.2mm solid ${accent}}
.w .tab{align-self:stretch;background:repeating-linear-gradient(-45deg,#ece8e1 0 1.2mm,#fff 1.2mm 2.4mm);display:flex;align-items:center;justify-content:center;font-size:5.5pt;color:#6b6760;writing-mode:vertical-rl;letter-spacing:.1em;text-transform:uppercase}
.w .q{width:22mm;height:22mm}.w ol{display:grid;grid-template-columns:1fr 1fr;gap:1mm 4mm}.w ol li{font-size:6.8pt}.w .end{text-align:right}.w .end .c{font-size:12pt}
</style></head><body>${how ? `<p class="how">${how}</p>` : ''}<div class="g ${format}">${cells.join('')}</div>${autoPrint ? '<script>document.fonts&&document.fonts.ready?document.fonts.ready.then(()=>setTimeout(()=>print(),150)):onload=()=>print()<\/script>' : ''}</body></html>`;
}
export function labelCell(l: LabelData, qrDataUrl: string, barcodeSvg: string, brand: LabelBrand, format: LabelFormat = 'sticker'): string {
  const brandLine = brand.name || brand.logoUrl ? `<div class="b">${brand.logoUrl ? `<img src="${esc(brand.logoUrl)}" alt=""/>` : ''}${esc(brand.name || '')}</div>` : '';
  const steps = (l.steps || []).length ? `<ol>${(l.steps || []).map((s) => `<li><span>${esc(s)}</span></li>`).join('')}</ol>` : '';
  const head = `<div class="t">${esc(l.title)}</div>${l.sub ? `<div class="s">${esc(l.sub)}</div>` : ''}`;
  if (format === 'hang') return `<div class="h"><div class="f"><div class="top"></div>${brandLine}${head}<img class="q" src="${qrDataUrl}" alt=""/><div class="bar">${barcodeSvg}</div><div class="c">${esc(l.code)}</div></div><div class="f"><div class="top"></div><div class="hd">When to scan</div>${steps}<div class="ft">${esc(l.title)} · ${esc(l.code)}${brand.name ? `<br>${esc(brand.name)}` : ''}</div></div></div>`;
  if (format === 'band') return `<div class="w"><div class="tab">Stick under</div><img class="q" src="${qrDataUrl}" alt=""/><div>${brandLine}${head}<div style="height:1.5mm"></div>${steps}</div><div><div class="bar">${barcodeSvg}</div><div class="c" style="margin-top:1mm">${esc(l.code)}</div></div><div class="end"><div class="t">${esc(l.title)}</div><div class="c">${esc(l.code)}</div></div></div>`;
  return `<div class="l"><img class="q" src="${qrDataUrl}" alt=""/><div>${brandLine}${head}<div class="bar">${barcodeSvg}</div><div class="c">${esc(l.code)}</div></div></div>`;
}
export async function printCodeLabels(labels: LabelData[], pageTitle = 'Labels', brand: LabelBrand = {}, format: LabelFormat = 'sticker'): Promise<boolean> {
  const QRCode = (await import('qrcode')).default; const JsBarcode = (await import('jsbarcode')).default;
  const bar = (code: string) => { try { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); JsBarcode(svg, code, { format: 'CODE128', displayValue: false, height: 34, width: 1.6, margin: 0 }); return svg.outerHTML; } catch { return ''; } };
  const cells = await Promise.all(labels.map(async (l) => labelCell(l, await QRCode.toDataURL(l.code, { margin: 0, width: 280 }), bar(l.code), brand, format)));
  const w = window.open('', '_blank'); if (!w) return false;
  w.document.write(labelSheetHtml(cells, brand, pageTitle, true, format)); w.document.close(); return true;
}
