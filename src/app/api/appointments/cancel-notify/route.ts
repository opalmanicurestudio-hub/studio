// src/app/api/appointments/cancel-notify/route.ts
//
// TELLING THE CLIENT WHAT HAPPENED WHEN THEIR BOOKING IS CANCELLED — one
// message, from the server, in the business's own policy wording
// (src/lib/policy-copy.ts), matching what was actually done: fee charged /
// owed / waived, the deposit applied / refunded / saved as credit / kept, any
// goodwill credit — and a "book again" link that opens on their service.
// Staff only. The cancellation itself is recorded before this is called.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';
import { cancellationOutcomeLines, type CancelOutcome } from '@/lib/policy-copy';
import { sendCancellationNotice } from '@/lib/cancel-notice';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), appointmentId = String(b.appointmentId || '');
  if (!tenantId || !appointmentId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const ap: any = ((await db.doc(`${T}/appointments/${appointmentId}`).get()).data() as any) || null;
  if (!ap) return NextResponse.json({ ok: false, error: 'That booking wasn’t found.' }, { status: 404 });
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const cl: any = ap.clientId ? (((await db.doc(`${T}/clients/${ap.clientId}`).get()).data() as any) || {}) : {};
  const email = String(cl.email || ap.clientEmail || '').trim(), phone = String(cl.phone || ap.clientPhone || '').trim();
  const o: CancelOutcome = { who: ['client', 'no_show', 'studio'].includes(b.outcome?.who) ? b.outcome.who : 'client',
    feeDollars: Number(b.outcome?.feeDollars) || 0, depositAppliedDollars: Number(b.outcome?.depositAppliedDollars) || 0,
    collected: b.outcome?.collected, cardLast4: b.outcome?.cardLast4 || null, deposit: b.outcome?.deposit || null, goodwillDollars: Number(b.outcome?.goodwillDollars) || 0 };
  const base = linkOrigin(tenant, req.nextUrl.origin);
  const sent = await sendCancellationNotice(db, tenantId, appointmentId, o, base, ap);
  const told = { email: sent.email, sms: sent.sms };
  await logAuditAdmin(db, tenantId, { action: 'client.told_cancellation', targetType: 'appointment', targetId: appointmentId,
    summary: `${ap.clientName || 'Client'} told: ${cancellationOutcomeLines(o).join(' ') || 'cancelled'}${told.email || told.sms ? ` (${[told.email && 'email', told.sms && 'text'].filter(Boolean).join(' + ')})` : ' (no contact on file)'}`,
    actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role, via: 'front desk' } }).catch(() => {});
  return NextResponse.json({ ok: true, told });
}
