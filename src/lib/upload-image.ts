/**
 * upload-image — v1
 *
 * The one shared path for uploading images anywhere in the app (staff
 * avatars, client profile photos, and whatever comes next). Downscales
 * client-side before upload — a 12MP phone photo becomes a ~50KB avatar
 * instead of a 4MB original, which matters at multi-tenant scale.
 *
 * Returns the tokened download URL, which is what gets saved onto the
 * doc's avatarUrl field — token URLs render anywhere (including public
 * booking pages) regardless of Storage read rules.
 */

import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

async function downscale(file: File, maxDim: number): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) return file; // already small enough
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImageSmoothingEnabled = true as any;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    return blob || file;
  } catch {
    return file; // downscaling is an optimization, never a blocker
  }
}

export async function uploadImage(path: string, file: File, maxDim = 512): Promise<string> {
  const blob = await downscale(file, maxDim);
  const sRef = storageRef(getStorage(), path);
  await uploadBytes(sRef, blob, { contentType: blob.type || 'image/jpeg' });
  return getDownloadURL(sRef);
}
