import QRCode from 'qrcode';
import { PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';

// ─── /print/product-labels/[tenantId]?ids=a,b,c ───────────────────────────────
// Shelf/product label sheet for selected inventory items — name, SKU, price,
// and the clarityflow://product/{id} QR that the pick ScanGate and the
// inventory scanner both already understand. No PII, so no token gate.
// Prints as a letter sheet of 2.6in x 1.5in labels.

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

export default async function ProductLabelsPage({
  params, searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ ids?: string }>;
}) {
  const { tenantId } = await params;
  const { ids } = await searchParams;
  const idList = String(ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60);
  if (idList.length === 0) return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>No items selected.</p>;

  const db = getAdminDb();
  const snaps = await Promise.all(idList.map((id) => db.collection(`tenants/${tenantId}/inventory`).doc(id).get()));
  const items = await Promise.all(
    snaps.filter((s) => s.exists).map(async (s) => {
      const d = s.data() as any;
      return {
        id: s.id,
        name: String(d.name || ''),
        sku: String(d.sku || ''),
        price: typeof d.msrp === 'number' ? `$${d.msrp.toFixed(2)}` : '',
        qr: await QRCode.toDataURL(`clarityflow://product/${s.id}`, { width: 200, margin: 0 }),
      };
    })
  );

  return (
    <html>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href={PRINT_FONT_HREF} rel="stylesheet" />
        <title>Product labels</title>
        <style>{`
          @page { size: letter; margin: 0.4in; }
          * { box-sizing: border-box; }
          body { font-family: ${PRINT_FONT_STACK}; font-weight: 400; color: #16171a; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          p { margin: 0; }
          .grid { display: flex; flex-wrap: wrap; gap: 0.12in; }
          .lab { width: 2.6in; height: 1.5in; border: 1px dashed #c9cacd; border-radius: 12px; padding: 8px 12px 8px 8px; display: flex; gap: 10px; align-items: center; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
          .lab img { width: 1.05in; height: 1.05in; flex-shrink: 0; }
          .lab div { min-width: 0; }
          .lab .nm { font-size: 11px; font-weight: 500; line-height: 1.3; letter-spacing: -0.005em; }
          .lab .sk { font-size: 9px; color: #6d7075; margin-top: 2px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
          .lab .tp { display: inline-block; margin-top: 5px; padding: 1px 7px; border-radius: 999px; background: #f5f5f7; font-size: 8.5px; font-weight: 500; color: #45474c; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
          .lab .pr { font-size: 16px; font-weight: 300; letter-spacing: -0.01em; margin-top: 5px; font-variant-numeric: tabular-nums; }
        `}</style>
      </head>
      <body>
        <div className="grid">
          {items.map((it) => (
            <div className="lab" key={it.id}>
              <img src={it.qr} alt="" />
              <div>
                <p className="nm">{it.name}</p>
                {it.sku ? <p className="sk">{it.sku}</p> : null}
                <p className="tp">Type {it.sku || it.id}</p>
                {it.price ? <p className="pr">{it.price}</p> : null}
              </div>
            </div>
          ))}
        </div>
        <script dangerouslySetInnerHTML={{ __html: 'setTimeout(function(){window.print()},400);' }} />
      </body>
    </html>
  );
}
