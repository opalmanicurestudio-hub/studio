import * as React from 'react';
import { checkPrintKey } from '@/lib/print-key';
import { SMART_SLIP_CSS, SmartSlip } from '@/components/print/SmartSlip';
import { printOrigin } from '@/components/print/slip';
import { slipFor } from '@/lib/order-slip-server';
import { isPngLabel, isZplLabel, labelFormatOf, slipAfterLabel } from '@/lib/label-format';
import { liveSlots } from '@/lib/label-boxes';

// The labels that still work, one per box: a box whose label was voided (lib/label-boxes) prints nothing until it has
// its new one.
const liveUrls = (o: any): string[] => liveSlots(o).map((s) => s.labelUrl).filter(Boolean);

/**
 * /print/labels/[tenantId]?ids=orderId,orderId,… — the label STACK.
 *
 * The bulk buy ends here: every label from the run on its own 4×6 page, in
 * the order the boxes were packed, so one print job feeds the thermal printer
 * and the stack lands on the pack bench in the same order as the boxes. PNG labels lay out as pages
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
  const orderIds = String(ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);

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
    // In the order the boxes were packed, so the stack matches the pile of boxes on the bench (order number between
    // boxes packed together).
    .sort((a: any, b: any) => (Date.parse(a.packedAt || '') || 0) - (Date.parse(b.packedAt || '') || 0) || (Number(a.orderNumber) || 0) - (Number(b.orderNumber) || 0));

  const pngs = entries.filter((o: any) => isPngLabel(o.labelUrl));
  const zpls = entries.filter((o: any) => isZplLabel(o.labelUrl));
  const pdfs = entries.filter((o: any) => !isPngLabel(o.labelUrl) && !isZplLabel(o.labelUrl));
  // Orders shipped together share one label: it prints once, and each order's slip follows it.
  const printedLabels = new Set<string>();
  const pngCount = new Set(pngs.flatMap((o: any) => liveUrls(o).filter((u) => isPngLabel(u)))).size;   // one per box
  const origin = withSlip ? await printOrigin() : '';
  const slips = new Map<string, Awaited<ReturnType<typeof slipFor>>>();
  if (withSlip) for (const o of pngs) { try { slips.set(o.id, await slipFor(db, tenantId, o.id, o, tenantData, origin, paper ? 'half' : '4x6')); } catch { /* the label still prints */ } }
  const zplHref = zpls.length ? `/api/retail/labels-zpl?tenantId=${encodeURIComponent(tenantId)}&ids=${encodeURIComponent(zpls.map((o: any) => o.id).join(','))}&k=${encodeURIComponent(String(k || ''))}&x=${encodeURIComponent(String(x || ''))}` : '';

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`Label stack — ${pngCount} label${pngCount === 1 ? '' : 's'}`}</title>
        <style>{`
          @page { size: ${paper ? '8.5in 11in' : '4in 6in'}; margin: 0; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
          .label { width: ${paper ? '8.5in' : '4in'}; height: ${paper ? '11in' : '6in'}; page-break-after: always; display: flex; align-items: ${paper ? 'flex-start' : 'center'}; justify-content: center; overflow: hidden; ${paper ? 'padding-top: 0.5in; border-bottom: 0;' : ''} }
          .cut { ${paper ? 'position: absolute; left: 0.5in; right: 0.5in; top: 6.75in; border-top: 1px dashed #94a3b8;' : 'display: none;'} }
          .label { position: relative; }
          ${SMART_SLIP_CSS}
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
          <span>{pngCount} label{pngCount === 1 ? '' : 's'} ready{pdfs.length ? ` · ${pdfs.length} PDF listed at the end` : ''}{zpls.length ? ` · ${zpls.length} for the label printer` : ''}</span>
          {zplHref ? <a href={zplHref} style={{ color: '#fff', fontWeight: 800 }}>Download printer file</a> : null}
          <button type="button" data-print>Print stack</button>
        </div>
        {pngs.map((o: any) => { const all = liveUrls(o).filter((u) => isPngLabel(u) && !printedLabels.has(u)); all.forEach((u) => printedLabels.add(u)); return (
          <React.Fragment key={o.id}>
          {all.map((u: string, i: number) => (
          <div className="label" key={u}>
            <img src={u} alt={`Shipping label for order #${String(o.orderNumber ?? '').padStart(4, '0')}${all.length > 1 ? `, box ${i + 1} of ${all.length}` : ''}`} />
            <div className="cut" />
          </div>))}
          {withSlip && slips.get(o.id) && (
            <div className="label slip">
              {(() => { const x = slips.get(o.id)!; return <SmartSlip m={x.model} size={x.size} shopName={x.shopName} qr={x.qr} giftQr={x.giftQr} />; })()}
            </div>
          )}
          </React.Fragment>
        ); })}
        {pdfs.length > 0 && (
          <div className="sheet">
            <h1>PDF labels — open and print separately</h1>
            {pdfs.map((o: any) => (
              <p key={o.id}>
                #{String(o.orderNumber ?? '').padStart(4, '0')}
                {liveSlots(o).filter((b) => b.labelUrl).map((b) => <React.Fragment key={b.labelUrl}><br />{liveSlots(o).length > 1 ? `Box ${b.slot + 1}: ` : ''}<a href={b.labelUrl}>{b.labelUrl}</a></React.Fragment>)}
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
