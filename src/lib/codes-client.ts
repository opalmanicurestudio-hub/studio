// src/lib/codes-client.ts — A PRODUCT'S CODES, FROM A SCREEN. A product's SKU, barcodes, case and pallet codes and tags
// are saved by the server (/api/inventory/codes, lib/code-index), which keeps each code on one product and says which
// product has one already; so are a listing's choices and the listing a variant belongs to (saved on the product's
// In the shop tab). Everything else about a product is written from the screen as before. Equipment and overhead items
// aren't scanned or sold, so they're written whole, as always.
import { doc, type Firestore } from 'firebase/firestore';
import { setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { codesApi, saveCodes, type CodesReply } from '@/lib/codes-api';
import { CODE_FIELDS, changedCodes, cleanCodePatch, codesOf, holdsCodes, withoutCodes } from '@/lib/code-form';

export { saveCodes };

/** Save an edited product: its codes through the server when they changed (refused, with nothing saved, when another
 *  product has one), then everything else. */
export async function saveProduct(fs: Firestore, tenantId: string, saved: any, edited: any): Promise<CodesReply> {
  const ref = doc(fs, `tenants/${tenantId}/inventory`, String(edited.id));
  if (!holdsCodes(saved || edited) && !holdsCodes(edited)) { updateDocumentNonBlocking(ref, edited); return { ok: true }; }
  const patch = changedCodes(saved || {}, edited);
  if (patch) { const r = await saveCodes(tenantId, String(edited.id), patch); if (!r.ok) return r; }
  updateDocumentNonBlocking(ref, withoutLinks(withoutCodes(edited)));
  return { ok: true };
}

/** A product without its choices and its listing: those are the server's (an edit form holding an older copy of them
 *  never writes them back). */
function withoutLinks<T extends Record<string, any>>(item: T): T {
  const o: any = { ...item }; delete o.optionGroups; delete o.parentId; return o;
}

/** Add a new product. With codes, the server adds it (so a code that's taken stops it being added, and nothing is
 *  half saved); without, it's written here. */
export async function addProduct(fs: Firestore, tenantId: string, item: any): Promise<CodesReply> {
  const clean = withoutLinks(JSON.parse(JSON.stringify(item)));
  const ref = doc(fs, 'tenants', tenantId, 'inventory', String(clean.id));
  if (!holdsCodes(clean)) { setDocumentNonBlocking(ref, clean, {}); return { ok: true }; }
  const codes = cleanCodePatch(Object.fromEntries(CODE_FIELDS.filter((k) => k in clean).map((k) => [k, clean[k]])));
  if (!codesOf({ ...clean, ...codes }).length) { setDocumentNonBlocking(ref, withoutCodes(clean), {}); return { ok: true }; }
  return codesApi({ action: 'set', tenantId, productId: String(clean.id), codes, create: withoutCodes(clean) });
}
