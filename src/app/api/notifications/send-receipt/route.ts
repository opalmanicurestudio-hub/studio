import { NextRequest, NextResponse } from 'next/server';

import { brandedEmail, getEmailBrand, type EmailBrand } from '@/lib/email-shell';

// ─── /api/notifications/send-receipt/route.ts ─────────────────────────────────
// Sends a cash/card receipt by email (Resend) or SMS (Twilio).
// Falls back gracefully if neither is configured.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
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

type LineItem = { label: string; amount: number; staff?: string };

type ReceiptPayload = {
  clientName:    string;
  cashierName?:  string;
  studioName:    string;
  studioPhone:   string;
  lineItems:     LineItem[];
  subtotal:      number;
  tax:           number;
  tip:           number;
  discount:      number;
  recovery:      number;
  total:         number;
  tendered:      number;
  change:        number;
  paymentMethod: string;
  date:          string;
};

function buildEmailHtml(r: ReceiptPayload, brand: EmailBrand): string {
  const lineItemsHtml = r.lineItems
    .map(l => `<tr>
      <td style="padding:6px 0; color:#374151;">${l.label}${l.staff ? ` <span style="color:#9ca3af; font-size:12px;">· ${l.staff}</span>` : ''}</td>
      <td style="padding:6px 0; text-align:right; font-family:monospace; color:#111827;">$${l.amount.toFixed(2)}</td>
    </tr>`)
    .join('');

  /* SAME CLOTHES AS THE RETAIL MAIL. The receipt used a hardcoded violet
   * header no matter what color the shop actually is; it now rides the
   * shared shell, so a client who buys online and in person gets one
   * consistent-looking business. */
  return brandedEmail(brand, `
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${lineItemsHtml}
      </table>

      <div style="border-top:1px dashed #e5e7eb;margin:16px 0;padding-top:12px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:3px 0;color:#6b7280;">Subtotal</td><td style="text-align:right;color:#6b7280;font-family:monospace;">$${r.subtotal.toFixed(2)}</td></tr>
          ${r.discount > 0 ? `<tr><td style="padding:3px 0;color:#7c3aed;">Discount</td><td style="text-align:right;color:#7c3aed;font-family:monospace;">-$${r.discount.toFixed(2)}</td></tr>` : ''}
          ${r.recovery > 0 ? `<tr><td style="padding:3px 0;color:#d97706;">Service adjustment</td><td style="text-align:right;color:#d97706;font-family:monospace;">-$${r.recovery.toFixed(2)}</td></tr>` : ''}
          <tr><td style="padding:3px 0;color:#6b7280;">Tax (7%)</td><td style="text-align:right;color:#6b7280;font-family:monospace;">$${r.tax.toFixed(2)}</td></tr>
          ${r.tip > 0 ? `<tr><td style="padding:3px 0;color:#6b7280;">Gratuity</td><td style="text-align:right;color:#6b7280;font-family:monospace;">$${r.tip.toFixed(2)}</td></tr>` : ''}
          <tr style="border-top:1px solid #111827;">
            <td style="padding:10px 0 3px;font-weight:700;font-size:15px;color:#111827;">Total</td>
            <td style="text-align:right;font-weight:700;font-size:15px;color:#111827;font-family:monospace;padding:10px 0 3px;">$${r.total.toFixed(2)}</td>
          </tr>
          <tr><td style="padding:3px 0;color:#6b7280;">${r.paymentMethod} tendered</td><td style="text-align:right;color:#6b7280;font-family:monospace;">$${r.tendered.toFixed(2)}</td></tr>
          ${r.change > 0.005 ? `<tr><td style="padding:3px 0;color:#166534;font-weight:600;">Change returned</td><td style="text-align:right;color:#166534;font-weight:600;font-family:monospace;">$${r.change.toFixed(2)}</td></tr>` : ''}
        </table>
      </div>
      <div style="border-top:1px solid #f3f4f6;margin-top:16px;padding-top:14px;text-align:center;">
        ${r.cashierName ? `<p style="color:#9ca3af;font-size:12px;margin:0 0 4px;">Served by ${r.cashierName}</p>` : ''}
        <p style="color:#6b7280;font-size:12px;margin:0 0 4px;">Questions? We&#39;re happy to help.</p>
        ${r.studioPhone ? `<p style="color:#0f172a;font-size:13px;font-weight:600;margin:0;">${r.studioPhone}</p>` : ''}
      </div>`,
    { preheader: `Your receipt \u2014 $${r.total.toFixed(2)} on ${r.date}`, title: `Thank you, ${r.clientName.split(' ')[0]}!`, tag: r.date });
}

function buildSmsText(r: ReceiptPayload): string {
  const items = r.lineItems.map(l => `  ${l.label}: $${l.amount.toFixed(2)}`).join('\n');
  const lines = [
    `${r.studioName} — Receipt`,
    `${r.date}`,
    ``,
    items,
    ``,
    `Subtotal: $${r.subtotal.toFixed(2)}`,
    r.discount > 0   ? `Discount: -$${r.discount.toFixed(2)}`   : null,
    r.recovery > 0   ? `Adjustment: -$${r.recovery.toFixed(2)}` : null,
    `Tax: $${r.tax.toFixed(2)}`,
    r.tip > 0        ? `Tip: $${r.tip.toFixed(2)}`              : null,
    `Total: $${r.total.toFixed(2)}`,
    r.change > 0.005 ? `Change: $${r.change.toFixed(2)}`        : null,
    ``,
    `Thank you, ${r.clientName.split(' ')[0]}!`,
    r.cashierName ? `Served by ${r.cashierName}` : null,
    r.studioPhone ? r.studioPhone : null,
  ].filter(Boolean).join('\n');
  return lines;
}

export async function POST(req: NextRequest) {
  try {
    const { contact, type, receipt, tenantId } = await req.json() as {
      contact: string;
      type:    'email' | 'sms';
      receipt: ReceiptPayload;
      tenantId?: string;
    };

    if (!contact || !receipt) {
      return NextResponse.json({ error: 'Missing contact or receipt data' }, { status: 400 });
    }

    if (type === 'email') {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) {
        return NextResponse.json({ ok: false, reason: 'Email not configured (RESEND_API_KEY missing)' });
      }
      const res = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          from:    `${receipt.studioName} <receipts@${process.env.RESEND_FROM_DOMAIN || 'clarityflow.app'}>`,
          to:      [contact],
          subject: `Your receipt from ${receipt.studioName}`,
          html:    buildEmailHtml(receipt, tenantId
            ? await getEmailBrand(getAdminDb(), tenantId)
            : { shopName: receipt.studioName, brandColor: '#16171a' }),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        console.error('[send-receipt] Resend error:', data);
        return NextResponse.json({ ok: false, reason: data?.message || 'Email send failed' });
      }
      return NextResponse.json({ ok: true, emailSent: true });
    }

    if (type === 'sms') {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken  = process.env.TWILIO_AUTH_TOKEN;
      const fromPhone  = process.env.TWILIO_PHONE_NUMBER;
      if (!accountSid || !authToken || !fromPhone) {
        return NextResponse.json({ ok: false, reason: 'SMS not configured (Twilio credentials missing)' });
      }
      const body = buildSmsText(receipt);
      const res  = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method:  'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
            'Content-Type':  'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ From: fromPhone, To: contact, Body: body }).toString(),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        console.error('[send-receipt] Twilio error:', data);
        return NextResponse.json({ ok: false, reason: data?.message || 'SMS send failed' });
      }
      return NextResponse.json({ ok: true, smsSent: true });
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });

  } catch (err: any) {
    console.error('[send-receipt]', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
