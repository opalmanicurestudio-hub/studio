import QRCode from 'qrcode';
import { PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';
import { methodWords } from '@/lib/order-method';

// ─── /print/label/[tenantId]/[orderId]?t=<qrToken> ────────────────────────────
// 4x6 label, token-gated. For SHIP orders it's an address label (affix
// postage, or replace with a carrier-API label later — same slot). For pickup
// orders it's a bag/shelf tag. The QR is the order token, so scanning the
// label at handoff/staging verifies the right label is on the right package.
// A label printer prints solid black only, so everything stays black ink, in
// the app's lighter type with thin rules.

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
        <link href={PRINT_FONT_HREF} rel="stylesheet" />
        <title>{`Label ${num}`}</title>
        <style>{`
          @page { size: 4in 6in; margin: 0.15in; }
          * { box-sizing: border-box; }
          body { font-family: ${PRINT_FONT_STACK}; font-weight: 400; color: #000; margin: 0; width: 3.7in; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          p { margin: 0; }
          .band { border: 1.5px solid #000; border-radius: 14px; padding: 14px 16px 12px; }
          .from { font-size: 11px; line-height: 1.4; border-bottom: 1px solid #000; padding-bottom: 9px; }
          .from b { font-weight: 600; }
          .kind { font-size: 11px; font-weight: 500; margin: 12px 0 3px; }
          .to { font-size: 16px; line-height: 1.4; }
          .to b { font-weight: 600; }
          .who { font-size: 24px; letter-spacing: -0.01em; line-height: 1.2; }
          .num { font-size: 26px; font-weight: 300; letter-spacing: -0.02em; line-height: 1.15; margin-top: 12px; font-variant-numeric: tabular-nums; }
          .num b { font-weight: 600; }
          .qr { width: 1.9in; height: 1.9in; display: block; margin: 12px auto 0; }
          .note { font-size: 10.5px; text-align: center; margin-top: 6px; }
        `}</style>
      </head>
      <body>
        <div className="band">
          <p className="from">From <b>{shopName}</b></p>
          {a ? (
            <div>
              <p className="kind">{order.method === 'delivery' ? 'Deliver to' : 'Ship to'}</p>
              <p className="to">
                <b>{a.name}</b><br />{a.line1}{a.line2 ? <><br />{a.line2}</> : null}<br />{a.city}, {a.state} {a.postalCode}
              </p>
            </div>
          ) : (
            <div>
              <p className="kind">{methodWords(order.method, tenant.retailSettings || {}).long}</p>
              <p className="who">{order.customerName}</p>
            </div>
          )}
          <p className="num"><b>{num}</b> · {units} item{units === 1 ? '' : 's'}</p>
          <img className="qr" src={qrDataUrl} alt="Order QR" />
          <p className="note">Scan to check this package matches its order</p>
        </div>
        <script dangerouslySetInnerHTML={{ __html: 'setTimeout(function(){window.print()},400);' }} />
      </body>
    </html>
  );
}
