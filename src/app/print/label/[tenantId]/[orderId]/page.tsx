import QRCode from 'qrcode';

// ─── /print/label/[tenantId]/[orderId]?t=<qrToken> ────────────────────────────
// 4x6 label, token-gated. For SHIP orders it's an address label (affix
// postage, or replace with a carrier-API label later — same slot). For pickup
// orders it's a bag/shelf tag. The QR is the order token, so scanning the
// label at handoff/staging verifies the right label is on the right package.

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

export default async function OrderLabelPage({
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
  const shopName = tenant.businessName || tenant.name || 'Shop';
  const a = order.shippingAddress;
  const num = `#${String(order.orderNumber).padStart(4, '0')}`;
  const units = (order.lines || []).reduce((s: number, l: any) => s + (l.qtyOrdered - (l.qtyShorted || 0)), 0);
  const qrDataUrl = await QRCode.toDataURL(`clarityflow://order/${order.qrToken}`, { width: 360, margin: 1 });

  return (
    <html>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <title>{`Label ${num}`}</title>
        <style>{`
          @page { size: 4in 6in; margin: 0.15in; }
          * { box-sizing: border-box; }
          body { font-family: "Plus Jakarta Sans", system-ui, sans-serif; color: #0f172a; margin: 0; width: 3.7in; }
          .band { border: 3px solid #0f172a; border-radius: 14px; padding: 12px; }
          .from { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
          .kind { font-size: 8px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #64748b; margin: 8px 0 2px; }
          .to { font-size: 15px; font-weight: 800; line-height: 1.35; }
          .num { font-size: 24px; font-weight: 800; margin-top: 8px; }
          .qr { width: 1.9in; height: 1.9in; display: block; margin: 10px auto 0; }
          .note { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; text-align: center; margin-top: 4px; }
        `}</style>
      </head>
      <body>
        <div className="band">
          <p className="from">From: {shopName}</p>
          {a ? (
            <div>
              <p className="kind">Ship to</p>
              <p className="to">
                {a.name}<br />{a.line1}{a.line2 ? <><br />{a.line2}</> : null}<br />{a.city}, {a.state} {a.postalCode}
              </p>
            </div>
          ) : (
            <div>
              <p className="kind">{order.method === 'curbside' ? 'Curbside pickup' : 'Counter pickup'}</p>
              <p className="to">{order.customerName}</p>
            </div>
          )}
          <p className="num">{num} · {units} item{units === 1 ? '' : 's'}</p>
          <img className="qr" src={qrDataUrl} alt="Order QR" />
          <p className="note">Scan to verify package ↔ order</p>
        </div>
        <script dangerouslySetInnerHTML={{ __html: 'setTimeout(function(){window.print()},400);' }} />
      </body>
    </html>
  );
}
