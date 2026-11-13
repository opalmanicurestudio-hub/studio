import QRCode from 'qrcode';
import { headers } from 'next/headers';
import { PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';
import { getAdminDb } from '@/lib/firebase-admin';
import { popupsOf } from '@/lib/popup';
import { popupProducts } from '@/lib/popup-server';
import { moduleEnabled } from '@/lib/modules';

// ─── /print/popup-sign/[tenantId]/[popupId] ───────────────────────────────────
// THE SIGN FOR A POP-UP'S TABLE (lib/popup): "Skip the line", a code that opens ordering from the line on the
// customer's phone (shop/[tenantId]/popup/[popupId]), the three steps, and a few of the table's products with their
// prices, on one letter page to print and stand on the table. The code carries no order and no customer: a photo of
// the sign posted online shows nothing but the pop-up's own page, which takes orders only while the team has it on.

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const dollars = (c: number) => { const d = Math.max(0, c) / 100; return Number.isInteger(d) ? String(d) : d.toFixed(2); };

export default async function PopupSignPage({ params }: { params: Promise<{ tenantId: string; popupId: string }> }) {
  const { tenantId, popupId } = await params;
  if (!ID.test(tenantId) || !ID.test(popupId)) return <p>That pop-up isn’t here.</p>;
  const db = getAdminDb();
  const [ts, ps] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), popupsOf(db, tenantId).doc(popupId).get()]);
  if (!ts.exists || !ps.exists) return <p>That pop-up isn’t here.</p>;
  const tenant: any = ts.data() || {}; const p: any = ps.data() || {};
  if (p.marker || !p.day || !moduleEnabled(tenant, 'pickup')) return <p>That pop-up isn’t here.</p>;
  const shopName = String(tenant.businessName || tenant.name || '').trim();
  const h = await headers();
  const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || `${h.get('x-forwarded-proto') || 'https'}://${h.get('host') || ''}`;
  const url = `${origin}/shop/${encodeURIComponent(tenantId)}/popup/${encodeURIComponent(popupId)}`;
  const qr = await QRCode.toDataURL(url, { width: 700, margin: 0 });
  // A few of what's on the table, in the order it was set up, to show what's there before the phone comes out.
  const products = await popupProducts(db, tenantId, tenant, (p.items || []).slice(0, 12).map((x: any) => String(x.id)), { numbers: false });
  const shown = (p.items || []).map((x: any) => products.get(String(x.id))).filter(Boolean).slice(0, 3) as any[];
  return (
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href={PRINT_FONT_HREF} rel="stylesheet" />
        <title>Skip the line sign</title>
        <style>{`
          @page { size: letter portrait; margin: 0.35in; }
          * { box-sizing: border-box; }
          body { font-family: ${PRINT_FONT_STACK}; font-weight: 400; color: #16171a; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .sign { width: 7.8in; min-height: 10.3in; border: 1px solid #ececee; border-radius: 28px; padding: 0.5in 0.5in 0.4in; display: flex; flex-direction: column; }
          .shop { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
          .where { margin-top: 2px; font-size: 16px; color: #6d7075; }
          h1 { margin: 0.3in 0 0; font-size: 84px; line-height: 0.95; font-weight: 300; letter-spacing: -0.035em; }
          .lead { margin: 14px 0 0; font-size: 22px; line-height: 1.35; color: #45474c; max-width: 5.8in; }
          .mid { margin-top: 0.35in; display: flex; gap: 0.4in; align-items: center; }
          .qrwrap { padding: 16px; border: 1px solid #ececee; border-radius: 24px; flex: none; }
          .qrwrap img { width: 2.9in; height: 2.9in; display: block; }
          .cam { margin-top: 8px; font-size: 14px; color: #6d7075; text-align: center; }
          ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 18px; }
          li { display: flex; gap: 14px; align-items: flex-start; font-size: 20px; line-height: 1.3; }
          .n { flex: none; width: 34px; height: 34px; border-radius: 999px; background: #16171a; color: #fff; display: grid; place-items: center; font-size: 16px; font-weight: 600; }
          .menu { margin-top: 0.4in; border-top: 1px solid #ececee; }
          .row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #ececee; font-size: 20px; }
          .row span:last-child { font-variant-numeric: tabular-nums; }
          .foot { margin-top: auto; padding-top: 0.25in; font-size: 16px; color: #6d7075; }
        `}</style>
      </head>
      <body>
        <div className="sign">
          <div className="shop">{shopName}</div>
          <div className="where">{[p.name, p.place].filter(Boolean).join(', ')}</div>
          <h1>Skip the line.</h1>
          <p className="lead">Order and pay on your phone while you wait. We’ll bag it and call your number.</p>
          <div className="mid">
            <div><div className="qrwrap"><img src={qr} alt="Code to order from the line" /></div><div className="cam">Point your camera here</div></div>
            <ol>
              <li><span className="n">1</span><span>Scan and pick what you want.</span></li>
              <li><span className="n">2</span><span>Pay on your phone. You’ll get a number.</span></li>
              <li><span className="n">3</span><span>Come up when we call it.</span></li>
            </ol>
          </div>
          {shown.length > 0 && <div className="menu">{shown.map((x) => <div className="row" key={x.id}><span>{x.name}</span><span>{dollars(x.priceCents)}</span></div>)}</div>}
          <div className="foot">Rather order in person? Come to the table.</div>
        </div>
      </body>
    </html>);
}
