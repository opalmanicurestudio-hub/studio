'use client';
// /shop/[tenantId]/offer/[offerId] — a kit or bundle, a build-your-own box, or a shoppable look, on its own page
// (components/shop/offers has the views; lib/retail-offers the rules). Data comes from the shop's catalog, which only
// sends offers whose products are all on sale online right now.
import * as React from 'react';
import Link from 'next/link';
import { ShopHeader } from '@/components/shop/ShopChrome';
import { useParams } from 'next/navigation';
import { Loader } from 'lucide-react';
import { readCart, readWholesaleCode } from '@/lib/shop-cart';
import { BoxView, LookView, SetView, type ShopOffer } from '@/components/shop/offers';

export default function OfferPage() {
  const params = useParams<{ tenantId: string; offerId: string }>();
  const tenantId = String(params?.tenantId || '');
  const offerId = String(params?.offerId || '');
  const [data, setData] = React.useState<{ shop: any; products: any[]; offers: ShopOffer[] } | null>(null);
  const [err, setErr] = React.useState('');
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    if (!tenantId) return;
    setCount(Object.values(readCart(tenantId)).reduce((a, b) => a + b, 0));
    // A wholesale buyer's prices don't take bundle savings: the catalog sends them none, and this page says so.
    const ws = readWholesaleCode(tenantId);
    fetch(`/api/retail/catalog?tenantId=${encodeURIComponent(tenantId)}${ws ? `&wholesaleCode=${encodeURIComponent(ws)}` : ''}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error || 'This shop couldn’t be loaded.'); return j; })
      .then((j) => setData({ shop: j.shop, products: j.products || [], offers: j.offers || [] }))
      .catch((e) => setErr(e?.message || 'This shop couldn’t be loaded.'));
  }, [tenantId]);

  const offer = data?.offers.find((o) => o.id === offerId) || null;
  const byId = React.useMemo(() => new Map((data?.products || []).map((p: any) => [String(p.id), p])), [data]);
  const back = `/shop/${tenantId}`;

  return (
    <div className="min-h-dvh" style={{ background: 'var(--shop-surface)', color: 'var(--shop-ink)' }}>
      <ShopHeader active="offer" />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-6">
        {!data && !err && <div className="grid place-items-center py-24"><Loader className="h-7 w-7 animate-spin opacity-40" aria-label="Loading" /></div>}
        {err && <p className="py-24 text-center text-[15px] text-neutral-500">{err}</p>}
        {data && !offer && (
          <div className="py-24 text-center">
            <p className="text-[20px] font-light">{data.shop?.wholesaleUnlocked ? 'Bundles aren’t part of wholesale pricing.' : 'This isn’t available right now.'}</p>
            <p className="mt-1 text-[15px] text-neutral-500">{data.shop?.wholesaleUnlocked ? 'Each product can still be ordered at your wholesale price.' : 'One of its products may have sold out. Everything else is still in the shop.'}</p>
            <Link href={back} className="mt-5 inline-flex h-12 items-center rounded-full bg-neutral-900 px-6 text-[15px] font-semibold text-white">Back to the shop</Link>
          </div>)}
        {offer && (
          <>
            <Link href={back} className="inline-flex min-h-[44px] items-center text-[13px] text-neutral-500 underline underline-offset-4">Back to the shop</Link>
            <p className="m-0 mt-5 text-[12px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{offer.kind === 'box' ? 'Build your own' : offer.kind === 'look' ? 'Shop the look' : offer.kit ? 'Kit' : 'Bundle'}</p>
            <h1 className="m-0 mt-1 text-[clamp(30px,5vw,44px)] font-light leading-tight tracking-[-0.03em]">{offer.name}</h1>
            {offer.blurb && <p className="m-0 mt-2 max-w-2xl whitespace-pre-line text-[16px] leading-relaxed text-neutral-600">{offer.blurb}</p>}
            <div className="mt-7">
              {offer.kind === 'set' && <SetView tenantId={tenantId} offer={offer} byId={byId} offers={data?.offers || []} onAdded={setCount} />}
              {offer.kind === 'box' && <BoxView tenantId={tenantId} offer={offer} byId={byId} offers={data?.offers || []} onAdded={setCount} />}
              {offer.kind === 'look' && <LookView tenantId={tenantId} offer={offer} byId={byId} offers={data?.offers || []} onAdded={setCount} />}
              {offer.kind === 'together' && <p className="text-[15px] text-neutral-500">These picks show on <Link className="underline" href={`/shop/${tenantId}/product/${offer.anchorId}`}>the product’s page</Link>.</p>}
            </div>
          </>)}
      </main>
    </div>);
}
