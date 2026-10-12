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
    ? `${who}’s deposit for ${when}${svc} isn’t paid yet. A quick call or text now keeps the time filled — or release it while someone else can still take it.`
    : `${who}’s deposit for ${when}${svc} still isn’t paid. The visit is kept on the schedule — nothing was cancelled. Take payment at the desk, waive it, or release the time.`;
  if (stage === 'desk') await ref.set({ depositDeskHold: true, depositDeskAt: new Date(now).toISOString(), needsAttention: 'deposit_unpaid', ...(a.status === 'pending_payment' ? { paymentDueAt: a.startTime || null } : {}) }, { merge: true });
  else await ref.set({ depositChaseAt: new Date(now).toISOString() }, { merge: true });
  const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((m: any) => !m.archived && (['owner', 'admin', 'manager', 'front_desk'].includes(String(m.role || '')) || m.id === a.staffId));
  const b = db.batch();
  for (const m of staff) { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId: m.id, type: 'deposit_unpaid', title: 'Deposit not paid', link: '/planner', read: false, createdAt: new Date(now).toISOString(), message, appointmentId: a.id }); }
  await b.commit();
}
