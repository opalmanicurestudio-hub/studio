
// src/app/api/receipts/route.ts — RECEIPTS AND VOID SLIPS (printable, sendable).
// Built from what the SERVER recorded (never the screen's numbers).
//   GET ?tenantId&id&k        — the receipt / void slip, for its private page (/r/[tenantId]/[id]?k=)
//   POST link { receiptId }   — staff: the page's link (creates the private key for older receipts)
//   POST send { receiptId, channel: 'email' | 'sms', to? } — staff: send it to the client (or a given address)
//   POST print { receiptId, printerId?, drawer? } — staff: on the receipt printer (lib/printing receiptDoc), or, with no
//        networked receipt printer, the slip back for the tablet's own print dialog; `drawer`: a cash sale's drawer
//        opened with it (once, within a few minutes of the sale)
//   POST drawer { receiptId, printerId? } — staff: a cash sale's drawer opened with no receipt (the same once)
// A counter order's receipt (id co_<orderId>: the counter, the drive-thru, the kiosk, ordering ahead) is built from the
// order itself whenever it's asked for (lib/counter-receipt), never kept a second time.
import { NextRequest, NextResponse } from 'next/server';
import { counterSaleRow, hasReceipt } from '@/lib/counter-receipt';
import { receiptAct, receiptOf } from '@/lib/receipt-actions-server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';


export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || ''), id = String(sp.get('id') || ''), k = String(sp.get('k') || '');
  const db = getAdminDb();
  const got = /^[A-Za-z0-9_-]{1,160}$/.test(tenantId) && id ? await receiptOf(db, `tenants/${tenantId}`, id) : null; const r: any = got?.r || null;
  if (!r || !k || r.viewKey !== k) return NextResponse.json({ ok: false, error: 'This receipt isn’t available.' }, { status: 404 });
  const t: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const addr = t.address || t.businessAddress || null;
  // Rewards (lib/loyalty): what this sale earned, their balance now, and their private rewards page.
  let loyalty: any = null;
  if (t?.loyalty?.on === true && r.clientId && r.checkoutSessionId && !r.voided) { try {
    const { ledgerFor } = await import('@/lib/loyalty-server'); const { rewardsPath } = await import('@/lib/loyalty-link'); const { unitOf, loyaltyOf } = await import('@/lib/loyalty');
    const L = await ledgerFor(db, tenantId, String(r.clientId)); const earned = L.filter((e: any) => e.saleId === r.checkoutSessionId && e.type === 'earn').reduce((a: number, e: any) => a + e.points, 0);
    const used = L.filter((e: any) => e.saleId === r.checkoutSessionId && e.type === 'redeem').reduce((a: number, e: any) => a - e.points, 0);
    loyalty = { earned, used, balance: Math.max(0, L.reduce((a: number, e: any) => a + (Number(e.points) || 0), 0)), unit: unitOf(loyaltyOf(t)), url: rewardsPath(tenantId, String(r.clientId)) };
  } catch { loyalty = null; } }
  return NextResponse.json({ ok: true, loyalty,
    business: { name: t.name || t.businessName || 'Receipt', address: typeof addr === 'string' ? addr : [addr?.street, addr?.city, addr?.state, addr?.zip].filter(Boolean).join(', ') || null, phone: t.phone || t.businessPhone || null, email: t.email || t.contactEmail || null, timezone: t.timezone || null },
    receipt: { id, orderNumber: r.orderNumber || null, channelName: r.source === 'counter' ? r.channelName || null : null, date: r.date, clientName: r.clientName || null, paidBy: r.paidBy || null, cashierName: r.cashierName || null, paymentMethod: r.paymentMethod, lineItems: r.lineItems || [],
      subtotal: r.subtotal, tax: r.tax, taxLabel: r.taxLabel || 'Tax', tip: r.tip, discount: r.discount, detail: r.detail ? { ...r.detail, payments: (r.detail.payments || []).map(({ pi, ...x }: any) => x) } : null, discounts: Array.isArray(r.discounts) ? r.discounts.map((d: any) => ({ label: String(d.label || 'Discount'), amount: Number(d.amount) || 0 })) : null, refunds: Array.isArray(r.refunds) ? r.refunds.map((x: any) => ({ cents: Number(x.cents) || 0, reason: x.reason || null })) : null, total: r.total, amountTendered: r.amountTendered, change: r.change,
      voided: !!r.voided, voidedAt: r.voidedAt || null, voidReason: r.voidReason || null, voidedBy: r.voidedBy || null, requestedBy: r.requestedBy || null, cashReturned: r.cashReturned || null, refunded: !!r.voidRefunded } });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), receiptId = String(b.receiptId || ''), action = String(b.action || 'link');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  // A renter working here: never the business's own counter sales, nor its cash drawer.
  const renter = auth.actor?.isRenter === true;
  // Today's receipts, straight from the server (so Today's sales never depends on a browser query).
  if (action === 'today') {
    const from = String(b.from || ''), to = String(b.to || '');
    if (!from || !to) return NextResponse.json({ ok: false, error: 'Missing the day.' }, { status: 400 });
    const [snap, co] = await Promise.all([db.collection(`${T}/receipts`).where('date', '>=', from).where('date', '<=', to).get(),
      // The counter's paid orders (lib/counter-receipt), beside the front desk's (a staff meal takes no money).
      renter ? { docs: [] as any[] } : db.collection(`${T}/counterOrders`).where('paidAt', '>=', from).where('paidAt', '<=', to)
        .select('paidAt', 'payMethod', 'number', 'channel', 'guestName', 'total', 'tipCents', 'status', 'voidReason', 'voidedAt', 'refundedAt', 'refundedCents', 'ahead.delivery.state', 'toGo', 'locationId')
        .limit(3000).get().catch((e: any) => { console.warn('[receipts] today: the counter’s sales weren’t read', e?.message || e); return { docs: [] as any[] }; })]);
    const receipts = snap.docs.map((d: any) => { const r: any = d.data();
      return { id: d.id, checkoutSessionId: r.checkoutSessionId || null, date: r.date, total: r.total, tip: r.tip || 0, clientName: r.clientName || null, clientId: r.clientId || null, paidBy: r.paidBy || null,
        paymentMethod: r.paymentMethod, payments: Array.isArray(r.payments) ? r.payments.map((x: any) => ({ method: x.method, amount: x.amount, tip: x.tip || 0, payerName: x.payerName || null })) : null, voided: !!r.voided, voidReason: r.voidReason || null, needsReview: !!r.needsReview, reversal: !!r.reversal }; });
    const counter = co.docs.filter((d: any) => hasReceipt(d.data())).map((d: any) => counterSaleRow(d.data(), d.id));
    return NextResponse.json({ ok: true, receipts: [...receipts, ...counter] });
  }
  if (!['link', 'print', 'drawer', 'send'].includes(action)) return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  const x = await receiptAct(db, tenantId, receiptId, action, b, { name: String(auth.actor?.name || ''), isRenter: renter }, req.nextUrl.origin);
  return NextResponse.json(x.body, { status: x.status });
}
