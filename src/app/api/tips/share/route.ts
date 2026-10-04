// src/app/api/tips/share/route.ts — TIP SHARING periods.
//   { action: 'preview', start, end }   managers: how the period would split (not saved)
//   { action: 'approve', start, end }   managers: save it as this period's approved shares (payroll pays these)
//   { action: 'runs' }                  managers: approved periods
//   { action: 'mine' }                  the signed-in person's own shares from approved periods (their breakdown)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { computeTipShares, tipPolicy } from '@/lib/tip-share';
export const dynamic = 'force-dynamic';
const key = (s: string, e: string) => `${s.slice(0, 10)}_${e.slice(0, 10)}`;

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const tenant: any = (await db.doc(T).get()).data() || {}; const isMgr = !!(auth.actor.isManager || auth.actor.isTenantOwner);
  if (b.action === 'mine') {
    const { staffIdForLogin } = await import('@/lib/owner-staff'); const sid = await staffIdForLogin(db, tenantId, auth.actor.uid).catch(() => null); if (!sid) return NextResponse.json({ ok: true, rows: [], mode: tipPolicy(tenant).mode });
    const runs = (await db.collection(`${T}/tipShareRuns`).where('status', '==', 'approved').get()).docs.map((d: any) => d.data() || {}).sort((a: any, b2: any) => String(b2.start).localeCompare(String(a.start))).slice(0, 12);
    return NextResponse.json({ ok: true, mode: tipPolicy(tenant).mode, rows: runs.map((r: any) => { const me = (r.rows || []).find((x: any) => x.staffId === sid); return me ? { start: r.start, end: r.end, mode: r.mode, earnedCents: me.earnedCents, shareCents: me.shareCents, hours: me.hours, inCents: me.inCents, outCents: me.outCents, potCents: r.totalCents, people: (r.rows || []).filter((x: any) => !x.note).length } : null; }).filter(Boolean) });
  }
  if (!isMgr) return NextResponse.json({ ok: false, error: 'Managers only.' }, { status: 403 });
  if (b.action === 'runs') return NextResponse.json({ ok: true, runs: (await db.collection(`${T}/tipShareRuns`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).sort((a: any, b2: any) => String(b2.start).localeCompare(String(a.start))).slice(0, 30) });
  const start = String(b.start || '').slice(0, 30), end = String(b.end || '').slice(0, 30); if (!start || !end || end < start) return NextResponse.json({ ok: false, error: 'Pick a period.' }, { status: 400 });
  const result = await computeTipShares(db, tenantId, tenant, start, end);
  if (b.action === 'preview') return NextResponse.json({ ok: true, ...result, existing: (await db.doc(`${T}/tipShareRuns/${key(start, end)}`).get()).data()?.status || null });
  if (b.action === 'approve') { const now = new Date().toISOString();
    await db.doc(`${T}/tipShareRuns/${key(start, end)}`).set({ ...result, status: 'approved', approvedBy: auth.actor.name || 'Manager', approvedAt: now }, { merge: false });
    return NextResponse.json({ ok: true, ...result, status: 'approved' }); }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
