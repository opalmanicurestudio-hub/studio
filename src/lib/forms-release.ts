// src/lib/forms-release.ts — WHEN A VISIT'S FORMS AREN'T DONE IN TIME (a service's own rule, Settings › Forms and
// documents, board FormsOwner). Once an hour: for each visit still waiting on its forms (its request is open), when its
// service's own forms were due (a day or two before, lib/forms formsRuleOf) and still aren't signed:
//   'auto' — the time is released: the visit is canceled with no fee, its hold comes off, any deposit goes to the desk
//            as a refund to make, the client is told why with a link to book again, the team is told, and the time is
//            offered to the waitlist.
//   'ask'  — the owner, the managers and the visit's provider are asked once, with the visit to open. Nothing changes.
// Only the forms (a document is asked for on the visit link, and check-in handles it). Never for a visit booked less than
// 12 hours ago, one within 2 hours of its start, or a booth renter's visit (their business, their call). Once per visit
// and time: moving the visit lets the rule apply to the new time. A form the team waived, or one signed at the desk or
// on the visit link a moment ago, counts as done. Server side only.
import { formsDueAt, formsRuleOf, toMs, signedOnVisit, waivedOnVisit } from './forms';
import { tenantTimeZone } from './tenant-time';

const T = (t: string) => `tenants/${t}`;
const LIVE = ['confirmed', 'scheduled', 'deposit_pending'];
const H = 3600e3;
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
/** "Fri, Nov 6 at 3:00 PM", on the business's clock. */
const whenOf = (tenant: any, iso: any) => {
  const d = new Date(toMs(iso)); const tz = tenantTimeZone(tenant);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}`;
};

export type ReleaseCall = 'release' | 'ask' | null;
/** What to do for one visit now (pure): nothing, release its time, or ask the team. formsLeft: the forms still to sign. */
export function releaseCall(o: { service: any; appt: any; formsLeft: string[]; now: number }): ReleaseCall {
  const rule = formsRuleOf(o.service);
  if (!rule.own || rule.release === 'off' || !LIVE.includes(String(o.appt?.status || 'confirmed'))) return null;
  const start = toMs(o.appt?.startTime); const due = toMs(formsDueAt(o.appt?.startTime, o.appt?.createdAt, rule.dueHours));
  if (!start || !due || o.now < due || due > start - 2 * H || o.now > start - 2 * H) return null;
  // They've had at least 12 hours since booking (a visit booked just before its forms were due isn't released at once).
  const booked = toMs(o.appt?.createdAt); if (booked && o.now < booked + 12 * H) return null;
  return ownLeft(o.service, o.formsLeft).length ? (rule.release === 'auto' ? 'release' : 'ask') : null;
}
/** What the client can be told now (pure): whether the visit's own service will release its time ('auto') or may
 *  ('ask') if the forms left aren't done when due. The sweep's own rule (releaseCall) without "has the time come": only
 *  the service's own forms, a live visit, and only when the time it would act (the due time, and at least 12 hours
 *  after booking) is more than 2 hours before the visit. Anything else is 'off', so the client is never told their time
 *  goes when it won't: not within 2 hours of the visit, and not once the sweep has acted for this time. pending: the
 *  visit's request is open (the sweep only looks at those); rec: that request. */
export function releaseOutlook(o: { service: any; appt: any; formsLeft: string[]; pending: boolean; rec?: any; now?: number }): 'off' | 'auto' | 'ask' {
  const rule = formsRuleOf(o.service); const now = o.now ?? Date.now();
  if (!o.pending || !rule.own || rule.release === 'off' || !LIVE.includes(String(o.appt?.status || 'confirmed'))) return 'off';
  const start = toMs(o.appt?.startTime); const due = toMs(formsDueAt(o.appt?.startTime, o.appt?.createdAt, rule.dueHours));
  // Not once it's too late for the sweep to act, nor once it has already acted for this time (it acts once).
  if (!start || !due || now > start - 2 * H) return 'off';
  if (o.rec?.formsReleaseAt && String(o.rec.formsReleaseStart || '') === String(o.appt?.startTime || '')) return 'off';
  const at = Math.max(due, toMs(o.appt?.createdAt) + 12 * H);
  if (at > start - 2 * H) return 'off';
  return ownLeft(o.service, o.formsLeft).length ? rule.release : 'off';
}
/** The service's own forms among those left (a form the team added to one visit never releases it). */
const ownLeft = (service: any, left: string[]) => { const own: string[] = Array.isArray(service?.requiredFormIds) ? service.requiredFormIds.map(String) : []; return left.filter((id) => own.includes(id)); };

/** The sweep (cron/reminders, hourly). Returns how many visits were released and how many the team was asked about. */
export async function formsReleaseSweep(db: any, tenantId: string, tenant: any, now = new Date()): Promise<{ released: number; asked: number }> {
  const out = { released: 0, asked: 0 };
  // Only a business with a service that releases or asks reads any further.
  const svcs = new Map<string, any>();
  for (const d of (await db.collection(`${T(tenantId)}/services`).get()).docs) { const s = { id: d.id, ...(d.data() || {}) }; if (formsRuleOf(s).release !== 'off' && s.status !== 'archived') svcs.set(d.id, s); }
  if (!svcs.size) return out;
  const snap = await db.collection(`${T(tenantId)}/bookingCompletions`).where('status', '==', 'pending').limit(1000).get();
  for (const d of snap.docs) {
    const rec: any = d.data() || {};
    if (!rec.appointmentId) continue;
    let claimed = false;
    try {
      const appt: any = ((await db.doc(`${T(tenantId)}/appointments/${rec.appointmentId}`).get()).data()) || null;
      const service = appt ? svcs.get(String(appt.serviceId || '')) : null;
      if (!appt || !service) continue;
      // Once per visit and time (a visit moved to a new time gets the rule again).
      if (rec.formsReleaseAt && String(rec.formsReleaseStart || '') === String(appt.startTime || '')) continue;
      // Cheap checks first; the forms are read only for a visit whose time has come.
      if (!releaseCall({ service, appt, formsLeft: (service.requiredFormIds || []).map(String), now: now.getTime() })) continue;
      const { renterVisit } = await import('./prep-ctx');
      if ((await renterVisit(db, tenantId, appt)).renter) continue;
      const { visitForms } = await import('./forms-visit');
      const state = await visitForms(db, tenantId, { ...appt, id: rec.appointmentId }, { tenant, rec });
      const left = ownLeft(service, state.asks.filter((a) => a.ask === 'sign' || a.ask === 'sign_again').map((a) => a.formId));
      const call = releaseCall({ service, appt, formsLeft: left, now: now.getTime() });
      if (!call) continue;
      claimed = await db.runTransaction(async (tx: any) => { const r = (await tx.get(d.ref)).data() || {}; if (r.formsReleaseAt && String(r.formsReleaseStart || '') === String(appt.startTime || '')) return false; tx.set(d.ref, { formsReleaseAt: now.toISOString(), formsReleaseStart: String(appt.startTime || ''), formsRelease: call }, { merge: true }); return true; });
      if (!claimed) continue;
      const titles = state.asks.filter((a) => left.includes(a.formId)).map((a) => a.title);
      if (call === 'release') { if (await releaseForForms(db, tenantId, tenant, { ...appt, id: rec.appointmentId }, left, titles, now)) out.released++; }
      else { await askToRelease(db, tenantId, tenant, { ...appt, id: rec.appointmentId }, titles, now); out.asked++; }
    } catch (e) {
      console.error('[forms-release]', tenantId, d.id, e);
      // Something went wrong part way: tried again next hour.
      if (claimed) await d.ref.set({ formsReleaseAt: null, formsReleaseStart: null }, { merge: true }).catch(() => {});
    }
  }
  return out;
}

/** The owner, the managers, the front desk and the visit's provider each get a note with the visit to open. */
async function tell(db: any, tenantId: string, a: any, type: string, title: string, message: string, now: Date) {
  const staff = (await db.collection(`${T(tenantId)}/staff`).get()).docs.map((s: any) => ({ id: s.id, ...(s.data() || {}) }))
    .filter((m: any) => !m.archived && (['owner', 'admin', 'manager', 'front_desk'].includes(String(m.role || '')) || m.id === a.staffId));
  const b = db.batch();
  for (const m of staff) { const r = db.collection(`${T(tenantId)}/notifications`).doc(); b.set(r, { id: r.id, userId: m.id, type, title, message, link: `/planner?visit=${a.id}`, appointmentId: a.id, read: false, priority: 'high', createdAt: now.toISOString() }); }
  await b.commit();
}

const listOf = (titles: string[]) => (titles.length > 2 ? `${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more` : titles.join(' and '));
/** "your form, Lash and brow consent, wasn’t" / "your forms (A and B) weren’t" / "your forms weren’t" (number by count). */
const theirForms = (titles: string[]) => (titles.length === 1 ? `your form, ${titles[0]}, wasn’t` : titles.length ? `your forms (${listOf(titles)}) weren’t` : 'your forms weren’t');

/** "Ask me first": nothing changes; the team decides from the visit. */
export async function askToRelease(db: any, tenantId: string, tenant: any, a: any, titles: string[], now = new Date()) {
  const many = titles.length !== 1;
  await tell(db, tenantId, a, 'forms_release_ask', 'Forms not done',
    `${a.clientName || 'A client'} hasn’t finished ${titles.length ? listOf(titles) : 'their forms'} for ${a.serviceName || 'their visit'} on ${whenOf(tenant, a.startTime)}. Open the visit to send a reminder, waive ${many ? 'them' : 'it'}, or cancel and release the time.`, now);
}

/** "Release the time": canceled with no fee, the client told why, the team told, the time offered on. Returns false when
 *  the visit changed in the meantime (moved, canceled, or the forms were signed or waived a moment ago). */
export async function releaseForForms(db: any, tenantId: string, tenant: any, a: any, left: string[], titles: string[], now = new Date()): Promise<boolean> {
  const nowIso = now.toISOString(); const ref = db.doc(`${T(tenantId)}/appointments/${a.id}`);
  const fields = { status: 'cancelled', cancelledAt: nowIso, releasedAt: nowIso, cancelledBy: 'system', cancellationReason: 'forms_not_done', cancellationFeeCharged: 0 };
  let dep = 0;
  // One step: still live, still at the same time, the forms still not signed or waived; any paid deposit goes to the
  // desk in the same step, so a canceled visit never loses track of it.
  const done = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if (!LIVE.includes(String(cur.status || 'confirmed')) || String(cur.startTime || '') !== String(a.startTime || '')) return false;
    const here = signedOnVisit(cur); const waived = waivedOnVisit(cur);
    if (!left.some((id) => !here.has(id) && !waived.has(id))) return false;
    dep = cur.depositStatus === 'paid' ? Number(cur.depositAmountCents) || 0 : 0;
    tx.set(ref, fields, { merge: true });
    if (dep > 0) { const r = db.collection(`${T(tenantId)}/depositDecisions`).doc(); tx.set(r, { id: r.id, tenantId, appointmentId: a.id, clientId: cur.clientId || null, trigger: 'forms_not_done', amountCents: dep, status: 'pending', suggested: 'refund', createdAt: nowIso }); }
    return true;
  });
  if (!done) return false;
  if (a.checkInToken) await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set({ status: 'cancelled', tenantId }, { merge: true }).catch(() => {}), db.doc(`${T(tenantId)}/appointmentCheckIns/${a.checkInToken}`).set({ status: 'cancelled' }, { merge: true }).catch(() => {})]);
  try { const { releaseHold } = await import('./prep-actions'); await releaseHold(db, tenantId, a.id); } catch { /* none held */ }
  try { const { logAuditAdmin } = await import('./audit'); await logAuditAdmin(db, tenantId, { action: 'appointment.released_forms', targetType: 'appointment', targetId: a.id, summary: `Released ${a.clientName || 'a client'}’s ${whenOf(tenant, a.startTime)}: ${titles.length ? listOf(titles) : 'their forms'} not done in time`, actor: { type: 'system', name: 'Forms rule' } as any }); } catch { /* the release stands */ }
  // The client: why, no fee, and a way to book again.
  try {
    const cl: any = a.clientId ? (((await db.doc(`${T(tenantId)}/clients/${a.clientId}`).get()).data()) || {}) : {};
    const email = String(a.clientEmail || cl.email || '').trim(); const phone = String(a.clientPhone || cl.phone || '').trim();
    const { linkOrigin } = await import('./app-origin'); const base = linkOrigin(tenant, '') || process.env.NEXT_PUBLIC_APP_URL || '';
    const rebook = base ? `${base}/book/${tenantId}` : '';
    const studio = String(tenant?.name || 'Your studio'); const svc = String(a.serviceName || 'visit'); const when = whenOf(tenant, a.startTime);
    const why = `We’ve released your ${svc} time on ${when}, because ${theirForms(titles)} finished in time. There’s no fee${dep ? ', and your deposit will be refunded' : ''}.`;
    const { sendNotification } = await import('./notify');
    if (email.includes('@')) { const { brandedEmailHtml } = await import('./email-template');
      await sendNotification(db, { tenantId, channel: 'email', to: email, kind: 'forms_released', subject: `Your ${svc} time has been released`,
        html: brandedEmailHtml({ studioName: studio, title: 'Your appointment time was released', bodyLines: [`Hi ${first(a.clientName) || 'there'},`, why, `You’re welcome to book a new time${rebook ? ' using the button below' : ''}.`, studio], ...(rebook ? { cta: { label: 'Book a new time', url: rebook } } : {}) }),
        recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: a.id } as any).catch(() => null); }
    if (phone) await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'forms_released',
      text: `${studio}: Hi ${first(a.clientName) || 'there'}, ${why.charAt(0).toLowerCase()}${why.slice(1)}${rebook ? ` Book a new time: ${rebook}` : ''}`,
      recipientType: 'client', recipientId: a.clientId || null, recipientName: a.clientName || null, appointmentId: a.id } as any).catch(() => null);
  } catch (e) { console.error('[forms-release] client', e); }
  await tell(db, tenantId, a, 'appointment_released', 'Time released',
    `${a.clientName || 'A client'}’s ${a.serviceName || 'visit'} on ${whenOf(tenant, a.startTime)} was released: ${titles.length === 1 ? `the form “${titles[0]}” wasn’t` : titles.length ? `their forms (${listOf(titles)}) weren’t` : 'their forms weren’t'} done in time. They’ve been told there’s no fee${dep ? '; the deposit is waiting for you to refund' : ''}.`, now).catch(() => {});
  try { const { offerFreedTime, endOf } = await import('./prep-actions');
    await offerFreedTime(db, tenantId, tenant, { staffId: a.staffId || null, startMs: toMs(a.startTime), minutes: Math.round((endOf(a) - toMs(a.startTime)) / 60000), serviceId: a.serviceId || null, providerName: first(a.staffName) }); } catch { /* the team was told */ }
  return true;
}
