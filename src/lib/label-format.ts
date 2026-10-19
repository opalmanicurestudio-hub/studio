// src/lib/label-format.ts — WHAT A SHIPPING LABEL PRINTS ON. Set once in Online store settings → Shipping labels.
//   thermal: a 4 × 6 label printer (the default). One label per page at exact size, no scaling.
//   paper:   regular letter paper, label in the top half, to fold and tape.
//   zpl:     raw printer code for label printers set up to take it directly (advanced; downloads a .zpl file).
// The bulk label stack lays labels out as pages, so it always buys images (PNG); the single-label sheet buys a PDF.

export type LabelFormat = 'thermal' | 'paper' | 'zpl';

export function labelFormatOf(rs: any): LabelFormat {
  const f = String(rs?.labelFormat || '');
  return f === 'paper' || f === 'zpl' ? f : 'thermal';
}

export function shippoFileType(format: LabelFormat, opts: { stack?: boolean } = {}): string {
  if (format === 'zpl') return 'ZPLII';
  if (opts.stack) return 'PNG_4x6';
  return format === 'paper' ? 'PDF' : 'PDF_4x6';
}

export function isZplLabel(url: unknown): boolean {
  const u = String(url || '');
  return /\.zpl(\?|$)/i.test(u) || /label_file_type=ZPL/i.test(u);
}

export function isPngLabel(url: unknown): boolean {
  const u = String(url || '');
  return /\.png(\?|$)/i.test(u) || /label_file_type=PNG/i.test(u);
}

export const LABEL_FORMAT_CHOICES: { id: LabelFormat; label: string; sub: string }[] = [
  { id: 'thermal', label: 'Label printer, 4 × 6', sub: 'One label per page at exact size. Pick the label printer in the print window once.' },
  { id: 'paper', label: 'Regular paper', sub: 'Letter paper with the label in the top half. Fold, cut and tape.' },
  { id: 'zpl', label: 'Label printer, raw code (advanced)', sub: 'Downloads a .zpl file for printers set up to take it directly.' },
];
