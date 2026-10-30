import QRCode from 'qrcode';
import { checkPrintKey } from '@/lib/print-key';
import { PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';

// ─── /print/wave/[tenantId]/[waveId] ──────────────────────────────────────────
// The paper half of a wave: a pick sheet you carry, then tote labels you cut
// and clip to the bins.
//
// Design decisions that matter on a warehouse floor rather than a screen:
//   • Rows are grouped by LOCATION and each group starts with its own heading,
//     so the sheet reads as a route through the room.
//   • The quantity is the largest thing on the row — it is the number someone
//     reads while holding a product in one hand.
//   • Tote numbers sit beside every row, because bulk picking is useless if
//     you cannot tell which unit belongs in which bin.
//   • Checkboxes are pen-sized (7mm), not decorative.
//   • Rows never split across pages, and a location heading never orphans at
//     the bottom of one.
//   • Every tote label carries the order QR, so the bench can scan the bin
//     straight open instead of typing a number.
//
// Deliberately NOT here: shipping labels. Weights are not final until the box
// is packed, and a label printed early becomes a label voided later.
//
// Staff only: it has customers' names on it, so it opens with a 15-minute key from the app (lib/print-key, scope
// wave:{waveId}), the same key the wave's packing slips take. In the app's print look (lib/print-style): light
// headings, sentence-case labels, thin lines; the quantity is the biggest thing on a row by size, not by weight.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-print-wave';
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

const when = (iso: string) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default async function PrintWavePage({
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
    return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>That wave no longer exists.</p>;
  }

  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  const wave = waveSnap.data() as any;
  const shopName = String(tenant.businessName || tenant.name || 'Shop');
  const logoUrl = String(tenant.logoUrl || '');

  const orderDocs = await Promise.all(
    (wave.orders || []).map((w: any) =>
      db.collection(`tenants/${tenantId}/retailOrders`).doc(w.orderId).get())
  );
  const orderById = new Map<string, any>();
  orderDocs.forEach((d: any) => { if (d.exists) orderById.set(d.id, d.data()); });

  // Locations come from the same places the app uses: an explicit storage note
  // first, otherwise whichever holder has the most units.
  const invSnap = await db.collection(`tenants/${tenantId}/inventory`).limit(500).get();
  const shelfFor = new Map<string, string>();
  invSnap.docs.forEach((d: any) => {
    const i = d.data() as any;
    const explicit = String(i.storageLocation || i.shelf || i.binLocation || '').trim();
    if (explicit) { shelfFor.set(d.id, explicit); return; }
    const allocs = Object.values((i.allocations && typeof i.allocations === 'object') ? i.allocations : {}) as any[];
    const held = allocs.filter((a) => a && Number(a.qty) > 0).sort((a, b) => Number(b.qty) - Number(a.qty));
    if (held.length > 0) shelfFor.set(d.id, String(held[0].name || ''));
  });

  // Consolidated pick rows.
  const rowMap = new Map<string, { name: string; sku: string; location: string; qty: number; totes: string[] }>();
  (wave.orders || []).forEach((w: any) => {
    const order = orderById.get(w.orderId);
    if (!order) return;
    // A cancelled order still prints, flagged, so nobody wonders why a tote is
    // empty — but its units are excluded from the counts.
    const dead = ['cancelled'].includes(String(order.stage));
    if (dead) return;
    (order.lines || []).forEach((l: any) => {
      const open = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
      if (open <= 0) return;
      const key = String(l.productId);
      const row = rowMap.get(key) || {
        name: String(l.name || 'Item'),
        sku: String(l.sku || ''),
        location: shelfFor.get(key) || '',
        qty: 0,
        totes: [],
      };
      row.qty += open;
      row.totes.push(open > 1 ? `${w.tote}×${open}` : String(w.tote));
      rowMap.set(key, row);
    });
  });

  const rows = [...rowMap.values()].sort((a, b) =>
    (a.location || 'zzz').localeCompare(b.location || 'zzz') || a.name.localeCompare(b.name));

  const groups: { location: string; rows: typeof rows }[] = [];
  rows.forEach((r) => {
    const label = r.location || 'No location set';
    const g = groups.find((x) => x.location === label);
    if (g) g.rows.push(r); else groups.push({ location: label, rows: [r] });
  });

  const totes = await Promise.all((wave.orders || []).map(async (w: any) => {
    const order = orderById.get(w.orderId);
    const cancelled = order ? ['cancelled'].includes(String(order.stage)) : false;
    return {
      tote: w.tote,
      orderNumber: w.orderNumber,
      customerName: w.customerName,
      method: w.method === 'ship' ? 'Ship' : w.method === 'delivery' ? 'Delivery' : w.method === 'curbside' ? (tenant.retailSettings?.curbsideMode === 'drive_thru' ? 'Drive-through' : 'Curbside') : w.method === 'digital' ? 'Download' : 'Pickup',
      itemCount: w.itemCount,
      cancelled,
      qr: await QRCode.toDataURL(
        `clarityflow://order/${w.orderId}`,
        { width: 160, margin: 0 }
      ),
    };
  }));

  const units = rows.reduce((a, r) => a + r.qty, 0);
  const liveTotes = totes.filter((t) => !t.cancelled).length;

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${shopName} — ${wave.name || 'Wave'}`}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href={PRINT_FONT_HREF} rel="stylesheet" />
        <style>{`
          @page { size: letter portrait; margin: 0.45in; }
          * { box-sizing: border-box; }
          body {
            margin: 0; background: #fff; color: #16171a;
            font-family: ${PRINT_FONT_STACK}; font-weight: 400;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          .sheet { max-width: 7.6in; margin: 0 auto; padding: 0 0 24px; }

          .bar { display: flex; gap: 8px; padding: 10px 0 14px; }
          .bar button, .bar a { font-family: inherit; font-size: 13px; font-weight: 500; padding: 9px 16px; border-radius: 999px; border: 0; background: #16171a; color: #fff; cursor: pointer; text-decoration: none; }
          .bar a { background: #f5f5f7; color: #16171a; }
          @media print { .bar { display: none; } }

          .head { display: flex; align-items: center; gap: 14px; border-bottom: 1px solid #ececee; padding-bottom: 12px; }
          .head img.logo { width: 44px; height: 44px; object-fit: cover; border-radius: 12px; }
          .head h1 { margin: 0; font-size: 24px; font-weight: 300; letter-spacing: -.02em; }
          .head p { margin: 3px 0 0; font-size: 11.5px; color: #6d7075; }
          .head .totals { margin-left: auto; text-align: right; font-size: 11.5px; color: #6d7075; }
          .head .totals b { display: block; font-size: 22px; font-weight: 300; color: #16171a; font-variant-numeric: tabular-nums; }

          .loc { margin: 20px 0 4px; font-size: 13px; font-weight: 600;
                 border-bottom: 1px solid #ececee; padding-bottom: 6px;
                 break-after: avoid; page-break-after: avoid; }

          .row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid #ececee;
                 break-inside: avoid; page-break-inside: avoid; }
          .box { width: 7mm; height: 7mm; border: 1px solid #9a9ca1; border-radius: 4px; flex: 0 0 auto; }
          .nm { display: block; font-size: 14px; font-weight: 500; line-height: 1.25; }
          .sub { display: block; font-size: 11.5px; color: #6d7075; margin-top: 2px; }
          .qty { margin-left: auto; font-size: 24px; font-weight: 500; letter-spacing: -.01em; min-width: 44px; text-align: right; font-variant-numeric: tabular-nums; }

          .labels { break-before: page; page-break-before: always; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
          .tote { border: 1px dashed #c9cacd; border-radius: 14px; padding: 12px 14px; display: flex; gap: 12px; align-items: center;
                  break-inside: avoid; page-break-inside: avoid; min-height: 1.5in; }
          .tote .n { font-size: 44px; font-weight: 300; line-height: 1; letter-spacing: -.03em; min-width: 64px; text-align: center; font-variant-numeric: tabular-nums; }
          .tote .meta { font-size: 12px; line-height: 1.5; }
          .tote .meta b { display: block; font-size: 14px; font-weight: 600; }
          .tote .meta span { color: #6d7075; }
          .tote img { width: 54px; height: 54px; margin-left: auto; }
          .dead { background: #fdecea; border-color: #f2c3be; }
          .dead .n { color: #b42318; }
          .dead .gone { color: #b42318; font-weight: 600; }

          .foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid #ececee; font-size: 10.5px; color: #6d7075; display: flex; justify-content: space-between; }
        `}</style>
      </head>
      <body>
        <div className="sheet">
          <div className="bar">
            <button type="button" id="printBtn">Print / save as PDF</button>
            <a href={`/print/slips/${tenantId}/${waveId}?k=${encodeURIComponent(String(k || ''))}&x=${encodeURIComponent(String(x || ''))}`}>Packing slips for this wave</a>
          </div>

          <div className="head">
            {logoUrl ? <img className="logo" src={logoUrl} alt="" /> : null}
            <div>
              <h1>{wave.name || 'Wave'}</h1>
              <p>
                {shopName} · built {when(wave.createdAt)} · cutoff {when(wave.cutoffAt)}
                {wave.createdBy ? ` · ${wave.createdBy}` : ''}
              </p>
            </div>
            <div className="totals">
              <b>{units}</b>
              units · {rows.length} products · {liveTotes} totes · {groups.length} stops
            </div>
          </div>

          {groups.map((g) => (
            <section key={g.location}>
              <p className="loc">{g.location}</p>
              {g.rows.map((r) => (
                <div className="row" key={r.name + r.location}>
                  <span className="box" />
                  <span>
                    <span className="nm">{r.name}</span>
                    <span className="sub">
                      totes {r.totes.join(', ')}{r.sku ? ` · ${r.sku}` : ''}
                    </span>
                  </span>
                  <span className="qty">{r.qty}</span>
                </div>
              ))}
            </section>
          ))}

          {rows.length === 0 && (
            <p style={{ fontSize: 13, color: '#6d7075', marginTop: 20 }}>
              Every order in this wave is cancelled or already picked — nothing to walk.
            </p>
          )}

          <div className="foot">
            <span>{shopName}</span>
            <span>Tote 1 has waited longest · scan each item again at the bench</span>
          </div>

          <div className="labels">
            <div className="head">
              <div>
                <h1>Tote <b style={{ fontWeight: 600 }}>labels</b></h1>
                <p>Cut and clip to each bin. Scan the code at the bench to open the order.</p>
              </div>
              <div className="totals"><b>{totes.length}</b>labels</div>
            </div>
            <div className="grid">
              {totes.map((t) => (
                <div className={`tote${t.cancelled ? ' dead' : ''}`} key={t.tote}>
                  <span className="n">{t.tote}</span>
                  <span className="meta">
                    <b>#{String(t.orderNumber).padStart(4, '0')}</b>
                    <span>{t.customerName}</span>
                    <br />
                    <span>{t.itemCount} item{t.itemCount === 1 ? '' : 's'} · {t.method}</span>
                    {t.cancelled ? <><br /><span className="gone">Cancelled — don’t pack it</span></> : null}
                  </span>
                  <img src={t.qr} alt={`Order ${t.orderNumber} code`} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <script
          dangerouslySetInnerHTML={{
            __html: `document.getElementById('printBtn').addEventListener('click', function(){ window.print(); });`,
          }}
        />
      </body>
    </html>
  );
}
