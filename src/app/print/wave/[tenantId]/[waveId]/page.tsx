import QRCode from 'qrcode';

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
  params,
}: {
  params: Promise<{ tenantId: string; waveId: string }>;
}) {
  const { tenantId, waveId } = await params;
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
    const dead = ['cancelled', 'refunded'].includes(String(order.stage));
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
    const cancelled = order ? ['cancelled', 'refunded'].includes(String(order.stage)) : false;
    return {
      tote: w.tote,
      orderNumber: w.orderNumber,
      customerName: w.customerName,
      method: String(w.method || 'pickup').replace('_', ' '),
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
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <style>{`
          @page { size: letter portrait; margin: 0.45in; }
          * { box-sizing: border-box; }
          body {
            margin: 0; background: #fff; color: #16171a;
            font-family: "Plus Jakarta Sans", system-ui, sans-serif; font-weight: 400;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          .sheet { max-width: 7.6in; margin: 0 auto; padding: 0 0 24px; }

          .bar { display: flex; gap: 8px; padding: 10px 0 14px; }
          .bar button { font-family: inherit; font-size: 12px; font-weight: 600; padding: 9px 14px; border-radius: 10px; border: 1px solid #16171a; background: #16171a; color: #fff; cursor: pointer; }
          @media print { .bar { display: none; } }

          .head { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #16171a; padding-bottom: 12px; }
          .head img.logo { width: 46px; height: 46px; object-fit: cover; border-radius: 10px; border: 1px solid #e6e6e8; }
          .head h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -.02em; }
          .head p { margin: 2px 0 0; font-size: 11px; color: #6d7075; letter-spacing: .04em; }
          .head .totals { margin-left: auto; text-align: right; font-size: 11px; color: #6d7075; }
          .head .totals b { display: block; font-size: 20px; color: #16171a; }

          .loc { margin: 20px 0 6px; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
                 border-bottom: 1px solid #e6e6e8; padding-bottom: 5px;
                 break-after: avoid; page-break-after: avoid; }

          .row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid #f1f1f2;
                 break-inside: avoid; page-break-inside: avoid; }
          .box { width: 7mm; height: 7mm; border: 1.5px solid #16171a; border-radius: 3px; flex: 0 0 auto; }
          .nm { font-size: 14px; font-weight: 600; line-height: 1.25; }
          .sub { font-size: 11px; color: #6d7075; margin-top: 2px; }
          .qty { margin-left: auto; font-size: 26px; font-weight: 700; letter-spacing: -.02em; min-width: 44px; text-align: right; }

          .labels { break-before: page; page-break-before: always; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
          .tote { border: 1.5px dashed #b8b8bb; border-radius: 10px; padding: 12px; display: flex; gap: 12px; align-items: center;
                  break-inside: avoid; page-break-inside: avoid; min-height: 1.5in; }
          .tote .n { font-size: 46px; font-weight: 700; line-height: 1; letter-spacing: -.03em; min-width: 64px; text-align: center; }
          .tote .meta { font-size: 12px; }
          .tote .meta b { display: block; font-size: 14px; font-weight: 600; }
          .tote .meta span { color: #6d7075; }
          .tote img { width: 54px; height: 54px; margin-left: auto; }
          .dead { background: #fdf2f2; border-color: #d97070; }
          .dead .n { color: #b23c3c; }

          .foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e6e6e8; font-size: 10px; color: #6d7075; display: flex; justify-content: space-between; }
        `}</style>
      </head>
      <body>
        <div className="sheet">
          <div className="bar">
            <button type="button" id="printBtn">Print / save as PDF</button>
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
            <span>tote 1 waited longest · scan each item again at the bench</span>
          </div>

          <div className="labels">
            <div className="head">
              <div>
                <h1>Tote labels</h1>
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
                    {t.cancelled ? <><br /><span style={{ color: '#b23c3c', fontWeight: 700 }}>CANCELLED — do not pack</span></> : null}
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
