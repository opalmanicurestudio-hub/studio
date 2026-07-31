'use client';

import { Loader, Lock, Minus, Package, Plus, ShoppingBag, Store, Truck, X } from 'lucide-react';
import Image from 'next/image';
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
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
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
  flatShippingDollars: number;
  freeShippingOverDollars: number;
  shippingOffered: boolean;
  curbsideOffered: boolean;
  curbsideMode?: 'spots' | 'drive_thru' | 'freeform';
  curbsideSpots?: string[];
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

  // Cart: productId -> qty
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);

  // Checkout form
  const [method, setMethod] = useState<Method>('counter');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [addr, setAddr] = useState({ name: '', line1: '', line2: '', city: '', state: '', postalCode: '' });
  const [placing, setPlacing] = useState(false);

  const loadCatalog = async (code: string) => {
    setLoading(true);
    setLoadError('');
    try {
      const qs = new URLSearchParams({ tenantId });
      if (code) qs.set('wholesaleCode', code);
      const res = await fetch(`/api/retail/catalog?${qs.toString()}`);
      const data = await res.json();
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
    if (tenantId) loadCatalog('');
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

  const cartEntries = Object.entries(cart).filter(([id, q]) => q > 0 && byId.has(id));
  const cartCount = cartEntries.reduce((a, [, q]) => a + q, 0);
  const subtotalCents = cartEntries.reduce((a, [id, q]) => a + unitPrice(byId.get(id)!) * q, 0);

  const shippingCents = useMemo(() => {
    if (method !== 'ship' || !shop) return 0;
    const freeOver = Math.round(shop.freeShippingOverDollars * 100);
    if (freeOver > 0 && subtotalCents >= freeOver) return 0;
    return Math.round(shop.flatShippingDollars * 100);
  }, [method, shop, subtotalCents]);

  const setQty = (p: ShopProduct, qty: number) => {
    const clamped = Math.max(0, Math.min(qty, p.qtyAvailable));
    setCart((c) => ({ ...c, [p.id]: clamped }));
  };

  const minIssues = wholesale
    ? cartEntries
        .map(([id, q]) => {
          const p = byId.get(id)!;
          return p.wholesaleMinQty && q < p.wholesaleMinQty
            ? `${p.name}: minimum ${p.wholesaleMinQty}`
            : null;
        })
        .filter(Boolean) as string[]
    : [];

  const canPlace =
    cartCount > 0 && name.trim() && email.trim() && minIssues.length === 0 &&
    (method !== 'ship' || (addr.name && addr.line1 && addr.city && addr.state && addr.postalCode));

  const placeOrder = async () => {
    if (!canPlace || placing) return;
    setPlacing(true);
    try {
      const res = await fetch('/api/retail/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          items: cartEntries.map(([productId, qty]) => ({ productId, qty })),
          method,
          customer: { name: name.trim(), email: email.trim(), phone: phone.trim() },
          shippingAddress: method === 'ship' ? { ...addr, country: 'US' } : undefined,
          priceTier: wholesale ? 'wholesale' : 'retail',
          wholesaleCode: wholesale ? wholesaleCode : undefined,
          business: wholesale ? { name: businessName.trim(), poNumber: poNumber.trim() } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start checkout');
      window.location.href = data.url;
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Checkout problem', description: e?.message || 'Please try again.' });
      setPlacing(false);
    }
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

  return (
    <div className="min-h-dvh bg-muted/5 pb-32">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          {shop.logoUrl ? (
            <Image src={shop.logoUrl} alt="" width={40} height={40} className="rounded-xl border-2 object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-xl border-2 bg-primary/10 flex items-center justify-center">
              <Store className="w-5 h-5 text-primary" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-black uppercase tracking-tighter text-lg leading-none truncate">{shop.name}</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">{shop.tagline || 'Shop'}</p>
          </div>
          {shop.wholesaleOffered && !wholesale && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest border-2"
              onClick={() => setUnlockOpen(true)}
            >
              <Lock className="mr-1.5 h-3 w-3" /> Wholesale
            </Button>
          )}
          <Sheet open={cartOpen} onOpenChange={setCartOpen}>
            <SheetTrigger asChild>
              <Button className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-md shadow-primary/20 relative">
                <ShoppingBag className="mr-1.5 h-4 w-4" /> Cart
                {cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-foreground text-background text-[10px] font-black flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </Button>
            </SheetTrigger>

            {/* ── Cart & checkout sheet ──────────────────────────────────── */}
            <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
              <SheetHeader className="p-6 pb-3 border-b-2 text-left">
                <SheetTitle className="font-black uppercase tracking-tighter text-xl">Your Order</SheetTitle>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {cartEntries.length === 0 ? (
                  <div className="text-center py-16 space-y-3">
                    <Package className="w-10 h-10 mx-auto opacity-20" />
                    <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Your cart is empty</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-3">
                      {cartEntries.map(([id, qty]) => {
                        const p = byId.get(id)!;
                        return (
                          <div key={id} className="flex items-center gap-3 rounded-2xl border-2 p-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-black uppercase tracking-tight text-xs truncate">{p.name}</p>
                              <p className="text-[10px] font-bold text-primary">{fmt(unitPrice(p))} each</p>
                              {wholesale && p.wholesaleMinQty ? (
                                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                                  Min {p.wholesaleMinQty} wholesale
                                </p>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-2" onClick={() => setQty(p, qty - 1)}>
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-8 text-center font-black font-mono text-sm">{qty}</span>
                              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-2" onClick={() => setQty(p, qty + 1)}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setQty(p, 0)}>
                              <X className="h-3.5 w-3.5 opacity-40" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>

                    {minIssues.length > 0 && (
                      <div className="rounded-2xl border-2 border-destructive/20 bg-destructive/5 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-destructive mb-1">Wholesale minimums</p>
                        {minIssues.map((m) => (
                          <p key={m} className="text-xs font-bold text-destructive/80">{m}</p>
                        ))}
                      </div>
                    )}

                    {/* Fulfillment method */}
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">How would you like it?</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { id: 'counter' as Method, label: 'Pickup', icon: Store, show: true },
                          { id: 'curbside' as Method, label: shop.curbsideMode === 'drive_thru' ? 'Drive-Thru' : 'Curbside', icon: Package, show: shop.curbsideOffered },
                          { id: 'ship' as Method, label: 'Ship', icon: Truck, show: shop.shippingOffered },
                        ]).filter((m) => m.show).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setMethod(m.id)}
                            className={cn(
                              'rounded-2xl border-2 p-3 flex flex-col items-center gap-1.5 transition-all',
                              method === m.id ? 'border-primary bg-primary/5 shadow-md shadow-primary/10' : 'hover:border-primary/30'
                            )}
                          >
                            <m.icon className={cn('h-4 w-4', method === m.id ? 'text-primary' : 'opacity-40')} />
                            <span className="text-[9px] font-black uppercase tracking-widest">{m.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Contact */}
                    <div className="space-y-3">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Your details</Label>
                      <Input placeholder="Full name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
                      <Input placeholder="Email" type="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
                      <Input placeholder="Phone (optional)" value={phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
                    </div>

                    {/* B2B fields */}
                    {wholesale && (
                      <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-primary">Business</Label>
                        <Input placeholder="Business name" value={businessName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBusinessName(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
                        <Input placeholder="PO number (optional)" value={poNumber} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPoNumber(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
                      </div>
                    )}

                    {/* Shipping address */}
                    {method === 'ship' && (
                      <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Ship to</Label>
                        <Input placeholder="Recipient name" value={addr.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, name: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
                        <Input placeholder="Street address" value={addr.line1} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, line1: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
                        <Input placeholder="Apt / suite (optional)" value={addr.line2} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, line2: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
                        <div className="grid grid-cols-3 gap-2">
                          <Input placeholder="City" value={addr.city} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, city: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm col-span-1" />
                          <Input placeholder="State" value={addr.state} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, state: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
                          <Input placeholder="ZIP" value={addr.postalCode} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, postalCode: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Totals + place */}
              {cartEntries.length > 0 && (
                <div className="border-t-2 p-6 space-y-3 bg-white">
                  <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    <span>Subtotal</span><span className="font-mono">{fmt(subtotalCents)}</span>
                  </div>
                  {method === 'ship' && (
                    <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      <span>Shipping</span>
                      <span className="font-mono">{shippingCents === 0 ? 'Free' : fmt(shippingCents)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    <span>Tax</span><span>Calculated at checkout</span>
                  </div>
                  <Separator />
                  <Button
                    disabled={!canPlace || placing}
                    onClick={placeOrder}
                    className="w-full h-14 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-primary/20"
                  >
                    {placing ? <Loader className="h-4 w-4 animate-spin" /> : `Pay ${fmt(subtotalCents + shippingCents)} + tax`}
                  </Button>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-center text-muted-foreground/60">
                    Secure payment · You&apos;ll get a pickup QR code
                  </p>
                </div>
              )}
            </SheetContent>
          </Sheet>
        </div>

        {/* Wholesale tier band — the shop visibly shifts modes */}
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
              <p className="text-[10px] font-black uppercase tracking-widest">Wholesale pricing active</p>
            </div>
          </div>
        )}
      </header>

      {/* ── Category rail ──────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-2 flex gap-2 overflow-x-auto">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
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

      {/* ── Product grid ───────────────────────────────────────────────────── */}
      <main className="max-w-5xl mx-auto px-4 py-4 grid grid-cols-2 md:grid-cols-3 gap-4">
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
          return (
            <Card key={p.id} className={cn('border-2 rounded-[2rem] overflow-hidden bg-white transition-all', !p.inStock && 'opacity-60')}>
              <div className="aspect-square bg-muted/10 relative">
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
              </div>
              <CardContent className="p-4 space-y-3">
                <div className="space-y-1">
                  <p className="font-black uppercase tracking-tight text-xs leading-tight line-clamp-2">{p.name}</p>
                  <div className="flex items-baseline gap-1.5">
                    <p className="font-black text-base text-primary">{fmt(price)}</p>
                    {showStrike && <p className="text-[10px] font-bold text-muted-foreground line-through">{fmt(p.priceCents)}</p>}
                  </div>
                  {wholesale && p.wholesaleMinQty ? (
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Min {p.wholesaleMinQty}</p>
                  ) : null}
                </div>
                {inCart === 0 ? (
                  <Button
                    disabled={!p.inStock}
                    onClick={() => setQty(p, wholesale && p.wholesaleMinQty ? p.wholesaleMinQty : 1)}
                    className="w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest"
                  >
                    Add to cart
                  </Button>
                ) : (
                  <div className="flex items-center justify-between rounded-xl border-2 p-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setQty(p, inCart - 1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="font-black font-mono text-sm">{inCart}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setQty(p, inCart + 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </main>

      {/* ── Wholesale unlock dialog ────────────────────────────────────────── */}
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
