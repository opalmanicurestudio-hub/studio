import { NextRequest, NextResponse, after } from 'next/server';

import { limitPublic } from '@/lib/rate-limit';
import { brandedEmail, emailButton, getEmailBrand } from '@/lib/email-shell';

import { accountUrl, normalizeEmail } from '@/lib/retail-account';
import { licenseFor } from '@/lib/pro-license';

// ─── POST /api/retail/account/request ─────────────────────────────────────────
// { tenantId, email } → emails a magic sign-in link via Resend.
//
// Anti-abuse, designed in from the start:
//  - UNIFORM RESPONSE: the reply never reveals whether an email has orders,
//    so the endpoint can't be used to probe who shops here.
//  - RATE LIMITED: max 3 sends per email per hour (counter doc per hash).
//  - The link is only actually sent when the email has at least one order.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-account';
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

const UNIFORM = { ok: true, message: 'If that email address has orders, a wholesale account or a license with us, a sign-in link is on its way.' };
const esc = (x: any) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  { const limited = await limitPublic(req, 'account-request', String(tenantId || ''), { perHour: 5, perDay: 100 }); if (limited) return limited; }
  const email = normalizeEmail(body.email);
  if (!tenantId || !email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const db = getAdminDb();

  // Rate limit: 3 per rolling hour per (tenant, email)
  const hash = Buffer.from(email).toString('base64url').slice(0, 60);
  const rlRef = db.collection(`tenants/${tenantId}/accountLinkRequests`).doc(hash);
  const rlSnap = await rlRef.get();
  const now = Date.now();
  const rl = rlSnap.exists ? (rlSnap.data() as any) : { count: 0, windowStart: now };
  const inWindow = now - (rl.windowStart || 0) < 3_600_000;
  if (inWindow && (rl.count || 0) >= 3) return NextResponse.json(UNIFORM);
  await rlRef.set(inWindow ? { count: (rl.count || 0) + 1, windowStart: rl.windowStart } : { count: 1, windowStart: now });

  // Only send when the email actually has orders, or is one of a wholesale buyer's (their own, or one the shop added
  // for their staff, who need this link to buy tax free before they've ordered), or has an approved license on file
  // (lib/pro-license: products for licensed pros are bought signed in). The response stays uniform either way.
  const [a, b, w1, w2, lic] = await Promise.all([
    db.collection(`tenants/${tenantId}/retailOrders`).where('customerEmail', '==', email).limit(1).get(),
    db.collection(`tenants/${tenantId}/retailOrders`).where('customerEmail', '==', String(body.email || '').trim()).limit(1).get(),
    db.collection(`tenants/${tenantId}/wholesaleAccounts`).where('email', '==', email).limit(5).get(),
    db.collection(`tenants/${tenantId}/wholesaleAccounts`).where('taxEmails', 'array-contains', email).limit(5).get(),
    licenseFor(db, tenantId, email).catch(() => null),
  ]);
  const buyer = [...w1.docs, ...w2.docs].map((d: any) => d.data() || {}).find((x: any) => x.status === 'active');
  // (An approved one only: anyone can send a license with any email, and that alone mustn't send mail to it.)
  const licensed = !!lic && (lic as any).status === 'approved';
  if (a.empty && b.empty && !buyer && !licensed) return NextResponse.json(UNIFORM);

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
  if (!RESEND_API_KEY || !RESEND_FROM) return NextResponse.json(UNIFORM); // no transport — exchange path still works

  const origin = req.nextUrl.origin;
  const link = accountUrl(origin, tenantId, email);
  // The greeting's name was typed by whoever placed an order or applied: escaped before it goes in the email.
  const hiName = esc(String(((a.docs[0] || b.docs[0])?.data() as any)?.customerName || (buyer && buyer.email === email ? buyer.contactName : '') || '').trim().split(/\s+/)[0] || 'there');

  // Sent after the answer, so how long the answer takes says nothing about whether this email is known here.
  after(async () => { try {
    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    const shopName = tenantSnap.exists ? ((tenantSnap.data() as any).businessName || (tenantSnap.data() as any).name || 'the shop') : 'the shop';
    const { sendNotification } = await import('@/lib/notify');
    await sendNotification(db, {
      tenantId, channel: 'email',
        to: email,
        subject: `Your orders at ${shopName}`,
        html: await (async () => {
          const emailBrand = await getEmailBrand(db, tenantId);
          return brandedEmail(emailBrand, `
            <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:0 0 10px">Hi ${hiName},</p>
            <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:0">Here is your secure sign-in link. You will find your orders, messages, store credit, and downloads all in one place.</p>
            ${emailButton(link, 'View my orders', emailBrand)}
            <p style="color:#64748b;font-size:12px;line-height:1.6;margin:0">Or paste this link into your browser:<br><span style="color:#0f172a;word-break:break-all">${link}</span></p>
            <p style="color:#94a3b8;font-size:11px;margin:16px 0 0">This link is valid for 30 days. If you did not request it, you can safely ignore this email.</p>
            <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:16px 0 0">Kind regards,<br>${emailBrand.shopName}</p>`,
            { preheader: 'Your secure sign-in link is valid for 30 days.', title: 'Your account link' });
        })(),
      kind: 'account_signin_link', recipientType: 'client',
    });
  } catch {
    // swallow — response stays uniform
  } });

  return NextResponse.json(UNIFORM);
}
