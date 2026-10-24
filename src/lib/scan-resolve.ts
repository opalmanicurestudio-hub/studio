// src/lib/scan-resolve.ts — WHICH LINE OF THIS ORDER A SCAN IS FOR, by the products' CURRENT records. An order's lines
// carry the codes their products had when it was bought, so most scans match straight away (lib/retail-orders
// lineMatchesScan). When one doesn't, this looks at the products themselves: a barcode added after the order was
// placed, another code the product carries (UPC, GTIN, an extra barcode), a case code, a test order's stand-in lines,
// a label printed from a duplicate of the product, or a listing's code when the order has just one of its variants.
// When the scan isn't on the order, it says why in words a packer can act on: which product it is, or that no product
// has that code yet (and the packer can add it to the right product, lib/scan-resolve learnCode).
import { type Firestore, collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { learnProductCode } from './codes-api';
import { codeDocId, codeForm, codesOf } from './code-form';
import { numberKey } from './code-lookup';
import { lineMatchesScan, parseProductQr, type OrderLine, type ScanHint } from './retail-orders';
import { lineProductId, lookupForms, productMatch, unitCodes, variantIdsOf } from './product-codes';
import { codesMatch } from './retail-orders';

export type ScanResolution =
  | { kind: 'snapshot' }                                                   // the line's own codes match: nothing to work out
  | { kind: 'line'; hint: ScanHint; via: 'product' | 'parent' | 'duplicate' }
  | { kind: 'choose'; productName: string; lineNames: string[] }           // a listing's code, and the order has several of its variants
  | { kind: 'elsewhere'; productName: string; archived?: boolean }        // a product in inventory, not on this order
  | { kind: 'unknown' };                                                   // no product has this code

const CLOSED = ['shorted', 'refunded', 'backordered'];
// Still waiting for a scan: to be picked, to be checked into the box (the units still going out, whatever happened to the
// rest), or (a scan at the box, 'box') either.
const pickOpen = (l: OrderLine) => !CLOSED.includes(l.status) && l.qtyScanned < l.qtyOrdered;
const packOpen = (l: OrderLine) => (l.qtyPacked || 0) < l.qtyOrdered - (l.qtyShorted || 0);
const isOpen = (l: OrderLine, packCheck: boolean | 'box') => packCheck === 'box' ? pickOpen(l) || packOpen(l) : packCheck ? packOpen(l) : pickOpen(l);
const identityOf = (item: any) => ({
  ...(Number(item?.casePack) > 1 ? { casePack: Math.floor(Number(item.casePack)) } : {}),
  ...(item?.caseBarcode ? { caseBarcode: String(item.caseBarcode) } : {}),
  ...(Number(item?.palletPack) > 1 ? { palletPack: Math.floor(Number(item.palletPack)) } : {}),
  ...(item?.palletBarcode ? { palletBarcode: String(item.palletBarcode) } : {}),
});

/** Products in inventory with this code: the code index first (lib/code-index, every code in its one form), then the
 *  records themselves (as typed, and its other forms), for codes saved before the index was built. `archived`: archived
 *  products too (their codes are still theirs: never counted as another product's). */
export async function productsWithCode(fs: Firestore, tenantId: string, raw: string, o: { archived?: boolean } = {}): Promise<any[]> {
  const forms = lookupForms(raw);
  if (!forms.length) return [];
  const inv = collection(fs, `tenants/${tenantId}/inventory`);
  const found = new Map<string, any>();
  const one = codeForm(raw);
  if (one) {
    try {
      const e = await getDoc(doc(fs, `tenants/${tenantId}/codeIndex`, codeDocId(one)));
      const ids = e.exists() ? [...new Set([(e.data() as any)?.productId, ...(((e.data() as any)?.productIds) || [])].filter(Boolean).map(String))].slice(0, 6) : [];
      await Promise.all(ids.map(async (id) => { try { const s = await getDoc(doc(fs, `tenants/${tenantId}/inventory`, id)); if (s.exists()) found.set(id, { id, ...(s.data() as any) }); } catch { /* not readable: skipped */ } }));
    } catch { /* the records below still answer */ }
  }
  const asks = [
    ...['barcode', 'sku', 'upc', 'gtin', 'ean', 'caseBarcode', 'palletBarcode'].map((k) => query(inv, where(k, 'in', forms), limit(10))),
    query(inv, where('barcodes', 'array-contains-any', forms), limit(10)),
  ];
  const snaps = await Promise.all(asks.map((q) => getDocs(q).catch(() => null)));
  for (const s of snaps) for (const d of s?.docs || []) found.set(d.id, { id: d.id, ...(d.data() as any) });
  // Only what really matches (the forms are generous).
  return [...found.values()].filter((i) => (o.archived || i.status !== 'archived') && productMatch(i, raw));
}

/** Works out which line of the order a scan is for. `packCheck` is the second scan at the box; 'box' is a scan at the
 *  box with the second scan on (a unit to pick, or one picked at the shelf to check in: a line still to pick first). */
export async function resolveOrderScan(fs: Firestore, tenantId: string, lines: OrderLine[], raw: string, packCheck: boolean | 'box' = false): Promise<ScanResolution> {
  const t = String(raw || '').trim();
  if (!t) return { kind: 'unknown' };
  if (lines.some((l) => lineMatchesScan(l, t))) return { kind: 'snapshot' };
  const lineFor = (pid: string) => (packCheck === 'box' ? lines.find((l) => lineProductId(l) === pid && pickOpen(l)) : null)
    || lines.find((l) => lineProductId(l) === pid && isOpen(l, packCheck)) || lines.find((l) => lineProductId(l) === pid) || null;

  // The products on the order, as they are now.
  const ids = [...new Set(lines.map(lineProductId).filter(Boolean))];
  const items = new Map<string, any>();
  await Promise.all(ids.map(async (id) => { try { const s = await getDoc(doc(fs, `tenants/${tenantId}/inventory`, id)); if (s.exists()) items.set(id, { id, ...(s.data() as any) }); } catch { /* not readable: skipped */ } }));
  for (const [id, item] of items) {
    if (productMatch(item, t, id)) { const l = lineFor(id); if (l) return { kind: 'line', hint: { lineId: l.lineId, identity: identityOf(item) }, via: 'product' }; }
  }
  // Which product the scan is (the shop's label names it; otherwise its code), archived ones included: a code that's
  // exactly another product's is that product, never a line for something else.
  let owners: any[] = [];
  const qr = parseProductQr(t);
  if (qr !== null) {
    try { const s = await getDoc(doc(fs, `tenants/${tenantId}/inventory`, qr)); if (s.exists()) owners = [{ id: qr, ...(s.data() as any) }]; } catch { /* none */ }
  } else owners = await productsWithCode(fs, tenantId, t, { archived: true });
  const scanned = owners.filter((p) => p.status !== 'archived');

  // The same number written another way (leading zeros a spreadsheet dropped), when no product has exactly this code
  // and only one item on the order has that number: by the codes the line was sold with, or its product's codes now
  // (lib/code-lookup numberKey).
  const n = owners.length ? '' : numberKey(t);
  if (n) {
    const near = [...new Set(lines.filter((l) => [l.barcode, l.sku, l.caseBarcode, l.palletBarcode, ...(Array.isArray(l.codes) ? l.codes : [])].some((c) => numberKey(c) === n)
      || codesOf(items.get(lineProductId(l))).some((c) => numberKey(c.raw) === n)).map(lineProductId))];
    if (near.length === 1) { const l = lineFor(near[0]); if (l) return { kind: 'line', hint: { lineId: l.lineId, identity: identityOf(items.get(near[0])) }, via: 'product' }; }
  }

  // Live products first; an archived one is still the product its old labels name (an import's duplicate, say).
  for (const p of [...scanned, ...owners.filter((o) => o.status === 'archived')]) {
    // A listing's code (the name on the shelf), with the order holding one of its variants.
    const variants = variantIdsOf(p);
    if (variants.length) {
      const mine = lines.filter((l) => variants.includes(lineProductId(l)) && isOpen(l, packCheck));
      if (mine.length === 1) return { kind: 'line', hint: { lineId: mine[0].lineId, identity: identityOf(items.get(lineProductId(mine[0]))) }, via: 'parent' };
      if (mine.length > 1) return { kind: 'choose', productName: String(p.name || 'This product'), lineNames: mine.map((l) => [l.name, l.optionsLabel].filter(Boolean).join(' · ')) };
    }
    // A label printed from a duplicate of a product on the order: the same codes, or the same name. An archived product
    // found by its barcode goes by the codes only: one with the same name is often the product it was replaced by (a new
    // supplier's), and its old stock isn't what the order is for.
    const codes = unitCodes(p);
    const name = p.status !== 'archived' || qr !== null ? String(p.name || '').trim().toLowerCase() : '';
    const same = lines.find((l) => isOpen(l, packCheck) && (
      codes.some((c) => lineMatchesScan(l, c) || unitCodes(items.get(lineProductId(l))).some((x) => codesMatch(x, c)))
      || (!!name && String(l.name || '').replace(/\s*\(test\)$/i, '').trim().toLowerCase() === name)));
    if (same) return { kind: 'line', hint: { lineId: same.lineId, identity: identityOf(items.get(lineProductId(same))) }, via: 'duplicate' };
  }
  if (owners.length) return { kind: 'elsewhere', productName: String((scanned[0] || owners[0]).name || 'Another product'), ...(scanned.length ? {} : { archived: true }) };
  return { kind: 'unknown' };
}

/** What to tell the packer when a scan isn't on the order. */
export function scanMissMessage(r: ScanResolution, raw: string, lines: OrderLine[]): string {
  const code = String(raw || '').trim().slice(0, 40);
  const open = lines.filter((l) => !CLOSED.includes(l.status)).map((l) => l.name);
  const needs = open.length ? ` This order needs ${open.slice(0, 3).join(', ')}${open.length > 3 ? ` and ${open.length - 3} more` : ''}.` : '';
  if (r.kind === 'choose') return `${r.productName} comes in variants, and this order has ${r.lineNames.length} of them. Scan the variant’s own code, or tap it below.`;
  if (r.kind === 'elsewhere') return `That’s ${r.productName}${r.archived ? ', an archived product,' : ','} which isn’t on this order.${needs}`;
  return `No product has the code ${code} yet. If it’s one of these items, tap it below to count it, or add the code to it so it scans next time.`;
}

/** Gives a product a code it was scanned with (the packer said which item it is): its barcode when it has none, or one
 *  of its extra barcodes. Saved by the server (lib/code-index), which refuses a code another product already has, so
 *  no two products share one. */
export async function learnCode(_fs: Firestore, tenantId: string, productId: string, raw: string): Promise<{ ok: boolean; message: string }> {
  const code = String(raw || '').trim().slice(0, 64);
  if (!code || parseProductQr(code) !== null || code.includes('://')) return { ok: false, message: 'That isn’t a barcode that can be added to a product.' };
  if (!productId || productId.startsWith('test-')) return { ok: false, message: 'That item isn’t a product in your inventory.' };
  const r = await learnProductCode(tenantId, productId, code);
  return r.ok ? { ok: true, message: String(r.message || 'Added. It scans everywhere now.') } : { ok: false, message: r.error };
}
