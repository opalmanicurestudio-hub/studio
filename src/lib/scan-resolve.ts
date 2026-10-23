// src/lib/scan-resolve.ts — WHICH LINE OF THIS ORDER A SCAN IS FOR, by the products' CURRENT records. An order's lines
// carry the codes their products had when it was bought, so most scans match straight away (lib/retail-orders
// lineMatchesScan). When one doesn't, this looks at the products themselves: a barcode added after the order was
// placed, another code the product carries (UPC, GTIN, an extra barcode), a case code, a test order's stand-in lines,
// a label printed from a duplicate of the product, or a parent product's code when the order has just one of its sizes
// or shades. When the scan isn't on the order, it says why in words a packer can act on: which product it is, or that
// no product has that code yet (and the packer can add it to the right product, lib/scan-resolve learnCode).
import { type Firestore, arrayUnion, collection, doc, getDoc, getDocs, limit, query, updateDoc, where } from 'firebase/firestore';
import { lineMatchesScan, parseProductQr, type OrderLine, type ScanHint } from './retail-orders';
import { lineProductId, lookupForms, productMatch, unitCodes, variantIdsOf } from './product-codes';
import { codesMatch } from './retail-orders';

export type ScanResolution =
  | { kind: 'snapshot' }                                                   // the line's own codes match: nothing to work out
  | { kind: 'line'; hint: ScanHint; via: 'product' | 'parent' | 'duplicate' }
  | { kind: 'choose'; productName: string; lineNames: string[] }           // a parent's code, and the order has several of its options
  | { kind: 'elsewhere'; productName: string }                             // a product in inventory, not on this order
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

/** Products in inventory with this code, found by the database (as typed, and its other forms). */
export async function productsWithCode(fs: Firestore, tenantId: string, raw: string): Promise<any[]> {
  const forms = lookupForms(raw);
  if (!forms.length) return [];
  const inv = collection(fs, `tenants/${tenantId}/inventory`);
  const found = new Map<string, any>();
  const asks = [
    ...['barcode', 'sku', 'upc', 'gtin', 'ean', 'caseBarcode', 'palletBarcode'].map((k) => query(inv, where(k, 'in', forms), limit(10))),
    query(inv, where('barcodes', 'array-contains-any', forms), limit(10)),
  ];
  const snaps = await Promise.all(asks.map((q) => getDocs(q).catch(() => null)));
  for (const s of snaps) for (const d of s?.docs || []) found.set(d.id, { id: d.id, ...(d.data() as any) });
  // Only what really matches (the forms are generous).
  return [...found.values()].filter((i) => i.status !== 'archived' && productMatch(i, raw));
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

  // Which product the scan is (the shop's label names it; otherwise its code).
  let scanned: any[] = [];
  const qr = parseProductQr(t);
  if (qr !== null) {
    try { const s = await getDoc(doc(fs, `tenants/${tenantId}/inventory`, qr)); if (s.exists()) scanned = [{ id: qr, ...(s.data() as any) }]; } catch { /* none */ }
  } else scanned = await productsWithCode(fs, tenantId, t);

  for (const p of scanned) {
    // A parent's code (the name on the shelf), with the order holding one of its sizes or shades.
    const variants = variantIdsOf(p);
    if (variants.length) {
      const mine = lines.filter((l) => variants.includes(lineProductId(l)) && isOpen(l, packCheck));
      if (mine.length === 1) return { kind: 'line', hint: { lineId: mine[0].lineId, identity: identityOf(items.get(lineProductId(mine[0]))) }, via: 'parent' };
      if (mine.length > 1) return { kind: 'choose', productName: String(p.name || 'This product'), lineNames: mine.map((l) => [l.name, l.optionsLabel].filter(Boolean).join(' · ')) };
    }
    // A label printed from a duplicate of a product on the order: the same codes, or the same name.
    const codes = unitCodes(p);
    const name = String(p.name || '').trim().toLowerCase();
    const same = lines.find((l) => isOpen(l, packCheck) && (
      codes.some((c) => lineMatchesScan(l, c) || unitCodes(items.get(lineProductId(l))).some((x) => codesMatch(x, c)))
      || (!!name && String(l.name || '').replace(/\s*\(test\)$/i, '').trim().toLowerCase() === name)));
    if (same) return { kind: 'line', hint: { lineId: same.lineId, identity: identityOf(items.get(lineProductId(same))) }, via: 'duplicate' };
  }
  if (scanned.length) return { kind: 'elsewhere', productName: String(scanned[0].name || 'Another product') };
  return { kind: 'unknown' };
}

/** What to tell the packer when a scan isn't on the order. */
export function scanMissMessage(r: ScanResolution, raw: string, lines: OrderLine[]): string {
  const code = String(raw || '').trim().slice(0, 40);
  const open = lines.filter((l) => !CLOSED.includes(l.status)).map((l) => l.name);
  const needs = open.length ? ` This order needs ${open.slice(0, 3).join(', ')}${open.length > 3 ? ` and ${open.length - 3} more` : ''}.` : '';
  if (r.kind === 'choose') return `${r.productName} comes in options, and this order has ${r.lineNames.length} of them. Scan the option’s own code, or tap it below.`;
  if (r.kind === 'elsewhere') return `That’s ${r.productName}, which isn’t on this order.${needs}`;
  return `No product has the code ${code} yet. If it’s one of these items, tap it below to count it, or add the code to it so it scans next time.`;
}

/** Gives a product a code it was scanned with (the packer said which item it is): its barcode when it has none, or one
 *  of its extra barcodes. Refused when another product already uses that code, so no two products share one. */
export async function learnCode(fs: Firestore, tenantId: string, productId: string, raw: string): Promise<{ ok: boolean; message: string }> {
  const code = String(raw || '').trim().slice(0, 64);
  if (!code || parseProductQr(code) !== null || code.includes('://')) return { ok: false, message: 'That isn’t a barcode that can be added to a product.' };
  if (!productId || productId.startsWith('test-')) return { ok: false, message: 'That item isn’t a product in your inventory.' };
  try {
    const owners = (await productsWithCode(fs, tenantId, code)).filter((p) => p.id !== productId);
    if (owners.length) return { ok: false, message: `That code is already on ${owners[0].name || 'another product'}. Check the item, or change the code there first.` };
    const ref = doc(fs, `tenants/${tenantId}/inventory`, productId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: 'That product isn’t in your inventory any more.' };
    const item: any = snap.data() || {};
    if (productMatch({ ...item, id: productId }, code)) return { ok: true, message: 'That code is already on this product.' };
    await updateDoc(ref, String(item.barcode || '').trim() ? { barcodes: arrayUnion(code) } : { barcode: code });
    return { ok: true, message: `Added ${code} to ${item.name || 'the product'}. It scans everywhere now.` };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'The code didn’t save. Try again.' };
  }
}
