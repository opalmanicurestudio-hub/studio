// ─── client-image.ts ──────────────────────────────────────────────────────────
// Every customer/worker photo in ClarityFlow travels as a base64 data-URL
// inside a JSON POST, and the serverless request body tops out around
// 4.5 MB — while a modern phone photo is 3–8 MB. Without downscaling, the
// people with the newest phones (and the angriest problems) are exactly the
// ones whose evidence uploads fail. 1280px JPEG is plenty for evidence and
// lands around 200–500 KB.
//
// Failure honesty: if the browser can't decode/resize the image, we fall
// back to the RAW file only when it is actually small enough to survive the
// request — otherwise we throw a human explanation. Silently sending an
// 8 MB body to a 4.5 MB limit would just move the failure somewhere
// confusing.

/** Pure fit math — exported for tests. Never upscales. */
export function fitWithin(w: number, h: number, maxDim: number): { width: number; height: number } {
  const scale = Math.min(1, maxDim / Math.max(w || 1, h || 1, 1));
  return {
    width: Math.max(1, Math.round((w || 1) * scale)),
    height: Math.max(1, Math.round((h || 1) * scale)),
  };
}

/** A raw data-URL this long (~2.8 MB of binary) still fits a JSON body with
 *  comfortable margin; anything bigger must be re-encoded or refused. */
export const RAW_DATAURL_LIMIT = 3_800_000;

export async function downscaleImageToDataUrl(
  file: File,
  opts?: { maxDim?: number; quality?: number },
): Promise<string> {
  const maxDim = opts?.maxDim ?? 1280;
  const quality = opts?.quality ?? 0.82;

  const rawDataUrl: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ''));
    r.onerror = () => rej(new Error('Could not read that file — try another.'));
    r.readAsDataURL(file);
  });

  // Non-images (rare, some intakes allow PDFs) pass through untouched when
  // small enough; we cannot resize what we cannot draw.
  if (!file.type.startsWith('image/')) {
    if (rawDataUrl.length <= RAW_DATAURL_LIMIT) return rawDataUrl;
    throw new Error('That file is too large to attach — images work best.');
  }

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    const fallback = () => {
      if (rawDataUrl.length <= RAW_DATAURL_LIMIT) resolve(rawDataUrl);
      else reject(new Error('That photo could not be processed — a screenshot of it will attach fine.'));
    };
    img.onload = () => {
      try {
        const { width, height } = fitWithin(img.width, img.height, maxDim);
        // Already small in pixels AND bytes → keep the original (no
        // generation loss on something that was never a problem).
        if (width >= img.width && height >= img.height && rawDataUrl.length <= 1_200_000) {
          resolve(rawDataUrl);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { fallback(); return; }
        ctx.drawImage(img, 0, 0, width, height);
        const out = canvas.toDataURL('image/jpeg', quality);
        if (out.length > RAW_DATAURL_LIMIT) { fallback(); return; }
        resolve(out);
      } catch {
        fallback();
      }
    };
    img.onerror = fallback;
    img.src = rawDataUrl;
  });
}
