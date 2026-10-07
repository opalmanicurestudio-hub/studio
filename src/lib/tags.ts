// src/lib/tags.ts — RFID / NFC TAGS. Any kit, linen bundle or inventory product can carry one or more tags in addition
// to its printed label. A tag is just the ID its reader reports (an RFID reader in "keyboard" mode types it like a
// barcode scanner; a phone reads an NFC tag's serial number). Pairing stores that ID on the item (`tagIds`), and every
// scan box then accepts the tag exactly like the printed code.
export const normTag = (v: any) => String(v ?? '').trim().toUpperCase().replace(/[\s:\-]/g, '').slice(0, 64);
export const hasTag = (item: any, tag: string) => { const t = normTag(tag); return !!t && Array.isArray(item?.tagIds) && item.tagIds.some((x: any) => normTag(x) === t); };
export type TagOwner = { kind: 'kit' | 'bundle' | 'product'; id: string; name: string; item: any };
/** Which item a tag is already paired to (so one tag can never mean two things). */
export function tagOwner(tag: string, all: { kits?: any[]; bundles?: any[]; inventory?: any[] }): TagOwner | null {
  const k = (all.kits || []).find((x) => x?.status !== 'retired' && hasTag(x, tag)); if (k) return { kind: 'kit', id: k.id, name: `${k.name} ${k.code}`, item: k };
  const b = (all.bundles || []).find((x) => hasTag(x, tag)); if (b) return { kind: 'bundle', id: b.id, name: `${b.name} bundle ${b.code}`, item: b };
  const p = (all.inventory || []).find((x) => hasTag(x, tag)); if (p) return { kind: 'product', id: p.id, name: String(p.name || 'Product'), item: p };
  return null;
}
/** True when the value looks like a tag ID rather than a typo: at least 6 letters/digits. */
export const looksLikeTag = (v: any) => /^[0-9A-Z]{6,64}$/.test(normTag(v));
