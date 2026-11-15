// src/lib/event-invoice-server.ts — an event's final invoice (lib/event-invoice; design canvas "Event sheet and final
// invoice"). Kept on the event as finalInvoice: what a manager set (the guests who came, the price each, the bar tab,
// anything else), its status (draft, sent, paid), the link's key, and the payments made against it. A manager saves and
// sends it; the client opens the link and pays by card on the business's own account (Stripe Checkout, kind
// 'event_invoice'); a card payment is recorded once, however often it's noticed (the client's return, Stripe's notice);
// a manager can also mark it paid another way. The amount charged is always the balance worked out here.
import { createHash, randomBytes } from 'crypto';
import { tellManagers } from '@/lib/tell-managers';
import { cleanInvoice, hasPayment, invoiceLines, paymentsOf, suggestEachCents, type InvoiceIn, type Payment } from '@/lib/event-invoice';
import { money } from '@/lib/event-sheet';
import { spacePayAccount } from '@/lib/space-stripe';
import { createCheckoutSession } from '@/lib/pay-later';
import { linkOrigin } from '@/lib/app-origin';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export const TOKEN = /^[a-f0-9]{40}$/;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The manager's view: what's saved (or a start from the quote and who checked in), the lines, and what's needed to send. */
export async function invoiceFor(db: any, T: string, tenant: any, eventId: string) {
  const snap = await db.doc(`${T}/studioEvents/${eventId}`).get(); if (!snap.exists) return null;
  const ev: any = snap.data() || {}; const inv: any = ev.finalInvoice || null;
  const checkedIn = (await db.collection(`${T}/eventGuests`).where('eventId', '==', eventId).limit(3000).get()).docs.map((d: any) => d.data() || {})
    .filter((g: any) => g.checkedIn === true && !['cancelled', 'removed'].includes(String(g.status || ''))).length;
  const saved = inv ? cleanInvoice(inv) : null; const payments = paymentsOf(inv);
  const start: InvoiceIn = saved || { came: checkedIn || null, eachCents: suggestEachCents(ev), barCents: 0, extras: [] };
  const view = invoiceLines(ev, start, payments);
  return {
    invoice: start, saved: !!saved, status: (inv?.status as string) || 'draft', sentAt: inv?.sentAt || null, sentTo: inv?.sentTo || null, paidAt: inv?.paidAt || null,
    payments, view, checkedIn, suggestEach: suggestEachCents(ev),
    // Paid more than the invoice comes to (worked out each time, so it clears once the difference is refunded in Stripe).
    overpaidCents: view.totalCents > 0 ? Math.max(0, view.paidCents - view.totalCents) : 0,
    clientEmail: EMAIL.test(String(ev.clientEmail || '')) ? String(ev.clientEmail) : null, cardOn: !!spacePayAccount(tenant),
  };
}

/** A manager's invoice, saved (not once it's paid in full). */
export async function saveInvoice(db: any, T: string, eventId: string, raw: unknown, by: string): Promise<'ok' | 'missing' | 'bad' | 'paid'> {
  const inv = cleanInvoice(raw); if (!inv) return 'bad';
  const ref = db.doc(`${T}/studioEvents/${eventId}`);
  return db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); if (!s.exists) return 'missing' as const;
    const cur: any = (s.data() || {}).finalInvoice || {};
    if (cur.status === 'paid') return 'paid' as const;
    tx.set(ref, { finalInvoice: { ...cur, ...inv, status: cur.status || 'draft', updatedAt: new Date().toISOString(), updatedBy: clip(by, 60) } }, { merge: true });
    return 'ok' as const;
  });
}

/** Sends the client the invoice and its link (a key made once, kept for the life of the invoice). */
export async function sendInvoice(db: any, T: string, tenant: any, tenantId: string, eventId: string, origin: string, by: string): Promise<{ ok: true; to: string } | { ok: false; error: string; status: number }> {
  const ref = db.doc(`${T}/studioEvents/${eventId}`);
  const snap = await ref.get(); if (!snap.exists) return { ok: false, error: 'That event isn’t here any more.', status: 404 };
  const ev: any = snap.data() || {}; const cur: any = ev.finalInvoice || {};
  const inv = cleanInvoice(cur); if (!inv) return { ok: false, error: 'Save the invoice first.', status: 409 };
  const to = String(ev.clientEmail || ''); if (!EMAIL.test(to)) return { ok: false, error: 'Add the client’s email on the event first.', status: 409 };
  if (!spacePayAccount(tenant)) return { ok: false, error: 'Turn on card payments in Settings first, so the client can pay from the link.', status: 409 };
  const view = invoiceLines(ev, inv, paymentsOf(cur));
  if (view.balanceCents <= 0) return { ok: false, error: 'There’s nothing left to pay on it.', status: 409 };
  // The link's key, made once in one step (two sends at the same moment can't each make a different one).
  const token: string = await db.runTransaction(async (tx: any) => {
    const now: any = ((await tx.get(ref)).data() || {}).finalInvoice || {};
    if (TOKEN.test(String(now.token || ''))) return String(now.token);
    const made = randomBytes(20).toString('hex'); tx.set(ref, { finalInvoice: { token: made } }, { merge: true }); return made;
  });
  const title = clip(ev.title || ev.name, 120) || 'your event';
  const link = `${linkOrigin(tenant, origin)}/event-invoice/${encodeURIComponent(tenantId)}/${token}`;
  const lines = [`Hi ${clip(ev.clientName, 60).split(' ')[0] || 'there'},`, `Thank you for having ${title} with us. Here’s the final invoice.`,
    ...view.lines.map((l) => `${l.label}: ${money(l.cents)}`), ...(view.paidCents ? [`Paid so far: ${money(view.paidCents)}`] : []), `To pay: ${money(view.balanceCents)}`, `You can pay it by card here: ${link}`];
  const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template');
  const sent: any = await sendNotification(db, { tenantId, channel: 'email', to, kind: 'event_invoice', clientName: clip(ev.clientName, 80), subject: `Your final invoice for ${title}`, text: lines.join('\n\n'),
    html: brandedEmailHtml({ studioName: String(tenant?.name || ''), title: 'Your final invoice', bodyLines: lines, ctaLabel: `Pay ${money(view.balanceCents)}`, ctaUrl: link } as any), recipientType: 'client' } as any).catch(() => null);
  if (sent && sent.ok === false) return { ok: false, error: 'The email didn’t go. Check the client’s email and try again.', status: 502 };
  await ref.set({ finalInvoice: { status: 'sent', sentAt: new Date().toISOString(), sentTo: to, sentBy: clip(by, 60) } }, { merge: true });
  return { ok: true, to };
}

/** A manager marks the balance paid another way (cash, a check). It goes in the books once. */
export async function markInvoicePaid(db: any, T: string, eventId: string, how: Payment['how'], by: string): Promise<'ok' | 'missing' | 'nothing'> {
  const ref = db.doc(`${T}/studioEvents/${eventId}`);
  return db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); if (!s.exists) return 'missing' as const;
    const ev: any = s.data() || {}; const cur: any = ev.finalInvoice || {}; const payments = paymentsOf(cur);
    const view = invoiceLines(ev, cleanInvoice(cur), payments); if (view.balanceCents <= 0) return 'nothing' as const;
    const now = new Date().toISOString(); const id = `outside_${Date.now().toString(36)}`;
    const line = db.doc(`${T}/transactions/eventinv_${eventId}_${id}`);
    tx.set(line, { id: line.id, date: now, description: `Final invoice: ${clip(ev.title || ev.name, 100) || 'event'}`, clientOrVendor: clip(ev.clientName, 80) || 'Client', type: 'income', context: 'Business', category: 'Events',
      amount: view.balanceCents / 100, paymentMethod: how === 'cash' ? 'Cash' : how === 'check' ? 'Check' : 'Other', taxBucket: 'revenue', eventId, hasReceipt: false });
    tx.set(ref, { finalInvoice: { ...cur, payments: [...payments, { id, cents: view.balanceCents, at: now, how }], status: 'paid', paidAt: now, paidBy: clip(by, 60) } }, { merge: true });
    return 'ok' as const;
  });
}

/** The event an invoice link is for (by its key), with the business. */
async function byToken(db: any, tenantId: string, token: string) {
  if (!ID.test(tenantId) || !TOKEN.test(token)) return null;
  const q = await db.collection(`tenants/${tenantId}/studioEvents`).where('finalInvoice.token', '==', token).limit(1).get();
  if (q.empty) return null;
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data(); if (!tenant) return null;
  return { id: q.docs[0].id, ev: q.docs[0].data() || {}, tenant };
}

/** What the client sees on the link: the business, the event, the lines and what's left to pay. Never other guests. */
export async function publicInvoice(db: any, tenantId: string, token: string) {
  const f = await byToken(db, tenantId, token); if (!f) return null;
  const inv: any = f.ev.finalInvoice || {}; const view = invoiceLines(f.ev, cleanInvoice(inv), paymentsOf(inv));
  return { business: clip(f.tenant.name || f.tenant.businessName, 80), title: clip(f.ev.title || f.ev.name, 120) || 'Your event', date: String(f.ev.date || ''), client: clip(f.ev.clientName, 80) || null,
    lines: view.lines, totalCents: view.totalCents, paidCents: view.paidCents, balanceCents: view.balanceCents, paid: view.balanceCents <= 0 && view.totalCents > 0, nothing: view.totalCents <= 0, cardOn: !!spacePayAccount(f.tenant) };
}

/** Opens a card checkout for what's left to pay, on the business's own account. */
export async function payInvoice(db: any, stripe: any, tenantId: string, token: string, origin: string, expectCents?: number): Promise<{ ok: true; url: string } | { ok: false; error: string; status: number; code?: string }> {
  const f = await byToken(db, tenantId, token); if (!f) return { ok: false, error: 'This invoice isn’t here any more.', status: 404 };
  const account = spacePayAccount(f.tenant); if (!account) return { ok: false, error: 'Card payments aren’t on for this business right now.', status: 409 };
  const inv: any = f.ev.finalInvoice || {}; const payments = paymentsOf(inv); const view = invoiceLines(f.ev, cleanInvoice(inv), payments);
  if (view.totalCents <= 0) return { ok: false, error: 'There’s nothing to pay on this invoice.', status: 409 };
  if (view.balanceCents <= 0) return { ok: false, error: 'This invoice is paid. Thank you.', status: 409 };
  // The amount the client saw: if the invoice changed since, they see the new one before paying.
  if (Number.isInteger(expectCents) && expectCents !== view.balanceCents) return { ok: false, error: 'This invoice just changed. Here’s the latest.', status: 409, code: 'changed' };
  const title = clip(f.ev.title || f.ev.name, 120) || 'Event';
  const base = `${linkOrigin(f.tenant, origin)}/event-invoice/${encodeURIComponent(tenantId)}/${token}`;
  const meta = { kind: 'event_invoice', tenantId, eventId: f.id };
  const email = EMAIL.test(String(f.ev.clientEmail || '')) ? String(f.ev.clientEmail) : undefined;
  const params = {
    mode: 'payment', payment_method_types: ['card'],
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: view.balanceCents, product_data: { name: `Final invoice: ${title}`.slice(0, 250) } } }],
    ...(email ? { customer_email: email } : {}),
    payment_intent_data: { ...(email ? { receipt_email: email } : {}), metadata: meta }, metadata: meta,
    success_url: `${base}?paid={CHECKOUT_SESSION_ID}`, cancel_url: base,
  };
  try {
    // The same balance asked for twice gives back the same checkout (a second tap, a lost answer), never a second.
    // (The key also carries the details Stripe checks, so a corrected email or title opens a new checkout.)
    const sig = createHash('sha256').update(`${email || ''}|${title}|${base}`).digest('hex').slice(0, 12);
    const session = await createCheckoutSession(stripe, params, { stripeAccount: account, idempotencyKey: `event-invoice-${f.id}-${view.balanceCents}-${payments.length}-${sig}` });
    if (!session?.url) throw new Error('no checkout url');
    return { ok: true, url: String(session.url) };
  } catch (e: any) { console.error('[event-invoice] checkout not opened', tenantId, f.id, e?.message || e); return { ok: false, error: 'Checkout didn’t open. Please try again in a moment.', status: 502 }; }
}

/** A card payment against the invoice: recorded once (the client's return and Stripe's notice both run this), in the
 *  books once, the owner told once. `given` is the checkout when the caller already has it. */
export async function finishInvoice(db: any, stripe: any, tenantId: string, sessionId: string, given?: any): Promise<{ ok: true; paid: boolean } | { ok: false; error: 'not_found' | 'retry' }> {
  if (!ID.test(tenantId) || !/^cs_[A-Za-z0-9_]{6,200}$/.test(sessionId)) return { ok: false, error: 'not_found' };
  const T = `tenants/${tenantId}`; const tenant: any = (await db.doc(T).get()).data(); if (!tenant) return { ok: false, error: 'not_found' };
  const account = spacePayAccount(tenant);
  let session: any = given?.id === sessionId ? given : null;
  if (!session) {
    if (!account) return { ok: false, error: 'not_found' };
    try { session = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: account }); }
    catch (e: any) { return e?.statusCode === 404 || e?.code === 'resource_missing' ? { ok: false, error: 'not_found' } : { ok: false, error: 'retry' }; }
  }
  const md: any = session?.metadata || {};
  if (md.kind !== 'event_invoice' || md.tenantId !== tenantId || !ID.test(String(md.eventId || ''))) return { ok: false, error: 'not_found' };
  if (session.payment_status !== 'paid') return { ok: true, paid: false };
  const eventId = String(md.eventId); const ref = db.doc(`${T}/studioEvents/${eventId}`);
  const cents = Math.max(0, Math.round(Number(session.amount_total) || 0));
  const piId: string | null = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  const at = Number(session.created) > 0 ? new Date(Number(session.created) * 1000).toISOString() : new Date().toISOString();
  const line = db.doc(`${T}/transactions/eventinv_${sessionId}`);
  const fresh: any = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); if (!s.exists) return null;
    const ev: any = s.data() || {}; const cur: any = ev.finalInvoice || {}; const payments = paymentsOf(cur);
    const had = await tx.get(line);
    if (hasPayment(payments, sessionId)) return { ev, cur, added: false, over: 0 };
    // More than was owed (paid after it was settled another way, or after a line came down, or a second checkout): kept
    // as paid, and the owner told to give the difference back (the manager's card shows it until they do).
    const before = invoiceLines(ev, cleanInvoice(cur), payments).balanceCents; const over = Math.max(0, cents - before);
    const next = [...payments, { id: sessionId, cents, at, how: 'card' as const, pi: piId }];
    const view = invoiceLines(ev, cleanInvoice(cur), next);
    if (!had.exists) tx.set(line, { id: line.id, date: at, description: `Final invoice: ${clip(ev.title || ev.name, 100) || 'event'}`, clientOrVendor: clip(ev.clientName, 80) || 'Client', type: 'income', context: 'Business', category: 'Events',
      amount: cents / 100, paymentMethod: 'Card (Stripe)', taxBucket: 'revenue', stripePaymentIntentId: piId, checkoutSessionId: sessionId, eventId, stripeConnectedAccountId: account, hasReceipt: true });
    tx.set(ref, { finalInvoice: { ...cur, payments: next, ...(view.balanceCents <= 0 ? { status: 'paid', paidAt: cur.paidAt || at } : {}) } }, { merge: true });
    return { ev, cur, added: true, over, paidOff: view.balanceCents <= 0 };
  });
  if (!fresh) return { ok: false, error: 'not_found' };
  if (fresh.added) {
    // The owner and managers hear about it once (this step only adds the payment once); a payment over what was owed
    // buzzes their phones (lib/push-tier).
    const who = clip(fresh.ev.clientName, 60) || 'The client'; const what = clip(fresh.ev.title || fresh.ev.name, 100) || 'the event';
    await tellManagers(db, tenantId, tenant, { type: fresh.over ? 'event_invoice_overpaid' : 'event_invoice_paid', priority: fresh.over ? 'high' : 'normal', link: `/events/${eventId}/sheet`, extra: { eventId },
      message: fresh.over ? `${who} paid ${money(cents)} on the final invoice for ${what}, ${money(fresh.over)} more than was owed. Refund ${money(fresh.over)} to their card in Stripe.` : `${who} paid ${money(cents)} on the final invoice for ${what}.` });
  }
  return { ok: true, paid: true };
}

/** A card payment on the invoice refunded in Stripe (in part or in full): it counts for what's left of it, the invoice
 *  shows what's owed again, and the owner is told. Safe to run twice (it sets what was refunded, never adds to it). */
export async function syncInvoiceRefund(db: any, tenantId: string, eventId: string, piId: string, refundedCents: number): Promise<boolean> {
  if (!ID.test(tenantId) || !ID.test(eventId) || !piId) return false;
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/studioEvents/${eventId}`);
  const changed: any = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); if (!s.exists) return null;
    const ev: any = s.data() || {}; const cur: any = ev.finalInvoice || {}; const payments = paymentsOf(cur);
    const i = payments.findIndex((p) => p.pi === piId); if (i < 0) return null;
    const back = Math.max(0, Math.min(payments[i].cents, Math.round(refundedCents) || 0));
    if ((Number(payments[i].refundedCents) || 0) === back) return null;
    const next = payments.map((p, j) => (j === i ? { ...p, refundedCents: back } : p));
    const view = invoiceLines(ev, cleanInvoice(cur), next);
    tx.set(ref, { finalInvoice: { ...cur, payments: next, ...(view.balanceCents > 0 && cur.status === 'paid' ? { status: cur.sentAt ? 'sent' : 'draft', paidAt: null } : {}) } }, { merge: true });
    return { ev, back, owed: view.balanceCents };
  });
  if (!changed) return false;
  const tenant: any = (await db.doc(T).get()).data() || {};
  await tellManagers(db, tenantId, tenant, { type: 'event_invoice_refunded', link: `/events/${eventId}/sheet`, extra: { eventId },
    message: `${money(changed.back)} of the final invoice payment for ${clip(changed.ev.title || changed.ev.name, 100) || 'the event'} was refunded in Stripe.${changed.owed > 0 ? ` It shows ${money(changed.owed)} owing again.` : ''}` });
  return true;
}
