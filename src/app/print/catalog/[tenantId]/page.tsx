import QRCode from 'qrcode';

import { collectImages } from '@/lib/product-public';
import { PRINT_FONT_HREF, PRINT_FONT_STACK } from '@/lib/print-style';
import { checkPrintKey } from '@/lib/print-key';
import { getRetailSecrets } from '@/lib/retail-secrets';
import { discountedCents, resolveWholesaleAccess } from '@/lib/retail-wholesale';
import { listingPriceCents } from '@/lib/retail-orders';
import { choiceFor, listingsOf, variantIdsOf, variantPriceCents } from '@/lib/variants';

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
//   tier=wholesale  wholesale pricing + minimum order quantities, for a wholesale account (code=) or the team (k, x:
//                   a print key from the app); anyone else gets the retail catalog
//   cat=Name        limit to one category
//   qr=0            drop the QR codes (tighter, more editorial)
//
// A product that comes in variants is one card, named once, with its variants and the price each sells for (lib/
// variants): "From" when they differ.
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
  searchParams: Promise<{ tier?: string; cat?: string; qr?: string; code?: string; k?: string; x?: string }>;
}) {
  const { tenantId } = await params;
  const { tier, cat, qr, code, k, x } = await searchParams;
  const showQr = String(qr ?? '1') !== '0';

  const db = getAdminDb();
  const [tenantSnap, invSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'retail').limit(500).get(),
  ]);

  const tenant = tenantSnap.exists ? (tenantSnap.data() as any) : {};
  // Wholesale prices only for a wholesale account's code, or the team's print key.
  const staffKey = checkPrintKey(tenantId, 'catalog', k, x);
  let wsDiscount = 0; let codeOk = false;
  if (String(tier || '') === 'wholesale' && !staffKey && String(code || '').trim()) {
    const rs = tenant.retailSettings || {};
    const a = await resolveWholesaleAccess(db, tenantId, { ...rs, wholesaleAccessCode: (await getRetailSecrets(db, tenantId)).wholesaleAccessCode }, String(code).trim()).catch(() => null);
    codeOk = !!a?.unlocked; wsDiscount = Number(a?.account?.extraDiscountPercent) || 0;
  }
  const wholesale = String(tier || '') === 'wholesale' && (staffKey || codeOk);
  const keep = staffKey ? `&k=${encodeURIComponent(String(k))}&x=${encodeURIComponent(String(x))}` : codeOk ? `&code=${encodeURIComponent(String(code).trim())}` : '';
  const canWholesale = staffKey || codeOk;
  const shopName = String(tenant.businessName || tenant.name || 'Catalog');
  const logoUrl = String(tenant.logoUrl || '');

  const all = invSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const byId = new Map<string, any>(all.map((i: any) => [String(i.id), i]));
  const listings = listingsOf(all);
  // Listings only: a variant is printed inside its listing, never as a product of its own.
  const rows = all
    .filter((i: any) => i.showOnline !== false && i.status !== 'archived' && !listings.has(String(i.id)))
    .filter((i: any) => Number(i.msrp) > 0)
    .filter((i: any) => (cat ? String(i.category || 'General') === cat : true));
  const tierOf = wholesale ? 'wholesale' : 'retail';
  const priceOf = (cents: number) => (wholesale ? discountedCents(cents, wsDiscount) : cents) / 100;

  const items = await Promise.all(
    rows.map(async (i: any) => {
      // Its variants, each priced by the rule (its own price when it has one, otherwise the listing's).
      const vs = variantIdsOf(i).map((id) => byId.get(id)).filter((v: any) => v && v.status !== 'archived' && (!v.parentId || String(v.parentId) === String(i.id)));
      const prices = vs.map((v: any) => priceOf(variantPriceCents(v, i, tierOf)));
      const low = prices.length ? Math.min(...prices) : priceOf(listingPriceCents(i, tierOf));
      return {
        id: i.id,
        name: String(i.name || 'Item'),
        sku: String(i.sku || ''),
        category: String(i.category || 'General'),
        size: String(i.size ? `${i.size}${i.unit ? ` ${i.unit}` : ''}` : ''),
        variants: vs.map((v: any) => String(choiceFor(i, v.id)?.choice.label || v.name || '')).filter(Boolean).join(' \u00b7 '),
        description: String(i.onlineDescription || i.description || '').slice(0, 130),
        // Photos live under imageUrls (shop editor) OR imageUrl (inventory
        // forms) — the catalog only read the first, so anything photographed
        // in Inventory printed as an empty square.
        image: collectImages(i)[0] || '',
        price: low,
        from: new Set(prices).size > 1,
        minQty: wholesale && i.wholesaleMinQty ? Number(i.wholesaleMinQty) : 0,
        stock: Number(i.totalStock) || 0,
        qr: showQr
          ? await QRCode.toDataURL(`clarityflow://product/${i.id}`, { width: 120, margin: 0 })
          : '',
      };
    })
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
        <link href={PRINT_FONT_HREF} rel="stylesheet" />
        <style>{`
          @page { size: letter portrait; margin: 0.5in; }
          * { box-sizing: border-box; }
          body {
            margin: 0; background: #fff; color: #16171a;
            font-family: ${PRINT_FONT_STACK}; font-weight: 400; line-height: 1.45;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          p { margin: 0; }
          .sheet { max-width: 7.5in; margin: 0 auto; padding: 0 0 24px; }

          .cover { display: flex; align-items: center; gap: 14px; padding: 4px 0 16px; border-bottom: 1px solid #ececee; }
          .cover img { width: 54px; height: 54px; object-fit: cover; border-radius: 12px; border: 1px solid #ececee; }
          .cover h1 { margin: 0; font-size: 26px; font-weight: 300; letter-spacing: -.02em; line-height: 1.15; }
          .cover .kind { margin: 4px 0 0; font-size: 12px; color: #6d7075; }
          .cover .meta { margin-left: auto; text-align: right; font-size: 11px; line-height: 1.6; color: #6d7075; font-variant-numeric: tabular-nums; }

          .cat { margin: 22px 0 10px; font-size: 13px; font-weight: 600; color: #16171a; border-bottom: 1px solid #ececee; padding-bottom: 6px; }

          .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
          .item { border: 1px solid #ececee; border-radius: 14px; padding: 10px; break-inside: avoid; page-break-inside: avoid; }
          .ph { width: 100%; aspect-ratio: 1/1; border-radius: 10px; object-fit: cover; background: #f5f5f7; display: block; }
          .ph-empty { width: 100%; aspect-ratio: 1/1; border-radius: 10px; background: #f5f5f7; }
          .nm { margin: 9px 0 0; font-size: 13px; font-weight: 500; letter-spacing: -.01em; line-height: 1.3; }
          .ds { margin: 3px 0 0; font-size: 10px; color: #6d7075; line-height: 1.45; }
          .row { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; margin-top: 9px; }
          .pr { font-size: 16px; font-weight: 400; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
          .sk { margin-top: 1px; font-size: 9.5px; color: #6d7075; font-variant-numeric: tabular-nums; }
          .moq { display: inline-block; margin-top: 5px; padding: 2px 8px; border-radius: 999px; background: #f5f5f7; font-size: 9.5px; font-weight: 500; color: #45474c; font-variant-numeric: tabular-nums; }
          .qr { width: 46px; height: 46px; }

          .foot { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ececee; font-size: 10.5px; color: #6d7075; display: flex; justify-content: space-between; gap: 12px; }

          .bar { position: sticky; top: 0; background: #fff; padding: 10px 0 14px; display: flex; gap: 8px; }
          .bar button, .bar a { font-family: inherit; font-size: 12px; font-weight: 600; padding: 9px 14px; border-radius: 10px; border: 1px solid #16171a; background: #16171a; color: #fff; cursor: pointer; text-decoration: none; }
          .bar a.alt { background: #fff; color: #16171a; }
          .cat .count { float: right; color: #6d7075; font-size: 11px; font-weight: 400; font-variant-numeric: tabular-nums; }
          .terms { margin-top: 18px; padding: 12px 14px; background: #f5f5f7; border-radius: 12px; font-size: 10.5px; line-height: 1.55; color: #45474c; }

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
            {canWholesale && (
              <a className="alt" href={`?tier=${wholesale ? 'retail' : 'wholesale'}${keep}${cat ? `&cat=${encodeURIComponent(cat)}` : ''}`}>
                {wholesale ? 'Switch to retail catalog' : 'Switch to wholesale line sheet'}
              </a>
            )}
            <a className="alt" href={`?tier=${wholesale ? 'wholesale' : 'retail'}${wholesale ? keep : ''}&qr=${showQr ? '0' : '1'}${cat ? `&cat=${encodeURIComponent(cat)}` : ''}`}>
              {showQr ? 'Hide QR codes' : 'Show QR codes'}
            </a>
          </div>

          <div className="cover">
            {logoUrl ? <img src={logoUrl} alt="" /> : null}
            <div>
              <h1>{shopName}</h1>
              <p className="kind">{wholesale ? 'Wholesale line sheet' : 'Product catalog'}</p>
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
                {c}
                <span className="count">{items.filter((i) => i.category === c).length}</span>
              </p>
              <div className="grid">
                {items.filter((i) => i.category === c).map((i) => (
                  <div className="item" key={i.id}>
                    {i.image ? <img className="ph" src={i.image} alt={i.name} loading="lazy" decoding="async" /> : <div className="ph-empty" />}
                    <p className="nm">{i.name}</p>
                    {i.variants ? <p className="ds">{i.variants}</p> : null}
                    {i.size ? <p className="ds">{i.size}</p> : null}
                    {i.description ? <p className="ds">{i.description}</p> : null}
                    <div className="row">
                      <div>
                        <p className="pr">{i.from ? `From ${money(i.price)}` : money(i.price)}</p>
                        {i.sku ? <p className="sk">{i.sku}</p> : null}
                        {i.minQty > 0 ? <span className="moq">Minimum {i.minQty}</span> : null}
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
              To order, scan an item&rsquo;s code or send this sheet back with quantities marked.
              Prices are wholesale and don&rsquo;t include shipping or tax. Each item shows its minimum.
            </p>
          ) : null}

          <div className="foot">
            <span>{shopName}</span>
            <span>{wholesale ? 'Prices are wholesale · minimums apply' : 'Prices in USD · subject to change'}</span>
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
