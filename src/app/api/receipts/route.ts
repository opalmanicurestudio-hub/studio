// src/app/api/receipts/route.ts — RECEIPTS AND VOID SLIPS (printable, sendable).
// Built from what the SERVER recorded (never the screen's numbers).
//   GET ?tenantId&id&k        — the receipt / void slip, for its private page (/r/[tenantId]/[id]?k=)
//   POST link { receiptId }   — staff: the page's link (creates the private key for older receipts)
//   POST send { receiptId, channel: 'email' | 'sms', to? } — staff: send it to the client (or a given address)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
const key = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || ''), id = String(sp.get('id') || ''), k = String(sp.get('k') || '');
  const db = getAdminDb();
  const r: any = tenantId && id ? (await db.doc(`tenants/${tenantId}/receipts/${id}`).get()).data() : null;
  if (!r || !k || r.viewKey !== k) return NextResponse.json({ ok: false, error: 'This receipt isn’t available.' }, { status: 404 });
  const t: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const addr = t.address || t.businessAddress || null;
  return NextResponse.json({ ok: true,
    business: { name: t.name || t.businessName || 'Receipt', address: typeof addr === 'string' ? addr : [addr?.street, addr?.city, addr?.state, addr?.zip].filter(Boolean).join(', ') || null, phone: t.phone || t.businessPhone || null, email: t.email || t.contactEmail || null, timezone: t.timezone || null },
    receipt: { id, date: r.date, clientName: r.clientName || null, paidBy: r.paidBy || null, cashierName: r.cashierName || null, paymentMethod: r.paymentMethod, lineItems: r.lineItems || [],
      subtotal: r.subtotal, tax: r.tax, taxLabel: r.taxLabel || 'Tax', tip: r.tip, discount: r.discount, total: r.total, amountTendered: r.amountTendered, change: r.change,
      voided: !!r.voided, voidedAt: r.voidedAt || null, voidReason: r.voidReason || null, voidedBy: r.voidedBy || null, requestedBy: r.requestedBy || null, cashReturned: r.cashReturned || null, refunded: !!r.voidRefunded } });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), receiptId = String(b.receiptId || ''), action = String(b.action || 'link');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  // Today's receipts, straight from the server (so Today's sales never depends on a browser query).
  if (action === 'today') {
    const from = String(b.from || ''), to = String(b.to || '');
    if (!from || !to) return NextResponse.json({ ok: false, error: 'Missing the day.' }, { status: 400 });
    const snap = await db.collection(`${T}/receipts`).where('date', '>=', from).where('date', '<=', to).get();
    const receipts = snap.docs.map((d: any) => { const r: any = d.data();
      return { id: d.id, checkoutSessionId: r.checkoutSessionId || null, date: r.date, total: r.total, tip: r.tip || 0, clientName: r.clientName || null, clientId: r.clientId || null, paidBy: r.paidBy || null,
        paymentMethod: r.paymentMethod, voided: !!r.voided, voidReason: r.voidReason || null, needsReview: !!r.needsReview, reversal: !!r.reversal }; });
    return NextResponse.json({ ok: true, receipts });
  }
  const ref = db.doc(`${T}/receipts/${receiptId}`); const r: any = (await ref.get()).data();
  if (!r) return NextResponse.json({ ok: false, error: 'That receipt wasn’t found.' }, { status: 404 });
  let viewKey = r.viewKey; if (!viewKey) { viewKey = key(); await ref.set({ viewKey }, { merge: true }); }
  const t: any = ((await db.doc(T).get()).data() as any) || {};
  const url = `${linkOrigin(t, req.nextUrl.origin)}/r/${tenantId}/${receiptId}?k=${viewKey}`;
  if (action === 'link') return NextResponse.json({ ok: true, url });
  if (action === 'send') {
    const c: any = r.clientId ? (((await db.doc(`${T}/clients/${r.clientId}`).get()).data() as any) || {}) : {};
    const channel = b.channel === 'sms' ? 'sms' : 'email';
    const to = String(b.to || (channel === 'email' ? c.email : c.phone) || '').trim();
    if (!to || (channel === 'email' && !to.includes('@'))) return NextResponse.json({ ok: false, error: channel === 'email' ? 'No email address for this client — type one in.' : 'No mobile number for this client — type one in.' }, { status: 400 });
    const studio = t.name || t.businessName || 'Us';
    const what = r.voided ? (r.voidRefunded ? 'your refund slip' : r.cashReturned ? 'your void slip (cash returned)' : 'your void slip') : 'your receipt';
    const { sendNotification } = await import('@/lib/notify');
    let sent: any;
    if (channel === 'email') { const { brandedEmailHtml } = await import('@/lib/email-template');
      const replyTo = String(t.email || t.contactEmail || '').trim();
      sent = await sendNotification(db, { tenantId, channel: 'email', to, subject: `${r.voided ? 'Void slip' : 'Receipt'} — ${studio}`, kind: r.voided ? 'void_slip' : 'receipt',
        html: brandedEmailHtml({ studioName: studio, title: r.voided ? 'Your sale was voided' : 'Your receipt', bodyLines: [`Here’s ${what}${r.total ? ` for $${Number(r.total).toFixed(2)}` : ''}.`, r.voided && r.voidRefunded ? 'The refund goes back to your card and usually shows within 5–10 business days.' : ''].filter(Boolean), cta: { label: r.voided ? 'View the slip' : 'View your receipt', url } } as any),
        ...(replyTo.includes('@') ? { replyTo } : {}), clientId: r.clientId || null, clientName: r.clientName || null } as any);
    } else sent = await sendNotification(db, { tenantId, channel: 'sms', to, kind: r.voided ? 'void_slip' : 'receipt', text: `${studio}: here’s ${what} — ${url}`, clientId: r.clientId || null, clientName: r.clientName || null } as any);
    await ref.set({ sends: [...(r.sends || []), { at: new Date().toISOString(), channel, to, by: auth.actor.name, ok: !!sent?.ok }].slice(-20) }, { merge: true });
    return sent?.ok ? NextResponse.json({ ok: true, url }) : NextResponse.json({ ok: false, error: 'It didn’t send — check the address and try again.' }, { status: 502 });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
