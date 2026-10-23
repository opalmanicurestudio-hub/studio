// src/app/api/clients/balance/route.ts — A CLIENT'S BALANCE, SETTLED AT THE DESK.
// (Charging their saved card is /api/portal/pay-balance.) Staff only.
//   settled — paid at the desk (cash, card terminal, other): recorded as a payment, balance cleared
//   link    — a pay link to their OWN email / phone on file (never shown on screen; at most hourly)
//   waive   — managers only, with a reason: balance cleared, nothing recorded as paid
// Settled and waived are each one step that reads the balance, records it and clears it, so two devices pressing at
// once record it once (the record is named after the balance it settles; the second press is told it's done). Neither
// happens while a card payment for any of it is going through (automatic collection, the desk's Charge card, an online
// payment — lib/fee-pay): a payment Stripe never answered is looked up first, so cash is never recorded on top of a
// card payment that went through.
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { linkOrigin } from '@/lib/app-origin';
import { anyStaleClaim, paymentGoingThrough, resolveStaleFees } from '@/lib/fee-pay';

export const dynamic = 'force-dynamic';
const VIA: Record<string, string> = { cash: 'Cash', terminal: 'Card (terminal)', other: 'Other' };
const BUSY = 'A card payment for this balance is going through right now. Check again in a couple of minutes before recording anything.';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), clientId = String(b.clientId || ''), action = String(b.action || '');
  if (!tenantId || !clientId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Please sign in to continue.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const cRef = db.doc(`${T}/clients/${clientId}`); const c: any = (await cRef.get()).data();
  if (!c) return NextResponse.json({ ok: false, error: 'We could not find that client.' }, { status: 404 });
  const dollars = Math.round((Number(c.outstandingBalance) || 0) * 100) / 100;
  if (!(dollars > 0)) return NextResponse.json({ ok: true, already: true });
  const nowIso = new Date().toISOString();
  const actor = { type: 'user' as const, id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role };
  const first = String(c.name || 'the client').split(' ')[0];

  // A card payment Stripe never answered (or a run cut off after charging): found at Stripe first, then decided.
  const checkStale = async () => {
    if (!anyStaleClaim(c)) return;
    const tenant: any = ((await db.doc(T).get()).data() as any) || {};
    if (!process.env.STRIPE_SECRET_KEY || !tenant.stripeAccountId) return;
    const stripe: any = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
    await resolveStaleFees(db, stripe, tenantId, tenant, clientId).catch(() => null);
  };
  // The balance, read and cleared in one step: the one press that finds it still owed records it.
  const clearOnce = async (record: (tx: any, cur: any, cents: number) => any): Promise<{ busy?: boolean; already?: boolean; dollars?: number }> => db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(cRef)).data() || {}; const cents = Math.round((Number(cur.outstandingBalance) || 0) * 100);
    if (cents <= 0) return { already: true };
    if (paymentGoingThrough(cur)) return { busy: true };
    const ok = await record(tx, cur, cents); if (ok === false) return { already: true };
    return { dollars: cents / 100 };
  });

  if (action === 'settled') {
    const via = VIA[b.via] ? b.via : 'other';
    await checkStale();
    const r = await clearOnce(async (tx, cur, cents) => {
      // Named after the balance it settles (its fees, amount and version), so a second press finds it.
      const ids = (Array.isArray(cur.unpaidFees) ? cur.unpaidFees : []).map((f: any) => String(f.feeId)).sort().join(',');
      const name = crypto.createHash('sha1').update(`${ids}|${cents}|${cur.balanceVersion || ''}`).digest('hex').slice(0, 16);
      const lineRef = db.doc(`${T}/transactions/deskpay_${clientId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)}_${name}`);
      if ((await tx.get(lineRef)).exists) return false;
      tx.set(lineRef, { id: lineRef.id, tenantId, date: nowIso, description: 'Balance paid at the desk', clientOrVendor: cur.name || null, clientId, type: 'income', context: 'Business', category: 'Fee Recovery', amount: cents / 100, paymentMethod: VIA[via], hasReceipt: false, recordedBy: auth.actor.name });
      tx.set(cRef, { outstandingBalance: 0, unpaidFees: [], balancePaidAt: nowIso, balanceVersion: nowIso }, { merge: true });
      return true;
    });
    if (r.busy) return NextResponse.json({ ok: false, error: BUSY, code: 'in_progress' }, { status: 409 });
    if (r.already) return NextResponse.json({ ok: true, already: true });
    await logAuditAdmin(db, tenantId, { action: 'balance.paid', targetType: 'client', targetId: clientId, amount: r.dollars, summary: `${c.name || 'Client'} paid a $${(r.dollars || 0).toFixed(2)} balance at the desk (${VIA[via]})`, actor }).catch(() => {});
    return NextResponse.json({ ok: true, paidDollars: r.dollars });
  }
  if (action === 'waive') {
    if (!['owner', 'admin', 'manager'].includes(String(auth.actor.role || '').toLowerCase())) return NextResponse.json({ ok: false, error: 'Only a manager can waive a balance.' }, { status: 403 });
    const reason = String(b.reason || '').trim().slice(0, 200);
    if (!reason) return NextResponse.json({ ok: false, error: 'Please add a reason for waiving the balance.' }, { status: 400 });
    await checkStale();
    const r = await clearOnce(async (tx, _cur, cents) => { tx.set(cRef, { outstandingBalance: 0, unpaidFees: [], balanceWaivedAt: nowIso, balanceWaived: { amount: cents / 100, reason, by: auth.actor.name }, balanceVersion: nowIso }, { merge: true }); return true; });
    if (r.busy) return NextResponse.json({ ok: false, error: BUSY, code: 'in_progress' }, { status: 409 });
    if (r.already) return NextResponse.json({ ok: true, already: true });
    await logAuditAdmin(db, tenantId, { action: 'balance.waived', targetType: 'client', targetId: clientId, amount: r.dollars, summary: `$${(r.dollars || 0).toFixed(2)} balance waived for ${c.name || 'client'} — ${reason}`, actor }).catch(() => {});
    return NextResponse.json({ ok: true, waivedDollars: r.dollars });
  }
  if (action === 'link') {
    const last = Date.parse(c.balanceLinkSentAt || '');
    if (Number.isFinite(last) && Date.now() - last < 3600000) return NextResponse.json({ ok: false, error: `A pay link was sent to ${first} less than an hour ago.` }, { status: 429 });
    const email = String(c.email || '').trim(), phone = String(c.phone || '').trim();
    if (!email.includes('@') && phone.replace(/\D/g, '').length < 7) return NextResponse.json({ ok: false, error: `${first} has no email address or phone number on file.` }, { status: 400 });
    const tenant: any = ((await db.doc(T).get()).data() as any) || {};
    const { portalKey } = await import('@/lib/portal-key');
    const url = `${linkOrigin(tenant, req.nextUrl.origin)}/portal/${tenantId}/${clientId}?k=${encodeURIComponent(portalKey(tenantId, clientId) || '')}`;
    const studio = tenant.name || 'the studio';
    const { sendNotification } = await import('@/lib/notify');
    let sent = false;
    if (email.includes('@')) {
      const { brandedEmailHtml } = await import('@/lib/email-template');
      sent = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `Your balance with ${studio}`, kind: 'balance_due', html: brandedEmailHtml({ studioName: studio, title: 'Your balance', bodyLines: [`Hi ${String(c.name || '').trim().split(' ')[0] || 'there'},`, `You have an outstanding balance of $${dollars.toFixed(2)} with us. You can pay it securely using the link below at your convenience.`, 'If you have any questions, please reply to this email.', 'Kind regards,', studio], cta: { label: 'Pay my balance', url } } as any), clientId, clientName: c.name || null } as any))?.ok || sent;
    }
    if (!sent && phone) sent = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'balance_due', text: `Hi ${String(c.name || '').trim().split(' ')[0] || 'there'}, you have an outstanding balance of $${dollars.toFixed(2)}. You can pay securely here: ${url}. If you have any questions, please reply to this message.`, clientId, clientName: c.name || null } as any))?.ok;
    if (!sent) return NextResponse.json({ ok: false, error: 'The payment link could not be sent. Please check their contact details.' }, { status: 502 });
    await cRef.set({ balanceLinkSentAt: nowIso }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'balance.link_sent', targetType: 'client', targetId: clientId, amount: dollars, summary: `Pay link sent to ${c.name || 'client'} for a $${dollars.toFixed(2)} balance`, actor }).catch(() => {});
    return NextResponse.json({ ok: true, sentTo: email.includes('@') ? 'email' : 'text' });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
