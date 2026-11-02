// src/app/check-in/[token]/opengraph-image.tsx — THE PICTURE ON A SENT VISIT LINK (lib/visit-preview, board 15G): the
// business's color, its first letter and name, and "Your visit". Nothing about the visit itself, since previews show
// on lock screens and in group chats.
import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { visitPreviewOf } from '@/lib/visit-preview';
import { readableOn } from '@/lib/email-template';

export const runtime = 'nodejs';
export const alt = 'Your visit';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Literal paths, so the build keeps both font files with this route.
async function fonts(): Promise<[ArrayBuffer | null, ArrayBuffer | null]> {
  const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const [a, b] = await Promise.all([
    readFile(join(process.cwd(), 'src/assets/fonts/plus-jakarta-sans-latin-300-normal.woff')).then(buf, () => null),
    readFile(join(process.cwd(), 'src/assets/fonts/plus-jakarta-sans-latin-600-normal.woff')).then(buf, () => null),
  ]);
  return [a, b];
}

export default async function Image({ params }: { params: Promise<{ token: string }> | { token: string } }) {
  const { token } = await (params as any);
  const p = await visitPreviewOf(String(token || ''));
  const accent = p?.accent || '#16171a';
  const fg = readableOn(accent);
  const name = p?.name || '';
  const letter = (Array.from(name.trim())[0] || '').toUpperCase();
  const [light, bold] = await fonts();
  const faces = [
    ...(light ? [{ name: 'Jakarta', data: light, weight: 300 as const, style: 'normal' as const }] : []),
    ...(bold ? [{ name: 'Jakarta', data: bold, weight: 600 as const, style: 'normal' as const }] : []),
  ];
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: accent, color: fg, padding: '72px 84px', fontFamily: 'Jakarta' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {letter ? <div style={{ width: 88, height: 88, borderRadius: 26, background: fg === '#ffffff' ? 'rgba(255,255,255,0.16)' : 'rgba(22,23,26,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44, fontWeight: 600, marginRight: 28 }}>{letter}</div> : null}
          <div style={{ fontSize: 44, fontWeight: 600, maxWidth: 900, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{name}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 112, fontWeight: 300, letterSpacing: -3, lineHeight: 1.05 }}>Your visit</div>
          <div style={{ fontSize: 36, fontWeight: 300, opacity: 0.85, marginTop: 22 }}>See it, change it, or say you’re running late</div>
        </div>
      </div>
    ),
    {
      ...size, ...(faces.length ? { fonts: faces } : {}),
      // Kept for an hour (a day at the edge), so a new color or name shows up soon; never kept when the business
      // couldn't be found just then, so a slow moment doesn't leave a blank card behind.
      headers: { 'Cache-Control': p ? 'public, max-age=3600, s-maxage=86400' : 'no-store' },
    },
  );
}
