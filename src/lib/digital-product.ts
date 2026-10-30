// src/lib/digital-product.ts — WHAT A DIGITAL PRODUCT IS, AS SOLD (pure).
// One place for a download's settings, read by the product page that edits them, the shop that sells them, the file
// route that serves them and the buyer's library:
//   · its format (a guide, templates, audio...), shown to the buyer;
//   · its files: up to ten, each replaced as a new version (buyers always get the newest; nobody loses access);
//   · how it's delivered: viewed online, saved as a copy, or both;
//   · the access window and download limit (copied onto each buyer's access record at sale, lib/entitlements);
//   · its license (personal use until the shop writes another) and protection level (standard, or a device limit with
//     the Digital protection add-on, lib/device-limit).
// Products saved before files had versions keep a single file in digitalFilePath; filesOf reads both shapes.

import { MAX_DEVICES } from './device-limit';

export const MAX_FILES = 10;
export const MAX_FILE_MB = 40;

export type DigitalFile = { id: string; name: string; path: string; size: number; type: string; version: number; addedAt: string; preview?: boolean };

/**
 * FREE PREVIEWS. The shop can let anyone read up to MAX_PREVIEWS of an item's PDFs or pictures on its product page
 * before buying (api/retail/digital-preview), stamped as a preview; the rest unlock when bought. A preview is the whole
 * file, so the shop is told to upload a short sample rather than mark the full guide.
 */
export const MAX_PREVIEWS = 3;
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
    // Only something the page can show can be a preview.
    ...(f.preview === true && viewable(String(f.name || '')) ? { preview: true } : {}),
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
  const previews = files.filter((f) => f.preview).length;
  if (previews > MAX_PREVIEWS) out.push(`Up to ${MAX_PREVIEWS} files can be free previews. Turn one off.`);
  if (previews > 0 && previews === files.length && !link) out.push('Every file is a free preview, so there is nothing left to buy. Keep at least one file locked, or add a link.');
  if (deliveryOf(item) === 'view' && files.some((f) => !viewable(f.name))) out.push('View online only works for PDFs and pictures. Choose another way to deliver, or remove the other files.');
  const lic = item?.license;
  if (lic && lic.id === 'custom' && !String(lic.terms || '').trim()) out.push('Write the license terms, or choose Personal use.');
  // Digital protection's device limit (lib/device-limit): 1 to 10 a buyer, or off (0).
  const dev = item?.digitalDeviceLimit;
  if (dev !== undefined && dev !== null && dev !== 0 && !(Math.floor(Number(dev)) >= 1 && Math.floor(Number(dev)) <= MAX_DEVICES)) out.push(`Set devices per buyer from 1 to ${MAX_DEVICES}, or turn the limit off.`);
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

/**
 * What a shopper may see of a download before buying (no paths, no link): its format, its files by name, type and
 * size, whether it comes with online content, how it opens, the access window, the download limit and the license.
 * Read by the product route; the license comes from the shop's licenses (lib/licenses). A variant with a download of
 * its own is shown with its listing's (variants share their listing's download).
 */
export function publicDigital(item: any, license: { name: string; terms: string }, opts: { deviceLimit?: number | null } = {}) {
  if (item?.digital !== true) return null;
  const files = filesOf(item);
  const fmt = FORMATS.find((f) => f.id === String(item?.digitalFormat || ''));
  const days = Math.max(0, Math.floor(Number(item?.digitalAccessDays) || 0));
  const d = deliveryOf(item);
  // Read online when the shop allows it and a file can be shown; saved when it can't, or the shop only gives copies.
  const reads = files.length > 0 && d !== 'download' && files.some((f) => viewable(f.name));
  const saves = files.length > 0 && d !== 'view' && (d === 'download' || files.some((f) => !viewable(f.name)) || d === 'both');
  const how = !files.length ? 'Opened from your library' : reads && saves ? 'Read online, or save a copy' : reads ? 'Read online in your library' : 'Saved to your device';
  return {
    formatLabel: fmt && fmt.id !== 'other' ? fmt.label : 'Digital download',
    // A free preview's id is given so the page can open it; the others are named only.
    files: files.map((f) => ({ name: f.name, type: f.name.includes('.') ? (f.name.split('.').pop() || '').toUpperCase().slice(0, 6) : '', size: f.size || 0, ...(f.preview ? { preview: true as const, id: f.id } : {}) })),
    hasLink: !!String(item?.digitalUrl || '').trim(),
    delivery: d, reads, saves, how,
    accessDays: days || null,
    /** null = no limit; 0 = nothing to save (view only, or only online content). */
    downloadLimit: saves ? downloadLimitOf(item) : 0,
    license: { name: String(license.name || 'License'), terms: String(license.terms || '') },
    /** How many devices one copy opens on (Digital protection), or null for any device. */
    deviceLimit: opts.deviceLimit && opts.deviceLimit > 0 ? Math.floor(opts.deviceLimit) : null,
  };
}
export type PublicDigital = NonNullable<ReturnType<typeof publicDigital>>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "30 days of access", "Yours to keep". */
export const accessWords = (d: Pick<PublicDigital, 'accessDays'>) => (d.accessDays ? `${plural(d.accessDays, 'day')} of access` : 'Yours to keep');
/** "5 downloads", "Unlimited downloads", or nothing when there's nothing to save. */
export const downloadWords = (d: Pick<PublicDigital, 'downloadLimit'>) => (d.downloadLimit === null ? 'Unlimited downloads' : d.downloadLimit > 0 ? plural(d.downloadLimit, 'download') : '');

/** The questions shoppers ask about a download, answered from its own settings. */
export function digitalFaq(d: PublicDigital): { q: string; a: string }[] {
  const where = d.saves && !d.reads ? 'save it from there' : 'open it there';
  const out = [{ q: 'How do I get it?', a: `The moment you pay, it’s in your library: ${where}. Your receipt links to it, and so does your account. On a new device you confirm it’s you with a code first.` }];
  if (d.files.length) {
    if (!d.saves) out.push({ q: 'Can I download it?', a: 'This one is read online in your library, on any phone, tablet or computer, as often as you like.' });
    else if (!d.reads) out.push({ q: 'How many times can I download it?', a: d.downloadLimit === null ? 'Each time you open it a copy is saved, with no limit.' : `Each time you open it a copy is saved, and counts as one of your ${plural(d.downloadLimit as number, 'download')}. If you need more, message the shop.` });
    else out.push({ q: 'How many times can I download it?', a: d.downloadLimit === null ? 'As often as you need. Reading it online in your library never counts.' : `You can save ${plural(d.downloadLimit as number, 'copy', 'copies')}. Reading it online in your library never counts. If you need more, message the shop.` });
  }
  if (d.deviceLimit) out.push({ q: 'How many devices can I open it on?', a: `Up to ${plural(d.deviceLimit, 'device')}. Each phone, laptop or tablet you open it on counts as one, and opening it again on the same one never counts twice. If you change devices, message the shop and they can reset yours.` });
  out.push({ q: 'How long do I have it?', a: d.accessDays ? `For ${plural(d.accessDays, 'day')} from the day you buy it.` : 'For good. It stays in your library.' });
  out.push({ q: 'Can I share it?', a: d.license.terms.trim() ? `${d.license.terms.trim()} (${d.license.name})` : `${d.license.name}.` });
  return out;
}
