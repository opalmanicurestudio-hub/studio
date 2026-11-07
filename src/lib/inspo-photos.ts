// src/lib/inspo-photos.ts — NEW INSPIRATION PHOTOS FROM THE VISIT LINK, when the team asked for different ones (board
// FormsStaff). Which links a client may send: only photos saved through the business's own photo upload
// (api/booking/photo), either the stored copy in the business's inspiration folder or the database copy the upload falls
// back to (kept as a link on this app, never another site's). Anything else is turned away, so the team only ever opens
// the business's own photos. When the visit link may still take them (the same rule the visit link shows the ask by),
// and how earlier photos are kept. Server side only.
import { ENDED_VISIT } from './forms-visit';
import { toMs } from './forms';

const PHOTO_ID = /^[A-Za-z0-9_-]{16,64}$/;
export const MAX_PHOTO_URL = 1000;
export const KEEP_EARLIER = 12;

/** The link as it's kept, or null when it isn't one of this business's own inspiration photos. A database copy is kept
 *  as a link on this app (/api/booking/photo?t=&id=) whatever site it was sent from, once the copy is found there. */
export async function ownInspoPhoto(db: any, url: any, tenantId: string, buckets: string[]): Promise<string | null> {
  if (typeof url !== 'string' || !url || url.length > MAX_PHOTO_URL) return null;
  let u: URL; try { u = new URL(url, 'https://app.invalid'); } catch { return null; }
  if (u.hostname === 'firebasestorage.googleapis.com') {
    if (u.protocol !== 'https:') return null;
    const m = u.pathname.match(/^\/v0\/b\/([A-Za-z0-9._-]+)\/o\/([^/]+)$/); if (!m) return null;
    if (!buckets.includes(m[1])) { console.warn('[inspo-photos] a photo in a bucket not on the list', m[1]); return null; }
    let path = ''; try { path = decodeURIComponent(m[2]); } catch { return null; }
    const pre = `tenants/${tenantId}/booking-inspiration/`;
    if (!path.startsWith(pre) || !/^\d{4}-\d{2}-\d{2}\/\d+-[a-z0-9]+\.(jpg|png|webp)$/.test(path.slice(pre.length))) return null;
    return u.searchParams.get('alt') === 'media' && u.searchParams.get('token') ? u.toString() : null;
  }
  if (u.pathname !== '/api/booking/photo' || u.searchParams.get('t') !== tenantId) return null;
  const id = String(u.searchParams.get('id') || ''); if (!PHOTO_ID.test(id)) return null;
  const kept = await db.doc(`tenants/${tenantId}/bookingPhotos/${id}`).get().catch(() => null);
  return kept?.exists ? `/api/booking/photo?t=${encodeURIComponent(tenantId)}&id=${id}` : null;
}

/** The photo before its marks (lib/markup), kept privately (api/booking/photo, kind 'original'): only the team opens it,
 *  through /api/files/view. The link as kept, or null when it isn't one of this business's own. */
export function ownOriginal(url: any, tenantId: string): string | null {
  if (typeof url !== 'string' || !url || url.length > MAX_PHOTO_URL) return null;
  let u: URL; try { u = new URL(url, 'https://app.invalid'); } catch { return null; }
  if (u.pathname !== '/api/files/view' || u.searchParams.get('t') !== tenantId) return null;
  const p = String(u.searchParams.get('p') || ''); const pre = `tenants/${tenantId}/completions/inspiration-originals/`;
  return p.startsWith(pre) && /^\d{4}-\d{2}-\d{2}\/[a-z0-9]{8,40}\.jpg$/.test(p.slice(pre.length)) ? `/api/files/view?t=${encodeURIComponent(tenantId)}&p=${encodeURIComponent(p)}` : null;
}

/** The storage buckets this business's photos are saved in: the same ones lib/claim-photo-upload tries, the server's
 *  own default bucket among them. */
export async function ourBuckets(tenant: any): Promise<string[]> {
  const project = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
  let appBucket = '';
  try { const { getAdminApp } = await import('./firebase-admin'); const o: any = getAdminApp().options || {}; appBucket = String(o.storageBucket || ''); } catch { /* the rest still count */ }
  return [...new Set([tenant?.storageBucket, appBucket, process.env.FIREBASE_STORAGE_BUCKET, process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, project && `${project}.firebasestorage.app`, project && `${project}.appspot.com`]
    .map((x) => String(x || '').trim()).filter(Boolean))];
}

/** The visit link takes new photos only while the team's ask is open, before a live visit, with the link still on. */
export function photosAskOpen(a: any, now = Date.now()): boolean {
  const start = toMs(a?.startTime);
  return a?.inspoReview?.status === 'again' && start > now && !a?.linkRevokedAt && !ENDED_VISIT.includes(String(a?.status || ''));
}

/** Earlier photos: every set the client sent before, newest first, each photo once, up to KEEP_EARLIER. */
export function earlierPhotos(had: any[], before: any[], now: any[]): { url: string; note: string }[] {
  const out: { url: string; note: string }[] = []; const seen = new Set(now.map((p) => String(p?.url || '')));
  for (const p of [...(Array.isArray(had) ? had : []), ...(Array.isArray(before) ? before : [])]) {
    const url = String(p?.url || ''); if (!url || seen.has(url)) continue; seen.add(url);
    out.push({ url, note: String(p?.note || '').slice(0, 300) });
    if (out.length >= KEEP_EARLIER) break;
  }
  return out;
}

/** A photo the team made for this visit (the marks they send to the client: api/upload/appointment-photos saves them
 *  under the visit, each readable only through its own link). The link as kept, or null when it isn't one of those. */
export function ownVisitPhoto(url: any, tenantId: string, apptId: string, buckets: string[]): string | null {
  if (typeof url !== 'string' || !url || url.length > MAX_PHOTO_URL) return null;
  let u: URL; try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'firebasestorage.googleapis.com') return null;
  const m = u.pathname.match(/^\/v0\/b\/([A-Za-z0-9._-]+)\/o\/([^/]+)$/); if (!m || !buckets.includes(m[1])) return null;
  let path = ''; try { path = decodeURIComponent(m[2]); } catch { return null; }
  const pre = `tenants/${tenantId}/visit-photos/${apptId}/`;
  if (!path.startsWith(pre) || !/^\d+-[a-z0-9]+\.(jpg|png)$/.test(path.slice(pre.length))) return null;
  return u.searchParams.get('alt') === 'media' && u.searchParams.get('token') ? u.toString() : null;
}

/** A photo's own bytes, for the team's markup (drawn in the browser, so it must come from this app, not another
 *  site). Only this business's own photos: its inspiration photos (stored in its inspiration folder, or the database
 *  copy), and the photo before its marks (kept privately); only ever handed back as a photo. Null for anything else, or
 *  when it can't be read. */
export async function photoBytes(db: any, ref: any, tenantId: string, buckets: string[]): Promise<{ buf: Buffer; type: string } | null> {
  if (typeof ref !== 'string' || !ref || ref.length > MAX_PHOTO_URL) return null;
  let u: URL; try { u = new URL(ref, 'https://app.invalid'); } catch { return null; }
  const typeOf = (p: string) => (/\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg');
  // Only a photo is handed back, whatever the file says it is.
  const asPhoto = (t: any, p: string) => { const x = String(t || '').toLowerCase().split(';')[0].trim(); return /^image\/(jpeg|png|webp)$/.test(x) ? x : x ? null : typeOf(p); };
  const MAX = 12 * 1024 * 1024;
  try {
    if (u.pathname === '/api/files/view') {
      const own = ownOriginal(ref, tenantId); if (!own) return null;
      const path = String(new URL(own, 'https://app.invalid').searchParams.get('p') || '');
      const { privateBucket } = await import('./private-storage'); const f = (await privateBucket()).file(path);
      const [meta] = await f.getMetadata(); const type = asPhoto(meta?.contentType, path); if (!type || Number(meta?.size) > MAX) return null;
      const [buf] = await f.download(); return { buf, type };
    }
    if (u.hostname === 'firebasestorage.googleapis.com') {
      // The business's inspiration photos only (where the booking photo upload saves them), never another of its files.
      const m = u.pathname.match(/^\/v0\/b\/([A-Za-z0-9._-]+)\/o\/([^/]+)$/); if (!m || !buckets.includes(m[1])) return null;
      const path = decodeURIComponent(m[2]); if (!path.startsWith(`tenants/${tenantId}/booking-inspiration/`) || path.includes('..')) return null;
      const { namedBucket } = await import('./private-storage'); const f = (await namedBucket(m[1])).file(path);
      const [meta] = await f.getMetadata(); const type = asPhoto(meta?.contentType, path); if (!type || Number(meta?.size) > MAX) return null;
      const [buf] = await f.download(); return { buf, type };
    }
    if (u.pathname === '/api/booking/photo' && u.searchParams.get('t') === tenantId) {
      const id = String(u.searchParams.get('id') || ''); if (!PHOTO_ID.test(id)) return null;
      const d: any = (await db.doc(`tenants/${tenantId}/bookingPhotos/${id}`).get()).data();
      const mm = String(d?.dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/); if (!mm) return null;
      return { buf: Buffer.from(mm[2], 'base64'), type: mm[1] };
    }
  } catch (e: any) { console.error('[inspo-photos] bytes', e?.message); }
  return null;
}

/** Deletes one of a client's photos for good, when the business is asked to remove it: only this business's own
 *  copies (its inspiration folder, the photos the team made for this visit, the photo before its marks, or the
 *  database copy). Anything else is left alone ('not_ours'); 'failed' when it couldn't be deleted just now (it can be
 *  tried again). */
export async function deleteOwnPhoto(db: any, ref: any, tenantId: string, apptId: string, buckets: string[]): Promise<'deleted' | 'not_ours' | 'failed'> {
  if (typeof ref !== 'string' || !ref || ref.length > MAX_PHOTO_URL) return 'not_ours';
  let u: URL; try { u = new URL(ref, 'https://app.invalid'); } catch { return 'not_ours'; }
  try {
    if (u.pathname === '/api/files/view') {
      const own = ownOriginal(ref, tenantId); if (!own) return 'not_ours';
      const { privateBucket } = await import('./private-storage');
      await (await privateBucket()).file(String(new URL(own, 'https://app.invalid').searchParams.get('p') || '')).delete({ ignoreNotFound: true });
      return 'deleted';
    }
    if (u.hostname === 'firebasestorage.googleapis.com') {
      const m = u.pathname.match(/^\/v0\/b\/([A-Za-z0-9._-]+)\/o\/([^/]+)$/); if (!m || !buckets.includes(m[1])) return 'not_ours';
      let path = ''; try { path = decodeURIComponent(m[2]); } catch { return 'not_ours'; }
      if (path.includes('..') || !(path.startsWith(`tenants/${tenantId}/booking-inspiration/`) || path.startsWith(`tenants/${tenantId}/visit-photos/${apptId}/`))) return 'not_ours';
      const { namedBucket } = await import('./private-storage'); await (await namedBucket(m[1])).file(path).delete({ ignoreNotFound: true });
      return 'deleted';
    }
    if (u.pathname === '/api/booking/photo' && u.searchParams.get('t') === tenantId) {
      const id = String(u.searchParams.get('id') || ''); if (!PHOTO_ID.test(id)) return 'not_ours';
      await db.doc(`tenants/${tenantId}/bookingPhotos/${id}`).delete(); return 'deleted';
    }
  } catch (e: any) { console.error('[inspo-photos] delete', e?.message); return 'failed'; }
  return 'not_ours';
}
