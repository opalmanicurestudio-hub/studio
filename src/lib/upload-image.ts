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
 *
 * TRANSPARENCY. Everything used to be re-encoded as JPEG, which has no alpha
 * channel — so a logo saved as a transparent PNG came back with a hard
 * rectangle behind it, usually black. That is invisible on a white settings
 * card and obvious the moment the logo lands on a coloured storefront header.
 * Formats that carry alpha now stay in a format that carries alpha, and the
 * canvas is never pre-filled, so what a designer exported is what uploads.
 */

import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

/** Formats whose whole point is that pixels can be see-through. */
const ALPHA_TYPES = ['image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

export function keepsAlpha(type: string | undefined | null): boolean {
  return ALPHA_TYPES.includes(String(type || '').toLowerCase());
}

/**
 * Pick the encoding to write back out.
 *
 * A transparent source must not be re-encoded as JPEG at any quality, because
 * the loss is not compression artefacts — it is the alpha channel disappearing
 * and being replaced with black. PNG is lossless and slightly larger; for a
 * logo at a few hundred pixels that difference is trivial next to shipping a
 * black box on a customer's storefront.
 */
function encodingFor(file: File): { type: string; quality: number | undefined } {
  if (String(file.type).toLowerCase() === 'image/webp') return { type: 'image/webp', quality: 0.9 };
  if (keepsAlpha(file.type)) return { type: 'image/png', quality: undefined };
  return { type: 'image/jpeg', quality: 0.85 };
}

async function downscale(file: File, maxDim: number): Promise<Blob> {
  try {
    // SVG is already resolution-independent and has no pixels to shrink.
    // Rasterising it would make it worse, so it is passed through untouched.
    if (String(file.type).toLowerCase() === 'image/svg+xml') return file;

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) return file; // already small enough
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    // alpha:true is the default, but stating it makes the intent unmissable to
    // whoever next reaches for a performance flag.
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return file;
    // No fillRect before drawing. Painting a white background here would
    // destroy transparency just as thoroughly as JPEG does.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const enc = encodingFor(file);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, enc.type, enc.quality));
    return blob || file;
  } catch {
    return file; // downscaling is an optimization, never a blocker
  }
}

export async function uploadImage(path: string, file: File, maxDim = 512): Promise<string> {
  const blob = await downscale(file, maxDim);
  const sRef = storageRef(getStorage(), path);
  // Fall back to the SOURCE type, not JPEG. A blob that lost its type on the
  // way through should still be served as what it actually is.
  await uploadBytes(sRef, blob, { contentType: blob.type || file.type || 'image/jpeg' });
  return getDownloadURL(sRef);
}

/** Upload an already-prepared blob (e.g. a marked-up canvas export). */
export async function uploadImageBlob(path: string, blob: Blob): Promise<string> {
  const sRef = storageRef(getStorage(), path);
  await uploadBytes(sRef, blob, { contentType: blob.type || 'image/jpeg' });
  return getDownloadURL(sRef);
}

/** Convert a base64 data-URL (canvas exports) to a Blob for upload. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = head.match(/data:(.*?);/)?.[1] || 'image/jpeg';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
