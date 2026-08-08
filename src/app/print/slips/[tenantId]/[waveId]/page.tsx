import { headers } from 'next/headers';
import QRCode from 'qrcode';

// ─── /print/slips/[tenantId]/[waveId] ─────────────────────────────────────────
// The packing half of a rush. The wave pack prints the PICK side of a batch
// (route sheet + tote labels); this route prints the PACK side: every order's
// packing slip and tear-off customer card in ONE print job, one order per
// sheet, sorted by tote so the paper pile matches the bin line at the bench.
//
// Access model mirrors /print/wave exactly: the waveId is the capability.
// Cancelled orders are SKIPPED (their tote label already says do-not-pack on
// the wave sheet) and counted in the screen-only toolbar so nobody wonders
// why the pile is one sheet shorter than the wave.
//
// Each sheet is byte-for-byte the same document the single-slip route prints —
// same staff QR, same customer card, same house typeface — so the bench flow
// (scan the slip, pack the box, drop the card in) is identical whether a slip
// arrived alone or in a stack of forty.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-print-slips';
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

export default async function BulkSlipsPage({
  params,
}: {
  params: Promise<{ tenantId: string; waveId: string }>;
}) {
  const { tenantId, waveId } = await params;
  const db = getAdminDb();

  const [tenantSnap, waveSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection(`tenants/${tenantId}/waves`).doc(waveId).get(),
  ]);

  if (!waveSnap.exists) {
    return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>That wave no longer exists.</p>;
  }

  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  const wave = waveSnap.data() as any;
  const shopName = String(tenant.businessName || tenant.name || 'Shop');
  const retailSettings = tenant.retailSettings || {};
  const returnDays = Math.max(1, Math.floor(Number(retailSettings.returnWindowDays) || 30));
  const contactBits = [tenant.phone, tenant.email, tenant.website].filter(Boolean).map(String);

  const orderDocs = await Promise.all(
    (wave.orders || []).map((w: any) =>
      db.collection(`tenants/${tenantId}/retailOrders`).doc(w.orderId).get())
  );

  const hdrs = await headers();
  const envOrigin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  const host = hdrs.get('x-forwarded-host') || hdrs.get('host') || '';
  const proto = hdrs.get('x-forwarded-proto') || 'https';
  const origin = envOrigin || (host ? `${proto}://${host}` : '');

  const all = orderDocs.filter((d: any) => d.exists).map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const cancelledCount = all.filter((o: any) => o.stage === 'cancelled').length;
  const orders = all
    .filter((o: any) => o.stage !== 'cancelled')
    .sort((a: any, b: any) =>
      (Number(a.waveTote) || 999) - (Number(b.waveTote) || 999) ||
      (Number(a.orderNumber) || 0) - (Number(b.orderNumber) || 0));

  const jobs = await Promise.all(orders.map(async (order: any) => {
    const qrDataUrl = await QRCode.toDataURL(`clarityflow://order/${order.qrToken}`, { width: 320, margin: 1 });
    const orderUrl = origin ? `${origin}/shop/${tenantId}/order/${order.id}` : '';
    const customerQr = orderUrl ? await QRCode.toDataURL(orderUrl, { width: 360, margin: 1 }) : '';
    return { order, qrDataUrl, customerQr };
  }));

  return (
    <html>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <title>{`Packing slips · wave of ${orders.length}`}</title>
        <style>{`
          @page { size: letter; margin: 0.5in; }
          * { box-sizing: border-box; }
          body { font-family: "Plus Jakarta Sans", system-ui, sans-serif; color: #0f172a; margin: 0; }
          .bar { display: flex; gap: 10px; align-items: center; padding: 10px 0 14px; }
          .bar button { font-family: inherit; font-size: 12px; font-weight: 600; padding: 9px 14px; border-radius: 10px; border: 1px solid #16171a; background: #16171a; color: #fff; cursor: pointer; }
          .bar p { font-size: 11px; font-weight: 700; color: #64748b; margin: 0; }
          @media print { .bar { display: none; } }
          .job { page-break-after: always; }
          .job:last-child { page-break-after: auto; }
          .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f172a; padding-bottom: 14px; }
          .shop { font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: -0.5px; }
          .tag { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #64748b; margin-top: 2px; }
          .num { font-size: 26px; font-weight: 800; text-align: right; }
          .meta { display: flex; gap: 28px; padding: 14px 0; border-bottom: 1px dashed #cbd5e1; }
          .meta div p:first-child { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #94a3b8; margin: 0 0 3px; }
          .meta div p:last-child { font-size: 12px; font-weight: 800; margin: 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; text-align: left; padding: 8px 6px; border-bottom: 2px solid #0f172a; }
          td { font-size: 12px; font-weight: 700; padding: 9px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
          .box { display: inline-block; width: 14px; height: 14px; border: 2px solid #0f172a; border-radius: 4px; margin-right: 4px; vertical-align: middle; }
          .box.done { background: #0f172a; }
          .flag { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; color: #b45309; }
          .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 22px; }
          .qr { width: 150px; height: 150px; border: 3px solid #0f172a; border-radius: 16px; }
          .qr-note { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #64748b; margin-top: 6px; text-align: center; max-width: 160px; }
          .totals { text-align: right; font-size: 12px; font-weight: 800; }
          .totals .grand { font-size: 17px; font-weight: 800; margin-top: 6px; }
          .slot { display: inline-block; margin-top: 6px; padding: 4px 12px; border: 2px solid #16171a; border-radius: 8px; font-size: 18px; font-weight: 800; letter-spacing: .04em; }
          .slot.tote { margin-left: 6px; border-style: dashed; }
          .opt { color: #64748b; font-weight: 700; }
          .cut { margin: 26px 0 0; border-top: 2px dashed #94a3b8; position: relative; }
          .cut span { position: absolute; top: -7px; left: 50%; transform: translateX(-50%); background: #ffffff; padding: 0 10px; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #94a3b8; }
          .card { border: 2px solid #0f172a; border-radius: 14px; padding: 16px 18px; margin-top: 18px; display: flex; gap: 18px; align-items: flex-start; }
          .card .body { flex: 1; min-width: 0; }
          .card h2 { font-size: 15px; font-weight: 800; margin: 0 0 2px; letter-spacing: -0.3px; }
          .card .lede { font-size: 11px; font-weight: 700; color: #334155; margin: 0 0 10px; line-height: 1.5; }
          .card .why { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #94a3b8; margin: 12px 0 4px; }
          .card ul { margin: 0; padding-left: 15px; }
          .card li { font-size: 10.5px; font-weight: 700; color: #0f172a; line-height: 1.6; }
          .card .contact { font-size: 10.5px; font-weight: 800; color: #0f172a; margin: 11px 0 0; }
          .cqr { width: 128px; height: 128px; border: 2px solid #0f172a; border-radius: 12px; display: block; }
          .cqr-note { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.4px; color: #64748b; margin: 5px 0 0; text-align: center; width: 128px; line-height: 1.5; }
          .short-box { border: 2px solid #b45309; border-radius: 10px; padding: 9px 12px; margin: 10px 0 0; }
          .short-box p:first-child { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #b45309; margin: 0 0 4px; }
          .short-box p { font-size: 10.5px; font-weight: 700; color: #0f172a; margin: 0; line-height: 1.55; }
          @media print { .card, .short-box { break-inside: avoid; } tr { break-inside: avoid; } }
        `}
        </style>
      </head>
      <body>
        <div className="bar">
          <button type="button" id="printBtn">Print all {jobs.length} slip{jobs.length === 1 ? '' : 's'}</button>
          <p>
            One order per sheet, sorted by tote.
            {cancelledCount > 0 ? ` ${cancelledCount} cancelled order${cancelledCount === 1 ? '' : 's'} skipped.` : ''}
          </p>
        </div>

        {jobs.map(({ order, qrDataUrl, customerQr }) => {
          const num = `#${String(order.orderNumber).padStart(4, '0')}`;
          const missing = (order.lines || []).filter((l: any) => (Number(l.qtyShorted) || 0) > 0);
          const firstName = String(order.customerName || '').split(' ')[0];
          const methodLabel =
            order.method === 'curbside' ? 'CURBSIDE PICKUP' :
            order.method === 'ship' ? 'SHIPPING' :
            order.method === 'in_store' ? 'IN-STORE' : 'COUNTER PICKUP';

          return (
            <div className="job" key={order.id}>
              <div className="head">
                <div>
                  <p className="shop">{shopName}</p>
                  <p className="tag">Packing slip · {methodLabel}{order.priceTier === 'wholesale' ? ' · WHOLESALE' : ''}</p>
                  {order.shelfSlot && order.method !== 'ship' ? (
                    <p className="slot">Shelf {String(order.shelfSlot)}</p>
                  ) : null}
                  {order.waveTote ? <p className="slot tote">Tote {String(order.waveTote)}</p> : null}
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
                          {(l as any).optionsLabel ? <span className="opt"> — {(l as any).optionsLabel}</span> : null}
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

              <div className="cut"><span>Tear here — this half goes in the box</span></div>

              <div className="card">
                <div className="body">
                  <h2>{shopName} · Order {num}</h2>
                  <p className="lede">
                    {firstName ? `${firstName}, thank you` : 'Thank you'} — everything you need is on this
                    card, so you never have to go hunting for an email address.
                  </p>

                  {missing.length > 0 ? (
                    <div className="short-box">
                      <p>Not in this box</p>
                      {missing.map((l: any, i: number) => (
                        <p key={i}>
                          {l.qtyShorted}× {l.name}
                          {l.status === 'backordered'
                            ? ' — we came up short. It ships on its own as soon as it is back in, at no extra shipping cost.'
                            : ` — we came up short and refunded ${money((l.unitPriceCents || 0) * (l.qtyShorted || 0))} to your card (5–10 business days).`}
                        </p>
                      ))}
                      <p style={{ marginTop: 5 }}>Would you rather have it the other way? Scan the code and send us a message — we will switch it.</p>
                    </div>
                  ) : null}

                  <p className="why">Scan the code to</p>
                  <ul>
                    <li>Track this order or see what shipped</li>
                    <li>Start a return or exchange — {returnDays} days, no email needed</li>
                    <li>Message us about anything and get the answer on that same page</li>
                    <li>Leave a review once you have used it</li>
                  </ul>

                  {contactBits.length > 0 ? (
                    <p className="contact">Or reach us: {contactBits.join(' · ')}</p>
                  ) : null}
                </div>

                {customerQr ? (
                  <div>
                    <img className="cqr" src={customerQr} alt="Scan for your order" />
                    <p className="cqr-note">Point your camera here · order {num}</p>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        <script
          dangerouslySetInnerHTML={{
            __html: `document.getElementById('printBtn').addEventListener('click', function(){ window.print(); });`,
          }}
        />
      </body>
    </html>
  );
}
