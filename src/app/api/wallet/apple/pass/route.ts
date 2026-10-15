// GET /api/wallet/apple/pass?t=&c=&k= — the client's rewards card for Apple Wallet (lib/wallet). Only with the private
// key from their own rewards link.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { rewardsKey } from '@/lib/loyalty-link';
import { walletConfig, cardFacts, applePass, serialOf } from '@/lib/wallet';

export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const t = String(q.get('t') || '').slice(0, 80), c = String(q.get('c') || '').slice(0, 80);
  if (!t || !c || q.get('k') !== rewardsKey(t, c)) return new NextResponse('This link isn’t valid.', { status: 403 });
  if (!walletConfig().apple) return new NextResponse('Apple Wallet isn’t set up for this business yet.', { status: 404 });
  const db = getAdminDb(); const f = await cardFacts(db, t, c); if (!f) return new NextResponse('No rewards program is running right now.', { status: 404 });
  const tenant: any = (await db.doc(`tenants/${t}`).get()).data() || {}; const { linkOrigin } = await import('@/lib/app-origin');
  const buf = await applePass(f, serialOf(t, c), linkOrigin(tenant, '') || req.nextUrl.origin);
  await db.doc(`tenants/${t}/clients/${c}`).set({ wallet: { apple: true } }, { merge: true }).catch(() => {});
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.apple.pkpass', 'Content-Disposition': 'attachment; filename="rewards.pkpass"', 'Cache-Control': 'no-store' } });
}
