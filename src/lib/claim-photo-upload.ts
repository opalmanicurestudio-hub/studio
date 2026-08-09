import { getStorage } from 'firebase-admin/storage';

// ─── src/lib/claim-photo-upload.ts ───────────────────────────────────────────
// Customer claim photos, uploaded SERVER-SIDE through the admin SDK — which
// is the entire security design: Storage rules never open a public write
// path. The customer's token is checked by the route, the server writes to
// a path the customer never chooses, and the file becomes readable only via
// its own download-token URL (the same capability mechanism client
// getDownloadURL uses).
//
// The bucket-hunting chain below is copied deliberately from the proven
// maintenance uploader rather than imported from it — retail claims must
// not couple to the maintenance module, and this uploader must keep working
// even if that one changes. (Same tradeoff as the bulk-slip parity copy:
// zero regression risk to a working feature, accepted style-drift risk.)

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ClaimPhotoResult { url: string | null; error?: string }

export async function uploadClaimPhotoFromDataUrl(
  tenantId: string,
  claimId: string,
  dataUrl: any,
): Promise<ClaimPhotoResult> {
  try {
    const s = String(dataUrl || '');
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(s);
    if (!m) return { url: null, error: 'That file isn\u2019t a photo we can read.' };
    const mime = m[1].toLowerCase();
    if (!ALLOWED.has(mime)) return { url: null, error: 'Use a JPG, PNG, or WebP photo.' };
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length === 0) return { url: null, error: 'That photo came through empty \u2014 try again.' };
    if (buf.length > MAX_PHOTO_BYTES) return { url: null, error: 'Keep photos under 3 MB.' };

    const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
    const path = `tenants/${tenantId}/retail-claims/${claimId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const token = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

    // Bucket ground truth first (the tenant doc self-records it from the
    // working client config), then every plausible fallback.
    let tenantBucket: string | null = null;
    try {
      const { getAdminDb } = await import('./firebase-admin');
      const tSnap = await getAdminDb().doc(`tenants/${tenantId}`).get();
      tenantBucket = String((tSnap.data() as any)?.storageBucket || '') || null;
    } catch { /* keep hunting */ }
    let projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
      || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
    let appBucket: string | null = null;
    try {
      const { getApps } = await import('firebase-admin/app');
      const opts: any = getApps()[0]?.options || {};
      appBucket = opts.storageBucket || null;
      if (!projectId) projectId = opts.projectId || opts.credential?.projectId || '';
    } catch { /* keep hunting */ }
    const names: (string | null)[] = [
      tenantBucket,
      null,
      process.env.FIREBASE_STORAGE_BUCKET || null,
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || null,
      appBucket,
      projectId ? `${projectId}.firebasestorage.app` : null,
      projectId ? `${projectId}.appspot.com` : null,
    ];
    const tried = new Set<string>();
    let lastErr: any = null;
    for (const name of names) {
      if (name !== null && tried.has(name)) continue;
      if (name !== null) tried.add(name);
      try {
        const bucket = name === null ? getStorage().bucket() : getStorage().bucket(name);
        await bucket.file(path).save(buf, {
          contentType: mime,
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        return { url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}` };
      } catch (err) { lastErr = err; }
    }
    console.error('[claim-photo] upload failed on every bucket candidate', Array.from(tried), lastErr);
    return { url: null, error: 'The photo couldn\u2019t be saved \u2014 your report is still open, and you can try the photo again in a minute.' };
  } catch (err: any) {
    console.error('[claim-photo] upload failed', err);
    return { url: null, error: 'The photo couldn\u2019t be saved \u2014 your report is still open.' };
  }
}
