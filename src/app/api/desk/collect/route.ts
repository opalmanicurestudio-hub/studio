// src/app/api/desk/collect/route.ts — COLLECTING FROM SOMEONE WHO ISN'T AT THE COUNTER (staff).
//   { action: 'charge-card', clientId, feeIds, approvalToken? } — charge their card on file for these fees, if the
//       business allows it (Settings → Fees & credit → "Charging a saved card when the client isn't here"):
//       off · a manager approves every charge (default) · staff up to an amount, a manager above it.
//   { action: 'pay-link', kind: 'fees' | 'rent' | 'tuition', clientId?, feeIds?, renterId?, planId? } — text / email them
//       a link to pay: fees → a secure link for exactly those fees; rent / tuition → their own portal, signed in.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { linkOrigin } from '@/lib/app-origin';
import { cardChargeRule } from '@/lib/fee-pay';
export const dynamic = 'force-dynamic';
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const db = getAdminDb(); const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  if (!tenant.stripeAccountId) return NextResponse.json({ ok: false, error: 'Card payments aren’t set up for this business yet.' }, { status: 400 });
  const StripeLib = (await import('stripe')).default; const stripe = new StripeLib(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any });
  const by = auth.actor.name || 'Front desk'; const feeIds: string[] = Array.isArray(b.feeIds) ? b.feeIds.map(String).slice(0, 20) : [];
  const clientId = String(b.clientId || '');

  if (b.action === 'charge-card') {
    const rule = cardChargeRule(tenant);
    if (rule.mode === 'off') return NextResponse.json({ ok: false, error: 'This business doesn’t charge saved cards when the client isn’t here — send a pay link instead.' }, { status: 403 });
    const c: any = (await db.doc(`tenants/${tenantId}/clients/${clientId}`).get()).data(); if (!c) return NextResponse.json({ ok: false, error: 'Client not found.' }, { status: 404 });
    const cents = Math.round((Array.isArray(c.unpaidFees) ? c.unpaidFees : []).filter((f: any) => feeIds.includes(f.feeId)).reduce((n: number, f: any) => n + num(f.feeAmount), 0) * 100);
    if (cents <= 0) return NextResponse.json({ ok: false, error: 'Those fees are already paid.' }, { status: 409 });
    const isManager = !!(auth.actor.isManager || auth.actor.isTenantOwner);
    const needsApproval = !isManager && (rule.mode === 'manager' || cents > rule.limitCents);
    let approvedBy: string | null = isManager ? by : null;
    if (needsApproval) {
      if (!b.approvalToken) return NextResponse.json({ ok: false, needsApproval: true, error: rule.mode === 'manager' ? 'A manager needs to approve this charge.' : `Over $${(rule.limitCents / 100).toFixed(2)} — a manager needs to approve this charge.` }, { status: 403 });
      const { consumeApproval } = await import('@/lib/approvals');
      const ap: any = await consumeApproval(db, tenantId, b.approvalToken, { kind: 'card_charge', amount: cents / 100, ref: clientId }).catch(() => null);
      if (!ap) return NextResponse.json({ ok: false, needsApproval: true, error: 'That approval didn’t work — ask a manager again.' }, { status: 403 });
      approvedBy = ap.approverName || 'Manager';
    }
    const { chargeFeesNow } = await import('@/lib/fee-pay');
    const r: any = await chargeFeesNow(db, stripe, tenantId, tenant, { clientId, feeIds, by });
    try { const { logAuditAdmin } = await import('@/lib/audit'); await logAuditAdmin(db, tenantId, { action: r.ok ? 'fees.charged_card_on_file' : 'fees.charge_failed', targetType: 'client', targetId: clientId, amount: cents / 100,
      summary: `${r.ok ? 'Charged' : 'Tried to charge'} ${c.name || 'client'}’s card on file $${(cents / 100).toFixed(2)} for fees${approvedBy ? ` — approved by ${approvedBy}` : ''}${r.ok ? '' : ` — ${r.error}`}`, actor: { type: 'user', id: auth.actor.uid, name: by, role: auth.actor.role } } as any); } catch { /* best effort */ }
    return NextResponse.json({ ...r, approvedBy }, { status: r.ok ? 200 : 402 });
  }

  if (b.action === 'pay-link') {
    const base = linkOrigin(tenant, req.nextUrl.origin); const { sendNotification } = await import('@/lib/notify'); const { MESSAGE_KINDS, resolveMessagePolicy, renderMessage } = await import('@/lib/message-policy');
    let to: { name: string; email?: string | null; phone?: string | null; clientId?: string | null } | null = null; let link = ''; let what = ''; let cents = 0;
    if (b.kind === 'rent' || b.kind === 'tuition') {
      const { accountContact, autopayLink } = await import('@/lib/account-receipts'); const id = String(b.kind === 'rent' ? b.renterId : b.planId || '');
      const ct: any = await accountContact(db, tenantId, b.kind, id); to = ct; link = (await autopayLink(db, tenantId, tenant, b.kind, id, true)) || ''; what = b.kind === 'rent' ? 'your rent' : 'your tuition'; cents = Math.round(num(b.cents));
    } else {
      const { feePayLink } = await import('@/lib/fee-pay'); const r: any = await feePayLink(db, stripe, tenantId, tenant, { clientId, feeIds, origin: base });
      if (!r.ok) return NextResponse.json(r, { status: 409 });
      to = { name: r.client.name || 'there', email: r.client.email || null, phone: r.client.phone || null, clientId }; link = r.url; what = 'what’s owed on your account'; cents = r.cents;
    }
    if (!to?.phone && !to?.email) return NextResponse.json({ ok: false, error: 'No phone or email on file.' }, { status: 400 });
    if (!link) return NextResponse.json({ ok: false, error: 'This business’s web address isn’t set up.' }, { status: 400 });
    const def: any = (MESSAGE_KINDS as any[]).find((k) => k.id === 'pay_link') || {}; const sent: string[] = [];
    const toks = { first: String(to.name || 'there').split(' ')[0], amount: cents > 0 ? `$${(cents / 100).toFixed(2)}` : 'what you owe', what, link, studio: tenant.name || 'The studio' };
    for (const channel of ['sms', 'email'] as const) { const addr = channel === 'sms' ? to.phone : to.email; if (!addr) continue;
      const p: any = resolveMessagePolicy(tenant, 'pay_link', channel); const body = renderMessage(p.body || def.defaultBody, toks);
      try { const r: any = channel === 'sms' ? await sendNotification(db, { tenantId, channel, to: addr, kind: 'pay_link', clientId: to.clientId || null, clientName: to.name, text: body } as any)
          : await (async () => { const { brandedEmailHtml } = await import('@/lib/email-template'); return sendNotification(db, { tenantId, channel, to: addr, kind: 'pay_link', clientId: to!.clientId || null, clientName: to!.name, subject: renderMessage(p.subject || def.defaultSubject, toks), html: brandedEmailHtml({ studioName: toks.studio, title: 'Your payment link', bodyLines: [body] } as any) } as any); })();
        if (r?.ok) sent.push(channel === 'sms' ? 'text' : 'email'); } catch { /* try the other */ }
    }
    return sent.length ? NextResponse.json({ ok: true, sentTo: `${toks.first} by ${sent.join(' and ')}` }) : NextResponse.json({ ok: false, error: 'It didn’t send — check their phone number or email.' }, { status: 502 });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
