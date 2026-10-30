// /api/reviews — THE REVIEWS SCREEN'S CHANGES (lib/reviews-server). For the people whose role runs marketing
// (Settings → Roles: "Campaigns, discounts and reviews"); the owner always can.
//   { tenantId, action: 'show' | 'hide', kind: 'shop' | 'visit', id, reason? }   hiding needs a reason (lib/reviews)
//   { tenantId, action: 'pin', id, on }   a shown visit review first on the booking page, or not
//   { tenantId, action: 'settings', shopAutoShow?, visitAutoShow?, askOn?, askDays? }
// The screen reads the reviews themselves straight from the database (the team can read them; nobody can write them
// from a browser).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { saveReviewSettings, setReviewPinned, setReviewState } from '@/lib/reviews-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const g = await requireCan(req, tenantId, 'marketing.manage'); if (g.deny) return g.deny;
  const db = getAdminDb();
  try {
    if (b.action === 'show' || b.action === 'hide') {
      const r = await setReviewState(db, tenantId, g.actor, { kind: b.kind, id: b.id, to: b.action === 'show' ? 'shown' : 'hidden', reason: b.reason });
      if (!r.ok) return NextResponse.json(r, { status: r.status });
      // A product's stars on its page (and in its search markup) are kept for a few minutes: start again now.
      if (b.kind === 'shop') { try { const { revalidateTag } = await import('next/cache'); revalidateTag(`shop:${tenantId}`); } catch { /* refreshes on its own */ } }
      return NextResponse.json(r);
    }
    if (b.action === 'pin') {
      const r = await setReviewPinned(db, tenantId, g.actor, { id: b.id, on: b.on });
      return NextResponse.json(r, { status: r.ok ? 200 : r.status });
    }
    if (b.action === 'settings') {
      const r = await saveReviewSettings(db, tenantId, { shopAutoShow: b.shopAutoShow, visitAutoShow: b.visitAutoShow, askOn: b.askOn, askDays: b.askDays });
      return NextResponse.json(r, { status: r.ok ? 200 : 404 });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (e: any) {
    console.warn('[reviews]', String(e?.message || e).slice(0, 160));
    return NextResponse.json({ ok: false, error: 'That didn’t save. Try again.' }, { status: 500 });
  }
}
