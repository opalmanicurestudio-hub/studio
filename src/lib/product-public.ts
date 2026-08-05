// ─── src/lib/product-public.ts ────────────────────────────────────────────────
// One translation layer between an inventory document and everything the
// public sees.
//
// The disconnect this fixes: the Inventory forms write `imageUrl` (one string)
// and `description`, while the Shop Settings editor writes `imageUrls` (an
// array) and `onlineDescription`. Both are legitimate — they were built for
// different jobs — but the storefront only ever read the second pair, so a
// product photographed and described in Inventory looked empty online.
//
// Rather than force one editor to win (which would silently drop data people
// already typed), every public surface now reads through here: the shop
// prefers the shop-specific field when it exists and falls back to the
// inventory one. Nothing is lost, nothing needs re-entering, and future edits
// from either screen show up online.

export interface PublicProductFields {
  images: string[];
  description: string;
  howToUse: string;
  specs: { label: string; value: string }[];
  documents: { name: string; url: string }[];
  videoUrl: string;
  category: string;
  sizeLabel: string;
}

/** Coerce anything that might hold an image into a clean list of URLs. */
export function collectImages(item: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  };

  if (Array.isArray(item?.imageUrls)) item.imageUrls.forEach(push);
  push(item?.imageUrl);          // Inventory: Add/Edit Product, Equipment
  push(item?.photoUrl);          // older records
  if (Array.isArray(item?.images)) item.images.forEach(push);

  // de-dupe, preserve order (first image is the cover everywhere)
  return [...new Set(out)];
}

/** Shop copy if it exists, otherwise the inventory description. */
export function publicDescription(item: any): string {
  const online = typeof item?.onlineDescription === 'string' ? item.onlineDescription.trim() : '';
  if (online) return online;
  const base = typeof item?.description === 'string' ? item.description.trim() : '';
  return base;
}

export function publicSpecs(item: any): { label: string; value: string }[] {
  const specs = Array.isArray(item?.specs) ? item.specs : [];
  const cleaned = specs
    .filter((s: any) => s && (s.label || s.value))
    .map((s: any) => ({ label: String(s.label || ''), value: String(s.value || '') }));

  // Size and unit live on every inventory item; surfacing them as a spec means
  // a product detailed only in Inventory still has something real to show.
  const size = item?.size ? `${item.size}${item?.unit ? ` ${item.unit}` : ''}` : '';
  if (size && !cleaned.some((s: { label: string }) => s.label.toLowerCase() === 'size')) {
    cleaned.unshift({ label: 'Size', value: size });
  }
  return cleaned;
}

export function publicFields(item: any): PublicProductFields {
  return {
    images: collectImages(item),
    description: publicDescription(item),
    howToUse: typeof item?.howToUse === 'string' ? item.howToUse : '',
    specs: publicSpecs(item),
    documents: Array.isArray(item?.documents)
      ? item.documents
          .filter((d: any) => d && d.url)
          .map((d: any) => ({ name: String(d.name || 'Document'), url: String(d.url) }))
      : [],
    videoUrl: typeof item?.videoUrl === 'string' ? item.videoUrl : '',
    category: String(item?.category || '') || 'General',
    sizeLabel: item?.size ? `${item.size}${item?.unit ? ` ${item.unit}` : ''}` : '',
  };
}
