// src/lib/product-labels.ts — PRODUCT LABELS (pure; browser and server). What goes on a product's label and where,
// worked out once, so the preview on screen, the printed sheet and the PDF are the same label:
//   • the name (a variant as its listing, with the variant underneath), its price (the price the shop charges for it,
//     lib/variants), a barcode a laser scanner reads and the shop's own QR code, which a phone camera reads too;
//   • the barcode is the product's own (UPC or EAN) when it has one, otherwise its barcode as typed, otherwise its SKU
//     (Code 128); a product with neither has the QR code only. Every scanner in the shop takes all of them;
//   • drawn in points (72 to an inch) from the top left: text, bars and squares, for an SVG or a PDF to draw as they are.
// Two sizes: a letter sheet of 30 (2⅝ × 1 in, the common 30-up layout) and a label printer's 2.25 × 1.25 in roll.
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { gtinValid } from './code-form';
import { choiceFor, deskPrice, variantIdsOf } from './variants';

export type BarFormat = 'UPC' | 'EAN13' | 'EAN8' | 'ITF14' | 'CODE128';
export type LabelCode = { value: string; format: BarFormat; text: string; from: 'barcode' | 'sku' };
export type LabelShow = { name: boolean; price: boolean; barcode: boolean; qr: boolean };
export const SHOW_ALL: LabelShow = { name: true, price: true, barcode: true, qr: true };

/** A label's words and codes, before they're placed. */
export type LabelContent = {
  productId: string;
  name: string;
  /** The variant, and the size when the product has one ("Blush · 15 ml"). */
  sub: string;
  /** "$24.00", or '' when it has no price yet. */
  price: string;
  code: LabelCode | null;
  /** What the QR code holds: the shop's own label for the product, which every scanner reads as that product. */
  qr: string;
};

export type LabelSize = 'sheet' | 'roll';
export type Layout = {
  size: LabelSize;
  /** The page, and one label, in points. */
  pageW: number; pageH: number; labelW: number; labelH: number;
  cols: number; rows: number; left: number; top: number; pitchX: number; pitchY: number;
  pad: number;
  /** Text and QR side by side (the sheet), or the bars across the bottom (the roll). */
  stack: 'side' | 'below';
};
const IN = 72;
export const LAYOUTS: Record<LabelSize, Layout> = {
  // 30 to a letter sheet: 3 across, 10 down, 2⅝ × 1 in, ½ in from the top and 3/16 in from the sides.
  sheet: { size: 'sheet', pageW: 8.5 * IN, pageH: 11 * IN, labelW: 2.625 * IN, labelH: 1 * IN, cols: 3, rows: 10, left: 0.1875 * IN, top: 0.5 * IN, pitchX: 2.75 * IN, pitchY: 1 * IN, pad: 6, stack: 'side' },
  // One label a page, as a label printer prints a PDF.
  roll: { size: 'roll', pageW: 2.25 * IN, pageH: 1.25 * IN, labelW: 2.25 * IN, labelH: 1.25 * IN, cols: 1, rows: 1, left: 0, top: 0, pitchX: 2.25 * IN, pitchY: 1.25 * IN, pad: 7, stack: 'below' },
};
export const perPage = (l: Layout) => l.cols * l.rows;

// ── The barcode ─────────────────────────────────────────────────────────────

const digitsOf = (v: any) => String(v ?? '').trim().replace(/[\s-]/g, '');
const printable = (s: string) => /^[\x20-\x7E]{1,40}$/.test(s);

/** A retail barcode as it's printed: UPC-A for a US product (however it was typed or stored), EAN-13, EAN-8, or a
 *  GTIN-14 as Code 128. null when it isn't a retail barcode with a right check digit. */
export function retailBarcode(raw: any): { value: string; format: BarFormat } | null {
  const d0 = digitsOf(raw);
  if (!/^\d+$/.test(d0)) return null;
  const d = d0.length === 11 && gtinValid(`0${d0}`) ? `0${d0}` : d0;
  if (!gtinValid(d)) return null;
  if (d.length === 12) return { value: d, format: 'UPC' };
  if (d.length === 8) return { value: d, format: 'EAN8' };
  if (d.length === 13) return d.startsWith('0') ? { value: d.slice(1), format: 'UPC' } : { value: d, format: 'EAN13' };
  // 14 digits: a UPC-A or EAN-13 written out to 14, or a case's own number.
  if (d.startsWith('00')) return { value: d.slice(2), format: 'UPC' };
  if (d.startsWith('0')) return { value: d.slice(1), format: 'EAN13' };
  // A GTIN-14 on a product's own label is printed as Code 128, which every scanner reads out of the box (ITF-14,
  // made for cartons, is turned off on many).
  return { value: d, format: 'CODE128' };
}

/** A barcode's digits as they're printed under it ("0 36000 29145 2"). */
export function barText(value: string, format: BarFormat): string {
  const d = value;
  if (format === 'UPC') return `${d[0]} ${d.slice(1, 6)} ${d.slice(6, 11)} ${d[11]}`;
  if (format === 'EAN13') return `${d[0]} ${d.slice(1, 7)} ${d.slice(7)}`;
  if (format === 'EAN8') return `${d.slice(0, 4)} ${d.slice(4)}`;
  if (format === 'ITF14') return `${d[0]} ${d.slice(1, 3)} ${d.slice(3, 8)} ${d.slice(8, 13)} ${d[13]}`;
  return value;
}

/** The barcode a product's label carries: its own retail barcode when it has one, otherwise its barcode as typed,
 *  otherwise its SKU (both as Code 128). null when it has neither: its label has the QR code only. */
export function labelCode(item: any): LabelCode | null {
  if (!item) return null;
  const units = [item.barcode, item.upc, item.ean, item.gtin, ...(Array.isArray(item.barcodes) ? item.barcodes : [])];
  for (const u of units) { const r = retailBarcode(u); if (r) return { ...r, text: barText(r.value, r.format), from: 'barcode' }; }
  const typed = String(item.barcode ?? '').trim();
  if (typed && printable(typed)) return { value: typed, format: 'CODE128', text: typed, from: 'barcode' };
  const sku = String(item.sku ?? '').trim();
  if (sku && printable(sku)) return { value: sku, format: 'CODE128', text: sku, from: 'sku' };
  return null;
}

/** The bars of a barcode, left to right: 1 a bar, 0 a space, one character a module. '' when it can't be drawn. */
export function barsOf(code: Pick<LabelCode, 'value' | 'format'> | null): string {
  if (!code) return '';
  try {
    const out: any = {};
    JsBarcode(out, code.value, { format: code.format, displayValue: false } as any);
    return (Array.isArray(out.encodings) ? out.encodings : []).map((e: any) => String(e?.data || '')).join('');
  } catch { return ''; }
}

/** The empty space a scanner needs each side of the bars, in modules. */
const QUIET: Record<BarFormat, [number, number]> = { UPC: [9, 9], EAN13: [11, 7], EAN8: [7, 7], ITF14: [10, 10], CODE128: [10, 10] };

// ── The QR code ─────────────────────────────────────────────────────────────

/** The squares of a QR code: n across, row by row, 1 dark. */
export function qrOf(text: string): { n: number; bits: string } {
  try {
    const q: any = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const n = q.modules.size; let bits = '';
    for (let i = 0; i < n * n; i++) bits += q.modules.data[i] ? '1' : '0';
    return { n, bits };
  } catch { return { n: 0, bits: '' }; }
}

export const productQr = (id: string) => `clarityflow://product/${id}`;

// ── Words ───────────────────────────────────────────────────────────────────

/** How wide text is in Plus Jakarta Sans, in thousandths of its size (the app's typeface; the PDF embeds it). */
const W400 = [170,282,395,790,646,974,734,245,295,295,479,606,270,498,286,429,732,371,600,609,630,616,597,543,628,597,286,306,606,606,606,499,929,652,693,781,742,612,581,821,736,256,383,654,531,836,736,878,643,878,641,646,512,700,652,984,597,623,584,315,429,315,606,598,352,572,667,600,667,615,393,662,573,229,229,548,229,908,573,655,667,667,338,509,388,573,517,797,487,536,449,317,300,317,606];
const W500 = [173,312,429,832,646,998,754,267,323,323,499,624,299,532,317,455,724,382,599,610,638,616,599,548,629,599,317,337,624,624,624,527,928,672,692,779,741,606,583,817,735,264,386,662,535,855,738,878,645,878,648,646,522,706,667,996,618,635,580,349,455,349,624,620,362,575,669,603,669,614,397,659,580,237,237,558,237,913,580,654,669,669,350,511,396,580,533,826,511,553,460,344,332,344,624];
const EXTRA: Record<string, [number, number]> = { '·': [286, 317], '’': [270, 299], '‘': [270, 299], '“': [420, 467], '”': [420, 467], '–': [568, 597], '—': [898, 927], '…': [686, 717], '×': [606, 624], '°': [482, 500] };
export type Weight = 400 | 500;

export function textWidth(s: string, size: number, weight: Weight = 400): number {
  let w = 0; const t = weight === 500 ? W500 : W400;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0) || 0;
    w += c >= 32 && c <= 126 ? t[c - 32] : EXTRA[ch] ? EXTRA[ch][weight === 500 ? 1 : 0] : 620;
  }
  return (w / 1000) * size;
}

/** Text cut to fit a width, with an ellipsis when it's cut. */
export function fitText(s: string, size: number, weight: Weight, max: number): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (textWidth(t, size, weight) <= max) return t;
  let lo = 0, hi = t.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (textWidth(`${t.slice(0, mid).trimEnd()}…`, size, weight) <= max) lo = mid; else hi = mid - 1; }
  return lo > 0 ? `${t.slice(0, lo).trimEnd()}…` : '';
}

const SIZE_UNITS = /^(ml|mL|l|L|oz|fl oz|fl\. oz\.|g|kg|lb|lbs|cm|mm|in|ct|pc|pcs|pack)$/;
/** The product's size, when it has one worth printing ("15 ml"). */
export function sizeText(item: any): string {
  const n = Number(item?.size); const u = String(item?.unit ?? '').trim();
  if (!(n > 0) || !u || !SIZE_UNITS.test(u)) return '';
  return `${+n.toFixed(2)} ${u}`;
}

/** A product's label: a variant named as its listing, with the variant and its size underneath. `listings`: which
 *  listing sells each variant (lib/variants listingsOf). */
export function labelContent(item: any, listings: Map<string, any>): LabelContent {
  const id = String(item?.id ?? '');
  const listing = listings.get(id);
  const choice = listing ? String(choiceFor(listing, id)?.choice.label || '') : '';
  const name = listing ? String(listing.name || item?.name || 'Product') : String(item?.name || 'Product');
  const price = deskPrice(item, listings);
  return {
    productId: id,
    name,
    sub: [choice, sizeText(item)].filter(Boolean).join(' · '),
    price: price > 0 ? `$${price.toFixed(2)}` : '',
    code: labelCode(item),
    qr: productQr(id),
  };
}

/** What a label is missing, in words for the list ('' when nothing). */
export function labelNote(c: LabelContent, show: LabelShow): string {
  const out: string[] = [];
  if (show.barcode && !c.code) out.push(show.qr ? 'No barcode or SKU yet, so it has the QR code only' : 'No barcode or SKU yet, so there’s nothing to scan');
  if (show.price && !c.price) out.push('No price yet');
  return out.join(' · ');
}

// ── Placing it ──────────────────────────────────────────────────────────────

export type Mark =
  | { t: 'text'; x: number; y: number; size: number; weight: Weight; text: string; muted?: boolean; spacing?: number }
  | { t: 'bars'; x: number; y: number; h: number; module: number; bits: string }
  | { t: 'qr'; x: number; y: number; side: number; n: number; bits: string };

/** Where everything on one label goes, in points from the label's top left. A baseline is a text mark's y. A code too
 *  long to scan beside the QR code takes the label's width instead (the QR code then isn't printed on that label). */
export function drawLabel(c: LabelContent, layout: Layout, show: LabelShow = SHOW_ALL): { marks: Mark[]; tight: boolean; noBars: boolean } {
  const p = layout.pad; const W = layout.labelW - 2 * p; const H = layout.labelH - 2 * p;
  let bits = show.barcode ? barsOf(c.code) : '';
  const quiet = c.code ? QUIET[c.code.format] : [10, 10];
  const span = bits ? bits.length + quiet[0] + quiet[1] : 0;
  const side = layout.stack === 'side';
  let qrSide = show.qr ? (side ? Math.min(H, 52) : 44) : 0;
  const qr = qrSide ? qrOf(c.qr) : { n: 0, bits: '' };
  if (!qr.n) qrSide = 0;
  // The width the bars get: beside the QR code (the sheet), or the label's width (the roll).
  let barW = side ? W - (qrSide ? qrSide + 6 : 0) : W;
  // A bar under 7.5 thousandths of an inch (0.54 pt; 10 on a roll, where a label printer's dots are coarse) is too thin: on the sheet the bars take the QR
  // code's room first; a code too long even for the label's width isn't printed as bars at all (the QR code stays).
  const MIN_BAR = layout.size === 'roll' ? 0.71 : 0.54;   // two dots of a 203 dpi label printer on a roll
  let tight = false; let noBars = false;
  if (bits && side && qrSide && barW / span < MIN_BAR) { if (W / span >= MIN_BAR) { barW = W; qrSide = 0; tight = true; } else { bits = ''; noBars = true; } }
  if (bits && barW / span < MIN_BAR) { bits = ''; noBars = true; }
  const textW = side ? barW : W - (qrSide ? qrSide + 6 : 0);
  const marks: Mark[] = [];
  let y = p;
  const line = (text: string, size: number, weight: Weight, muted = false, gap = 0) => {
    if (!text) return; const t = fitText(text, size, weight, textW); if (!t) return;
    y += size * 1.12 + gap; marks.push({ t: 'text', x: p, y, size, weight, text: t, muted });
  };
  const big = layout.size === 'roll';
  if (show.name) { line(c.name, big ? 9 : 8, 500); line(c.sub, big ? 8 : 7, 400, true, 1); }
  if (show.price && c.price) line(c.price, big ? 9 : 8, 500, false, show.name ? 1.5 : 0);
  const digits = 6;
  if (bits) {
    const module = barW / span;
    // The bars fill what's left of the height above the digits under them (never taller than half an inch).
    const top = side ? y + 3 : Math.max(y + 3, p + (qrSide ? qrSide + 3 : 0));
    const h = Math.max(10, Math.min(36, layout.labelH - p - (digits * 1.2 + 1) - top));
    marks.push({ t: 'bars', x: p + quiet[0] * module, y: top, h, module, bits });
    const dt = c.code!.text; const dw = textWidth(dt, digits, 400) + (dt.length - 1) * 0.6;
    marks.push({ t: 'text', x: p + Math.max(0, (barW - dw) / 2), y: top + h + digits * 1.05, size: digits, weight: 400, text: fitText(dt, digits, 400, barW), spacing: 0.6 });
  }
  if (qrSide) marks.push({ t: 'qr', x: layout.labelW - p - qrSide, y: side ? p + (H - qrSide) / 2 : p, side: qrSide, n: qr.n, bits: qr.bits });
  return { marks, tight, noBars };
}

/** Where each label goes on each page, in points: `count` labels, the first `skip` places on the first sheet left
 *  empty (a sheet used before). */
export function placeLabels(layout: Layout, count: number, skip = 0): { page: number; x: number; y: number }[] {
  const per = perPage(layout); const s = layout.size === 'sheet' ? Math.max(0, Math.min(per - 1, Math.floor(skip) || 0)) : 0;
  const out: { page: number; x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const k = i + s; const page = Math.floor(k / per); const at = k % per;
    const col = at % layout.cols; const row = Math.floor(at / layout.cols);
    out.push({ page, x: layout.left + col * layout.pitchX, y: layout.top + row * layout.pitchY });
  }
  return out;
}

/** The labels a list asks for, one per copy, in its order (at most `max`). */
export function expandCopies<T extends { qty: number }>(rows: T[], max = 600): T[] {
  const out: T[] = [];
  for (const r of rows) { const n = Math.max(0, Math.min(999, Math.floor(Number(r.qty) || 0))); for (let i = 0; i < n && out.length < max; i++) out.push(r); }
  return out;
}

/** The most labels printed at once (20 sheets of 30). */
export const MAX_LABELS = 600;

/** A label design (a product's label image) is used only from the app's own file storage: its bucket when that's
 *  known, Firebase Storage otherwise. The preview and the PDF use the same rule, so they never disagree. */
export function designUrlOk(url: any): boolean {
  let u: URL; try { u = new URL(String(url || '')); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const bucket = String(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '').trim().toLowerCase();
  const host = u.hostname.toLowerCase(); let path = '';
  try { path = decodeURIComponent(u.pathname); } catch { return false; }
  if (!bucket) return host === 'firebasestorage.googleapis.com';
  if (host === 'firebasestorage.googleapis.com') return path.startsWith(`/v0/b/${bucket}/`);
  if (host === 'storage.googleapis.com') return path.startsWith(`/${bucket}/`);
  return host === bucket;
}

export type LabelRow = { productId: string; qty: number };
/** What can have a label: anything in Inventory that isn't archived or an overhead cost. */
export const labelable = (it: any) => !!it && it.status !== 'archived' && it.type !== 'overhead';

/** The products a link asks labels for: `items=id:qty,…`, `ids=a,b`, or `product=id`. A listing is its variants (each
 *  has its own barcode and stock); the same product twice is one row. */
export function labelRowsFromLink(q: URLSearchParams, items: any[]): LabelRow[] {
  const byId = new Map((items || []).map((i: any) => [String(i.id), i]));
  const asked: LabelRow[] = [];
  for (const part of String(q.get('items') || '').split(',')) { const [id, n] = part.split(':'); if (id && id.trim()) asked.push({ productId: id.trim(), qty: n === undefined ? 1 : Math.floor(Number(n) || 0) }); }
  for (const id of String(q.get('ids') || '').split(',')) if (id.trim()) asked.push({ productId: id.trim(), qty: 1 });
  if (q.get('product')) asked.push({ productId: String(q.get('product')).trim(), qty: 1 });
  const out = new Map<string, number>();
  for (const r of asked) {
    const it = byId.get(r.productId); if (!labelable(it)) continue;
    const qty = Math.max(0, Math.min(999, r.qty));
    const vs = variantIdsOf(it).filter((v) => labelable(byId.get(v)));
    for (const id of vs.length ? vs : [r.productId]) out.set(id, Math.min(999, (out.get(id) || 0) + qty));
  }
  return [...out].map(([productId, qty]) => ({ productId, qty }));
}
