import QRCode from 'qrcode';

import { collectImages } from '@/lib/product-public';

// ─── /print/catalog/[tenantId]?tier=retail|wholesale&cat=Oils&qr=1 ────────────
// The branded catalog — a lookbook at retail tier, a line sheet at wholesale.
//
// Built for the two moments a paper catalog actually gets used: a client
// flipping through at the front desk, and a stockist reordering. So every
// card carries the things a reorder needs — image, name, SKU, size, price,
// case minimum — plus a QR that opens that product's page, which means a
// paper catalog can be reordered from without typing anything.
//
// Query options:
//   tier=wholesale  wholesale pricing + minimum order quantities
//   cat=Name        limit to one category
//   qr=0            drop the QR codes (tighter, more editorial)
//
// Print: letter portrait, categories start on their own row, headers repeat.

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

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export default async function PrintCatalogPage({
  params, searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ tier?: string; cat?: string; qr?: string }>;
}) {
  const { tenantId } = await params;
  const { tier, cat, qr } = await searchParams;
  const wholesale = String(tier || '') === 'wholesale';
  const showQr = String(qr ?? '1') !== '0';

  const db = getAdminDb();
  const [tenantSnap, invSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'retail').limit(300).get(),
  ]);

  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  const shopName = String(tenant.businessName || tenant.name || 'Catalog');
  const logoUrl = String(tenant.logoUrl || '');

  const rows = invSnap.docs
    .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    .filter((i: any) => i.showOnline !== false && i.status !== 'archived')
    .filter((i: any) => (wholesale ? true : Number(i.msrp) > 0))
    .filter((i: any) => (cat ? String(i.category || 'General') === cat : true));

  const items = await Promise.all(
    rows.map(async (i: any) => ({
      id: i.id,
      name: String(i.name || 'Item'),
      sku: String(i.sku || ''),
      category: String(i.category || 'General'),
      size: String(i.size ? `${i.size}${i.unit ? ` ${i.unit}` : ''}` : ''),
      description: String(i.onlineDescription || i.description || '').slice(0, 130),
      // Photos live under imageUrls (shop editor) OR imageUrl (inventory
      // forms) — the catalog only read the first, so anything photographed
      // in Inventory printed as an empty square.
      image: collectImages(i)[0] || '',
      price: wholesale && i.wholesalePriceDollars != null ? Number(i.wholesalePriceDollars) : Number(i.msrp) || 0,
      minQty: wholesale && i.wholesaleMinQty ? Number(i.wholesaleMinQty) : 0,
      stock: Number(i.totalStock) || 0,
      qr: showQr
        ? await QRCode.toDataURL(`clarityflow://product/${i.id}`, { width: 120, margin: 0 })
        : '',
    }))
  );

  items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const categories = [...new Set(items.map((i) => i.category))];
  const printed = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const contact = [tenant.phone, tenant.email, tenant.website, tenant.address]
    .map((v: any) => String(v || '').trim())
    .filter(Boolean);

  if (items.length === 0) {
    return <p style={{ fontFamily: 'sans-serif', padding: 40 }}>No published products to print yet.</p>;
  }

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${shopName} — ${wholesale ? 'Line sheet' : 'Catalog'}`}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <style>{`
          @page { size: letter portrait; margin: 0.5in; }
          * { box-sizing: border-box; }
          body {
            margin: 0; background: #fff; color: #16171a;
            font-family: "Plus Jakarta Sans", system-ui, sans-serif; font-weight: 400;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          .sheet { max-width: 7.5in; margin: 0 auto; padding: 0 0 24px; }

          .cover { display: flex; align-items: center; gap: 14px; padding: 4px 0 16px; border-bottom: 1.5px solid #16171a; }
          .cover img { width: 54px; height: 54px; object-fit: cover; border-radius: 12px; border: 1px solid #e6e6e8; }
          .cover h1 { margin: 0; font-size: 25px; font-weight: 400; letter-spacing: -.03em; }
          .cover .kind { margin: 3px 0 0; font-family: "Plus Jakarta Sans", system-ui, sans-serif; font-variant-numeric: tabular-nums; font-size: 10px; letter-spacing: .12em; text-transform: lowercase; color: #6d7075; }
          .cover .meta { margin-left: auto; text-align: right; font-family: "Plus Jakarta Sans", system-ui, sans-serif; font-variant-numeric: tabular-nums; font-size: 10px; letter-spacing: .08em; color: #6d7075; }

          .cat { margin: 22px 0 10px; font-family: "Plus Jakarta Sans", system-ui, sans-serif; font-variant-numeric: tabular-nums; font-size: 11px; letter-spacing: .14em; text-transform: lowercase; color: #16171a; border-bottom: 1px solid #e6e6e8; padding-bottom: 6px; }

          .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
          .item { border: 1px solid #e6e6e8; border-radius: 14px; padding: 10px; break-inside: avoid; page-break-inside: avoid; }
          .ph { width: 100%; aspect-ratio: 1/1; border-radius: 10px; object-fit: cover; background: #f4f4f5; display: block; }
          .ph-empty { width: 100%; aspect-ratio: 1/1; border-radius: 10px; background: #f4f4f5; }
          .nm { margin: 8px 0 0; font-size: 13px; font-weight: 600; letter-spacing: -.01em; line-height: 1.25; }
          .ds { margin: 4px 0 0; font-size: 10px; color: #6d7075; line-height: 1.45; }
          .row { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; margin-top: 8px; }
          .pr { font-family: "Plus Jakarta Sans", system-ui, sans-serif; font-variant-numeric: tabular-nums; font-size: 15px; font-weight: 700; }
          .sk { font-family: "Plus Jakarta Sans", system-ui, sans-serif; font-variant-numeric: tabular-nums; font-size: 9px; letter-spacing: .06em; color: #6d7075; }
          .moq { display: inline-block; margin-top: 4px; padding: 2px 7px; border: 1px solid #e6e6e8; border-radius: 999px; font-family: "Plus Jakarta Sans", system-ui, sans-serif; font-variant-numeric: tabular-nums; font-size: 9px; color: #16171a; }
          .qr { width: 46px; height: 46px; }

          .foot { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e6e6e8; font-family: "Plus Jakarta Sans", system-ui, sans-serif; font-variant-numeric: tabular-nums; font-size: 9px; letter-spacing: .06em; color: #6d7075; display: flex; justify-content: space-between; }

          .bar { position: sticky; top: 0; background: #fff; padding: 10px 0 14px; display: flex; gap: 8px; }
          .bar button, .bar a { font-family: inherit; font-size: 12px; font-weight: 600; padding: 9px 14px; border-radius: 10px; border: 1px solid #16171a; background: #16171a; color: #fff; cursor: pointer; text-decoration: none; }
          .bar a.alt { background: #fff; color: #16171a; }
          .cat .count { float: right; color: #6d7075; font-size: 10px; }
          .terms { margin-top: 18px; padding: 10px 12px; border: 1px solid #e6e6e8; border-radius: 10px; font-size: 10px; line-height: 1.5; color: #16171a; }

          /* Screen on a phone: three across is unreadable, and the toolbar
             needs to wrap. Print keeps the three-up sheet either way. */
          @media screen and (max-width: 680px) {
            body { padding: 0 14px; }
            .grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
            .cover { flex-wrap: wrap; gap: 10px; }
            .cover h1 { font-size: 21px; }
            .cover .meta { margin-left: 0; width: 100%; text-align: left; }
            .bar { flex-wrap: wrap; }
            .bar button, .bar a { flex: 1 1 auto; text-align: center; }
            .nm { font-size: 12px; }
            .qr { width: 40px; height: 40px; }
          }
          @media screen and (max-width: 380px) {
            .grid { grid-template-columns: 1fr; }
          }

          @media print {
            .bar { display: none; }
            .grid { grid-template-columns: repeat(3, 1fr); }
            .cat { break-after: avoid; page-break-after: avoid; }
            .sheet { padding-bottom: 0; }
          }
        `}</style>
      </head>
      <body>
        <div className="sheet">
          <div className="bar">
            <button type="button" id="printBtn">Print / save as PDF</button>
            <a className="alt" href={`?tier=${wholesale ? 'retail' : 'wholesale'}${cat ? `&cat=${encodeURIComponent(cat)}` : ''}`}>
              {wholesale ? 'Switch to retail catalog' : 'Switch to wholesale line sheet'}
            </a>
            <a className="alt" href={`?tier=${wholesale ? 'wholesale' : 'retail'}&qr=${showQr ? '0' : '1'}${cat ? `&cat=${encodeURIComponent(cat)}` : ''}`}>
              {showQr ? 'Hide QR codes' : 'Show QR codes'}
            </a>
          </div>

          <div className="cover">
            {logoUrl ? <img src={logoUrl} alt="" /> : null}
            <div>
              <h1>{shopName}</h1>
              <p className="kind">{wholesale ? 'wholesale line sheet' : 'product catalog'}</p>
            </div>
            <div className="meta">
              {printed}
              <br />
              {items.length} products
              {contact.length > 0 ? <><br />{contact.join(' · ')}</> : null}
            </div>
          </div>

          {categories.map((c) => (
            <section key={c}>
              <p className="cat">
                {c.toLowerCase()}
                <span className="count">{items.filter((i) => i.category === c).length}</span>
              </p>
              <div className="grid">
                {items.filter((i) => i.category === c).map((i) => (
                  <div className="item" key={i.id}>
                    {i.image ? <img className="ph" src={i.image} alt={i.name} loading="lazy" decoding="async" /> : <div className="ph-empty" />}
                    <p className="nm">{i.name}</p>
                    {i.size ? <p className="ds">{i.size}</p> : null}
                    {i.description ? <p className="ds">{i.description}</p> : null}
                    <div className="row">
                      <div>
                        <p className="pr">{money(i.price)}</p>
                        {i.sku ? <p className="sk">{i.sku}</p> : null}
                        {i.minQty > 0 ? <span className="moq">min {i.minQty}</span> : null}
                      </div>
                      {i.qr ? <img className="qr" src={i.qr} alt={`Reorder code for ${i.name}`} /> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {wholesale ? (
            <p className="terms">
              to order: scan an item&rsquo;s code, or send this sheet back with quantities marked.
              prices are wholesale and exclude shipping and tax. minimums shown per item.
            </p>
          ) : null}

          <div className="foot">
            <span>{shopName}</span>
            <span>{wholesale ? 'prices are wholesale · minimums apply' : 'prices in usd · subject to change'}</span>
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
