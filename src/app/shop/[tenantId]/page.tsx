'use client';

import { CircleUserRound, Loader, Lock, Minus, Package, Plus, ShoppingBag, Store, Truck, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  addToCart, cartExpiresAt, cartKeyFor, clearCart, parseCartKey, readCart,
  readWholesaleCode, touchCartExpiry, writeCart, writeWholesaleCode,
} from '@/lib/shop-cart';
import { ShopSectionsRenderer, type ShopPageConfig } from '@/lib/shop-sections';
import { ShopMenu } from '@/components/shop/ShopMenu';
import { cn } from '@/lib/utils';

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
  wholesaleOffered: boolean;
  wholesaleUnlocked: boolean;
  wholesaleBusiness?: string;
  flatShippingDollars: number;
  freeShippingOverDollars: number;
  shippingOffered: boolean;
  curbsideOffered: boolean;
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

export default function ShopPage() {
  const params = useParams<{ tenantId: string }>();
  const search = useSearchParams();
  const tenantId = String(params?.tenantId || '');
  const { toast } = useToast();

  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [category, setCategory] = useState('all');

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
    () => (category === 'all' ? products : products.filter((p) => p.category === category)),
    [products, category]
  );

  const unitPrice = (p: ShopProduct) =>
    wholesale && p.wholesalePriceCents != null ? p.wholesalePriceCents : p.priceCents;

  const cartEntries = Object.entries(cart).filter(([key, q]) => q > 0 && byId.has(parseCartKey(key).productId));
  const cartCount = cartEntries.reduce((a, [, q]) => a + q, 0);
  const optionDelta = (key: string) => {
    const { productId, selections } = parseCartKey(key);
    const prod: any = byId.get(productId);
    if (!prod?.optionGroups?.length) return { deltaCents: 0, label: '' };
    let delta = 0;
    const parts: string[] = [];
    for (const g of prod.optionGroups) {
      const choice = g.choices.find((c: any) => c.id === selections[g.id]) || g.choices[0];
      if (!choice) continue;
      delta += choice.deltaCents || 0;
      parts.push(choice.label);
    }
    return { deltaCents: delta, label: parts.join(' \u00b7 ') };
  };
  const subtotalCents = cartEntries.reduce((a, [key, q]) => a + (unitPrice(byId.get(parseCartKey(key).productId)!) + optionDelta(key).deltaCents) * q, 0);



  const setQty = (p: ShopProduct, qty: number, cartKey?: string) => {
    const clamped = Math.max(0, Math.min(qty, p.qtyAvailable));
    const key = cartKey || p.id;
    setCart((c) => {
      const next = { ...c, [key]: clamped };
      if (clamped === 0) delete next[key];
      return next;
    });
  };




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
        <header className="bg-white border-b">
          <div className="mx-auto flex h-16 max-w-5xl items-center gap-2.5 px-4">
            {shop.logoUrl ? (
              <Image src={shop.logoUrl} alt={shop.name} width={80} height={80} className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10" />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 sm:h-10 sm:w-10">
                <Store className="h-4 w-4 text-primary" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-black uppercase tracking-tighter text-lg leading-none truncate">{shop.name}</h1>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">{shop.tagline || 'Shop'}</p>
            </div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full rounded-[2.5rem] border-2 bg-white p-10 text-center space-y-4 shadow-xl shadow-primary/5">
            <div className="w-16 h-16 mx-auto rounded-2xl border-2 bg-primary/5 flex items-center justify-center">
              <Package className="w-7 h-7 text-primary" />
            </div>
            <p className="font-black uppercase tracking-tighter text-xl">Restocking in progress</p>
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
      <header className="sticky top-0 z-30 bg-white backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-2 sm:gap-3">
          <ShopMenu
            tenantId={tenantId}
            shopName={shop.name}
            categories={[...new Set(products.map((p) => p.category).filter(Boolean))].sort()}
            onUnlockWholesale={shop.wholesaleOffered && !wholesale ? () => setUnlockOpen(true) : undefined}
          />

          <Link
            href={`/shop/${tenantId}`}
            className="flex min-w-0 flex-1 items-center gap-2.5"
            aria-label={`${shop.name} home`}
          >
            {shop.logoUrl ? (
              // object-contain, no border, no background: a logo with a
              // transparent background should sit ON the header, not inside a
              // cropped grey box. object-cover was also silently cropping any
              // logo that was not square.
              <Image
                src={shop.logoUrl}
                alt={shop.name}
                width={80}
                height={80}
                className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 sm:h-10 sm:w-10">
                <Store className="h-4 w-4 text-primary" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-black uppercase leading-tight tracking-tight sm:text-lg">
                {shop.name}
              </h1>
              {shop.tagline && (
                // Long taglines used to overflow — this one had no truncate at
                // all. Hidden on the narrowest screens, where the name is the
                // only thing worth the space.
                <p className="hidden truncate text-[10px] font-black uppercase tracking-widest text-muted-foreground min-[420px]:block">
                  {shop.tagline}
                </p>
              )}
            </div>
          </Link>

          <Button asChild variant="ghost" size="icon" aria-label="Your account" className="h-10 w-10 shrink-0 rounded-xl">
            <Link href={`/shop/${tenantId}/account`}><CircleUserRound className="h-5 w-5" /></Link>
          </Button>
          <Button
            asChild
            className="relative h-10 w-10 shrink-0 rounded-xl p-0 font-black uppercase tracking-widest sm:w-auto sm:px-4 sm:text-[10px]"
          >
            <Link
              href={`/shop/${tenantId}/checkout`}
              aria-label={cartCount > 0 ? `Cart, ${cartCount} item${cartCount === 1 ? '' : 's'} — go to checkout` : 'Cart — go to checkout'}
            >
              <ShoppingBag className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Cart</span>
              {cartCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-black text-background">
                  {cartCount}
                </span>
              )}
            </Link>
          </Button>
        </div>

        {shop.announcement && !wholesale && (
          <div className="bg-foreground text-background">
            <div className="max-w-5xl mx-auto px-4 py-1.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-center">{shop.announcement}</p>
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
      </header>

      <ShopSectionsRenderer
        config={shop.pageConfig}
        products={products.map((p) => ({
          id: p.id, name: p.name, priceCents: unitPrice(p), imageUrls: p.imageUrls, inStock: p.inStock,
        }))}
        tenantId={tenantId}
        onShopNow={() => document.getElementById('shop-catalog')?.scrollIntoView({ behavior: 'smooth' })}
      />

      <div id="shop-catalog" className="max-w-5xl mx-auto px-4 pt-6 pb-2 flex gap-2 overflow-x-auto scroll-mt-24">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={cn(
              'shrink-0 h-9 px-4 rounded-full border-2 text-[10px] font-black uppercase tracking-widest transition-all',
              category === c ? 'bg-foreground text-background border-foreground' : 'bg-white hover:border-primary/40'
            )}
          >
            {c === 'all' ? 'Everything' : c}
          </button>
        ))}
      </div>

      <main className={cn(
        'max-w-5xl mx-auto px-4 py-4 gap-4',
        (shop.layout || 'grid') === 'grid' && 'grid grid-cols-2 md:grid-cols-3',
        shop.layout === 'showcase' && 'grid grid-cols-1 md:grid-cols-2',
        shop.layout === 'list' && 'flex flex-col'
      )}>
        {shown.length === 0 && (
          <div className="col-span-full text-center py-24 space-y-3">
            <Package className="w-10 h-10 mx-auto opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Nothing here yet</p>
          </div>
        )}
        {shown.map((p) => {
          const inCart = cart[p.id] ?? 0;
          const price = unitPrice(p);
          const showStrike = wholesale && p.wholesalePriceCents != null && p.wholesalePriceCents < p.priceCents;
          const productHref = `/shop/${tenantId}/product/${p.id}`;
          if (shop.layout === 'list') {
            return (
              <Card key={p.id} className={cn('border-2 rounded-3xl overflow-hidden bg-white transition-all', !p.inStock && 'opacity-60')}>
                <CardContent className="p-3 flex items-center gap-4">
                  <Link href={productHref} className="w-20 h-20 rounded-2xl bg-muted/10 relative overflow-hidden shrink-0">
                    {p.imageUrls[0] ? (
                      <Image src={p.imageUrls[0]} alt={p.name} fill className="object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center"><Package className="w-6 h-6 opacity-15" /></div>
                    )}
                  </Link>
                  <Link href={productHref} className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-black uppercase tracking-tight text-xs leading-tight">{p.name}</p>
                    {p.description && <p className="text-[10px] font-bold text-muted-foreground line-clamp-1">{p.description}</p>}
                    <div className="flex items-baseline gap-1.5">
                      <p className="font-black text-sm text-primary">{fmt(price)}</p>
                      {showStrike && <p className="text-[9px] font-bold text-muted-foreground line-through">{fmt(p.priceCents)}</p>}
                      {p.lowStock && p.inStock && <span className="text-[8px] font-black uppercase tracking-widest text-amber-600">Almost gone</span>}
                      {!p.inStock && <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Sold out</span>}
                    </div>
                  </Link>
                  <div className="shrink-0">
                    {inCart === 0 ? (
                      <Button disabled={!p.inStock}
                        onClick={() => { if ((p as any).optionGroups?.length > 0) { window.location.href = `/shop/${tenantId}/product/${p.id}`; return; } setQty(p, wholesale && p.wholesaleMinQty ? p.wholesaleMinQty : 1); }}
                        className="h-10 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest">
                        Add
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1 rounded-xl border-2 p-1">
                        <Button variant="ghost" size="icon" aria-label={`Decrease quantity of ${p.name}`} className="h-8 w-8 rounded-lg" onClick={() => setQty(p, inCart - 1)}><Minus className="h-3 w-3" aria-hidden="true" /></Button>
                        <span className="w-6 text-center font-black font-mono text-sm">{inCart}</span>
                        <Button variant="ghost" size="icon" aria-label={`Increase quantity of ${p.name}`} className="h-8 w-8 rounded-lg" onClick={() => setQty(p, inCart + 1)}><Plus className="h-3 w-3" aria-hidden="true" /></Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          }
          return (
            <Card key={p.id} className={cn('border-2 rounded-[2rem] overflow-hidden bg-white transition-all hover:border-primary/30', !p.inStock && 'opacity-60')}>
              <Link href={productHref} className={cn(shop.layout === 'showcase' ? 'aspect-[4/3]' : 'aspect-square', 'bg-muted/10 relative block')}>
                {p.imageUrls[0] ? (
                  <Image src={p.imageUrls[0]} alt={p.name} fill className="object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Package className="w-10 h-10 opacity-15" />
                  </div>
                )}
                {p.lowStock && p.inStock && (
                  <Badge className="absolute top-3 left-3 bg-amber-50 text-amber-700 border-2 border-amber-100 font-black text-[8px] uppercase tracking-widest">
                    Almost gone
                  </Badge>
                )}
                {!p.inStock && (
                  <Badge className="absolute top-3 left-3 bg-slate-100 text-slate-600 border-2 border-slate-200 font-black text-[8px] uppercase tracking-widest">
                    Sold out
                  </Badge>
                )}
              </Link>
              <CardContent className="p-4 space-y-3">
                <Link href={productHref} className="space-y-1 block">
                  <p className={cn('font-black uppercase tracking-tight leading-tight line-clamp-2', shop.layout === 'showcase' ? 'text-sm' : 'text-xs')}>{p.name}</p>
                  {shop.layout === 'showcase' && p.description && (
                    <p className="text-[10px] font-bold text-muted-foreground line-clamp-2">{p.description}</p>
                  )}
                  <div className="flex items-baseline gap-1.5">
                    <p className="font-black text-base text-primary">{fmt(price)}</p>
                    {showStrike && <p className="text-[10px] font-bold text-muted-foreground line-through">{fmt(p.priceCents)}</p>}
                  </div>
                  {wholesale && p.wholesaleMinQty ? (
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Min {p.wholesaleMinQty}</p>
                  ) : null}
                </Link>
                {inCart === 0 ? (
                  <Button
                    disabled={!p.inStock}
                    onClick={() => { if ((p as any).optionGroups?.length > 0) { window.location.href = `/shop/${tenantId}/product/${p.id}`; return; } setQty(p, wholesale && p.wholesaleMinQty ? p.wholesaleMinQty : 1); }}
                    className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest"
                  >
                    Add to cart
                  </Button>
                ) : (
                  <div className="flex items-center justify-between rounded-xl border-2 p-1">
                    <Button variant="ghost" size="icon" aria-label={`Decrease quantity of ${p.name}`} className="h-8 w-8 rounded-lg" onClick={() => setQty(p, inCart - 1)}>
                      <Minus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <span className="font-black font-mono text-sm">{inCart}</span>
                    <Button variant="ghost" size="icon" aria-label={`Increase quantity of ${p.name}`} className="h-8 w-8 rounded-lg" onClick={() => setQty(p, inCart + 1)}>
                      <Plus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </main>

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
