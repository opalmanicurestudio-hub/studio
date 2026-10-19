import * as React from 'react';
import { checkPrintKey } from '@/lib/print-key';
import { isPngLabel, isZplLabel, labelFormatOf, slipAfterLabel } from '@/lib/label-format';

/**
 * /print/labels/[tenantId]?ids=orderId,orderId,… — the label STACK.
 *
 * The bulk buy ends here: every label from the run on its own 4×6 page, in
 * order-number order, so one print job feeds the thermal printer and the
 * stack lands on the pack bench already sorted. PNG labels lay out as pages
 * (that's why the bulk route buys PNG_4x6); any PDF labels on these orders —
 * from the single-label dialog — can't embed in a page flow, so they're
 * listed as links on a closing sheet instead of silently dropped.
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

export default async function PrintLabelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ ids?: string; k?: string; x?: string }>;
}) {
  const { tenantId } = await params;
  const { ids, k, x } = await searchParams;
  if (!checkPrintKey(tenantId, 'orders', k, x)) {
    return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>This print link has expired. Go back to Orders and print again.</p>;
  }
  const orderIds = String(ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30);

  if (orderIds.length === 0) {
    return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>No orders given — open this page from the board&apos;s bulk-label button.</p>;
  }

  const db = getAdminDb();
  const tenantSnap = await db.collection('tenants').doc(tenantId).get().catch(() => null);
  const tenantData = (tenantSnap?.data() as any) || {};
  const paper = labelFormatOf(tenantData.retailSettings) === 'paper';
  const withSlip = slipAfterLabel(tenantData.retailSettings);
  const shopName = String(tenantData.businessName || tenantData.name || '');
  const snaps = await Promise.all(
    orderIds.map((id) => db.collection(`tenants/${tenantId}/retailOrders`).doc(id).get())
  );

  const entries = snaps
    .filter((s: any) => s.exists)
    .map((s: any) => ({ id: s.id, ...(s.data() as any) }))
    .filter((o: any) => o.labelUrl)
    .sort((a: any, b: any) => (Number(a.orderNumber) || 0) - (Number(b.orderNumber) || 0));

  const pngs = entries.filter((o: any) => isPngLabel(o.labelUrl));
  const zpls = entries.filter((o: any) => isZplLabel(o.labelUrl));
  const pdfs = entries.filter((o: any) => !isPngLabel(o.labelUrl) && !isZplLabel(o.labelUrl));
  const zplHref = zpls.length ? `/api/retail/labels-zpl?tenantId=${encodeURIComponent(tenantId)}&ids=${encodeURIComponent(zpls.map((o: any) => o.id).join(','))}&k=${encodeURIComponent(String(k || ''))}&x=${encodeURIComponent(String(x || ''))}` : '';

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`Label stack — ${pngs.length} label${pngs.length === 1 ? '' : 's'}`}</title>
        <style>{`
          @page { size: ${paper ? '8.5in 11in' : '4in 6in'}; margin: 0; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
          .label { width: ${paper ? '8.5in' : '4in'}; height: ${paper ? '11in' : '6in'}; page-break-after: always; display: flex; align-items: ${paper ? 'flex-start' : 'center'}; justify-content: center; overflow: hidden; ${paper ? 'padding-top: 0.5in; border-bottom: 0;' : ''} }
          .cut { ${paper ? 'position: absolute; left: 0.5in; right: 0.5in; top: 6.75in; border-top: 1px dashed #94a3b8;' : 'display: none;'} }
          .label { position: relative; }
          .slip-in { width: 4in; height: 6in; padding: 0.25in; display: flex; flex-direction: column; gap: 8px; color: #000; }
          .slip-top { display: flex; justify-content: space-between; align-items: flex-start; }
          .shop { font-size: 10px; font-weight: 700; } .num { font-size: 30px; font-weight: 800; line-height: 1.05; } .who { font-size: 12px; font-weight: 600; }
          .tote { border: 2px solid #000; padding: 4px 10px; display: flex; flex-direction: column; align-items: center; } .tote span { font-size: 9px; font-weight: 800; } .tote b { font-size: 24px; line-height: 1; }
          .rule { height: 2px; background: #000; }
          .line { display: flex; gap: 8px; font-size: 12px; font-weight: 600; align-items: flex-start; } .line .box { width: 12px; height: 12px; border: 1.5px solid #000; flex-shrink: 0; margin-top: 1px; } .line .nm { flex: 1; }
          .thanks { margin-top: auto; font-size: 10px; font-weight: 600; }
          .label img { width: 4in; height: 6in; object-fit: contain; }
          .sheet { width: 4in; min-height: 6in; padding: 0.25in; font-size: 10px; color: #0f172a; }
          .sheet h1 { font-size: 12px; margin: 0 0 8px; }
          .sheet a { color: #0f172a; word-break: break-all; }
          .bar { position: fixed; top: 0; left: 0; right: 0; background: #0f172a; color: #fff; padding: 10px 14px; font-size: 12px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; }
          .bar button { background: #fff; color: #0f172a; border: 0; border-radius: 8px; padding: 6px 14px; font-weight: 800; font-size: 12px; }
          @media print { .bar { display: none; } }
          @media screen { body { background: #e2e8f0; padding-top: 46px; } .label, .sheet { background: #fff; margin: 10px auto; box-shadow: 0 1px 4px rgba(0,0,0,.2); } }
        `}</style>
      </head>
      <body>
        <div className="bar">
          <span>{pngs.length} label{pngs.length === 1 ? '' : 's'} ready{pdfs.length ? ` · ${pdfs.length} PDF listed at the end` : ''}{zpls.length ? ` · ${zpls.length} for the label printer` : ''}</span>
          {zplHref ? <a href={zplHref} style={{ color: '#fff', fontWeight: 800 }}>Download printer file</a> : null}
          <button type="button" data-print>Print stack</button>
        </div>
        {pngs.map((o: any) => (
          <React.Fragment key={o.id}>
          <div className="label">
            <img src={o.labelUrl} alt={`Shipping label for order #${String(o.orderNumber ?? '').padStart(4, '0')}`} />
            <div className="cut" />
          </div>
          {withSlip && (
            <div className="label slip">
              <div className="slip-in">
                <div className="slip-top">
                  <div><div className="shop">{shopName}</div><div className="num">#{String(o.orderNumber ?? '').padStart(4, '0')}</div><div className="who">{o.customerName || ''}</div></div>
                  {Number(o.toteNo) > 0 ? <div className="tote"><span>TOTE</span><b>{o.toteNo}</b></div> : null}
                </div>
                <div className="rule" />
                {(o.lines || []).filter((l: any) => !['shorted', 'refunded', 'backordered'].includes(l.status) && (l.qtyOrdered || 0) - (l.qtyShorted || 0) > 0).map((l: any) => (
                  <div className="line" key={l.lineId || l.productId}><span className="box" /><span className="nm">{l.name}{l.optionsLabel ? ` · ${l.optionsLabel}` : ''}</span><span>×{(l.qtyOrdered || 0) - (l.qtyShorted || 0)}</span></div>
                ))}
                <div className="thanks">Thank you for your order.</div>
              </div>
            </div>
          )}
          </React.Fragment>
        ))}
        {pdfs.length > 0 && (
          <div className="sheet">
            <h1>PDF labels — open and print separately</h1>
            {pdfs.map((o: any) => (
              <p key={o.id}>
                #{String(o.orderNumber ?? '').padStart(4, '0')} — <a href={o.labelUrl}>{o.labelUrl}</a>
              </p>
            ))}
          </div>
        )}
        {zpls.length > 0 && pngs.length === 0 && (
          <div className="sheet"><h1>{zpls.length} label{zpls.length === 1 ? '' : 's'} for the label printer</h1><p><a href={zplHref}>Download the printer file</a> and send it to the label printer.</p></div>
        )}
        {pngs.length === 0 && pdfs.length === 0 && zpls.length === 0 && (
          <div className="sheet"><h1>No labels found on these orders yet.</h1></div>
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.querySelector('[data-print]')?.addEventListener('click', () => window.print());`,
          }}
        />
      </body>
    </html>
  );
}
