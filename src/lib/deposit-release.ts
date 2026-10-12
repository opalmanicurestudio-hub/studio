// src/lib/deposit-release.ts — WHEN AN UNPAID DEPOSIT MAY CANCEL A VISIT. One rule for every automatic release
// (lib/release-unpaid, the retail-payments sweep, unpaid voice bookings), so none of them can cancel a visit on its own morning.
//
// What went wrong: an accepted booking whose card declined gets the shop's grace window (24 hours by default) — capped
// at the visit's start. Accepted yesterday at 8:20 → deadline today 8:20 → released at 8:27 for a 10:00 visit. The
// provider came in to a visit on the schedule that had just been cancelled: a same-day gap nobody could fill.
//
// The rule now:
//   • 48 hours out, still unpaid → the desk and the provider hear about it ONCE (time to call, take it at the desk, or
//     release it while the time can still be filled)
//   • inside the protected window (18 hours before the visit by default — Settings → Booking) the system NEVER cancels
//     by itself: the visit keeps its time (it still blocks the calendar), it's flagged "deposit unpaid", and the desk
//     decides
//   • the one exception: an online checkout someone walked away from in the last couple of hours — they never had the
//     booking, so letting it go is right
export type ReleaseCall = 'wait' | 'chase' | 'release' | 'desk';
const H = 3600e3;
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);

export function protectHoursOf(tenant: any): number {
  const v = Number(tenant?.bookingMode?.depositProtectHours); return Number.isFinite(v) && v >= 0 && v <= 72 ? v : 18;
}
export function releaseCall(a: any, now: number, tenant: any, holdMin = 30): ReleaseCall {
  if (a?.status !== 'pending_payment' || a?.depositStatus === 'paid') return 'wait';
  if (a.depositDeskHold === true) return 'wait';                                   // the desk has it
  // An accepted request with no deadline: the shop set the payment grace to 0 ("no limit") — never released by a clock.
  if (a.decidedAt && !a.paymentDueAt && Number((tenant?.bookingMode || {}).paymentGraceHours) === 0) return 'wait';
  const start = ms(a.startTime); const created = ms(a.createdAt);
  const due = a.paymentDueAt ? ms(a.paymentDueAt) : created ? created + holdMin * 60000 : NaN;
  const lead = start - now; const protect = protectHoursOf(tenant) * H;
  const walkAway = !a.paymentDueAt && created && now - created < 2 * H;           // a checkout abandoned just now
  if (!Number.isFinite(due) || due > now) return start && lead < 48 * H && lead > 0 && !a.depositChaseAt && !walkAway ? 'chase' : 'wait';
  if (walkAway || !start || lead >= protect) return 'release';
  return 'desk';
}

/** Tell the desk (managers, front desk) and the provider — once per stage. */
export async function tellDeskDeposit(db: any, tenantId: string, a: any, stage: 'chase' | 'desk', now: number) {
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/appointments/${a.id}`);
  const tenant = (await db.doc(T).get()).data() || {};
  const { tenantTimeZone } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant);
  const when = new Date(ms(a.startTime)).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const who = String(a.clientName || 'A client'); const svc = a.serviceName ? ` (${a.serviceName})` : '';
  const message = stage === 'chase'
    ? `Action needed: ${who}’s deposit for ${when}${svc} has not been received yet. The client has been sent a link to pay. Please call the client to keep the time filled, or release the time while it can still be rebooked.`
    : `Action needed: ${who}’s deposit for ${when}${svc} has still not been received. The appointment remains on the schedule, and nothing was cancelled. Please take payment at the desk, waive the deposit, or release the time.`;
  if (stage === 'desk') await ref.set({ depositDeskHold: true, depositDeskAt: new Date(now).toISOString(), needsAttention: 'deposit_unpaid', ...(a.status === 'pending_payment' ? { paymentDueAt: a.startTime || null } : {}) }, { merge: true });
  else { await ref.set({ depositChaseAt: new Date(now).toISOString() }, { merge: true }); await tellClientDepositDue(db, tenantId, a).catch(() => {}); }   // and the client gets the link to pay
  const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((m: any) => !m.archived && (['owner', 'admin', 'manager', 'front_desk'].includes(String(m.role || '')) || m.id === a.staffId));
  const b = db.batch();
  for (const m of staff) { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId: m.id, type: 'deposit_unpaid', title: 'Deposit not received', link: '/planner', read: false, createdAt: new Date(now).toISOString(), message, appointmentId: a.id }); }
  await b.commit();
}

/** Tell the team (owners, managers, front desk) and the visit's provider, in the app. */
export async function tellTeam(db: any, tenantId: string, a: any, title: string, message: string, now = Date.now()) {
  const T = `tenants/${tenantId}`;
  const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((m: any) => !m.archived && (['owner', 'admin', 'manager', 'front_desk'].includes(String(m.role || '')) || m.id === a.staffId));
  const b = db.batch();
  for (const m of staff) { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId: m.id, type: 'appointment_released', title, link: '/planner', read: false, createdAt: new Date(now).toISOString(), message, appointmentId: a.id || null }); }
  await b.commit();
}
/** The client hears that an unpaid booking was released — nothing charged, a link to book again. */
export async function tellClientReleased(db: any, tenantId: string, a: any) {
  const T = `tenants/${tenantId}`; const tenant: any = (await db.doc(T).get()).data() || {};
  const cl: any = a.clientId ? ((await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {}) : {};
  const email = String(a.clientEmail || cl.email || '').trim(); const phone = String(a.clientPhone || cl.phone || '').trim();
  const { tenantTimeZone } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant);
  const when = a.startTime ? new Date(a.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : 'your appointment';
  const svc = String(a.serviceName || 'appointment'); const first = String(a.clientName || cl.name || '').split(' ')[0] || 'there';
  const { internalOrigin } = await import('@/lib/message-policy'); const base = internalOrigin(tenant, null) || process.env.NEXT_PUBLIC_APP_URL || '';
  const rebook = base ? `${base}/book/${tenantId}` : null;
  const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template');
  const tokens = { client_first: first, service: svc, when, link: rebook || '', studio: tenant.name || '' };
  if (email.includes('@')) await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'payment_not_received', tokens, subject: `Your ${svc} appointment time has been released`,
    html: brandedEmailHtml({ studioName: tenant.name || 'Your studio', title: 'We were unable to hold your appointment', bodyLines: [`Hi ${first},`, `We did not receive the deposit for your ${svc} on ${when}, so we have released the appointment time. No payment has been taken.`, `We apologize for any inconvenience. If you would still like to visit us, you are welcome to book a new time${rebook ? ' using the button below' : ''}.`, 'Kind regards,', tenant.name || 'Your studio'], ...(rebook ? { cta: { label: 'Book a new time', url: rebook } } : {}) }),
    recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: a.id || null } as any).catch(() => null);
  if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'payment_not_received', tokens,
    text: `Hi ${first}, we did not receive the deposit for your ${svc} on ${when}, so we have released the appointment time. No payment has been taken. We apologize for any inconvenience.${rebook ? ` You are welcome to book a new time here: ${rebook}` : ''}`,
    recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: a.id || null } as any).catch(() => null);
}

/** A booking request nobody answered in time: the client is told it isn't booked, with a link to pick another time. */
export async function tellClientRequestExpired(db: any, tenantId: string, a: any) {
  const T = `tenants/${tenantId}`; const tenant: any = (await db.doc(T).get()).data() || {};
  const cl: any = a.clientId ? ((await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {}) : {};
  const email = String(a.clientEmail || cl.email || '').trim(); const phone = String(a.clientPhone || cl.phone || '').trim();
  const { tenantTimeZone } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant);
  const when = a.startTime ? new Date(a.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : 'the time you asked for';
  const first = String(a.clientName || cl.name || '').split(' ')[0] || 'there';
  const { internalOrigin } = await import('@/lib/message-policy'); const base = internalOrigin(tenant, null) || process.env.NEXT_PUBLIC_APP_URL || '';
  const rebook = base ? `${base}/book/${tenantId}` : null;
  const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template');
  const rtokens = { client_first: first, when, reason: 'We were not able to confirm your request in time, so it has not been booked.', link: rebook || '', studio: tenant.name || '' };
  if (email.includes('@')) await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'request_declined', tokens: rtokens, subject: `About your request for ${when}`,
    html: brandedEmailHtml({ studioName: tenant.name || 'Your studio', title: 'We were unable to confirm your request', bodyLines: [`Hi ${first},`, `We are sorry, but we were not able to confirm your request for ${when} in time, so it has not been booked. No payment has been taken.`, 'We apologize for the inconvenience. You are welcome to choose another time that suits you, and we look forward to seeing you.', 'Kind regards,', tenant.name || 'Your studio'], ...(rebook ? { cta: { label: 'See open times', url: rebook } } : {}) }),
    recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: a.id || null } as any).catch(() => null);
  if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'request_declined', tokens: rtokens,
    text: `Hi ${first}, we are sorry, but we were not able to confirm your request for ${when} in time, so it has not been booked. No payment has been taken.${rebook ? ` You are welcome to choose another time here: ${rebook}` : ''}`,
    recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: a.id || null } as any).catch(() => null);
}

/** "Your deposit is still due" — the client gets the link to pay and keep their time (Messages → Slot held, deposit needed). */
export async function tellClientDepositDue(db: any, tenantId: string, a: any) {
  if (!a.checkInToken) return;
  const T = `tenants/${tenantId}`; const tenant: any = (await db.doc(T).get()).data() || {};
  const cl: any = a.clientId ? ((await db.doc(`${T}/clients/${a.clientId}`).get()).data() || {}) : {};
  const email = String(a.clientEmail || cl.email || '').trim(); const phone = String(a.clientPhone || cl.phone || '').trim();
  const { tenantTimeZone } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant);
  const when = a.startTime ? new Date(a.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : 'your appointment';
  const svc = String(a.serviceName || 'appointment'); const first = String(a.clientName || cl.name || '').split(' ')[0] || 'there';
  const amount = Number(a.depositAmountCents) > 0 ? `$${(Number(a.depositAmountCents) / 100).toFixed(2)}` : 'the';
  const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, '') || process.env.NEXT_PUBLIC_APP_URL || ''; if (!base) return;
  const link = `${base}/check-in/${a.checkInToken}`;
  const tokens = { client_first: first, service: svc, when, amount, link, studio: tenant.name || '' };
  const theDeposit = amount === 'the' ? 'your deposit' : `your ${amount} deposit`;   // wording only
  const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template');
  if (email.includes('@')) await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'booking_hold', tokens, subject: `Your deposit is still due for your ${svc}`,
    html: brandedEmailHtml({ studioName: tenant.name || 'Your studio', title: 'Your deposit is still due', bodyLines: [`Hi ${first},`, `We have not yet received ${theDeposit} for your ${svc} on ${when}.`, 'To keep your appointment time, please pay the deposit using the button below. Thank you.', 'Kind regards,', tenant.name || 'Your studio'], cta: { label: 'Pay the deposit', url: link } }),
    recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: a.id || null } as any).catch(() => null);
  if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'booking_hold', tokens,
    text: `Hi ${first}, we have not yet received ${theDeposit} for your ${svc} on ${when}. To keep your appointment time, please pay here: ${link}`,
    recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: a.id || null } as any).catch(() => null);
}
