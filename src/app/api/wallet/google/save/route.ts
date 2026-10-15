// GET /api/wallet/google/save?t=&c=&k= — sends the client to "Add to Google Wallet" for their rewards card (lib/wallet).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { rewardsKey } from '@/lib/loyalty-link';
import { walletConfig, cardFacts, googleSaveUrl } from '@/lib/wallet';

export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const t = String(q.get('t') || '').slice(0, 80), c = String(q.get('c') || '').slice(0, 80);
  if (!t || !c || q.get('k') !== rewardsKey(t, c)) return new NextResponse('This link isn’t valid.', { status: 403 });
  if (!walletConfig().google) return new NextResponse('Google Wallet isn’t set up for this business yet.', { status: 404 });
  const db = getAdminDb(); const f = await cardFacts(db, t, c); if (!f) return new NextResponse('No rewards program is running right now.', { status: 404 });
  const tenant: any = (await db.doc(`tenants/${t}`).get()).data() || {}; const { linkOrigin } = await import('@/lib/app-origin');
  const url = await googleSaveUrl(f, t, c, linkOrigin(tenant, '') || req.nextUrl.origin);
  await db.doc(`tenants/${t}/clients/${c}`).set({ wallet: { google: true } }, { merge: true }).catch(() => {});
  return NextResponse.redirect(url, 302);
}
