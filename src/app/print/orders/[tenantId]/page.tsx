import { SLIP_CSS, SlipSheet, printOrigin } from '@/components/print/slip';
import { checkPrintKey } from '@/lib/print-key';
import { PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';

// /print/orders/[tenantId]?ids=a,b,c&show=slips|picks&k=…&x=… — PRINT FOR THE ORDERS YOU PICKED.
// "picks" is one walking list: every item across the chosen orders, added up, sorted by shelf, with which order
// each one goes to. "slips" is every chosen order's packing slip, one per sheet, the same slip the single print
// gives. Staff only: the page needs a fresh print key.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-print-orders';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

const num = (o: any) => `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
const openQty = (l: any) => Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyScanned) || 0) - (Number(l.qtyShorted) || 0));

const BAR_CSS = `
  .bar { position: fixed; top: 0; left: 0; right: 0; background: #16171a; color: #fff; padding: 10px 16px; font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; z-index: 5; }
  .bar button { background: #fff; color: #16171a; border: 0; border-radius: 999px; padding: 8px 16px; font-weight: 600; font-size: 13px; }
  .sheet { page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  @media print { .bar { display: none; } }
  @media screen { body { padding: 64px 24px 24px; max-width: 8.5in; margin: 0 auto; } }
`;

// The pick list is read while walking the shelves, so the shelf and the quantity stay large by size, not by weight.
const PICK_CSS = `
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { font-family: ${PRINT_FONT_STACK}; font-weight: 400; line-height: 1.45; color: #16171a; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 26px; font-weight: 300; margin: 0; letter-spacing: -0.02em; line-height: 1.15; }
  h1 b { font-weight: 600; }
  .sub { font-size: 12px; color: #6d7075; margin: 4px 0 18px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { font-size: 11px; font-weight: 500; text-align: left; color: #6d7075; padding: 8px 6px; border-bottom: 1px solid #ececee; }
  td { font-size: 13px; padding: 10px 6px; border-bottom: 1px solid #ececee; vertical-align: top; font-variant-numeric: tabular-nums; }
  .box { display: inline-block; width: 16px; height: 16px; border: 1px solid #9a9ca1; border-radius: 5px; vertical-align: middle; }
  .qty { font-size: 24px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.1; }
  .shelf { font-size: 16px; font-weight: 500; }
  .to { color: #6d7075; font-size: 12px; }
`;

export default async function PrintOrdersPage({ params, searchParams }: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ ids?: string; show?: string; k?: string; x?: string }>;
}) {
  const { tenantId } = await params;
  const { ids, show, k, x } = await searchParams;
  if (!checkPrintKey(tenantId, 'orders', k, x)) {
    return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>This print link has expired. Go back to Orders and print again.</p>;
  }
  const orderIds = String(ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60);
  if (orderIds.length === 0) return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>No orders were picked.</p>;

  const db = getAdminDb();
  const [tenantSnap, ...snaps] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    ...orderIds.map((id) => db.collection(`tenants/${tenantId}/retailOrders`).doc(id).get()),
  ]);
  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  const orders = snaps.filter((s: any) => s.exists).map((s: any) => ({ id: s.id, ...(s.data() as any) }))
    .filter((o: any) => o.stage !== 'cancelled')
    .sort((a: any, b: any) => (Number(a.orderNumber) || 0) - (Number(b.orderNumber) || 0));

  const fonts = (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href={PRINT_FONT_HREF} rel="stylesheet" />
    </>);
  const printBtn = <script dangerouslySetInnerHTML={{ __html: `document.querySelector('[data-print]')?.addEventListener('click', () => window.print());` }} />;

  if (show === 'slips') {
    const origin = await printOrigin();
    return (
      <html lang="en">
        <head>{fonts}<title>{`Packing slips · ${orders.length}`}</title><style>{SLIP_CSS + BAR_CSS}</style></head>
        <body>
          <div className="bar"><span>{orders.length} packing slip{orders.length === 1 ? '' : 's'}</span><button type="button" data-print>Print</button></div>
          {await Promise.all(orders.map(async (o: any) => (
            <div className="sheet" key={o.id}><SlipSheet tenantId={tenantId} orderId={o.id} order={o} tenant={tenant} origin={origin} /></div>)))}
          {printBtn}
        </body>
      </html>);
  }

  const invIds = new Set<string>();
  orders.forEach((o: any) => (o.lines || []).forEach((l: any) => { if (l.productId && l.digital !== true) invIds.add(String(l.productId)); }));
  const shelf = new Map<string, string>();
  await Promise.all([...invIds].map(async (id) => {
    try { const s = await db.collection(`tenants/${tenantId}/inventory`).doc(id).get(); if (s.exists) { const d = s.data() as any; const v = String(d.storageLocation || d.shelf || d.binLocation || '').trim(); if (v) shelf.set(id, v); } } catch { /* no shelf shown */ }
  }));
  type Row = { key: string; name: string; opt: string; sku: string; shelf: string; qty: number; to: string[] };
  const rows = new Map<string, Row>();
  orders.forEach((o: any) => (o.lines || []).forEach((l: any) => {
    if (l.digital === true || ['shorted', 'refunded', 'backordered'].includes(l.status)) return;
    const q = openQty(l); if (q <= 0) return;
    const key = `${l.productId}|${l.optionsLabel || ''}`;
    const r = rows.get(key) || { key, name: String(l.name || 'Item'), opt: String(l.optionsLabel || ''), sku: String(l.sku || ''), shelf: shelf.get(String(l.productId)) || '', qty: 0, to: [] };
    r.qty += q; r.to.push(`${num(o)} ${String(o.customerName || '').split(' ')[0]}${q > 1 ? ` ×${q}` : ''}`);
    rows.set(key, r);
  }));
  const list = [...rows.values()].sort((a, b) => (a.shelf || '~').localeCompare(b.shelf || '~', undefined, { numeric: true }) || a.name.localeCompare(b.name));
  const units = list.reduce((a, r) => a + r.qty, 0);

  return (
    <html lang="en">
      <head>{fonts}<title>{`Pick list · ${orders.length} orders`}</title><style>{PICK_CSS + BAR_CSS}</style></head>
      <body>
        <div className="bar"><span>Pick list · {units} item{units === 1 ? '' : 's'} for {orders.length} order{orders.length === 1 ? '' : 's'}</span><button type="button" data-print>Print</button></div>
        <h1>Pick <b>list</b></h1>
        <p className="sub">{orders.map(num).join(' · ')}</p>
        {list.length === 0 ? <p>Everything on these orders is already in its box.</p> : (
          <table>
            <thead><tr><th style={{ width: '5%' }} /><th style={{ width: '12%' }}>Shelf</th><th>Item</th><th style={{ width: '8%' }}>Qty</th><th style={{ width: '32%' }}>Goes to</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.key}>
                  <td><span className="box" /></td>
                  <td className="shelf">{r.shelf || '—'}</td>
                  <td>{r.name}{r.opt ? <span className="to"> · {r.opt}</span> : null}{r.sku ? <div className="to">{r.sku}</div> : null}</td>
                  <td className="qty">{r.qty}</td>
                  <td className="to">{r.to.join(', ')}</td>
                </tr>))}
            </tbody>
          </table>)}
        {printBtn}
      </body>
    </html>);
}
