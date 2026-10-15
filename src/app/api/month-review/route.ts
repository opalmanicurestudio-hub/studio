// src/app/api/month-review/route.ts — the month in review (lib/month-review), for managers. POST { tenantId, month? }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { loadMonthReview, reviewLines } from '@/lib/month-review';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  const db = getAdminDb(); const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const { tenantTimeZone, dayKey } = await import('@/lib/tenant-time'); const thisMonth = dayKey(new Date(), tenantTimeZone(tenant)).slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(String(b.month || '')) && String(b.month) <= thisMonth ? String(b.month) : thisMonth;
  const r = await loadMonthReview(db, tenantId, tenant, month);
  return NextResponse.json({ ok: true, review: r, lines: reviewLines(r), thisMonth }, { headers: { 'Cache-Control': 'no-store' } });
}
