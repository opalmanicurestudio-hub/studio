// /api/inventory/use — LOG A USE. POST { tenantId, productId, quantity, reason, at? } takes it off stock the way checkout
// does (lib/log-use) and records it as the person signed in. Anyone on the business's own team; booth renters keep their
// own. With more than one location, `at` is the store it was used at (required then; lib/store-stock).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { logUse } from '@/lib/log-use';
import { storesOf } from '@/lib/store-stock-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 120);
  const productId = String(b.productId || '').slice(0, 160);
  if (!tenantId || !productId || productId.includes('/')) return NextResponse.json({ ok: false, error: 'Which product?' }, { status: 400 });
  const g = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
  if (g.actor?.isRenter) return NextResponse.json({ ok: false, error: 'Only the business’s own team can log its stock.' }, { status: 403 });
  try {
    // (Read now, so a location added a moment ago counts.)
    const stores = await storesOf(getAdminDb(), tenantId, true);
    const store = stores.find((x) => x.id === String(b.at || '')) || null;
    if (stores.length && !b.at) return NextResponse.json({ ok: false, error: 'Pick the store it was used at. Reload the page if you don’t see your stores.' }, { status: 409 });
    if (stores.length && !store) return NextResponse.json({ ok: false, error: 'That store isn’t one of your locations now. Pick the store it was used at again.' }, { status: 400 });
    const r = await logUse(getAdminDb(), tenantId, productId, b.quantity, String(b.reason || ''), { id: String(g.actor.uid), name: String(g.actor.name || 'A team member') }, store);
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e: any) {
    console.error('[inventory/use]', String(e?.message || e).slice(0, 200));
    return NextResponse.json({ ok: false, error: 'That didn’t save. Try again.' }, { status: 500 });
  }
}
