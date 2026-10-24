// /api/money/refund — send a refund from Money back to the client's card.
// POST { tenantId, transactionId, amountCents, record? } — record: what goes on the refund line, which is written here.
// Cash, and payments with no card reference, come back { card: false } and the
// Money page records the refund in the books only.
import { refundAllowed } from '@/lib/money-limits';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { cleanRecord, refundSaleToCard } from '@/lib/money-refund';

export async function POST(req: NextRequest) {
  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 }); }
  const tenantId = String(b.tenantId || ''); const transactionId = String(b.transactionId || ''); const want = Math.round(Number(b.amountCents) || 0);
  if (!tenantId || !transactionId || want <= 0) return NextResponse.json({ ok: false, error: 'Missing the sale or the amount.' }, { status: 400 });
  const g = await requireCan(req, tenantId, 'checkout.refund'); if (g.deny) return g.deny;
  const db = getAdminDb(); const tenant = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  // The same per-role refund limit as online orders (lib/money-limits).
  const allowed = refundAllowed((tenant as any).retailSettings || {}, g.actor || {}, want);
  if (!allowed.ok) return NextResponse.json({ ok: false, error: allowed.message }, { status: 403 });
  // What goes on the refund line (the reason, a tip or commission taken back): the card refund is recorded here, so a
  // screen that never hears back can't leave it out of the books.
  const r = await refundSaleToCard(db, tenantId, tenant, transactionId, want, g.actor?.name || null, cleanRecord(b.record));
  return NextResponse.json(r, { status: r.ok ? 200 : r.status });
}
