import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

// ─── src/lib/pdf-watermark.ts ────────────────────────────────────────────────
// Burns the buyer's identity INTO the pages of a purchased PDF.
//
// Why this exists: the library page draws a watermark over the viewer, which
// works on desktop and fails exactly where it matters most — iPhone Safari
// often hands a PDF to its own native viewer, where our overlay doesn't
// exist and the file appears pristine. A watermark that disappears on the
// device most of her customers use is decoration, not deterrence. Stamped
// pixels travel with the file: into the native viewer, into a screenshot,
// into an AirDrop, into a re-upload.
//
// Deliberately restrained: diagonal, low-opacity, repeated down the page so
// no crop removes it, but never so heavy that a customer who paid feels
// punished by their own purchase. The goal is attribution, not ruining the
// thing they bought.

const MAX_STAMP_BYTES = 25 * 1024 * 1024;

export async function watermarkPdf(bytes: Uint8Array, label: string): Promise<Uint8Array> {
  // Oversized or non-PDF input is returned untouched rather than failing the
  // customer's view — the overlay watermark still applies in-app.
  if (!bytes || bytes.length === 0 || bytes.length > MAX_STAMP_BYTES) return bytes;
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const text = label.slice(0, 90);
    const size = 11;
    const width = font.widthOfTextAtSize(text, size);

    for (const page of pdf.getPages()) {
      const { width: pw, height: ph } = page.getSize();
      const stepY = Math.max(150, ph / 4);
      const stepX = Math.max(220, width + 90);
      for (let y = 40; y < ph + stepY; y += stepY) {
        for (let x = -40; x < pw + stepX; x += stepX) {
          page.drawText(text, {
            x, y,
            size,
            font,
            color: rgb(0.42, 0.42, 0.46),
            opacity: 0.16,
            rotate: degrees(30),
          });
        }
      }
    }
    return await pdf.save();
  } catch {
    // A malformed or password-protected PDF must still reach the buyer.
    return bytes;
  }
}

export function looksLikePdf(path: string, bytes?: Uint8Array): boolean {
  if (/\.pdf$/i.test(path)) return true;
  if (bytes && bytes.length > 4) {
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }
  return false;
}
