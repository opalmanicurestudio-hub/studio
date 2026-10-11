// src/lib/import-files.ts — CLIENT PHOTOS AND FILES FROM ANOTHER APP (Moving in). Old apps hand these over as a folder
// per client ("Maria Lopez/before.jpg") or as files named after the client ("maria-lopez_2023-04-02.jpg", "Lopez, Maria
// - consent.pdf", "maria@x.com.jpg"). Each file is matched to a client by its folder or file name; anything that isn't a
// clear match is shown so the owner can choose. Pure — the page uploads, the server records (/api/import files-save).

export type LiteClient = { id: string; name: string; email?: string | null };
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@.]+/g, ' ').trim();
const NOISE = /\b(img|image|photo|pic|picture|dsc|dscn|scan|scanned|before|after|inspo|inspiration|consent|form|waiver|intake|file|copy|final|edited|front|back|side|left|right|top|nails?|hair|brows?|lashes|color|colour|\d+)\b/g;
const words = (s: string) => norm(s).replace(/@\S+/g, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

export function fileKind(name: string, type?: string): 'photo' | 'file' {
  return /^image\//.test(type || '') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(name) ? 'photo' : 'file';
}
export const OK_FILE = /\.(jpe?g|png|gif|webp|heic|heif|pdf|docx?|txt)$/i;

/** Who a file belongs to, from its path ("Maria Lopez/IMG_2.jpg") — or null when it isn't clear. */
export function matchFile(path: string, clients: LiteClient[], index?: ReturnType<typeof clientNameIndex>): LiteClient | null {
  const ix = index || clientNameIndex(clients);
  const p = String(path || ''); const lower = p.toLowerCase();
  const email = lower.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/); if (email) { const c = ix.byEmail.get(email[0].replace(/\.(jpe?g|png|gif|webp|heic|heif|pdf|docx?|txt)$/i, '')); if (c) return c; }
  const segs = p.split(/[\\/]/).filter(Boolean); const base = (segs.pop() || '').replace(/\.[a-z0-9]+$/i, '');
  // Folder names first (closest folder wins), then the file name.
  for (const s of [...segs.reverse(), base]) {
    const w = words(s.replace(/[_-]+/g, ' ')); if (!w) continue;
    const comma = s.match(/^\s*([^,]+),\s*([^,]+?)(\s*[-–].*)?$/); const flipped = comma ? words(`${comma[2]} ${comma[1]}`) : null;
    for (const k of [w, flipped].filter(Boolean) as string[]) { const hit = ix.byName.get(k); if (hit && hit.length === 1) return hit[0]; }
    // "maria lopez 2023 04 02 before" → try the first two and three words
    const t = w.split(' '); for (const n of [3, 2]) { if (t.length < n) continue; const hit = ix.byName.get(t.slice(0, n).join(' ')); if (hit && hit.length === 1) return hit[0]; }
  }
  return null;
}
export function clientNameIndex(clients: LiteClient[]) {
  const byName = new Map<string, LiteClient[]>(), byEmail = new Map<string, LiteClient>();
  for (const c of clients) { const k = words(c.name); if (k) byName.set(k, [...(byName.get(k) || []), c]);
    const parts = k.split(' '); if (parts.length >= 2) { const flip = `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}`; byName.set(flip, [...(byName.get(flip) || []), c]); }
    if (c.email) byEmail.set(String(c.email).toLowerCase(), c); }
  return { byName, byEmail };
}
