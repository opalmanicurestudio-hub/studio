// src/app/api/client-error/route.ts — a crash on someone's phone, saved so it can be fixed (lib/client-crash).
// platformHealth/clientErrors/items — newest kept; nothing personal beyond the page and the phone's browser.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const s = (v: any, n: number) => String(v ?? '').slice(0, n);
  try {
    await getAdminDb().collection('platformHealth').doc('clientErrors').collection('items').add({
      at: new Date().toISOString(), where: s(b.where, 80), message: s(b.message, 500), stack: s(b.stack, 2000), url: s(b.url, 300), ua: s(b.ua, 200), tenantId: s(b.tenantId, 80) || null,
    });
  } catch { /* best effort */ }
  return NextResponse.json({ ok: true });
}
