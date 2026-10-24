// src/lib/labels-pdf.ts — PRODUCT LABELS AS A PDF (server), at the labels' real size: a letter sheet of 30 or one label
// a page for a label printer. The marks are lib/product-labels', the same ones the screen previews and prints, in Plus
// Jakarta Sans (embedded). A product's own label design (its label image) fills its label instead, when asked for.
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { JAKARTA_400, JAKARTA_500 } from '@/lib/fonts/jakarta';
import { LAYOUTS, drawLabel, placeLabels, type LabelContent, type LabelShow, type LabelSize, type Mark } from '@/lib/product-labels';

const INK = rgb(0.086, 0.09, 0.102), MUTED = rgb(0.427, 0.439, 0.459), BLACK = rgb(0, 0, 0);
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));

export type PdfLabel = { content: LabelContent; image?: { bytes: Uint8Array; type: 'png' | 'jpg' } | null };

export async function labelsPdf(labels: PdfLabel[], size: LabelSize, show: LabelShow, skip = 0): Promise<Uint8Array> {
  const layout = LAYOUTS[size];
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit as any);
  doc.setTitle('Product labels'); doc.setCreator('ClarityFlow');
  const R = await doc.embedFont(b64(JAKARTA_400), { subset: true }); const M = await doc.embedFont(b64(JAKARTA_500), { subset: true });
  const glyphs = new Set(R.getCharacterSet());
  // A character the typeface doesn't have is left out rather than printed as a box.
  const safe = (s: string) => Array.from(s).filter((ch) => glyphs.has(ch.codePointAt(0) as number)).join('');
  const images = new Map<PdfLabel, PDFImage | null>();
  for (const l of labels) {
    if (!l.image || images.has(l)) continue;
    try { images.set(l, l.image.type === 'png' ? await doc.embedPng(l.image.bytes) : await doc.embedJpg(l.image.bytes)); } catch { images.set(l, null); }
  }
  const at = placeLabels(layout, labels.length, skip);
  const pages: PDFPage[] = [];
  const pageFor = (n: number) => { while (pages.length <= n) pages.push(doc.addPage([layout.pageW, layout.pageH])); return pages[n]; };
  if (!labels.length) pageFor(0);
  labels.forEach((l, i) => {
    const page = pageFor(at[i].page); const ox = at[i].x; const top = at[i].y;
    const img = images.get(l);
    if (img) {
      const s = Math.min(layout.labelW / img.width, layout.labelH / img.height); const w = img.width * s; const h = img.height * s;
      page.drawImage(img, { x: ox + (layout.labelW - w) / 2, y: layout.pageH - top - (layout.labelH + h) / 2, width: w, height: h });
      return;
    }
    for (const m of drawLabel(l.content, layout, show).marks) draw(page, m, ox, top, layout.pageH, { R, M }, safe);
  });
  return doc.save();
}

function draw(page: PDFPage, m: Mark, ox: number, top: number, pageH: number, f: { R: PDFFont; M: PDFFont }, safe: (s: string) => string) {
  const Y = (y: number) => pageH - top - y;
  if (m.t === 'text') {
    const font = m.weight === 500 ? f.M : f.R; const t = safe(m.text); if (!t) return;
    const color = m.muted ? MUTED : INK;
    if (!m.spacing) { page.drawText(t, { x: ox + m.x, y: Y(m.y), size: m.size, font, color }); return; }
    // Spaced digits under the bars: one character at a time.
    let x = ox + m.x;
    for (const ch of Array.from(t)) { page.drawText(ch, { x, y: Y(m.y), size: m.size, font, color }); x += font.widthOfTextAtSize(ch, m.size) + m.spacing; }
    return;
  }
  if (m.t === 'bars') {
    let i = 0;
    while (i < m.bits.length) {
      if (m.bits[i] !== '1') { i++; continue; }
      let j = i; while (j < m.bits.length && m.bits[j] === '1') j++;
      page.drawRectangle({ x: ox + m.x + i * m.module, y: Y(m.y + m.h), width: (j - i) * m.module, height: m.h, color: BLACK });
      i = j;
    }
    return;
  }
  const s = m.side / m.n;
  for (let r = 0; r < m.n; r++) {
    let c = 0;
    while (c < m.n) {
      if (m.bits[r * m.n + c] !== '1') { c++; continue; }
      let e = c; while (e < m.n && m.bits[r * m.n + e] === '1') e++;
      page.drawRectangle({ x: ox + m.x + c * s, y: Y(m.y + (r + 1) * s), width: (e - c) * s, height: s, color: BLACK });
      c = e;
    }
  }
}
