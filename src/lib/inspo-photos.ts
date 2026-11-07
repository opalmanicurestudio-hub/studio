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
