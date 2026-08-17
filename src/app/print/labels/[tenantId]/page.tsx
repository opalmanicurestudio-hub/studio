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
  searchParams: Promise<{ ids?: string }>;
}) {
  const { tenantId } = await params;
  const { ids } = await searchParams;
  const orderIds = String(ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30);

  if (orderIds.length === 0) {
    return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>No orders given — open this page from the board&apos;s bulk-label button.</p>;
  }

  const db = getAdminDb();
  const snaps = await Promise.all(
    orderIds.map((id) => db.collection(`tenants/${tenantId}/retailOrders`).doc(id).get())
  );

  const entries = snaps
    .filter((s: any) => s.exists)
    .map((s: any) => ({ id: s.id, ...(s.data() as any) }))
    .filter((o: any) => o.labelUrl)
    .sort((a: any, b: any) => (Number(a.orderNumber) || 0) - (Number(b.orderNumber) || 0));

  const isPng = (u: string) => /\.png(\?|$)/i.test(u) || u.includes('label_file_type=PNG');
  const pngs = entries.filter((o: any) => isPng(String(o.labelUrl)));
  const pdfs = entries.filter((o: any) => !isPng(String(o.labelUrl)));

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`Label stack — ${pngs.length} label${pngs.length === 1 ? '' : 's'}`}</title>
        <style>{`
          @page { size: 4in 6in; margin: 0; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
          .label { width: 4in; height: 6in; page-break-after: always; display: flex; align-items: center; justify-content: center; overflow: hidden; }
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
          <span>{pngs.length} label{pngs.length === 1 ? '' : 's'} ready{pdfs.length ? ` · ${pdfs.length} PDF listed at the end` : ''}</span>
          {/* eslint-disable-next-line @next/next/no-sync-scripts */}
          <button type="button" data-print>Print stack</button>
        </div>
        {pngs.map((o: any) => (
          <div className="label" key={o.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.labelUrl} alt={`Shipping label for order #${String(o.orderNumber ?? '').padStart(4, '0')}`} />
          </div>
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
        {pngs.length === 0 && pdfs.length === 0 && (
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
