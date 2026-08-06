'use client';

import { ArrowLeft, BookOpen, CheckCircle2, ChevronRight, FileDown, ListChecks, Loader, Minus, Package, Plus, RotateCcw, ShieldCheck, ShoppingBag, Truck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { addToCart, readCart, readWholesaleCode } from '@/lib/shop-cart';
import { cn } from '@/lib/utils';

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
  optionGroups?: { id: string; name: string; choices: { id: string; label: string; deltaCents: number }[] }[];
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
        if (!res.ok) throw new Error(data.error || 'Product not found');
        setProduct(data.product);
        setShopName(data.shop.name);
        setWholesale(data.shop.wholesaleUnlocked === true);
        setPaused(data.shop.paused === true);
        if (data.shop.page) setCfg({ ...data.shop.page });
        setFulfil({
          offersPickup: data.shop.offersPickup !== false,
          offersShipping: data.shop.offersShipping !== false,
        });
        if (data.shop.wholesaleUnlocked && data.product.wholesaleMinQty > 0) {
          setQty(data.product.wholesaleMinQty);
        }
      })
      .catch((e: any) => setLoadError(e?.message || 'Could not load this product'));
  }, [tenantId, productId]);

  const price = useMemo(() => {
    if (!product) return 0;
    return wholesale && product.wholesalePriceCents != null ? product.wholesalePriceCents : product.priceCents;
  }, [product, wholesale]);

  const showStrike = !!product && wholesale && product.wholesalePriceCents != null &&
    product.wholesalePriceCents < product.priceCents;

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [related, setRelated] = useState<any[]>([]);
  const [showBar, setShowBar] = useState(false);

  const optionDeltaCents = (product?.optionGroups || []).reduce((sum: number, g: any) => {
    const choice = g.choices.find((c: any) => c.id === selections[g.id]) || g.choices[0];
    return sum + (choice?.deltaCents || 0);
  }, 0);

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
    setQty((q) => Math.max(min, Math.min(product.qtyAvailable || 99, q + d)));
  };

  return (
    <div className="min-h-dvh bg-muted/5 pb-32">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href={`/shop/${tenantId}`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground truncate">{shopName}</p>
            <p className="font-black uppercase tracking-tighter text-sm leading-none truncate">{product.category}</p>
          </div>
          <Button asChild variant="outline" className="h-10 rounded-xl font-black uppercase text-[9px] tracking-widest border-2 relative">
            <Link href={`/shop/${tenantId}`}>
              <ShoppingBag className="mr-1.5 h-3.5 w-3.5" /> Cart
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-foreground text-background text-[10px] font-black flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </Link>
          </Button>
        </div>
        {wholesale && (
          <div className="bg-primary text-primary-foreground">
            <div className="max-w-4xl mx-auto px-4 py-1.5 flex items-center gap-2">
              <Badge className="bg-primary-foreground/15 text-primary-foreground border-0 font-black text-[9px] uppercase tracking-widest">B2B</Badge>
              <p className="text-[10px] font-black uppercase tracking-widest">Wholesale pricing active</p>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 grid md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="aspect-square rounded-[2rem] border-2 bg-white relative overflow-hidden">
            {product.imageUrls[imgIdx] ? (
              <Image src={product.imageUrls[imgIdx]} alt={product.name} fill className="object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Package className="w-14 h-14 opacity-10" />
              </div>
            )}
            {product.lowStock && product.inStock && (
              <Badge className="absolute top-4 left-4 bg-amber-50 text-amber-700 border-2 border-amber-100 font-black text-[8px] uppercase tracking-widest">
                Almost gone
              </Badge>
            )}
            {!product.inStock && (
              <Badge className="absolute top-4 left-4 bg-slate-100 text-slate-600 border-2 border-slate-200 font-black text-[8px] uppercase tracking-widest">
                Sold out
              </Badge>
            )}
          </div>
          {cfg.showVideo && product.videoUrl ? (
            <video
              src={product.videoUrl}
              controls
              playsInline
              preload="metadata"
              className="w-full rounded-[1.5rem] border-2 bg-black"
            >
              Your browser can&rsquo;t play this video.
            </video>
          ) : null}

          {product.imageUrls.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {product.imageUrls.map((url, i) => (
                <button key={url + i} type="button" onClick={() => setImgIdx(i)}
                  className={cn('w-16 h-16 rounded-xl border-2 relative overflow-hidden shrink-0 transition-all',
                    imgIdx === i ? 'border-primary' : 'opacity-60 hover:opacity-100')}>
                  <Image src={url} alt="" fill className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
            <Link href={`/shop/${tenantId}`} className="hover:text-foreground">Shop</Link>
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
            <Link href={`/shop/${tenantId}/catalog?category=${encodeURIComponent(product.category || '')}`} className="hover:text-foreground truncate">
              {product.category || 'All'}
            </Link>
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate text-foreground">{product.name}</span>
          </nav>

          <div className="space-y-2">
            <h1 className="font-black uppercase tracking-tighter text-2xl leading-tight">{product.name}</h1>
            {product.sku && (
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">SKU {product.sku}</p>
            )}
            <div className="flex items-baseline gap-2">
              <p className="font-black text-3xl text-primary">{fmt(price)}</p>
              {showStrike && <p className="text-sm font-bold text-muted-foreground line-through">{fmt(product.priceCents)}</p>}
            </div>
            {wholesale && (product.wholesaleMinQty || 0) > 0 && (
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                Wholesale minimum {product.wholesaleMinQty}
              </p>
            )}
            {product.description && (
              <p className="text-sm font-bold text-muted-foreground leading-relaxed whitespace-pre-line">{product.description}</p>
            )}
          </div>

          {(product.optionGroups || []).length > 0 && (
            <div className="space-y-3">
              {(product.optionGroups || []).map((g) => (
                <div key={g.id} className="space-y-1.5">
                  <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">{g.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(g.choices || []).map((c) => {
                      const active = (selections[g.id] || g.choices[0]?.id) === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelections({ ...selections, [g.id]: c.id })}
                          className={cn('h-10 px-3.5 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest transition-all',
                            active ? 'bg-foreground text-background border-foreground' : 'bg-white hover:border-primary/40')}
                        >
                          {c.label}{c.deltaCents ? ` +$${(c.deltaCents / 100).toFixed(2)}` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-2xl border-2 p-1.5 bg-white">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => stepQty(-1)}>
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-8 text-center font-black font-mono">{qty}</span>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => stepQty(1)}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button disabled={!product.inStock || paused} onClick={add}
              className="flex-1 h-14 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-primary/20">
              {paused ? 'Shop briefly paused' : product.inStock ? `Add to cart · ${fmt((price + optionDeltaCents) * qty)}` : 'Sold out'}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-[11px] font-bold',
                product.inStock ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <span className={cn('h-2 w-2 rounded-full', product.inStock ? 'bg-emerald-600' : 'bg-muted-foreground/40')} aria-hidden="true" />
              {product.inStock
                ? (product.lowStock ? `Only ${product.qtyAvailable} left` : 'In stock')
                : 'Sold out'}
            </span>
          </div>

          {cfg.showTrust && (
          <div className="grid grid-cols-3 gap-2">
            {[
              fulfil.offersPickup
                ? { icon: Truck, title: 'Fast local pickup', sub: 'Ready same day when in stock' }
                : { icon: Truck, title: 'Ships to you', sub: 'Live carrier rates at checkout' },
              { icon: RotateCcw, title: 'Easy returns', sub: 'Start one from your order page' },
              { icon: ShieldCheck, title: 'Secure checkout', sub: 'Card details never touch us' },
            ].map((t) => (
              <div key={t.title} className="rounded-2xl border-2 bg-white p-3 text-center">
                <t.icon className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
                <p className="mt-1.5 text-[11px] font-black uppercase tracking-tight leading-tight">{t.title}</p>
                <p className="mt-0.5 text-[11px] font-bold text-muted-foreground leading-tight">{t.sub}</p>
              </div>
            ))}
          </div>
          )}

          {product.howToUse && (
            <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
              <CardContent className="p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  <p className="text-[10px] font-black uppercase tracking-widest">How to use</p>
                </div>
                <p className="text-sm font-bold text-muted-foreground leading-relaxed whitespace-pre-line">{product.howToUse}</p>
              </CardContent>
            </Card>
          )}

          {product.specs.length > 0 && (
            <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-primary" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Specifications</p>
                </div>
                <div>
                  {product.specs.map((s, i) => (
                    <div key={s.label + i}
                      className={cn('flex items-start justify-between gap-4 py-2', i > 0 && 'border-t border-dashed')}>
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground shrink-0">{s.label}</p>
                      <p className="text-xs font-bold text-right">{s.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {product.documents.length > 0 && (
            <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <FileDown className="w-4 h-4 text-primary" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Documents &amp; downloads</p>
                </div>
                <div className="space-y-2">
                  {product.documents.map((d, i) => (
                    <a key={d.url + i} href={d.url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-3 rounded-2xl border-2 p-3 hover:border-primary/40 transition-all">
                      <div className="w-9 h-9 rounded-xl border-2 bg-muted/10 flex items-center justify-center shrink-0">
                        <FileDown className="w-4 h-4 text-primary" />
                      </div>
                      <p className="text-xs font-black uppercase tracking-tight flex-1 min-w-0 truncate">{d.name}</p>
                      <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Open</span>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
          {cfg.showRelated && related.length > 0 && (
            <section aria-labelledby="related-heading" className="space-y-3 pt-2">
              <h2 id="related-heading" className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                You may also like
              </h2>
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
                {related.map((r) => (
                  <Link
                    key={r.id}
                    href={`/shop/${tenantId}/product/${r.id}`}
                    className="w-36 shrink-0 overflow-hidden rounded-[1.5rem] border-2 bg-white"
                  >
                    <div className="relative aspect-square bg-muted/20">
                      {r.imageUrls?.[0] ? (
                        <Image src={r.imageUrls[0]} alt={r.name} fill sizes="144px" className="object-cover" />
                      ) : null}
                    </div>
                    <div className="p-2.5">
                      <p className="line-clamp-2 text-[11px] font-black uppercase leading-tight tracking-tight">{r.name}</p>
                      <p className="mt-1 font-mono text-sm font-bold">{fmt(r.priceCents)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {cfg.showFaq && (
          <section aria-labelledby="faq-heading" className="space-y-2 pt-2">
            <h2 id="faq-heading" className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              Good to know
            </h2>
            {(cfg.faq && cfg.faq.length > 0 ? cfg.faq : [
              fulfil.offersPickup
                ? { q: 'How long until my order is ready?', a: 'Pickup orders are usually ready the same day. You get an email the moment yours is packed, and the order page shows live status.' }
                : { q: 'How fast do you ship?', a: 'Orders are packed within a day or two and you get tracking by email the moment a label is bought.' },
              { q: 'What is the return policy?', a: 'Start a return from your order page once it has been picked up or delivered — choose the items and a reason, and the shop takes it from there.' },
              fulfil.offersShipping
                ? { q: 'Do you ship?', a: 'Yes. Shipping is quoted live at checkout from your address, so you see real carrier options and prices before paying.' }
                : { q: 'Is this pickup only?', a: 'Yes — orders are collected in person, and you get a QR code to show when you arrive.' },
            ]).map((f: { q: string; a: string }) => (
              <details key={f.q} className="rounded-2xl border-2 bg-white px-4 py-3">
                <summary className="cursor-pointer list-none text-xs font-black uppercase tracking-tight">
                  {f.q}
                </summary>
                <p className="mt-2 text-sm font-bold leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </section>
          )}

        </main>

      {showBar && product.inStock && !paused && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-black uppercase tracking-tight">{product.name}</p>
              <p className="font-mono text-sm font-bold">{fmt((price + optionDeltaCents) * qty)}</p>
            </div>
            <Button onClick={add} className="h-12 shrink-0 rounded-2xl px-6 font-black uppercase text-xs tracking-widest">
              Add to cart
            </Button>
          </div>
        </div>
      )}
      </div>
    );
}
