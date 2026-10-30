// GET /api/public/reviews?tenantId=… — THE VISIT REVIEWS A BOOKING PAGE SHOWS (lib/reviews-server publicVisitReviews):
// only the ones the business chose to show (Reviews → Visits), first name and last initial, the service and who did it.
// Visit reviews are readable by the team only; public pages get them here. Kept a minute (by the browser and the CDN, so
// busy pages don't each ask the database), so one the business hides drops off within a few minutes.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { publicVisitReviews } from '@/lib/reviews-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').slice(0, 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const limited = await limitPublic(req, 'public-reviews', tenantId, { perHour: 600, perDay: 6000 }); if (limited) return limited;
  try {
    const r = await publicVisitReviews(getAdminDb(), tenantId);
    return NextResponse.json({ ok: true, ...r }, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300' } });
  } catch {
    // A reviews outage never takes a booking page down with it.
    return NextResponse.json({ ok: true, average: 0, count: 0, reviews: [] });
  }
}
