// src/lib/prep-day.ts — BEFORE THE VISIT, ROUND 3: ON THE DAY (server). The provider finds more to do than the booking
// allows (or the client under-reported before the visit). On the staff app they pick what's needed — add-ons with a count,
// extra minutes, or a different service — and show the client the change and the new "up to" price. The client says yes
// or no in person; nothing changes until they do.
//   yes, and it fits   → it goes on the booking: the time, the add-ons (with counts), the new "up to" price, and the
//                        business's on-the-day fee if they charge one and the provider adds it.
//   yes, doesn't fit   → the business's on-the-day rule: do what fits and book the rest (the desk books it), find another
//                        time (free), or the provider's call (they can run over, on purpose).
//   no                 → kept as booked.
// Every change is kept on the visit (dayChanges) with who showed it, what was shown and the answer — and the client gets
// the agreed change in writing — so there's a record if it's ever disputed.
import { prepSettingsOf, quoteFor, dayCheck, type DayInput, type Quote } from '@/lib/prep-check';
export type { DayInput };
import { fitsAfter, bookingFieldsFor, endOf } from '@/lib/prep-actions';
import { addOnIdsOf, prepAddOnsOf } from '@/lib/prep-checkout';
import { tenantTimeZone } from '@/lib/tenant-time';

const T = (t: string) => `tenants/${t}`;
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const money = (n: number) => `$${Number.isInteger(Math.round(n * 100) / 100) ? Math.round(n) : n.toFixed(2)}`;

/** The visit as it stands: price (the booking's, or the catalog's for the service and its add-ons) and minutes. */
export function currentOf(a: any, services: any[]) {
  const svc = services.find((s: any) => s.id === a.serviceId) || null;
  const listed = num(svc?.price) + addOnIdsOf(a).reduce((n, id) => n + num(services.find((s: any) => s.id === id)?.price), 0);
  const price = a.price !== undefined && a.price !== null && Number.isFinite(Number(a.price)) ? Number(a.price) : listed;
  const minutes = Math.max(0, Math.round((endOf(a) - ms(a.startTime)) / 60000));
  return { svc, price, minutes };
}

export function dayQuote(a: any, services: any[], input: DayInput): Quote {
  const { svc, price, minutes } = currentOf(a, services);
  return quoteFor(dayCheck(input), svc, services, { day: 'pick' }, { price, duration: minutes });
}

async function load(db: any, tenantId: string, apptId: string) {
  const ref = db.doc(`${T(tenantId)}/appointments/${apptId}`);
  const [aSnap, tSnap, sSnap] = await Promise.all([ref.get(), db.doc(T(tenantId)).get(), db.collection(`${T(tenantId)}/services`).get()]);
  return { ref, a: aSnap.exists ? (aSnap.data() as any) : null, tenant: (tSnap.data() || {}) as any, services: sSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })) as any[] };
}

/** What the provider can pick from: add-ons for this service, other services they're certified for, and the free time after. */
export async function dayOptions(db: any, tenantId: string, apptId: string) {
  const { a, tenant, services } = await load(db, tenantId, apptId); if (!a) return { ok: false, error: 'That visit is gone.' };
  const S = prepSettingsOf(tenant); const { svc, price, minutes } = currentOf(a, services);
  const { isCertified } = await import('@/lib/availability');
  const live = services.filter((s: any) => s.isActive !== false && s.archived !== true && !s.ownerRenterId);
  const compatible: string[] = Array.isArray(svc?.compatibleAddOnIds) ? svc.compatibleAddOnIds : [];
  const addOns = live.filter((s: any) => s.type === 'addon' && (!compatible.length || compatible.includes(s.id))).map((s: any) => ({ id: s.id, name: String(s.name || 'Add-on'), price: num(s.price), duration: num(s.duration) })).slice(0, 40);
  const switches = live.filter((s: any) => s.type !== 'addon' && s.id !== a.serviceId && (!svc?.category || s.category === svc.category) && (!a.staffId || isCertified(s, String(a.staffId))))
    .map((s: any) => ({ id: s.id, name: String(s.name || 'Service'), price: num(s.price), duration: num(s.duration) })).slice(0, 30);
  const fit = await fitsAfter(db, tenantId, apptId, a, 1);
  const p = a.prep || {};
  const before = p.answeredAt ? (p.quote?.changed ? `Before the visit they agreed: ${(p.quote.lines || []).join(' · ')}` : 'Before the visit they said nothing had changed') : a.prepSentAt ? 'They didn’t answer the check before the visit' : null;
  return { ok: true, serviceName: String(svc?.name || a.serviceName || 'Visit'), price, minutes, endTime: new Date(endOf(a)).toISOString(), freeMinutes: fit.freeMinutes, timeZone: tenantTimeZone(tenant),
    quote: S.quote, onDay: S.onDay, feeCents: S.onDayFeeCents, before, addOns, switches, catalog: services.filter((s: any) => s.id === a.serviceId || s.type === 'addon' || switches.some((x) => x.id === s.id)).map((s: any) => ({ id: s.id, name: s.name, price: num(s.price), duration: num(s.duration) })),
    history: Array.isArray(a.dayChanges) ? a.dayChanges.slice(-5) : [] };
}

async function textClient(db: any, tenantId: string, a: any, apptId: string, text: string) {
  let phone = a.clientPhone || a.phone || null, email = a.clientEmail || a.email || null;
  if ((!phone || !email) && a.clientId) { try { const c: any = (await db.doc(`${T(tenantId)}/clients/${a.clientId}`).get()).data() || {}; phone = phone || c.phone || null; email = email || c.email || null; } catch { /* none */ } }
  const { smsConfigured, sendTenantSms } = await import('@/lib/sms'); const { sendNotification } = await import('@/lib/notify');
  let ok = false; if (phone && smsConfigured()) ok = (await sendTenantSms(db, tenantId, phone, text, { email, subject: 'Today’s change to your visit' })).ok;
  if (!ok && email) ok = (await sendNotification(db, { tenantId, channel: 'email', to: email, subject: 'Today’s change to your visit', text, kind: 'prep_day', appointmentId: apptId, clientId: a.clientId || null, clientName: a.clientName || null, recipientType: 'client' } as any)).ok;
  return ok;
}

/** The client's answer, in person. `runOver`: the provider (or a manager) chose to go past the free time, on purpose. */
export async function dayChange(db: any, tenantId: string, apptId: string, by: { name: string; staffId?: string | null; manager?: boolean }, input: DayInput & { answer: 'yes' | 'no'; fee?: boolean; runOver?: boolean }) {
  const { ref, a, tenant, services } = await load(db, tenantId, apptId); if (!a) return { ok: false, error: 'That visit is gone.' };
  if (['cancelled', 'canceled', 'completed', 'no_show'].includes(String(a.status || ''))) return { ok: false, error: 'This visit is already closed.' };
  const S = prepSettingsOf(tenant); const q = dayQuote(a, services, input); if (!q.changed) return { ok: false, error: 'Pick what’s needed first.' };
  if (q.switched && a.staffId) { const { isCertified } = await import('@/lib/availability'); const t = services.find((s: any) => s.id === q.serviceId); if (!isCertified(t, String(a.staffId))) return { ok: false, error: `${first(a.staffName) || 'This provider'} isn’t certified for ${q.serviceName}.` }; }
  const { minutes } = currentOf(a, services); const extra = Math.max(0, q.newMinutes - minutes);
  const fit = await fitsAfter(db, tenantId, apptId, a, extra);
  const now = new Date().toISOString(); const yes = input.answer === 'yes';
  const runOver = yes && !fit.fits && !!input.runOver && (S.onDay === 'provider' || !!by.manager);
  const fee = yes && (fit.fits || runOver) && input.fee === true && S.onDayFeeCents > 0 ? S.onDayFeeCents / 100 : 0;
  const outcome = !yes ? 'kept' : fit.fits || runOver ? (runOver ? 'applied_over' : 'applied') : S.onDay === 'extend_or_move' ? 'needs_new_time' : 'rebook_rest';
  const entry = { at: now, by: by.name, byStaffId: by.staffId || null, shownInPerson: true, lines: q.lines, oldPrice: q.oldPrice, newPrice: q.newPrice, oldMinutes: q.oldMinutes, newMinutes: q.newMinutes,
    addOns: q.addOns, switchedTo: q.switched ? q.serviceName : null, fits: fit.fits, freeMinutes: fit.freeMinutes, answer: yes ? 'yes' : 'no', feeCharged: fee, outcome, rule: S.onDay, quoteWord: S.quote };
  const word = S.quote === 'about' ? 'about' : 'up to';
  const text = !yes ? `${a.clientName || 'The client'} said no to: ${q.lines.join(' · ')} — kept as booked.`
    : outcome.startsWith('applied') ? `${a.clientName || 'The client'} agreed in person: ${q.lines.join(' · ')} — ${word} ${money(q.newPrice)}${fee ? ` + ${money(fee)} on-the-day fee` : ''}.`
    : `${a.clientName || 'The client'} agreed: ${q.lines.join(' · ')} — it doesn’t fit today, ${outcome === 'needs_new_time' ? 'so it needs a new time (free)' : 'so we do what fits and book the rest'}.`;
  const base: any = { dayChange: entry, dayChanges: [...(Array.isArray(a.dayChanges) ? a.dayChanges : []), entry].slice(-20), timeline: [...(Array.isArray(a.timeline) ? a.timeline : []), { at: now, kind: 'note', text, by: by.name, via: 'day_change' }].slice(-60) };
  if (outcome.startsWith('applied')) {
    const f: any = bookingFieldsFor(a, q);
    const merged = new Map<string, { id: string; qty: number; priceEach: number }>(); for (const x of [...prepAddOnsOf(a), ...q.addOns.map((x) => ({ id: x.id, qty: x.qty, priceEach: x.priceEach }))]) { const p = merged.get(x.id); merged.set(x.id, { id: x.id, qty: (p?.qty || 0) + x.qty, priceEach: x.priceEach || p?.priceEach || 0 }); }
    f.prepAddOns = [...merged.values()];
    f.addOnIdsBeforePrep = Array.isArray(a.addOnIdsBeforePrep) ? a.addOnIdsBeforePrep : (Array.isArray(a.addOnIds) ? a.addOnIds.filter((id: string) => !prepAddOnsOf(a).some((x) => x.id === id)) : []);
    Object.assign(base, f, fee ? { checkoutState: { adjustments: { dayChangeFee: fee } } } : {});
    if (a.checkInToken) { const m = { serviceName: f.serviceName || a.serviceName, endTime: f.endTime }; await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set(m, { merge: true }).catch(() => {}), db.doc(`${T(tenantId)}/appointmentCheckIns/${a.checkInToken}`).set(m, { merge: true }).catch(() => {})]); }
  }
  await ref.set(base, { merge: true });
  if (yes) {
    const tz = tenantTimeZone(tenant); const until = new Date(ms(a.startTime) + q.newMinutes * 60000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    const msg = outcome.startsWith('applied') ? `Thanks, ${first(a.clientName) || 'there'} — as agreed today: ${q.lines.join(' · ')}. Your visit is now ${word} ${money(q.newPrice)}${fee ? ` plus a ${money(fee)} on-the-day fee` : ''}, until about ${until}. You’ll only pay for what’s done.`
      : `Thanks, ${first(a.clientName) || 'there'} — as agreed today: ${q.lines.join(' · ')}. ${outcome === 'needs_new_time' ? 'It doesn’t fit today’s time, so we’ll find you another — no fee.' : 'We’ll do what fits today and book the rest with you.'}`;
    await textClient(db, tenantId, a, apptId, msg).catch(() => false);
    if (!outcome.startsWith('applied')) { const r = db.collection(`${T(tenantId)}/notifications`).doc(); await r.set({ id: r.id, type: 'prep_check', message: `${first(a.clientName) || 'A client'} (with ${first(a.staffName) || 'their provider'}) agreed to ${q.lines.join(' · ')} — ${outcome === 'needs_new_time' ? 'find them a new time, no fee' : 'book the rest with them before they leave'}.`, link: '/before-the-visit', appointmentId: apptId, createdAt: now, read: false, priority: 'high' }); }
  }
  return { ok: true, outcome, fits: fit.fits, freeMinutes: fit.freeMinutes, quote: q, fee };
}
