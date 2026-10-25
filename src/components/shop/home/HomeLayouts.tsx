'use client';
// src/components/shop/home/HomeLayouts.tsx — THE SHOP'S HOME PAGE, put together the way its layout (lib/shop-site) says:
//   Atelier   — a clear welcome beside a photo, then the range in a classic grid with an add button on every card.
//   Maison    — one full-width photo with fine type, then tall photos with room around them.
//   Index     — straight to the catalog: category tiles, a count, sorting and an in-stock filter, dense cards.
//   Spotlight — one product told big (photo, story, price, add), then the rest.
//   Bento     — a board of tiles (welcome, delivery, categories, gift cards), then a tiled grid.
// The welcome steps aside when the owner has built their own hero in the page designer. The products, bag, prices and
// stock rules are the page's own; this file only decides how they are laid out.
import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Minus, Package, Plus } from 'lucide-react';
import type { SiteLayout } from '@/lib/shop-site';
import { cn } from '@/lib/utils';

export type HomeItem = {
  id: string; name: string; category: string; description: string; imageUrls: string[];
  priceCents: number; priceVaries?: boolean; wholesalePriceCents: number | null; wholesaleMinQty: number | null;
  inStock: boolean; qtyAvailable: number; lowStock: boolean; optionGroups?: any[];
};

/** What every card needs from the page: prices, what is in the bag, and how to change it. */
export type HomeBag = {
  tenantId: string;
  wholesale: boolean;
  priceOf: (p: HomeItem) => number;
  qtyOf: (p: HomeItem) => number;
  /** Puts the first one in the bag (the wholesale minimum for a wholesale buyer). */
  onAdd: (p: HomeItem) => void;
  onQty: (p: HomeItem, qty: number) => void;
};

/** The owner's card setting from Shop settings: the layout's own grid, bigger cards, or a list. */
export type CardStyle = 'grid' | 'showcase' | 'list';

const fmt = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const head: React.CSSProperties = { fontWeight: 'var(--shop-head-weight, 500)' as any, letterSpacing: 'var(--shop-head-track, -0.02em)' };
const radius = (k: 'card' | 'control' | 'pill' = 'card'): React.CSSProperties => ({ borderRadius: `var(--shop-radius-${k})` });
/** Small labels: spaced capitals in the editorial layouts, plain words in the catalog and tile layouts. */
const labelOf = (layout: SiteLayout): React.CSSProperties => (layout === 'index' || layout === 'bento'
  ? { fontWeight: 600 }
  : { textTransform: 'uppercase', letterSpacing: 'var(--shop-label-track, .14em)', fontWeight: 600, fontSize: 11 });
const firstImage = (list: HomeItem[]) => list.find((p) => p.imageUrls?.[0])?.imageUrls[0] || '';
const hasOptions = (p: HomeItem) => (p.optionGroups?.length || 0) > 0;
const productHref = (tenantId: string, p: HomeItem) => `/shop/${tenantId}/product/${p.id}`;

/** The one the Spotlight layout tells big: the first in stock with a photo, else the first in stock, else the first. */
export function spotlightPick(products: HomeItem[]): HomeItem | null {
  return products.find((p) => p.inStock && p.imageUrls?.[0]) || products.find((p) => p.inStock) || products[0] || null;
}

// ─── The add button, the same rules on every layout ──────────────────────────────

function AddControl({ p, bag, look, full }: { p: HomeItem; bag: HomeBag; look: 'solid' | 'outline' | 'text' | 'round'; full?: boolean }) {
  const qty = bag.qtyOf(p);
  if (!p.inStock) {
    return <span className={cn('inline-flex h-11 items-center text-sm', full && 'w-full justify-center')} style={{ color: 'var(--shop-muted)' }}>Sold out</span>;
  }
  if (hasOptions(p)) {
    return (
      <Link href={productHref(bag.tenantId, p)} aria-label={`Choose options for ${p.name}`}
        className={cn('inline-flex h-11 items-center justify-center px-4 text-sm font-semibold transition-colors', full && 'w-full',
          look === 'text' ? 'px-0 underline underline-offset-4' : 'cf-line')}
        style={look === 'text' ? undefined : { ...radius('pill'), borderColor: 'var(--shop-line)' }}>
        Choose options
      </Link>);
  }
  if (qty > 0) {
    return (
      <div className={cn('inline-flex h-11 items-center justify-between gap-0.5 cf-line', full && 'w-full')} style={{ ...radius('pill'), borderColor: 'var(--shop-line)' }}>
        <button type="button" aria-label={`Decrease quantity of ${p.name}`} onClick={() => bag.onQty(p, qty - 1)} className="flex h-11 w-11 items-center justify-center" style={radius('pill')}><Minus className="h-4 w-4" aria-hidden="true" /></button>
        <span className="min-w-6 text-center text-sm font-semibold tabular-nums">{qty}</span>
        <button type="button" aria-label={`Increase quantity of ${p.name}`} disabled={qty >= p.qtyAvailable} onClick={() => bag.onQty(p, qty + 1)} className="flex h-11 w-11 items-center justify-center disabled:opacity-30" style={radius('pill')}><Plus className="h-4 w-4" aria-hidden="true" /></button>
      </div>);
  }
  if (look === 'round') {
    return (
      <button type="button" aria-label={`Add ${p.name} to bag`} onClick={() => bag.onAdd(p)}
        className="flex h-11 w-11 items-center justify-center shadow-sm" style={{ borderRadius: 999, background: 'var(--shop-brand)', color: 'var(--shop-on-brand)' }}>
        <Plus className="h-5 w-5" aria-hidden="true" />
      </button>);
  }
  return (
    <button type="button" onClick={() => bag.onAdd(p)} aria-label={`Add ${p.name} to bag`}
      className={cn('inline-flex h-11 items-center justify-center px-5 text-sm font-semibold transition-opacity hover:opacity-90', full && 'w-full',
        look === 'text' && 'px-0 underline underline-offset-4', look === 'outline' && 'cf-line')}
      style={look === 'solid' ? { ...radius('pill'), background: 'var(--shop-brand)', color: 'var(--shop-on-brand)' }
        : look === 'outline' ? { ...radius('pill'), borderColor: 'var(--shop-ink)' } : undefined}>
      Add to bag
    </button>);
}

function Photo({ p, className, sizes, priority }: { p: HomeItem; className?: string; sizes: string; priority?: boolean }) {
  return (
    <div className={cn('relative overflow-hidden', className)} style={{ background: 'var(--shop-tint)' }}>
      {p.imageUrls?.[0]
        ? <Image src={p.imageUrls[0]} alt={p.name} fill sizes={sizes} priority={priority} className="object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
        : <div className="absolute inset-0 flex items-center justify-center"><Package className="h-8 w-8 opacity-20" aria-hidden="true" /></div>}
    </div>);
}

function Price({ p, bag, className }: { p: HomeItem; bag: HomeBag; className?: string }) {
  const price = bag.priceOf(p);
  const strike = bag.wholesale && p.wholesalePriceCents != null && p.wholesalePriceCents < p.priceCents;
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-1.5 text-sm tabular-nums', className)}>
      <span className="whitespace-nowrap">{p.priceVaries ? 'From ' : ''}{fmt(price)}</span>
      {strike && <span className="whitespace-nowrap text-xs line-through" style={{ color: 'var(--shop-muted)' }}>{fmt(p.priceCents)}</span>}
      {bag.wholesale && p.wholesaleMinQty ? <span className="text-xs" style={{ color: 'var(--shop-muted)' }}>Min {p.wholesaleMinQty}</span> : null}
    </p>);
}

function StockNote({ p, dark }: { p: HomeItem; dark: boolean }) {
  if (!p.inStock || !p.lowStock) return null;
  return <span className="whitespace-nowrap text-xs font-semibold" style={{ color: dark ? '#e0a458' : '#b45309' }}>Almost gone</span>;
}

// ─── One product card per layout ─────────────────────────────────────────────────

function ProductCard({ p, bag, layout, style, dark, big, eager }: { p: HomeItem; bag: HomeBag; layout: SiteLayout; style: CardStyle; dark: boolean; big?: boolean; eager?: boolean }) {
  const href = productHref(bag.tenantId, p);
  const dim = !p.inStock ? 'opacity-60' : '';
  if (style === 'list') {
    return (
      <article className={cn('flex items-center gap-4 cf-line p-3', dim)} style={{ ...radius('card'), borderColor: 'var(--shop-line)', background: 'var(--shop-card)' }}>
        <Link href={href} className="group shrink-0" tabIndex={-1} aria-hidden="true"><Photo p={p} sizes="80px" className="h-20 w-20" /></Link>
        <div className="min-w-0 flex-1">
          <Link href={href} className="block text-sm font-semibold leading-snug line-clamp-2">{p.name}</Link>
          {p.description && <p className="mt-0.5 text-xs line-clamp-1" style={{ color: 'var(--shop-muted)' }}>{p.description}</p>}
          <div className="mt-1 flex items-center gap-2"><Price p={p} bag={bag} /><StockNote p={p} dark={dark} /></div>
        </div>
        <div className="shrink-0"><AddControl p={p} bag={bag} look="solid" /></div>
      </article>);
  }
  const sizes = style === 'showcase' ? '(min-width: 768px) 50vw, 100vw'
    : layout === 'index' ? '(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw'
      : '(min-width: 1024px) 25vw, 50vw';

  if (layout === 'maison') {
    return (
      <article className={cn('group flex flex-col', dim)}>
        <Link href={href} tabIndex={-1} aria-hidden="true"><Photo p={p} sizes={sizes} priority={eager} className={style === 'showcase' ? 'aspect-[4/3]' : 'aspect-[4/5]'} /></Link>
        <div className="mt-4 space-y-1.5 text-center">
          <Link href={href} className="block text-[13px] leading-snug line-clamp-2" style={{ textTransform: 'uppercase', letterSpacing: '.12em' }}>{p.name}</Link>
          <Price p={p} bag={bag} className="justify-center" />
          <StockNote p={p} dark={dark} />
          <div className="flex justify-center"><AddControl p={p} bag={bag} look="text" /></div>
        </div>
      </article>);
  }
  if (layout === 'index') {
    return (
      <article className={cn('group flex flex-col cf-line p-2', dim)} style={{ ...radius('card'), borderColor: 'var(--shop-line)', background: 'var(--shop-card)' }}>
        <div className="relative">
          <Link href={href} tabIndex={-1} aria-hidden="true"><Photo p={p} sizes={sizes} priority={eager} className={cn('rounded-[var(--shop-radius-control)]', style === 'showcase' ? 'aspect-[4/3]' : 'aspect-square')} /></Link>
          {p.inStock && !hasOptions(p) && bag.qtyOf(p) === 0 && <div className="absolute bottom-2 right-2"><AddControl p={p} bag={bag} look="round" /></div>}
        </div>
        <div className="flex flex-1 flex-col gap-1 px-1 pb-1 pt-2.5">
          <Link href={href} className="text-[13px] font-medium leading-snug line-clamp-2">{p.name}</Link>
          <div className="flex items-center gap-2"><Price p={p} bag={bag} className="font-semibold" /><StockNote p={p} dark={dark} /></div>
          {(!p.inStock || hasOptions(p) || bag.qtyOf(p) > 0) && <div className="mt-auto pt-1"><AddControl p={p} bag={bag} look="outline" full /></div>}
        </div>
      </article>);
  }
  if (layout === 'bento') {
    return (
      <article className={cn('group relative flex flex-col overflow-hidden', dim, big && 'col-span-2 sm:row-span-2')} style={{ ...radius('card'), background: 'var(--shop-card)', boxShadow: 'var(--shop-card-shadow)' }}>
        <Link href={href} tabIndex={-1} aria-hidden="true" className="block flex-1"><Photo p={p} sizes={big ? '(min-width: 640px) 50vw, 100vw' : sizes} priority={eager} className={cn('h-full', big ? 'aspect-square' : 'aspect-[4/3]')} /></Link>
        <div className={cn('flex justify-between gap-3 p-3 sm:p-4', big ? 'items-end' : 'flex-col sm:flex-row sm:items-end')}>
          <div className="min-w-0 space-y-0.5">
            <Link href={href} className={cn('block font-semibold leading-snug line-clamp-2', big ? 'text-lg' : 'text-sm')} style={head}>{p.name}</Link>
            <div className="flex items-center gap-2"><Price p={p} bag={bag} /><StockNote p={p} dark={dark} /></div>
          </div>
          <div className="shrink-0"><AddControl p={p} bag={bag} look="round" /></div>
        </div>
      </article>);
  }
  if (layout === 'spotlight') {
    return (
      <article className={cn('group flex flex-col overflow-hidden p-3', dim)} style={{ ...radius('card'), background: 'var(--shop-tint)' }}>
        <Link href={href} tabIndex={-1} aria-hidden="true"><Photo p={p} sizes={sizes} priority={eager} className={cn(style === 'showcase' ? 'aspect-[4/3]' : 'aspect-square')} /></Link>
        <div className="flex flex-1 flex-col gap-1.5 px-1 pb-1 pt-4">
          <Link href={href} className="text-base font-semibold leading-snug line-clamp-2" style={head}>{p.name}</Link>
          <div className="flex items-center gap-2"><Price p={p} bag={bag} /><StockNote p={p} dark={dark} /></div>
          <div className="mt-auto pt-2"><AddControl p={p} bag={bag} look="solid" full /></div>
        </div>
      </article>);
  }
  // Atelier
  return (
    <article className={cn('group flex flex-col', dim)}>
      <Link href={href} tabIndex={-1} aria-hidden="true" className="block overflow-hidden" style={radius('card')}><Photo p={p} sizes={sizes} priority={eager} className={style === 'showcase' ? 'aspect-[4/3]' : 'aspect-square'} /></Link>
      <div className="flex flex-1 flex-col gap-1 pt-3">
        <Link href={href} className="text-sm font-medium leading-snug line-clamp-2">{p.name}</Link>
        <div className="flex items-center gap-2"><Price p={p} bag={bag} /><StockNote p={p} dark={dark} /></div>
        <div className="mt-auto pt-2"><AddControl p={p} bag={bag} look="outline" full /></div>
      </div>
    </article>);
}

// ─── The welcome at the top ──────────────────────────────────────────────────────

export function HomeIntro({ layout, name, tagline, products, categories, bag, dark, delivery, onShop, onPickCategory, hasGift }: {
  layout: SiteLayout; name: string; tagline: string; products: HomeItem[]; categories: string[]; bag: HomeBag; dark: boolean;
  /** One line about getting the order (free delivery over an amount, or pickup), when the shop offers it. */
  delivery: string | null;
  onShop: () => void; onPickCategory: (c: string) => void; hasGift: boolean;
}) {
  const headline = tagline || `Welcome to ${name}`;
  const photo = firstImage(products);
  const cats = categories.filter((c) => c && c !== 'all' && c !== '__gift');
  const catPhoto = (c: string) => firstImage(products.filter((p) => p.category === c));
  const label = labelOf(layout);
  const shopBtn = (text: string, onDarkPhoto = false) => (
    <button type="button" onClick={onShop} className="inline-flex h-12 items-center justify-center px-7 text-sm font-semibold transition-opacity hover:opacity-90"
      style={onDarkPhoto ? { ...radius('pill'), background: '#fff', color: '#121212' } : { ...radius('pill'), background: 'var(--shop-brand)', color: 'var(--shop-on-brand)' }}>{text}</button>);

  if (layout === 'maison') {
    return (
      <section aria-labelledby="home-welcome" className="relative">
        <div className={cn('relative flex min-h-[420px] items-end justify-center overflow-hidden sm:min-h-[560px] lg:min-h-[640px]', !photo && 'items-center')} style={{ background: 'var(--shop-tint)' }}>
          {photo && <><Image src={photo} alt="" fill priority sizes="100vw" className="object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/35 to-black/10" /></>}
          <div className={cn('relative mx-auto max-w-2xl px-6 pb-14 text-center', photo ? 'text-white' : 'py-20')}>
            <p style={{ ...labelOf('maison'), opacity: 0.85 }}>{name}</p>
            <h2 id="home-welcome" className="mt-4 text-4xl leading-[1.05] sm:text-6xl" style={head}>{headline}</h2>
            <div className="mt-8">
              <button type="button" onClick={onShop} className="inline-flex h-12 items-center cf-line px-8 text-xs transition-colors"
                style={{ textTransform: 'uppercase', letterSpacing: 'var(--shop-label-track, .3em)', borderColor: photo ? 'rgba(255,255,255,.7)' : 'var(--shop-ink)' }}>Discover the collection</button>
            </div>
          </div>
        </div>
      </section>);
  }

  if (layout === 'index') {
    return (
      <section aria-labelledby="home-welcome" className="mx-auto max-w-6xl px-4 pt-6 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="home-welcome" className="text-2xl sm:text-3xl" style={head}>{tagline || `Shop ${name}`}</h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--shop-muted)' }}>{products.length} {products.length === 1 ? 'product' : 'products'}{cats.length > 1 ? ` in ${cats.length} categories` : ''}{delivery ? ` · ${delivery}` : ''}</p>
          </div>
        </div>
        {cats.length > 1 && (
          <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Shop by category">
            {cats.slice(0, 6).map((c) => (
              <li key={c}>
                <button type="button" onClick={() => onPickCategory(c)} className="group flex w-full items-center gap-3 cf-line p-2 text-left" style={{ ...radius('card'), borderColor: 'var(--shop-line)', background: 'var(--shop-card)' }}>
                  <span className="relative h-12 w-12 shrink-0 overflow-hidden" style={{ ...radius('control'), background: 'var(--shop-tint)' }}>
                    {catPhoto(c) && <Image src={catPhoto(c)} alt="" fill sizes="48px" className="object-cover" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{c}</span>
                    <span className="block text-xs" style={{ color: 'var(--shop-muted)' }}>{(() => { const n = products.filter((p) => p.category === c).length; return `${n} ${n === 1 ? 'product' : 'products'}`; })()}</span>
                  </span>
                </button>
              </li>))}
          </ul>)}
      </section>);
  }

  if (layout === 'spotlight') {
    const p = spotlightPick(products);
    if (!p) return null;
    return (
      <section aria-labelledby="home-welcome" className="mx-auto max-w-6xl px-4 pt-6 sm:pt-10">
        <div className="grid items-center gap-6 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
          <Link href={productHref(bag.tenantId, p)} tabIndex={-1} aria-hidden="true" className="group block overflow-hidden" style={radius('card')}>
            <Photo p={p} priority sizes="(min-width: 1024px) 55vw, 100vw" className="aspect-square sm:aspect-[5/4]" />
          </Link>
          <div className="space-y-4">
            <p style={{ ...label, color: 'var(--shop-brand)' }}>{tagline || name}</p>
            <h2 id="home-welcome" className="text-4xl leading-[1.02] sm:text-6xl" style={head}>{p.name}</h2>
            {p.description && <p className="max-w-md text-base leading-relaxed line-clamp-4" style={{ color: 'var(--shop-muted)' }}>{p.description}</p>}
            <div className="flex items-center gap-3"><Price p={p} bag={bag} className="text-xl font-semibold" /><StockNote p={p} dark={dark} /></div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <AddControl p={p} bag={bag} look="solid" />
              <Link href={productHref(bag.tenantId, p)} className="inline-flex h-11 items-center text-sm font-semibold underline underline-offset-4">See the details</Link>
            </div>
            {delivery && <p className="text-sm" style={{ color: 'var(--shop-muted)' }}>{delivery}</p>}
          </div>
        </div>
      </section>);
  }

  if (layout === 'bento') {
    const tiles = cats.slice(0, hasGift ? 3 : 4);
    const count = tiles.length + (hasGift ? 1 : 0);
    // The last tile stretches to close the row: two to a row on a phone, four on a computer.
    const lastSpan = cn(count % 2 === 1 && 'col-span-2', count % 4 === 1 ? 'lg:col-span-4' : count % 4 === 2 ? 'lg:col-span-3' : count % 4 === 3 ? 'lg:col-span-2' : '');
    return (
      <section aria-labelledby="home-welcome" className="mx-auto max-w-6xl px-4 pt-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="col-span-2 flex min-h-[220px] flex-col justify-between gap-6 p-6 sm:p-8" style={{ ...radius('card'), background: 'var(--shop-brand)', color: 'var(--shop-on-brand)' }}>
            <h2 id="home-welcome" className="text-3xl leading-[1.05] sm:text-4xl" style={head}>{headline}</h2>
            <div><button type="button" onClick={onShop} className="inline-flex h-12 items-center px-6 text-sm font-semibold" style={{ ...radius('pill'), background: 'var(--shop-on-brand)', color: 'var(--shop-brand)' }}>Shop everything</button></div>
          </div>
          <div className="flex flex-col justify-between gap-3 p-5" style={{ ...radius('card'), background: 'var(--shop-card)', boxShadow: 'var(--shop-card-shadow)' }}>
            <p className="text-sm" style={{ color: 'var(--shop-muted)' }}>In the shop</p>
            <p className="text-4xl tabular-nums" style={head}>{products.length}</p>
            <p className="text-sm font-semibold">{products.length === 1 ? 'thing to love' : 'things to love'}</p>
          </div>
          <div className="flex flex-col justify-between gap-3 p-5" style={{ ...radius('card'), background: 'var(--shop-accent-soft, var(--shop-tint))' }}>
            <p className="text-sm" style={{ color: 'var(--shop-muted)' }}>{delivery ? 'Getting it' : 'Good to know'}</p>
            <p className="text-lg font-semibold leading-snug" style={head}>{delivery || 'Made to be given and kept'}</p>
          </div>
          {tiles.map((c, i) => (
            <button key={c} type="button" onClick={() => onPickCategory(c)} className={cn('group relative flex min-h-[150px] items-end overflow-hidden p-4 text-left', !hasGift && i === tiles.length - 1 && lastSpan)}
              style={{ ...radius('card'), background: 'var(--shop-tint)' }}>
              {catPhoto(c) && <><Image src={catPhoto(c)} alt="" fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" /><span className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" /></>}
              <span className={cn('relative text-base font-semibold', catPhoto(c) && 'text-white')}>{c}</span>
            </button>))}
          {hasGift && (
            <button type="button" onClick={() => onPickCategory('__gift')} className={cn('flex min-h-[150px] flex-col justify-end p-4 text-left', lastSpan)} style={{ ...radius('card'), background: 'var(--shop-card)', boxShadow: 'var(--shop-card-shadow)' }}>
              <span className="text-sm" style={{ color: 'var(--shop-muted)' }}>For someone else</span>
              <span className="text-base font-semibold">Gift cards</span>
            </button>)}
        </div>
      </section>);
  }

  // Atelier
  return (
    <section aria-labelledby="home-welcome" className="mx-auto max-w-6xl px-4 pt-6 sm:pt-10">
      <div className={cn('grid items-center gap-6 overflow-hidden', photo && 'md:grid-cols-2 md:gap-10')}>
        <div className={cn('space-y-4 py-4', !photo && 'mx-auto max-w-2xl text-center')}>
          <p style={{ ...label, color: 'var(--shop-muted)' }}>{name}</p>
          <h2 id="home-welcome" className="text-4xl leading-[1.05] sm:text-5xl" style={head}>{headline}</h2>
          {delivery && <p className="text-base" style={{ color: 'var(--shop-muted)' }}>{delivery}</p>}
          <div className="pt-2">{shopBtn('Shop now')}</div>
        </div>
        {photo && (
          <div className="relative aspect-[4/3] overflow-hidden md:aspect-square" style={{ ...radius('card'), background: 'var(--shop-tint)' }}>
            <Image src={photo} alt="" fill priority sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
          </div>)}
      </div>
    </section>);
}

// ─── The catalog: categories, then the cards ─────────────────────────────────────

const HEADINGS: Record<SiteLayout, string> = { atelier: 'Shop the range', maison: 'The collection', index: 'All products', spotlight: 'More to love', bento: 'Everything' };
type Sort = 'featured' | 'price-asc' | 'price-desc' | 'name';

export function HomeCatalog({ layout, cardStyle, products, categories, category, setCategory, giftTile, bag, dark, skipId }: {
  layout: SiteLayout; cardStyle: CardStyle;
  /** The products in the chosen category. */
  products: HomeItem[];
  /** 'all', the categories, and '__gift' when the shop sells gift cards. */
  categories: string[]; category: string; setCategory: (c: string) => void;
  giftTile: React.ReactNode; bag: HomeBag; dark: boolean;
  /** Spotlight's big product, which is not shown twice when everything is showing. */
  skipId?: string | null;
}) {
  const [sort, setSort] = React.useState<Sort>('featured');
  const [inStockOnly, setInStockOnly] = React.useState(false);
  const isIndex = layout === 'index';
  const list = React.useMemo(() => {
    let l = products.filter((p) => !(category === 'all' && skipId && p.id === skipId));
    if (isIndex && inStockOnly) l = l.filter((p) => p.inStock);
    if (isIndex && sort !== 'featured') {
      l = [...l].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'price-asc' ? bag.priceOf(a) - bag.priceOf(b) : bag.priceOf(b) - bag.priceOf(a));
    }
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, category, skipId, isIndex, inStockOnly, sort, bag.wholesale]);
  const showGift = !!giftTile && (category === 'all' || category === '__gift');
  const chipName = (c: string) => (c === 'all' ? (layout === 'maison' ? 'All' : 'Everything') : c === '__gift' ? 'Gift cards' : c);
    const grid = cardStyle === 'list' ? 'flex flex-col gap-3'
    : cardStyle === 'showcase' ? 'grid grid-cols-1 gap-6 md:grid-cols-2'
      : layout === 'maison' ? 'grid grid-cols-2 gap-x-4 gap-y-12 lg:grid-cols-3 lg:gap-x-8'
        : layout === 'index' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'
          : layout === 'spotlight' ? 'grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3'
            : layout === 'bento' ? 'grid grid-flow-dense grid-cols-2 gap-3 sm:auto-rows-fr lg:grid-cols-4'
              : 'grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-6';
  const empty = list.length === 0 && category !== '__gift' && !showGift;
  // Spotlight's only product is already told big above: nothing more to list.
  if (empty && skipId && category === 'all' && products.length > 0 && !(isIndex && inStockOnly)) return null;

  return (
    <section aria-labelledby="catalog-heading" id="shop-catalog" className={cn('mx-auto max-w-6xl scroll-mt-24 px-4', layout === 'maison' ? 'pt-16 sm:pt-24' : 'pt-10 sm:pt-14')}>
      <div className={cn('flex flex-col gap-4', layout === 'maison' && 'items-center text-center')}>
        <h2 id="catalog-heading" className={cn(layout === 'maison' ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl')} style={head}>
          {category === 'all' ? (skipId ? HEADINGS[layout] : HEADINGS[layout === 'spotlight' ? 'atelier' : layout]) : chipName(category)}
        </h2>
        {categories.length > 2 && (
          <div role="group" aria-label="Categories" className={cn('flex gap-2 overflow-x-auto pb-1', layout === 'maison' && 'gap-6 self-stretch [justify-content:safe_center]')}>
            {categories.map((c) => {
              const on = category === c;
              if (layout === 'maison') {
                return (
                  <button key={c} type="button" aria-pressed={on} onClick={() => setCategory(c)}
                    className={cn('h-11 shrink-0 border-b text-xs transition-colors', on ? 'border-current' : 'border-transparent')}
                    style={{ textTransform: 'uppercase', letterSpacing: 'var(--shop-label-track, .2em)', color: on ? 'var(--shop-ink)' : 'var(--shop-muted)' }}>{chipName(c)}</button>);
              }
              return (
                <button key={c} type="button" aria-pressed={on} onClick={() => setCategory(c)}
                  className="h-11 shrink-0 cf-line px-4 text-sm font-medium transition-colors"
                  style={{ ...radius('pill'), borderColor: on ? 'var(--shop-ink)' : 'var(--shop-line)', background: on ? 'var(--shop-ink)' : layout === 'bento' ? 'var(--shop-card)' : 'transparent', color: on ? 'var(--shop-surface)' : 'var(--shop-ink)' }}>
                  {chipName(c)}
                </button>);
            })}
          </div>)}
        {isIndex && category !== '__gift' && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-y py-2" style={{ borderColor: 'var(--shop-line)' }}>
            <p className="text-sm" style={{ color: 'var(--shop-muted)' }} aria-live="polite">{list.length} {list.length === 1 ? 'product' : 'products'}</p>
            <div className="flex items-center gap-4">
              <label className="flex h-11 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} className="h-4 w-4" style={{ accentColor: 'var(--shop-brand)' }} />
                In stock only
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span style={{ color: 'var(--shop-muted)' }}>Sort</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-11 cf-line bg-transparent px-3 text-sm" style={{ ...radius('control'), borderColor: 'var(--shop-line)', color: 'var(--shop-ink)' }}>
                  <option value="featured">Featured</option>
                  <option value="price-asc">Price, low to high</option>
                  <option value="price-desc">Price, high to low</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
          </div>)}
      </div>

      <div className={cn('mt-6', grid)}>
        {showGift && giftTile}
        {category !== '__gift' && list.map((p, i) => (
          <ProductCard key={p.id} p={p} bag={bag} layout={layout} style={cardStyle} dark={dark} eager={i < 4}
            big={layout === 'bento' && cardStyle === 'grid' && i === 0 && list.length > 2} />))}
        {empty && (
          <div className="col-span-full space-y-2 py-24 text-center">
            <Package className="mx-auto h-10 w-10 opacity-20" aria-hidden="true" />
            <p className="text-sm" style={{ color: 'var(--shop-muted)' }}>{isIndex && inStockOnly ? 'Nothing in stock here right now' : 'Nothing here yet'}</p>
          </div>)}
      </div>
    </section>);
}
