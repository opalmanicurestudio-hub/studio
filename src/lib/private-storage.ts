// src/lib/private-storage.ts
//
// PRIVATE FILES — saved with no public link. They're opened only through
// /api/files/view (which checks who's asking) with a 5-minute signed link.
// Same admin app and bucket as that viewer.

import { createHash } from 'crypto';

export async function privateBucket() {
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getStorage } = await import('firebase-admin/storage');
  let app: any = getApps().find((a: any) => a.name === 'admin');
  if (!app) {
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
    app = initializeApp({ credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey } as any), storageBucket: process.env.FIREBASE_STORAGE_BUCKET }, 'admin');
  }
  const storage: any = getStorage(app);
  const name = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  return name ? storage.bucket(name) : storage.bucket();
}

/** Save a data-URL image privately. Returns its app reference and fingerprint. */
export async function savePrivateImage(tenantId: string, path: string, dataUrl: string, maxBytes = 450_000) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('That photo couldn’t be read — take it again.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 2_000) throw new Error('That photo is too small — take it again.');
  if (buf.length > maxBytes) throw new Error('That photo is too large.');
  const bucket = await privateBucket();
  await bucket.file(path).save(buf, { contentType: m[1], resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  return { ref: `/api/files/view?t=${encodeURIComponent(tenantId)}&p=${encodeURIComponent(path)}`, path, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

/** Save an uploaded document (image or PDF) privately — e.g. an applicant's ID. */
export async function savePrivateDocument(tenantId: string, path: string, dataUrl: string, maxBytes = 3_000_000) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('Upload a photo or a PDF.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 1_000) throw new Error('That file looks empty.');
  if (buf.length > maxBytes) throw new Error('That file is too large (3 MB max) — try a photo instead.');
  const bucket = await privateBucket();
  const ext = m[1] === 'application/pdf' ? 'pdf' : 'jpg';
  const full = `${path}.${ext}`;
  await bucket.file(full).save(buf, { contentType: m[1], resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  return { ref: `/api/files/view?t=${encodeURIComponent(tenantId)}&p=${encodeURIComponent(full)}`, path: full, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, type: m[1] };
}
