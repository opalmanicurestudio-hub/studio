/**
 * /print/claim-pack/[tenantId]/[excId] — the CLAIM PACK: everything a
 * carrier or supplier claim form asks for, assembled onto one printable
 * document — claim summary (tracking, ship date, insured value, amount),
 * item costs, proof of value (what the customer actually paid), the
 * fulfilment evidence chain (scan completeness, pack photos, chronology
 * from the order's append-only event log), and the customer's own statement
 * with their photos. Filing a claim becomes: open pack, copy fields, attach
 * this document. Server-rendered on the Admin SDK like every print surface.
 */

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

const fmt = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

export default async function PrintClaimPackPage({
  params,
}: {
  params: Promise<{ tenantId: string; excId: string }>;
}) {
  const { tenantId, excId } = await params;
  const db = getAdminDb();

  const excSnap = await db.collection(`tenants/${tenantId}/inventoryExceptions`).doc(excId).get();
  if (!excSnap.exists) {
    return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>Exception not found.</p>;
  }
  const exc = { id: excSnap.id, ...(excSnap.data() as any) };

  const [tenantSnap, orderSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    exc.orderId ? db.collection(`tenants/${tenantId}/retailOrders`).doc(exc.orderId).get() : Promise.resolve(null),
  ]);
  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  const shopName = String(tenant.businessName || tenant.name || 'Shop');
  const order = orderSnap && orderSnap.exists ? (orderSnap.data() as any) : null;

  let events: any[] = [];
  if (exc.orderId) {
    try {
      const evSnap = await db.collection(`tenants/${tenantId}/retailOrders/${exc.orderId}/events`).get();
      const KEEP = new Set(['paid', 'picking', 'packed', 'label_generated', 'shipped', 'handed_off', 'completed', 'note']);
      events = evSnap.docs
        .map((d: any) => d.data() as any)
        .filter((e: any) => KEEP.has(String(e.type)))
        .sort((a: any, b: any) => String(a.at || '').localeCompare(String(b.at || '')));
    } catch { events = []; }
  }

  const rec = exc.recovery || {};
  const when = (iso: any) => {
    const d = new Date(String(iso || ''));
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const whenT = (iso: any) => {
    const d = new Date(String(iso || ''));
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const scanLines = order
    ? (order.lines || []).filter((l: any) => l.digital !== true).map((l: any) => {
        const target = Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0));
        return { name: l.name, scanned: Number(l.qtyScanned) || 0, target };
      })
    : [];
  const allScanned = scanLines.length > 0 && scanLines.every((l: any) => l.scanned >= l.target);
  const packPhotos: string[] = order && Array.isArray(order.packPhotoUrls) ? order.packPhotoUrls.slice(0, 6) : [];
  const claimPhotos: string[] = Array.isArray(exc.photoUrls) ? exc.photoUrls.slice(0, 6) : [];
  const perUnit = exc.qty > 0 ? Math.round((Number(exc.landedCostCents) || 0) / exc.qty) : 0;
  const generatedAt = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  const Row = ({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) => (
    <tr>
      <td style={{ width: '38%', color: '#64748b', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 8px 4px 0', verticalAlign: 'top' }}>{k}</td>
      <td style={{ fontWeight: strong ? 800 : 600, padding: '4px 0', fontVariantNumeric: 'tabular-nums' }}>{v}</td>
    </tr>
  );

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`Claim pack — ${exc.name}`}</title>
        <style>{`
          @page { size: letter portrait; margin: 0.55in; }
          * { box-sizing: border-box; }
          body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; font-size: 11px; line-height: 1.5; }
          h1 { font-size: 18px; margin: 0; }
          h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; margin: 18px 0 6px; border-bottom: 2px solid #0f172a; padding-bottom: 3px; }
          table { border-collapse: collapse; width: 100%; }
          .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0f172a; padding-bottom: 10px; }
          .photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
          .photos img { width: 1.55in; height: 1.55in; object-fit: cover; border: 1px solid #cbd5e1; border-radius: 6px; }
          .chron td { padding: 2.5px 8px 2.5px 0; border-bottom: 1px dashed #e2e8f0; }
          .quote { border-left: 3px solid #94a3b8; padding: 4px 0 4px 10px; color: #334155; white-space: pre-wrap; }
          .foot { margin-top: 20px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; }
          section { break-inside: avoid; }
        `}</style>
      </head>
      <body>
        <div className="head">
          <div>
            <h1>{shopName} — Claim pack</h1>
            <p style={{ margin: '3px 0 0', color: '#64748b' }}>
              {exc.reasonGroup === 'supplier' ? 'Supplier claim' : 'Carrier claim'} · {exc.qty > 1 ? `${exc.qty} × ` : ''}{exc.name}
              {exc.orderNumber != null ? ` · order #${String(exc.orderNumber).padStart(4, '0')}` : ''}
            </p>
          </div>
        </div>

        <section>
          <h2>Claim summary</h2>
          <table>
            <tbody>
              <Row k="Loss event" v={`${when(exc.at)} — ${String(exc.reason || '').replace(/_/g, ' ')}`} />
              {exc.carrier && <Row k="Carrier" v={exc.carrier} />}
              {exc.trackingNumber && <Row k="Tracking number" v={exc.trackingNumber} strong />}
              {exc.shippedAt && <Row k="Shipped" v={when(exc.shippedAt)} />}
              {exc.insuredCents != null && (
                <Row k="Insurance purchased" v={exc.insuredCents > 0 ? `${fmt(exc.insuredCents)} (added at label purchase)` : 'None added — carrier-included coverage only'} strong />
              )}
              {rec.claimAmountCents > 0 && <Row k="Claim amount" v={fmt(rec.claimAmountCents)} strong />}
              {rec.refNumber && <Row k="Claim reference" v={rec.refNumber} strong />}
              {rec.filedAt && <Row k="Filed" v={when(rec.filedAt)} />}
              {rec.deadlineAt && <Row k="Deadline" v={when(rec.deadlineAt)} />}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Proof of value</h2>
          <table>
            <tbody>
              <Row k="Item" v={`${exc.qty} × ${exc.name}${exc.sku ? ` (SKU ${exc.sku})` : ''}`} />
              <Row k="Cost basis (landed)" v={`${fmt(perUnit)} / unit — ${fmt(exc.landedCostCents)} total`} strong />
              {exc.retailCents > 0 && <Row k="Declared retail value" v={fmt(exc.retailCents)} />}
              {order && <Row k="Customer paid" v={`${fmt(order.totalCents)} on order #${String(order.orderNumber ?? '').padStart(4, '0')} (${when(order.paidAt)}) — invoice available on request`} />}
              {(Number(rec.recoveredCents) || 0) > 0 && <Row k="Already recovered" v={fmt(rec.recoveredCents)} />}
            </tbody>
          </table>
        </section>

        {order && (
          <section>
            <h2>Fulfilment evidence</h2>
            <table>
              <tbody>
                <Row k="Barcode scan record" v={allScanned
                  ? `COMPLETE — every unit scanned at packing (${scanLines.map((l: any) => `${l.name}: ${l.scanned}/${l.target}`).join('; ')})`
                  : scanLines.map((l: any) => `${l.name}: ${l.scanned}/${l.target}`).join('; ') || '—'} strong={allScanned} />
                {order.shipmentProtection?.expectedWeightOz && <Row k="Expected parcel weight" v={`${order.shipmentProtection.expectedWeightOz} oz (recorded at label purchase)`} />}
                {order.shipmentProtection?.signature && order.shipmentProtection.signature !== 'NONE' && <Row k="Signature confirmation" v={order.shipmentProtection.signature} />}
                <Row k="Order stage" v={String(order.stage || '').replace(/_/g, ' ')} />
              </tbody>
            </table>
            {packPhotos.length > 0 && (
              <>
                <p style={{ margin: '8px 0 0', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b' }}>Packing-station photos</p>
                <div className="photos">
                  {packPhotos.map((u: string, i: number) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={u} alt={`Packing photo ${i + 1}`} />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {(exc.note || claimPhotos.length > 0) && (
          <section>
            <h2>Reported condition</h2>
            {exc.note && <p className="quote">{exc.note}</p>}
            {claimPhotos.length > 0 && (
              <div className="photos">
                {claimPhotos.map((u: string, i: number) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={u} alt={`Condition photo ${i + 1}`} />
                ))}
              </div>
            )}
          </section>
        )}

        {events.length > 0 && (
          <section>
            <h2>Chronology (from the order&apos;s append-only event log)</h2>
            <table className="chron">
              <tbody>
                {events.map((e: any, i: number) => (
                  <tr key={i}>
                    <td style={{ width: '28%', whiteSpace: 'nowrap', color: '#64748b' }}>{whenT(e.at)}</td>
                    <td style={{ fontWeight: 600 }}>
                      {String(e.type).replace(/_/g, ' ')}
                      {e.meta?.trackingNumber ? ` — ${e.meta.trackingNumber}` : ''}
                      {e.meta?.text ? ` — ${e.meta.text}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <div className="foot">
          <span>Assembled {generatedAt} · ClarityFlow claim pack · attach this document to the {exc.reasonGroup === 'supplier' ? 'supplier' : 'carrier'} claim</span>
          <span>{shopName}</span>
        </div>
      </body>
    </html>
  );
}
