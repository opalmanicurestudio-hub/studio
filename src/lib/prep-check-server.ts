// src/lib/prep-check-server.ts — BEFORE THE VISIT ON THE SERVER (lib/prep-check has the rules).
//   The link — /before/{tenant}/{visit}?k=… (signed; no sign-in), or ?t= the visit's check-in token.
//   The check — sent by text (or email) your cancellation window plus a day before the visit, one gentle nudge a day
//     later if unanswered, nothing within 6 hours of the visit (that's the provider's "on arrival").
//   Answers — saved on the visit (appointment.prep), with the quote the client saw and the rules version; "Looks right"
//     records their agreement; "I have a question" reaches the desk; a safety answer reaches the provider and managers.
// Changing the booking itself (time, add-ons, service) is round 2 — the provider or desk approves first.
import { depositPaidCents } from '@/lib/prep-topup';
import { createHmac } from 'crypto';
import { checkOf, quoteFor, goodToKnow, prepSettingsOf, sendTimes, noAnswerSuggestion, type Answers } from '@/lib/prep-check';
import { resolvePolicy } from '@/lib/booking-policies';
import { linkOrigin } from '@/lib/app-origin';
import { tenantTimeZone } from '@/lib/tenant-time';

const T = (t: string) => `tenants/${t}`;
const SECRET = () => process.env.LINK_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_ADMIN_CLIENT_EMAIL || 'clarityflow-links';
export const prepKey = (tenantId: string, appointmentId: string) => createHmac('sha256', SECRET()).update(`before:${tenantId}:${appointmentId}`).digest('base64url').slice(0, 16);
/** The desk's version of the link (filling the check in with the client over the phone) — the answers are marked as taken by the desk. */
export const prepDeskKey = (tenantId: string, appointmentId: string) => createHmac('sha256', SECRET()).update(`before-desk:${tenantId}:${appointmentId}`).digest('base64url').slice(0, 16);
export const prepPath = (tenantId: string, appointmentId: string) => `/before/${tenantId}/${appointmentId}?k=${prepKey(tenantId, appointmentId)}`;
const CLOSED = ['cancelled', 'canceled', 'no_show', 'declined', 'expired', 'completed', 'checked_out', 'paid'];
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : v?.toDate ? v.toDate().getTime() : Number(v) || 0);

/** The visit, if this link may speak for it. */
export async function prepVisit(db: any, tenantId: string, appointmentId: string, k?: string | null, t?: string | null) {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{4,80}$/.test(appointmentId)) return null;
  const snap = await db.doc(`${T(tenantId)}/appointments/${appointmentId}`).get(); if (!snap.exists) return null; const a: any = snap.data() || {};
  const ok = (!!k && k === prepKey(tenantId, appointmentId)) || (!!t && !!a.checkInToken && t === a.checkInToken); if (!ok) return null;
  return { id: snap.id, ref: snap.ref, a };
}

/** What the link holder may see of their saved answers: never the answers themselves (they can be health details),
 *  only which questions were answered, where things stand, and the price change they saw (without the safety note). */
export function publicPrep(p: any): { status: string | null; answeredAt: string | null; agreedAt: string | null; answeredIds: string[]; quote: any } | null {
  if (!p || typeof p !== 'object') return null;
  const ans = p.answers && typeof p.answers === 'object' ? p.answers : {};
  const answeredIds = Object.keys(ans).filter((id) => typeof ans[id] === 'string' && ans[id] !== '');
  const quote = p.quote && typeof p.quote === 'object' ? { ...p.quote, safety: null } : null;
  return { status: p.status ? String(p.status) : null, answeredAt: p.answeredAt || null, agreedAt: p.agreedAt || null, answeredIds, quote };
}

/** Everything the client's page needs. Only first names, the service, the time, and the business's own prices. */
export async function prepInfo(db: any, tenantId: string, v: { id: string; a: any }) {
  const a = v.a; const { prepCtx } = await import('@/lib/prep-ctx'); const ctx = await prepCtx(db, tenantId, a);   // a renter's visit: the renter's rules
  const tenant: any = ctx.tenant; const services = ctx.services;
  const service = services.find((x: any) => x.id === a.serviceId) || null; const check = checkOf(service); const S = ctx.S;
  const tz = tenantTimeZone(tenant); const start = ms(a.startTime); const provider = first(a.staffName);
  const when = start ? new Date(start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
  const closed = CLOSED.includes(String(a.status || '')) || (!!start && start < Date.now());
  const locked = !!start && start - Date.now() < 6 * 3600e3;
  // The only services the page needs to work out the quote: this one, anything an answer can switch to, and the add-ons.
  const ids = new Set<string>([a.serviceId]); for (const q of check?.questions || []) for (const o of q.options) { if (o.effect.switchServiceId) ids.add(o.effect.switchServiceId); for (const x of o.effect.addOns || []) ids.add(x.id); }
  if (service?.lateServiceId) ids.add(service.lateServiceId);
  const catalog = services.filter((x: any) => ids.has(x.id)).map((x: any) => ({ id: x.id, name: x.name, price: Number(x.price) || 0, duration: Number(x.duration) || 0, lateServiceId: x.lateServiceId || null, returnMinWeeks: x.returnMinWeeks, returnMaxWeeks: x.returnMaxWeeks, rebookWeeks: x.rebookWeeks }));
  const booked = { price: Number.isFinite(Number(a.price)) ? Number(a.price) : null, duration: Number(a.duration) || null };
  const brand = ctx.brand;
  let deposit: string | null = null; const dc = Number(a.depositAmountCents) || 0; if (dc && (a.depositPaid || a.depositStatus === 'paid' || a.paymentStatus === 'deposit_paid' || a.status !== 'pending_payment')) deposit = `$${(dc / 100).toFixed(dc % 100 ? 2 : 0)} paid`;
  return { ok: true as const, serviceId: String(a.serviceId || ''), brand, visit: { service: String(a.serviceName || service?.name || 'your visit'), when, provider, clientFirst: first(a.clientName) }, closed, locked,
    check, catalog, booked, settings: { quote: S.quote, topUp: S.topUp }, goodToKnow: goodToKnow(ctx.policyTenant, service, services, check, S, provider || null), renter: ctx.renter, deposit, depositPaidCents: depositPaidCents(a),
    topUp: a.depositTopUp && a.depositTopUp.cents > 0 ? { cents: Number(a.depositTopUp.cents), status: String(a.depositTopUp.status || 'due') } : null, prep: publicPrep(a.prep) };
}

const okAnswers = (check: any, raw: any): Answers => { const out: Answers = {}; for (const q of check?.questions || []) { const v = raw?.[q.id]; if (typeof v !== 'string') continue;
  if (q.kind === 'photo') { if (/^https:\/\//.test(v)) out[q.id] = v.slice(0, 600); } else if (q.options.some((o: any) => o.id === v)) out[q.id] = v; } return out; };

async function notify(db: any, tenantId: string, userId: string | null, message: string, appointmentId: string, high = false) {
  const r = db.collection(`${T(tenantId)}/notifications`).doc();
  await r.set({ id: r.id, ...(userId ? { userId } : {}), type: 'prep_check', message, link: '/before-the-visit', appointmentId, createdAt: new Date().toISOString(), read: false, ...(high ? { priority: 'high' } : {}) });
}

/** Save answers (and the quote they saw). */
export async function prepAnswer(db: any, tenantId: string, v: { id: string; ref: any; a: any }, raw: any, by: 'client' | 'desk' = 'client') {
  const info = await prepInfo(db, tenantId, v); if (!info.check) return { ok: false, error: 'There are no questions for this visit.' };
  if (info.closed) return { ok: false, error: 'This visit has already happened or was cancelled.' };
  const answers = okAnswers(info.check, raw); const service = info.catalog.find((x: any) => x.id === v.a.serviceId) || null;
  const quote = quoteFor(info.check, service, info.catalog, answers, info.booked); const now = new Date().toISOString();
  const status = quote.safety ? 'safety' : 'answered';
  // Hold the extra minutes straight away, if they're free — nobody can book them while the provider decides.
  const { fitsAfter, placeHold, releaseHold, endOf } = await import('@/lib/prep-actions');
  const extra = Math.max(0, quote.newMinutes - Math.round((endOf(v.a) - ms(v.a.startTime)) / 60000));
  const fit = quote.safety ? { fits: false, freeMinutes: null } : await fitsAfter(db, tenantId, v.id, v.a, extra);
  if (!quote.safety && extra > 0 && fit.fits) await placeHold(db, tenantId, v.id, v.a, extra); else await releaseHold(db, tenantId, v.id);
  await v.ref.set({ prep: { ...(v.a.prep || {}), answers, quote, version: info.check.version || 1, answeredAt: now, by, status, agreedAt: null, late: info.locked, extra, fits: fit.fits, freeMinutes: fit.freeMinutes, held: !quote.safety && extra > 0 && fit.fits } }, { merge: true });
  if (quote.safety && v.a.prep?.status !== 'safety') {
    const who = info.visit.clientFirst || 'A client';
    await notify(db, tenantId, v.a.staffId ? String(v.a.staffId) : null, `Action needed: ${who} gave a safety-related answer before their visit on ${info.visit.when}. Please call them, and do not start the service until you have spoken with them.`, v.id, true);
    const { soloBusiness } = await import('@/lib/solo'); if (!info.renter && (!(await soloBusiness(db, tenantId)) || !v.a.staffId)) await notify(db, tenantId, null, `Action needed: ${who} gave a safety-related answer before their ${info.visit.service.toLowerCase()} (${info.visit.when}). Please call them. The visit can be moved at no fee.`, v.id, true);
  }
  return { ok: true, quote, status };
}

/** "Looks right": their agreement to the quote they saw. */
export async function prepAgree(db: any, tenantId: string, v: { id: string; ref: any; a: any }, by: 'client' | 'desk' = 'client') {
  const p = v.a.prep; if (!p?.answeredAt) return { ok: false, error: 'Please answer the questions first.' };
  if (p.status === 'safety') return { ok: false, error: 'We will call you about this visit. Thank you for your patience.' };
  const now = new Date().toISOString(); await v.ref.set({ prep: { ...p, status: 'agreed', agreedAt: now, agreedVia: by === 'desk' ? 'phone' : 'link' } }, { merge: true });
  const q = p.quote || {}; const who = first(v.a.clientName) || 'Your client';
  // Small changes that fit (add-ons and minutes only, within the business's limit) go on by themselves.
  const { prepCtx } = await import('@/lib/prep-ctx'); const S = (await prepCtx(db, tenantId, v.a)).S;
  if (q.changed && !q.switched && p.fits && S.autoMinutes > 0 && (Number(p.extra) || 0) <= S.autoMinutes) {
    const { applyPrep } = await import('@/lib/prep-actions'); const r = await applyPrep(db, tenantId, v.id, { name: 'Automatically', auto: true }); if (r.ok) return { ok: true, applied: true };
  }
  const what = q.changed ? `${(q.lines || []).join(' · ')}` : 'no change';
  if (v.a.staffId) await notify(db, tenantId, String(v.a.staffId), `${q.changed ? 'Action needed: ' : ''}${who} answered the check before their ${String(v.a.serviceName || 'visit').toLowerCase()}: ${what}.${q.changed ? ' Please open the visit to approve it.' : ''}`, v.id);
  return { ok: true };
}

/** "I have a question": to the desk (and the provider), with the answers attached. */
export async function prepQuestion(db: any, tenantId: string, v: { id: string; ref: any; a: any }, text: string) {
  const msg = String(text || '').trim().slice(0, 600); if (!msg) return { ok: false, error: 'Please enter your question.' };
  const now = new Date().toISOString(); const p = v.a.prep || {};
  await v.ref.set({ prep: { ...p, status: p.status === 'safety' ? 'safety' : 'question', questions: [...(Array.isArray(p.questions) ? p.questions : []), { text: msg, at: now }].slice(-10) } }, { merge: true });
  const who = first(v.a.clientName) || 'A client';
  await notify(db, tenantId, null, `Action needed: ${who} has a question about their ${String(v.a.serviceName || 'visit').toLowerCase()}: “${msg.slice(0, 160)}”. Please reply to them.`, v.id, true);
  if (v.a.staffId) await notify(db, tenantId, String(v.a.staffId), `${who} has asked a question about their check: “${msg.slice(0, 160)}”`, v.id);
  return { ok: true };
}

/** Every few minutes (the no-shows cron): send checks when their time comes, nudge once, and fill the no-answer suggestion. */
export async function prepSweep(db: any, tenantId: string, tenant: any, now = Date.now()) {
  const base = linkOrigin(tenant, ''); if (!base) return { sent: 0, nudged: 0 };
  const services = (await db.collection(`${T(tenantId)}/services`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const withCheck = new Set(services.filter((x: any) => checkOf(x)).map((x: any) => x.id));
  // Renters' own checks (Part 6): their services, their rules — decisions come only to them.
  const renterChecks = (await db.collection(`${T(tenantId)}/renterServices`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((x: any) => checkOf(x) && x.isActive !== false);
  if (!withCheck.size && !renterChecks.length) return { sent: 0, nudged: 0 };
  const rctx = new Map<string, any>(); const { renterCtx } = await import('@/lib/prep-ctx');
  const snap = await db.collection(`${T(tenantId)}/appointments`).where('startTime', '>=', new Date(now).toISOString()).where('startTime', '<=', new Date(now + 8 * 864e5).toISOString()).get();
  const renterIds = new Set((await db.collection(`${T(tenantId)}/staff`).where('role', '==', 'renter').get()).docs.map((d: any) => d.id));
  const { smsConfigured, sendTenantSms } = await import('@/lib/sms'); const { sendNotification } = await import('@/lib/notify');
  const tz = tenantTimeZone(tenant); let sent = 0, nudged = 0; const { soloBusiness } = await import('@/lib/solo'); const solo = await soloBusiness(db, tenantId);
  for (const d of snap.docs) {
    const a: any = d.data() || {};
    try {
      if (CLOSED.includes(String(a.status || '')) || ['pending_payment'].includes(String(a.status || ''))) continue;
      const rid = a.isRenterBooking ? String(a.renterProviderId || a.staffId || '') : renterIds.has(String(a.staffId || '')) ? String(a.staffId) : '';
      let list = services; let isR = false;
      if (rid) { if (!renterChecks.some((x: any) => x.staffId === rid && x.id === a.serviceId)) continue;
        if (!rctx.has(rid)) rctx.set(rid, await renterCtx(db, tenantId, rid, tenant)); list = rctx.get(rid).services; isR = true; }
      else if (!withCheck.has(String(a.serviceId))) continue;
      if (a.prep?.answeredAt && a.prep?.by) {   // answered already — if nobody has decided a change by 12 h before, the desk gets it
        const st = String(a.prep.status || ''); const start0 = ms(a.startTime);
        if (a.prep.quote?.changed && ['answered', 'agreed', 'question'].includes(st) && now >= start0 - 12 * 3600e3 && !a.prep.deskAt && !a.prep.remindedAt) {
          if (solo || isR) { await d.ref.set({ prep: { ...a.prep, remindedAt: new Date(now).toISOString() } }, { merge: true }); await notify(db, tenantId, a.staffId ? String(a.staffId) : null, `Action needed: Please decide on ${first(a.clientName) || 'your client'}’s requested change before their visit: ${(a.prep.quote.lines || []).join(' · ')}. You can approve it, keep the visit as booked, or ask them to choose a new time.`, d.id, true); }
          else { const { toDesk } = await import('@/lib/prep-actions'); await toDesk(db, tenantId, d.id, { name: 'No decision 12 h before' }, 'Nobody decided yet'); }
        }
        continue;
      }
      const start = ms(a.startTime); const svc = list.find((x: any) => x.id === a.serviceId);
      const { sendAt, lockAt } = sendTimes(start, isR ? 24 : Number(resolvePolicy(tenant, svc).cancel.windowHours.value) || 24);
      if (now >= lockAt) continue;
      const due = !a.prepSentAt ? now >= sendAt : (!a.prepNudgedAt && now >= ms(a.prepSentAt) + 24 * 3600e3 && now < lockAt - 2 * 3600e3);
      if (!due) continue;
      const when = new Date(start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz });
      const n = (checkOf(svc)?.questions || []).length; const url = `${base}${prepPath(tenantId, d.id)}`;
      const text = !a.prepSentAt
        ? `Hi ${first(a.clientName) || 'there'}, your ${String(a.serviceName || 'visit').toLowerCase()} is on ${when}${a.staffName ? ` with ${first(a.staffName)}` : ''}. Please answer ${n === 1 ? 'one short question' : `${n} short questions`} so we can reserve the right amount of time: ${url}`
        : `Hi ${first(a.clientName) || 'there'}, this is a reminder to answer a few short questions before your ${String(a.serviceName || 'visit').toLowerCase()} on ${when}, so we can reserve the right amount of time. It takes about 20 seconds: ${url}`;
      let phone = a.clientPhone || a.phone || null, email = a.clientEmail || a.email || null;
      if ((!phone || !email) && a.clientId) { try { const c: any = (await db.doc(`${T(tenantId)}/clients/${a.clientId}`).get()).data() || {}; phone = phone || c.phone || null; email = email || c.email || null; } catch { /* none */ } }
      let ok = false; const subject = `Before your ${String(a.serviceName || 'visit').toLowerCase()}`;
      if (phone && smsConfigured()) ok = (await sendTenantSms(db, tenantId, phone, text, { email, subject })).ok;
      if (!ok && email) ok = (await sendNotification(db, { tenantId, channel: 'email', to: email, subject, text, kind: 'prep_check', appointmentId: d.id, clientId: a.clientId || null, clientName: a.clientName || null, recipientType: 'client' } as any)).ok;
      if (!ok) continue;
      const stamp = new Date(now).toISOString();
      // With the first send, note the no-answer suggestion (weeks since their last visit) for the provider's Prep.
      let suggestion: any = null;
      if (!a.prepSentAt && a.clientId) { try { const past = (await db.collection(`${T(tenantId)}/appointments`).where('clientId', '==', a.clientId).get()).docs.map((x: any) => x.data() || {})
          .filter((x: any) => x.serviceId === a.serviceId && ['completed', 'checked_out', 'paid'].includes(String(x.status)) && ms(x.startTime) < start).map((x: any) => ms(x.startTime)).sort((p: number, q: number) => q - p);
        const weeks = past.length ? Math.floor((start - past[0]) / (7 * 864e5)) : null; suggestion = noAnswerSuggestion(svc, list, weeks); } catch { /* none */ } }
      await d.ref.set(!a.prepSentAt ? { prepSentAt: stamp, ...(suggestion ? { prepSuggestion: suggestion } : {}) } : { prepNudgedAt: stamp }, { merge: true });
      if (!a.prepSentAt) sent++; else nudged++;
    } catch { /* next visit */ }
  }
  return { sent, nudged };
}

/** "Add it to my deposit": a card payment for the top-up the business asked for (Stripe Checkout on their account). */
export async function prepTopUpLink(db: any, tenantId: string, v: { id: string; ref: any; a: any }, origin: string) {
  const t = v.a.depositTopUp; if (!t || !(Number(t.cents) > 0)) return { ok: false, error: 'There is nothing to add to your deposit.' };
  if (t.status === 'paid') return { ok: false, error: 'Your deposit has already been topped up. Thank you!' };
  if (CLOSED.includes(String(v.a.status || ''))) return { ok: false, error: 'This visit has already happened or was cancelled.' };
  const tenant: any = (await db.doc(T(tenantId)).get()).data() || {}; if (!tenant.stripeAccountId) return { ok: false, error: 'Online card payments are not available. We will collect this at your visit.' };
  let email = v.a.clientEmail || null; if (!email && v.a.clientId) { try { email = ((await db.doc(`${T(tenantId)}/clients/${v.a.clientId}`).get()).data() as any)?.email || null; } catch { /* none */ } }
  const Stripe = (await import('stripe')).default; const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' as any });
  const back = `${origin}${prepPath(tenantId, v.id)}`; const md = { type: 'deposit_topup', tenantId, appointmentId: v.id, cents: String(Math.round(Number(t.cents))) };
  const session = await stripe.checkout.sessions.create({ mode: 'payment', ...(email ? { customer_email: String(email) } : {}),
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(Number(t.cents)), product_data: { name: `Deposit top-up — ${v.a.serviceName || 'your visit'}`, description: 'This amount will be applied to your total at your visit.' } } }],
    metadata: md, payment_intent_data: { metadata: md }, success_url: `${back}&paid=1`, cancel_url: back, expires_at: Math.floor(Date.now() / 1000) + 23 * 3600 }, { stripeAccount: tenant.stripeAccountId });
  return { ok: true, url: session.url as string };
}

/** The top-up was paid (the connect webhook): the deposit grows, the credit that comes off at checkout grows with it. Safe to run twice. */
export async function prepTopUpPaid(db: any, tenantId: string, apptId: string, x: { cents: number; sessionId: string; chargeId?: string | null }) {
  // Once per payment page, in one step: the deposit goes up, the visit's open credit grows (or one is made), and the
  // income is written under the page's own name, so a notice Stripe sends twice (or two at once) adds it once.
  const ref = db.doc(`${T(tenantId)}/appointments/${apptId}`);
  const key = String(x.sessionId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
  const incomeRef = db.doc(`${T(tenantId)}/transactions/topup_${key}`);
  return db.runTransaction(async (tx: any) => {
    const [as, is] = await Promise.all([tx.get(ref), tx.get(incomeRef)]);
    const a: any = as.data(); if (!a) return { ok: false };
    if (is.exists || (a.depositTopUp?.status === 'paid' && a.depositTopUp?.sessionId === x.sessionId)) return { ok: true, already: true };
    const credits = await tx.get(db.collection(`${T(tenantId)}/depositCredits`).where('sourceAppointmentId', '==', apptId));
    const open = credits.docs.find((d: any) => (d.data() || {}).status === 'available');
    const openNow = open ? await tx.get(open.ref) : null;
    const now = new Date().toISOString(); const cents = Math.max(0, Math.round(x.cents));
    tx.set(ref, { depositAmountCents: (Number(a.depositAmountCents) || 0) + cents, depositTopUp: { ...(a.depositTopUp || {}), status: 'paid', paidAt: now, paidCents: cents, sessionId: x.sessionId } }, { merge: true });
    if (openNow?.exists && (openNow.data() || {}).status === 'available') tx.set(openNow.ref, { amountCents: (Number(openNow.data().amountCents) || 0) + cents, toppedUpAt: now, kind: 'deposit' }, { merge: true });
    else { const c = db.doc(`${T(tenantId)}/depositCredits/topup_${key}`); tx.set(c, { id: c.id, tenantId, kind: 'deposit', clientId: a.clientId || null, clientEmail: String(a.clientEmail || '').toLowerCase().trim(), clientName: a.clientName || 'Guest', amountCents: cents, status: 'available', sourceAppointmentId: apptId, createdAt: now, checkoutSessionId: x.sessionId, stripeChargeId: x.chargeId || null }); }
    tx.set(incomeRef, { id: incomeRef.id, date: now, description: `Deposit top-up — ${a.serviceName || 'Appointment'}`, clientOrVendor: a.clientName || 'Guest', clientId: a.clientId || null, type: 'income', context: 'Business', category: 'Retainers', taxBucket: 'revenue', amount: cents / 100, paymentMethod: 'Online Checkout', hasReceipt: false, appointmentId: apptId, staffId: a.staffId || null, checkoutSessionId: x.sessionId, stripeChargeId: x.chargeId || null, tenantId });
    return { ok: true };
  });
}
