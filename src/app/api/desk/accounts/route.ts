// src/app/api/desk/accounts/route.ts — "TAKE A PAYMENT": everything one person owes, in one place (staff).
//   { action: 'directory' }  → renters and enrolled students to search alongside the till's clients
//   { action: 'person', clientIds, renterIds, planIds } → their accounts: rent (owed now, credit, next), tuition (next
//       instalment after anything paid ahead, balance), unpaid client fees, deposits owed for upcoming bookings, and
//       money the studio owes THEM (front-desk collections) — shown so nobody asks them to pay it.
// Amounts here are for choosing; the checkout re-checks every one on the server when the sale is saved.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { renterAccount } from '@/lib/rent-desk';
import { tuitionAccount, TUITION_OPEN } from '@/lib/tuition-desk';
import { rentOutlook } from '@/lib/rent-outlook';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
export const dynamic = 'force-dynamic';

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const digits = (p: any) => String(p || '').replace(/\D/g, '').slice(-10);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const tenant: any = (await db.doc(T).get()).data() || {};
  // Who can see other people's balances (Settings → team permissions). Default: everyone who works the desk.
  const allowed: string[] = Array.isArray(tenant.accountPaymentRoles) && tenant.accountPaymentRoles.length ? tenant.accountPaymentRoles : ['owner', 'admin', 'manager', 'staff', 'front_desk', 'reception'];
  if (!auth.actor.isTenantOwner && !allowed.includes(String(auth.actor.role || '').toLowerCase())) return NextResponse.json({ ok: false, error: 'Taking account payments isn’t part of your role here.' }, { status: 403 });

  // One visit's charges (fees, extra time, extra product, card on file) and the agreement each rests on — the Visit's Money tab.
  if (b.action === 'visit-charges') { const id = String(b.appointmentId || '').slice(0, 120); if (!id) return NextResponse.json({ ok: false, error: 'Which visit?' }, { status: 400 });
    const rows = (await db.collection(`${T}/chargeRecords`).where('appointmentId', '==', id).get()).docs.map((d: any) => { const c: any = d.data() || {}; return { id: d.id, kind: c.kind, cents: c.cents, reason: c.reason, at: c.at, by: c.by, approvedBy: c.approvedBy || null, basis: (c.consents || []).map((x: any) => `${String(x.kind).replace(/_/g, ' ')} ${x.version} (${String(x.at).slice(0, 10)}, ${x.via})`), missing: c.missingConsent || [] }; })
      .sort((x: any, y: any) => String(y.at).localeCompare(String(x.at)));
    return NextResponse.json({ ok: true, charges: rows }); }
  if (b.action === 'directory') {
    const mods = tenant.modules || {};
    const renters = mods.booth_rental === false ? [] : (await db.collection(`${T}/renters`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((r: any) => !['former', 'archived', 'removed'].includes(String(r.status || '')))
      .map((r: any) => ({ renterId: r.id, clientId: r.clientId || null, name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.name || 'Renter', email: String(r.email || '').toLowerCase() || null, phone4: digits(r.phone).slice(-4) || null, phoneKey: digits(r.phone) || null }));
    // What each renter owes right now (open rent invoices, after part-payments) — shown in the search results.
    if (renters.length) { const open = (await db.collection(`${T}/rentInvoices`).where('status', 'in', ['due', 'late']).get()).docs.map((d: any) => d.data() || {});
      for (const r of renters as any[]) r.owedCents = open.filter((i: any) => i.renterId === r.renterId).reduce((n: number, i: any) => n + Math.max(0, num(i.amountCents) + num(i.lateFeeCents) - num(i.paidCents)), 0); }
    const students = mods.academy === false ? [] : (await db.collection(`${T}/tuitionPlans`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((p: any) => TUITION_OPEN.includes(String(p.status || '')))
      .map((p: any) => ({ planId: p.id, clientId: p.studentId || null, name: p.name || 'Student', email: String(p.email || '').toLowerCase() || null, phone4: digits(p.phone).slice(-4) || null, phoneKey: digits(p.phone) || null, pastDue: p.status === 'past_due' }));
    return NextResponse.json({ ok: true, renters, students });
  }

  if (b.action === 'person') {
    const ids = (k: string) => (Array.isArray(b[k]) ? b[k].map(String).slice(0, 5) : []);
    const today = todayIn(tenantTimeZone(tenant)); const out: any = { rent: [], tuition: [], fees: [], deposits: [], owedToThem: [] };
    for (const renterId of ids('renterIds')) {
      const acct: any = await renterAccount(db, T, renterId); if (!acct) continue;
      const invoices = (await db.collection(`${T}/rentInvoices`).where('renterId', '==', renterId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      const ledger = (await db.collection(`${T}/rentLedger`).where('renterId', '==', renterId).get()).docs.map((d: any) => d.data() || {});
      const o = rentOutlook({ lease: acct.lease, renter: acct.renter, invoices, ledger, todayIso: today });
      const owedNow = acct.usesInvoices ? o.owedNowCents : num(acct.owedCents);
      const late = invoices.filter((i: any) => i.status === 'late').reduce((n: number, i: any) => n + num(i.lateFeeCents), 0);
      out.rent.push({ renterId, name: acct.name, booth: acct.booth?.name || null, owedNowCents: owedNow, lateFeeCents: late, creditCents: o.creditCents, nextDue: o.nextDue, nextRentCents: o.nextRentCents, nextAfterCreditsCents: o.nextAfterCreditsCents, autopayOn: o.autopayOn });
      const owedToThem = ledger.filter((e: any) => e.type === 'desk_collected' && e.status === 'owed').reduce((n: number, e: any) => n + num(e.amountCents), 0);
      if (owedToThem > 0) out.owedToThem.push({ renterId, name: acct.name, cents: owedToThem });
    }
    for (const planId of ids('planIds')) {
      const acct: any = await tuitionAccount(db, tenantId, planId); if (!acct || !acct.open || acct.balanceCents <= 0) continue;
      const p = acct.plan; const inst = num(p.installmentCents); const nextCents = Math.max(0, Math.min(acct.balanceCents, inst || acct.balanceCents) - num(p.prepaidCents));
      out.tuition.push({ planId, name: acct.name, program: acct.program, balanceCents: acct.balanceCents, installmentCents: inst, nextCents, nextDue: p.nextDueAt || null, pastDue: p.status === 'past_due', prepaidCents: num(p.prepaidCents), autopayOn: p.autopay === true && !!p.paymentMethodId });
    }
    for (const clientId of ids('clientIds')) {
      const c: any = (await db.doc(`${T}/clients/${clientId}`).get()).data(); if (!c) continue;
      for (const f of (Array.isArray(c.unpaidFees) ? c.unpaidFees : [])) if (num(f.feeAmount) > 0) out.fees.push({ clientId, feeId: f.feeId, cents: Math.round(num(f.feeAmount) * 100), reason: String(f.reason || 'Fee').replace(/\s*[—–-]\s*(auto-charge failed|card declined|no card on file|payments not connected).*$/i, ''), date: f.appointmentDate || null });
      const appts = (await db.collection(`${T}/appointments`).where('clientId', '==', clientId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      for (const a of appts) if (a.status === 'pending_payment' && Date.parse(a.startTime || '') > Date.now() && num(a.depositAmountCents || a.depositCents) > 0)
        out.deposits.push({ clientId, appointmentId: a.id, cents: num(a.depositAmountCents || a.depositCents), service: a.serviceName || 'Booking', startTime: a.startTime, holdUntil: a.paymentDueAt || a.depositDueAt || null });
    }
    // Everything else that explains what they owe — and what they've just paid (so nobody takes it twice).
    out.otherBalance = []; out.notes = []; out.reviews = []; out.recent = [];
    const dayAgo = Date.now() - 86400000; const canDecide = !!(auth.actor.isManager || auth.actor.isTenantOwner);
    for (const clientId of ids('clientIds')) {
      const c: any = (await db.doc(`${T}/clients/${clientId}`).get()).data(); if (!c) continue;
      const listed = (Array.isArray(c.unpaidFees) ? c.unpaidFees : []).reduce((n: number, f: any) => n + Math.round(num(f.feeAmount) * 100), 0);
      const gap = Math.round(num(c.outstandingBalance) * 100) - listed;
      if (gap > 0) out.otherBalance.push({ clientId, cents: gap });   // an older balance that isn't itemised as a fee
      for (const f of (await db.collection(`${T}/chargeFlags`).where('clientId', '==', clientId).get()).docs.map((d: any) => d.data() || {}))
        if (f.status === 'needs_attention') out.notes.push({ clientId, text: String(f.failReason || 'A card charge didn’t go through').replace(/\s*\([^)]*\)\s*$/, ''), at: f.createdAt || null });
      for (const d of (await db.collection(`${T}/cancellationEvents`).where('clientId', '==', clientId).get()).docs) { const e: any = d.data() || {};
        if (e.status === 'needs_review') out.reviews.push({ eventId: d.id, clientId, cents: Math.round(num(e.feeAmount) * 100), label: e.cancellationAudit?.actorType === 'no_show' ? 'No-show' : 'Late cancel', service: e.serviceName || null, date: e.appointmentStartTime || null, canDecide }); }
      for (const d of (await db.collection(`${T}/receipts`).where('clientId', '==', clientId).get()).docs) { const r: any = d.data() || {};
        if (!r.voided && Date.parse(r.date || '') >= dayAgo) out.recent.push({ receiptId: d.id, what: (r.detail?.lines || r.lineItems || []).slice(0, 2).map((l: any) => l.label).join(', ') || 'A sale', cents: Math.round(num(r.total) * 100), at: r.date, number: r.detail?.number || d.id.slice(-6).toUpperCase() }); }
    }
    for (const renterId of ids('renterIds')) for (const e of (await db.collection(`${T}/rentLedger`).where('renterId', '==', renterId).get()).docs.map((d: any) => d.data() || {}))
      if (e.type === 'payment' && e.status !== 'refunded' && Date.parse(e.createdAt || e.paidAt || '') >= dayAgo && !out.recent.some((x: any) => x.receiptId && x.receiptId === e.receiptId))
        out.recent.push({ what: `Rent (${String(e.method || '').replace(/_/g, ' ') || 'payment'})`, cents: Math.abs(num(e.amountCents)), at: e.createdAt || e.paidAt });
    out.recent.sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)));
    // Charges on record for this client (what, why, how much, and the consent each rests on), newest first.
    out.charges = [];
    for (const clientId of ids('clientIds')) for (const d of (await db.collection(`${T}/chargeRecords`).where('clientId', '==', clientId).get()).docs) { const c: any = d.data() || {};
      out.charges.push({ id: d.id, kind: c.kind, cents: c.cents, reason: c.reason, at: c.at, by: c.by, approvedBy: c.approvedBy || null, receiptId: c.receiptId || null, basis: (c.consents || []).map((x: any) => `${String(x.kind).replace(/_/g, ' ')} ${x.version} (${String(x.at).slice(0, 10)}, ${x.via})`), missing: c.missingConsent || [] }); }
    out.charges.sort((a: any, b: any) => String(b.at).localeCompare(String(a.at))); out.charges = out.charges.slice(0, 12);
    // For collecting when they're not here: their saved card, and the business's rule for charging it.
    out.cards = [];
    for (const clientId of ids('clientIds')) { const c: any = (await db.doc(`${T}/clients/${clientId}`).get()).data() || {}; const k = c.cardOnFile || {};
      if (k.customerId && k.paymentMethodId) out.cards.push({ clientId, brand: k.brand || 'Card', last4: k.last4 || null }); }
    const { cardChargeRule } = await import('@/lib/fee-pay'); out.chargeRule = cardChargeRule(tenant); out.isManager = !!(auth.actor.isManager || auth.actor.isTenantOwner);
    return NextResponse.json({ ok: true, ...out });
  }
  if (b.action === 'itemise-balance') {
    const clientId = String(b.clientId || ''); const ref = db.doc(`${T}/clients/${clientId}`); let made: any = null;
    await db.runTransaction(async (tx: any) => { const c: any = (await tx.get(ref)).data(); if (!c) return;
      const list = Array.isArray(c.unpaidFees) ? c.unpaidFees : []; const gap = Math.round(num(c.outstandingBalance) * 100) - list.reduce((n: number, f: any) => n + Math.round(num(f.feeAmount) * 100), 0);
      if (gap <= 0) return; made = { feeId: `balance-${Date.now().toString(36)}`, feeAmount: gap / 100, reason: 'Earlier balance', appointmentDate: null, autoCollect: false, itemisedAt: new Date().toISOString(), itemisedBy: auth.actor.name || null };
      tx.update(ref, { unpaidFees: [...list, made] }); });   // the total owed is unchanged — it's now a line that can be paid
    return made ? NextResponse.json({ ok: true, fee: made }) : NextResponse.json({ ok: false, error: 'There’s no earlier balance to add.' }, { status: 409 });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
