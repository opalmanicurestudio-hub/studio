// src/lib/code-index.ts — ONE INDEX OF EVERY CODE (server).
// Every code a product answers to (its SKU, the barcodes on it, its case and pallet codes, its tags) has one entry in
// tenants/{t}/codeIndex, keyed by the code in its one form (lib/code-form), naming the product or variant it's on and
// what a scan of it is worth (a case of 12 counts 12). A product's codes change only through here:
//   • setProductCodes saves a product's codes and their entries in one step. A code new to the product that another
//     product already has is refused, naming that product, wherever it was typed: the product form, a code learned
//     at packing, a tag paired at the desk, a case code in Shop settings. A product that's archived or deleted, or
//     no longer carries the code, gives it up.
//   • buildCodeIndex brings the entries in line with the codes on products (the first time, and on every codes check),
//     touching only entries that differ, each settled from the products as they are at that moment, so a save made
//     while it runs is never undone. It lists the codes found on more than one product. Such a code belongs to none of
//     them until someone chooses: its entry names them all, so no other product can take it either.
//   • keepCodeOn settles one: the chosen product keeps the code, and it comes off the others.
//   • codesCheck counts what stops a scan or a sale from working, using the shop's own rules (lib/retail-orders).
// Browsers can read the index (the packing bench looks codes up there) but never write it, and the code fields of a
// product can't be changed from a browser at all (firestore.rules).
import { CODE_FIELDS, cleanCodePatch, codeDocId, codeForm, codesOf, digitsKey, holdsCodes, readCode, type CodeKind, type CodePatch } from '@/lib/code-form';
import { listedInShop, listingStock, onlineSellable } from '@/lib/retail-orders';
import { looksLikeTag, normTag } from '@/lib/tags';

export const indexCol = (t: string) => `tenants/${t}/codeIndex`;
const invPath = (t: string, id: string) => `tenants/${t}/inventory/${id}`;
const statePath = (t: string) => `tenants/${t}/private/codeIndex`;
const nowIso = () => new Date().toISOString();
const safeId = (v: any) => { const s = String(v ?? ''); return s && s.length <= 160 && !s.includes('/') && s !== '.' && s !== '..' && !/^__.*__$/.test(s) ? s : ''; };

export type Clash = { code: string; raw: string; kind: CodeKind; productId: string; name: string };
export type CodeChange = CodePatch | ((cur: any) => CodePatch | { refuse: string; status?: number });
export type SetResult = { ok: true; codes: number; product: any } | { ok: false; error: string; status: number; clashes?: Clash[] };

/** The products an entry names (one, or all of them for a code found on several). */
export const entryOwners = (e: any): string[] => [...new Set([String(e?.productId || ''), ...(Array.isArray(e?.productIds) ? e.productIds.map(String) : [])].filter(Boolean))];
/** The codes a product holds in the index: none while it's archived (it gives them up), none for equipment. */
const claims = (item: any) => (!item || item.status === 'archived' ? [] : codesOf(item));
/** Does this product still hold the code? */
const holding = (item: any, code: string) => claims(item).some((c) => c.code === code);
const clashSentence = (c: Clash) => `${c.raw} is already on ${c.name}. A code can be on one product only.`;

/** The rest of a new product, as a screen sent it: a plain object, without code fields (those come through here). */
function cleanCreate(c: any): Record<string, any> | null {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  let s = ''; try { s = JSON.stringify(c); } catch { return null; }
  if (s.length > 400000) return null;
  const o = JSON.parse(s); for (const k of CODE_FIELDS) delete o[k]; delete o.codesUpdatedAt;
  return o;
}

/** A product's codes, saved with their index entries in one step. `change` holds only the fields to change, or works
 *  them out from the product as it is now (so two codes learned at once both stay). A code new to this product that
 *  another product has is refused, naming it, and nothing is written. One the product had already, that another
 *  product has too, isn't new: both keep it until someone chooses which (the codes check). */
export async function setProductCodes(db: any, tenantId: string, productId: string, change: CodeChange, o: { by: string; create?: any }): Promise<SetResult> {
  const pid = safeId(productId);
  const gone404: SetResult = { ok: false, error: 'That product isn’t in your inventory.', status: 404 };
  if (!pid) return gone404;
  const create = o.create === undefined ? null : cleanCreate(o.create);
  if (o.create !== undefined && !create) return { ok: false, error: 'That product couldn’t be read. Try again.', status: 400 };
  const pRef = db.doc(invPath(tenantId, pid)); const col = indexCol(tenantId);
  return db.runTransaction(async (tx: any) => {
    const at = nowIso();
    const ps = await tx.get(pRef);
    if (!ps.exists && !create) return gone404;
    const cur: any = ps.exists ? ps.data() || {} : { ...create, id: pid };
    const asked: any = typeof change === 'function' ? change(cur) : change;
    if (asked && typeof asked.refuse === 'string') return { ok: false, error: asked.refuse, status: asked.status || 400 };
    const patch = cleanCodePatch(asked || {});
    const next: any = { ...cur, ...patch };
    const before = ps.exists ? claims(cur) : []; const after = claims(next);
    const had = new Set(before.map((c) => c.code));
    const gone = before.filter((b) => !after.some((a) => a.code === b.code));
    // Reads first: the entries for every code it will carry and every code it gives up, and the products they name.
    const aRefs = after.map((c) => db.doc(`${col}/${codeDocId(c.code)}`)); const gRefs = gone.map((c) => db.doc(`${col}/${codeDocId(c.code)}`));
    const aE: any[] = []; for (const r of aRefs) { const s = await tx.get(r); aE.push(s.exists ? s.data() || {} : null); }
    const gE: any[] = []; for (const r of gRefs) { const s = await tx.get(r); gE.push(s.exists ? s.data() || {} : null); }
    const others = new Map<string, any>();
    for (const e of [...aE, ...gE]) for (const id of entryOwners(e)) if (id !== pid && !others.has(id)) { const s = await tx.get(db.doc(invPath(tenantId, id))); others.set(id, s.exists ? s.data() || {} : null); }
    const holders = (e: any, code: string) => entryOwners(e).filter((id) => id !== pid && holding(others.get(id), code));
    // A code new to this product that another product still has: refused, naming it.
    const clashes: Clash[] = [];
    after.forEach((c, i) => { if (had.has(c.code) || !aE[i]) return; const h = holders(aE[i], c.code)[0];
      if (h) clashes.push({ code: c.code, raw: c.raw, kind: c.kind, productId: h, name: String(others.get(h)?.name || 'another product') }); });
    if (clashes.length) return { ok: false, status: 409, clashes, error: clashSentence(clashes[0]) };
    // Writes.
    const fields: Record<string, any> = {}; for (const k of CODE_FIELDS) if (k in patch) fields[k] = (patch as any)[k];
    tx.set(pRef, { ...(ps.exists ? {} : { ...create, id: pid }), ...fields, codesUpdatedAt: at }, { merge: true });
    after.forEach((c, i) => {
      const h = aE[i] ? holders(aE[i], c.code) : [];
      if (!h.length) { tx.set(aRefs[i], { code: c.code, raw: c.raw, kind: c.kind, pack: c.pack, productId: pid, parentId: next.parentId || null, at, by: o.by }); return; }
      // On another product too, from before: neither owns it until someone chooses.
      tx.set(aRefs[i], { code: c.code, raw: c.raw, kind: c.kind, pack: c.pack, productId: h[0], productIds: [...h, pid], clash: true, parentId: null, at, by: o.by });
    });
    gone.forEach((c, i) => {
      const e = gE[i]; if (!e || !entryOwners(e).includes(pid)) return;   // another product's entry isn't this one's to change
      const rest = holders(e, c.code);
      if (!rest.length) { tx.delete(gRefs[i]); return; }
      if (rest.length === 1) { const oc = codesOf(others.get(rest[0])).find((x) => x.code === c.code)!;
        tx.set(gRefs[i], { code: c.code, raw: oc.raw, kind: oc.kind, pack: oc.pack, productId: rest[0], parentId: others.get(rest[0])?.parentId || null, at, by: o.by }); return; }
      tx.set(gRefs[i], { code: c.code, raw: e.raw || c.raw, kind: e.kind || c.kind, pack: e.pack || c.pack, productId: rest[0], productIds: rest, clash: true, parentId: null, at, by: o.by });
    });
    return { ok: true, codes: after.length, product: { ...next, id: pid } };
  });
}

/** A code a product was scanned with (the packer said which item it is): its barcode when it has none, or one of its
 *  other barcodes. Refused when another product has it. */
export async function learnCode(db: any, tenantId: string, productId: string, raw: string, by: string): Promise<{ ok: boolean; message: string; status?: number }> {
  const r = readCode(raw);
  if (r.kind !== 'code') return { ok: false, message: 'That isn’t a barcode that can be added to a product.', status: 400 };
  if (!safeId(productId) || String(productId).startsWith('test-')) return { ok: false, message: 'That item isn’t a product in your inventory.', status: 400 };
  const typed = String(raw).trim().slice(0, 64); let name = ''; let already = false;
  const s = await setProductCodes(db, tenantId, productId, (cur: any) => {
    name = String(cur.name || ''); already = false;
    if (!holdsCodes(cur)) return { refuse: 'That item isn’t a product in your inventory.' };
    if (codesOf(cur).some((c) => c.code === r.code)) { already = true; return {}; }
    if (!String(cur.barcode ?? '').trim()) return { barcode: typed };
    const extra = Array.isArray(cur.barcodes) ? cur.barcodes : [];
    if (extra.length >= 10) return { refuse: `${name || 'This product'} already has ten other barcodes. Remove one in Inventory first.`, status: 409 };
    return { barcodes: [...extra, typed] };
  }, { by });
  if (!s.ok) return { ok: false, status: s.status, message: s.clashes?.length ? `That code is already on ${s.clashes[0].name}. Check the item, or change the code there first.` : s.status === 404 ? 'That product isn’t in your inventory any more.' : s.error };
  return { ok: true, message: already ? 'That code is already on this product.' : `Added ${typed} to ${name || 'the product'}. It scans everywhere now.` };
}

/** Pair an RFID or NFC tag to a product (or take one off). A tag is one item's only: a kit's, a linen bundle's or a
 *  product's, and never another product's code. */
export async function pairTag(db: any, tenantId: string, productId: string, raw: string, by: string, remove = false): Promise<{ ok: boolean; message: string; status?: number }> {
  const tag = normTag(raw);
  if (!tag || (!remove && !looksLikeTag(raw))) return { ok: false, message: 'That doesn’t look like a tag ID.', status: 400 };
  if (!remove) {
    for (const coll of ['kits', 'linenBundles'] as const) {
      const s = await db.collection(`tenants/${tenantId}/${coll}`).where('tagIds', 'array-contains', tag).limit(5).get();
      const k: any = s.docs.map((d: any) => d.data() || {}).find((x: any) => coll !== 'kits' || x.status !== 'retired');
      if (k) return { ok: false, status: 409, message: `That tag already belongs to ${coll === 'kits' ? `${k.name} ${k.code}` : `${k.name} bundle ${k.code}`}. Remove it there first.` };
    }
  }
  let name = ''; let already = false;
  const s = await setProductCodes(db, tenantId, productId, (cur: any) => {
    name = String(cur.name || 'the product'); already = false;
    if (!holdsCodes(cur)) return { refuse: 'Tags can be paired to products, kits and linen bundles.' };
    const tags: string[] = (Array.isArray(cur.tagIds) ? cur.tagIds : []).map(String);
    if (remove) return { tagIds: tags.filter((x) => normTag(x) !== tag) };
    if (tags.some((x) => normTag(x) === tag)) { already = true; return {}; }
    if (tags.length >= 20) return { refuse: `${name} already has 20 tags. Remove one first.`, status: 409 };
    return { tagIds: [...tags, tag] };
  }, { by });
  if (!s.ok) return { ok: false, status: s.status, message: s.clashes?.length ? `That tag is already on ${s.clashes[0].name}. Remove it there first.` : s.error };
  return { ok: true, message: remove ? `Removed the tag from ${name}.` : already ? 'That tag is already paired to this item.' : `Paired to ${name}. Read another tag for it, or choose a different item.` };
}

/** Take a code off whichever of a product's fields holds it. */
function without(item: any, code: string): CodePatch {
  const p: CodePatch = {};
  const is = (v: any) => !!String(v ?? '').trim() && codeForm(v) === code;
  if (is(item.sku)) p.sku = '';
  for (const k of ['upc', 'gtin', 'ean'] as const) if (is(item[k])) p[k] = '';
  const extra: any[] = Array.isArray(item.barcodes) ? item.barcodes : [];
  const kept = extra.filter((x) => !is(x));
  if (is(item.barcode)) { p.barcode = kept[0] || ''; p.barcodes = kept.slice(1); }
  else if (kept.length !== extra.length) p.barcodes = kept;
  if (is(item.caseBarcode)) { p.caseBarcode = ''; p.casePack = null; }
  if (is(item.palletBarcode)) { p.palletBarcode = ''; p.palletPack = null; }
  const tags: any[] = Array.isArray(item.tagIds) ? item.tagIds : [];
  if (tags.some(is)) p.tagIds = tags.filter((x) => !is(x));
  return p;
}

/** A code on more than one product: the chosen one keeps it, and it comes off the others, in one step. */
export async function keepCodeOn(db: any, tenantId: string, raw: string, productId: string, by: string): Promise<{ ok: boolean; error?: string; status?: number; removedFrom?: string[] }> {
  const code = codeForm(raw); const pid = safeId(productId);
  if (!code || !pid) return { ok: false, error: 'Missing the code or the product.', status: 400 };
  const eRef = db.doc(`${indexCol(tenantId)}/${codeDocId(code)}`); const stRef = db.doc(statePath(tenantId));
  return db.runTransaction(async (tx: any) => {
    const es = await tx.get(eRef); const e: any = es.exists ? es.data() || {} : {};
    const st: any = (await tx.get(stRef)).data() || {};
    const listed = (Array.isArray(st.clashes) ? st.clashes : []).find((c: any) => c.code === code);
    const ids = [...new Set([pid, ...entryOwners(e), ...((listed?.owners || []).map((x: any) => String(x.productId)))])].filter((x) => safeId(x));
    const docs: any[] = []; for (const id of ids) { const s = await tx.get(db.doc(invPath(tenantId, id))); docs.push(s.exists ? s.data() || {} : null); }
    const kd = docs[0];
    if (!holding(kd, code)) return { ok: false, error: 'That product doesn’t have this code any more. Check again to see where it is now.', status: 409 };
    const at = nowIso(); const c = codesOf(kd).find((x) => x.code === code)!; const removedFrom: string[] = [];
    ids.forEach((id, i) => { if (i === 0 || !holding(docs[i], code)) return;
      tx.set(db.doc(invPath(tenantId, id)), { ...without(docs[i], code), codesUpdatedAt: at }, { merge: true }); removedFrom.push(String(docs[i].name || id)); });
    tx.set(eRef, { code, raw: c.raw, kind: c.kind, pack: c.pack, productId: pid, parentId: kd.parentId || null, at, by });
    if (listed) tx.set(stRef, { clashes: (st.clashes || []).filter((x: any) => x.code !== code), clashCount: Math.max(0, (Number(st.clashCount) || 1) - 1) }, { merge: true });
    return { ok: true, removedFrom };
  });
}

/** Every product (and equipment item) of the shop, in pages. `complete` is false when there were more than it reads. */
async function allInventory(db: any, tenantId: string): Promise<{ items: any[]; complete: boolean }> {
  const items: any[] = []; let after = ''; const size = 500;
  for (let page = 0; page < 60; page++) {
    let q = db.collection(`tenants/${tenantId}/inventory`).orderBy('__name__').limit(size);
    if (after) q = q.startAfter(after);
    const s = await q.get(); for (const d of s.docs) items.push({ ...(d.data() || {}), id: d.id });
    if (s.docs.length < size) return { items, complete: true };
    after = String(s.docs[s.docs.length - 1].id);
  }
  return { items, complete: false };
}

const sameEntry = (a: any, b: any) => ['code', 'raw', 'kind', 'pack', 'productId'].every((k) => (a?.[k] ?? null) === (b?.[k] ?? null))
  && (a?.parentId || null) === (b?.parentId || null) && !!a?.clash === !!b?.clash && (a?.productIds || []).join('|') === (b?.productIds || []).join('|');

/** The entry a code should have, from the products that hold it (null when none does). */
function entryFor(code: string, holders: { id: string; item: any }[]): any {
  if (!holders.length) return null;
  const c = codesOf(holders[0].item).find((x) => x.code === code)!;
  return holders.length === 1
    ? { code, raw: c.raw, kind: c.kind, pack: c.pack, productId: holders[0].id, parentId: holders[0].item.parentId || null }
    : { code, raw: c.raw, kind: c.kind, pack: c.pack, productId: holders[0].id, productIds: holders.map((h) => h.id), clash: true, parentId: null };
}

/** Sets these entries from the products as they are at this moment, in one step: what the build saw only names the
 *  products to look at, so a save made while it ran is never undone and an entry is never handed to a product that
 *  no longer holds its code. */
async function settleEntries(db: any, tenantId: string, part: { id: string; code: string; candidates: string[] }[], by: string): Promise<{ finals: Map<string, any>; written: number }> {
  const col = indexCol(tenantId);
  return db.runTransaction(async (tx: any) => {
    const refs = part.map((p) => db.doc(`${col}/${p.id}`));
    const cur: any[] = []; for (const r of refs) { const snap = await tx.get(r); cur.push(snap.exists ? snap.data() || {} : null); }
    const names = part.map((p, i) => [...new Set([...p.candidates, ...entryOwners(cur[i])])].filter((x) => safeId(x)));
    const docs = new Map<string, any>();
    for (const id of new Set(names.flat())) { const snap = await tx.get(db.doc(invPath(tenantId, id))); docs.set(id, snap.exists ? snap.data() || {} : null); }
    const at = nowIso(); const finals = new Map<string, any>(); let written = 0;
    part.forEach((p, i) => {
      const next = p.code ? entryFor(p.code, names[i].filter((id) => holding(docs.get(id), p.code)).map((id) => ({ id, item: docs.get(id) }))) : null;
      finals.set(p.id, next);
      if (!next) { if (cur[i]) { tx.delete(refs[i]); written++; } return; }
      if (!sameEntry(cur[i], next)) { tx.set(refs[i], { ...next, at, by }); written++; }
    });
    return { finals, written };
  });
}

/** Bring the index up to date with the codes on every product. Only entries that differ from what the products say
 *  are touched, each settled from the products as they are at that moment (settleEntries). A code found on more than
 *  one product is given to none of them, and listed for the codes check. */
export async function buildCodeIndex(db: any, tenantId: string, o: { by?: string } = {}): Promise<{ products: number; codes: number; clashes: number; written: number; items: any[] }> {
  const col = indexCol(tenantId); const by = o.by || 'Codes check';
  const { items, complete } = await allInventory(db, tenantId);
  const byId = new Map(items.map((it) => [String(it.id), it]));
  const held = new Map<string, { id: string; item: any }[]>();
  for (const it of items) for (const c of claims(it)) held.set(c.code, [...(held.get(c.code) || []), { id: String(it.id), item: it }]);
  const existing = new Map<string, any>(((await db.collection(col).get()).docs as any[]).map((d) => [String(d.id), d.data() || {}]));
  const want = new Map<string, any>(); for (const [code, list] of held) want.set(codeDocId(code), entryFor(code, list));
  const differ: { id: string; code: string; candidates: string[] }[] = [];
  for (const [id, e] of want) if (!sameEntry(existing.get(id), e)) differ.push({ id, code: e.code, candidates: entryOwners(e) });
  // Entries no product was seen to hold (not when the shop has more products than one check reads).
  if (complete) for (const [id, cur] of existing) if (!want.has(id)) differ.push({ id, code: String(cur.code || ''), candidates: [] });
  const finals = new Map<string, any>(); let written = 0;
  for (let i = 0; i < differ.length; i += 40) { const r = await settleEntries(db, tenantId, differ.slice(i, i + 40), by); for (const [k, v] of r.finals) finals.set(k, v); written += r.written; }
  // The codes on more than one product, as the index now holds them.
  const clashes: any[] = [];
  for (const [id, e] of want) {
    const f = finals.has(id) ? finals.get(id) : e;
    if (!f?.clash) continue;
    clashes.push({ code: f.code, raw: f.raw, kind: f.kind, pack: f.pack, owners: entryOwners(f).slice(0, 6).map((pid) => { const it = byId.get(pid); const c = codesOf(it).find((x) => x.code === f.code); return { productId: pid, name: String(it?.name || 'Product'), kind: c?.kind || f.kind, raw: c?.raw || f.raw }; }) });
  }
  // Codes that only their digits used to tell apart (NP-000123 and AB-000123): two codes now, on two products.
  const byDigits = new Map<string, { code: string; raw: string; productId: string; name: string }[]>();
  for (const [code, list] of held) { const k = digitsKey(code); if (k) byDigits.set(k, [...(byDigits.get(k) || []), { code, raw: codesOf(list[0].item).find((x) => x.code === code)?.raw || code, productId: list[0].id, name: String(list[0].item.name || 'Product') }]); }
  const lookalikes: { a: string; b: string; aName: string; bName: string }[] = [];
  for (const xs of byDigits.values()) { if (lookalikes.length >= 3) break;
    const two = xs.find((x) => x.productId !== xs[0].productId);
    if (two) lookalikes.push({ a: xs[0].raw, b: two.raw, aName: xs[0].name, bName: two.name }); }
  await db.doc(statePath(tenantId)).set({ builtAt: nowIso(), products: items.length, codes: held.size, complete, clashes: clashes.slice(0, 200), clashCount: clashes.length, lookalikes }, { merge: true });
  return { products: items.length, codes: held.size, clashes: clashes.length, written, items };
}

/** Index these products again from what they carry now (after they're brought back from the archive, say): a code
 *  that's free becomes theirs, one another product took meanwhile is listed as shared. */
export async function reindexProducts(db: any, tenantId: string, ids: string[], by: string): Promise<number> {
  let n = 0;
  for (const id of [...new Set((ids || []).map(String))].slice(0, 100)) { const r = await setProductCodes(db, tenantId, id, {}, { by }); if (r.ok) n++; }
  return n;
}

/** The index is built the first time a code is saved (so a code already on a product is never given to another). */
export async function ensureCodeIndex(db: any, tenantId: string): Promise<void> {
  const st: any = (await db.doc(statePath(tenantId)).get()).data();
  if (!st?.builtAt) await buildCodeIndex(db, tenantId, { by: 'First use' });
}

/** The variant products a listing's options hold their stock in. */
export function variantIdsOf(listing: any): string[] {
  const ids = new Set<string>();
  for (const g of Array.isArray(listing?.optionGroups) ? listing.optionGroups : []) for (const c of Array.isArray(g?.choices) ? g.choices : []) if (c?.variantProductId) ids.add(String(c.variantProductId));
  return [...ids];
}
const choiceLabel = (listing: any, variantId: string) => {
  for (const g of Array.isArray(listing?.optionGroups) ? listing.optionGroups : []) for (const c of Array.isArray(g?.choices) ? g.choices : []) if (c?.variantProductId === variantId) return String(c.label || '');
  return '';
};

/** What the shop gets wrong today, by its own rules (lib/retail-orders listedInShop and listingStock): listings that
 *  show sold out while their variants have stock, things in the shop that nothing can scan, and variants that show
 *  as listings of their own. */
export function shopGaps(items: any[]) {
  const byId = new Map(items.map((x) => [String(x.id), x]));
  const live = (x: any) => !!x && x.status !== 'archived';
  const listingOf = new Map<string, any>();
  for (const it of items) if (live(it)) for (const v of variantIdsOf(it)) if (!listingOf.has(v) && v !== it.id) listingOf.set(v, it);
  const variantIds = new Set(listingOf.keys());
  const name = (x: any) => String(x?.name || 'Product');
  const listed = items.filter((it) => live(it) && listedInShop(it, variantIds));
  const stocked = (id: string) => { const v = byId.get(id); return live(v) && onlineSellable(v) > 0; };
  const soldOut = listed.filter((it) => !variantIds.has(it.id) && variantIdsOf(it).some(stocked) && listingStock(it, byId) <= 0
      && it.allowBackorder !== true && it.digital !== true && it.preorder !== true)
    .map((it) => ({ productId: it.id, name: name(it), withStock: variantIdsOf(it).filter(stocked).length }));
  const noCode: { productId: string; name: string; listingId?: string }[] = [];
  for (const it of listed) {
    if (variantIds.has(it.id) || it.digital === true) continue;   // a download has nothing to scan
    const own = codesOf(it).length > 0; const vs = variantIdsOf(it).map((v) => byId.get(v)).filter(live);
    if (!vs.length) { if (!own) noCode.push({ productId: it.id, name: name(it) }); continue; }
    if (own) continue;   // the listing's own code asks which variant
    for (const v of vs) if (!codesOf(v).length) noCode.push({ productId: v.id, name: `${name(it)} · ${choiceLabel(it, v.id) || name(v)}`, listingId: it.id });
  }
  const variantsListed = listed.filter((it) => variantIds.has(it.id))
    .map((it) => ({ productId: it.id, name: name(it), listingId: String(listingOf.get(it.id)?.id || ''), listingName: name(listingOf.get(it.id)) }));
  return { soldOut, noCode, variantsListed };
}

/** The codes and listings check: the index brought up to date, then the four counts and what's behind each. */
export async function codesCheck(db: any, tenantId: string, o: { by?: string } = {}) {
  const built = await buildCodeIndex(db, tenantId, { by: o.by });
  const st: any = (await db.doc(statePath(tenantId)).get()).data() || {};
  const gaps = shopGaps(built.items);
  const clashes = Array.isArray(st.clashes) ? st.clashes : [];
  return {
    checkedAt: st.builtAt || nowIso(), products: built.products, codes: built.codes,
    counts: { clashes: Number(st.clashCount ?? clashes.length) || 0, soldOut: gaps.soldOut.length, noCode: gaps.noCode.length, variantsListed: gaps.variantsListed.length },
    clashes, soldOut: gaps.soldOut.slice(0, 200), noCode: gaps.noCode.slice(0, 200), variantsListed: gaps.variantsListed.slice(0, 200),
    lookalikes: Array.isArray(st.lookalikes) ? st.lookalikes : [],
  };
}
