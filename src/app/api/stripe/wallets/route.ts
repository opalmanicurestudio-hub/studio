// src/app/api/stripe/wallets/route.ts — Apple Pay and Google Pay on the business's pay pages (lib/wallet-domains).
//   status { tenantId } → whether payments are connected, and how each of the app's addresses stands for each wallet
//   check  { tenantId } → a manager: registers (or looks at again) every address on the business's own payments account
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { accountOf } from '@/lib/reader-sale';
import { linkOrigin } from '@/lib/app-origin';
import { ensureWalletDomains, walletStatus, walletsOn } from '@/lib/wallet-domains';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || '');
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Which business?' }, { status: 400 });
    const action = String(b.action || 'status');
    if (!['status', 'check'].includes(action)) return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
    const g = await requireRole(req, tenantId, action === 'check' ? 'manager' : 'staff'); if (g.deny) return g.deny;
    const db = getAdminDb();
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const origin = req.nextUrl?.origin || null;
    const connected = !!accountOf(tenant) && tenant.stripeChargesEnabled !== false;
    let error: string | null = null;
    if (action === 'check') {
      if (!connected) return NextResponse.json({ ok: false, error: 'Connect payments first.' }, { status: 409 });
      // Asked just now (a second tap): the answer already in hand.
      const last = Math.max(0, ...Object.values<any>(tenant.walletDomains || {}).map((s) => Date.parse(String(s?.at || '')) || 0));
      if (Date.now() - last > 30000) {
        const r = await ensureWalletDomains(db, tenantId, tenant, origin, { force: true });
        if (r.checked && !r.active) error = r.states.find((s) => s.error)?.error || null;
      }
    }
    return NextResponse.json({ ok: true, connected, on: walletsOn(tenant, linkOrigin(tenant, origin)), addresses: walletStatus(tenant, origin, action === 'check'), error });
  } catch (e: any) {
    console.error('[stripe/wallets] failed', e?.message);
    return NextResponse.json({ ok: false, error: 'That didn’t work. Try again in a moment.' }, { status: 500 });
  }
}
