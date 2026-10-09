// src/app/api/timing/route.ts — TYPICAL TIMES for owners and managers (from the nightly numbers).
//   { action: 'services' }           → per service: the team's typical time vs its booked length (licensed staff only)
//   { action: 'staff', staffId }     → one provider's rows (what "My times" shows them), for their profile
// Never renters: how an independent provider works is their own business.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  if (!(auth.actor.isManager || auth.actor.isTenantOwner)) return NextResponse.json({ ok: false, error: 'Managers only.' }, { status: 403 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const names = new Map<string, string>((await db.collection(`${T}/services`).get()).docs.map((d: any) => [d.id, String((d.data() || {}).name || 'Service')]));
  const label = (key: string) => String(key).split('+').map((id) => names.get(id) || 'Service').join(' + ');
  if (b.action === 'services') {
    const rows = (await db.collection(`${T}/timingStats`).where('staffId', '==', 'all').get()).docs.map((d: any) => d.data() || {}).filter((x: any) => Number(x.count) >= 5)
      .map((x: any) => ({ serviceId: x.serviceId, serviceKey: x.serviceKey, label: label(x.serviceKey), plain: !String(x.serviceKey).includes('+'), count: x.count, typical: x.typicalMinutes, low: x.rangeLow, high: x.rangeHigh, booked: x.bookedMinutes, onTime: x.onTimeRate,
        suggest: Math.ceil(x.typicalMinutes / 5) * 5 }));
    return NextResponse.json({ ok: true, rows });
  }
  if (b.action === 'staff') {
    const sid = String(b.staffId || ''); const st: any = (await db.doc(`${T}/staff/${sid}`).get()).data() || {};
    if (st.role === 'renter' || st.isRenter) return NextResponse.json({ ok: true, rows: [], renter: true });
    const mine = (await db.collection(`${T}/timingStats`).where('staffId', '==', sid).get()).docs.map((d: any) => d.data() || {}).filter((x: any) => Number(x.count) >= 5);
    const team = await Promise.all(mine.map((x: any) => db.doc(`${T}/timingStats/all__${String(x.serviceKey).replace(/[\/]/g, '_').slice(0, 400)}`).get()));
    const rows = mine.map((x: any, i: number) => { const t: any = team[i]?.exists ? team[i].data() : null;
      return { serviceId: String(x.serviceKey).includes('+') ? null : x.serviceId || x.serviceKey, label: label(x.serviceKey), count: x.count, typical: x.typicalMinutes, low: x.rangeLow, high: x.rangeHigh, booked: x.bookedMinutes, onTime: x.onTimeRate, clientCaused: x.clientCausedOverruns, ranBehind: x.ranBehindOverruns,
        trend: x.recentTypical !== null && x.earlierTypical !== null ? x.recentTypical - x.earlierTypical : null, team: t && Number(t.count) >= 5 ? t.typicalMinutes : null }; }).sort((a: any, b2: any) => b2.count - a.count);
    return NextResponse.json({ ok: true, rows, isStudent: !!st.isStudent });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
