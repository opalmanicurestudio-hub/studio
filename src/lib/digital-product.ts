// src/lib/digital-product.ts — WHAT A DIGITAL PRODUCT IS, AS SOLD (pure).
// One place for a download's settings, read by the product page that edits them, the shop that sells them, the file
// route that serves them and the buyer's library:
//   · its format (a guide, templates, audio...), shown to the buyer;
//   · its files: up to ten, each replaced as a new version (buyers always get the newest; nobody loses access);
//   · how it's delivered: viewed online, saved as a copy, or both;
//   · the access window and download limit (copied onto each buyer's access record at sale, lib/entitlements);
//   · its license (personal use until the shop writes another) and protection level (standard; advanced comes with
//     the paid add-on).
// Products saved before files had versions keep a single file in digitalFilePath; filesOf reads both shapes.

export const MAX_FILES = 10;
export const MAX_FILE_MB = 40;

export type DigitalFile = { id: string; name: string; path: string; size: number; type: string; version: number; addedAt: string };
export type Delivery = 'both' | 'view' | 'download';

export const FORMATS: { id: string; label: string }[] = [
  { id: 'guide', label: 'Guide or ebook' },
  { id: 'templates', label: 'Templates' },
  { id: 'worksheets', label: 'Worksheets or printables' },
  { id: 'images', label: 'Images or artwork' },
  { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Video' },
  { id: 'software', label: 'Software or presets' },
  { id: 'other', label: 'Something else' },
];

export const DELIVERIES: { id: Delivery; label: string; hint: string }[] = [
  { id: 'both', label: 'View online and save a copy', hint: 'Buyers read it in their library and can save copies up to the download limit.' },
  { id: 'view', label: 'View online only', hint: 'Buyers read it in their library, with no Save a copy button. Works for PDFs and pictures. A browser can still keep what it shows, so the name printed on it matters most.' },
  { id: 'download', label: 'Save a copy only', hint: 'Every open saves a copy and uses one of the downloads.' },
];

const ext = (name: string) => String(name || '').toLowerCase().split('.').pop() || '';

/** Whether a file can be shown inside the buyer's library (PDFs and pictures); anything else is saved instead. */
export const viewable = (name: string) => ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext(name));

/** A file's id, safe for a link and a storage name. */
export const fileId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The product's files, newest version of each, in the shop's order. Reads the older single-file shape too. */
export function filesOf(item: any): DigitalFile[] {
  const list = Array.isArray(item?.digitalFiles) ? item.digitalFiles.filter((f: any) => f && f.id && f.path) : [];
  if (list.length) return list.slice(0, MAX_FILES).map((f: any) => ({
    id: String(f.id), name: String(f.name || String(f.path).split('/').pop() || 'file'), path: String(f.path),
    size: Math.max(0, Number(f.size) || 0), type: String(f.type || ''), version: Math.max(1, Number(f.version) || 1), addedAt: String(f.addedAt || ''),
  }));
  const path = String(item?.digitalFilePath || '');
  if (!path) return [];
  return [{ id: 'main', name: String(item?.digitalFileName || path.split('/').pop() || 'file'), path, size: 0, type: '', version: 1, addedAt: '' }];
}

/**
 * One file by id. Blank = the first. 'main' is the single file a product had before files had versions: it means the
 * first file only while the product still has that one file, never whichever file is first after it was removed.
 */
export function fileOf(item: any, id?: string | null): DigitalFile | null {
  const files = filesOf(item);
  if (!files.length) return null;
  if (!id) return files[0];
  const hit = files.find((f) => f.id === id);
  if (hit) return hit;
  const legacy = !(Array.isArray(item?.digitalFiles) && item.digitalFiles.length);
  return id === 'main' && legacy ? files[0] : null;
}

/** A stored file belongs to this shop's private downloads folder (anything else is never served). */
export const ownPath = (tenantId: string, path: string) => String(path || '').startsWith(`tenants/${tenantId}/digital/`) && !String(path).includes('..');

export function deliveryOf(item: any): Delivery {
  const d = String(item?.digitalDelivery || '');
  return d === 'view' || d === 'download' ? d : 'both';
}

/**
 * The mode a file is opened in, from what was asked and how the product is delivered: a file that can't be shown in
 * the page is always a saved copy; view-only never saves; save-only always does.
 */
export function openMode(item: any, file: DigitalFile, asked: 'view' | 'download'): 'view' | 'download' | null {
  const d = deliveryOf(item);
  const canView = viewable(file.name);
  if (d === 'view') return canView ? 'view' : null;
  if (d === 'download') return 'download';
  return canView ? asked : 'download';
}

/** What's wrong with the settings, in words for the product page (an empty list means it's ready to sell). */
export function digitalProblems(item: any): string[] {
  if (item?.digital !== true) return [];
  const out: string[] = [];
  const files = filesOf(item);
  const link = String(item?.digitalUrl || '').trim();
  if (!files.length && !link) out.push('Add a file or a link for buyers to open.');
  if (link && !/^https:\/\//i.test(link)) out.push('The link must start with https://.');
  const lim = item?.digitalDownloadLimit;
  if (lim !== undefined && lim !== null && lim !== 0 && lim !== '0' && !(Math.floor(Number(lim)) >= 1)) out.push('Set downloads per copy to 1 or more, or turn the limit off.');
  if (deliveryOf(item) === 'view' && files.some((f) => !viewable(f.name))) out.push('View online only works for PDFs and pictures. Choose another way to deliver, or remove the other files.');
  const lic = item?.license;
  if (lic && lic.id === 'custom' && !String(lic.terms || '').trim()) out.push('Write the license terms, or choose Personal use.');
  return out;
}

/** The download limit as the product page shows it: a number, or null for no limit (0 is saved for no limit). */
export function downloadLimitOf(item: any): number | null {
  const raw = item?.digitalDownloadLimit;
  if (raw === 0 || raw === '0') return null;
  const n = Math.floor(Number(raw) || 0);
  return n > 0 ? n : 5;
}

/** File size in words. */
export function sizeWords(bytes: number): string {
  if (!(bytes > 0)) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** The fields kept for older readers: the first file stands in for the single file products used to have. */
export function legacyFileFields(files: DigitalFile[]): { digitalFilePath: string | null; digitalFileName: string | null } {
  const f = files[0];
  return { digitalFilePath: f ? f.path : null, digitalFileName: f ? f.name : null };
}
