import QRCode from 'qrcode';

// ─── /print/packing-slip/[tenantId]/[orderId]?t=<qrToken> ────────────────────
// Staff print route. Token-gated: the ?t= param must match the order's
// qrToken (the board builds these links), so an orderId alone can't print a
// customer's details. The slip's QR is the same handoff token — the PAPER
// works at the counter if the customer's phone is dead. Auto-opens the print
// dialog.

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

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

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
  const shopName = tenant.businessName || tenant.name || 'Shop';

  const qrDataUrl = await QRCode.toDataURL(`clarityflow://order/${order.qrToken}`, { width: 320, margin: 1 });
  const num = `#${String(order.orderNumber).padStart(4, '0')}`;
  const methodLabel =
    order.method === 'curbside' ? 'CURBSIDE PICKUP' :
    order.method === 'ship' ? 'SHIPPING' :
    order.method === 'in_store' ? 'IN-STORE' : 'COUNTER PICKUP';

  return (
    <html>
      <head>
        <title>{`Packing slip ${num}`}</title>
        <style>{`
          @page { size: letter; margin: 0.5in; }
          * { box-sizing: border-box; }
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; }
          .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f172a; padding-bottom: 14px; }
          .shop { font-size: 20px; font-weight: 900; text-transform: uppercase; letter-spacing: -0.5px; }
          .tag { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #64748b; margin-top: 2px; }
          .num { font-size: 26px; font-weight: 900; text-align: right; }
          .meta { display: flex; gap: 28px; padding: 14px 0; border-bottom: 1px dashed #cbd5e1; }
          .meta div p:first-child { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #94a3b8; margin: 0 0 3px; }
          .meta div p:last-child { font-size: 12px; font-weight: 800; margin: 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th { font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; text-align: left; padding: 8px 6px; border-bottom: 2px solid #0f172a; }
          td { font-size: 12px; font-weight: 700; padding: 9px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
          .box { display: inline-block; width: 14px; height: 14px; border: 2px solid #0f172a; border-radius: 4px; margin-right: 4px; vertical-align: middle; }
          .box.done { background: #0f172a; }
          .flag { font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #b45309; }
          .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 22px; }
          .qr { width: 150px; height: 150px; border: 3px solid #0f172a; border-radius: 16px; }
          .qr-note { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #64748b; margin-top: 6px; text-align: center; max-width: 160px; }
          .totals { text-align: right; font-size: 12px; font-weight: 800; }
          .totals .grand { font-size: 17px; font-weight: 900; margin-top: 6px; }
          @media print { .noprint { display: none; } }
        `}</style>
      </head>
      <body>
        <div className="head">
          <div>
            <p className="shop">{shopName}</p>
            <p className="tag">Packing slip · {methodLabel}{order.priceTier === 'wholesale' ? ' · WHOLESALE' : ''}</p>
          </div>
          <p className="num">{num}</p>
        </div>

        <div className="meta">
          <div><p>Customer</p><p>{order.customerName}</p></div>
          {order.businessName ? <div><p>Business</p><p>{order.businessName}</p></div> : null}
          {order.poNumber ? <div><p>PO</p><p>{order.poNumber}</p></div> : null}
          {order.shippingAddress ? (
            <div>
              <p>Ship to</p>
              <p>
                {order.shippingAddress.name}, {order.shippingAddress.line1}
                {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}, {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}
              </p>
            </div>
          ) : null}
        </div>

        <table>
          <thead>
            <tr><th style={{ width: '6%' }}>✓</th><th>Item</th><th style={{ width: '10%' }}>Qty</th><th style={{ width: '14%', textAlign: 'right' }}>Price</th></tr>
          </thead>
          <tbody>
            {(order.lines || []).map((l: any, i: number) => {
              const qty = l.qtyOrdered - (l.qtyShorted || 0);
              const done = l.qtyScanned >= l.qtyOrdered || ['shorted', 'refunded', 'backordered'].includes(l.status);
              return (
                <tr key={i}>
                  <td><span className={`box${done ? ' done' : ''}`} /></td>
                  <td>
                    {l.name}
                    {l.sku ? <span style={{ color: '#94a3b8', fontWeight: 700 }}> · {l.sku}</span> : null}
                    {(l.qtyShorted || 0) > 0 ? (
                      <div className="flag">
                        {l.status === 'backordered' ? `${l.qtyShorted} backordered — ships separately` : `${l.qtyShorted} unavailable — refunded`}
                      </div>
                    ) : null}
                  </td>
                  <td>{qty}</td>
                  <td style={{ textAlign: 'right' }}>{money(l.unitPriceCents * qty)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="foot">
          <div>
            <img className="qr" src={qrDataUrl} alt="Order QR" />
            <p className="qr-note">Scan at handoff — works even without the customer&apos;s phone</p>
          </div>
          <div className="totals">
            <p>Subtotal {money(order.subtotalCents || 0)}</p>
            {order.taxCents > 0 ? <p>Tax {money(order.taxCents)}</p> : null}
            {order.shippingCents > 0 ? <p>Shipping {money(order.shippingCents)}</p> : null}
            {order.refundedCents > 0 ? <p style={{ color: '#b45309' }}>Refunded −{money(order.refundedCents)}</p> : null}
            <p className="grand">Total {money(order.totalCents || 0)}</p>
          </div>
        </div>

        <script dangerouslySetInnerHTML={{ __html: 'setTimeout(function(){window.print()},400);' }} />
      </body>
    </html>
  );
}
