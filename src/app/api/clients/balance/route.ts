// src/app/api/clients/balance/route.ts — A CLIENT'S BALANCE, SETTLED AT THE DESK.
// (Charging their saved card is /api/portal/pay-balance.) Staff only.
//   settled — paid at the desk (cash, card terminal, other): recorded as a payment, balance cleared
//   link    — a pay link to their OWN email / phone on file (never shown on screen; at most hourly)
//   waive   — managers only, with a reason: balance cleared, nothing recorded as paid
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
const VIA: Record<string, string> = { cash: 'Cash', terminal: 'Card (terminal)', other: 'Other' };

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), clientId = String(b.clientId || ''), action = String(b.action || '');
  if (!tenantId || !clientId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const cRef = db.doc(`${T}/clients/${clientId}`); const c: any = (await cRef.get()).data();
  if (!c) return NextResponse.json({ ok: false, error: 'That client wasn’t found.' }, { status: 404 });
  const dollars = Math.round((Number(c.outstandingBalance) || 0) * 100) / 100;
  if (!(dollars > 0)) return NextResponse.json({ ok: true, already: true });
  const nowIso = new Date().toISOString();
  const actor = { type: 'user' as const, id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role };
  const first = String(c.name || 'the client').split(' ')[0];

  if (action === 'settled') {
    const via = VIA[b.via] ? b.via : 'other';
    const txRef = db.collection(`${T}/transactions`).doc(); const batch = db.batch();
    batch.set(txRef, { id: txRef.id, tenantId, date: nowIso, description: 'Balance paid at the desk', clientOrVendor: c.name || null, clientId, type: 'income', context: 'Business', category: 'Fee Recovery', amount: dollars, paymentMethod: VIA[via], hasReceipt: false, recordedBy: auth.actor.name });
    batch.set(cRef, { outstandingBalance: 0, unpaidFees: [], balancePaidAt: nowIso, balanceVersion: nowIso }, { merge: true });
    await batch.commit();
    await logAuditAdmin(db, tenantId, { action: 'balance.paid', targetType: 'client', targetId: clientId, amount: dollars, summary: `${c.name || 'Client'} paid a $${dollars.toFixed(2)} balance at the desk (${VIA[via]})`, actor }).catch(() => {});
    return NextResponse.json({ ok: true, paidDollars: dollars });
  }
  if (action === 'waive') {
    if (!['owner', 'admin', 'manager'].includes(String(auth.actor.role || '').toLowerCase())) return NextResponse.json({ ok: false, error: 'Only a manager can waive a balance.' }, { status: 403 });
    const reason = String(b.reason || '').trim().slice(0, 200);
    if (!reason) return NextResponse.json({ ok: false, error: 'Add a reason for waiving it.' }, { status: 400 });
    await cRef.set({ outstandingBalance: 0, unpaidFees: [], balanceWaivedAt: nowIso, balanceWaived: { amount: dollars, reason, by: auth.actor.name }, balanceVersion: nowIso }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'balance.waived', targetType: 'client', targetId: clientId, amount: dollars, summary: `$${dollars.toFixed(2)} balance waived for ${c.name || 'client'} — ${reason}`, actor }).catch(() => {});
    return NextResponse.json({ ok: true, waivedDollars: dollars });
  }
  if (action === 'link') {
    const last = Date.parse(c.balanceLinkSentAt || '');
    if (Number.isFinite(last) && Date.now() - last < 3600000) return NextResponse.json({ ok: false, error: `A pay link was sent to ${first} less than an hour ago.` }, { status: 429 });
    const email = String(c.email || '').trim(), phone = String(c.phone || '').trim();
    if (!email.includes('@') && phone.replace(/\D/g, '').length < 7) return NextResponse.json({ ok: false, error: `${first} has no email or phone on file to send it to.` }, { status: 400 });
    const tenant: any = ((await db.doc(T).get()).data() as any) || {};
    const url = `${linkOrigin(tenant, req.nextUrl.origin)}/portal/${tenantId}/${clientId}`;
    const studio = tenant.name || 'the studio';
    const { sendNotification } = await import('@/lib/notify');
    let sent = false;
    if (email.includes('@')) {
      const { brandedEmailHtml } = await import('@/lib/email-template');
      sent = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `Your balance with ${studio}`, kind: 'balance_due', html: brandedEmailHtml({ studioName: studio, title: 'Your balance', bodyLines: [`You have a $${dollars.toFixed(2)} balance with us. You can pay it securely here whenever it suits you.`], cta: { label: 'Pay my balance', url } } as any), clientId, clientName: c.name || null } as any))?.ok || sent;
    }
    if (!sent && phone) sent = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'balance_due', text: `${studio}: you have a $${dollars.toFixed(2)} balance. Pay securely here: ${url}`, clientId, clientName: c.name || null } as any))?.ok;
    if (!sent) return NextResponse.json({ ok: false, error: 'The link didn’t send — check their contact details.' }, { status: 502 });
    await cRef.set({ balanceLinkSentAt: nowIso }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'balance.link_sent', targetType: 'client', targetId: clientId, amount: dollars, summary: `Pay link sent to ${c.name || 'client'} for a $${dollars.toFixed(2)} balance`, actor }).catch(() => {});
    return NextResponse.json({ ok: true, sentTo: email.includes('@') ? 'email' : 'text' });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
