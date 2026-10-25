'use client';

import { accessWords, digitalFaq, type PublicDigital } from '@/lib/digital-product';
import { RestockAlert } from '@/components/shop/RestockAlert';
import { Loader, Package } from 'lucide-react';
import Link from 'next/link';
import { ShopHeader, useShopSite } from '@/components/shop/ShopChrome';
import { ProductView } from '@/components/shop/product/ProductLayouts';
import { useParams } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { addToCart, cartKeyFor, readCart, readWholesaleCode, writeCart } from '@/lib/shop-cart';
import { BuyTogether, type ShopOffer } from '@/components/shop/offers';
import { firstChoices, shopLine } from '@/lib/variants';
import {
  busyLineFor, countdownFor, dayLabel, leadSentence, minutesLabel, normalizeSchedule, processingSentence, productPromise, shortRange,
  type ShipSchedule,
} from '@/lib/ship-promise';

// ─── /shop/[tenantId]/product/[productId]/page.tsx ────────────────────────────
// The full product page: gallery with thumbnail rail, tier-aware pricing,
// description, How to Use, spec table, and downloadable documents (MSDS/SDS,
// guides, certificates). Add to cart writes the persistent per-tenant cart,
// so the shopper flows product page → shop → checkout without losing a thing.
// Wholesale mode persists too — a B2B buyer who unlocked on the shop sees
// their pricing here automatically.

interface ProductDetail {
  id: string;
  name: string;
  category: string;
  sku: string;
  description: string;
  howToUse: string;
  specs: { label: string; value: string }[];
  documents: { name: string; url: string }[];
  imageUrls: string[];
  priceCents: number;
  wholesalePriceCents: number | null;
  wholesaleMinQty: number | null;
  inStock: boolean;
  qtyAvailable: number;
  lowStock: boolean;
  // The variants group's choices carry what each variant sells for and whether it can be bought; the other choices
  // what they add (lib/variants shopOptionGroups).
  optionGroups?: { id: string; name: string; variants?: boolean; choices: { id: string; label: string; deltaCents?: number; priceCents?: number; wholesalePriceCents?: number | null; inStock?: boolean; qtyAvailable?: number; lowStock?: boolean }[] }[];
}

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function ProductPage() {
  const params = useParams<{ tenantId: string; productId: string }>();
  const tenantId = String(params?.tenantId || '');
  const productId = String(params?.productId || '');
  const { toast } = useToast();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [shopName, setShopName] = useState('');
  const [wholesale, setWholesale] = useState(false);
  const [paused, setPaused] = useState(false);
  const [cfg, setCfg] = useState<any>({
    showTrust: true, showFaq: true, showRelated: true, showVideo: true, showStickyBar: true, faq: [],
  });
  const [fulfil, setFulfil] = useState({ offersPickup: true, offersShipping: true });
  const [loadError, setLoadError] = useState('');
  // The shop's shipping schedule (only sent once it shows dates) and its clock, so the ship-by date here is worked out
  // the same way checkout and the order work it out, and moves by itself at the cutoff.
  const [shipping, setShipping] = useState<{ schedule: ShipSchedule; timeZone: string; offset: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!shipping) return;
    setNow(new Date(Date.now() + shipping.offset));
    const t = setInterval(() => setNow(new Date(Date.now() + shipping.offset)), 30_000);
    return () => clearInterval(t);
  }, [shipping]);

  // Reviews: the API only ever returns published ones and fails soft to an
  // empty list, so a review outage can never take the product page down.
  const [reviews, setReviews] = useState<{ id: string; rating: number; title: string; body: string; author: string; at: string }[]>([]);
  const [reviewAvg, setReviewAvg] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    const tid = String(params?.tenantId || '');
    const pid = String(params?.productId || '');
    if (!tid || !pid) return;
    fetch(`/api/retail/reviews?tenantId=${encodeURIComponent(tid)}&productId=${encodeURIComponent(pid)}`)
      .then((r) => r.json())
      .then((d) => {
        setReviews(Array.isArray(d.reviews) ? d.reviews : []);
        setReviewAvg(Number(d.average) || 0);
        setReviewCount(Number(d.count) || 0);
      })
      .catch(() => {});
  }, [params]);
  const [imgIdx, setImgIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    if (!tenantId) return;
    setCartCount(Object.values(readCart(tenantId)).reduce((a, b) => a + b, 0));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !productId) return;
    const code = readWholesaleCode(tenantId);
    const qs = new URLSearchParams({ tenantId, productId });
    if (code) qs.set('wholesaleCode', code);
    fetch(`/api/retail/product?${qs.toString()}`)
      .then(async (res) => {
        const data = await res.json();
        // A variant's own link: it's sold inside its listing, so the listing opens with it picked.
        if (!res.ok && data.listing?.id) { window.location.replace(`/shop/${encodeURIComponent(tenantId)}/product/${encodeURIComponent(data.listing.id)}?choice=${encodeURIComponent(data.listing.choice || '')}`); return; }
        if (!res.ok) throw new Error(data.error || 'Product not found');
        // The choices shown picked first: a variant that can be bought (or the one a link named).
        const picked = firstChoices(data.product.optionGroups || []);
        const named = new URLSearchParams(window.location.search).get('choice');
        const vg = (data.product.optionGroups || []).find((g: any) => g.variants);
        if (named && vg && vg.choices.some((c: any) => c.id === named)) picked[vg.id] = named;
        setSelections(picked);
        setProduct(data.product);
        setShopName(data.shop.name);
        setWholesale(data.shop.wholesaleUnlocked === true);
        setPaused(data.shop.paused === true);
        if (data.shop.page) setCfg({ ...data.shop.page });
        setFulfil({
          offersPickup: data.shop.offersPickup !== false,
          offersShipping: data.shop.offersShipping !== false,
        });
        // The shop's clock, not the device's, so a phone set wrong can't move the cutoff or the countdown.
        const serverNow = Date.parse(String(data.shop.serverNow || ''));
        setShipping(data.shop.shipSchedule ? { schedule: normalizeSchedule(data.shop.shipSchedule), timeZone: String(data.shop.timeZone || 'UTC'), offset: Number.isFinite(serverNow) ? serverNow - Date.now() : 0 } : null);
        if (data.shop.wholesaleUnlocked && data.product.wholesaleMinQty > 0) {
          setQty(data.product.wholesaleMinQty);
        }
      })
      .catch((e: any) => setLoadError(e?.message || 'Could not load this product'));
  }, [tenantId, productId]);

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [related, setRelated] = useState<any[]>([]);
  // The whole catalog with its bundles and bought-together pairs, for "Buy it together" (components/shop/offers).
  const [together0, setTogether] = useState<{ products: any[]; offers: ShopOffer[]; pairs: Record<string, string[]> } | null>(null);
  const [showBar, setShowBar] = useState(false);
  const site = useShopSite();

  // What the choices picked sell for, the same sums checkout makes (lib/variants): a variant's own price when it has
  // one, otherwise the listing's, plus what the other choices add.
  const line = useMemo(() => (product ? shopLine(product, selections, wholesale) : null), [product, selections, wholesale]);
  const retailLine = useMemo(() => (product ? shopLine(product, selections, false) : null), [product, selections]);
  const price = line?.baseCents ?? 0;
  const unitCents = line?.unitCents ?? 0;
  // How the chosen variant sells (its own, else the listing's, lib/variants asSold): a pre-order, a download, made to
  // order. The same as the cart and checkout read it.
  const vc: any = line?.variantChoice || null;
  const sold: any = vc ? { preorder: vc.preorder || { isPreorder: false, open: false }, digital: vc.digital === true, leadDays: vc.leadDays || null }
    : { preorder: (product as any)?.preorder || null, digital: (product as any)?.digital === true, leadDays: (product as any)?.leadDays || null };
  const canBuy = !!product && (line?.variantChoice ? line.inStock : product.inStock);
  const lowNow = !!product && (line?.variantChoice ? line.variantChoice.lowStock === true : product.lowStock);
  const showStrike = !!product && wholesale && !!retailLine && price < retailLine.baseCents;

  const add = () => {
    if (!product) return;
    const cart = addToCart(tenantId, product.id, qty, selections);
    setCartCount(Object.values(cart).reduce((a, b) => a + b, 0));
    toast({
      title: `Added ${qty} × ${product.name}`,
      description: 'It will be waiting in your cart.',
    });
  };

  useEffect(() => {
    // Related items come from the catalog endpoint the shop already uses —
    // same category first, then anything else, so a one-category shop still
    // gets a row instead of an empty space.
    if (!tenantId || !product) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/retail/catalog?tenantId=${encodeURIComponent(tenantId)}`);
        const data = await res.json();
        if (!alive || !res.ok) return;
        setTogether({ products: data.products || [], offers: Array.isArray(data.offers) ? data.offers : [], pairs: data.pairs || {} });
        const all = (data.products || []).filter((p: any) => p.id !== product.id && p.inStock);
        const sameCat = all.filter((p: any) => p.category === product.category);
        setRelated([...sameCat, ...all.filter((p: any) => p.category !== product.category)].slice(0, 6));
      } catch {
        // a missing related row is cosmetic; never block the page
      }
    })();
    return () => { alive = false; };
  }, [tenantId, product?.id]);

  useEffect(() => {
    // Sticky buy bar appears once the main button scrolls away — the single
    // biggest conversion fix on a long mobile product page.
    const onScroll = () => setShowBar(window.scrollY > 520);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);


  if (loadError) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-8 text-center bg-muted/5">
        <Package className="w-10 h-10 text-muted-foreground opacity-30" />
        <p className="font-black uppercase tracking-tight text-lg">Product unavailable</p>
        <p className="text-sm text-muted-foreground max-w-sm">{loadError}</p>
        <Button asChild variant="outline" className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
          <Link href={`/shop/${tenantId}`}>Back to shop</Link>
        </Button>
      </div>
    );
  }
  if (!product) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/5">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const stepQty = (d: number) => {
    const min = wholesale && product.wholesaleMinQty ? product.wholesaleMinQty : 1;
    setQty((q) => Math.max(min, Math.min(line?.qtyAvailable || product.qtyAvailable || 99, q + d)));
  };

  const buyLabel = paused
    ? 'Shop briefly paused'
    : canBuy
    ? `${sold.preorder?.isPreorder ? 'Pre-order' : sold.digital ? 'Buy now' : 'Add to bag'} · ${fmt(unitCents * qty)}`
    : sold.preorder?.isPreorder
    ? (sold.preorder.reason === 'closed' ? 'Pre-orders closed' : 'Run sold out')
    : 'Sold out';
  const status = sold.preorder?.isPreorder
    ? (sold.preorder.open
        ? `Pre-order${sold.preorder.etaAt ? ` · ships by ${new Date(`${sold.preorder.etaAt}T12:00:00`).toLocaleDateString()}` : ''}`
        : sold.preorder.reason === 'closed' ? 'Pre-orders closed' : 'This run sold out')
    : sold.digital
    ? 'Instant access — nothing ships'
    : canBuy
    ? (lowNow ? `Only ${line?.qtyAvailable ?? product.qtyAvailable} left` : 'In stock')
    : 'Sold out';

  const promise = shipping && fulfil.offersShipping && canBuy && !paused && !sold.digital ? (() => {
    const pl = {
      preorder: sold.preorder?.isPreorder === true && sold.preorder?.open === true,
      preorderEtaAt: sold.preorder?.etaAt || null,
      leadDays: sold.leadDays || null,
    };
    const p = productPromise(pl, now, shipping.timeZone, shipping.schedule);
    const count = shipping.schedule.countdown ? countdownFor(pl, now, shipping.timeZone, shipping.schedule) : null;
    const lead = leadSentence(sold.leadDays || null);
    const busy = busyLineFor(p, shipping.schedule, 'product', shipping.timeZone);
    return (
      <div className="p-4 text-sm" style={{ borderRadius: 'var(--shop-radius-card)', background: 'var(--shop-tint)' }}>
        <p className="font-semibold">Ships by {dayLabel(p.shipBy, shipping.timeZone)}</p>
        <p className="mt-0.5" style={{ color: 'var(--shop-muted)' }}>
          {count ? `Order in the next ${minutesLabel(count.minutesLeft)}. ` : ''}
          {p.arriveFrom ? `Arrives ${shortRange(p.arriveFrom, p.arriveTo)} with standard shipping.` : ''}
        </p>
        {lead ? <p className="mt-0.5" style={{ color: 'var(--shop-muted)' }}>{lead}</p> : null}
        {busy ? <p className="mt-0.5" style={{ color: 'var(--shop-muted)' }}>{busy}</p> : null}
      </div>);
  })() : null;

  const restock = !canBuy && !paused && !sold.preorder?.isPreorder && !sold.digital ? (
    <RestockAlert key={line?.variantChoice?.id || 'all'} tenantId={tenantId} productId={(product as any).id || productId}
      productName={line?.variantChoice ? `${product.name} · ${line.variantChoice.label}` : product.name} choiceId={line?.variantChoice?.id} />
  ) : null;

  const together = together0 && !wholesale ? (
    <BuyTogether tenantId={tenantId} product={product} selections={selections} products={together0.products} offers={together0.offers} pairs={together0.pairs}
      onAdded={(n) => { setCartCount(n); toast({ title: 'Added to your bag', description: 'Each item is in your cart at its own price; the saving shows at checkout.' }); }} />
  ) : null;

  // A download's own settings (lib/digital-product), for its promises and questions.
  const dInfo: PublicDigital | null = sold.digital ? ((product as any)?.digitalInfo || null) : null;
  const trust = cfg.showTrust ? [
    sold.preorder?.isPreorder
      ? {
          title: sold.preorder.etaAt ? `Ships by ${new Date(`${sold.preorder.etaAt}T12:00:00`).toLocaleDateString()}` : 'Made to order',
          sub: sold.preorder.closesAt
            ? `Pre-orders close ${new Date(`${sold.preorder.closesAt}T12:00:00`).toLocaleDateString()}${sold.preorder.remaining !== null ? ` · ${sold.preorder.remaining} left in this run` : ''}`
            : 'Charged today, shipped when it lands — cancel any time before it ships',
        }
      : sold.digital
      ? { title: 'Instant access', sub: dInfo && dInfo.saves && !dInfo.reads ? 'Ready to save the moment you pay' : 'Opens in your library the moment you pay' }
      : fulfil.offersPickup
      ? { title: 'Fast local pickup', sub: 'Ready same day when in stock' }
      : { title: 'Ships to you', sub: 'Live carrier rates at checkout' },
    sold.digital
      ? { title: dInfo ? accessWords(dInfo) : 'Yours to keep', sub: dInfo ? `${dInfo.license.name}, please don’t reshare it` : 'Personal use, please don’t reshare it' }
      : { title: 'Easy returns', sub: 'Start one from your order page' },
    { title: 'Secure checkout', sub: 'Card details never touch us' },
  ] : null;

  const faq = cfg.showFaq ? (cfg.faq && cfg.faq.length > 0 ? cfg.faq : dInfo ? digitalFaq(dInfo) : [
    fulfil.offersPickup
      ? { q: 'How long until my order is ready?', a: 'Pickup orders are usually ready the same day. You get an email the moment yours is packed, and the order page shows live status.' }
      : { q: 'How fast do you ship?', a: shipping ? `${processingSentence(shipping.schedule, new Date(Date.now() + shipping.offset), shipping.timeZone)} Tracking shows on your order page, with a text or email to let you know, as soon as it ships.` : 'Orders are packed within a day or two and tracking shows on your order page, with a text or email to let you know, as soon as it ships.' },
    { q: 'What is the return policy?', a: 'Start a return from your order page once it has been picked up or delivered — choose the items and a reason, and the shop takes it from there.' },
    fulfil.offersShipping
      ? { q: 'Do you ship?', a: 'Yes. Shipping is quoted live at checkout from your address, so you see real carrier options and prices before paying.' }
      : { q: 'Is this pickup only?', a: 'Yes — orders are collected in person, and you get a QR code to show when you arrive.' },
  ]) : null;

  // Buy it now: this item at the chosen quantity (not on top of what is already in the bag), then checkout. If the
  // bag can't be saved on this device (storage blocked), say so instead of opening an empty checkout.
  const buyNow = () => {
    const key = cartKeyFor(product.id, selections);
    const cart = readCart(tenantId); cart[key] = qty; writeCart(tenantId, cart);
    if (readCart(tenantId)[key] !== qty) { toast({ title: 'Your bag could not be saved', description: 'This browser is blocking storage. Allow it for this site, or try another browser.' }); return; }
    window.location.href = `/shop/${encodeURIComponent(tenantId)}/checkout`;
  };
  const qtyMin = wholesale && product.wholesaleMinQty ? product.wholesaleMinQty : 1;
  const qtyMax = sold.digital ? 1 : Math.max(qtyMin, line?.qtyAvailable || product.qtyAvailable || 99);

  return (
    <div className="min-h-dvh pb-28">
      <ShopHeader active="product" />
      {wholesale && (
        <div style={{ background: 'var(--shop-brand)', color: 'var(--shop-on-brand)' }}>
          <p className="mx-auto max-w-6xl px-4 py-2 text-sm font-semibold">Wholesale pricing active</p>
        </div>
      )}

      <ProductView
        layout={site?.layout || 'atelier'}
        dark={!!site?.dark}
        tenantId={tenantId}
        shopName={shopName}
        product={product as any}
        priceCents={price}
        strikeCents={showStrike ? retailLine!.baseCents : null}
        unitCents={unitCents}
        wholesale={wholesale}
        canBuy={canBuy}
        paused={paused}
        lowNow={lowNow}
        leftNow={line?.qtyAvailable ?? product.qtyAvailable}
        digital={sold.digital === true}
        buyLabel={buyLabel}
        status={status}
        qty={qty}
        qtyMin={qtyMin}
        qtyMax={qtyMax}
        buyNowLabel={!sold.digital && canBuy && !paused ? (sold.preorder?.isPreorder ? 'Pre-order now' : 'Buy it now') : null}
        stepQty={stepQty}
        onAdd={add}
        onBuyNow={buyNow}
        selections={selections}
        onSelect={(g, c) => { setSelections({ ...selections, [g]: c }); setQty(wholesale && product.wholesaleMinQty ? product.wholesaleMinQty : 1); }}
        showVideo={cfg.showVideo !== false}
        promise={promise}
        restock={restock}
        together={together}
        trust={trust}
        related={cfg.showRelated ? related : []}
        reviews={reviews}
        reviewAvg={reviewAvg}
        reviewCount={reviewCount}
        faq={faq}
      />

      {cfg.showStickyBar !== false && showBar && canBuy && !paused && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 backdrop-blur lg:hidden" style={{ borderColor: 'var(--shop-line)', background: 'color-mix(in srgb, var(--shop-surface) 92%, transparent)' }}>
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{product.name}</p>
              <p className="text-sm tabular-nums" style={{ color: 'var(--shop-muted)' }}>{fmt(unitCents * qty)}</p>
            </div>
            <button type="button" onClick={add} className="inline-flex h-12 shrink-0 items-center px-6 text-sm font-semibold"
              style={{ borderRadius: 'var(--shop-radius-pill)', background: 'var(--shop-brand)', color: 'var(--shop-on-brand)' }}>
              {sold.preorder?.isPreorder ? 'Pre-order' : sold.digital ? 'Buy now' : 'Add to bag'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
