/**
 * /print/loss-recovery/[tenantId]?month=YYYY-MM — the Loss & Recovery
 * REGISTER as a letter document: every inventory exception for the month
 * with its reason, responsible party, the full triple (landed / retail /
 * margin), what was recovered, the computed net, recovery status, and the
 * accounting hand-off state — plus totals on both sides. This is the sheet
 * the accountant receives; the footer states the classification rule
 * plainly: landed cost is the deduction basis, retail and margin are
 * operational analytics, recoveries are separate income lines. Server-
 * rendered on the Admin SDK like every print surface that works on iOS.
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

const REASON_LABELS: Record<string, string> = {
  return_opened: 'Return — opened', return_damaged: 'Return — damaged', return_contaminated: 'Return — disposed',
  refused_delivery: 'Refused delivery', reported_missing: 'Reported missing', reported_damaged: 'Reported damaged',
  reported_leaking: 'Reported leaking', wrong_quantity: 'Wrong quantity', refund_without_return: 'Refund w/o return',
  carrier_lost: 'Carrier lost', carrier_damaged: 'Carrier damaged', carrier_destroyed: 'Carrier destroyed',
  carrier_returned: 'Carrier returned', delivery_exception: 'Delivery exception', stolen_after_delivery: 'Stolen after delivery',
  tracking_discrepancy: 'Tracking discrepancy', supplier_defect: 'Supplier defect', supplier_shortage: 'Supplier shortage',
  supplier_wrong_product: 'Supplier wrong product', inbound_damage: 'Inbound damage', manufacturing_defect: 'Mfg defect',
  warehouse_damage: 'Warehouse damage', picking_damage: 'Picking damage', packing_damage: 'Packing damage',
  employee_damage: 'Employee damage', count_discrepancy: 'Count discrepancy', missing_inventory: 'Missing',
  theft_shrinkage: 'Theft/shrinkage', sample_tester: 'Sample/tester', quality_testing: 'QC testing',
  internal_use: 'Internal use', promo_giveaway: 'Promo giveaway', expired: 'Expired', obsolete: 'Obsolete',
  recall: 'Recall', packaging_failure: 'Packaging failure', environmental: 'Environmental', wrong_item_shipped: 'Wrong item shipped',
};

export default async function PrintLossRecoveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { tenantId } = await params;
  const { month } = await searchParams;
  const key = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const [y, m] = key.split('-').map(Number);
  const start = new Date(y, m - 1, 1).toISOString();
  const end = new Date(y, m, 1).toISOString();
  const label = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const db = getAdminDb();
  const [tenantSnap, snap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection(`tenants/${tenantId}/inventoryExceptions`)
      .where('at', '>=', start).where('at', '<', end).get(),
  ]);
  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  const shopName = String(tenant.businessName || tenant.name || 'Shop');

  const rows = snap.docs
    .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .sort((a: any, b: any) => String(a.at || '').localeCompare(String(b.at || '')));

  const net = (r: any) => Math.max(0, (Number(r.landedCostCents) || 0) - (Number(r.recovery?.recoveredCents) || 0));
  const totals = rows.reduce(
    (a: any, r: any) => ({
      landed: a.landed + (Number(r.landedCostCents) || 0),
      retail: a.retail + (Number(r.retailCents) || 0),
      margin: a.margin + (Number(r.marginCents) || 0),
      recovered: a.recovered + (Number(r.recovery?.recoveredCents) || 0),
      net: a.net + net(r),
    }),
    { landed: 0, retail: 0, margin: 0, recovered: 0, net: 0 }
  );
  const uncosted = rows.filter((r: any) => r.costed === false).length;
  const dupFlags = rows.filter((r: any) => Array.isArray(r.flags) && r.flags.includes('possible_duplicate')).length;

  const when = (iso: any) => {
    const d = new Date(String(iso || ''));
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const generatedAt = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${shopName} — loss & recovery register ${label}`}</title>
        <style>{`
          @page { size: letter landscape; margin: 0.5in; }
          * { box-sizing: border-box; }
          body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; font-size: 10px; line-height: 1.4; }
          h1 { font-size: 17px; margin: 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th { text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; padding: 4px 5px; border-bottom: 2px solid #0f172a; }
          td { padding: 4px 5px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
          .num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
          .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0f172a; padding-bottom: 9px; }
          .tot { display: flex; gap: 22px; margin-top: 10px; flex-wrap: wrap; }
          .tot .k { font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }
          .tot .v { font-weight: 800; font-size: 13px; font-variant-numeric: tabular-nums; }
          .foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 8.5px; color: #64748b; line-height: 1.5; }
          .flag { color: #c2410c; font-weight: 700; }
          tr { break-inside: avoid; }
          tfoot td { border-top: 2px solid #0f172a; border-bottom: none; font-weight: 800; }
        `}</style>
      </head>
      <body>
        <div className="head">
          <div>
            <h1>{shopName} — Loss &amp; Recovery register</h1>
            <p style={{ margin: '3px 0 0', color: '#64748b' }}>{label} · {rows.length} exception{rows.length === 1 ? '' : 's'}{uncosted ? ` · ${uncosted} missing product cost` : ''}{dupFlags ? ` · ${dupFlags} flagged possible duplicate` : ''}</p>
          </div>
        </div>

        <div className="tot">
          <div><div className="k">Landed cost lost</div><div className="v">{fmt(totals.landed)}</div></div>
          <div><div className="k">Recovered</div><div className="v">{fmt(totals.recovered)}</div></div>
          <div><div className="k">Net unrecovered</div><div className="v">{fmt(totals.net)}</div></div>
          <div><div className="k">Retail affected (analytics)</div><div className="v">{fmt(totals.retail)}</div></div>
          <div><div className="k">Margin affected (analytics)</div><div className="v">{fmt(totals.margin)}</div></div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th><th>Item</th><th>Reason</th><th>Resp.</th><th>Order</th>
              <th className="num">Qty</th><th className="num">Landed</th><th className="num">Retail</th>
              <th className="num">Margin</th><th className="num">Recovered</th><th className="num">Net</th>
              <th>Recovery</th><th>Accounting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                <td>{r.qty > 1 ? `${r.qty} × ` : ''}{r.name}{Array.isArray(r.flags) && r.flags.includes('possible_duplicate') ? <span className="flag"> ⚑ dup?</span> : null}</td>
                <td>{REASON_LABELS[r.reason] || r.reason}</td>
                <td>{r.responsibleParty}</td>
                <td>{r.orderNumber != null ? `#${String(r.orderNumber).padStart(4, '0')}` : '—'}</td>
                <td className="num">{r.qty}</td>
                <td className="num">{r.costed === false ? '—' : fmt(r.landedCostCents)}</td>
                <td className="num">{fmt(r.retailCents)}</td>
                <td className="num">{fmt(r.marginCents)}</td>
                <td className="num">{(Number(r.recovery?.recoveredCents) || 0) > 0 ? fmt(r.recovery.recoveredCents) : '—'}</td>
                <td className="num">{r.costed === false ? '—' : fmt(net(r))}</td>
                <td>{r.recovery?.status && r.recovery.status !== 'none' ? String(r.recovery.status).replace('_', ' ') : '—'}</td>
                <td>{r.accountingStatus === 'handed_off' ? 'Handed off' : r.accountingStatus === 'ledgered' ? 'On the books' : 'Recorded'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={13} style={{ color: '#64748b' }}>No inventory exceptions this month.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={6}>Totals</td>
                <td className="num">{fmt(totals.landed)}</td>
                <td className="num">{fmt(totals.retail)}</td>
                <td className="num">{fmt(totals.margin)}</td>
                <td className="num">{fmt(totals.recovered)}</td>
                <td className="num">{fmt(totals.net)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>

        <div className="foot">
          <div>Classification rule: LANDED COST is the deduction basis and appears as Spoilage expense lines in the money ledger, linked per row. RETAIL and MARGIN are operational analytics only — never tax figures. RECOVERIES are separate Loss-recovery income lines that offset without erasing; final journal treatment is the accountant&apos;s call per the company&apos;s method. ⚑ = possible duplicate recognition, review before booking.</div>
          <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
            <span>Generated {generatedAt} · ClarityFlow Loss &amp; Recovery register</span>
            <span>{shopName}</span>
          </div>
        </div>
      </body>
    </html>
  );
}
