
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
import { randomBytes } from 'crypto';
import { COUNTER_RECEIPT, counterReceipt, counterSaleRow, hasReceipt } from '@/lib/counter-receipt';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';
import { isPlaceholderName } from '@/lib/visit-email';


const $ = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
/** The receipt as label and amount rows for the email (the link has the full printable version). */
function receiptRows(r: any): { label: string; value: string; strong?: boolean; muted?: boolean }[] {
  const D = r?.detail; if (!D || r.voided) return [];
  const out: { label: string; value: string; strong?: boolean; muted?: boolean }[] = [];
  for (const l of D.lines || []) if (l.kind !== 'note') out.push({ label: `${l.kind === 'addon' ? '+ ' : ''}${l.label}${l.qty > 1 ? ` × ${l.qty}` : ''}${l.staff ? ` (${l.staff})` : ''}`, value: l.redeemed ? 'Included' : $(l.amount) });
  for (const f of D.fees || []) out.push({ label: String(f.label || 'Fee'), value: $(f.amount) });
  for (const d of r.discounts || []) out.push({ label: String(d.label || 'Discount'), value: `−${$(d.amount)}` });
  if (Number(r.tax) > 0) out.push({ label: r.taxLabel || 'Tax', value: $(r.tax), muted: true });
  if (Number(r.tip) > 0) out.push({ label: `Tip${(D.tipShares || []).length > 1 ? ` (${D.tipShares.map((t: any) => `${t.name} ${$(t.amount)}`).join(', ')})` : ''}`, value: $(r.tip), muted: true });
  if (Number(D.depositUsed) > 0) out.push({ label: 'Deposit already paid', value: `−${$(D.depositUsed)}`, muted: true });
  if (Number(D.storeCredit) > 0) out.push({ label: 'Store credit used', value: `−${$(D.storeCredit)}`, muted: true });
  out.push({ label: 'Total', value: $(r.total), strong: true });
  for (const a of D.accounts || []) out.push(a.kind === 'rent'
    ? { label: 'Rent', value: Number(a.owedAfterCents) > 0 ? `${$(a.owedAfterCents / 100)} still owed` : Number(a.creditCents) > 0 ? `${$(a.creditCents / 100)} paid ahead` : 'All paid up', muted: true }
    : { label: 'Tuition', value: Number(a.remainingCents) > 0 ? `${$(a.remainingCents / 100)} remaining` : 'Paid in full', muted: true });
  return out;
}

export const dynamic = 'force-dynamic';
const key = () => randomBytes(18).toString('base64url');

/** A receipt by its id: the front desk's (kept), or a counter order's (built from the order). */
async function receiptOf(db: any, T: string, id: string): Promise<{ r: any; ref: any; counter: boolean } | null> {
  const m = id.match(COUNTER_RECEIPT);
  if (m) {
    const ref = db.doc(`${T}/counterOrders/${m[1]}`); const o: any = (await ref.get()).data();
    return o && hasReceipt(o) ? { r: counterReceipt(o, m[1]), ref, counter: true } : null;
  }
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) return null;
  const ref = db.doc(`${T}/receipts/${id}`); const r: any = (await ref.get()).data();
  return r ? { r, ref, counter: false } : null;
}
/** Its private key (made for one that has none yet: older receipts, and every counter order's until it's first asked). */
async function keyOf(db: any, x: { r: any; ref: any; counter: boolean }): Promise<string> {
  if (x.r.viewKey) return String(x.r.viewKey);
  // (Read again in the same step: two screens asking at once get the same key, so a link already sent keeps working.)
  const field = x.counter ? 'receiptKey' : 'viewKey';
  const k = await db.runTransaction(async (tx: any) => { const d: any = (await tx.get(x.ref)).data() || {}; if (d[field]) return String(d[field]); const n = key(); tx.set(x.ref, { [field]: n }, { merge: true }); return n; });
  x.r.viewKey = k; return k;
}
const DRAWER_MS = 15 * 60000;
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
  const got = await receiptOf(db, T, receiptId);
  if (!got) return NextResponse.json({ ok: false, error: 'That receipt could not be found.' }, { status: 404 });
  if (renter && (got.counter || action === 'drawer')) return NextResponse.json({ ok: false, error: 'That’s for the business’s own team.' }, { status: 403 });
  const { r, ref } = got;
  const viewKey = await keyOf(db, got);
  const t: any = ((await db.doc(T).get()).data() as any) || {};
  const url = `${linkOrigin(t, req.nextUrl.origin)}/r/${tenantId}/${receiptId}?k=${viewKey}`;
  if (action === 'link') return NextResponse.json({ ok: true, url });
  if (action === 'print' || action === 'drawer') {
    const { printersOf, queueJob } = await import('@/lib/printing-server'); const { receiptDoc, drawerDoc } = await import('@/lib/printing');
    const all = await printersOf(db, T);
    const want = String(b.printerId || '');
    const pick = (list: any[]) => list.find((p) => p.id === want) || (list.length === 1 ? list[0] : null);
    // The drawer: only a cash sale's, once, within a few minutes of it (never a way to open the drawer at any time). It's
    // the picked printer's own drawer, or the only printer with one.
    const cashNow = String(r.paymentMethod) === 'cash' && !r.voided && Date.now() - (Date.parse(String(r.date || '')) || 0) < DRAWER_MS;
    const wantsDrawer = !renter && (action === 'drawer' || b.drawer === true);
    const drawers = all.filter((p: any) => p.drawer);
    const drawerAt = wantsDrawer && cashNow ? pick(drawers) : null;
    let opened = false; let drawerQueued = false;
    if (drawerAt) {
      opened = await db.runTransaction(async (tx: any) => { const d: any = (await tx.get(ref)).data() || {}; if (d.drawerOpenedAt) return false; tx.set(ref, { drawerOpenedAt: new Date().toISOString(), drawerOpenedBy: auth.actor.name || null }, { merge: true }); return true; });
    }
    // (Marked opened before it's sent: a send that didn't go through takes the mark back, so it can be tried again.)
    const drawerJob = async () => { await queueJob(db, T, drawerAt.id, 'drawer', drawerDoc(), { receiptId }); drawerQueued = true; };
    const unmark = async () => { if (opened && !drawerQueued) await ref.set({ drawerOpenedAt: null, drawerOpenedBy: null }, { merge: true }).catch(() => undefined); };
    if (action === 'drawer') {
      if (!opened) return NextResponse.json({ ok: false, error: !cashNow ? 'The drawer opens only for a cash sale, just after it.' : !drawers.length ? 'No printer here opens a cash drawer. Turn it on in Printers.'
        : !drawerAt ? 'More than one printer opens a drawer. Pick this screen’s receipt printer, the one with the drawer.' : 'The drawer was already opened for this sale.' }, { status: 409 });
      try { await drawerJob(); } catch { await unmark(); return NextResponse.json({ ok: false, error: 'The drawer didn’t open. Try again.' }, { status: 503 }); }
      return NextResponse.json({ ok: true, printer: drawerAt.name });
    }
    const addr = t.address || t.businessAddress || null;
    const doc = receiptDoc(r, { business: String(t.name || t.businessName || 'Receipt'), address: typeof addr === 'string' ? addr : [addr?.street, addr?.city, addr?.state].filter(Boolean).join(', ') || null, tz: t.timezone || null, url });
    const printers = all.filter((p: any) => p.receipts);
    const at = pick(printers);
    // (No networked receipt printer here, or more than one and none picked: the slip, for the tablet's own print dialog.)
    try {
      if (!at) {
        if (opened) await drawerJob();
        return NextResponse.json({ ok: true, doc, printers: printers.map((p: any) => ({ id: p.id, name: p.name })), drawer: opened });
      }
      // A drawer on another printer than the receipt's opens by itself.
      if (opened && drawerAt.id !== at.id) await drawerJob();
      await queueJob(db, T, at.id, 'receipt', opened && drawerAt.id === at.id ? { ...doc, drawer: true } : doc, { receiptId });
      drawerQueued = opened;
    } catch {
      await unmark();
      return NextResponse.json({ ok: false, error: 'The receipt didn’t reach the printer. Try again.' }, { status: 503 });
    }
    return NextResponse.json({ ok: true, printer: at.name, drawer: opened });
  }
  if (action === 'send') {
    const c: any = r.clientId ? (((await db.doc(`${T}/clients/${r.clientId}`).get()).data() as any) || {}) : {};
    const channel = b.channel === 'sms' ? 'sms' : 'email';
    const to = String(b.to || (channel === 'email' ? c.email : c.phone) || '').trim();
    if (!to || (channel === 'email' && !to.includes('@'))) return NextResponse.json({ ok: false, error: channel === 'email' ? 'There is no email address on file for this client. Please enter one.' : 'There is no mobile number on file for this client. Please enter one.' }, { status: 400 });
    const studio = t.name || t.businessName || 'Our team';
    const full = String(r.clientName || c.name || '').trim();
    const first = full && !isPlaceholderName(full) ? full.split(/\s+/)[0] : 'there';   // a walk-in's placeholder is no name
    const what = r.voided ? (r.voidRefunded ? 'your refund slip' : r.cashReturned ? 'your void slip (cash returned)' : 'your void slip') : 'your receipt';
    const { sendNotification } = await import('@/lib/notify');
    let sent: any;
    if (channel === 'email') { const { brandedEmailHtml } = await import('@/lib/email-template');
      const replyTo = String(t.email || t.contactEmail || '').trim();
      sent = await sendNotification(db, { tenantId, channel: 'email', to, subject: `${studio}: ${r.voided ? 'your void slip' : 'your receipt'}`, kind: r.voided ? 'void_slip' : 'receipt',
        html: brandedEmailHtml(r.voided
          ? { studioName: studio, eyebrow: r.voidRefunded ? 'Refund slip' : 'Void slip', title: 'Your sale was', titleBold: 'voided',
              bodyLines: [`Hi ${first}, here is ${what}${r.total ? ` for $${Number(r.total).toFixed(2)}` : ''}.`, r.voidRefunded ? 'The refund will be returned to your card and usually appears within 5 to 10 business days.' : ''],
              cta: { label: 'View the slip', url } }
          : { studioName: studio, eyebrow: 'Receipt', title: first === 'there' ? 'Thanks for coming in' : 'Thanks for coming in,', titleBold: first === 'there' ? '' : first,
              preheader: r.total ? `Your receipt for $${Number(r.total).toFixed(2)}` : 'Your receipt',
              amounts: receiptRows(r), ...(receiptRows(r).length ? {} : { bodyLines: [`Here is your receipt${r.total ? ` for $${Number(r.total).toFixed(2)}` : ''}.`] }),
              cta: { label: 'View your receipt', url },
              // "Book again" when the sale was a visit (never on a shop-only sale, or rent and tuition).
              links: (r.detail?.lines || []).some((l: any) => l.kind === 'service') ? [{ label: 'Book again', url: `${linkOrigin(t, req.nextUrl.origin)}/book/${encodeURIComponent(tenantId)}` }] : null }),
        ...(replyTo.includes('@') ? { replyTo } : {}), clientId: r.clientId || null, clientName: r.clientName || null } as any);
    } else sent = await sendNotification(db, { tenantId, channel: 'sms', to, kind: r.voided ? 'void_slip' : 'receipt', text: `Hi ${first}, here is ${what}: ${url}`, clientId: r.clientId || null, clientName: r.clientName || null } as any);
    const prior: any[] = got.counter ? (((await ref.get()).data() as any)?.receiptSends || []) : (r.sends || []);
    await ref.set({ [got.counter ? 'receiptSends' : 'sends']: [...prior, { at: new Date().toISOString(), channel, to, by: auth.actor.name, ok: !!sent?.ok }].slice(-20) }, { merge: true });
    return sent?.ok ? NextResponse.json({ ok: true, url }) : NextResponse.json({ ok: false, error: 'The message could not be sent. Please check the address and try again.' }, { status: 502 });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
