'use client';

// ─── src/app/shop/[tenantId]/checkout/page.tsx ──────────────────────────────
// Checkout as a PAGE, not an overlay. The sheet-based cart produced a class
// of failures no fix fully closed: a dimming backdrop with no panel, on
// mobile AND desktop, eating every tap. A page cannot fail that way — there
// is no portal, no backdrop, no enter/exit animation, no state that can
// strand a customer under a dim. Back from Stripe lands on an ordinary page.
// Cart contents live in localStorage (shop-cart) and are shared with the
// storefront, so nothing about adding to cart changed.

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, CalendarClock, Loader, Minus, Package, Plus, Store, Truck, X,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  cartExpiresAt, clearCart, parseCartKey, readCart, readWholesaleCode,
  touchCartExpiry, writeCart, writeWholesaleCode,
} from '@/lib/shop-cart';
import { formatPromiseDay, preorderNotice } from '@/lib/preorder-terms';
import { cn } from '@/lib/utils';

type Method = 'counter' | 'curbside' | 'ship';

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function CheckoutPage() {
  const params = useParams<{ tenantId: string }>();
  const search = useSearchParams();
  const tenantId = String(params?.tenantId || '');
  const { toast } = useToast();

  const [shop, setShop] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [wholesaleCode, setWholesaleCode] = useState('');
  const wholesale = shop?.wholesaleUnlocked === true;

  // Cart — same persisted store the shop writes; hydrate then mirror back.
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

  // Cart hold: keep the timer honest here too, since this page may be the
  // only one open while a customer fills the form.
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

  // Checkout form
  const [method, setMethod] = useState<Method>('counter');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [addr, setAddr] = useState({ name: '', line1: '', line2: '', city: '', state: '', postalCode: '' });
  const [placing, setPlacing] = useState(false);
  const [tipPct, setTipPct] = useState<number>(0);
  const [applyCredit, setApplyCredit] = useState(false);
  const [pickupChoice, setPickupChoice] = useState('ASAP');
  const [preorderAgreed, setPreorderAgreed] = useState(false);

  // Live carrier rates. The server signs every option (amount + service +
  // expiry); the browser only ever sends the chosen option's token back, so
  // a customer picks the SERVICE but can never set the PRICE. Quotes are
  // keyed to the address they were fetched for — edit the address and the
  // stale options disappear instead of quietly mispricing the parcel.
  type ShipQuote = { id: string; carrier: string; service: string; amountCents: number; days: number | null; exp: number; token: string };
  const [quotes, setQuotes] = useState<ShipQuote[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState('');
  const [quotedFor, setQuotedFor] = useState('');

  const addrKey = `${addr.line1}|${addr.city}|${addr.state}|${addr.postalCode}`.toLowerCase();
  const addrComplete = Boolean(addr.line1 && addr.city && addr.state && addr.postalCode);
  const quotesFresh = quotes.length > 0 && quotedFor === addrKey;
  const selectedQuote = quotesFresh ? quotes.find((q) => q.id === selectedQuoteId) || null : null;

  // Returning from Stripe restores this page from the back-forward cache
  // with state frozen mid-checkout. On a plain page the only frozen thing
  // is the Pay spinner — reset it so the button is immediately usable.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setPlacing(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  useEffect(() => {
    if (search?.get('canceled') === '1') {
      toast({ title: 'Checkout canceled', description: 'Your cart is still here when you are ready.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Catalog — same endpoint the shop uses; the saved wholesale code keeps
  // B2B pricing consistent between the two pages.
  useEffect(() => {
    if (!tenantId) return;
    const savedCode = readWholesaleCode(tenantId);
    const load = async (code: string) => {
      setLoading(true);
      setLoadError('');
      try {
        const qs = new URLSearchParams({ tenantId });
        if (code) qs.set('wholesaleCode', code);
        const res = await fetch(`/api/retail/catalog?${qs.toString()}`);
        const text = await res.text();
        let data: any;
        try { data = JSON.parse(text); }
        catch { throw new Error(`The shop backend answered with an unexpected response (HTTP ${res.status}).`); }
        if (!res.ok) throw new Error(data.error || 'Could not load the shop');
        setShop(data.shop);
        setProducts(data.products);
        if (code) setWholesaleCode(code);
        return true;
      } catch (e: any) {
        if (code) return false;
        setLoadError(e?.message || 'Could not load the shop');
        return false;
      } finally {
        setLoading(false);
      }
    };
    if (savedCode) {
      load(savedCode).then((ok) => {
        if (!ok) { writeWholesaleCode(tenantId, ''); load(''); }
      });
    } else {
      load('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const byId = useMemo(() => new Map(products.map((p: any) => [p.id, p])), [products]);

  const unitPrice = (p: any) =>
    wholesale && p.wholesalePriceCents != null ? p.wholesalePriceCents : p.priceCents;

  const cartEntries = Object.entries(cart).filter(([key, q]) => q > 0 && byId.has(parseCartKey(key).productId));
  const cartCount = cartEntries.reduce((a, [, q]) => a + q, 0);
  // A cart of nothing-but-digital has no parcel and no pickup: asking for a
  // delivery method (or an address) reads as a broken shop, and that's where
  // abandoned carts come from. The server already accepts this shape.
  const digitalOnlyCart = cartEntries.length > 0 && cartEntries.every(([key]) =>
    (byId.get(parseCartKey(key).productId) as any)?.digital === true);

  // ── PRE-ORDERS IN THE CART ────────────────────────────────────────────────
  // A pre-order is the one thing in a cart that is not what it looks like:
  // the customer is paying today for something that is not on the shelf. The
  // FTC rule treats the ship-by date as a disclosure that must be made BEFORE
  // payment, not a detail to discover in a confirmation email — so it is
  // stated here, in the cart, and the order cannot be placed until it is
  // ticked. Derived AFTER cartEntries so the read is never above its source.
  const preorderItems = cartEntries
    .map(([key, qty]) => {
      const prod: any = byId.get(parseCartKey(key).productId);
      return prod?.preorder?.open === true
        ? { name: String(prod.name || 'Item'), etaAt: prod.preorder.etaAt || null, qty }
        : null;
    })
    .filter(Boolean) as { name: string; etaAt: string | null; qty: number }[];

  const hasPreorder = preorderItems.length > 0;
  const preorderKey = preorderItems.map((i) => `${i.name}|${i.etaAt}|${i.qty}`).join('~');
  const notice = useMemo(
    () => (hasPreorder ? preorderNotice({ items: preorderItems }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasPreorder, preorderKey]
  );

  // Agreeing to a March 3 promise is not agreeing to an April 3 one. If the
  // pre-ordered items change AFTER the tick, the tick is withdrawn — an
  // acknowledgement that survives the thing it acknowledged is worthless as
  // a record and unfair as a term.
  useEffect(() => {
    setPreorderAgreed(false);
  }, [preorderKey]);

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

  const subtotalCents = cartEntries.reduce(
    (a, [key, q]) => a + (unitPrice(byId.get(parseCartKey(key).productId)!) + optionDelta(key).deltaCents) * q, 0
  );
  const tipCents = shop?.tipsEnabled && tipPct > 0 ? Math.round((subtotalCents * tipPct) / 100) : 0;

  const fetchQuotes = async () => {
    if (!addrComplete || quoting) return;
    setQuoting(true);
    try {
      const res = await fetch('/api/retail/shipping-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          items: cartEntries.map(([key, qty]) => ({ productId: parseCartKey(key).productId, qty })),
          address: { line1: addr.line1, line2: addr.line2, city: addr.city, state: addr.state, postalCode: addr.postalCode },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not fetch shipping options');
      const opts: ShipQuote[] = Array.isArray(data.options) ? data.options : [];
      if (opts.length === 0) throw new Error('No shipping options came back — the flat rate applies.');
      setQuotes(opts);
      setQuotedFor(addrKey);
      const cheapest = [...opts].sort((a, b) => a.amountCents - b.amountCents)[0];
      setSelectedQuoteId(cheapest.id);
    } catch (e: any) {
      setQuotes([]);
      setQuotedFor('');
      toast({ title: 'Shipping options', description: e?.message || 'Live rates unavailable — the flat rate applies.' });
    } finally {
      setQuoting(false);
    }
  };

  const freeOverCents = Math.round((shop?.freeShippingOverDollars || 0) * 100);
  const freeQualified = freeOverCents > 0 && subtotalCents >= freeOverCents;

  const shippingCents = useMemo(() => {
    if (digitalOnlyCart || method !== 'ship' || !shop) return 0;
    if (freeQualified) return 0;
    if (selectedQuote) return selectedQuote.amountCents;
    return Math.round((shop.flatShippingDollars || 0) * 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, shop, subtotalCents, selectedQuote, freeQualified]);

  const setQty = (p: any, qty: number, cartKey?: string) => {
    const clamped = Math.max(0, Math.min(qty, p.qtyAvailable));
    const key = cartKey || p.id;
    setCart((c) => {
      const next = { ...c, [key]: clamped };
      if (clamped === 0) delete next[key];
      return next;
    });
  };

  const minIssues = wholesale
    ? (cartEntries
        .map(([id, q]) => {
          const p = byId.get(parseCartKey(id).productId)!;
          return p.wholesaleMinQty && q < p.wholesaleMinQty
            ? `${p.name}: minimum ${p.wholesaleMinQty}`
            : null;
        })
        .filter(Boolean) as string[])
    : [];

  const canPlace =
    cartCount > 0 && name.trim() && email.trim() && minIssues.length === 0 &&
    (!hasPreorder || preorderAgreed) &&
    (digitalOnlyCart || method !== 'ship' || (addr.name && addr.line1 && addr.city && addr.state && addr.postalCode));

  const placeOrder = async () => {
    if (!canPlace || placing) return;
    setPlacing(true);
    try {
      const res = await fetch('/api/retail/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          items: cartEntries.map(([key, qty]) => ({ ...parseCartKey(key), qty })),
          tipCents,
          pickupAt: !digitalOnlyCart && method !== 'ship' && shop?.scheduledPickup ? pickupChoice : '',
          method: digitalOnlyCart ? 'counter' : method,
          applyStoreCredit: applyCredit,
          preorderAck: hasPreorder ? true : undefined,
          customer: { name: name.trim(), email: email.trim(), phone: phone.trim() },
          shippingAddress: method === 'ship' && !digitalOnlyCart ? { ...addr, country: 'US' } : undefined,
          shippingQuote: method === 'ship' && selectedQuote
            ? { amountCents: selectedQuote.amountCents, service: selectedQuote.service, exp: selectedQuote.exp, token: selectedQuote.token }
            : undefined,
          priceTier: wholesale ? 'wholesale' : 'retail',
          wholesaleCode: wholesale ? wholesaleCode : undefined,
          business: wholesale ? { name: businessName.trim(), poNumber: poNumber.trim() } : undefined,
        }),
      });
      const raw = await res.text();
      let data: any = {};
      try { data = JSON.parse(raw); } catch { /* non-JSON reply handled below */ }
      if (!res.ok) throw new Error(data.error || `Checkout failed (HTTP ${res.status})`);
      window.location.href = data.url;
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Checkout problem', description: e?.message || 'Please try again.' });
      setPlacing(false);
    }
  };

  if (loading && !shop) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">Loading checkout</span>
      </div>
    );
  }

  if (loadError || !shop) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm font-bold">{loadError || 'Could not load the shop'}</p>
        <Button asChild variant="outline" className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
          <Link href={`/shop/${tenantId}`}>Back to shop</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:px-6">
      <div className="mb-4 flex h-14 items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to shop" className="h-10 w-10 shrink-0 rounded-xl">
          <Link href={`/shop/${tenantId}`}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
        </Button>
        <h1 className="text-xl font-black uppercase tracking-tighter">Checkout</h1>
        {holdLabel && cartEntries.length > 0 && (
          <div className="ml-auto rounded-xl border-2 border-primary/30 bg-primary/5 px-3 py-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-primary">Held </span>
            <span className="font-black font-mono text-xs text-primary tabular-nums">{holdLabel}</span>
          </div>
        )}
      </div>

      {cartEntries.length === 0 ? (
        <div className="space-y-4 py-24 text-center">
          <Package className="mx-auto h-10 w-10 text-primary/30" aria-hidden="true" />
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Your cart is empty
          </p>
          <Button asChild className="rounded-2xl font-black uppercase text-[10px] tracking-widest">
            <Link href={`/shop/${tenantId}`}>Browse the shop</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            {cartEntries.map(([id, qty]) => {
              const parsedKey = parseCartKey(id);
              const optInfo = optionDelta(id);
              const p = byId.get(parsedKey.productId)!;
              return (
                <div key={id} className="flex items-center gap-3 rounded-2xl border-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-black uppercase tracking-tight text-xs truncate">{p.name}</p>
                    {optInfo.label && (
                      <p className="text-[8px] font-black uppercase tracking-widest text-primary truncate">{optInfo.label}</p>
                    )}
                    {p?.preorder?.open === true && (
                      <p className="text-[8px] font-black uppercase tracking-widest text-amber-700">
                        {`Pre-order${p.preorder.etaAt ? ` \u00b7 ships by ${formatPromiseDay(p.preorder.etaAt)}` : ''}`}
                      </p>
                    )}
                    <p className="text-[10px] font-bold text-primary">{fmt(unitPrice(p))} each</p>
                    {wholesale && p.wholesaleMinQty ? (
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                        Min {p.wholesaleMinQty} wholesale
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="icon" aria-label={`Decrease quantity of ${p.name}`} className="h-8 w-8 rounded-lg border-2" onClick={() => setQty(p, qty - 1, id)}>
                      <Minus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <span className="w-8 text-center font-black font-mono text-sm">{qty}</span>
                    <Button variant="outline" size="icon" aria-label={`Increase quantity of ${p.name}`} className="h-8 w-8 rounded-lg border-2" onClick={() => setQty(p, qty + 1, id)}>
                      <Plus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${p.name} from cart`} className="h-8 w-8" onClick={() => setQty(p, 0, id)}>
                    <X className="h-3.5 w-3.5 opacity-40" aria-hidden="true" />
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

          {digitalOnlyCart && (
            <div className="rounded-2xl border-2 border-primary/30 bg-primary/[0.04] p-3">
              <p className="text-[10px] font-black uppercase tracking-widest">Instant access</p>
              <p className="text-[11px] font-bold text-muted-foreground">
                Nothing ships. The moment you pay, everything opens in your library and lands in your email.
              </p>
            </div>
          )}

          <div className={cn('space-y-2', digitalOnlyCart && 'hidden')}>
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">How would you like it?</Label>
            <div className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-3">
              {([
                { id: 'counter' as Method, label: 'Pickup', icon: Store, show: true },
                { id: 'curbside' as Method, label: shop.curbsideMode === 'drive_thru' ? 'Drive-Thru' : 'Curbside', icon: Package, show: shop.curbsideOffered },
                { id: 'ship' as Method, label: 'Ship', icon: Truck, show: shop.shippingOffered },
              ]).filter((m) => m.show).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={method === m.id}
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    'rounded-2xl border-2 p-3 flex flex-col items-center gap-1.5 transition-all',
                    method === m.id ? 'border-primary bg-primary/5 shadow-md shadow-primary/10' : 'hover:border-primary/30'
                  )}
                >
                  <m.icon className={cn('h-4 w-4', method === m.id ? 'text-primary' : 'opacity-40')} aria-hidden="true" />
                  <span className="text-[9px] font-black uppercase tracking-widest">{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Your details</Label>
            <Input placeholder="Full name" aria-label="Full name" autoComplete="name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
            <Input placeholder="Email" aria-label="Email" autoComplete="email" type="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
            <Input placeholder="Phone (optional)" aria-label="Phone, optional" autoComplete="tel" type="tel" value={phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
          </div>

          {wholesale && (
            <div className="space-y-3">
              <Label className="text-[10px] font-black uppercase tracking-widest text-primary">Business</Label>
              <Input placeholder="Business name" aria-label="Business name" autoComplete="organization" value={businessName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBusinessName(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
              <Input placeholder="PO number (optional)" aria-label="PO number, optional" autoComplete="off" value={poNumber} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPoNumber(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
            </div>
          )}

          {method === 'ship' && !digitalOnlyCart && (
            <div className="space-y-3">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Ship to</Label>
              <Input placeholder="Recipient name" aria-label="Recipient name" autoComplete="name" value={addr.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, name: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
              <Input placeholder="Street address" aria-label="Street address" autoComplete="address-line1" value={addr.line1} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, line1: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
              <Input placeholder="Apt / suite (optional)" aria-label="Apartment or suite, optional" autoComplete="address-line2" value={addr.line2} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, line2: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
              <div className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-3">
                <Input placeholder="City" aria-label="City" autoComplete="address-level2" value={addr.city} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, city: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm col-span-1" />
                <Input placeholder="State" aria-label="State" autoComplete="address-level1" value={addr.state} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, state: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
                <Input placeholder="ZIP" aria-label="ZIP code" autoComplete="postal-code" inputMode="numeric" value={addr.postalCode} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, postalCode: e.target.value })} className="h-12 rounded-xl border-2 font-bold text-sm" />
              </div>

              {freeQualified ? (
                <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                  Free shipping — this order qualifies
                </p>
              ) : !quotesFresh ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!addrComplete || quoting}
                  onClick={fetchQuotes}
                  className="h-11 w-full rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
                >
                  {quoting ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Get shipping options'}
                </Button>
              ) : (
                <div className="space-y-2" role="radiogroup" aria-label="Shipping options">
                  {quotes.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      role="radio"
                      aria-checked={selectedQuoteId === q.id}
                      onClick={() => setSelectedQuoteId(q.id)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all',
                        selectedQuoteId === q.id ? 'border-primary bg-primary/5' : 'hover:border-primary/30'
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[10px] font-black uppercase tracking-widest">{q.carrier} · {q.service}</span>
                        {q.days != null && (
                          <span className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                            ~{q.days} day{q.days === 1 ? '' : 's'}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-black font-mono text-sm">{q.amountCents === 0 ? 'Free' : fmt(q.amountCents)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => { setQuotes([]); setQuotedFor(''); setSelectedQuoteId(''); }}
                    className="text-[9px] font-black uppercase tracking-widest text-muted-foreground underline underline-offset-2"
                  >
                    Refresh options
                  </button>
                </div>
              )}
            </div>
          )}

          {notice && (
            <div className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50/60 p-4">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">{notice.headline}</p>
              </div>
              <ul className="space-y-1">
                {notice.itemLines.map((l) => (
                  <li key={l} className="text-[11px] font-black uppercase tracking-tight text-amber-900">{l}</li>
                ))}
              </ul>
              <ul className="space-y-1.5">
                {notice.bullets.map((b) => (
                  <li key={b} className="text-[11px] font-bold leading-relaxed text-amber-900/80">{b}</li>
                ))}
              </ul>
              <label className="flex items-start gap-2.5 rounded-xl border-2 border-amber-300 bg-white/70 p-3">
                <input
                  type="checkbox"
                  checked={preorderAgreed}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPreorderAgreed(e.target.checked)}
                  aria-label={notice.agreeLabel}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-current"
                />
                <span className="text-[11px] font-bold leading-relaxed text-amber-900">{notice.agreeLabel}</span>
              </label>
            </div>
          )}

          <div className="space-y-3 rounded-2xl border-2 p-5">
            <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <span>Subtotal</span><span className="font-mono">{fmt(subtotalCents)}</span>
            </div>
            {method === 'ship' && !digitalOnlyCart && (
              <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <span>Shipping</span>
                <span className="font-mono">{shippingCents === 0 ? 'Free' : fmt(shippingCents)}</span>
              </div>
            )}
            {method !== 'ship' && (shop.prepMinutes || 0) > 0 && (
              <p className="text-[9px] font-black uppercase tracking-widest text-primary">
                Usually ready in ~{shop.prepMinutes} min
              </p>
            )}
            {method !== 'ship' && shop.scheduledPickup && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pickup time</span>
                <select aria-label="Pickup time" value={pickupChoice}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPickupChoice(e.target.value)}
                  className="h-9 rounded-xl border-2 bg-white px-2 text-[10px] font-black uppercase tracking-widest">
                  {['ASAP', 'In ~15 min', 'In ~30 min', 'In ~45 min', 'In ~1 hour'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
            <label className="flex items-start gap-2.5 rounded-2xl border-2 p-3">
              <input
                type="checkbox"
                aria-label="Apply my store credit if I have any"
                checked={applyCredit}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApplyCredit(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-current"
              />
              <span className="text-[11px] font-bold leading-relaxed text-muted-foreground">
                <span className="font-black uppercase tracking-widest text-foreground">Apply my store credit</span>
                <br />From past returns, if any is on file for your email — the discount appears on the payment page.
              </span>
            </label>
            {shop.tipsEnabled && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Tip</span>
                <div className="flex gap-1">
                  {[0, 10, 15, 20].map((pct) => (
                    <button key={pct} type="button" aria-pressed={tipPct === pct}
                      aria-label={pct === 0 ? 'No tip' : `Tip ${pct} percent`}
                      onClick={() => setTipPct(pct)}
                      className={cn('h-8 px-2.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-widest transition-all',
                        tipPct === pct ? 'bg-foreground text-background border-foreground' : 'bg-white')}>
                      {pct === 0 ? 'None' : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {tipCents > 0 && (
              <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <span>Tip</span>
                <span className="font-mono">{fmt(tipCents)}</span>
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
              {placing ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : `Pay ${fmt(subtotalCents + shippingCents + tipCents)} + tax`}
            </Button>
            <p className="text-[9px] font-bold uppercase tracking-widest text-center text-muted-foreground/60">
              Secure payment &middot; You&apos;ll get a pickup QR code
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
