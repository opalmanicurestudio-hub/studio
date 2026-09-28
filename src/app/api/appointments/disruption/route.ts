// src/app/api/appointments/disruption/route.ts — PROVIDER CALLOUTS + BUSINESS INTERRUPTIONS.
//   preview — who's affected (studio + renter bookings), what it's worth, deposits held
//   notify  — record it, give each studio client their choices (their visit link
//             shows them too), tell each renter about THEIR bookings (their clients)
//   resolve — staff record an outcome by hand (kept / moved room / reassigned …)
// Callouts: the provider themself or a manager. Interruptions: a manager.
// Every appointment's outcome is kept ON the disruption (callout record, or the
// interruption record on /maintenance — linked to its maintenance tickets) for
// the insurance packet and renter reimbursements. No private details are stored.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';
import { opsCan, opsLevelOf, paymentOutstanding } from '@/lib/appointment-ops';
import { disruptionMessage, disruptionReason, disruptionTotals, CALLOUT_REASON_LABEL, type AffectedEntry, type CalloutReason } from '@/lib/disruptions';

export const dynamic = 'force-dynamic';
const ACTIVE = ['confirmed', 'pending_payment', 'deposit_pending', 'waiting', 'checked_in', 'requested'];

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), action = String(b.action || ''), kind = b.kind === 'interruption' ? 'interruption' : 'callout';
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const role = String(auth.actor.role || '').toLowerCase(); const isMgr = ['owner', 'admin', 'manager'].includes(role);
  const actor = { type: 'user' as const, id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role };

  // ── resolve one appointment by hand ──
  if (action === 'resolve') {
    const coll = kind === 'callout' ? 'providerCallouts' : 'interruptions';
    const ref = db.doc(`${T}/${coll}/${String(b.disruptionId || '')}`); const rec: any = (await ref.get()).data();
    const apptId = String(b.appointmentId || ''); const outcome = String(b.outcome || '');
    if (!rec || !rec.affected?.[apptId]) return NextResponse.json({ ok: false, error: 'Not part of this disruption.' }, { status: 404 });
    if (!['kept', 'moved_room', 'reassigned', 'rescheduled', 'cancelled'].includes(outcome)) return NextResponse.json({ ok: false, error: 'Unknown outcome.' }, { status: 400 });
    const nowIso = new Date().toISOString();
    await ref.set({ affected: { [apptId]: { outcome, outcomeAt: nowIso, by: auth.actor.name, note: String(b.note || '').slice(0, 200) || null } } }, { merge: true });
    await db.doc(`${T}/appointments/${apptId}`).set({ disruption: { status: 'resolved', outcome } }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'disruption.resolved', targetType: 'appointment', targetId: apptId, summary: `${kind === 'callout' ? 'Callout' : 'Interruption'}: recorded as ${outcome.replace('_', ' ')}${b.note ? ` — ${String(b.note).slice(0, 120)}` : ''}`, actor }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // ── the window + who's affected ──
  let fromMs: number, toMs: number, staffId: string | null = null, interruption: any = null, staff: any = null;
  if (kind === 'callout') {
    staffId = String(b.staffId || '');
    if (!staffId) return NextResponse.json({ ok: false, error: 'Who is out?' }, { status: 400 });
    if (!opsCan(auth.actor.role, opsLevelOf(tenant), staffId === auth.actor.uid, 'provider_late')) return NextResponse.json({ ok: false, error: 'Only the provider or a manager can report a callout.' }, { status: 403 });
    staff = ((await db.doc(`${T}/staff/${staffId}`).get()).data() as any) || {};
    fromMs = Date.parse(b.from || new Date().toISOString()); toMs = Date.parse(b.to || '');
    if (!Number.isFinite(toMs)) { const e = new Date(fromMs); e.setHours(23, 59, 59, 999); toMs = e.getTime(); }
  } else {
    if (!isMgr) return NextResponse.json({ ok: false, error: 'A manager handles business interruptions.' }, { status: 403 });
    const iRef = db.doc(`${T}/interruptions/${String(b.interruptionId || '')}`); interruption = (await iRef.get()).data();
    if (!interruption) return NextResponse.json({ ok: false, error: 'That interruption wasn’t found.' }, { status: 404 });
    fromMs = Date.parse(b.from || `${interruption.startDate}T00:00:00`); fromMs = Math.max(fromMs, Date.now() - 3600000);
    toMs = Date.parse(b.to || (interruption.endDate ? `${interruption.endDate}T23:59:59` : new Date(Date.now() + 7 * 864e5).toISOString()));
  }
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return NextResponse.json({ ok: false, error: 'Check the dates.' }, { status: 400 });

  const q = kind === 'callout' ? await db.collection(`${T}/appointments`).where('staffId', '==', staffId).get() : await db.collection(`${T}/appointments`).get();
  let appts = q.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((a: any) => { const s = Date.parse(a.startTime); return Number.isFinite(s) && s >= fromMs && s <= toMs && ACTIVE.includes(String(a.status || '')); });
  if (kind === 'interruption' && (interruption.affectedBoothIds || []).length) {     // only the spaces it took out
    const leases = (await db.collection(`${T}/leases`).get()).docs.map((d: any) => d.data() as any);
    const staffDocs = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
    const boothOf = new Map<string, string | null>();
    for (const l of leases) if (['active', 'on_leave'].includes(String(l.status)) && l.renterId) { const st = staffDocs.find((x: any) => x.renterId === l.renterId); if (st) boothOf.set(st.id, l.boothId || null); }
    appts = appts.filter((a: any) => (interruption.affectedBoothIds || []).includes(a.boothId || boothOf.get(String(a.staffId)) || '__none__'));
  }
  const svcCache = new Map<string, any>();
  const svc = async (id?: string) => { if (!id) return null; if (!svcCache.has(id)) svcCache.set(id, ((await db.doc(`${T}/services/${id}`).get()).data() as any) || null); return svcCache.get(id); };
  const entries: AffectedEntry[] = [];
  for (const a of appts.sort((x: any, y: any) => Date.parse(x.startTime) - Date.parse(y.startTime))) {
    const s = await svc(a.serviceId);
    entries.push({ appointmentId: a.id, clientName: a.clientName || null, clientId: a.clientId || null, startTime: a.startTime, serviceName: a.serviceName || s?.name || null,
      staffId: a.staffId || null, renterId: a.renterId || null, isRenterBooking: !!a.isRenterBooking,
      valueCents: Math.round((Number(a.price ?? a.totalPrice ?? s?.price) || 0) * 100), depositCents: a.depositStatus === 'paid' || !paymentOutstanding(a) ? Number(a.depositAmountCents) || 0 : 0,
      notifiedAt: null, outcome: 'pending' });
  }
  const hoursLost = kind === 'callout' ? Math.round(appts.reduce((m: number, a: any) => m + Math.max(0, Date.parse(a.endTime || a.startTime) - Date.parse(a.startTime)), 0) / 360000) / 10 : 0;
  if (action === 'preview') return NextResponse.json({ ok: true, affected: entries, totals: disruptionTotals(entries), hoursLost });
  if (action !== 'notify') return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });

  // ── record + tell ──
  const nowIso = new Date().toISOString();
  const reason: CalloutReason = (['illness', 'transport', 'family', 'other'].includes(b.reason) ? b.reason : 'other') as CalloutReason;
  let ref: any; let id: string;
  if (kind === 'callout') { ref = db.collection(`${T}/providerCallouts`).doc(); id = ref.id;
    await ref.set({ id, tenantId, staffId, staffName: staff.name || null, reason, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), reportedBy: auth.actor.name, reportedById: auth.actor.uid, createdAt: nowIso, hoursLost, affected: {} });
  } else { ref = db.doc(`${T}/interruptions/${String(b.interruptionId)}`); id = String(b.interruptionId);
    const ticketIds = Array.isArray(b.ticketIds) ? b.ticketIds.map(String).slice(0, 20) : null;
    await ref.set({ appointmentsHandledAt: nowIso, ...(ticketIds ? { ticketIds } : {}) }, { merge: true });
    if (ticketIds) for (const tid of ticketIds) await db.doc(`${T}/tickets/${tid}`).set({ interruptionId: id }, { merge: true }).catch(() => {});
  }
  const base = linkOrigin(tenant, req.nextUrl.origin); const studio = tenant.name || tenant.businessName || 'the studio';
  const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template');
  const byRenter = new Map<string, AffectedEntry[]>(); let told = 0;
  const pFirst = staff?.name ? String(staff.name).split(' ')[0] : null;
  const cause = kind === 'callout' ? reason : interruption?.type;
  // Moved to another room/space instead — no client impact, not messaged, recorded as "moved room".
  const movedRoom = new Set<string>(Array.isArray(b.movedRoomIds) ? b.movedRoomIds.map(String) : []);
  for (const en of entries) {
    const a = appts.find((x: any) => x.id === en.appointmentId);
    if (movedRoom.has(en.appointmentId)) {
      en.outcome = 'moved_room'; en.outcomeAt = nowIso; en.by = auth.actor.name;
      await logAuditAdmin(db, tenantId, { action: 'disruption.moved_room', targetType: 'appointment', targetId: en.appointmentId, summary: `${interruption?.title || 'Interruption'}: moved to another room — no change for the client`, actor }).catch(() => {});
      continue;
    }
    const mark = { disruption: { kind, id, cause, reasonLabel: disruptionReason(kind, cause, pFirst), at: nowIso, status: 'pending' } };
    if (en.isRenterBooking && en.renterId) { (byRenter.get(en.renterId) || byRenter.set(en.renterId, []).get(en.renterId)!).push(en); en.notifiedAt = nowIso; await db.doc(`${T}/appointments/${en.appointmentId}`).set(mark, { merge: true }); continue; }
    await db.doc(`${T}/appointments/${en.appointmentId}`).set(mark, { merge: true });
    if (a?.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set(mark, { merge: true }).catch(() => {}), db.doc(`${T}/appointmentCheckIns/${a.checkInToken}`).set(mark, { merge: true }).catch(() => {})]);
    if (b.tell !== false) {
      try {
        const cl: any = a?.clientId ? (((await db.doc(`${T}/clients/${a.clientId}`).get()).data() as any) || {}) : {};
        const email = String(cl.email || a?.clientEmail || '').trim(), phone = String(cl.phone || a?.clientPhone || '').trim();
        const when = new Date(en.startTime).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined });
        const msg = disruptionMessage({ kind, cause, providerFirst: pFirst, first: String(en.clientName || '').split(' ')[0] || 'there', when: `on ${when}`, service: en.serviceName, hasDeposit: en.depositCents > 0, studio });
        const link = a?.checkInToken ? `${base}/check-in/${a.checkInToken}` : null;
        let ok = false;
        if (email.includes('@')) ok = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `About your appointment — ${studio}`, kind: 'disruption', html: brandedEmailHtml({ studioName: studio, title: 'About your appointment', bodyLines: [msg], cta: link ? { label: 'Choose', url: link } : null }), appointmentId: en.appointmentId, clientId: a?.clientId || null, clientName: en.clientName } as any))?.ok || ok;
        if (phone) ok = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'disruption', text: `${studio}: ${msg}${link ? ` ${link}` : ''}`, appointmentId: en.appointmentId, clientId: a?.clientId || null, clientName: en.clientName } as any))?.ok || ok;
        if (ok) { en.notifiedAt = nowIso; told++; }
      } catch (e) { console.error('[disruption] send failed', e); }
    }
    await logAuditAdmin(db, tenantId, { action: 'disruption.affected', targetType: 'appointment', targetId: en.appointmentId,
      summary: `${kind === 'callout' ? `Provider callout (${CALLOUT_REASON_LABEL[reason]})` : `Business interruption — ${interruption?.title || cause}`}: client ${en.notifiedAt ? 'told and asked to choose (new time or cancel, no fee)' : 'not messaged'}`, actor }).catch(() => {});
  }
  // Renters are told about THEIR bookings — their clients, their call.
  for (const [renterId, list] of Array.from(byRenter.entries())) {
    try { const { notifyRenter } = await import('@/lib/renter-comms');
      const lines = list.map((x) => `${String(x.clientName || 'Client').split(' ')[0]} — ${new Date(x.startTime).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined })}`).join('; ');
      await notifyRenter(db, tenantId, renterId, 'cancelled', `${kind === 'callout' ? 'A studio callout' : `The studio’s ${interruption?.title || 'closure'}`} affects ${list.length} of your booking${list.length === 1 ? '' : 's'}: ${lines}. Please contact these clients — your losses are being logged for reimbursement.`, { tone: 'red', tab: 'book', subject: 'Some of your bookings are affected' } as any);
    } catch (e) { console.error('[disruption] renter notify failed', e); }
  }
  await ref.set({ affected: Object.fromEntries(entries.map((e) => [e.appointmentId, e])) }, { merge: true });
  await logAuditAdmin(db, tenantId, { action: 'disruption.recorded', targetType: kind === 'callout' ? 'staff' : 'interruption', targetId: kind === 'callout' ? String(staffId) : id,
    summary: `${kind === 'callout' ? `${staff?.name || 'Provider'} called out (${CALLOUT_REASON_LABEL[reason]})` : `Interruption “${interruption?.title}”`} — ${entries.length} appointment${entries.length === 1 ? '' : 's'} affected, ${told} client${told === 1 ? '' : 's'} told, ${byRenter.size} renter${byRenter.size === 1 ? '' : 's'} told`, actor }).catch(() => {});
  return NextResponse.json({ ok: true, id, affected: entries, totals: disruptionTotals(entries), told, rentersTold: byRenter.size, hoursLost });
}
