// src/app/api/grace/route.ts — CLIENT GRACE ALLOWANCES (staff only).
//   check — how many this client has left for an event
//   use   — record one use (rule on, one left, and this person may approve it)
//   void  — a manager undoes a misclassified use (with a reason)
// Every use and undo lands in the booking's decision log. No medical or family
// details are asked for — only an optional short reason.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { graceRemaining, graceCanApply, GRACE_EVENTS, PERMIT_LABEL, type GraceEvent } from '@/lib/grace';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), action = String(b.action || '');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const actor = { type: 'user' as const, id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role };

  if (action === 'void') {
    if (!['owner', 'admin', 'manager'].includes(String(auth.actor.role || '').toLowerCase())) return NextResponse.json({ ok: false, error: 'Only a manager can undo a grace use.' }, { status: 403 });
    const ref = db.doc(`${T}/graceUses/${String(b.useId || '')}`); const u: any = (await ref.get()).data();
    if (!u) return NextResponse.json({ ok: false, error: 'That grace use wasn’t found.' }, { status: 404 });
    if (u.voidedAt) return NextResponse.json({ ok: true, already: true });
    const reason = String(b.reason || '').trim().slice(0, 200);
    if (!reason) return NextResponse.json({ ok: false, error: 'Add a reason for undoing it.' }, { status: 400 });
    await ref.set({ voidedAt: new Date().toISOString(), voidedBy: auth.actor.name, voidReason: reason }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'grace.voided', targetType: 'appointment', targetId: u.appointmentId || u.clientId, summary: `Grace use undone (${String(u.event).replace('_', ' ')}) — ${reason}. The allowance is available again.`, actor }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const event = String(b.event || '') as GraceEvent;
  if (!GRACE_EVENTS.some((g) => g.id === event)) return NextResponse.json({ ok: false, error: 'Unknown event.' }, { status: 400 });
  const clientId = String(b.clientId || '');
  if (!clientId) return NextResponse.json({ ok: false, error: 'No client on this booking.' }, { status: 400 });
  const ctx = { clientId, serviceId: b.serviceId || null, staffId: b.staffId || null };
  const snap = await db.collection(`${T}/graceUses`).where('clientId', '==', clientId).get();
  const uses = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const g = graceRemaining(tenant, event, uses, ctx);
  const canApply = graceCanApply(auth.actor.role, g.rule);
  if (action === 'check') return NextResponse.json({ ok: true, ...g, canApply, permitLabel: PERMIT_LABEL[g.rule.permits] });

  if (action === 'use') {
    if (!g.enabled) return NextResponse.json({ ok: false, error: 'Grace isn’t switched on for this.' }, { status: 409 });
    if (g.remaining <= 0) return NextResponse.json({ ok: false, error: 'No grace left for this client in this period.' }, { status: 409 });
    if (!canApply) return NextResponse.json({ ok: false, error: 'A manager approves grace for this.' }, { status: 403 });
    const ref = db.collection(`${T}/graceUses`).doc();
    const nowIso = new Date().toISOString();
    const clientName = String(((await db.doc(`${T}/clients/${clientId}`).get()).data() as any)?.name || '') || null;
    const use = { id: ref.id, tenantId, clientId, clientName, event, at: nowIso, appointmentId: b.appointmentId || null, serviceId: ctx.serviceId, staffId: ctx.staffId,
      permit: g.rule.permits, reason: String(b.reason || '').trim().slice(0, 200) || null, appliedBy: auth.actor.name, appliedById: auth.actor.uid,
      approvedBy: g.rule.approval === 'manager' ? auth.actor.name : null, voidedAt: null };
    await ref.set(use);
    const left = g.remaining - 1;
    await logAuditAdmin(db, tenantId, { action: 'grace.used', targetType: 'appointment', targetId: b.appointmentId || clientId,
      summary: `Grace used — ${String(event).replace('_', ' ')}: ${PERMIT_LABEL[g.rule.permits].toLowerCase()}${use.reason ? ` (${use.reason})` : ''}. ${left} left in this ${g.periodMonths}-month period.`, actor }).catch(() => {});
    return NextResponse.json({ ok: true, useId: ref.id, remaining: left, permit: g.rule.permits });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
