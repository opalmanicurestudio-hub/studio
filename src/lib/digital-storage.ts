// src/lib/digital-storage.ts — FETCHING A STORED DOWNLOAD (server). Files live in the shop's private downloads folder
// and are never given a public address; the routes that serve them (a buyer's library, a free preview) fetch the bytes
// here, trying each place the bucket can be named until one has the file.
import { getAdminStorage } from '@/lib/firebase-admin';   // the NAMED app: getStorage() alone finds no default app

/** Download the stored file through the same bucket-hunting chain. */
export async function downloadFile(path: string, tenantBucket: string | null): Promise<Uint8Array | null> {
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
    tenantBucket, null,
    process.env.FIREBASE_STORAGE_BUCKET || null,
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || null,
    appBucket,
    projectId ? `${projectId}.firebasestorage.app` : null,
    projectId ? `${projectId}.appspot.com` : null,
  ];
  const tried = new Set<string>();
  for (const name of names) {
    if (name !== null && tried.has(name)) continue;
    if (name !== null) tried.add(name);
    try {
      const bucket = name === null ? getAdminStorage().bucket() : getAdminStorage().bucket(name);
      const [buf] = await bucket.file(path).download();
      if (buf) return new Uint8Array(buf);
    } catch { /* next candidate */ }
  }
  return null;
}

