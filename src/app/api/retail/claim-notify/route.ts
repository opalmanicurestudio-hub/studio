import { NextRequest, NextResponse } from 'next/server';
import { staffOrServer } from '@/lib/route-guard';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';

// ─── /api/retail/claim-notify/route.ts ────────────────────────────────────────
// Emails the customer about a DECIDED claim. The desk calls this after a
// decision commits; the route trusts NOTHING in the request beyond the two
// ids — it reads the claim doc and emails only what the record says, to the
// address on the record. Idempotent by construction: one email per decision
// (notifiedForDecidedAt stamps the exact decision it announced), so a retry,
// a double tap, or a curious third party re-posting the same ids can at
// worst cause zero additional emails. An appeal clears decidedAt, so the
// NEXT decision earns its own email.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-claimnotify';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

/** A customer with no email on the report is told by text: the full message goes on their order page
 *  (lib/order-inbox) and the text points them there. ok = someone was told; failed = the service didn't take it. */
async function textInstead(db: any, tenantId: string, c: any, kind: string, line: string): Promise<{ ok: boolean; failed: boolean }> {
  let phone = String(c?.customerPhone || '').trim();
  const orderId = String(c?.orderId || '');
  if (!phone && orderId && !orderId.includes('/')) { try { phone = String(((await db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get()).data() as any)?.customerPhone || '').trim(); } catch { /* none */ } }
  if (!phone) return { ok: false, failed: false };
  const t: any = (await db.doc(`tenants/${tenantId}`).get().catch(() => null))?.data?.() || {};
  const shop = String(t.businessName || t.name || 'The shop');
  const base = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  const link = base && orderId ? ` ${base}/shop/${tenantId}/order/${orderId}` : '';
  const { sendNotification } = await import('@/lib/notify');
  const r: any = await sendNotification(db, { tenantId, channel: 'sms', to: phone, text: `${shop}: ${line}${link}`, kind, recipientType: 'client', recipientId: orderId || null, orderId: orderId || null } as any);
  return { ok: r.ok === true && !/nobody to nudge/.test(String(r.error || '')), failed: r.status === 'failed' };
}

const TYPE_LABELS: Record<string, string> = {
  missing: 'missing item', damaged: 'damaged item', wrong_item: 'wrong item', not_received: 'order that never arrived',
};

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const tenantId = String(body.tenantId || '').trim();
  if (!(await staffOrServer(req, String(tenantId || '')))) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });   // staff, or our own server — never the public
  const claimId = String(body.claimId || '').trim();
  if (!tenantId || !claimId) return NextResponse.json({ error: 'Missing details' }, { status: 400 });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
  const emailReady = !!RESEND_API_KEY && !!RESEND_FROM;

  const db = getAdminDb();

  /* Policy gate. Claim decisions are a MANDATORY kind — they can never be
   * switched off — so this is here to pick up the shop's own wording, not to
   * suppress. Fails open either way. */
  try {
    const { gateMessage } = await import('@/lib/message-policy');
    const g = await gateMessage(db, tenantId, 'claim_decision');
    if (!g.send) return NextResponse.json({ ok: true, sent: false, why: g.reason });
  } catch { /* fail open */ }
  const claimRef = db.collection(`tenants/${tenantId}/retailClaims`).doc(claimId);

  // ── Evidence request ping: same claim-then-send idempotency, keyed on the
  // REQUEST timestamp instead of the decision's, so each new ask earns
  // exactly one email and retries send nothing.
  if (String(body.kind || '') === 'info_request') {
    let reqData: any = null;
    const giveBack = async () => { if (reqData) await db.runTransaction(async (txn: any) => { const s = await txn.get(claimRef); if (s.exists && (s.data() as any)?.notifiedForInfoRequestAt === reqData.infoRequestAt) txn.update(claimRef, { notifiedForInfoRequestAt: null }); }).catch(() => {}); };
    try {
      reqData = await db.runTransaction(async (txn: any) => {
        const snap = await txn.get(claimRef);
        if (!snap.exists) return null;
        const c = snap.data() as any;
        if (!c.infoRequestText || !c.infoRequestAt) return null;
        if (c.notifiedForInfoRequestAt === c.infoRequestAt) return null;
        txn.update(claimRef, { notifiedForInfoRequestAt: c.infoRequestAt });
        return c;
      });
      if (!reqData) return NextResponse.json({ ok: true, sent: false });
      // No email to write to (or no email service): a text pointing to the order page, where the question is posted.
      if (!String(reqData.customerEmail || '').trim() || !emailReady) {
        const tx = await textInstead(db, tenantId, reqData, 'claim_info_request', `we need a little more about your report on ${String(reqData.lineName || 'your order')}. Please reply on your order page:`);
        if (!tx.ok && tx.failed) { await giveBack(); return NextResponse.json({ ok: false, sent: false, retry: true, why: 'The text service didn’t take it.' }, { status: 503 }); }
        return NextResponse.json({ ok: true, sent: tx.ok, why: tx.ok ? undefined : 'no email or mobile to tell them' });
      }

      const emailBrand = await getEmailBrand(db, tenantId);
      const firstName = String(reqData.customerName || '').trim().split(/\s+/)[0] || 'there';
      const item = String(reqData.lineName || 'your order');
      const origin = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
      const orderLink = origin && reqData.orderId ? `${origin}/shop/${tenantId}/order/${reqData.orderId}` : '';
      const html = brandedEmail(emailBrand, `
        <p style="font-size:14px;color:#0f172a;font-weight:700;margin:0 0 8px">Hi ${firstName},</p>
        <p style="font-size:14px;color:#334155;line-height:1.6">Thank you for your report about <strong>${item}</strong>. To help us complete our review, could you please provide the following information?</p>
        <p style="font-size:13px;color:#334155;line-height:1.6;border-left:3px solid #e2e8f0;padding-left:12px;margin:14px 0">${String(reqData.infoRequestText).replace(/</g, '&lt;')}</p>
        <p style="font-size:14px;color:#334155;line-height:1.6">You can reply and add photos on your order page. We will continue our review as soon as we receive your response.</p>
        ${orderLink ? emailButton(orderLink, 'Reply on my order page', emailBrand) : ''}
        <p style="font-size:14px;color:#334155;line-height:1.6;margin:16px 0 0">Kind regards,<br>${emailBrand.shopName}</p>`,
        { preheader: 'We need a little more information to review your report' });
      const { sendNotification } = await import('@/lib/notify');
      const r = await sendNotification(db, {
        tenantId, channel: 'email', to: String(reqData.customerEmail).trim(),
        subject: `${emailBrand.shopName}: more information needed for your report`, html,
        kind: 'claim_info_request', recipientType: 'client',
        recipientId: reqData.orderId || null, recipientName: reqData.customerName || null,
      });
      // The email service didn't take it: the mark is given back (only our own) and the queue that sent it tries later.
      if (!r.ok && r.status === 'failed') { await giveBack(); return NextResponse.json({ ok: false, sent: false, retry: true, why: String(r.error || 'not sent').slice(0, 160) }, { status: 503 }); }
      return NextResponse.json({ ok: true, sent: r.ok });
    } catch (err: any) {
      console.error('[claim-notify] info request ping failed:', err?.message);
      await giveBack();
      return NextResponse.json({ ok: false, sent: false, retry: true, why: String(err?.message || 'failed').slice(0, 120) }, { status: 503 });
    }
  }

  let release: (() => Promise<void>) | null = null;
  try {
    // Claim the send INSIDE a transaction, then email after commit — the
    // same order-of-operations every notification here uses: a crash after
    // commit loses one email, never sends two.
    const decision = await db.runTransaction(async (txn: any) => {
      const snap = await txn.get(claimRef);
      if (!snap.exists) return null;
      const c = snap.data() as any;
      if (!c.decidedAt) return null;
      if (!['resolved', 'declined'].includes(c.status)) return null;
      if (c.notifiedForDecidedAt === c.decidedAt) return null;
      txn.update(claimRef, { notifiedForDecidedAt: c.decidedAt });
      return c;
    });
    if (!decision) return NextResponse.json({ ok: true, sent: false });
    // A send the email service didn't take gives the claim back (only our own) and answers retry: true, so the queue
    // that sent it (lib/order-outbox) tries later.
    release = async () => { await db.runTransaction(async (txn: any) => { const s = await txn.get(claimRef); if (s.exists && (s.data() as any)?.notifiedForDecidedAt === decision.decidedAt) txn.update(claimRef, { notifiedForDecidedAt: null }); }).catch(() => {}); };
    // No email to write to (or no email service): a text pointing to the order page, where the decision shows.
    if (!String(decision.customerEmail || '').trim() || !emailReady) {
      const ok = decision.status === 'resolved';
      const tx = await textInstead(db, tenantId, decision, ok ? 'claim_approved' : 'claim_decision', ok ? (Number(decision.resolutionCents) > 0 ? 'your report was approved and a refund is on its way. Details on your order page:' : 'your report was approved. Details on your order page:') : 'we’ve reviewed your report. See our answer on your order page:');
      if (!tx.ok && tx.failed) { await release(); return NextResponse.json({ ok: false, sent: false, retry: true, why: 'The text service didn’t take it.' }, { status: 503 }); }
      return NextResponse.json({ ok: true, sent: tx.ok, why: tx.ok ? undefined : 'no email or mobile to tell them' });
    }

    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
    const shopName = String(tenant.businessName || tenant.name || 'the shop');
    const emailBrand = await getEmailBrand(db, tenantId);

    const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
    const orderLink = origin ? `${origin}/shop/${tenantId}/order/${decision.orderId}` : '';
    const firstName = String(decision.customerName || '').trim().split(/\s+/)[0] || 'there';
    const what = TYPE_LABELS[decision.type] || 'report';
    const item = decision.lineName ? `${decision.lineName}${(decision.qty || 1) > 1 ? ` \u00d7 ${decision.qty}` : ''}` : 'your order';
    const approved = decision.status === 'resolved';
    const cents = Math.max(0, Number(decision.resolutionCents) || 0);

    const bodyHtml = approved
      ? `<p style="font-size:14px;color:#334155;line-height:1.6">We are sorry for the trouble with your order, and thank you for your patience. Your report about the ${what} (<strong>${item}</strong>) has been approved${cents > 0 ? `, and a refund of <strong>$${(cents / 100).toFixed(2)}</strong> is approved with it. We will email you as soon as it is sent. Card refunds typically appear within 5 to 10 business days after that.` : '.'}</p>`
      : `<p style="font-size:14px;color:#334155;line-height:1.6">Thank you for your report about the ${what} (<strong>${item}</strong>). We have carefully reviewed it alongside the packing record for your order, and we are sorry, but we are unable to approve it at this time.</p>
         ${decision.declineReason ? `<p style="font-size:13px;color:#334155;line-height:1.6;border-left:3px solid #e2e8f0;padding-left:12px;margin:14px 0">${String(decision.declineReason).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
         ${decision.appealedAt
    ? '<p style="font-size:14px;color:#334155;line-height:1.6">This was our second look at your report, after your appeal, so this decision is final.</p>'
    : '<p style="font-size:14px;color:#334155;line-height:1.6">If you believe we have made an error, you may submit one appeal from your order page. Please include any additional details, and a member of our team will review it again.</p>'}`;

    const html = brandedEmail(emailBrand, `
      <p style="font-size:14px;color:#0f172a;font-weight:700;margin:0 0 8px">Hi ${firstName},</p>
      ${bodyHtml}
      ${orderLink ? emailButton(orderLink, approved || decision.appealedAt ? 'View my order' : 'View or appeal', emailBrand) : ''}
      <p style="font-size:14px;color:#334155;line-height:1.6;margin:16px 0 0">Kind regards,<br>${emailBrand.shopName}</p>
      <p style="font-size:12px;color:#94a3b8;line-height:1.6">Order #${String(decision.orderNumber ?? '').padStart(4, '0')} at ${shopName}.</p>`,
      { preheader: approved ? 'Your report has been approved' : 'An update on your report' });

    const { sendNotification } = await import('@/lib/notify');
    const r = await sendNotification(db, {
      tenantId, channel: 'email', to: String(decision.customerEmail).trim(),
      subject: approved
        ? `${shopName}: your report has been approved`
        : `${shopName}: an update on your report`,
      html,
      // The shop's own Claim decision wording (Client messages) is put in by the email sender with these details.
      tokens: { client_first: firstName, order_number: String(decision.orderNumber ?? '').padStart(4, '0'), reason: approved ? '' : String(decision.declineReason || ''), link: orderLink, studio: shopName },
      kind: approved ? 'claim_approved' : 'claim_decision', recipientType: 'client',
      recipientId: decision.orderId || null, recipientName: decision.customerName || null,
    });
    if (!r.ok && r.status === 'failed') { await release(); return NextResponse.json({ ok: false, sent: false, retry: true, why: String(r.error || 'not sent').slice(0, 160) }, { status: 503 }); }
    return NextResponse.json({ ok: true, sent: r.ok });
  } catch (e: any) {
    if (release) await release();
    return NextResponse.json({ ok: false, sent: false, retry: true, why: String(e?.message || '').slice(0, 120) }, { status: 503 });
  }
}
