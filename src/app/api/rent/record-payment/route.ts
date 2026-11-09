// src/app/api/rent/record-payment/route.ts — RECORD A RENT PAYMENT taken outside the app (cash, check, a transfer).
// One path for the Rent page and a renter's profile on Spaces. The renter's bills and charges are read and the payment
// written in one step (lib/rent-payment-plan): rent bills first, oldest first, then whole one-off charges, and anything
// over is kept as credit for their next bill. Because it reads the bills as they are at that moment, a bill an online
// payment has just paid is never paid twice, and a bill autopay is still working on is left for autopay to settle. The renter is then sent a receipt (lib/account-receipts), unless the
// business has rent receipts switched off.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { planRentPayment, accountPosition } from '@/lib/rent-payment-plan';
import { buildLedgerEntry, ledgerEntryId } from '@/lib/ledger';
import { logAuditAdmin } from '@/lib/audit';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { linkOrigin } from '@/lib/app-origin';
import { sendAccountReceipt } from '@/lib/account-receipts';
import { nextChargeDate } from '@/lib/rent-schedule';
import { addDays } from '@/lib/leave-policy';

export const dynamic = 'force-dynamic';

const clip = (v: any, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const OPEN_LEASE = ['active', 'on_leave', 'pending_signature'];

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = clip(b.tenantId, 120);
  const g = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  const actor: any = g.actor || {};

  const renterId = clip(b.renterId, 120);
  const amountCents = Math.round(Number(b.amountCents) || 0);
  const method = clip(b.method, 40) || 'other';
  const methodLabel = clip(b.methodLabel, 60) || method;
  const note = clip(b.note, 500);
  const requestId = clip(b.requestId, 80).replace(/[^A-Za-z0-9_-]/g, '');
  if (!renterId) return NextResponse.json({ ok: false, error: 'Which renter?' }, { status: 400 });
  if (amountCents <= 0 || amountCents > 100_000_00) return NextResponse.json({ ok: false, error: 'Enter an amount between $0.01 and $100,000.' }, { status: 400 });
  if (requestId.length < 8) return NextResponse.json({ ok: false, error: 'Refresh the page and try again.' }, { status: 400 });

  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = (await db.doc(T).get()).data() || {};
  const today = todayIn(tenantTimeZone(tenant));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : today;
  if (date > addDays(today, 1)) return NextResponse.json({ ok: false, error: 'The payment date can’t be in the future.' }, { status: 400 });
  const nowIso = new Date().toISOString();

  // Named by the screen's request, so pressing Save twice records one payment.
  const payRef = db.doc(`${T}/rentLedger/recpay_${requestId}`);
  const txnRef = db.doc(`${T}/transactions/${ledgerEntryId('booth_rent', payRef.id)}`);

  const out: any = await db.runTransaction(async (tx: any) => {
    const [already, renterSnap, invSnap, ledSnap, leaseSnap] = await Promise.all([
      tx.get(payRef),
      tx.get(db.doc(`${T}/renters/${renterId}`)),
      tx.get(db.collection(`${T}/rentInvoices`).where('renterId', '==', renterId)),
      tx.get(db.collection(`${T}/rentLedger`).where('renterId', '==', renterId)),
      tx.get(db.collection(`${T}/leases`).where('renterId', '==', renterId)),
    ]);
    if (already.exists) return { already: true, data: already.data() || {} };
    if (!renterSnap.exists) return { missing: true };
    const renter: any = renterSnap.data() || {};
    const invoices = invSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const ledger = ledSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const leases = leaseSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
    const lease: any = leases.find((l: any) => OPEN_LEASE.includes(String(l.status || ''))) || leases.sort((a: any, c: any) => String(c.startDate || '').localeCompare(String(a.startDate || '')))[0] || null;
    const booth: any = lease?.boothId ? ((await tx.get(db.doc(`${T}/booths/${lease.boothId}`))).data() || null) : null;
    const name = `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || renter.name || 'Renter';
    // A bill autopay may already have taken (the card company didn't answer) is checked first, never paid around.
    const unsure: any = invoices.find((i: any) => i.autopayUnconfirmed === true && ['due', 'late'].includes(String(i.status || '')));
    if (unsure) return { unsure: String(unsure.dueDate || '').slice(0, 10) };
    const plan = planRentPayment(amountCents, invoices, ledger);

    tx.set(payRef, {
      id: payRef.id, leaseId: lease?.id || '', renterId, boothId: lease?.boothId || null,
      type: 'payment', status: 'paid', amountCents: -amountCents,
      description: `Payment — ${methodLabel}`, dueDate: null, paidAt: date, method,
      stripePaymentIntentId: null,
      appliesToEntryIds: plan.charges.map((c) => c.id), appliesToInvoiceIds: plan.bills.map((x) => x.id),
      createdBy: actor.name || 'owner', note, transactionId: txnRef.id, createdAt: nowIso, updatedAt: nowIso,
    });
    const entry = buildLedgerEntry({
      source: 'booth_rent', sourceId: payRef.id, amountCents, category: 'Booth Rent',
      description: `Rent — ${booth?.name || 'space'} — ${name}${note ? ` · ${note}` : ''}`,
      clientOrVendor: name, date, paymentMethod: methodLabel,
    } as any);
    tx.set(txnRef, { ...entry, id: txnRef.id, tenantId, renterId, leaseId: lease?.id || null });
    for (const bill of plan.bills) {
      tx.set(db.doc(`${T}/rentInvoices/${bill.id}`), {
        paidCents: bill.paidCentsBefore + bill.takeCents, ledgerEntryId: payRef.id, updatedAt: nowIso,
        ...(bill.full ? { status: 'paid', paidAt: date, paidVia: method } : {}),
      }, { merge: true });
    }
    for (const c of plan.charges) tx.set(db.doc(`${T}/rentLedger/${c.id}`), { status: 'paid', paidAt: date, updatedAt: nowIso }, { merge: true });
    let creditId: string | null = null;
    if (plan.creditCents > 0) {
      const cRef = db.collection(`${T}/rentLedger`).doc(); creditId = cRef.id;
      tx.set(cRef, { id: cRef.id, renterId, leaseId: lease?.id || null, type: 'prepaid_credit', status: 'paid', amountCents: -plan.creditCents,
        note: 'Paid ahead: comes off the next rent', paymentEntryId: payRef.id, createdAt: nowIso, date });
    }
    const paidOff = plan.bills.reduce((s, x) => s + x.takeCents, 0) + plan.charges.reduce((s, c) => s + c.cents, 0);
    return { name, lease, booth, plan, paidOff, creditId };
  });

  if (out.missing) return NextResponse.json({ ok: false, error: 'That renter wasn’t found.' }, { status: 404 });
  if (out.unsure) return NextResponse.json({ ok: false, error: `Autopay may already have taken the bill due ${out.unsure}: the card company didn’t answer. Check your Stripe payments, then on the Rent page either record it or mark it as not taken, before recording this payment.` }, { status: 409 });
  if (out.already) return NextResponse.json({ ok: true, already: true, paymentId: payRef.id });

  const { name, lease, booth, plan, paidOff } = out;
  try {
    await logAuditAdmin(db, tenantId, {
      action: 'rent.payment_recorded', targetType: 'renter', targetId: renterId,
      summary: `Recorded a ${methodLabel} rent payment of ${usd(amountCents)} from ${name}${booth?.name ? ` (${booth.name})` : ''}${plan.creditCents > 0 ? `; ${usd(plan.creditCents)} kept as credit` : ''}`,
      amount: amountCents / 100, actor: { type: 'user', name: actor.name || 'Staff' },
    } as any);
  } catch { /* the payment stands */ }

  // The receipt, after the money is on the books: a mail problem never undoes a payment. It states where their account
  // stands now (bills and charges less any credit waiting), and links to their portal's Rent tab, where they sign in as
  // usual (no sign-in link is made for a receipt, so older links they were sent keep working).
  let sentTo: string | null = null;
  if (b.sendReceipt !== false && (tenant.rentComms?.sendReceipts !== false)) {
    try {
      const base = linkOrigin(tenant);
      const [invNow, ledNow] = await Promise.all([
        db.collection(`${T}/rentInvoices`).where('renterId', '==', renterId).get(),
        db.collection(`${T}/rentLedger`).where('renterId', '==', renterId).get(),
      ]);
      const pos = accountPosition(invNow.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })), ledNow.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })));
      let nextDue: string | null = null;
      try { nextDue = lease ? nextChargeDate(lease, addDays(today, 1)) : null; } catch { nextDue = null; }
      const r = await sendAccountReceipt(db, tenantId, tenant, { kind: 'rent', id: renterId, amountCents, receiptLink: base ? `${base}/rent/${encodeURIComponent(tenantId)}?tab=rent` : null,
        owedAfterCents: pos.owedCents, creditCents: pos.creditCents, nextDue });
      sentTo = r.sentTo;
    } catch (e) { console.error('[rent/record-payment] receipt', tenantId, renterId, e); }
  }

  return NextResponse.json({ ok: true, paymentId: payRef.id, paidOffCents: paidOff, creditCents: plan.creditCents, receiptSentTo: sentTo });
}
