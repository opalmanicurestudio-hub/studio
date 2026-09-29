// src/app/api/team-discounts/route.ts — WHO GETS the team / family & friends discount. Managers only; every change logged.
//   link   { clientId, type: 'team' | 'family', staffId } — a family & friends link respects the per-person limit
//   unlink { clientId }
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { isApprover } from '@/lib/approvals';
import { teamDiscountSettingsOf } from '@/lib/team-discount';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), clientId = String(b.clientId || ''), action = String(b.action || '');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  if (!isApprover(auth.actor.role)) return NextResponse.json({ ok: false, error: 'Only a manager can change who gets team and family discounts.' }, { status: 403 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const cRef = db.doc(`${T}/clients/${clientId}`); const c: any = (await cRef.get()).data();
  if (!c) return NextResponse.json({ ok: false, error: 'That client wasn’t found.' }, { status: 404 });
  const actor = { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role };
  if (action === 'unlink') {
    await cRef.set({ discountGroup: FieldValue.delete() }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'client.discount_group_removed', targetType: 'client', targetId: clientId, summary: `${c.name || 'Client'} removed from ${c.discountGroup?.type === 'team' ? 'the team discount' : 'family & friends'}`, actor } as any).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  if (action !== 'link') return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  const type = b.type === 'team' ? 'team' : b.type === 'family' ? 'family' : null;
  const staffId = String(b.staffId || '');
  if (!type || !staffId) return NextResponse.json({ ok: false, error: 'Choose the programme and the team member.' }, { status: 400 });
  const st: any = (await db.doc(`${T}/staff/${staffId}`).get()).data();
  if (!st) return NextResponse.json({ ok: false, error: 'That team member wasn’t found.' }, { status: 404 });
  if (type === 'family') {
    const limit = teamDiscountSettingsOf(((await db.doc(T).get()).data() as any) || {}).family.perStaffLimit;
    if (limit > 0) {
      const theirs = (await db.collection(`${T}/clients`).where('discountGroup.staffId', '==', staffId).get()).docs.filter((d: any) => d.id !== clientId && (d.data() as any).discountGroup?.type === 'family');
      if (theirs.length >= limit) return NextResponse.json({ ok: false, error: `${(st.name || 'They').split(' ')[0]} already has ${limit} family & friends — remove one first.` }, { status: 409 });
    }
  }
  await cRef.set({ discountGroup: { type, staffId, staffName: st.name || null, addedBy: auth.actor.name, addedAt: new Date().toISOString() } }, { merge: true });
  await logAuditAdmin(db, tenantId, { action: 'client.discount_group_added', targetType: 'client', targetId: clientId, summary: `${c.name || 'Client'} added as ${type === 'team' ? 'a team member' : `family & friends of ${st.name || 'a team member'}`}`, actor } as any).catch(() => {});
  return NextResponse.json({ ok: true });
}
