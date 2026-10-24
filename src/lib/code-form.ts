// src/lib/code-form.ts — ONE FORM FOR EVERY CODE (pure; server and browser).
// Every code a product answers to (your SKU, the barcode on it, a case's or pallet's code, a tag) is kept, looked up and
// checked for clashes in this one form, so the same code typed, scanned by a laser, read by a phone camera or imported
// from a spreadsheet is the same code everywhere:
//   • spaces and surrounding quotes go, letters are upper case;
//   • a retail barcode (8, 12, 13 or 14 digits with a valid check digit: EAN-8, UPC-A, EAN-13, GTIN-14) is one number
//     however it's printed or read: a UPC-A read as EAN-13 with a leading 0, written with spaces or dashes, or typed
//     without the small first digit (11 digits), is the same barcode;
//   • any other code keeps its letters, digits and punctuation: NP-000123 and AB-000123 are two codes, and so are 123456
//     and 0123456, and 1234-5678 and 12345678 (only retail barcodes are padded and lose their separators).
// The shop's own product label (clarityflow://product/<id>) and a link to a product in the shop are read as that
// product, not as a code.

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export type CodeKind = 'sku' | 'unit' | 'case' | 'pallet' | 'tag';
export type ReadCode = { kind: 'product'; productId: string } | { kind: 'code'; code: string } | { kind: 'empty' };

/** A retail barcode's check digit is right (GS1: weights 3,1 from the right, before the check digit). */
export function gtinValid(digits: string): boolean {
  if (!/^\d+$/.test(digits) || !GTIN_LENGTHS.has(digits.length)) return false;
  const body = digits.slice(0, -1); let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** The one form a code is kept and looked up in ('' when there's nothing to keep). */
export function codeForm(raw: any): string {
  let s = String(raw ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!s) return '';
  // A retail barcode, however it's printed: digits with spaces or dashes between them, and a valid check digit. A
  // UPC-A typed without its small first digit (11 digits) is the same barcode.
  if (/^[\d\s-]+$/.test(s)) {
    const digits = s.replace(/[\s-]/g, '');
    const full = digits.length === 11 ? `0${digits}` : digits;
    // Padded to 14, the length every retail barcode fits in, so UPC-A, EAN-13 and GTIN-14 of one product agree.
    if (gtinValid(full)) return full.padStart(14, '0');
  }
  return s.replace(/\s+/g, '').toUpperCase();
}

/** What a scan or a typed code is: one of the shop's own product labels or links, or a code to look up. */
export function readCode(raw: any): ReadCode {
  const s = String(raw ?? '').trim();
  if (!s) return { kind: 'empty' };
  const qr = /^clarityflow:\/\/product\/([A-Za-z0-9_-]{1,160})\/?$/i.exec(s);
  if (qr) return { kind: 'product', productId: qr[1] };
  // A link to the product: in the shop (on any address the shop is served at), or its page in the app.
  const link = /^https?:\/\/[^\s/]+(?:\/[^\s?#]*)?\/product\/([A-Za-z0-9_-]{1,160})(?:[/?#]|$)/i.exec(s);
  if (link) return { kind: 'product', productId: link[1] };
  const code = codeForm(s);
  return code ? { kind: 'code', code } : { kind: 'empty' };
}

/** The index document's id for a code: the code itself when Firestore allows it, else a fixed hash of it. */
export function codeDocId(code: string): string {
  const ok = code.length > 0 && code.length <= 300 && !code.includes('/') && code !== '.' && code !== '..' && !/^__.*__$/.test(code);
  if (ok) return code;
  // FNV-1a, 64 bits as two 32-bit halves: stable, no imports, the same in the browser and on the server.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < code.length; i++) { const c = code.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0; }
  return `h_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** The fields on a product that hold its codes. They change only on the server (lib/code-index), which keeps each
 *  code on one product; equipment and overhead items aren't scanned and keep theirs like any other field. */
export const CODE_FIELDS = ['sku', 'barcode', 'barcodes', 'upc', 'gtin', 'ean', 'caseBarcode', 'casePack', 'palletBarcode', 'palletPack', 'tagIds'] as const;
export type CodeField = typeof CODE_FIELDS[number];
export type CodePatch = Partial<Record<CodeField, any>>;

/** Products carry scan codes; equipment and overhead items don't (a model number shared by three dryers is fine). */
export const holdsCodes = (item: any) => !!item && !['equipment', 'overhead'].includes(String(item.type || ''));

const text = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const packOf = (v: any) => { const n = Math.round(Number(v) || 0); return n >= 1 && n <= 100000 ? n : null; };

/** What a screen sent, kept to what a product's code fields hold. Fields not sent stay as they are. */
export function cleanCodePatch(b: any): CodePatch {
  const out: CodePatch = {};
  if (!b || typeof b !== 'object') return out;
  if ('sku' in b) out.sku = text(b.sku, 80);
  if ('barcode' in b) out.barcode = text(b.barcode, 64);
  if ('barcodes' in b) out.barcodes = [...new Set((Array.isArray(b.barcodes) ? b.barcodes : []).map((x: any) => text(x, 64)).filter(Boolean))].slice(0, 10);
  for (const k of ['upc', 'gtin', 'ean'] as const) if (k in b) out[k] = text(b[k], 64);
  if ('caseBarcode' in b) out.caseBarcode = text(b.caseBarcode, 64);
  if ('casePack' in b) out.casePack = packOf(b.casePack);
  if ('palletBarcode' in b) out.palletBarcode = text(b.palletBarcode, 64);
  if ('palletPack' in b) out.palletPack = packOf(b.palletPack);
  if ('tagIds' in b) out.tagIds = [...new Set((Array.isArray(b.tagIds) ? b.tagIds : []).map((x: any) => text(x, 64)).filter(Boolean))].slice(0, 20);
  return out;
}

/** The code fields that differ between a product as saved and as edited (null when none do). Compared as text, so a
 *  SKU kept as a number and the same SKU typed back count as unchanged. */
export function changedCodes(before: any, after: any): CodePatch | null {
  const a = cleanCodePatch(Object.fromEntries(CODE_FIELDS.map((k) => [k, before?.[k]])));
  const b = cleanCodePatch(Object.fromEntries(CODE_FIELDS.map((k) => [k, after?.[k]])));
  const out: CodePatch = {};
  for (const k of CODE_FIELDS) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) (out as any)[k] = (b as any)[k];
  return Object.keys(out).length ? out : null;
}

/** A product without its code fields: what a screen writes itself, with the codes going through the server. */
export function withoutCodes<T extends Record<string, any>>(item: T): T {
  const o: any = { ...item }; for (const k of CODE_FIELDS) delete o[k]; delete o.codesUpdatedAt; return o;
}

/** Every code a product carries, in its kept form, with what one scan of it is worth. */
export function codesOf(item: any): { code: string; kind: CodeKind; pack: number; raw: string }[] {
  if (!item || !holdsCodes(item)) return [];
  const out: { code: string; kind: CodeKind; pack: number; raw: string }[] = []; const seen = new Set<string>();
  const add = (raw: any, kind: CodeKind, pack = 1) => { const code = codeForm(raw); if (!code || seen.has(code)) return; seen.add(code); out.push({ code, kind, pack, raw: String(raw).trim() }); };
  add(item.sku, 'sku');
  for (const v of [item.barcode, item.upc, item.gtin, item.ean, ...(Array.isArray(item.barcodes) ? item.barcodes : [])]) add(v, 'unit');
  // A case counts its units; a pallet its cases × units a case (as packing and receiving count them, scanUnitsFor).
  const casePack = Math.max(0, Math.round(Number(item.casePack) || 0)); const palletPack = Math.max(0, Math.round(Number(item.palletPack) || 0));
  add(item.caseBarcode, 'case', casePack > 1 ? casePack : 1);
  add(item.palletBarcode, 'pallet', casePack > 1 && palletPack > 1 ? casePack * palletPack : 1);
  for (const t of Array.isArray(item.tagIds) ? item.tagIds : []) add(t, 'tag');
  return out;
}

export type CodeClash = { code: string; raw: string; kind: CodeKind; item: any; before: boolean };
/** Codes on `item` that another product already has (archived products, equipment and overhead don't hold codes).
 *  `before`: the code was on this product when it was last saved too, so the clash isn't new (the codes check lists
 *  it, with a choice of which product keeps it); a new one is refused. */
export function codeClashes(items: any[], item: any, o: { exceptId?: string; saved?: any } = {}): CodeClash[] {
  const mine = codesOf({ type: 'retail', ...item }); if (!mine.length) return [];
  const had = new Set(codesOf(o.saved).map((c) => c.code)); const skip = o.exceptId ?? item?.id;
  const out: CodeClash[] = [];
  for (const other of items || []) {
    if (!other || (skip && other.id === skip) || other.status === 'archived') continue;
    const theirs = new Set(codesOf(other).map((c) => c.code));
    for (const c of mine) if (theirs.has(c.code)) out.push({ ...c, item: other, before: had.has(c.code) });
  }
  return out;
}

/** What a kind of code is called on screen. */
export function codeKindLabel(kind: CodeKind, pack = 1): string {
  return kind === 'sku' ? 'SKU' : kind === 'case' ? `Case of ${pack}` : kind === 'pallet' ? `Pallet of ${pack}` : kind === 'tag' ? 'Tag' : 'Barcode';
}

/** How codes used to be compared (only their digits, without leading zeros, once they had six or more), so two
 *  codes that used to count as one can be pointed out. */
export function digitsKey(code: string): string {
  const d = String(code || '').replace(/\D/g, '');
  return d.length >= 6 ? d.replace(/^0+/, '') : '';
}
