// src/app/api/checkout/complete/route.ts — CHECKOUT, SAVED ON THE SERVER (staff only).
// Everything the POS checkout used to write from the browser, now worked out here from the REAL prices
// (services and each provider's price tier, add-ons, products, memberships, packages, the client's actual
// owed fees, the business's tax settings) and saved in ONE all-or-nothing batch:
//   payment lines (services, add-ons, redemptions + their cost, overages, refreshments, products, memberships,
//   packages, deposits, rentals, owed fees, tips, discounts, service recovery, tax, card fee, deposit applied),
//   the visit(s) completed, providers freed, stock + stock log, space rentals paid, owed fees cleared,
//   lifetime value, package / perk use, the till, the receipt, discount-code use, offers and campaigns.
// Then: memberships / packages enrolled, and any next-visit deposit confirmed.
// The screen uses the same calculation (lib/checkout-calc), so the totals match; if they ever don't, the sale is
// still recorded exactly as worked out here and flagged for review — never silently.
import { tuitionAccount, applyTuitionPayment } from '@/lib/tuition-desk';
import { renterAccount, applyRentPayment } from '@/lib/rent-desk';
import { syncVisitCopies } from '@/lib/visit-sync';
import { refundPaymentIntent } from '@/lib/stripe-refund';
import { momentsFor, bestMomentReward, prebookMoment } from '@/lib/moments';
import { monthKey } from '@/lib/team-discount';
import { consumeApproval, isApprover } from '@/lib/approvals';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { computeCheckout } from '@/lib/checkout-calc';
import { computeServiceCost } from '@/lib/service-cost';
import { isCreditExpired } from '@/lib/deposit-policy';

export const dynamic = 'force-dynamic';
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const firstName = (n: any) => String(n || '').split(' ')[0] || undefined;
const clean = (v: any): any => {
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(clean);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)]));
  return v;
};

const MGR = ['owner', 'admin', 'manager'];
const json = (body: any, status = 200) => ({ body, status });

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const action = String(b.action || 'complete');
  // ── A ticket is saved as "started" before a card is charged, so a paid sale can always be recorded later ──
  if (action === 'prepare') {
    const payload = { ...b }; delete payload.action; delete payload.pendingId;
    const ref = b.pendingId ? db.doc(`${T}/pendingCheckouts/${String(b.pendingId)}`) : db.collection(`${T}/pendingCheckouts`).doc();
    const prev: any = b.pendingId ? ((await ref.get()).data() || {}) : {};
    if (prev.status === 'completed') return NextResponse.json({ ok: true, pendingId: ref.id, already: true });
    const cl: any = ((await db.doc(`${T}/clients/${String(b.clientId || '')}`).get()).data() as any) || {};
    await ref.set({ id: ref.id, status: 'prepared', payload, clientId: String(b.clientId || ''), clientName: cl.name || null, expectedTotal: Number(b.expectedTotal) || 0,
      preparedAt: prev.preparedAt || new Date().toISOString(), updatedAt: new Date().toISOString(), preparedBy: auth.actor.name }, { merge: true });
    return NextResponse.json({ ok: true, pendingId: ref.id });
  }
  // ── SPLIT THE BILL: each share is paid (cash, a card, the iPad / their phone, other) and recorded here against the
  //    started ticket AS IT HAPPENS — so if it stops halfway, nothing is lost (Sales not recorded shows "$50 of $120 paid").
  //    A card share is checked with Stripe (succeeded, the right amount, not used anywhere else). ──
  if (action === 'tender' || action === 'tender_remove') {
    const ref = db.doc(`${T}/pendingCheckouts/${String(b.pendingId || '')}`); const pc: any = (await ref.get()).data();
    if (!pc) return NextResponse.json({ ok: false, error: 'Start the split again — the ticket wasn’t found.' }, { status: 404 });
    if (pc.status === 'completed') return NextResponse.json({ ok: false, error: 'This sale is already finished.' }, { status: 409 });
    const tenders: any[] = Array.isArray(pc.tenders) ? pc.tenders : [];
    const t0: any = ((await db.doc(T).get()).data() as any) || {}; const acct = t0.stripeAccountId || t0.stripeConnectAccountId || null;
    if (action === 'tender_remove') {
      const tn = tenders.find((x) => x.id === String(b.tenderId || '')); if (!tn) return NextResponse.json({ ok: false, error: 'That payment wasn’t found.' }, { status: 404 });
      let refunded = false;
      if (tn.stripePaymentIntentId) { refunded = await refundPaymentIntent(acct, String(tn.stripePaymentIntentId)); if (!refunded) return NextResponse.json({ ok: false, error: 'The card refund didn’t go through — try again, or refund it from Money.' }, { status: 502 }); }
      const left = tenders.filter((x) => x.id !== tn.id);
      await ref.set({ tenders: left, status: left.length ? 'partial' : 'prepared', updatedAt: new Date().toISOString(), removedTenders: FieldValue.arrayUnion({ ...tn, removedAt: new Date().toISOString(), removedBy: auth.actor.name, refunded }) }, { merge: true });
      return NextResponse.json({ ok: true, tenders: left, paid: left.reduce((s, x) => s + num(x.amount) + num(x.tip), 0), refunded });
    }
    const m = String(b.method || ''); if (!['cash', 'card', 'other'].includes(m)) return NextResponse.json({ ok: false, error: 'Choose how this share was paid.' }, { status: 400 });
    const amount = Math.round(num(b.amount) * 100) / 100; const tipPart = Math.max(0, Math.round(num(b.tip) * 100) / 100);
    if (!(amount > 0)) return NextResponse.json({ ok: false, error: 'Enter the amount for this share.' }, { status: 400 });
    const tn: any = { id: rid(), method: m, amount, tip: tipPart, payerName: String(b.payerName || '').slice(0, 60) || null, payerClientId: b.payerClientId ? String(b.payerClientId) : null,
      label: String(b.label || '').slice(0, 60) || null, note: String(b.note || '').slice(0, 80) || null, at: new Date().toISOString(), by: auth.actor.name || 'Staff' };
    if (m === 'cash') tn.cashGiven = Math.max(amount + tipPart, Math.round(num(b.cashGiven) * 100) / 100);
    if (m === 'card') {
      const piId = String(b.stripePaymentIntentId || ''); if (!piId) return NextResponse.json({ ok: false, error: 'That card payment has no reference.' }, { status: 400 });
      if (tenders.some((x) => x.stripePaymentIntentId === piId)) return NextResponse.json({ ok: true, tenders, paid: tenders.reduce((s, x) => s + num(x.amount) + num(x.tip), 0), already: true });
      const dup = await db.collection(`${T}/receipts`).where('stripePaymentIntentId', '==', piId).get(); if (!dup.empty) return NextResponse.json({ ok: false, error: 'That card payment is already on another sale.' }, { status: 409 });
      if (acct && process.env.STRIPE_SECRET_KEY) {
        const StripeLib = (await import('stripe')).default; const stripe = new StripeLib(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
        const pi: any = await stripe.paymentIntents.retrieve(piId, { stripeAccount: acct } as any).catch(() => null);
        if (!pi || pi.status !== 'succeeded') return NextResponse.json({ ok: false, error: 'That card payment didn’t go through.' }, { status: 409 });
        if (Math.abs(pi.amount - Math.round((amount + tipPart) * 100)) > 1) return NextResponse.json({ ok: false, error: 'That card payment is for a different amount.' }, { status: 409 });
      }
      tn.stripePaymentIntentId = piId; tn.via = String(b.via || 'card').slice(0, 30);
    }
    const next = [...tenders, tn];
    await ref.set({ tenders: next, status: 'partial', paidSoFar: next.reduce((s, x) => s + num(x.amount) + num(x.tip), 0), updatedAt: new Date().toISOString() }, { merge: true });
    return NextResponse.json({ ok: true, tender: tn, tenders: next, paid: next.reduce((s, x) => s + num(x.amount) + num(x.tip), 0) });
  }
  // ── Managers: record a paid sale that didn't save (replays exactly what was rung up — no charge), or discard it ──
  if (action === 'record' || action === 'discard') {
    if (!MGR.includes(String(auth.actor.role || '').toLowerCase())) return NextResponse.json({ ok: false, error: 'Only a manager can do that.' }, { status: 403 });
    const ref = db.doc(`${T}/pendingCheckouts/${String(b.pendingId || '')}`); const pc: any = (await ref.get()).data();
    if (!pc) return NextResponse.json({ ok: false, error: 'That sale wasn’t found.' }, { status: 404 });
    if (pc.status === 'completed') return NextResponse.json({ ok: true, already: true, receiptId: pc.receiptId || null });
    if (action === 'discard') {
      const reason = String(b.reason || '').trim().slice(0, 200); if (!reason) return NextResponse.json({ ok: false, error: 'Say why it’s being discarded.' }, { status: 400 });
      // A partly paid split: refund each card share, and say how much cash to hand back.
      const shares: any[] = Array.isArray(pc.tenders) ? pc.tenders : []; let refundedCards = 0; const failed: string[] = [];
      if (shares.length) { const t0: any = ((await db.doc(T).get()).data() as any) || {};
        for (const x of shares.filter((y) => y.stripePaymentIntentId && !y.refundedAt)) { const ok = await refundPaymentIntent(t0.stripeAccountId || t0.stripeConnectAccountId || null, String(x.stripePaymentIntentId)); if (ok) { x.refundedAt = new Date().toISOString(); refundedCards++; } else failed.push(`$${(num(x.amount) + num(x.tip)).toFixed(2)}`); }
        if (failed.length) { await ref.set({ tenders: shares }, { merge: true }); return NextResponse.json({ ok: false, error: `The refund for ${failed.join(', ')} didn’t go through — try again (cards already refunded won’t be refunded twice).` }, { status: 502 }); } }
      const cashToReturn = Math.round(shares.filter((y) => y.method === 'cash').reduce((a, y) => a + num(y.amount) + num(y.tip), 0) * 100) / 100;
      await ref.set({ status: 'discarded', discardedAt: new Date().toISOString(), discardedBy: auth.actor.name, discardReason: reason, ...(shares.length ? { tenders: shares, cashToReturn } : {}) }, { merge: true });
      await logAuditAdmin(db, tenantId, { action: 'checkout.discarded', targetType: 'client', targetId: pc.clientId || '', summary: `Unrecorded sale for ${pc.clientName || 'a client'} ($${Number(pc.expectedTotal || 0).toFixed(2)}) discarded — ${reason}`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
      return NextResponse.json({ ok: true, discarded: true, refundedCards: (typeof refundedCards === 'number' ? refundedCards : 0), cashToReturn: (typeof cashToReturn === 'number' ? cashToReturn : 0) });
    }
    const replay = { ...(pc.payload || {}), tenantId, pendingId: ref.id, expectedTotal: pc.expectedTotal, payment: { ...(pc.payload?.payment || {}), ...(Array.isArray(pc.tenders) && pc.tenders.length ? { method: 'split' } : {}), ...(pc.paymentIntentId ? { stripePaymentIntentId: pc.paymentIntentId } : {}) }, recordedLater: true };
    const r = await runCheckout(db, tenantId, replay, auth, req);
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = await runCheckout(db, tenantId, b, auth, req);
  return NextResponse.json(r.body, { status: r.status });
}

async function runCheckout(db: any, tenantId: string, b: any, auth: any, req: NextRequest): Promise<{ body: any; status: number }> {
  const T0 = `tenants/${tenantId}`;
  // Never record the same sale twice — by its ticket, or by its card payment.
  const pendingRef = b.pendingId ? db.doc(`${T0}/pendingCheckouts/${String(b.pendingId)}`) : null;
  if (pendingRef) { const pc: any = (await pendingRef.get()).data(); if (pc?.status === 'completed') return json({ ok: true, already: true, receiptId: pc.receiptId || null, checkoutSessionId: pc.checkoutSessionId || null, total: pc.total ?? null, warnings: [] }); }
  if (b.payment?.stripePaymentIntentId) { const dup = await db.collection(`${T0}/receipts`).where('stripePaymentIntentId', '==', String(b.payment.stripePaymentIntentId)).get();
    if (!dup.empty) return json({ ok: true, already: true, receiptId: dup.docs[0].id, total: (dup.docs[0].data() as any).total ?? null, warnings: [] }); }
  const failPending = async (why: string) => { if (pendingRef) await pendingRef.set({ status: 'failed', lastError: why.slice(0, 300), failedAt: new Date().toISOString(), ...(b.payment?.stripePaymentIntentId ? { paymentIntentId: String(b.payment.stripePaymentIntentId) } : {}) }, { merge: true }).catch(() => {}); };
  const clientId = String(b.clientId || '');
  const apptIds: string[] = Array.isArray(b.appointmentIds) ? b.appointmentIds.map(String).slice(0, 20) : [];
  const reqItems: any[] = Array.isArray(b.items) ? b.items.slice(0, 60) : [];
  if (!clientId) return json({ ok: false, error: 'Choose who’s paying.' }, 400);
  if (!apptIds.length && !reqItems.length && !(Array.isArray(b.feeIds) && b.feeIds.length)) return json({ ok: false, error: 'Nothing to check out.' }, 400);
  const pay = b.payment || {}; const method = String(pay.method || 'card'); const skipLedger = pay.skipLedger === true;
  // A split bill: the shares already taken (recorded on the started ticket) pay for this sale together.
  let split: any[] | null = null;
  if (method === 'split') {
    const pcs: any = pendingRef ? (await pendingRef.get()).data() : null; split = Array.isArray(pcs?.tenders) ? pcs.tenders : [];
    if (!split || !split.length) return json({ ok: false, error: 'No payments have been taken for this split yet.' }, 400);
  }
  const splitCash = split ? split.filter((x) => x.method === 'cash').reduce((s, x) => s + num(x.amount) + num(x.tip), 0) : 0;
  const splitTips = split ? split.reduce((s, x) => s + num(x.tip), 0) : 0;
  const T = T0;
  const now = new Date().toISOString(); const checkoutSessionId = rid();

  // ── Load everything from the server ──
  const [tSnap, cSnap, stSnap, svSnap, invSnap, mSnap, pSnap, dSnap] = await Promise.all([
    db.doc(T).get(), db.doc(`${T}/clients/${clientId}`).get(), db.collection(`${T}/staff`).get(), db.collection(`${T}/services`).get(),
    db.collection(`${T}/inventory`).get(), db.collection(`${T}/memberships`).get(), db.collection(`${T}/packages`).get(), db.collection(`${T}/discounts`).get(),
  ]);
  const tenant: any = tSnap.data() || {}; const client: any = cSnap.exists ? { id: clientId, ...(cSnap.data() as any) } : null;
  if (!client) return json({ ok: false, error: 'That client wasn’t found.' }, 404);
  const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const staff = rows(stSnap), services = rows(svSnap), inventory = rows(invSnap), memberships = rows(mSnap), packages = rows(pSnap), allDiscounts = rows(dSnap);
  const svc = (id: string) => services.find((s: any) => s.id === id);
  const visits: any[] = [];
  for (const id of apptIds) {
    const a: any = (await db.doc(`${T}/appointments/${id}`).get()).data();
    if (!a) return json({ ok: false, error: 'One of these visits wasn’t found — refresh and try again.' }, 404);
    if (a.status === 'completed' && a.checkoutSessionId) return json({ ok: false, error: `${a.clientName || 'This visit'} has already been checked out.` }, 409);
    visits.push({ appointment: { ...a, id }, service: svc(a.serviceId) || { id: a.serviceId, name: a.serviceName || 'Service', price: num(a.price) }, addOnServices: (a.addOnIds || []).map((x: string) => svc(x)).filter(Boolean) });
  }
  // Sale items, priced here (never by the browser) — except next-visit deposits (capped by that booking's deposit) and rentals.
  const items: any[] = [];
  for (const it of reqItems) {
    const qty = ['rent', 'tuition'].includes(String(it.type)) ? 1 : Math.max(1, Math.min(99, Math.round(num(it.quantity) || 1))); const type = String(it.type || 'product'); const id = String(it.id || '');
    let price = num(it.price), name = String(it.name || 'Item'), stock: number | null = null;
    if (type === 'product') { const p = inventory.find((x: any) => x.id === id); if (!p) return json({ ok: false, error: `${name} isn’t in your inventory any more.` }, 400); price = num(p.msrp || p.costPerUnit); name = p.name || name; stock = num(p.totalStock); }
    else if (type === 'service') { const s = svc(id); if (s) { price = num(s.price); name = s.name || name; } }
    else if (type === 'tuition') { const acct: any = await tuitionAccount(db, tenantId, String(it.planId || '')); if (!acct) return json({ ok: false, error: 'That tuition plan wasn’t found.' }, 400);
      if (!acct.open) return json({ ok: false, error: 'That student isn’t enrolled yet — their down payment is taken on their application link.' }, 400);
      price = Math.round(num(it.price) * 100) / 100; if (!(price > 0)) return json({ ok: false, error: 'Enter the tuition amount they’re paying.' }, 400);
      if (Math.round(price * 100) > acct.balanceCents) return json({ ok: false, error: `That’s more than they owe ($${(acct.balanceCents / 100).toFixed(2)}).` }, 400);
      name = `Tuition — ${acct.name} · ${acct.program}`; (it as any).__tacct = acct; }
    else if (type === 'rent') { const acct: any = await renterAccount(db, T, String(it.renterId || '')); if (!acct) return json({ ok: false, error: 'That renter wasn’t found.' }, 400);
      price = Math.round(num(it.price) * 100) / 100; if (!(price > 0) || price > 20000) return json({ ok: false, error: 'Enter the rent amount they’re paying.' }, 400);
      name = `Rent — ${acct.name}${acct.booth?.name ? ` · ${acct.booth.name}` : ''}`; (it as any).__acct = acct; }
    else if (type === 'membership') { const m = memberships.find((x: any) => x.id === id); if (!m) return json({ ok: false, error: 'That membership wasn’t found.' }, 400); price = num(m.price); name = m.name || name; }
    else if (type === 'package') { const p = packages.find((x: any) => x.id === id); if (!p) return json({ ok: false, error: 'That package wasn’t found.' }, 400); price = num(p.price); name = p.name || name; }
    else if (type === 'deposit' && it.depositForAppointmentId) { const ap: any = (await db.doc(`${T}/appointments/${String(it.depositForAppointmentId)}`).get()).data() || {}; const max = num(ap.depositAmountCents) / 100; if (max > 0) price = Math.min(price || max, max); }
    items.push({ id, type, quantity: qty, price: Math.max(0, price), name, stock, reservationId: it.reservationId || null, depositForAppointmentId: it.depositForAppointmentId || null, ...((it as any).__acct ? { __acct: (it as any).__acct } : {}), ...((it as any).__tacct ? { __tacct: (it as any).__tacct } : {}) });   // rent carries its renter's account to the payment step
  }
  // Everyone on the ticket: the payer, and whoever had each visit (a friend, partner or parent may be paying).
  const people: Record<string, any> = { [clientId]: client };
  for (const v of visits) { const cid = String(v.appointment.clientId || ''); if (cid && !people[cid]) { const d: any = (await db.doc(`${T}/clients/${cid}`).get()).data(); if (d) people[cid] = { id: cid, ...d }; } }
  const whoHad = (v: any) => people[String(v.appointment.clientId || '')] || client;
  // Owed fees being paid — from whoever owes them (not just the payer).
  const wantFees: string[] = Array.isArray(b.feeIds) ? b.feeIds : [];
  const fees = Object.values(people).flatMap((p: any) => (p.unpaidFees || []).filter((f: any) => wantFees.includes(f.feeId)).map((f: any) => ({ ...f, __owner: p.id })));
  const codes: string[] = Array.isArray(b.discountCodes) ? b.discountCodes.map((c: any) => String(c).toUpperCase()).slice(0, 5) : [];
  const discounts = codes.map((c) => allDiscounts.find((d: any) => String(d.code || '').toUpperCase() === c)).filter(Boolean);
  const redeemedOffer = b.redeemedOffer && b.redeemedOffer.id ? { type: String(b.redeemedOffer.type), id: String(b.redeemedOffer.id), itemId: b.redeemedOffer.itemId ? String(b.redeemedOffer.itemId) : undefined } : null;
  const waivedIds: string[] = Array.isArray(b.waivedAppointmentIds) ? b.waivedAppointmentIds.map(String) : [];
  const tipAllocations: Record<string, number> = b.tipAllocations && typeof b.tipAllocations === 'object' ? b.tipAllocations : {};
  // WHO EARNS EACH LINE. Retail: the seller (chosen at the till, else whoever rang it up) — for retail commission.
  // A renter's visit (and a tip for a renter) is THEIR money: recorded as collected for them, never studio revenue,
  // and owed to them in their Books until the owner settles it (rule: renters' money is kept separate).
  const soldBy: string | null = b.soldBy && staff.some((s: any) => s.id === String(b.soldBy)) ? String(b.soldBy) : (auth.actor.uid || null);
  const renterOf = (sid: string) => { const s = staff.find((x: any) => x.id === sid); return s?.isRenter === true ? s : null; };
  const deskCollected: { renterId: string; staffId: string; cents: number; kind: 'service' | 'tip'; appointmentId: string | null; clientName?: string; serviceName?: string }[] = [];
  const tip = Math.max(0, num(b.tip)) + (typeof splitTips === 'number' ? splitTips : 0);   // + tips added on split shares
  // Moments (birthday / first visit / milestone) — worked out here from the client's own record and visit count.
  const doneBefore = (await db.collection(`${T}/appointments`).where('clientId', '==', clientId).get()).docs.filter((d: any) => (d.data() as any).status === 'completed' && !apptIds.includes(d.id)).length;
  const pre = prebookMoment(visits.map((v: any) => v.appointment));
  const moment = bestMomentReward([...momentsFor(tenant, client, doneBefore, new Date(), visits.length > 0), ...(pre ? [pre] : [])]);
  const sdIn = b.staffDiscount && ['pct', 'amt'].includes(b.staffDiscount.kind) && num(b.staffDiscount.value) > 0 ? { kind: b.staffDiscount.kind as 'pct' | 'amt', value: Math.max(0, num(b.staffDiscount.value)) } : null;
  const calc = computeCheckout({ tenant, visits, staff, redeemedOffer, waivedIds, items, fees, discounts, client, memberships, tip, storeCredit: Math.max(0, num(b.storeCredit)), staffDiscount: sdIn, skipGroupDiscount: b.skipGroupDiscount === true, momentReward: moment ? { pct: moment.rewardPct, label: moment.rewardLabel || 'Thank-you', key: moment.key } : null });
  const recoveryAmount = Math.min(Math.max(0, num(b.recovery?.amount)), calc.subtotal);
  const recoveryReason = String(b.recovery?.reason || 'Service Recovery Adjustment').slice(0, 200);
  const cardSurcharge = Math.max(0, num(pay.cardSurcharge));
  // ── Approvals (checked HERE — the browser can't skip them). Managers checking out approve by being signed in. ──
  const actorIsManager = isApprover(auth.actor.role);
  const approvedWaivers: Record<string, { by: string; reason: string | null }> = {};
  for (const id of waivedIds) {
    if (actorIsManager) { approvedWaivers[id] = { by: auth.actor.name, reason: b.waivers?.[id]?.reason || null }; continue; }
    const ok = await consumeApproval(db, tenantId, b.waivers?.[id]?.approvalToken, { kind: 'waive', ref: id });
    if (!ok) { await failPending('A fee waiver wasn’t approved by a manager.'); return json({ ok: false, error: 'Waiving fees needs a manager’s approval — ask a manager to enter their PIN.' }, 403); }
    approvedWaivers[id] = { by: ok.approverName, reason: ok.reason || b.waivers?.[id]?.reason || null };
  }
  // Staff discount: front desk up to the business's limit (10% by default); above it, a manager approves. Managers aren't limited.
  let staffDiscountApprovedBy: string | null = null;
  const staffDiscountReason = String(b.staffDiscount?.reason || '').trim().slice(0, 200);
  if (calc.staffDiscount > 0) {
    if (!staffDiscountReason) return json({ ok: false, error: 'A staff discount needs a reason.' }, 400);
    const limitPct = Number.isFinite(Number(tenant?.approvalRules?.staffDiscountLimitPct)) ? Number(tenant.approvalRules.staffDiscountLimitPct) : 10;
    const pctGiven = calc.subtotal > 0 ? (calc.staffDiscount / calc.subtotal) * 100 : 0;
    if (!actorIsManager && pctGiven > limitPct + 0.001) {
      const ok = await consumeApproval(db, tenantId, b.staffDiscount?.approvalToken, { kind: 'discount', amount: calc.staffDiscount });
      if (!ok) { await failPending('A staff discount over the limit wasn’t approved.'); return json({ ok: false, error: `That discount is over your ${limitPct}% limit — a manager needs to approve it.` }, 403); }
      staffDiscountApprovedBy = ok.approverName;
    } else if (actorIsManager) staffDiscountApprovedBy = auth.actor.name;
  }
  let recoveryApprovedBy: string | null = null;
  if (recoveryAmount > 0) {
    const { overStaffLimit } = await import('@/lib/staff-limit');   // one rule for discounts and store credit
    const over = overStaffLimit(tenant, recoveryAmount, calc.subtotal);
    if (over && !actorIsManager) {
      const ok = await consumeApproval(db, tenantId, b.recovery?.approvalToken, { kind: 'recovery', amount: recoveryAmount });
      if (!ok) { await failPending('Service recovery above the limit wasn’t approved.'); return json({ ok: false, error: `Service recovery over your limit needs a manager’s approval ($${recoveryAmount.toFixed(2)}).` }, 403); }
      recoveryApprovedBy = ok.approverName;
    } else if (over) recoveryApprovedBy = auth.actor.name;
  }
  const expected = num(b.expectedTotal); const mismatch = Number.isFinite(expected) && b.expectedTotal !== undefined && Math.abs(expected - calc.total) > 0.01;

  // ── Deposit credit (newest available, not expired) ──
  let depositCredit: any = null;
  try {
    let cs = await db.collection(`${T}/depositCredits`).where('status', '==', 'available').where('clientId', '==', clientId).get();
    if (cs.empty && client.email) cs = await db.collection(`${T}/depositCredits`).where('status', '==', 'available').where('clientEmail', '==', String(client.email).toLowerCase().trim()).get();
    const found = cs.docs.map((d: any) => ({ ref: d.ref, ...(d.data() as any) })).filter((c: any) => !isCreditExpired(c.expiresAt)).sort((x: any, y: any) => Date.parse(y.createdAt || 0) - Date.parse(x.createdAt || 0));
    depositCredit = found[0] || null;
  } catch (e) { console.warn('[checkout] deposit credit lookup', e); }
  const depositCreditDollars = depositCredit ? num(depositCredit.amountDollars ?? num(depositCredit.amountCents) / 100) : 0;

  // ── Write it all, together ──
  const batch = db.batch();
  const txn = (f: any) => { if (!skipLedger) { const r = db.collection(`${T}/transactions`).doc(); batch.set(r, clean({ id: r.id, date: now, clientOrVendor: client.name || 'Client', clientId, payerClientId: clientId, paidBy: client.name || null, tenantId, checkoutSessionId, ...f })); } };
  const spend: Record<string, number> = {};   // lifetime value, by person
  const credit = (cid: string, amt: number) => { spend[cid] = (spend[cid] || 0) + amt; };
  let totalLtvIncrease = 0, totalCashIncrease = 0, cashTipsTotal = 0;
  const add = (amt: number) => { totalLtvIncrease += amt; if (method === 'cash') totalCashIncrease += amt; };
  const cashTipsByStaff: Record<string, any> = {}; const cashTipsPlain: Record<string, number> = {};
  const tmhr = num(tenant.tmhr) || 50;
  for (const [idx, v] of visits.entries()) {
    const vc = calc.visits[idx]; const a = v.appointment; const mainStaff = staff.find((s: any) => s.id === vc.mainStaffId);
    const had = whoHad(v); const forHad = { clientId: had.id, clientOrVendor: had.name || 'Client' };   // the visit is theirs; the payer is on every line
    const before = totalLtvIncrease;
    add(vc.mainPrice);
    const rStaff = vc.renter ? staff.find((s: any) => s.id === vc.renterStaffId) : null;
    const asRenter = vc.renter ? { category: 'Collected for renter', taxBucket: 'pass_through', renterId: String(rStaff?.renterId || a.renterId || '') || null, renterStaffId: vc.renterStaffId } : {};
    const tookOver = (sid: string) => (a.staffId && sid && sid !== a.staffId ? { bookedWithStaffId: a.staffId } : {});   // someone else stepped in
    txn({ ...forHad, description: vc.mainRedeemed ? `Redemption: ${v.service.name}` : `Service: ${vc.renter && a.renterServiceName ? a.renterServiceName : v.service.name}`, type: 'income', context: 'Business', category: 'Service Revenue', taxBucket: 'revenue', amount: vc.mainPrice, paymentMethod: method, staffId: vc.mainStaffId, appointmentId: a.id, hasReceipt: true, ...asRenter, ...tookOver(vc.mainStaffId) });
    if (vc.mainRedeemed) { const cost = computeServiceCost(v.service, a, mainStaff, inventory, tmhr); if (cost.total > 0) txn({ description: `Redemption Cost: ${v.service.name}`, type: 'expense', context: 'Business', category: 'Comp & Redemption Cost', taxBucket: 'operating_cost', amount: cost.total, paymentMethod: 'Internal', staffId: vc.mainStaffId, appointmentId: a.id, hasReceipt: false, notes: `Materials $${cost.materials.toFixed(2)} · Overhead $${cost.overhead.toFixed(2)} · Labor $${cost.labor.toFixed(2)}` }); }
    for (const ad of vc.addOns) {
      if (ad.redeemed) { const cost = computeServiceCost(ad.addon, a, staff.find((s: any) => s.id === ad.staffId), inventory, tmhr); if (cost.total > 0) txn({ description: `Redemption Cost: ${ad.addon.name}`, type: 'expense', context: 'Business', category: 'Comp & Redemption Cost', taxBucket: 'operating_cost', amount: cost.total, paymentMethod: 'Internal', staffId: ad.staffId, appointmentId: a.id, hasReceipt: false }); }
      add(ad.price);
      txn({ ...forHad, description: `${ad.redeemed ? 'Redemption' : 'Add-on'}: ${ad.addon.name}`, type: 'income', context: 'Business', category: 'Service Revenue', taxBucket: 'revenue', amount: ad.price, paymentMethod: method, staffId: ad.staffId, appointmentId: a.id, hasReceipt: true, ...asRenter, ...tookOver(ad.staffId) });
    }
    const fee = (amount: number, description: string, category: string) => { if (amount > 0) { add(amount); txn({ ...forHad, description, type: 'income', context: 'Business', category, taxBucket: 'adjustment', amount, paymentMethod: method, staffId: vc.mainStaffId, appointmentId: a.id, hasReceipt: false }); } };
    fee(vc.rescheduleFee, `Reschedule Recovery: ${v.service.name}`, 'Protocol Recovery');
    fee(vc.timeOverage, `Time Floor Overage: ${v.service.name}`, 'Strategic Adjustment');
    fee(vc.materialOverage, `Material Protocol Overage: ${v.service.name}`, 'Strategic Adjustment');
    fee(vc.additionalCharge, 'Strategic Adjustment Fee', 'Adjustment Fee');
    for (const r of vc.refreshments) { const amt = r.price * r.qty; if (amt > 0) { add(amt); txn({ ...forHad, description: `Concierge: ${r.name} (x${r.qty})`, type: 'income', context: 'Business', category: 'Hospitality Revenue', taxBucket: 'revenue', amount: amt, paymentMethod: method, appointmentId: a.id, hasReceipt: false }); } }
    credit(had.id, totalLtvIncrease - before);   // the visit's value counts for the person who had it
    if (vc.renter) { const cents = Math.round((vc.mainPrice + vc.addOns.reduce((t: number, x: any) => t + x.price, 0)) * 100);
      if (cents > 0) deskCollected.push({ renterId: String((asRenter as any).renterId || ''), staffId: String(vc.renterStaffId || ''), cents, kind: 'service', appointmentId: a.id, clientName: had.name || 'Client', serviceName: a.renterServiceName || v.service?.name || 'Service' }); }
    const revenue = vc.mainPrice + vc.addOns.reduce((s: number, x: any) => s + x.price, 0);
    const waiver = vc.waived ? { authorizerId: b.waivers?.[a.id]?.authorizerId, reason: approvedWaivers[a.id]?.reason || b.waivers?.[a.id]?.reason, verifiedBy: approvedWaivers[a.id]?.by } : null;   // who approved (verified above), and why
    batch.set(db.doc(`${T}/appointments/${a.id}`), clean({ status: 'completed', stage: 'complete', timeline: [...(Array.isArray(a.timeline) ? a.timeline : []), { at: now, kind: 'stage', stage: 'complete', text: `Paid — ${method === 'split' ? 'split between payments' : method.replace(/_/g, ' ')}`, by: auth.actor.name || 'Staff', via: 'checkout' }].slice(-60), statusBeforeCheckout: a.status || 'checked_in', revenue, actualEndTime: now, checkoutSessionId, checkedOutAt: now, checkedOutBy: auth.actor.name,
      ...(waiver ? { feesWaived: { by: String(waiver.authorizerId || auth.actor.uid || ''), byName: waiver.verifiedBy || staff.find((s: any) => s.id === waiver.authorizerId)?.name || auth.actor.name, reason: String(waiver.reason || '').slice(0, 200) || null, at: now } } : {}) }), { merge: true });
    if (waiver) await logAuditAdmin(db, tenantId, { action: 'checkout.fees_waived', targetType: 'appointment', targetId: a.id, summary: `Fees waived for ${had.name || 'a client'} — approved by ${waiver.verifiedBy || staff.find((s: any) => s.id === waiver.authorizerId)?.name || 'a manager'}${waiver.reason ? `: ${waiver.reason}` : ''}`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
    if (a.checkInToken) { batch.set(db.doc(`appointmentCheckIns/${a.checkInToken}`), { status: 'completed', tenantId }, { merge: true }); batch.set(db.doc(`${T}/appointmentCheckIns/${a.checkInToken}`), { status: 'completed' }, { merge: true }); }
    const involved = new Set<string>([a.staffId, vc.mainStaffId, ...vc.addOns.map((x: any) => x.staffId)].filter(Boolean));
    for (const sid of involved) batch.set(db.doc(`${T}/staff/${sid}`), { status: 'available', lastWalkInCompletedAt: now }, { merge: true });
  }
  const toEnroll: { offeringType: 'membership' | 'package'; offeringId: string }[] = [];
  const rentPayments: any[] = [];
  const receiptRef = db.collection(`${T}/receipts`).doc();   // made early: a rent payment points to its receipt
  for (const it of items) {
    const value = it.price * it.quantity;
    const category = it.type === 'deposit' ? 'Retainers' : it.type === 'service' ? 'Service Revenue' : it.type === 'membership' ? 'Membership Sales' : it.type === 'package' ? 'Package Sales' : it.type === 'rental' ? 'Space Rental' : it.type === 'rent' ? 'Booth Rent' : it.type === 'tuition' ? 'Tuition' : 'Retail';
    const description = it.type === 'deposit' ? `Deposit: ${it.name}` : it.type === 'service' ? `Service (POS): ${it.quantity}x ${it.name}` : it.type === 'membership' ? `Membership: ${it.name}` : it.type === 'package' ? `Package: ${it.name}` : it.type === 'rental' ? `Space rental: ${it.name}` : it.type === 'rent' ? `Booth rent: ${it.name}` : it.type === 'tuition' ? `Tuition: ${it.name}` : `Retail Product: ${it.quantity}x ${it.name}`;
    txn({ description, type: 'income', context: 'Business', category, amount: value, paymentMethod: method, hasReceipt: true, itemId: it.id, itemType: it.type, quantity: it.quantity, ...(it.type === 'product' && soldBy ? { staffId: soldBy, soldBy } : {}) });
    if (it.type === 'product') {
      batch.set(db.doc(`${T}/inventory/${it.id}`), { totalStock: FieldValue.increment(-it.quantity) }, { merge: true });
      const sc = db.collection(`${T}/stockCorrections`).doc();
      batch.set(sc, clean({ productId: it.id, date: now, change: -it.quantity, unit: 'units', reason: `Retail Sale: ${it.name} for ${client.name || 'Guest'}`, actorId: auth.actor.uid || 'staff', actorName: auth.actor.name || 'Staff', source: 'stock_ledger', type: 'sold', field: 'totalStock', balanceAfter: Math.max(0, num(it.stock) - it.quantity), refKind: 'checkout', refId: checkoutSessionId }));
    }
    if (it.type === 'membership' || it.type === 'package') toEnroll.push({ offeringType: it.type, offeringId: it.id });
    if (it.type === 'rent' && it.__acct) rentPayments.push(applyRentPayment(batch, db, T, it.__acct, { amountCents: Math.round(value * 100), method: String(method), receiptId: receiptRef.id, transactionId: checkoutSessionId, now, by: auth.actor.name || 'Front desk' }));   // the renter's rent ledger, oldest charges first
    if (it.type === 'rental' && it.reservationId) batch.set(db.doc(`${T}/boothReservations/${it.reservationId}`), { paymentStatus: 'paid', paidAt: now, paidVia: 'pos' }, { merge: true });
    add(value);
  }
  if (fees.length) {
    const settled = fees.reduce((s: number, f: any) => s + num(f.feeAmount), 0);
    const ids = new Set(fees.map((f: any) => f.feeId));
    for (const ownerId of new Set(fees.map((f: any) => f.__owner))) {
      const owner: any = people[ownerId]; const theirs = fees.filter((f: any) => f.__owner === ownerId).reduce((s: number, f: any) => s + num(f.feeAmount), 0);
      batch.set(db.doc(`${T}/clients/${ownerId}`), { unpaidFees: (owner.unpaidFees || []).filter((f: any) => !ids.has(f.feeId)), outstandingBalance: FieldValue.increment(-theirs) }, { merge: true });
    }
    if (method === 'cash') totalCashIncrease += settled;
    for (const f of fees) txn({ feeId: f.feeId, feeReason: f.reason || null, clientId: f.__owner, clientOrVendor: people[f.__owner]?.name || 'Client', description: `Debt Settlement: ${f.reason || 'fee'}`, type: 'income', context: 'Business', category: 'Fee Recovery', taxBucket: 'adjustment', amount: num(f.feeAmount), paymentMethod: method, hasReceipt: false });
    totalLtvIncrease += settled;
  }
  // Client: lifetime value, last visit, package session / membership perk used.
  const visitSpend = Object.values(spend).reduce((s, x) => s + x, 0);
  credit(clientId, Math.max(0, totalLtvIncrease - visitSpend - calc.discount - calc.memberDiscount - recoveryAmount));   // the rest (products, fees, card fee), less discounts
  for (const [cid, amt] of Object.entries(spend)) if (cid !== clientId) batch.set(db.doc(`${T}/clients/${cid}`), { lifetimeValue: FieldValue.increment(Math.max(0, amt)), lastAppointment: now }, { merge: true });
  const payerHadVisit = !visits.length || visits.some((v) => whoHad(v).id === clientId);   // someone who only paid didn't visit
  const clientUpd: any = { lifetimeValue: FieldValue.increment(Math.max(0, spend[clientId] || 0)), ...(payerHadVisit ? { lastAppointment: now } : {}) };
  // This month's team / family discount use (for the monthly cap).
  const gMonth = monthKey(new Date(now));
  if (calc.momentDiscount > 0 && calc.moment) clientUpd[`momentRewards.${calc.moment.key}`] = now;   // a birthday treat once a year; a milestone once
  if (calc.groupDiscount > 0) clientUpd.teamDiscountUsage = client.teamDiscountUsage?.month === gMonth ? { month: gMonth, amount: FieldValue.increment(calc.groupDiscount) } : { month: gMonth, amount: calc.groupDiscount };
  // A package session / membership perk comes off the account of whoever used it.
  const usedBy: any = redeemedOffer ? (visits.map((v) => ({ v, has: [v.service?.id, ...(v.addOnServices || []).map((x: any) => x.id)].includes(redeemedOffer.itemId) })).find((x) => x.has) ? whoHad(visits.find((v) => [v.service?.id, ...(v.addOnServices || []).map((x: any) => x.id)].includes(redeemedOffer.itemId))) : client) : client;
  if (redeemedOffer && usedBy.id !== clientId) {
    const rr = db.collection(`${T}/clients/${usedBy.id}/redemptions`).doc();
    const offeringName = redeemedOffer.type === 'membership' ? memberships.find((m: any) => m.id === redeemedOffer.id)?.name : packages.find((p: any) => p.id === redeemedOffer.id)?.name;
    batch.set(rr, clean({ id: rr.id, clientId: usedBy.id, paidBy: clientId, type: redeemedOffer.type, offeringId: redeemedOffer.id, offeringName: offeringName || 'Offer', serviceId: redeemedOffer.itemId, redeemedAt: now, checkoutSessionId, appointmentId: apptIds[0] || null }));
    batch.set(db.doc(`${T}/clients/${usedBy.id}`), redeemedOffer.type === 'package'
      ? { activePackages: (usedBy.activePackages || []).map((p: any) => (p.packageId === redeemedOffer.id ? { ...p, sessionsRemaining: num(p.sessionsRemaining) - 1 } : p)).filter((p: any) => num(p.sessionsRemaining) > 0) }
      : { subscription: { perkUsage: { [String(redeemedOffer.itemId)]: FieldValue.increment(1) }, perkLastUsed: now } }, { merge: true });
  }
  if (redeemedOffer && usedBy.id === clientId) {
    const rr = db.collection(`${T}/clients/${clientId}/redemptions`).doc();
    const offeringName = redeemedOffer.type === 'membership' ? memberships.find((m: any) => m.id === redeemedOffer.id)?.name : packages.find((p: any) => p.id === redeemedOffer.id)?.name;
    batch.set(rr, clean({ id: rr.id, clientId, type: redeemedOffer.type, offeringId: redeemedOffer.id, offeringName: offeringName || 'Offer', serviceId: redeemedOffer.itemId, serviceName: svc(String(redeemedOffer.itemId))?.name || null, redeemedAt: now, checkoutSessionId, appointmentId: apptIds[0] || null }));
    if (redeemedOffer.type === 'package') clientUpd.activePackages = (client.activePackages || []).map((p: any) => (p.packageId === redeemedOffer.id ? { ...p, sessionsRemaining: num(p.sessionsRemaining) - 1 } : p)).filter((p: any) => num(p.sessionsRemaining) > 0);
    else { clientUpd[`subscription.perkUsage.${redeemedOffer.itemId}`] = FieldValue.increment(1); clientUpd['subscription.perkLastUsed'] = now; }
  }
  batch.update(db.doc(`${T}/clients/${clientId}`), clientUpd);
  // Tips, by who they're for (unallocated → the main provider, else the cashier).
  const alloc: Record<string, number> = { ...tipAllocations };
  if (tip > 0 && !Object.keys(alloc).length) alloc[visits[0] ? calc.visits[0].mainStaffId : (auth.actor.uid || 'unassigned')] = tip;
  else if (split && splitTips > 0) { const k = visits[0] ? calc.visits[0].mainStaffId : (auth.actor.uid || 'unassigned'); alloc[k] = num(alloc[k]) + splitTips; }   // tips added on split shares
  for (const [sid, amount] of Object.entries(alloc)) { const amt = num(amount); if (amt <= 0) continue;
    const rt = renterOf(sid); if (rt) deskCollected.push({ renterId: String(rt.renterId || ''), staffId: sid, cents: Math.round(amt * 100), kind: 'tip', appointmentId: apptIds[0] || null });
    txn({ description: sid === '__school' ? 'Gratuity — school (student salon)' : 'Gratuity', type: 'income', context: 'Business', category: rt ? 'Tips collected for renter' : 'Tips', taxBucket: rt ? 'pass_through' : 'gratuity', ...(rt ? { renterId: rt.renterId || null, renterStaffId: sid } : {}), amount: amt, paymentMethod: method, staffId: sid, hasReceipt: true });
    if (method === 'cash') { cashTipsTotal += amt; cashTipsByStaff[sid] = FieldValue.increment(amt); cashTipsPlain[sid] = (cashTipsPlain[sid] || 0) + amt; } }
  if (calc.codeDiscount > 0) txn({ description: 'Promotion Applied', clientOrVendor: 'Internal', type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: calc.codeDiscount, paymentMethod: 'Internal', hasReceipt: false });
  if (calc.momentDiscount > 0 && calc.moment) txn({ description: `${calc.moment.label} — ${client.name || 'client'}`, type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: calc.momentDiscount, paymentMethod: 'Internal', hasReceipt: false, discountKind: 'moment', momentKey: calc.moment.key });
  if (calc.groupDiscount > 0 && calc.group) txn({ description: `${calc.group.label} — ${client.name || 'client'}`, type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: calc.groupDiscount, paymentMethod: 'Internal', hasReceipt: false, discountKind: calc.group.type === 'team' ? 'team' : 'family', linkedStaffId: calc.group.staffId || null });
  if (calc.staffDiscount > 0) txn({ description: `Staff discount — ${staffDiscountReason}${staffDiscountApprovedBy ? ` · approved by ${staffDiscountApprovedBy}` : ''}`, type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: calc.staffDiscount, paymentMethod: 'Internal', hasReceipt: false, notes: staffDiscountReason, discountKind: 'staff', givenBy: auth.actor.name, ...(staffDiscountApprovedBy ? { approvedBy: staffDiscountApprovedBy } : {}) });
  if (recoveryAmount > 0) txn({ description: `Service Recovery: ${recoveryReason}`, type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: recoveryAmount, notes: recoveryReason, paymentMethod: 'Internal', hasReceipt: false, ...(recoveryApprovedBy ? { approvedBy: recoveryApprovedBy } : {}) });
  if (calc.tax > 0) txn({ description: calc.taxLabel, type: 'income', context: 'Business', category: 'Tax Collected', taxBucket: 'tax_collected', amount: calc.tax, paymentMethod: method, hasReceipt: false });
  if (cardSurcharge > 0) { txn({ description: 'Card Processing Fee (passed to client)', type: 'income', context: 'Business', category: 'Card Processing Fee', taxBucket: 'revenue', amount: cardSurcharge, paymentMethod: method, hasReceipt: false }); totalLtvIncrease += cardSurcharge; }
  let cashDepositOffset = 0;
  if (depositCredit && depositCreditDollars > 0) {
    txn({ depositCreditId: depositCredit.ref.id, description: 'Deposit applied (prepaid online)', type: 'expense', context: 'Business', category: 'Deposit Applied', taxBucket: 'adjustment', amount: depositCreditDollars, paymentMethod: 'Deposit', hasReceipt: false });
    batch.set(depositCredit.ref, { status: 'consumed', consumedAt: now, appointmentId: apptIds[0] || null }, { merge: true });
    cashDepositOffset = Math.min(depositCreditDollars, totalCashIncrease);
  }
  // Cash into the till = what the client actually handed over: the sale total (tax included; discounts and recovery
  // taken off) less any deposit they'd already paid. (The old way added up line prices — tax was missed and
  // discounts ignored, so the till's expected cash drifted.) Split into sales and tips.
  if (split) {   // tips added on CASH shares are cash tips in the till (credited to the main provider)
    const cashTip = split.filter((x) => x.method === 'cash').reduce((t, x) => t + num(x.tip), 0);
    if (cashTip > 0) { const k = visits[0] ? calc.visits[0].mainStaffId : (auth.actor.uid || 'unassigned'); cashTipsTotal += cashTip; cashTipsByStaff[k] = FieldValue.increment(cashTip); cashTipsPlain[k] = (cashTipsPlain[k] || 0) + cashTip; }
  }
  const depositUsed = depositCredit && depositCreditDollars > 0 ? Math.min(depositCreditDollars, calc.total) : 0;
  const cashIn = method === 'cash' ? Math.max(0, Math.round((calc.total - depositUsed) * 100) / 100) : split ? Math.round(splitCash * 100) / 100 : 0;
  if (split) {   // the shares must cover what's owed
    const paid = split.reduce((s, x) => s + num(x.amount) + num(x.tip), 0); const owed = Math.max(0, Math.round((calc.total - depositUsed) * 100) / 100);
    if (paid + 0.01 < owed) return json({ ok: false, error: `Still $${(owed - paid).toFixed(2)} to pay on this bill.`, owed, paid }, 409);
  }
  const cashSalesAmt = Math.max(0, Math.round((cashIn - cashTipsTotal) * 100) / 100);
  void cashDepositOffset;
  if ((method === 'cash' || (split && cashIn > 0)) && b.tillId) batch.set(db.doc(`${T}/tillSessions/${String(b.tillId)}`), { expectedCash: FieldValue.increment(cashIn), totalCashSales: FieldValue.increment(cashSalesAmt), totalCashTips: FieldValue.increment(cashTipsTotal), ...(Object.keys(cashTipsByStaff).length ? { cashTipsByStaff } : {}) }, { merge: true });   // nested, so each provider's cash tips really add up
  // What the desk collected for renters → their Books, owed to them until the owner settles it (never auto-netted).
  for (const d of deskCollected) { if (!d.renterId || d.cents <= 0) continue; const ref = db.collection(`${T}/rentLedger`).doc();
    batch.set(ref, clean({ id: ref.id, renterId: d.renterId, staffId: d.staffId, type: 'desk_collected', kind: d.kind, amountCents: d.cents, status: 'owed', appointmentId: d.appointmentId, receiptId: receiptRef.id,
      note: d.kind === 'tip' ? 'Tip collected at the front desk' : `Collected at the front desk — ${d.serviceName || 'service'} for ${d.clientName || 'a client'}`, date: now, createdAt: now, collectedBy: auth.actor.name || null })); }
  // The receipt.
  const tendered = num(pay.amountTendered);
  batch.set(receiptRef, clean({ id: receiptRef.id, tillId: b.tillId ? String(b.tillId) : null, viewKey: `${rid()}${rid()}`, checkoutSessionId, clientId, clientName: client.name || 'Guest', tenantId, date: now, paymentMethod: method, amountTendered: tendered, change: Math.max(0, tendered - calc.total),
    paidBy: client.name || 'Guest', people: Object.values(people).map((p: any) => p.name).filter(Boolean),
    // Everything a void needs to undo this sale exactly.
    ...(split ? { payments: split.map((x) => ({ method: x.method, amount: num(x.amount), tip: num(x.tip), payerName: x.payerName || null, label: x.label || null, stripePaymentIntentId: x.stripePaymentIntentId || null, via: x.via || null })) } : {}),
    reversal: { ...(rentPayments.length ? { rentPayments } : {}), ...(split ? { payments: split.map((x) => ({ method: x.method, amount: num(x.amount) + num(x.tip), stripePaymentIntentId: x.stripePaymentIntentId || null })) } : {}), method, tillId: (method === 'cash' || (split && cashIn > 0)) ? (b.tillId || null) : null, cashIn, cashSales: cashSalesAmt, cashTips: method === 'cash' ? cashTipsTotal : 0, cashTipsByStaff: cashTipsPlain,
      spend, products: items.filter((x) => x.type === 'product').map((x) => ({ id: x.id, name: x.name, quantity: x.quantity })),
      fees: fees.map((f: any) => ({ feeId: f.feeId, feeAmount: num(f.feeAmount), reason: f.reason || null, owner: f.__owner, fee: (({ __owner, ...rest }) => rest)(f) })),
      depositCreditId: depositCredit && depositCreditDollars > 0 ? depositCredit.ref.id : null,
      redeemed: redeemedOffer ? { ...redeemedOffer, clientId: usedBy.id } : null,
      discountIds: (discounts as any[]).map((d) => d.id), groupDiscount: calc.groupDiscount > 0 ? { amount: calc.groupDiscount, month: gMonth, clientId } : null, momentKey: calc.momentDiscount > 0 && calc.moment ? calc.moment.key : null, memberships: items.filter((x) => x.type === 'membership' || x.type === 'package').map((x) => ({ type: x.type, id: x.id, name: x.name })),
      visits: visits.map((v) => ({ id: v.appointment.id, statusBefore: v.appointment.status || 'checked_in', checkInToken: v.appointment.checkInToken || null, clientId: v.appointment.clientId || clientId })),
      stripePaymentIntentId: pay.stripePaymentIntentId || null },
    subtotal: calc.subtotal, tax: calc.tax, taxLabel: calc.taxLabel, tip: calc.tip, discount: calc.discount + calc.memberDiscount, total: calc.total, cashierName: auth.actor.name || '', stripePaymentIntentId: pay.stripePaymentIntentId || null,
    ...(mismatch ? { needsReview: true, screenTotal: expected, reviewNote: `The screen showed $${expected.toFixed(2)}; recorded $${calc.total.toFixed(2)}.` } : {}),
    lineItems: [...visits.flatMap((v, idx) => { const vc = calc.visits[idx]; const forWho = whoHad(v).id !== clientId ? firstName(whoHad(v).name) : undefined; return [{ label: v.service?.name || 'Service', amount: vc.mainPrice, type: 'service', staff: firstName(staff.find((s: any) => s.id === vc.mainStaffId)?.name), for: forWho },
      ...vc.addOns.map((x: any) => ({ label: `+ ${x.addon.name}`, amount: x.price, type: 'addon', staff: firstName(staff.find((s: any) => s.id === x.staffId)?.name) }))]; }),
      ...items.map((it) => ({ label: it.name, amount: it.price * it.quantity, type: it.type || 'retail' }))] }));
  // Discount codes used; campaign offers redeemed.
  for (const d of discounts as any[]) {
    batch.set(db.doc(`${T}/discounts/${d.id}`), { usageCount: FieldValue.increment(1), usedByClientIds: FieldValue.arrayUnion(clientId) }, { merge: true });
    const w = (await db.collection(`${T}/clientOffers`).where('clientId', '==', clientId).get()).docs.find((x: any) => String((x.data() as any).code || '').toUpperCase() === String(d.code || '').toUpperCase() && !['redeemed', 'expired', 'cancelled'].includes(String((x.data() as any).status || '')) && !(x.data() as any).ownerRenterId);
    if (w) { batch.set(w.ref, { status: 'redeemed', redeemedAt: now, appointmentId: apptIds[0] || null, saleTotal: calc.total }, { merge: true });
      const cid = (w.data() as any).campaignId; if (cid) batch.set(db.doc(`${T}/campaigns/${cid}`), { offersRedeemed: FieldValue.increment(1), offerRevenueCents: FieldValue.increment(Math.round(calc.total * 100)) }, { merge: true }); }
    for (const v of visits) if (v.appointment.pendingDiscountCode) batch.set(db.doc(`${T}/appointments/${v.appointment.id}`), { pendingDiscountCode: FieldValue.delete(), discountCodeUsed: String(d.code) }, { merge: true });
  }
  try { await batch.commit(); }
  catch (e: any) { console.error('[checkout] save failed', e); await failPending(String(e?.message || e)); return json({ ok: false, error: 'Checkout didn’t save — nothing was recorded. Please try again.' }, 500); }

  // After the sale is saved: enrol memberships / packages; confirm next-visit deposits.
  const warnings: string[] = [];
  // Tuition: the Academy's audited, add-only ledger (it writes on its own, so it follows the saved sale).
  const tuitionPayments: any[] = [];
  for (const it of items.filter((x: any) => x.type === 'tuition' && x.__tacct)) {
    try { tuitionPayments.push(await applyTuitionPayment(db, tenantId, it.__tacct, { amountCents: Math.round(it.price * it.quantity * 100), method: String(method), receiptId: receiptRef.id, by: auth.actor.name || 'Front desk' })); }
    catch (e: any) { console.error('[checkout] tuition ledger', e); warnings.push(`The payment was taken, but ${it.__tacct.name}’s tuition ledger didn’t update — record it on their Academy account.`); }
  }
  if (tuitionPayments.length) await receiptRef.set({ reversal: { tuitionPayments } }, { merge: true }).catch(() => {});
  const origin = req.nextUrl.origin; const authz = req.headers.get('authorization') || '';
  for (const o of toEnroll) {
    try { const r = await fetch(`${origin}/api/memberships/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, clientId, offeringType: o.offeringType, offeringId: o.offeringId, paymentMethod: 'already_charged', existingPaymentIntentId: pay.stripePaymentIntentId || null, source: 'pos_checkout', skipLedger: true }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r?.ok) warnings.push(`${o.offeringType === 'membership' ? 'The membership' : 'The package'} was sold but not activated — please check the client’s profile.`); } catch { warnings.push('An enrolment didn’t go through — please check the client’s profile.'); }
  }
  for (const it of items.filter((x) => x.type === 'deposit' && x.depositForAppointmentId)) {
    try { const r = await fetch(`${origin}/api/appointments/desk-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authz }, body: JSON.stringify({ action: 'settled', tenantId, appointmentId: it.depositForAppointmentId, amountCents: Math.round(it.price * 100), receiptId: receiptRef.id, paidMethod: String(method) }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r?.ok) warnings.push(`The deposit for ${it.name} was paid — confirm that booking from the planner.`); } catch { warnings.push(`The deposit for ${it.name} was paid — confirm that booking from the planner.`); }
  }
  await logAuditAdmin(db, tenantId, { action: 'checkout.completed', targetType: 'client', targetId: clientId, amount: calc.total,
    summary: `Checkout — ${client.name || 'client'} · $${calc.total.toFixed(2)} (${method})${mismatch ? ` · the screen showed $${expected.toFixed(2)} — flagged for review` : ''}`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
  for (const v of visits) await syncVisitCopies(db, tenantId, { ...v.appointment, status: 'completed', stage: 'complete', timeline: [...(Array.isArray(v.appointment.timeline) ? v.appointment.timeline : []), { at: now, kind: 'stage', stage: 'complete', text: 'Paid' }] }, tenant).catch(() => {});
  // Products the services used come off stock (once per visit) — never blocks the sale; a problem becomes a warning.
  for (const v of visits) { try { const { expectedUsage, recordVisitUsage } = await import('@/lib/usage');
      const r: any = await recordVisitUsage(db, tenantId, v.appointment, expectedUsage(v.service, v.addOnServices || [], inventory), { id: (auth as any)?.actor?.uid, name: (auth as any)?.actor?.name });
      if (r?.lines?.some((l: any) => l.shortfall)) warnings.push(`${v.appointment.clientName || 'A visit'} used more of ${r.lines.filter((l: any) => l.shortfall).map((l: any) => l.name).join(', ')} than your stock shows — check the shelf.`);
    } catch (e: any) { console.error('[checkout] usage', e?.message); } }
  if (pendingRef) await pendingRef.set({ status: 'completed', completedAt: now, receiptId: receiptRef.id, checkoutSessionId, total: calc.total, ...(pay.stripePaymentIntentId ? { paymentIntentId: String(pay.stripePaymentIntentId) } : {}) }, { merge: true }).catch(() => {});
  // WHAT THIS SALE DID — so the finished screen says the right thing for each kind of sale (a visit, rent, tuition,
  // a booth day, a membership…) and only offers "book their next visit" where there was a visit.
  const outcomes: any[] = [];
  if (visits.length) outcomes.push({ kind: 'visit', serviceId: visits[0].service?.id || null, renter: calc.visits.some((v: any) => v.renter) });
  let rentIdx = 0;
  for (const it of items as any[]) {
    if (it.type === 'rent' && it.__acct) { const r: any = rentPayments[rentIdx++] || {}; const paid = Math.round(num(it.price) * 100); const acct = it.__acct;
      const owedBefore = acct.usesInvoices ? num(acct.invoiceOwedCents) : num(acct.owedCents);
      outcomes.push({ kind: 'rent', renterId: acct.renter?.id || null, name: acct.name, paidCents: paid, owedAfterCents: Math.max(0, owedBefore - paid), creditCents: num(r.creditCents) }); }
    else if (it.type === 'tuition' && it.__tacct) outcomes.push({ kind: 'tuition', name: it.__tacct.name, program: it.__tacct.program || null, paidCents: Math.round(num(it.price) * 100), remainingCents: Math.max(0, num(it.__tacct.balanceCents) - Math.round(num(it.price) * 100)) });
    else if (it.type === 'membership' || it.type === 'package') outcomes.push({ kind: it.type, name: it.name });
    else if (it.type === 'rental' && it.reservationId) outcomes.push({ kind: 'booth', name: it.name, reservationId: it.reservationId });
    else if (it.type === 'product') { if (!outcomes.some((o) => o.kind === 'retail')) outcomes.push({ kind: 'retail' }); }
  }
  return json({ ok: true, checkoutSessionId, receiptId: receiptRef.id, total: calc.total, collected: Math.max(0, Math.round((calc.total - depositUsed) * 100) / 100), depositUsed, subtotal: calc.subtotal, tax: calc.tax, mismatch, warnings, outcomes });
}
