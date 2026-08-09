import { NextRequest, NextResponse } from 'next/server';
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

const TYPE_LABELS: Record<string, string> = {
  missing: 'missing item', damaged: 'damaged item', wrong_item: 'wrong item', not_received: 'order that never arrived',
};

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const tenantId = String(body.tenantId || '').trim();
  const claimId = String(body.claimId || '').trim();
  if (!tenantId || !claimId) return NextResponse.json({ error: 'Missing details' }, { status: 400 });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.RESEND_FROM;
  if (!RESEND_API_KEY || !RESEND_FROM) return NextResponse.json({ ok: true, sent: false, why: 'email not configured' });

  const db = getAdminDb();
  const claimRef = db.collection(`tenants/${tenantId}/retailClaims`).doc(claimId);

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
      if (!String(c.customerEmail || '').trim()) return null;
      txn.update(claimRef, { notifiedForDecidedAt: c.decidedAt });
      return c;
    });
    if (!decision) return NextResponse.json({ ok: true, sent: false });

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
      ? `<p style="font-size:14px;color:#334155;line-height:1.6">Good news — your report about the ${what} (<strong>${item}</strong>) was approved. A refund of <strong>$${(cents / 100).toFixed(2)}</strong> has been queued and will land back on your card once processed (typically 5–10 business days).</p>`
      : `<p style="font-size:14px;color:#334155;line-height:1.6">We looked into your report about the ${what} (<strong>${item}</strong>) together with the packing record for your order, and we weren't able to approve it this time.</p>
         ${decision.declineReason ? `<p style="font-size:13px;color:#334155;line-height:1.6;border-left:3px solid #e2e8f0;padding-left:12px;margin:14px 0">${String(decision.declineReason)}</p>` : ''}
         <p style="font-size:14px;color:#334155;line-height:1.6">If we've got this wrong, you can appeal once from your order page — add anything we should know and a person will look at it again.</p>`;

    const html = brandedEmail(emailBrand, `
      <p style="font-size:14px;color:#0f172a;font-weight:700;margin:0 0 8px">Hi ${firstName},</p>
      ${bodyHtml}
      ${orderLink ? emailButton(orderLink, approved ? 'View my order' : 'View or appeal', emailBrand) : ''}
      <p style="font-size:12px;color:#94a3b8;line-height:1.6">Order #${String(decision.orderNumber ?? '').padStart(4, '0')} at ${shopName}.</p>`,
      { preheader: approved ? 'Your report was approved' : 'An update on your report' });

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [String(decision.customerEmail).trim()],
        subject: approved
          ? `Your report was approved — refund on the way from ${shopName}`
          : `About your report to ${shopName}`,
        html,
      }),
    });
    return NextResponse.json({ ok: true, sent: true });
  } catch (e: any) {
    return NextResponse.json({ ok: true, sent: false, why: String(e?.message || '').slice(0, 120) });
  }
}
