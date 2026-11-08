// src/app/api/appointments/release-hold/route.ts — A CLIENT LETS GO OF A TIME THEY WERE ABOUT TO PAY FOR.
// When someone books online and a deposit is due, the booking holds the time while they pay. If they step back from
// paying to change something (another time, an add-on, their details), or close the sheet, the time they were holding
// is let go right away, exactly as it would be once the hold ran out (lib/release-unpaid): so they can book the new
// choice, it doesn't count against how many upcoming bookings they may have, and nobody else is kept from that time.
// Only their own hold: the link token from the booking itself, an online booking still waiting on its deposit, never
// one that has been paid (or is being paid on the card reader), never a request the business accepted, and only within
// a few hours of it being made. Before anything changes, every payment form opened for it is closed with Stripe; if one
// has been paid (or is being paid), the booking is left alone and the answer says it's paid. No message goes out: they
// never had the booking.
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { logAuditAdmin } from '@/lib/audit';
import { closePayments } from '@/lib/deposit-sessions';
export const dynamic = 'force-dynamic';

const ONLINE = new Set(['booking-page', 'client-portal']);
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
/** Still a hold this client may let go of: theirs, online, unpaid, never a request the business accepted, recent. */
const releasable = (a: any) => { const made = Date.parse(a?.createdAt || '');
  return a?.status === 'pending_payment' && a.depositStatus !== 'paid' && !a.depositReaderPi?.id && !a.paymentDueAt && !a.decidedAt && !a.originallyRequestedAt
    && ONLINE.has(String(a.source || '')) && Number.isFinite(made) && Date.now() - made < 3 * 3600000; };

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 80), appointmentId = String(b.appointmentId || '').slice(0, 120), k = String(b.k || '').slice(0, 200);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,120}$/.test(appointmentId) || !k) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const limited = await limitPublic(req, 'release-hold', tenantId, { perHour: 60, perDay: 3000 }); if (limited) return limited;
  try {
    const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}/appointments/${appointmentId}`);
    const first: any = (await ref.get()).data();
    if (!first || !first.checkInToken || !same(String(first.checkInToken), k)) return NextResponse.json({ ok: false, error: 'That booking wasn’t found.' }, { status: 404 });
    if (first.status === 'cancelled') return NextResponse.json({ ok: true, already: true });
    if (first.depositStatus === 'paid' || first.status === 'confirmed') return NextResponse.json({ ok: false, paid: true, error: 'This booking is paid.' }, { status: 409 });
    if (!releasable(first)) return NextResponse.json({ ok: false, code: 'not_releasable', error: 'This booking can’t be let go from here.' }, { status: 409 });
    // Close every payment form noted on it; if another was opened meanwhile (the client tapped pay again), close that too.
    let closed: string[] = [];
    let out: any = null;
    for (let round = 0; round < 3 && !out; round++) {
      const now: any = round ? (await ref.get()).data() || {} : first;
      const all: string[] = Array.isArray(now.depositSessions) ? now.depositSessions.map(String) : [];
      const fresh = all.filter((x) => !closed.includes(x));
      const pay = await closePayments(fresh);
      if (pay === 'paid') return NextResponse.json({ ok: false, paid: true, error: 'This booking is paid.' }, { status: 409 });
      if (pay === 'unknown') return NextResponse.json({ ok: false, error: 'That didn’t go through. The time will be let go on its own shortly.' }, { status: 503 });
      closed = [...closed, ...fresh];
      // Every payment form is closed now, so nothing can be paid for it from here on: let it go, checking once more
      // that no new form was opened since.
      out = await db.runTransaction(async (tx: any) => {
        const a: any = (await tx.get(ref)).data();
        if (!a || a.status === 'cancelled') return { ok: true, already: true };
        if (a.depositStatus === 'paid' || a.status === 'confirmed') return { ok: false, paid: true };
        if (!releasable(a)) return { ok: false };
        if ((Array.isArray(a.depositSessions) ? a.depositSessions.map(String) : []).some((x: string) => !closed.includes(x))) return null;   // another round
        const nowIso = new Date().toISOString();
        tx.set(ref, { status: 'cancelled', cancellationReason: 'changed_before_paying', cancelledAt: nowIso, releasedAt: nowIso, cancelledBy: 'client' }, { merge: true });
        tx.set(db.doc(`appointmentCheckIns/${a.checkInToken}`), { status: 'cancelled' }, { merge: true });
        return { ok: true, clientName: a.clientName || null };
      });
    }
    if (!out) return NextResponse.json({ ok: false, error: 'That didn’t go through. The time will be let go on its own shortly.' }, { status: 503 });
    if (out.ok && !(out as any).already) await logAuditAdmin(db, tenantId, { action: 'appointment.released_by_client', targetType: 'appointment', targetId: appointmentId,
      summary: `${(out as any).clientName || 'A client'} changed their booking before paying the deposit, so the time they were holding was let go`, actor: { type: 'user', name: (out as any).clientName || null, role: 'client', via: 'booking' } } as any).catch(() => {});
    if (out.ok) return NextResponse.json({ ok: true, ...((out as any).already ? { already: true } : {}) });
    return NextResponse.json((out as any).paid ? { ok: false, paid: true, error: 'This booking is paid.' } : { ok: false, code: 'not_releasable', error: 'This booking can’t be let go from here.' }, { status: 409 });
  } catch (e: any) {
    console.error('[release-hold]', e?.message || e);
    return NextResponse.json({ ok: false, error: 'That didn’t go through. The time will be let go on its own shortly.' }, { status: 500 });
  }
}
