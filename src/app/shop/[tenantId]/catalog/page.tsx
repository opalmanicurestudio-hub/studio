'use client';

import { ArrowLeft, Loader, PackageX, Search, Store } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import { ShopMenu } from '@/components/shop/ShopMenu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ─── Full catalog ─────────────────────────────────────────────────────────────
// The browsing home a growing shop needs: search, category filters and sort,
// deep-linkable (?category=&q=&sort=) so a category link can be texted to a
// client or pinned on Instagram. Reads the same catalog endpoint the home
// page uses — one source of truth for price, stock and visibility.

interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  imageUrls: string[];
  priceCents: number;
  inStock: boolean;
  qtyAvailable: number;
  lowStock: boolean;
  optionGroups?: { id: string }[];
}

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function CatalogPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const tenantId = String(params?.tenantId || '');

  const [products, setProducts] = useState<Product[]>([]);
  const [shopName, setShopName] = useState('Shop');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState(search?.get('q') || '');
  const [category, setCategory] = useState(search?.get('category') || 'all');
  const [sort, setSort] = useState(search?.get('sort') || 'featured');

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/retail/catalog?tenantId=${encodeURIComponent(tenantId)}`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error || 'Could not load the catalog');
        setProducts(Array.isArray(data.products) ? data.products : []);
        setShopName(data.shop?.name || 'Shop');
      } catch (e: any) {
        if (alive) setError(e?.message || 'Could not load the catalog');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [tenantId]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => { if (p.category) set.add(p.category); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = products.filter((p) => {
      const inCat = category === 'all' || p.category === category;
      const inTerm = !term
        || p.name.toLowerCase().includes(term)
        || (p.description || '').toLowerCase().includes(term)
        || (p.category || '').toLowerCase().includes(term);
      return inCat && inTerm;
    });
    if (sort === 'price-low') list = [...list].sort((a, b) => a.priceCents - b.priceCents);
    if (sort === 'price-high') list = [...list].sort((a, b) => b.priceCents - a.priceCents);
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [products, q, category, sort]);

  // Keep the URL in step so filters survive a share or a reload.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set('q', q.trim());
    if (category !== 'all') sp.set('category', category);
    if (sort !== 'featured') sp.set('sort', sort);
    const qs = sp.toString();
    router.replace(`/shop/${tenantId}/catalog${qs ? `?${qs}` : ''}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, sort]);

  return (
    <div className="min-h-dvh bg-muted/5 pb-20">
      <header className="sticky top-0 z-30 border-b-2 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <ShopMenu
            tenantId={tenantId}
            shopName={shopName}
            categories={categories}
            activeCategory={category === 'all' ? undefined : category}
          />
          <Button asChild variant="ghost" size="icon" aria-label="Back to shop" className="h-10 w-10 rounded-xl shrink-0">
            <Link href={`/shop/${tenantId}`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-black uppercase leading-none tracking-tighter">All products</h1>
            <p className="mt-0.5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              {loading ? 'Loading…' : `${visible.length} item${visible.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-5xl space-y-3 px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
            <label htmlFor="catalog-search" className="sr-only">Search products</label>
            <Input
              id="catalog-search"
              type="search"
              value={q}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
              placeholder="Search products…"
              className="h-12 rounded-2xl border-2 pl-11 text-sm font-bold"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
              <button
                type="button"
                onClick={() => setCategory('all')}
                aria-pressed={category === 'all'}
                className={cn(
                  'h-9 shrink-0 rounded-full border-2 px-3.5 text-[11px] font-black uppercase tracking-widest transition-colors',
                  category === 'all' ? 'border-foreground bg-foreground text-background' : 'bg-white'
                )}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  aria-pressed={category === c}
                  className={cn(
                    'h-9 shrink-0 rounded-full border-2 px-3.5 text-[11px] font-black uppercase tracking-widest transition-colors',
                    category === c ? 'border-foreground bg-foreground text-background' : 'bg-white'
                  )}
                >
                  {c}
                </button>
              ))}
            </div>

            <label htmlFor="catalog-sort" className="sr-only">Sort products</label>
            <select
              id="catalog-sort"
              value={sort}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSort(e.target.value)}
              className="h-9 shrink-0 rounded-full border-2 bg-white px-3 text-[11px] font-black uppercase tracking-widest"
            >
              <option value="featured">Featured</option>
              <option value="name">A–Z</option>
              <option value="price-low">Price ↑</option>
              <option value="price-high">Price ↓</option>
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {loading && (
          <div className="py-24 text-center">
            <Loader className="mx-auto h-7 w-7 animate-spin text-primary" aria-label="Loading products" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-[2rem] border-2 border-dashed py-20 text-center">
            <Store className="mx-auto h-8 w-8 opacity-20" aria-hidden="true" />
            <p className="mt-3 text-sm font-bold text-muted-foreground">{error}</p>
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="rounded-[2rem] border-2 border-dashed py-20 text-center">
            <PackageX className="mx-auto h-8 w-8 opacity-20" aria-hidden="true" />
            <p className="mt-3 text-sm font-bold">Nothing matches that yet</p>
            <p className="mt-1 text-xs font-bold text-muted-foreground">Try another word, or browse all products.</p>
            <Button
              variant="outline"
              onClick={() => { setQ(''); setCategory('all'); }}
              className="mt-5 h-11 rounded-2xl border-2 text-[11px] font-black uppercase tracking-widest"
            >
              Clear filters
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {visible.map((p) => (
            <Link
              key={p.id}
              href={`/shop/${tenantId}/product/${p.id}`}
              className="group overflow-hidden rounded-[1.5rem] border-2 bg-white transition-shadow hover:shadow-lg focus-visible:shadow-lg"
            >
              <div className="relative aspect-square bg-muted/20">
                {p.imageUrls?.[0] ? (
                  <Image
                    src={p.imageUrls[0]}
                    alt={p.name}
                    fill
                    sizes="(max-width: 768px) 50vw, 25vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Store className="h-7 w-7 opacity-15" aria-hidden="true" />
                  </div>
                )}
                {!p.inStock && (
                  <span className="absolute left-2 top-2 rounded-full bg-foreground/85 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest text-background">
                    Sold out
                  </span>
                )}
                {p.inStock && p.lowStock && (
                  <span className="absolute left-2 top-2 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest text-amber-800">
                    Only {p.qtyAvailable} left
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="line-clamp-2 text-sm font-black uppercase leading-tight tracking-tight">{p.name}</p>
                <p className="mt-1.5 font-mono text-base font-bold">{fmt(p.priceCents)}</p>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
