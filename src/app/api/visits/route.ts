// src/app/api/visits/route.ts — THE VISIT TICKET (staff). One record, every business.
//   stage { tenantId, appointmentId, to, note? } — move a visit on (only allowed moves; completing goes through checkout,
//          cancelling / no-show keep their own flows with fees and messages). Written with who and when on the timeline,
//          the legacy status fields kept in step, and the client's copies updated.
//   note  { tenantId, appointmentId, text, forClient? } — a handoff note ("prefers a softer file"), staff-only unless forClient
//   get   { tenantId, appointmentId } — the whole ticket: stage, flags, payment status, timeline, receipts, signed approvals
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { stageOf, flagsOf, paymentStatusOf, stageLabel, canMove, stageWrite, MAX_TIMELINE, PAYMENT_LABEL, type Stage } from '@/lib/visit';
import { syncVisitCopies } from '@/lib/visit-sync';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || '');
  const auth: any = await verifyStaffActor(req, tenantId); if (!auth.ok) return bad(auth.error || 'Sign in to do that.', auth.status || 401);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  if (action === 'my-times') {   // "My times": the provider's typical time per service, vs booked; students also see the team's typical
    const { staffIdForLogin } = await import('@/lib/owner-staff');
    const sid = await staffIdForLogin(db, tenantId, auth.actor.uid).catch(() => null); if (!sid) return NextResponse.json({ ok: true, rows: [] });
    const st: any = (await db.doc(`${T}/staff/${sid}`).get()).data() || {}; if (st.role === 'renter' || st.isRenter) return NextResponse.json({ ok: true, rows: [] });
    const mine = (await db.collection(`${T}/timingStats`).where('staffId', '==', sid).get()).docs.map((d: any) => d.data() || {}).filter((x: any) => Number(x.count) >= 5);
    const teamDocs = mine.length ? await Promise.all(mine.map((x: any) => db.doc(`${T}/timingStats/all__${String(x.serviceKey).replace(/[\/]/g, '_').slice(0, 400)}`).get())) : [];
    const names = new Map<string, string>((await db.collection(`${T}/services`).get()).docs.map((d: any) => [d.id, String((d.data() || {}).name || 'Service')]));
    const rows = mine.map((x: any, i: number) => { const team: any = teamDocs[i]?.exists ? teamDocs[i].data() : null; const parts = String(x.serviceKey).split('+');
      return { service: parts.map((id) => names.get(id) || 'Service').join(' + '), count: x.count, typical: x.typicalMinutes, low: x.rangeLow, high: x.rangeHigh, booked: x.bookedMinutes, onTime: x.onTimeRate,
        trend: x.recentTypical !== null && x.earlierTypical !== null ? x.recentTypical - x.earlierTypical : null, team: st.isStudent && team && Number(team.count) >= 5 ? team.typicalMinutes : null }; })
      .sort((a: any, b: any) => b.count - a.count);
    return NextResponse.json({ ok: true, rows, isStudent: !!st.isStudent });
  }
  if (action === 'my-overruns') {   // the provider's own visits today that ran over and still need a "why"
    const { staffIdForLogin } = await import('@/lib/owner-staff'); const { visitTiming } = await import('@/lib/timing');
    const sid = await staffIdForLogin(db, tenantId, auth.actor.uid).catch(() => null); if (!sid) return NextResponse.json({ ok: true, visits: [] });
    const t: any = (await db.doc(T).get()).data() || {}; const since = Date.now() - 36 * 3600000;
    const appts = (await db.collection(`${T}/appointments`).where('staffId', '==', sid).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((a: any) => Date.parse(a.startTime || '') >= since && !a.overReason);
    const ids = [...new Set(appts.flatMap((a: any) => [a.serviceId, ...(a.addOnIds || [])]).filter(Boolean).map(String))];
    const svcs = (await Promise.all(ids.map((x) => db.doc(`${T}/services/${x}`).get()))).filter((d: any) => d.exists).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const visits = appts.map((a: any) => ({ a, tm: visitTiming(a, svcs, t) })).filter((x: any) => x.tm.needsReason)
      .map(({ a, tm }: any) => ({ id: a.id, client: String(a.clientName || 'Client').split(' ')[0], service: a.serviceName || svcs.find((x: any) => x.id === a.serviceId)?.name || 'Service', overPastGrace: tm.overPastGrace, actualMinutes: tm.actualMinutes, bookedMinutes: tm.bookedMinutes }));
    return NextResponse.json({ ok: true, visits });
  }
  const id = String(b.appointmentId || ''); const ref = db.doc(`${T}/appointments/${id}`); const a: any = (await ref.get()).data();
  if (!a) return bad('That visit wasn’t found.', 404);
  const t: any = ((await db.doc(T).get()).data() as any) || {};
  const now = new Date().toISOString(); const by = auth.actor.name || 'Staff';
  const timeline = Array.isArray(a.timeline) ? a.timeline : [];

  if (action === 'stage') {
    const from = stageOf(a); const to = String(b.to || '') as Stage;
    if (from === to) return NextResponse.json({ ok: true, stage: to, already: true });
    if (to === 'complete') return bad('Visits are completed at checkout — take payment there.', 409);
    if (['cancelled', 'no_show'].includes(to)) return bad('Use Cancel / No-show on the visit — they handle fees, deposits and messages.', 409);
    if (!canMove(from, to)) return bad(`A visit that’s “${stageLabel(from, a, t)}” can’t go straight to “${stageLabel(to, a, t)}”.`, 409);
    const entry = { at: now, kind: 'stage', stage: to, text: `${stageLabel(to, a, t)}${b.note ? ` — ${String(b.note).slice(0, 140)}` : ''}`, by, via: String(b.via || 'desk').slice(0, 30) };
    const upd: any = { ...stageWrite(to), timeline: [...timeline, entry].slice(-MAX_TIMELINE), updatedAt: now,
      ...(to === 'arrived' ? { arrivedAt: a.arrivedAt || now } : {}), ...(to === 'in_service' ? { serviceStartedAt: a.serviceStartedAt || now } : {}), ...(to === 'ready_to_pay' ? { serviceEndedAt: now } : {}) };
    await ref.set(upd, { merge: true });
    await syncVisitCopies(db, tenantId, { ...a, ...upd }, t);
    return NextResponse.json({ ok: true, stage: to, label: stageLabel(to, a, t) });
  }
  if (action === 'log') {   // the desk already changed the visit (start service, ready to pay…) — record it on the timeline
    const st = stageOf(a); const text = String(b.text || '').slice(0, 200);
    const entry: any = b.stage ? { at: now, kind: 'stage', stage: st, text: `${stageLabel(st, a, t)}${text ? ` — ${text}` : ''}`, by, via: String(b.via || 'desk').slice(0, 30) } : { at: now, kind: 'change', text: text || 'Updated', by, via: String(b.via || 'desk').slice(0, 30) };
    const lastStage = [...timeline].reverse().find((e: any) => e.kind === 'stage');   // compare with the last STAGE line (notes may come after it)
    if (b.stage && lastStage?.stage === st) return NextResponse.json({ ok: true, already: true });   // no duplicate lines
    const upd = { stage: st, timeline: [...timeline, entry].slice(-MAX_TIMELINE), updatedAt: now };
    await ref.set(upd, { merge: true }); await syncVisitCopies(db, tenantId, { ...a, ...upd }, t);
    return NextResponse.json({ ok: true, entry });
  }
  if (action === 'over-reason') {   // "Why did it run over?" — answered by the provider (or the desk) after the visit
    const { OVER_REASONS } = await import('@/lib/timing'); const r = OVER_REASONS.find((x) => x.code === String(b.code || ''));
    if (!r) return bad('Pick a reason.', 400);
    const overReason = { code: r.code, label: r.label, clientCaused: r.clientCaused, note: String(b.note || '').trim().slice(0, 200) || null, by, at: now };
    await ref.set({ overReason, timeline: [...timeline, { at: now, kind: 'note', text: `Ran over — ${r.label.toLowerCase()}${overReason.note ? `: ${overReason.note}` : ''}`, by, via: String(b.via || 'desk').slice(0, 30) }].slice(-MAX_TIMELINE), updatedAt: now }, { merge: true });
    return NextResponse.json({ ok: true, overReason });
  }
  if (action === 'note') {
    const text = String(b.text || '').trim().slice(0, 300); if (!text) return bad('Write the note first.');
    const entry = { at: now, kind: 'note', text, by, forClient: b.forClient === true };
    const upd = { timeline: [...timeline, entry].slice(-MAX_TIMELINE), updatedAt: now };
    await ref.set(upd, { merge: true });
    if (entry.forClient) await syncVisitCopies(db, tenantId, { ...a, ...upd }, t);
    return NextResponse.json({ ok: true, entry });
  }
  if (action === 'get') {
    { const { missingStageEntry } = await import('@/lib/visit'); const miss = missingStageEntry(a, t);   // self-repair: a step an older screen didn't log
      if (miss) { a.timeline = [...(Array.isArray(a.timeline) ? a.timeline : []), miss].slice(-60); await db.doc(`${T}/appointments/${id}`).set({ timeline: a.timeline }, { merge: true }).catch(() => {}); } }
    const [receipts, consents] = await Promise.all([
      a.checkoutSessionId ? db.collection(`${T}/receipts`).where('checkoutSessionId', '==', a.checkoutSessionId).get().then((s: any) => s.docs.map((d: any) => ({ id: d.id, total: d.data().total, date: d.data().date, voided: !!d.data().voided, payments: d.data().payments || null, paymentMethod: d.data().paymentMethod })))
        : Promise.resolve([]),
      a.clientId ? db.collection(`${T}/chargeConsents`).where('clientId', '==', a.clientId).get().then((s: any) => s.docs.map((d: any) => ({ id: d.id, kind: d.data().kind, signedAt: d.data().signedAt, title: d.data().title || null, amount: d.data().amount || null }))).catch(() => [])
        : Promise.resolve([]),
    ]);
    const stage = stageOf(a); const pay = paymentStatusOf(a);
    const cl: any = a.clientId ? (((await db.doc(`${T}/clients/${a.clientId}`).get()).data() as any) || {}) : {};
    const st: any = a.staffId ? (((await db.doc(`${T}/staff/${a.staffId}`).get()).data() as any) || {}) : {};
    const svcName = a.serviceName || (a.serviceId ? (((await db.doc(`${T}/services/${a.serviceId}`).get()).data() as any)?.name || null) : null);
    // How long it really took vs booked, and whether "why did it run over?" still needs an answer.
    let timing: any = null;
    try { const { visitTiming } = await import('@/lib/timing'); const ids = [a.serviceId, ...(Array.isArray(a.addOnIds) ? a.addOnIds : [])].filter(Boolean).map(String);
      const svcs = (await Promise.all(ids.map((sid: string) => db.doc(`${T}/services/${sid}`).get()))).filter((d: any) => d.exists).map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      timing = visitTiming(a, svcs, t); } catch { timing = null; }
    return NextResponse.json({ ok: true, timing, visit: { id, clientId: a.clientId || null, clientName: a.clientName || cl.name || null, clientPhone: cl.phone || null, staffName: a.staffName || st.name || null, addOnNames: [], isWalkIn: !!a.isWalkIn, partySize: a.partySize || null, notes: a.notes || null,
      status: a.status || null, checkInStatus: a.checkInStatus || null, addOnIds: a.addOnIds || [], depositAmountCents: a.depositAmountCents || null, depositStatus: a.depositStatus || null,
      studio: { name: t.name || t.businessName || '', phone: t.phone || null, address: t.address || null, logoUrl: t.logoUrl || t.bookingPageSettings?.cfPageConfig?.logoUrl || null, accent: t.bookingPageSettings?.cfPageConfig?.accentColor || t.brandColor || null }, serviceId: a.serviceId || null, serviceName: svcName, staffId: a.staffId || null,
      startTime: a.startTime || null, endTime: a.endTime || null, shortCode: a.shortCode || null, checkInToken: a.checkInToken || null,
      stage, stageLabel: stageLabel(stage, a, t), flags: flagsOf(a), paymentStatus: pay, paymentLabel: PAYMENT_LABEL[pay], timeline: (Array.isArray(a.timeline) ? a.timeline : timeline).slice(-MAX_TIMELINE), receipts, consents: consents.slice(-10),
      next: (['arrived', 'waiting', 'in_service', 'ready_to_pay', 'booked'] as Stage[]).filter((s) => canMove(stage, s)).map((s) => ({ stage: s, label: stageLabel(s, a, t) })) } });
  }
  return bad('Unknown action.');
}
