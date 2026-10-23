import { checkPrintKey } from '@/lib/print-key';
import { PACK_PHOTO_KIND_LABEL, packPhotosOf } from '@/lib/pack-photo';
import { PRINT_CSS, PRINT_FONT_HREF } from '@/lib/print-style';
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
  batch_claimed: 'Claimed for fulfillment',
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
// A stored value such as "ready_for_pickup" as words in sentence case, for the page.
const words = (v: any) => { const s = String(v || '').replace(/_/g, ' ').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };

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
  searchParams,
}: {
  params: Promise<{ tenantId: string; orderId: string }>;
  searchParams: Promise<{ k?: string; x?: string }>;
}) {
  const { tenantId, orderId } = await params;
  const { k, x } = await searchParams;
  if (!checkPrintKey(tenantId, `evidence:${orderId}`, k, x)) return <p style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>This link has expired. Open the evidence page again and tap Print.</p>;
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href={PRINT_FONT_HREF} rel="stylesheet" />
        <style>{`
          @page { size: letter portrait; margin: 0.55in; }
          body { margin: 0; }
          ${PRINT_CSS}
          .pp .num { text-align: right; }
          .pp td.item { font-weight: 500; }
          .pp .facts { row-gap: 10px; }
          .pp .facts .v { font-size: 12.5px; font-weight: 500; margin-top: 1px; overflow-wrap: anywhere; }
          .pp .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
          .pp .photos figure { margin: 0; break-inside: avoid; }
          .pp .photos img { display: block; width: 100%; height: 2.2in; object-fit: cover; border-radius: 12px; background: #f5f5f7; }
          .pp .photos figcaption { font-size: 10.5px; color: #6d7075; margin-top: 4px; line-height: 1.45; }
        `}</style>
      </head>
      <body className="pp-screen">
        <div className="pp page">
          <div className="head">
            <div>
              <p className="shop">{shopName}</p>
              <h1>Order integrity <b>record</b></h1>
              <p className="sub">Order {num} · {order.customerName || 'Guest'} · append-only fulfillment record</p>
            </div>
            {words(order.stage) ? <span className="pill">{words(order.stage)}</span> : null}
          </div>

          <h2>Order</h2>
          <div className="panel grid3 facts">
            <div><p className="lbl">Placed</p><p className="v">{when(order.placedAt)}</p></div>
            <div><p className="lbl">Paid</p><p className="v">{when(order.paidAt)}</p></div>
            <div><p className="lbl">Method</p><p className="v">{words(order.method || 'pickup')}</p></div>
            <div><p className="lbl">Customer</p><p className="v">{order.customerName || 'Guest'}</p></div>
            <div><p className="lbl">Email</p><p className="v">{order.customerEmail || '—'}</p></div>
            <div><p className="lbl">Phone</p><p className="v">{order.customerPhone || '—'}</p></div>
            <div><p className="lbl">Total</p><p className="v">{money(order.totalCents)}</p></div>
            <div><p className="lbl">Refunded</p><p className="v">{money(order.refundedCents)}</p></div>
            <div><p className="lbl">Tracking</p><p className="v">{order.trackingNumber || '—'}</p></div>
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
                  <td className="item">{l.name || 'Item'}{l.optionsLabel ? <span className="muted"> ({l.optionsLabel})</span> : null}</td>
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
                  <td className="nowrap muted">{when(e.at)}</td>
                  <td className="item">{EVENT_LABELS[e.type] || e.type}</td>
                  <td>{e.actorName || e.actorId || '—'}</td>
                  <td className="body">{metaLine(e)}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={4} className="muted">No granular events recorded — see the order stamps above.</td></tr>
              )}
            </tbody>
          </table>

          {photos.length > 0 && (
            <>
              <h2>Packing photos — taken at the bench before sealing</h2>
              <div className="photos">
                {packPhotosOf(order).slice(0, 9).map((p, i) => (
                  <figure key={p.url}>
                    <img src={p.url} alt={`Packing photo ${i + 1} for order ${num}`} />
                    <figcaption>Box {p.box} · {PACK_PHOTO_KIND_LABEL[p.kind]}{p.by ? ` · ${p.by}` : ''}{p.at ? ` · ${String(p.at).slice(0, 16).replace('T', ' ')}` : ''}</figcaption>
                  </figure>
                ))}
              </div>
            </>
          )}

          <div className="foot">
            <span>Generated {generatedAt} · ClarityFlow order-integrity record · order id {orderId}</span>
            <span>{shopName}</span>
          </div>
        </div>
      </body>
    </html>
  );
}
