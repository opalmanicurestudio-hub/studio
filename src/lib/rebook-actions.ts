// src/lib/rebook-actions.ts — BOOK THE NEXT VISIT: the actions, shared by the client screen (iPad) and the client's
// visit link. Stateless: every call re-works out the plan from the visit it came from, so nobody can book a different
// service, provider or deposit than the business's rules allow. Booking goes through the booking engine (same rules,
// same double-booking guard); deposits through the desk-deposit route (recorded exactly like online).
import { engineFor, returnPlanOf, usualOf, suggestSlots, openTimesOn } from '@/lib/rebook';
import { rebookSettingsOf } from '@/lib/client-screen';
import { resolveBookingPlan, resolveRebookDeposit } from '@/lib/deposit-policy';

export interface RebookCtx { tenantId: string; clientId: string; serviceId: string; staffId?: string | null; addOnIds?: string[]; appointmentId?: string | null }
export type Internal = (path: string, body: any) => Promise<any>;
const CLOSED = ['cancelled', 'canceled', 'no_show', 'declined', 'expired'];

/** Everything the rebook screens need: already booked? — else the plan, the best times, the deposit and its choices. */
export async function rebookStart(db: any, ctx: RebookCtx, via: 'client_screen' | 'visit_link' = 'client_screen') {
  const T = `tenants/${ctx.tenantId}`; const t: any = ((await db.doc(T).get()).data() as any) || {}; const rs = rebookSettingsOf(t);
  const e = await engineFor(db, ctx.tenantId); if (!e) return { ok: false, error: 'Unknown business.' };
  const client: any = ((await db.doc(`${T}/clients/${ctx.clientId}`).get()).data() as any) || null; if (!client) return { ok: false, error: 'We couldn’t find your details.' };
  const past = (await db.collection(`${T}/appointments`).where('clientId', '==', ctx.clientId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const staffName = (id: string) => String(e.staff.find((m: any) => m.id === id)?.name || '').split(' ')[0];
  const upcoming = past.filter((a: any) => Date.parse(a.startTime) > Date.now() && !CLOSED.includes(a.status) && a.id !== ctx.appointmentId).sort((a: any, b: any) => String(a.startTime).localeCompare(String(b.startTime)))[0];
  if (upcoming) {
    const when = new Date(upcoming.startTime).toLocaleString('en-US', { timeZone: e.tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return { ok: true, rebook: { stage: 'already', label: `${when}${upcoming.staffId ? ` with ${staffName(upcoming.staffId)}` : ''}`, serviceName: upcoming.serviceName || e.services.find((x: any) => x.id === upcoming.serviceId)?.name || '', checkInToken: upcoming.checkInToken || null } };
  }
  const svcToday = e.services.find((x: any) => x.id === ctx.serviceId); if (!svcToday) return { ok: false, error: 'That service isn’t offered any more.' };
  const plan = returnPlanOf(svcToday, e.services, rs.quickWeeks);
  const usual = usualOf(past.filter((a: any) => a.status === 'completed' && a.startTime).map((a: any) => a.startTime).sort(), e.tz);
  const addOnIds = (Array.isArray(ctx.addOnIds) ? ctx.addOnIds : []).filter((id: string) => e.services.some((x: any) => x.id === id)).slice(0, 6);
  const staffId: string | null = ctx.staffId && e.staff.some((m: any) => m.id === ctx.staffId) ? ctx.staffId : null;
  let slots = suggestSlots(e, { serviceId: plan.serviceId, staffId, addOnIds, fromWeeks: plan.minWeeks, toWeeks: plan.maxWeeks, usual, count: rs.suggestCount });
  let others = false;
  if (!slots.length && rs.otherProviders) { slots = suggestSlots(e, { serviceId: plan.serviceId, staffId: null, addOnIds, fromWeeks: plan.minWeeks, toWeeks: plan.maxWeeks, usual, count: rs.suggestCount }); others = slots.length > 0; }
  const target = e.services.find((x: any) => x.id === plan.serviceId) || svcToday;
  const bp = resolveBookingPlan({ tenant: t, service: target, price: Number(target?.price) || 0, client, byStaff: true } as any);
  const depositCents = resolveRebookDeposit(t).mode === 'never' ? 0 : Math.max(0, Number(bp.depositCents) || 0);
  const card = client.cardOnFile?.paymentMethodId ? `${String(client.cardOnFile.brand || 'Card').replace(/^./, (c: string) => c.toUpperCase())} ending ${client.cardOnFile.last4 || '••••'}` : null;
  return { ok: true, rebook: {
    stage: 'choose', via, serviceId: plan.serviceId, serviceName: plan.serviceName, why: plan.why, staffId, staffName: staffId ? staffName(staffId) : null, addOnIds,
    addOnNames: addOnIds.map((id: string) => e.services.find((x: any) => x.id === id)?.name).filter(Boolean), suggestions: slots, others, weeks: rs.quickWeeks, window: { min: plan.minWeeks, max: plan.maxWeeks },
    depositCents, card, choices: { cardHold: rs.cardMode !== 'charge' && !!card, cardCharge: rs.cardMode === 'charge' && !!card, payNow: rs.payNow, later: rs.payLater },
    prebookPct: rs.prebookPct, standing: rs.standing ? { every: plan.minWeeks, count: rs.standingCount } : null, waitlist: rs.waitlist,
    policy: String(t.bookingPolicyText || t.cancellationPolicyText || '').slice(0, 400) || null, tz: e.tz } };
}

/** Real open times on a day, for the plan's service and provider (or anyone qualified). */
export async function rebookDay(db: any, tenantId: string, rb: any, date: string, anyone = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { ok: false, error: 'Pick a day.' };
  const e = await engineFor(db, tenantId); if (!e) return { ok: false, error: 'Unknown business.' };
  return { ok: true, date, times: openTimesOn(e, { date, serviceId: rb.serviceId, staffId: anyone ? null : rb.staffId || null, addOnIds: rb.addOnIds || [] }).slice(0, 30) };
}

/** Book it — through the booking engine — then settle the deposit their way. `rb` is the plan from rebookStart. */
export async function rebookBook(db: any, ctx: RebookCtx, rb: any, pick: { startIso: string; staffId?: string | null; deposit?: string | null; standing?: boolean }, internal: Internal, origin: string) {
  if (rb?.stage !== 'choose') return { ok: false, error: 'This booking is already done.', status: 409 };
  const when = Date.parse(String(pick.startIso || ''));
  if (!Number.isFinite(when) || when < Date.now() + 30 * 60000) return { ok: false, error: 'Pick a time.', status: 400 };
  const T = `tenants/${ctx.tenantId}`; const t: any = ((await db.doc(T).get()).data() as any) || {}; const rs = rebookSettingsOf(t);
  const dep = Number(rb.depositCents) || 0; const choice = String(pick.deposit || (dep > 0 ? '' : 'none'));
  const allowed = dep === 0 ? ['none'] : [rb.choices?.cardHold && 'card_hold', rb.choices?.cardCharge && 'card_charge', rb.choices?.payNow && 'pay_now', rb.choices?.later && 'later'].filter(Boolean);
  if (!allowed.includes(choice)) return { ok: false, error: 'Choose how to settle the deposit.', status: 400 };
  const staffId = String(pick.staffId || rb.staffId || 'any');
  const note = rb.via === 'visit_link' ? 'Booked from their visit link' : 'Booked on the client screen';
  const body: any = { tenantId: ctx.tenantId, source: 'front_desk', serviceId: rb.serviceId, addOnIds: rb.addOnIds || [], staffId, startTime: new Date(when).toISOString(), client: { id: ctx.clientId }, notes: note,
    ...(dep > 0 ? { holdOnly: true } : { depositCovered: true, depositCoveredBy: 'rebook_rule' }),
    ...(choice === 'card_hold' ? { depositScheduledAt: new Date(Math.max(Date.now() + 3600000, when - 48 * 3600000)).toISOString() } : {}) };
  const booked: any = await internal('/api/appointments/book', body);
  if (!booked?.ok) return { ok: false, error: booked?.error || 'That time was just taken — pick another.', status: 409 };
  // Remember where it came from (the rebooking report) and any pre-book reward (applied at that visit's checkout).
  await db.doc(`${T}/appointments/${booked.appointmentId}`).set({ rebookedFrom: ctx.appointmentId || null, rebookVia: rb.via || 'client_screen', ...(rs.prebookPct > 0 ? { prebookRewardPct: rs.prebookPct } : {}) }, { merge: true }).catch(() => {});
  if (ctx.appointmentId) await db.doc(`${T}/appointments/${ctx.appointmentId}`).set({ rebookedAs: booked.appointmentId, rebookedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
  let payUrl: string | null = null; let depositNote = dep > 0 ? '' : 'No deposit needed.';
  if (dep > 0 && choice === 'card_hold') depositNote = `Your ${rb.card} is on file — the $${(dep / 100).toFixed(2)} deposit is taken before your visit.`;
  if (dep > 0 && choice === 'card_charge') { const c: any = await internal('/api/appointments/desk-deposit', { tenantId: ctx.tenantId, action: 'charge', appointmentId: booked.appointmentId });
    depositNote = c?.ok ? `$${(dep / 100).toFixed(2)} deposit paid with your ${rb.card}.` : 'We’re holding your time — we’ll sort the deposit with you.'; }
  if (dep > 0 && (choice === 'pay_now' || choice === 'later')) { await internal('/api/appointments/desk-deposit', { tenantId: ctx.tenantId, action: 'link', appointmentId: booked.appointmentId });
    payUrl = booked.checkInToken ? `${origin}/check-in/${booked.checkInToken}` : null;
    depositNote = choice === 'later' ? `We’ve sent you a link to pay the $${(dep / 100).toFixed(2)} deposit — your time is held until then.` : rb.via === 'visit_link' ? `Pay the $${(dep / 100).toFixed(2)} deposit to confirm.` : `Scan to pay the $${(dep / 100).toFixed(2)} deposit on your phone.`; }
  // A standing appointment: the same day and time every few weeks (the first booking holds the deposit).
  const tz = rb.tz || 'UTC'; const standingBooked: string[] = [];
  if (pick.standing === true && rb.standing) {
    const seriesId = `rb-${booked.appointmentId}`;
    for (let i = 1; i < Number(rb.standing.count || 3); i++) {
      const next = new Date(when + i * Number(rb.standing.every || 3) * 7 * 864e5).toISOString();
      const r2: any = await internal('/api/appointments/book', { ...body, startTime: next, holdOnly: dep > 0, depositScheduledAt: undefined, depositCovered: true, depositCoveredBy: 'series', seriesId, seriesIndex: i, staffId: booked.staffId || staffId });
      if (r2?.ok) { standingBooked.push(new Date(next).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }));
        await db.doc(`${T}/appointments/${r2.appointmentId}`).set({ rebookedFrom: ctx.appointmentId || null, rebookVia: rb.via || 'client_screen' }, { merge: true }).catch(() => {}); }
    }
  }
  const label = new Date(booked.startTime || pick.startIso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return { ok: true, rebook: { ...rb, stage: payUrl && choice === 'pay_now' ? 'pay' : 'done', appointmentId: booked.appointmentId, label, staffName: String(booked.staffName || '').split(' ')[0] || rb.staffName, depositNote, payUrl, standingBooked, prebook: rs.prebookPct } };
}

/** Nothing fits → the provider's waitlist (the business's real waitlist, same as the booking page). */
export async function rebookWaitlist(db: any, ctx: RebookCtx, rb: any, note: string, post: (path: string, body: any) => Promise<any>) {
  const client: any = ((await db.doc(`tenants/${ctx.tenantId}/clients/${ctx.clientId}`).get()).data() as any) || {};
  const r: any = await post('/api/waitlist', { tenantId: ctx.tenantId, action: 'join', name: client.name || 'Client', phone: client.phone || '', email: client.email || '', serviceId: rb.serviceId,
    note: `From ${rb.via === 'visit_link' ? 'their visit link' : 'the client screen'}: wants ${rb.staffName ? `${rb.staffName}, ` : ''}${String(note || '').slice(0, 120) || `in ${rb.window?.min}–${rb.window?.max} weeks`}`, source: rb.via || 'client_screen' });
  return r?.ok ? { ok: true } : { ok: false, error: r?.error || 'Couldn’t add you to the waitlist.' };
}
