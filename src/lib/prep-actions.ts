// src/lib/prep-actions.ts — BEFORE THE VISIT, ROUND 2: putting the change onto the booking (server).
//   hold    — the moment a client answers, the extra minutes after their visit are held for them (a staff block the
//             booking engine already honours), if they're free — so nobody books them while the provider decides.
//   apply   — the agreed change goes onto the booking: service (if switched; the provider must be certified for it),
//             add-ons, time, and the "up to" price. The client is told the final plan.
//   auto    — small changes (add-ons and minutes only, within the business's limit) that fit are applied on their own.
//   keep    — "do what fits, book the rest": the booking stays as it is; the client is told.
//   desk    — doesn't fit: the desk asks the client to pick a new time (free, not counted — the visit link shows the same
//             choices as a provider callout), keeps it, or cancels it free. Freed time is offered to the waitlist.
import { prepSettingsOf, type Quote } from '@/lib/prep-check';
import { topUpDue } from '@/lib/prep-topup';
import { linkOrigin } from '@/lib/app-origin';
import { tenantTimeZone } from '@/lib/tenant-time';

const T = (t: string) => `tenants/${t}`;
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const holdId = (apptId: string) => `prep_${apptId}`;
const DEAD = ['cancelled', 'canceled', 'completed', 'no_show', 'declined', 'expired'];
export const endOf = (a: any) => ms(a.endTime) || ms(a.startTime) + (Number(a.duration) || 60) * 60000;

/** Is the provider free from the end of this visit for `extra` more minutes (other visits and blocks; not our own hold)? */
export async function fitsAfter(db: any, tenantId: string, apptId: string, a: any, extraMinutes: number): Promise<{ fits: boolean; freeMinutes: number | null }> {
  if (!a.staffId || extraMinutes <= 0) return { fits: extraMinutes <= 0, freeMinutes: null };
  const end = endOf(a); const want = end + extraMinutes * 60000; const dayEnd = end + 12 * 3600e3;
  const [apps, blocks] = await Promise.all([db.collection(`${T(tenantId)}/appointments`).where('staffId', '==', a.staffId).get(), db.collection(`${T(tenantId)}/staffBlocks`).where('staffId', '==', a.staffId).get()]);
  let next = dayEnd;
  for (const d of apps.docs) { if (d.id === apptId) continue; const o: any = d.data() || {}; if (DEAD.includes(String(o.status || ''))) continue;
    const s = ms(o.startTime) - (Number(o.padBefore) || 0) * 60000; if (s >= end && s < next) next = s; if (s < end && endOf(o) > end) next = end; }
  for (const d of blocks.docs) { if (d.id === holdId(apptId)) continue; const o: any = d.data() || {}; const s = ms(o.startTime); const e = s + (Number(o.duration) || 0) * 60000;
    if (s >= end && s < next) next = s; if (s < end && e > end) next = end; }
  const freeMinutes = Math.max(0, Math.floor((next - end) / 60000));
  return { fits: next >= want, freeMinutes: next === dayEnd ? null : freeMinutes };
}

export async function placeHold(db: any, tenantId: string, apptId: string, a: any, minutes: number) {
  if (!a.staffId || minutes <= 0) return;
  await db.doc(`${T(tenantId)}/staffBlocks/${holdId(apptId)}`).set({ staffId: a.staffId, startTime: new Date(endOf(a)).toISOString(), duration: minutes, reason: 'prep_hold', appointmentId: apptId, createdAt: new Date().toISOString() });
}
export async function releaseHold(db: any, tenantId: string, apptId: string) { try { await db.doc(`${T(tenantId)}/staffBlocks/${holdId(apptId)}`).delete(); } catch { /* none */ } }

async function textClient(db: any, tenantId: string, a: any, apptId: string, text: string, subject: string) {
  let phone = a.clientPhone || a.phone || null, email = a.clientEmail || a.email || null;
  if ((!phone || !email) && a.clientId) { try { const c: any = (await db.doc(`${T(tenantId)}/clients/${a.clientId}`).get()).data() || {}; phone = phone || c.phone || null; email = email || c.email || null; } catch { /* none */ } }
  const { smsConfigured, sendTenantSms } = await import('@/lib/sms'); const { sendNotification } = await import('@/lib/notify');
  let ok = false; if (phone && smsConfigured()) ok = (await sendTenantSms(db, tenantId, phone, text, { email, subject })).ok;
  if (!ok && email) ok = (await sendNotification(db, { tenantId, channel: 'email', to: email, subject, text, kind: 'prep_check', appointmentId: apptId, clientId: a.clientId || null, clientName: a.clientName || null, recipientType: 'client' } as any)).ok;
  return ok;
}
async function note(db: any, tenantId: string, userId: string | null, message: string, apptId: string, high = false) {
  const r = db.collection(`${T(tenantId)}/notifications`).doc();
  await r.set({ id: r.id, ...(userId ? { userId } : {}), type: 'prep_check', message, link: '/before-the-visit', appointmentId: apptId, createdAt: new Date().toISOString(), read: false, ...(high ? { priority: 'high' } : {}) });
}
const whenOf = (tenant: any, iso: any) => new Date(ms(iso)).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tenantTimeZone(tenant) });
const timeOf = (tenant: any, t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tenantTimeZone(tenant) });
const money = (n: number) => `$${Number.isInteger(Math.round(n * 100) / 100) ? Math.round(n) : n.toFixed(2)}`;
async function mirror(db: any, tenantId: string, a: any, fields: any) { if (!a.checkInToken) return; await Promise.all([db.doc(`appointmentCheckIns/${a.checkInToken}`).set(fields, { merge: true }).catch(() => {}), db.doc(`${T(tenantId)}/appointmentCheckIns/${a.checkInToken}`).set(fields, { merge: true }).catch(() => {})]); }

/** The booking fields a quote turns into (service, add-ons, time, price). */
export function bookingFieldsFor(a: any, q: Quote, startMs?: number) {
  const start = startMs ?? ms(a.startTime); const addOnIds = [...new Set([...(Array.isArray(a.addOnIds) ? a.addOnIds : []), ...q.addOns.map((x) => x.id)])];
  return { ...(q.switched ? { serviceId: q.serviceId, serviceName: q.serviceName, previousServiceId: a.serviceId || null } : {}), addOnIds, prepAddOns: q.addOns.map((x) => ({ id: x.id, qty: x.qty, priceEach: x.priceEach })),
    addOnIdsBeforePrep: Array.isArray(a.addOnIdsBeforePrep) ? a.addOnIdsBeforePrep : (Array.isArray(a.addOnIds) ? a.addOnIds : []),
    duration: q.newMinutes, endTime: new Date(start + q.newMinutes * 60000).toISOString(), price: q.newPrice, priceIsCeiling: true };
}

/** Put the agreed change onto the booking. */
export async function applyPrep(db: any, tenantId: string, apptId: string, by: { name: string; auto?: boolean }) {
  const ref = db.doc(`${T(tenantId)}/appointments/${apptId}`); const a: any = (await ref.get()).data() || null; if (!a) return { ok: false, error: 'That visit is gone.' };
  const p = a.prep; const q: Quote | null = p?.quote || null; if (!q) return { ok: false, error: 'There’s nothing to approve.' };
  if (q.safety) return { ok: false, error: 'This is a safety answer — talk to the client first.' };
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {};
  if (q.switched && a.staffId) { const svc: any = (await db.doc(`${T(tenantId)}/services/${q.serviceId}`).get()).data() || {};
    const { isCertified } = await import('@/lib/availability'); if (!isCertified(svc, String(a.staffId))) return { ok: false, error: `${first(a.staffName) || 'This provider'} isn’t certified for ${q.serviceName} — send it to the desk.` }; }
  const extra = Math.max(0, q.newMinutes - (Math.round((endOf(a) - ms(a.startTime)) / 60000)));
  const fit = await fitsAfter(db, tenantId, apptId, a, extra); if (!fit.fits) return { ok: false, error: 'It doesn’t fit — send it to the desk.', fits: false };
  const now = new Date().toISOString(); const fields = bookingFieldsFor(a, q);
  const S = prepSettingsOf(tenant); const word = S.quote === 'about' ? 'about' : 'up to';
  // A bigger price can mean a bigger deposit — only if the business asks for it, and only on a visit that took one.
  const due = topUpDue(S.topUp, a, q.oldPrice, q.newPrice);
  await ref.set({ ...fields, depositTopUp: due ? { cents: due, status: 'due', at: now } : null, prep: { ...p, status: 'approved', approvedAt: now, approvedBy: by.name, auto: !!by.auto } }, { merge: true });
  await mirror(db, tenantId, a, { serviceName: fields.serviceName || a.serviceName, endTime: fields.endTime });
  await releaseHold(db, tenantId, apptId);
  let topLine = ''; if (due) { const { prepPath } = await import('@/lib/prep-check-server'); const base = linkOrigin(tenant, ''); topLine = ` Your deposit goes up by ${money(due / 100)} with the new price${base ? ` — add it here: ${base}${prepPath(tenantId, apptId)}` : ' — we’ll take it at your visit'}.`; }
  await textClient(db, tenantId, a, apptId, `You’re all set for ${whenOf(tenant, a.startTime)}: ${q.serviceName}${q.addOns.length ? ` + ${q.addOns.map((x) => (x.qty > 1 ? `${x.name} × ${x.qty}` : x.name)).join(', ')}` : ''}, until ${timeOf(tenant, ms(fields.endTime))}, ${word} ${money(q.newPrice)}.${topLine} See you then!`, 'Your visit is confirmed');
  if (by.auto && a.staffId) await note(db, tenantId, String(a.staffId), `${first(a.clientName) || 'Your client'}'s visit was updated on its own: ${q.lines.join(' · ')}. It fitted your free time.`, apptId);
  return { ok: true };
}

/** Keep the booking as it is ("do what fits, book the rest" — or the business's own rule). */
export async function keepPrep(db: any, tenantId: string, apptId: string, by: { name: string }) {
  const ref = db.doc(`${T(tenantId)}/appointments/${apptId}`); const a: any = (await ref.get()).data() || null; if (!a) return { ok: false, error: 'That visit is gone.' };
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {}; const S = prepSettingsOf(tenant); const now = new Date().toISOString();
  await ref.set({ prep: { ...(a.prep || {}), status: 'kept', keptAt: now, keptBy: by.name } }, { merge: true }); await releaseHold(db, tenantId, apptId);
  const rule = S.onDay === 'extend_or_move' ? 'If there’s more to do, we’ll extend if there’s time or find you another.' : S.onDay === 'provider' ? `${first(a.staffName) || 'Your provider'} will go over it with you when you arrive.` : 'We’ll do what fits in your time and book the rest.';
  await textClient(db, tenantId, a, apptId, `Thanks for your answers, ${first(a.clientName) || 'there'}! We’re keeping your visit ${whenOf(tenant, a.startTime)} as booked. ${rule}`, 'About your visit');
  return { ok: true };
}

/** To the desk: it doesn't fit (or the provider wants a second opinion). */
export async function toDesk(db: any, tenantId: string, apptId: string, by: { name: string }, why?: string) {
  const ref = db.doc(`${T(tenantId)}/appointments/${apptId}`); const a: any = (await ref.get()).data() || null; if (!a) return { ok: false, error: 'That visit is gone.' };
  await ref.set({ prep: { ...(a.prep || {}), status: 'needs_desk', deskAt: new Date().toISOString(), deskBy: by.name, deskWhy: String(why || '').slice(0, 200) || null } }, { merge: true });
  await note(db, tenantId, null, `${first(a.clientName) || 'A client'}'s ${String(a.serviceName || 'visit').toLowerCase()} needs a decision — the change doesn’t fit the book.`, apptId, true);
  return { ok: true };
}

/** The desk asks the client to pick a new time — free and not counted; the visit link shows the choices. */
export async function askToMove(db: any, tenantId: string, apptId: string, by: { name: string }) {
  const ref = db.doc(`${T(tenantId)}/appointments/${apptId}`); const a: any = (await ref.get()).data() || null; if (!a) return { ok: false, error: 'That visit is gone.' };
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {}; const q = a.prep?.quote; const extra = q ? Math.max(0, q.newMinutes - Math.round((endOf(a) - ms(a.startTime)) / 60000)) : 0;
  const now = new Date().toISOString(); const reasonLabel = `your visit needs about ${extra || 'some'} more minutes than we have at that time`;
  const mark = { studioAskedToMove: true, disruption: { kind: 'prep', id: apptId, reasonLabel, at: now, status: 'pending' } };
  await ref.set({ ...mark, prep: { ...(a.prep || {}), status: 'asked_move', askedAt: now, askedBy: by.name } }, { merge: true }); await mirror(db, tenantId, a, mark); await releaseHold(db, tenantId, apptId);
  const base = linkOrigin(tenant, ''); const link = base && a.checkInToken ? `${base}/check-in/${a.checkInToken}` : '';
  await textClient(db, tenantId, a, apptId, `Hi ${first(a.clientName) || 'there'} — thanks for your answers. Your ${String(a.serviceName || 'visit').toLowerCase()} now needs about ${extra || 'some'} more minutes than we have ${whenOf(tenant, a.startTime)}. Pick a new time with room for everything — no fee — or cancel free${link ? `: ${link}` : '.'}`, 'About your visit');
  return { ok: true };
}

/** The desk cancels it — no fee; any deposit is refunded (a decision for the desk to finish), and the time is offered on. */
export async function cancelFree(db: any, tenantId: string, apptId: string, by: { name: string }) {
  const ref = db.doc(`${T(tenantId)}/appointments/${apptId}`); const a: any = (await ref.get()).data() || null; if (!a) return { ok: false, error: 'That visit is gone.' };
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {}; const now = new Date().toISOString();
  const fields = { status: 'cancelled', cancelledAt: now, cancelledBy: 'studio', studioCancelled: true, cancellationReason: 'more_time_needed', cancellationFeeCharged: 0, cancellationFeeWaived: true };
  await ref.set({ ...fields, prep: { ...(a.prep || {}), status: 'cancelled', cancelledBy: by.name } }, { merge: true }); await mirror(db, tenantId, a, fields); await releaseHold(db, tenantId, apptId);
  const dep = a.depositStatus === 'paid' ? Number(a.depositAmountCents) || 0 : 0;
  if (dep > 0) { const d = db.collection(`${T(tenantId)}/depositDecisions`).doc(); await d.set({ id: d.id, tenantId, appointmentId: apptId, clientId: a.clientId || null, trigger: 'studio_cancel_more_time', amountCents: dep, status: 'pending', suggested: 'refund', createdAt: now }); }
  await textClient(db, tenantId, a, apptId, `Hi ${first(a.clientName) || 'there'} — we’ve had to cancel your ${String(a.serviceName || 'visit').toLowerCase()} ${whenOf(tenant, a.startTime)} because it needs more time than we have. There’s no fee${dep ? ' and your deposit will be refunded' : ''}. We’ll be in touch to find a better time.`, 'Your visit');
  const freed = await offerFreedTime(db, tenantId, tenant, { staffId: a.staffId || null, startMs: ms(a.startTime), minutes: Math.round((endOf(a) - ms(a.startTime)) / 60000), serviceId: a.serviceId || null, providerName: first(a.staffName) });
  return { ok: true, offered: freed.offered };
}

/** Time that opened up: offered to people on the waitlist for that provider or service (up to 2), and the desk is told. */
export async function offerFreedTime(db: any, tenantId: string, tenant: any, o: { staffId: string | null; startMs: number; minutes: number; serviceId: string | null; providerName?: string }) {
  if (!o.startMs || o.startMs < Date.now() + 2 * 3600e3 || o.minutes < 15) return { offered: 0 };
  let offered = 0;
  try {
    const snap = await db.collection(`${T(tenantId)}/waitlist`).get();
    const open = snap.docs.map((d: any) => ({ id: d.id, ref: d.ref, ...(d.data() || {}) })).filter((w: any) => ['waiting', 'active', 'open', undefined, null, ''].includes(w.status))
      .map((w: any) => ({ w, score: (o.serviceId && w.serviceId === o.serviceId ? 2 : 0) + (o.staffId && w.staffId === o.staffId ? 1 : 0) })).filter((x: any) => x.score > 0 || !x.w.serviceId)
      .sort((x: any, y: any) => y.score - x.score || String(x.w.createdAt || '').localeCompare(String(y.w.createdAt || ''))).slice(0, 2);
    const base = linkOrigin(tenant, ''); const book = base ? `${base}/book/${tenantId}${o.serviceId ? `?service=${encodeURIComponent(o.serviceId)}` : ''}` : '';
    for (const { w } of open) {
      const text = `Good news${w.name ? `, ${first(w.name)}` : ''} — a time opened ${whenOf(tenant, new Date(o.startMs).toISOString())}${o.providerName ? ` with ${o.providerName}` : ''}.${book ? ` Book it here before it goes: ${book}` : ' Reply to grab it.'}`;
      const ok = await textClient(db, tenantId, { clientPhone: w.phone || w.clientPhone, clientEmail: w.email || w.clientEmail, clientId: w.clientId, clientName: w.name }, '', text, 'A time opened up');
      if (ok) { offered++; await w.ref.set({ status: 'notified', notifiedAt: new Date().toISOString(), offer: { startTime: new Date(o.startMs).toISOString(), minutes: o.minutes, staffId: o.staffId } }, { merge: true }); }
    }
  } catch { /* the desk still hears about it */ }
  const r = db.collection(`${T(tenantId)}/notifications`).doc();
  await r.set({ id: r.id, type: 'prep_check', message: `${o.minutes} min opened ${whenOf(tenant, new Date(o.startMs).toISOString())}${o.providerName ? ` with ${o.providerName}` : ''}${offered ? ` — offered to ${offered} on the waitlist` : ' — nobody on the waitlist fits; worth a post or a call'}.`, link: '/planner', createdAt: new Date().toISOString(), read: false });
  return { offered };
}

/** Doesn't fit with their provider: who else is certified and free at the same time for the whole new length? */
export async function otherProviders(db: any, tenantId: string, apptId: string) {
  const a: any = (await db.doc(`${T(tenantId)}/appointments/${apptId}`).get()).data() || null; if (!a) return { ok: false, error: 'That visit is gone.' };
  const q: Quote | null = a.prep?.quote || null; if (!q?.changed) return { ok: false, error: 'There’s no change to make room for.' };
  const { engineFor, openTimesOn } = await import('@/lib/rebook'); const { dayKey } = await import('@/lib/tenant-time');
  const { isCertified } = await import('@/lib/availability'); const { providerFree } = await import('@/lib/provider-availability');
  const e = await engineFor(db, tenantId); if (!e) return { ok: false, error: 'Unknown business.' };
  const start = ms(a.startTime); const date = dayKey(new Date(start), e.tz); const svc: any = e.services.find((s: any) => s.id === q.serviceId);
  const out: Array<{ staffId: string; name: string }> = [];
  for (const m of e.staff) {
    if (m.id === a.staffId || m.isRenter || !isCertified(svc, String(m.id))) continue;
    const slots = openTimesOn(e, { date, serviceId: q.serviceId, staffId: m.id, addOnIds: q.addOns.map((x) => x.id) });
    if (!slots.some((s: any) => Math.abs(Date.parse(s.startIso) - start) < 60000)) continue;
    if (!(await providerFree(db, T(tenantId), String(m.id), start, start + q.newMinutes * 60000, apptId))) continue;
    out.push({ staffId: String(m.id), name: String(m.name || 'Provider') }); if (out.length >= 4) break;
  }
  return { ok: true, providers: out };
}

/** Same time, another provider — with the change on the booking. The client is told, and can still pick a new time instead. */
export async function moveToProvider(db: any, tenantId: string, apptId: string, staffId: string, by: { name: string }) {
  const ref = db.doc(`${T(tenantId)}/appointments/${apptId}`); const a: any = (await ref.get()).data() || null; if (!a) return { ok: false, error: 'That visit is gone.' };
  const q: Quote | null = a.prep?.quote || null; if (!q?.changed) return { ok: false, error: 'There’s no change to make room for.' };
  const list: any = await otherProviders(db, tenantId, apptId); if (!list.ok) return list;
  const who = (list.providers || []).find((p: any) => p.staffId === staffId); if (!who) return { ok: false, error: 'They aren’t free for the whole visit any more — pick again.' };
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {}; const S = prepSettingsOf(tenant); const word = S.quote === 'about' ? 'about' : 'up to';
  const now = new Date().toISOString(); const fields = bookingFieldsFor(a, q); const due = topUpDue(S.topUp, a, q.oldPrice, q.newPrice);
  await ref.set({ ...fields, staffId: who.staffId, staffName: who.name, previousStaffId: a.staffId || null, previousStaffName: a.staffName || null, depositTopUp: due ? { cents: due, status: 'due', at: now } : null,
    prep: { ...(a.prep || {}), status: 'approved', approvedAt: now, approvedBy: by.name, movedProvider: { from: a.staffName || null, to: who.name, at: now } } }, { merge: true });
  await mirror(db, tenantId, a, { staffName: who.name, serviceName: fields.serviceName || a.serviceName, endTime: fields.endTime }); await releaseHold(db, tenantId, apptId);
  const base = linkOrigin(tenant, ''); const link = base && a.checkInToken ? `${base}/check-in/${a.checkInToken}` : '';
  await textClient(db, tenantId, a, apptId, `Hi ${first(a.clientName) || 'there'} — so there’s time for everything, your ${String(q.serviceName).toLowerCase()} ${whenOf(tenant, a.startTime)} is now with ${first(who.name)} (same time, ${word} ${money(q.newPrice)}).${link ? ` Rather stay with ${first(a.staffName) || 'your provider'}? Pick a new time here, free: ${link}` : ` Rather stay with ${first(a.staffName) || 'your provider'}? Just reply.`}`, 'About your visit');
  if (a.staffId) await note(db, tenantId, String(a.staffId), `${first(a.clientName) || 'Your client'}'s visit ${whenOf(tenant, a.startTime)} moved to ${first(who.name)} — it needed more time than you had.`, apptId);
  await note(db, tenantId, who.staffId, `You have ${first(a.clientName) || 'a client'} ${whenOf(tenant, a.startTime)}: ${q.lines.join(' · ')} (moved from ${first(a.staffName) || 'another provider'}).`, apptId);
  return { ok: true, to: who.name };
}
