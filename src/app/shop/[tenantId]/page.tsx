'use client';

import { Loader, Package, Store } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  addToCart, cartExpiresAt, cartKeyFor, clearCart, parseCartKey, readCart,
  readWholesaleCode, touchCartExpiry, writeCart, writeWholesaleCode,
} from '@/lib/shop-cart';
import { shopLine } from '@/lib/variants';
import { ShopSectionsRenderer, type ShopPageConfig } from '@/lib/shop-sections';
import { ShopHeader, useShopSite } from '@/components/shop/ShopChrome';
import { HomeCatalog, HomeIntro, spotlightPick, type HomeBag } from '@/components/shop/home/HomeLayouts';
import { cn } from '@/lib/utils';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { OfferStrip, type ShopOffer } from '@/components/shop/offers';
import { designsSync } from '@/lib/gift-designs';

// ─── /shop/[tenantId]/page.tsx ────────────────────────────────────────────────
// Public storefront. Catalog comes from /api/retail/catalog (Admin SDK —
// no security-rule changes needed); checkout hands off to
// /api/retail/checkout which returns a Stripe Checkout URL on the tenant's
// connected account.
//
// Tiers: anonymous shoppers see retail pricing. Wholesale/B2B buyers unlock
// with the shop's access code — pricing, minimums, PO/business fields, and
// (if configured) tax exemption all switch over live.

interface ShopProduct {
  id: string;
  name: string;
  category: string;
  description: string;
  imageUrls: string[];
  priceCents: number;
  priceVaries?: boolean;          // variants at different prices: the lowest is shown, as "From"
  wholesalePriceCents: number | null;
  wholesaleMinQty: number | null;
  inStock: boolean;
  qtyAvailable: number;
  lowStock: boolean;
}

interface ShopInfo {
  tenantId: string;
  name: string;
  logoUrl: string | null;
  tagline?: string;
  announcement?: string;
  busyBanner?: string;
  wholesaleOffered: boolean;
  wholesaleUnlocked: boolean;
  wholesaleBusiness?: string;
  flatShippingDollars: number;
  freeShippingOverDollars: number;
  shippingOffered: boolean;
  curbsideOffered: boolean;
  pickupOffered?: boolean;
  curbsideMode?: 'spots' | 'drive_thru' | 'freeform';
  curbsideSpots?: string[];
  layout?: 'grid' | 'list' | 'showcase';
  paused?: boolean;
  pausedMessage?: string;
  cartHoldMinutes?: number;
  prepMinutes?: number;
  tipsEnabled?: boolean;
  scheduledPickup?: boolean;
  pageConfig?: ShopPageConfig;
}

type Method = 'counter' | 'curbside' | 'ship';

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** The gift card tile: two of the business's own designs, fanned, and "From $25" — opens the gift card page. */
function GiftCardShopTile({ tenantId, gift, wide }: { tenantId: string; gift: any; wide?: boolean }) {
  const pick = designsSync().filter((d) => gift.designs.includes(d.id));
  const a = pick.find((d) => d.collection === 'Occasions' && d.season) || pick[0]; const b = pick.find((d) => d !== a && d.collection !== 'Occasions') || pick[1] || a;
  const from = Math.min(...(gift.amounts || [25]));
  const ref = useRef<HTMLDivElement>(null); const [w, setW] = useState(200);
  useEffect(() => { const el = ref.current; if (!el) return; const f = () => setW(Math.max(110, Math.min(200, Math.floor(el.clientWidth * 0.72)))); f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect(); }, []);
  const h = Math.round(w * 265 / 420);
  return (
    <a href={`/gift/${encodeURIComponent(tenantId)}`} className={cn('group flex flex-col justify-between gap-4 overflow-hidden rounded-3xl border-2 p-4 transition-all hover:shadow-lg', wide && 'sm:flex-row sm:items-center')} style={{ background: 'var(--shop-card)', color: 'var(--shop-ink)' }}>
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Gift cards</p>
      <div ref={ref} className="w-full"><div className="relative mx-auto" style={{ width: Math.round(w * 1.24), height: h + Math.round(h * 0.45) }}>
        {b && <div className="absolute left-0 top-0 -rotate-6 transition-transform group-hover:-rotate-[8deg]"><GiftCardFace design={b} brand={gift.brand} amount={`$${from}`} name="For you" width={w} /></div>}
        {a && <div className="absolute rotate-3 transition-transform group-hover:rotate-[5deg]" style={{ left: Math.round(w * 0.22), top: Math.round(h * 0.42) }}><GiftCardFace design={a} brand={gift.brand} amount={`$${gift.amounts?.[1] || 100}`} name="Someone special" width={w} /></div>}
      </div></div>
      <div className="space-y-2">
        <p className="text-lg font-light leading-tight">Give a gift card</p>
        <p className="text-[11px] font-bold text-muted-foreground">Sent by text or email, now or on the day. Never expires.</p>
        <span className="flex h-10 items-center justify-center rounded-full bg-foreground text-[12px] font-bold text-background">From ${from}</span>
      </div>
    </a>);
}

export default function ShopPage() {
  const params = useParams<{ tenantId: string }>();
  const search = useSearchParams();
  const tenantId = String(params?.tenantId || '');
  const { toast } = useToast();

  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [offers, setOffers] = useState<ShopOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [category, setCategory] = useState('all');
  // Gift cards sold online (lib/gift-shop): shown first in the shop and as their own filter. They open the gift card
  // page rather than going in the cart — a gift card is sent, not shipped.
  const [gift, setGift] = useState<any>(null);
  useEffect(() => { if (!tenantId) return; fetch(`/api/gift-cards/shop?tenantId=${encodeURIComponent(tenantId)}`).then((r) => r.json()).then((x) => setGift(x?.ok && x.open ? x : null)).catch(() => {}); }, [tenantId]);

  // Wholesale
  const [wholesaleCode, setWholesaleCode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const wholesale = shop?.wholesaleUnlocked === true;

  // Cart: productId -> qty — persisted per tenant so it survives product
  // pages, refreshes, and return visits.
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartHydrated, setCartHydrated] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setCart(readCart(tenantId));
    setCartHydrated(true);
  }, [tenantId]);

  useEffect(() => {
    if (tenantId && cartHydrated) writeCart(tenantId, cart);
  }, [tenantId, cart, cartHydrated]);

  const [holdLeft, setHoldLeft] = useState<number | null>(null);
  const holdMinutes = shop?.cartHoldMinutes || 0;

  useEffect(() => {
    if (!tenantId || !cartHydrated || holdMinutes <= 0) return;
    if (Object.values(cart).some((q) => q > 0)) touchCartExpiry(tenantId, holdMinutes);
  }, [tenantId, cart, cartHydrated, holdMinutes]);


  useEffect(() => {
    if (!tenantId || holdMinutes <= 0) { setHoldLeft(null); return; }
    const tick = () => {
      const exp = cartExpiresAt(tenantId);
      if (exp === null) { setHoldLeft(null); return; }
      const left = exp - Date.now();
      if (left <= 0) {
        clearCart(tenantId);
        setCart({});
        setHoldLeft(null);
        toast({ title: 'Cart expired', description: 'Items were released — stock moves fast. Re-add anything you still want.' });
        return;
      }
      setHoldLeft(left);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, holdMinutes, cartHydrated]);

  const holdLabel = holdLeft != null
    ? `${Math.floor(holdLeft / 60000)}:${String(Math.floor((holdLeft % 60000) / 1000)).padStart(2, '0')}`
    : null;


  const loadCatalog = async (code: string) => {
    setLoading(true);
    setLoadError('');
    try {
      const qs = new URLSearchParams({ tenantId });
      if (code) qs.set('wholesaleCode', code);
      const res = await fetch(`/api/retail/catalog?${qs.toString()}`);
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`The shop backend answered with an unexpected response (HTTP ${res.status}). Try a refresh — if it persists, the shop owner has been notified in the logs.`);
      }
      if (!res.ok) throw new Error(data.error || 'Could not load the shop');
      setShop(data.shop);
      setProducts(data.products);
      setOffers(Array.isArray(data.offers) ? data.offers : []);
      return true;
    } catch (e: any) {
      if (code) {
        toast({ variant: 'destructive', title: 'Wrong code', description: 'That wholesale code was not recognized.' });
        return false;
      }
      setLoadError(e?.message || 'Could not load the shop');
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    const savedCode = readWholesaleCode(tenantId);
    if (savedCode) {
      loadCatalog(savedCode).then((ok) => {
        if (ok) setWholesaleCode(savedCode);
        else { writeWholesaleCode(tenantId, ''); loadCatalog(''); }
      });
    } else {
      loadCatalog('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (search?.get('canceled') === '1') {
      toast({ title: 'Checkout canceled', description: 'Your cart is still here when you are ready.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUnlock = async () => {
    const code = codeInput.trim();
    if (!code) return;
    setUnlocking(true);
    const ok = await loadCatalog(code);
    setUnlocking(false);
    if (ok) {
      setWholesaleCode(code);
      writeWholesaleCode(tenantId, code);
      setUnlockOpen(false);
      toast({ title: 'Wholesale pricing active', description: 'B2B prices and minimums now apply.' });
    }
  };

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const categories = useMemo(
    () => ['all', ...Array.from(new Set(products.map((p) => p.category))).sort()],
    [products]
  );
  const shown = useMemo(
    () => (category === 'all' ? products : category === '__gift' ? [] : products.filter((p) => p.category === category)),
    [products, category]
  );

  const unitPrice = (p: ShopProduct) =>
    wholesale && p.wholesalePriceCents != null ? p.wholesalePriceCents : p.priceCents;

  const cartEntries = Object.entries(cart).filter(([key, q]) => q > 0 && byId.has(parseCartKey(key).productId));
  // What each cart line sells for, the same sums checkout makes (lib/variants): a variant's own price when it has one,
  // otherwise the listing's, plus what the other choices add.
  const lineOf = (key: string) => { const { productId, selections } = parseCartKey(key); const p: any = byId.get(productId); return p ? shopLine(p, selections, wholesale) : null; };
  const subtotalCents = cartEntries.reduce((a, [key, q]) => a + (lineOf(key)?.unitCents || 0) * q, 0);



  const setQty = (p: ShopProduct, qty: number, cartKey?: string) => {
    const clamped = Math.max(0, Math.min(qty, cartKey ? lineOf(cartKey)?.qtyAvailable ?? p.qtyAvailable : p.qtyAvailable));
    const key = cartKey || p.id;
    setCart((c) => {
      const next = { ...c, [key]: clamped };
      if (clamped === 0) delete next[key];
      return next;
    });
  };




  const site = useShopSite();
  const layout = site?.layout || 'atelier';
  const toCatalog = () => document.getElementById('shop-catalog')?.scrollIntoView({ behavior: 'smooth' });
  // A new object each render; the catalog's sorting only follows what it needs (wholesale prices).
  const bag: HomeBag = {
    tenantId, wholesale,
    priceOf: (p) => unitPrice(p as ShopProduct),
    qtyOf: (p) => cart[p.id] ?? 0,
    onAdd: (p) => setQty(p as ShopProduct, wholesale && p.wholesaleMinQty ? p.wholesaleMinQty : 1),
    // Below a wholesale minimum the line comes out of the bag rather than sitting under it.
    onQty: (p, q) => setQty(p as ShopProduct, wholesale && p.wholesaleMinQty && q < p.wholesaleMinQty && q < (cart[p.id] ?? 0) ? 0 : q),
  };
  const chipList = gift ? [...categories.slice(0, 1), '__gift', ...categories.slice(1)] : categories;
  // The owner's own hero (page designer) takes the place of the layout's welcome.
  const ownHero = (shop?.pageConfig?.sections || []).some((s: any) => s.type === 'hero' && s.enabled !== false);
  const spotlight = layout === 'spotlight' && !ownHero ? spotlightPick(products) : null;
  const delivery = !shop ? null
    : shop.shippingOffered && shop.freeShippingOverDollars > 0 ? `Free delivery over $${shop.freeShippingOverDollars}`
      : shop.shippingOffered ? 'We deliver to your door'
        : shop.curbsideOffered ? 'Order ahead, pick up curbside'
          : shop.pickupOffered !== false ? 'Order ahead, pick up in store'
            : null;

  if (loading && !shop) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-muted/5">
        <Loader className="w-8 h-8 animate-spin text-primary" />
        <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Opening the shop…</p>
      </div>
    );
  }

  if (loadError || !shop) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-8 text-center">
        <Store className="w-10 h-10 text-muted-foreground opacity-30" />
        <p className="font-black uppercase tracking-tight text-lg">Shop unavailable</p>
        <p className="text-sm text-muted-foreground max-w-sm">{loadError || 'This shop could not be loaded.'}</p>
      </div>
    );
  }

  if (shop.paused) {
    return (
      <div className="flex min-h-dvh flex-col">
        <ShopHeader minimal />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full rounded-[2.5rem] border-2 bg-white p-10 text-center space-y-4 shadow-xl shadow-primary/5">
            <div className="w-16 h-16 mx-auto rounded-2xl border-2 bg-primary/5 flex items-center justify-center">
              <Package className="w-7 h-7 text-primary" />
            </div>
            <h1 className="font-black uppercase tracking-tighter text-xl">Restocking in progress</h1>
            <p className="text-sm font-bold text-muted-foreground leading-relaxed">
              {shop.pausedMessage || 'We are briefly paused while we update the shelves. Check back shortly — good things are landing.'}
            </p>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
              Existing orders are unaffected and tracking pages stay live
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-32">
      <ShopHeader
        active="home"
        categories={[...new Set(products.map((p) => p.category).filter(Boolean))].sort()}
        onUnlockWholesale={shop.wholesaleOffered && !wholesale ? () => setUnlockOpen(true) : undefined}
        wholesaleUnlocked={wholesale}
        hideAnnouncement={wholesale}
      />
      <div>
        {shop.busyBanner && (
          <div className="border-b bg-muted">
            <div className="max-w-5xl mx-auto px-4 py-2">
              <p className="text-[12.5px] font-bold text-center leading-snug">{shop.busyBanner}</p>
            </div>
          </div>
        )}
        {wholesale && (
          <div className="bg-primary text-primary-foreground">
            <div className="max-w-5xl mx-auto px-4 py-1.5 flex items-center gap-2">
              <Badge className="bg-primary-foreground/15 text-primary-foreground border-0 font-black text-[9px] uppercase tracking-widest">B2B</Badge>
              <p className="text-[10px] font-black uppercase tracking-widest">Wholesale pricing active{shop.wholesaleBusiness ? ` · ${shop.wholesaleBusiness}` : ''}</p>
            </div>
          </div>
        )}
      </div>

      {!ownHero && (
        <HomeIntro
          layout={layout}
          name={shop.name}
          tagline={site?.tagline || shop.tagline || ''}
          products={products}
          categories={categories}
          bag={bag}
          dark={!!site?.dark}
          delivery={delivery}
          hasGift={!!gift}
          onShop={toCatalog}
          onPickCategory={(c) => { setCategory(c); toCatalog(); }}
        />
      )}

      <ShopSectionsRenderer
        config={shop.pageConfig}
        products={products.map((p) => ({
          id: p.id, name: p.name, priceCents: unitPrice(p), imageUrls: p.imageUrls, inStock: p.inStock,
        }))}
        tenantId={tenantId}
        onShopNow={toCatalog}
      />

      <OfferStrip tenantId={tenantId} offers={offers} products={products} />

      <HomeCatalog
        layout={layout}
        cardStyle={shop.layout || 'grid'}
        products={shown}
        categories={chipList}
        category={category}
        setCategory={setCategory}
        giftTile={gift ? <GiftCardShopTile tenantId={tenantId} gift={gift} wide={shop.layout === 'list'} /> : null}
        bag={bag}
        dark={!!site?.dark}
        skipId={spotlight?.id || null}
      />

      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent className="sm:max-w-sm rounded-[2rem] border-4 p-8">
          <DialogHeader className="text-left space-y-1">
            <DialogTitle className="font-black uppercase tracking-tighter text-xl">Wholesale Access</DialogTitle>
            <DialogDescription className="text-xs font-bold text-muted-foreground">
              Enter the access code from {shop.name} to unlock B2B pricing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <Input
              aria-label="Wholesale access code"
              autoComplete="off"
              placeholder="Access code"
              value={codeInput}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCodeInput(e.target.value)}
              className="h-12 rounded-xl border-2 font-black uppercase tracking-widest text-sm"
            />
            <Button
              disabled={!codeInput.trim() || unlocking}
              onClick={handleUnlock}
              className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest"
            >
              {unlocking ? <Loader className="h-4 w-4 animate-spin" /> : 'Unlock wholesale pricing'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
