import { SLIP_CSS, SlipSheet, printOrigin } from '@/components/print/slip';

// ─── /print/packing-slip/[tenantId]/[orderId]?t=<qrToken> ────────────────────
// Staff print route. Token-gated: the ?t= param must match the order's
// qrToken (the board builds these links), so an orderId alone can't print a
// customer's details. The slip's QR is the same handoff token — the PAPER
// works at the counter if the customer's phone is dead. Auto-opens the print
// dialog.

// ONE SHEET, TWO DOCUMENTS. Above the cut line is the staff slip that has
// always been here. Below it is a tear-off CUSTOMER CARD that goes in the box.
// The two readers need opposite things: the picker needs SKUs, totes and shelf
// slots; the customer needs a way to reach you without composing an email.
//
// The card's QR is an ordinary https link to the tracking page, NOT the
// clarityflow:// handoff token above it — a phone camera has to open it cold,
// from inside a box, with no app installed. That one code is already the front
// door to tracking, self-serve cancel, start-a-return, message-the-shop and the
// review prompt, so it retires most of the "where is my stuff / how do I return
// this / who do I email" traffic before it is ever typed.
//
// It also states, in plain English, what ISN'T in the box. A short the customer
// discovers at the door is the expensive kind; a short they read about on the
// slip while unpacking is a footnote.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-print';
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

export default async function PackingSlipPage({
  params, searchParams,
}: {
  params: Promise<{ tenantId: string; orderId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { tenantId, orderId } = await params;
  const { t } = await searchParams;

  const db = getAdminDb();
  const [orderSnap, tenantSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get(),
    db.collection('tenants').doc(tenantId).get(),
  ]);

  if (!orderSnap.exists) return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>Order not found.</p>;
  const order = orderSnap.data() as any;
  if (!t || order.qrToken !== t) {
    return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>This print link is not valid.</p>;
  }
  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};

  const num = `#${String(order.orderNumber).padStart(4, '0')}`;
  const origin = await printOrigin();

  return (
    <html>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <title>{`Packing slip ${num}`}</title>
        <style>{SLIP_CSS}</style>
      </head>
      <body>
        <SlipSheet tenantId={tenantId} orderId={orderId} order={order} tenant={tenant} origin={origin} />
        <script dangerouslySetInnerHTML={{ __html: 'setTimeout(function(){window.print()},400);' }} />
      </body>
    </html>
  );
}
