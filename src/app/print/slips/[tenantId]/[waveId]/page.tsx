import { SMART_SLIP_CSS, SmartSlip } from '@/components/print/SmartSlip';
import { SLIP_CSS, SlipSheet, printOrigin } from '@/components/print/slip';
import { slipFor } from '@/lib/order-slip-server';
import { checkPrintKey } from '@/lib/print-key';
import { PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';

// ─── /print/slips/[tenantId]/[waveId] ─────────────────────────────────────────
// The packing half of a rush. The wave pack prints the PICK side of a batch
// (route sheet + tote labels); this route prints the PACK side: every order's
// packing slip and tear-off customer card in ONE print job, one order per
// sheet, sorted by tote so the paper pile matches the bin line at the bench.
//
// Staff only: it opens with the wave's 15-minute print key (lib/print-key, scope wave:{waveId}), like the pick sheet.
// Cancelled orders are SKIPPED (their tote label already says don't pack it on the wave sheet) and counted in the
// screen-only toolbar so nobody wonders why the pile is one sheet shorter than the wave.
//
// Each sheet is the same document the single-slip route prints (components/print/slip and SmartSlip), so the bench
// flow (scan the slip, pack the box, drop the card in) is identical whether a slip arrived alone or in a stack of forty.

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

export default async function BulkSlipsPage({
  params, searchParams,
}: {
  params: Promise<{ tenantId: string; waveId: string }>;
  searchParams: Promise<{ k?: string; x?: string }>;
}) {
  const { tenantId, waveId } = await params;
  const { k, x } = await searchParams;
  if (!checkPrintKey(tenantId, `wave:${waveId}`, k, x)) {
    return <p style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>This link has expired. Open the wave again and tap Print.</p>;
  }
  const db = getAdminDb();

  const [tenantSnap, waveSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection(`tenants/${tenantId}/waves`).doc(waveId).get(),
  ]);

  if (!waveSnap.exists) {
    return <p style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>That wave no longer exists.</p>;
  }

  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  const wave = waveSnap.data() as any;

  const orderDocs = await Promise.all(
    (wave.orders || []).map((w: any) =>
      db.collection(`tenants/${tenantId}/retailOrders`).doc(w.orderId).get())
  );
  const origin = await printOrigin();

  const all = orderDocs.filter((d: any) => d.exists).map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const cancelledCount = all.filter((o: any) => o.stage === 'cancelled').length;
  const orders = all
    .filter((o: any) => o.stage !== 'cancelled')
    .sort((a: any, b: any) =>
      (Number(a.waveTote) || 999) - (Number(b.waveTote) || 999) ||
      (Number(a.orderNumber) || 0) - (Number(b.orderNumber) || 0));

  // Shipped and gift orders get the smart slip; pickup orders keep the handoff slip.
  const jobs = await Promise.all(orders.map(async (order: any) => ({
    order,
    smart: order.method === 'ship' || order.gift ? await slipFor(db, tenantId, order.id, order, tenant, origin).catch(() => null) : null,
  })));

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href={PRINT_FONT_HREF} rel="stylesheet" />
        <title>{`Packing slips · wave of ${orders.length}`}</title>
        <style>{`
          ${SLIP_CSS}
          ${SMART_SLIP_CSS}
          .bar { display: flex; gap: 12px; align-items: center; padding: 10px 0 14px; font-family: ${PRINT_FONT_STACK}; }
          .bar button { font-family: inherit; font-size: 13px; font-weight: 500; padding: 9px 16px; border-radius: 999px; border: 0; background: #16171a; color: #fff; cursor: pointer; }
          .bar p { font-size: 12px; color: #6d7075; margin: 0; }
          @media print { .bar { display: none; } }
          .job { page-break-after: always; }
          .job:last-child { page-break-after: auto; }
        `}</style>
      </head>
      <body>
        <div className="bar">
          <button type="button" id="printBtn">Print all {jobs.length} slip{jobs.length === 1 ? '' : 's'}</button>
          <p>
            One order per sheet, sorted by tote.
            {cancelledCount > 0 ? ` ${cancelledCount} cancelled order${cancelledCount === 1 ? '' : 's'} skipped.` : ''}
          </p>
        </div>

        {jobs.map(({ order, smart }) => (
          <div className="job" key={order.id}>
            {smart
              ? <SmartSlip m={smart.model} size={smart.size} shopName={smart.shopName} logoUrl={smart.logoUrl} qr={smart.qr} giftQr={smart.giftQr} />
              : <SlipSheet tenantId={tenantId} orderId={order.id} order={order} tenant={tenant} origin={origin} />}
          </div>
        ))}

        <script
          dangerouslySetInnerHTML={{
            __html: `document.getElementById('printBtn').addEventListener('click', function(){ window.print(); });`,
          }}
        />
      </body>
    </html>
  );
}
