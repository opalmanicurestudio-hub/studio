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

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const clientId = String(b.clientId || '');
  const apptIds: string[] = Array.isArray(b.appointmentIds) ? b.appointmentIds.map(String).slice(0, 20) : [];
  const reqItems: any[] = Array.isArray(b.items) ? b.items.slice(0, 60) : [];
  if (!clientId) return NextResponse.json({ ok: false, error: 'Choose who’s paying.' }, { status: 400 });
  if (!apptIds.length && !reqItems.length && !(Array.isArray(b.feeIds) && b.feeIds.length)) return NextResponse.json({ ok: false, error: 'Nothing to check out.' }, { status: 400 });
  const pay = b.payment || {}; const method = String(pay.method || 'card'); const skipLedger = pay.skipLedger === true;
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const now = new Date().toISOString(); const checkoutSessionId = rid();

  // ── Load everything from the server ──
  const [tSnap, cSnap, stSnap, svSnap, invSnap, mSnap, pSnap, dSnap] = await Promise.all([
    db.doc(T).get(), db.doc(`${T}/clients/${clientId}`).get(), db.collection(`${T}/staff`).get(), db.collection(`${T}/services`).get(),
    db.collection(`${T}/inventory`).get(), db.collection(`${T}/memberships`).get(), db.collection(`${T}/packages`).get(), db.collection(`${T}/discounts`).get(),
  ]);
  const tenant: any = tSnap.data() || {}; const client: any = cSnap.exists ? { id: clientId, ...(cSnap.data() as any) } : null;
  if (!client) return NextResponse.json({ ok: false, error: 'That client wasn’t found.' }, { status: 404 });
  const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const staff = rows(stSnap), services = rows(svSnap), inventory = rows(invSnap), memberships = rows(mSnap), packages = rows(pSnap), allDiscounts = rows(dSnap);
  const svc = (id: string) => services.find((s: any) => s.id === id);
  const visits: any[] = [];
  for (const id of apptIds) {
    const a: any = (await db.doc(`${T}/appointments/${id}`).get()).data();
    if (!a) return NextResponse.json({ ok: false, error: 'One of these visits wasn’t found — refresh and try again.' }, { status: 404 });
    if (a.status === 'completed' && a.checkoutSessionId) return NextResponse.json({ ok: false, error: `${a.clientName || 'This visit'} has already been checked out.` }, { status: 409 });
    visits.push({ appointment: { ...a, id }, service: svc(a.serviceId) || { id: a.serviceId, name: a.serviceName || 'Service', price: num(a.price) }, addOnServices: (a.addOnIds || []).map((x: string) => svc(x)).filter(Boolean) });
  }
  // Sale items, priced here (never by the browser) — except next-visit deposits (capped by that booking's deposit) and rentals.
  const items: any[] = [];
  for (const it of reqItems) {
    const qty = Math.max(1, Math.min(99, Math.round(num(it.quantity) || 1))); const type = String(it.type || 'product'); const id = String(it.id || '');
    let price = num(it.price), name = String(it.name || 'Item'), stock: number | null = null;
    if (type === 'product') { const p = inventory.find((x: any) => x.id === id); if (!p) return NextResponse.json({ ok: false, error: `${name} isn’t in your inventory any more.` }, { status: 400 }); price = num(p.msrp || p.costPerUnit); name = p.name || name; stock = num(p.totalStock); }
    else if (type === 'service') { const s = svc(id); if (s) { price = num(s.price); name = s.name || name; } }
    else if (type === 'membership') { const m = memberships.find((x: any) => x.id === id); if (!m) return NextResponse.json({ ok: false, error: 'That membership wasn’t found.' }, { status: 400 }); price = num(m.price); name = m.name || name; }
    else if (type === 'package') { const p = packages.find((x: any) => x.id === id); if (!p) return NextResponse.json({ ok: false, error: 'That package wasn’t found.' }, { status: 400 }); price = num(p.price); name = p.name || name; }
    else if (type === 'deposit' && it.depositForAppointmentId) { const ap: any = (await db.doc(`${T}/appointments/${String(it.depositForAppointmentId)}`).get()).data() || {}; const max = num(ap.depositAmountCents) / 100; if (max > 0) price = Math.min(price || max, max); }
    items.push({ id, type, quantity: qty, price: Math.max(0, price), name, stock, reservationId: it.reservationId || null, depositForAppointmentId: it.depositForAppointmentId || null });
  }
  const fees = (client.unpaidFees || []).filter((f: any) => (Array.isArray(b.feeIds) ? b.feeIds : []).includes(f.feeId));
  const codes: string[] = Array.isArray(b.discountCodes) ? b.discountCodes.map((c: any) => String(c).toUpperCase()).slice(0, 5) : [];
  const discounts = codes.map((c) => allDiscounts.find((d: any) => String(d.code || '').toUpperCase() === c)).filter(Boolean);
  const redeemedOffer = b.redeemedOffer && b.redeemedOffer.id ? { type: String(b.redeemedOffer.type), id: String(b.redeemedOffer.id), itemId: b.redeemedOffer.itemId ? String(b.redeemedOffer.itemId) : undefined } : null;
  const waivedIds: string[] = Array.isArray(b.waivedAppointmentIds) ? b.waivedAppointmentIds.map(String) : [];
  const tipAllocations: Record<string, number> = b.tipAllocations && typeof b.tipAllocations === 'object' ? b.tipAllocations : {};
  const tip = Math.max(0, num(b.tip));
  const calc = computeCheckout({ tenant, visits, staff, redeemedOffer, waivedIds, items, fees, discounts, client, memberships, tip, storeCredit: Math.max(0, num(b.storeCredit)) });
  const recoveryAmount = Math.min(Math.max(0, num(b.recovery?.amount)), calc.subtotal);
  const recoveryReason = String(b.recovery?.reason || 'Service Recovery Adjustment').slice(0, 200);
  const cardSurcharge = Math.max(0, num(pay.cardSurcharge));
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
  const txn = (f: any) => { if (!skipLedger) { const r = db.collection(`${T}/transactions`).doc(); batch.set(r, clean({ id: r.id, date: now, clientOrVendor: client.name || 'Client', clientId, tenantId, checkoutSessionId, ...f })); } };
  let totalLtvIncrease = 0, totalCashIncrease = 0, cashTipsTotal = 0;
  const add = (amt: number) => { totalLtvIncrease += amt; if (method === 'cash') totalCashIncrease += amt; };
  const cashTipsByStaff: Record<string, any> = {};
  const tmhr = num(tenant.tmhr) || 50;
  for (const [idx, v] of visits.entries()) {
    const vc = calc.visits[idx]; const a = v.appointment; const mainStaff = staff.find((s: any) => s.id === vc.mainStaffId);
    add(vc.mainPrice);
    txn({ description: vc.mainRedeemed ? `Redemption: ${v.service.name}` : `Service: ${v.service.name}`, type: 'income', context: 'Business', category: 'Service Revenue', taxBucket: 'revenue', amount: vc.mainPrice, paymentMethod: method, staffId: vc.mainStaffId, appointmentId: a.id, hasReceipt: true });
    if (vc.mainRedeemed) { const cost = computeServiceCost(v.service, a, mainStaff, inventory, tmhr); if (cost.total > 0) txn({ description: `Redemption Cost: ${v.service.name}`, type: 'expense', context: 'Business', category: 'Comp & Redemption Cost', taxBucket: 'operating_cost', amount: cost.total, paymentMethod: 'Internal', staffId: vc.mainStaffId, appointmentId: a.id, hasReceipt: false, notes: `Materials $${cost.materials.toFixed(2)} · Overhead $${cost.overhead.toFixed(2)} · Labor $${cost.labor.toFixed(2)}` }); }
    for (const ad of vc.addOns) {
      if (ad.redeemed) { const cost = computeServiceCost(ad.addon, a, staff.find((s: any) => s.id === ad.staffId), inventory, tmhr); if (cost.total > 0) txn({ description: `Redemption Cost: ${ad.addon.name}`, type: 'expense', context: 'Business', category: 'Comp & Redemption Cost', taxBucket: 'operating_cost', amount: cost.total, paymentMethod: 'Internal', staffId: ad.staffId, appointmentId: a.id, hasReceipt: false }); }
      add(ad.price);
      txn({ description: `${ad.redeemed ? 'Redemption' : 'Add-on'}: ${ad.addon.name}`, type: 'income', context: 'Business', category: 'Service Revenue', taxBucket: 'revenue', amount: ad.price, paymentMethod: method, staffId: ad.staffId, appointmentId: a.id, hasReceipt: true });
    }
    const fee = (amount: number, description: string, category: string) => { if (amount > 0) { add(amount); txn({ description, type: 'income', context: 'Business', category, taxBucket: 'adjustment', amount, paymentMethod: method, staffId: vc.mainStaffId, appointmentId: a.id, hasReceipt: false }); } };
    fee(vc.rescheduleFee, `Reschedule Recovery: ${v.service.name}`, 'Protocol Recovery');
    fee(vc.timeOverage, `Time Floor Overage: ${v.service.name}`, 'Strategic Adjustment');
    fee(vc.materialOverage, `Material Protocol Overage: ${v.service.name}`, 'Strategic Adjustment');
    fee(vc.additionalCharge, 'Strategic Adjustment Fee', 'Adjustment Fee');
    for (const r of vc.refreshments) { const amt = r.price * r.qty; if (amt > 0) { add(amt); txn({ description: `Concierge: ${r.name} (x${r.qty})`, type: 'income', context: 'Business', category: 'Hospitality Revenue', taxBucket: 'revenue', amount: amt, paymentMethod: method, appointmentId: a.id, hasReceipt: false }); } }
    const revenue = vc.mainPrice + vc.addOns.reduce((s: number, x: any) => s + x.price, 0);
    batch.set(db.doc(`${T}/appointments/${a.id}`), { status: 'completed', revenue, actualEndTime: now, checkoutSessionId, checkedOutAt: now, checkedOutBy: auth.actor.name }, { merge: true });
    if (a.checkInToken) { batch.set(db.doc(`appointmentCheckIns/${a.checkInToken}`), { status: 'completed', tenantId }, { merge: true }); batch.set(db.doc(`${T}/appointmentCheckIns/${a.checkInToken}`), { status: 'completed' }, { merge: true }); }
    const involved = new Set<string>([a.staffId, vc.mainStaffId, ...vc.addOns.map((x: any) => x.staffId)].filter(Boolean));
    for (const sid of involved) batch.set(db.doc(`${T}/staff/${sid}`), { status: 'available', lastWalkInCompletedAt: now }, { merge: true });
  }
  const toEnroll: { offeringType: 'membership' | 'package'; offeringId: string }[] = [];
  for (const it of items) {
    const value = it.price * it.quantity;
    const category = it.type === 'deposit' ? 'Retainers' : it.type === 'service' ? 'Service Revenue' : it.type === 'membership' ? 'Membership Sales' : it.type === 'package' ? 'Package Sales' : it.type === 'rental' ? 'Space Rental' : 'Retail';
    const description = it.type === 'deposit' ? `Deposit: ${it.name}` : it.type === 'service' ? `Service (POS): ${it.quantity}x ${it.name}` : it.type === 'membership' ? `Membership: ${it.name}` : it.type === 'package' ? `Package: ${it.name}` : it.type === 'rental' ? `Space rental: ${it.name}` : `Retail Product: ${it.quantity}x ${it.name}`;
    txn({ description, type: 'income', context: 'Business', category, amount: value, paymentMethod: method, hasReceipt: true });
    if (it.type === 'product') {
      batch.set(db.doc(`${T}/inventory/${it.id}`), { totalStock: FieldValue.increment(-it.quantity) }, { merge: true });
      const sc = db.collection(`${T}/stockCorrections`).doc();
      batch.set(sc, clean({ productId: it.id, date: now, change: -it.quantity, unit: 'units', reason: `Retail Sale: ${it.name} for ${client.name || 'Guest'}`, actorId: auth.actor.uid || 'staff', actorName: auth.actor.name || 'Staff', source: 'stock_ledger', type: 'sold', field: 'totalStock', balanceAfter: Math.max(0, num(it.stock) - it.quantity), refKind: 'checkout', refId: checkoutSessionId }));
    }
    if (it.type === 'membership' || it.type === 'package') toEnroll.push({ offeringType: it.type, offeringId: it.id });
    if (it.type === 'rental' && it.reservationId) batch.set(db.doc(`${T}/boothReservations/${it.reservationId}`), { paymentStatus: 'paid', paidAt: now, paidVia: 'pos' }, { merge: true });
    add(value);
  }
  if (fees.length) {
    const settled = fees.reduce((s: number, f: any) => s + num(f.feeAmount), 0);
    const ids = new Set(fees.map((f: any) => f.feeId));
    batch.set(db.doc(`${T}/clients/${clientId}`), { unpaidFees: (client.unpaidFees || []).filter((f: any) => !ids.has(f.feeId)), outstandingBalance: FieldValue.increment(-settled) }, { merge: true });
    if (method === 'cash') totalCashIncrease += settled;
    for (const f of fees) txn({ description: `Debt Settlement: ${f.reason || 'fee'}`, type: 'income', context: 'Business', category: 'Fee Recovery', taxBucket: 'adjustment', amount: num(f.feeAmount), paymentMethod: method, hasReceipt: false });
    totalLtvIncrease += settled;
  }
  // Client: lifetime value, last visit, package session / membership perk used.
  const clientUpd: any = { lifetimeValue: FieldValue.increment(Math.max(0, totalLtvIncrease - calc.discount - calc.memberDiscount - recoveryAmount)), lastAppointment: now };
  if (redeemedOffer) {
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
  for (const [sid, amount] of Object.entries(alloc)) { const amt = num(amount); if (amt <= 0) continue;
    txn({ description: sid === '__school' ? 'Gratuity — school (student salon)' : 'Gratuity', type: 'income', context: 'Business', category: 'Tips', taxBucket: 'gratuity', amount: amt, paymentMethod: method, staffId: sid, hasReceipt: true });
    if (method === 'cash') { cashTipsTotal += amt; cashTipsByStaff[sid] = FieldValue.increment(amt); } }
  if (calc.discount > 0) txn({ description: 'Promotion Applied', clientOrVendor: 'Internal', type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: calc.discount, paymentMethod: 'Internal', hasReceipt: false });
  if (recoveryAmount > 0) txn({ description: `Service Recovery: ${recoveryReason}`, type: 'expense', context: 'Business', category: 'Discounts', taxBucket: 'adjustment', amount: recoveryAmount, notes: recoveryReason, paymentMethod: 'Internal', hasReceipt: false });
  if (calc.tax > 0) txn({ description: calc.taxLabel, type: 'income', context: 'Business', category: 'Tax Collected', taxBucket: 'tax_collected', amount: calc.tax, paymentMethod: method, hasReceipt: false });
  if (cardSurcharge > 0) { txn({ description: 'Card Processing Fee (passed to client)', type: 'income', context: 'Business', category: 'Card Processing Fee', taxBucket: 'revenue', amount: cardSurcharge, paymentMethod: method, hasReceipt: false }); totalLtvIncrease += cardSurcharge; }
  let cashDepositOffset = 0;
  if (depositCredit && depositCreditDollars > 0) {
    txn({ description: 'Deposit applied (prepaid online)', type: 'expense', context: 'Business', category: 'Deposit Applied', taxBucket: 'adjustment', amount: depositCreditDollars, paymentMethod: 'Deposit', hasReceipt: false });
    batch.set(depositCredit.ref, { status: 'consumed', consumedAt: now, appointmentId: apptIds[0] || null }, { merge: true });
    cashDepositOffset = Math.min(depositCreditDollars, totalCashIncrease);
  }
  if (method === 'cash' && b.tillId) batch.set(db.doc(`${T}/tillSessions/${String(b.tillId)}`), { expectedCash: FieldValue.increment(totalCashIncrease + cashTipsTotal - cashDepositOffset), totalCashSales: FieldValue.increment(totalCashIncrease - cashDepositOffset), totalCashTips: FieldValue.increment(cashTipsTotal), ...(Object.keys(cashTipsByStaff).length ? { cashTipsByStaff } : {}) }, { merge: true });   // nested, so each provider's cash tips really add up
  // The receipt.
  const receiptRef = db.collection(`${T}/receipts`).doc();
  const tendered = num(pay.amountTendered);
  batch.set(receiptRef, clean({ id: receiptRef.id, checkoutSessionId, clientId, clientName: client.name || 'Guest', tenantId, date: now, paymentMethod: method, amountTendered: tendered, change: Math.max(0, tendered - calc.total),
    subtotal: calc.subtotal, tax: calc.tax, taxLabel: calc.taxLabel, tip: calc.tip, discount: calc.discount + calc.memberDiscount, total: calc.total, cashierName: auth.actor.name || '', stripePaymentIntentId: pay.stripePaymentIntentId || null,
    ...(mismatch ? { needsReview: true, screenTotal: expected, reviewNote: `The screen showed $${expected.toFixed(2)}; recorded $${calc.total.toFixed(2)}.` } : {}),
    lineItems: [...visits.flatMap((v, idx) => { const vc = calc.visits[idx]; return [{ label: v.service?.name || 'Service', amount: vc.mainPrice, type: 'service', staff: firstName(staff.find((s: any) => s.id === vc.mainStaffId)?.name) },
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
  catch (e: any) { console.error('[checkout] save failed', e); return NextResponse.json({ ok: false, error: 'Checkout didn’t save — nothing was recorded. Please try again.' }, { status: 500 }); }

  // After the sale is saved: enrol memberships / packages; confirm next-visit deposits.
  const warnings: string[] = [];
  const origin = req.nextUrl.origin; const authz = req.headers.get('authorization') || '';
  for (const o of toEnroll) {
    try { const r = await fetch(`${origin}/api/memberships/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, clientId, offeringType: o.offeringType, offeringId: o.offeringId, paymentMethod: 'already_charged', existingPaymentIntentId: pay.stripePaymentIntentId || null, source: 'pos_checkout', skipLedger: true }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r?.ok) warnings.push(`${o.offeringType === 'membership' ? 'The membership' : 'The package'} was sold but not activated — please check the client’s profile.`); } catch { warnings.push('An enrolment didn’t go through — please check the client’s profile.'); }
  }
  for (const it of items.filter((x) => x.type === 'deposit' && x.depositForAppointmentId)) {
    try { const r = await fetch(`${origin}/api/appointments/desk-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authz }, body: JSON.stringify({ action: 'settled', tenantId, appointmentId: it.depositForAppointmentId, amountCents: Math.round(it.price * 100) }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r?.ok) warnings.push(`The deposit for ${it.name} was paid — confirm that booking from the planner.`); } catch { warnings.push(`The deposit for ${it.name} was paid — confirm that booking from the planner.`); }
  }
  await logAuditAdmin(db, tenantId, { action: 'checkout.completed', targetType: 'client', targetId: clientId, amount: calc.total,
    summary: `Checkout — ${client.name || 'client'} · $${calc.total.toFixed(2)} (${method})${mismatch ? ` · the screen showed $${expected.toFixed(2)} — flagged for review` : ''}`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
  return NextResponse.json({ ok: true, checkoutSessionId, receiptId: receiptRef.id, total: calc.total, subtotal: calc.subtotal, tax: calc.tax, mismatch, warnings });
}
