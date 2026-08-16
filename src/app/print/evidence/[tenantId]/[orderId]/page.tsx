/**
 * /print/evidence/[tenantId]/[orderId] — the order-integrity record as a
 * DOCUMENT.
 *
 * The evidence screen's old Print button ran window.print() on the live app
 * page — which on iOS Safari frequently produces a blank sheet or nothing at
 * all, because the app shell (fixed sidebars, dvh layouts, portals) doesn't
 * survive the print engine. Every print surface that actually works in this
 * app is a dedicated server-rendered route with @page rules (/print/wave,
 * /print/slips, /print/packing-slip); this brings evidence in line.
 *
 * Server component on the Admin SDK: the same append-only record the screen
 * shows — identity, line-by-line scan verification, the full chronological
 * timeline, pack photos — laid out for paper, because the audience for THIS
 * document is a card network dispute or an insurance claim, not a colleague.
 */

const EVENT_LABELS: Record<string, string> = {
  placed: 'Order placed',
  payment_confirmed: 'Payment confirmed',
  stock_reserved: 'Stock reserved',
  batch_claimed: 'Claimed for fulfilment',
  batch_released: 'Released back to queue',
  batch_auto_released: 'Claim timed out — released',
  item_scanned: 'Item scanned',
  scan_mismatch: 'Scan mismatch',
  line_shorted: 'Line shorted',
  line_reopened: 'Line reopened',
  pick_complete: 'Pick complete',
  packed: 'Packed',
  packing_slip_printed: 'Packing slip printed',
  label_generated: 'Shipping label generated',
  label_scan_verified: 'Label verified onto box',
  marked_ready: 'Marked ready',
  customer_arrived: 'Customer arrived',
  handoff_scanned: 'Handoff verified by scan',
  shipped: 'Handed to carrier',
  completed: 'Completed',
  cancel_requested: 'Cancellation requested',
  restock_scanned: 'Item restocked by scan',
  cancelled: 'Cancelled',
  refund_issued: 'Refund issued',
  return_opened: 'Return opened',
  return_resolved: 'Return resolved',
  replacement_created: 'Replacement created',
  backorder_split: 'Backorder split off',
  override: 'Manager override',
  address_updated: 'Shipping address corrected',
  note: 'Note',
};

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-print';
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

const when = (iso: any) => {
  const d = new Date(String(iso || ''));
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
};
const money = (c: any) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

const metaLine = (e: any): string => {
  const m = e.meta || {};
  switch (e.type) {
    case 'item_scanned': return [m.sku, m.qtyScanned != null ? `${m.qtyScanned}/${m.qtyOrdered ?? '?'}` : ''].filter(Boolean).join(' · ');
    case 'scan_mismatch': return m.scannedValue ? `Scanned: ${m.scannedValue}` : '';
    case 'line_shorted': case 'line_reopened': return [m.reason, m.qtyShorted != null ? `${m.qtyShorted} short` : ''].filter(Boolean).join(' · ');
    case 'label_generated': return [m.carrier, m.trackingNumber].filter(Boolean).join(' · ');
    case 'customer_arrived': return m.spotOrVehicle ? String(m.spotOrVehicle) : '';
    case 'refund_issued': return m.amountCents != null ? `${money(m.amountCents)} · ${m.scope || ''}` : '';
    case 'override': return [m.rule, m.reason].filter(Boolean).join(' — ');
    case 'address_updated': {
      const to = m.to || {};
      return to.city ? `Now: ${to.line1 || ''}, ${to.city}, ${to.state || ''}` : '';
    }
    case 'note': return m.text ? String(m.text) : '';
    default: return '';
  }
};

export default async function PrintEvidencePage({
  params,
}: {
  params: Promise<{ tenantId: string; orderId: string }>;
}) {
  const { tenantId, orderId } = await params;
  const db = getAdminDb();

  const [tenantSnap, orderSnap, eventsSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get(),
    db.collection(`tenants/${tenantId}/retailOrders/${orderId}/events`).orderBy('at', 'asc').limit(300).get(),
  ]);

  if (!orderSnap.exists) {
    return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>That order no longer exists.</p>;
  }

  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  const order = orderSnap.data() as any;
  const events = eventsSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const shopName = String(tenant.businessName || tenant.name || 'Shop');
  const num = `#${String(order.orderNumber ?? '').padStart(4, '0')}`;
  const photos: string[] = Array.isArray(order.packPhotoUrls) ? order.packPhotoUrls : [];
  const lines: any[] = Array.isArray(order.lines) ? order.lines : [];
  const generatedAt = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${shopName} — Order record ${num}`}</title>
        <style>{`
          @page { size: letter portrait; margin: 0.55in; }
          * { box-sizing: border-box; }
          body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; font-size: 12px; line-height: 1.45; }
          h1 { font-size: 19px; margin: 0; letter-spacing: -0.01em; }
          h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: #64748b; margin: 22px 0 6px; }
          table { width: 100%; border-collapse: collapse; }
          th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; padding: 4px 6px; border-bottom: 2px solid #0f172a; }
          td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
          .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f172a; padding-bottom: 10px; }
          .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 18px; }
          .k { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; }
          .v { font-weight: 700; }
          .num { font-variant-numeric: tabular-nums; text-align: right; }
          .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
          .photos img { width: 100%; height: 2.2in; object-fit: cover; border: 1px solid #cbd5e1; border-radius: 4px; }
          .foot { margin-top: 26px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; }
          .flag { display: inline-block; padding: 1px 7px; border: 1.5px solid #0f172a; border-radius: 999px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
          tr, .photos img { break-inside: avoid; }
        `}</style>
      </head>
      <body>
        <div className="head">
          <div>
            <h1>{shopName} — Order Integrity Record</h1>
            <p style={{ margin: '3px 0 0', color: '#64748b' }}>
              Order {num} · {order.customerName || 'Guest'} · append-only fulfilment record
            </p>
          </div>
          <span className="flag">{String(order.stage || '').replace('_', ' ')}</span>
        </div>

        <h2>Order</h2>
        <div className="grid">
          <div><div className="k">Placed</div><div className="v">{when(order.placedAt)}</div></div>
          <div><div className="k">Paid</div><div className="v">{when(order.paidAt)}</div></div>
          <div><div className="k">Method</div><div className="v">{String(order.method || 'pickup')}</div></div>
          <div><div className="k">Customer</div><div className="v">{order.customerName || 'Guest'}</div></div>
          <div><div className="k">Email</div><div className="v">{order.customerEmail || '—'}</div></div>
          <div><div className="k">Phone</div><div className="v">{order.customerPhone || '—'}</div></div>
          <div><div className="k">Total</div><div className="v">{money(order.totalCents)}</div></div>
          <div><div className="k">Refunded</div><div className="v">{money(order.refundedCents)}</div></div>
          <div><div className="k">Tracking</div><div className="v">{order.trackingNumber || '—'}</div></div>
        </div>

        <h2>Items — ordered vs scan-verified</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th><th className="num">Ordered</th><th className="num">Scanned</th>
              <th className="num">Shorted</th><th className="num">Returned</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l: any, i: number) => (
              <tr key={i}>
                <td style={{ fontWeight: 700 }}>{l.name || 'Item'}{l.optionsLabel ? ` (${l.optionsLabel})` : ''}</td>
                <td className="num">{l.qtyOrdered ?? 0}</td>
                <td className="num">{l.qtyScanned ?? 0}</td>
                <td className="num">{l.qtyShorted || 0}</td>
                <td className="num">{l.qtyReturned || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Timeline — every recorded event, oldest first</h2>
        <table>
          <thead>
            <tr><th style={{ width: '1.7in' }}>When</th><th style={{ width: '1.9in' }}>Event</th><th style={{ width: '1.1in' }}>By</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {events.map((e: any) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{when(e.at)}</td>
                <td style={{ fontWeight: 700 }}>{EVENT_LABELS[e.type] || e.type}</td>
                <td>{e.actorName || e.actorId || '—'}</td>
                <td style={{ color: '#475569' }}>{metaLine(e)}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr><td colSpan={4} style={{ color: '#64748b' }}>No granular events recorded — see the order stamps above.</td></tr>
            )}
          </tbody>
        </table>

        {photos.length > 0 && (
          <>
            <h2>Packing photos — taken at the bench before sealing</h2>
            <div className="photos">
              {photos.slice(0, 9).map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={u} alt={`Packing photo ${i + 1} for order ${num}`} />
              ))}
            </div>
          </>
        )}

        <div className="foot">
          <span>Generated {generatedAt} · ClarityFlow order-integrity record · order id {orderId}</span>
          <span>{shopName}</span>
        </div>
      </body>
    </html>
  );
}
