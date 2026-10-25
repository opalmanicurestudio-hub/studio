'use client';
// src/components/shop/product/ProductLayouts.tsx — THE PRODUCT PAGE, put together the way the shop's layout
// (lib/shop-site) says:
//   Atelier   — photos stacked beside a quiet buy column, details folded away, add to bag or buy it now.
//   Maison    — tall photos, fine type, choices as words, one dark button, then "complete the look".
//   Index     — a thumbnail rail, every choice listed with its stock, details as a table beside the questions.
//   Spotlight — a big product stage, pill choices, three promises, then "complete the routine".
//   Bento     — the photos and the buy box as two tiles, then tiles for use, reviews, pairings, delivery and questions.
// The page works out prices, stock, the ship-by promise and the bag; this file only lays them out.
import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Minus, Package, Plus, Star } from 'lucide-react';
import type { SiteLayout } from '@/lib/shop-site';
import { cn } from '@/lib/utils';

export type ViewChoice = { id: string; label: string; deltaCents?: number; priceCents?: number; wholesalePriceCents?: number | null; inStock?: boolean; lowStock?: boolean };
export type ViewGroup = { id: string; name: string; variants?: boolean; choices: ViewChoice[] };
export type ViewProduct = {
  id: string; name: string; category: string; sku: string; description: string; howToUse: string;
  specs: { label: string; value: string }[]; documents: { name: string; url: string }[]; imageUrls: string[];
  videoUrl?: string; optionGroups?: ViewGroup[]; wholesaleMinQty: number | null;
};
export type ViewRelated = { id: string; name: string; priceCents: number; priceVaries?: boolean; imageUrls?: string[] };
export type ViewReview = { id: string; rating: number; title: string; body: string; author: string; at: string };
export type ViewTrust = { title: string; sub: string };

/** Everything the page has worked out, ready to lay out. */
export type ProductViewProps = {
  layout: SiteLayout; dark: boolean; tenantId: string; shopName: string;
  product: ViewProduct;
  priceCents: number; strikeCents: number | null; unitCents: number;
  wholesale: boolean; canBuy: boolean; paused: boolean; lowNow: boolean; leftNow: number | null;
  digital: boolean;
  /** What the buy button says (add to bag, pre-order, buy now, sold out, paused). */
  buyLabel: string;
  /** The status line under the button (in stock, only N left, pre-order dates, instant access). */
  status: string;
  qty: number; qtyMin: number; qtyMax: number; stepQty: (d: number) => void; onAdd: () => void; onBuyNow: () => void;
  /** The second button's label in Atelier (buy it now, pre-order now); none hides it. */
  buyNowLabel: string | null;
  selections: Record<string, string>; onSelect: (groupId: string, choiceId: string) => void;
  showVideo: boolean;
  /** The ship-by card and the restock alert, as the page builds them. */
  promise: React.ReactNode; restock: React.ReactNode; together: React.ReactNode;
  trust: ViewTrust[] | null;
  related: ViewRelated[]; reviews: ViewReview[]; reviewAvg: number; reviewCount: number;
  faq: { q: string; a: string }[] | null;
};

const fmt = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const head: React.CSSProperties = { fontWeight: 'var(--shop-head-weight, 500)' as any, letterSpacing: 'var(--shop-head-track, -0.02em)' };
const radius = (k: 'card' | 'control' | 'pill' = 'card'): React.CSSProperties => ({ borderRadius: `var(--shop-radius-${k})` });
const spaced: React.CSSProperties = { textTransform: 'uppercase', letterSpacing: 'var(--shop-label-track, .14em)', fontSize: 11, fontWeight: 600 };
const muted: React.CSSProperties = { color: 'var(--shop-muted)' };
const line: React.CSSProperties = { borderColor: 'var(--shop-line)' };

const RELATED_TITLE: Record<SiteLayout, string> = { atelier: 'You may also like', maison: 'Complete the look', index: 'Related products', spotlight: 'Complete the routine', bento: 'Pairs well with' };

// ─── Photos ──────────────────────────────────────────────────────────────────────

function Shot({ src, alt, className, sizes, priority, style }: { src?: string; alt: string; className?: string; sizes: string; priority?: boolean; style?: React.CSSProperties }) {
  return (
    <div className={cn('relative overflow-hidden', className)} style={{ background: 'var(--shop-tint)', ...style }}>
      {src ? <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
        : <div className="absolute inset-0 flex items-center justify-center"><Package className="h-12 w-12 opacity-15" aria-hidden="true" /></div>}
    </div>);
}

function Gallery({ v, kind }: { v: ProductViewProps; kind: 'stack' | 'rail' | 'carousel' }) {
  const imgs = v.product.imageUrls.length ? v.product.imageUrls : [''];
  const [i, setI] = React.useState(0);
  const cur = Math.min(i, imgs.length - 1);
  const video = v.showVideo && v.product.videoUrl
    ? <video src={v.product.videoUrl} controls playsInline preload="metadata" className="w-full bg-black" style={radius('card')}>Your browser can&rsquo;t play this video.</video> : null;
  const tall = v.layout === 'maison';

  if (kind === 'stack') {
    // Every photo in view: the first big, the rest two by two. On a phone they swipe.
    return (
      <div className="space-y-2">
        <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 lg:hidden" aria-label="Photos">
          {imgs.map((u, n) => <Shot key={n} src={u} alt={n === 0 ? v.product.name : `${v.product.name}, photo ${n + 1}`} sizes="90vw" priority={n === 0}
            className={cn('w-[86%] shrink-0 snap-center', tall ? 'aspect-[4/5]' : 'aspect-square', imgs.length === 1 && 'w-full')} style={radius('card')} />)}
        </div>
        <div className="hidden gap-2 lg:grid lg:grid-cols-2">
          {imgs.map((u, n) => <Shot key={n} src={u} alt={n === 0 ? v.product.name : `${v.product.name}, photo ${n + 1}`} sizes={n === 0 ? '55vw' : '28vw'} priority={n === 0}
            className={cn(n === 0 ? 'col-span-2' : '', n === 0 ? (tall ? 'aspect-[4/5]' : 'aspect-square') : tall ? 'aspect-[3/4]' : 'aspect-[4/5]', n === imgs.length - 1 && n % 2 === 1 && 'col-span-2 aspect-[16/9]')} style={radius('card')} />)}
        </div>
        {video}
      </div>);
  }

  const main = <Shot src={imgs[cur]} alt={cur === 0 ? v.product.name : `${v.product.name}, photo ${cur + 1}`} sizes="(min-width: 1024px) 50vw, 100vw" priority className="aspect-square w-full" style={radius('card')} />;

  if (kind === 'carousel') {
    return (
      <div className="space-y-3">
        <div className="relative">
          {main}
          {imgs.length > 1 && (
            <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-2">
              <button type="button" aria-label="Previous photo" onClick={() => setI((cur - 1 + imgs.length) % imgs.length)} className="flex h-11 w-11 items-center justify-center rounded-full shadow-sm" style={{ background: 'var(--shop-card)', color: 'var(--shop-ink)' }}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
              <div className="flex h-11 items-center gap-1.5 rounded-full px-3" style={{ background: 'var(--shop-card)' }}>
                {imgs.map((_, n) => <button key={n} type="button" aria-label={`Photo ${n + 1} of ${imgs.length}`} aria-pressed={n === cur} onClick={() => setI(n)} className="flex h-11 w-7 items-center justify-center"><span className={cn('block h-1.5 rounded-full transition-all', n === cur ? 'w-4' : 'w-1.5')} style={{ background: 'var(--shop-ink)', opacity: n === cur ? 1 : 0.4 }} /></button>)}
              </div>
              <button type="button" aria-label="Next photo" onClick={() => setI((cur + 1) % imgs.length)} className="flex h-11 w-11 items-center justify-center rounded-full shadow-sm" style={{ background: 'var(--shop-card)', color: 'var(--shop-ink)' }}><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
            </div>)}
        </div>
        {video}
      </div>);
  }

  // A rail of thumbnails: down the side on a computer, along the bottom on a phone.
  return (
    <div className="space-y-3">
      <div className="flex flex-col-reverse gap-3 lg:flex-row">
        {imgs.length > 1 && (
          <div className="flex gap-2 overflow-x-auto lg:w-20 lg:shrink-0 lg:flex-col lg:overflow-visible" role="group" aria-label="Photos">
            {imgs.map((u, n) => (
              <button key={n} type="button" onClick={() => setI(n)} aria-label={`Photo ${n + 1} of ${imgs.length}`} aria-pressed={n === cur}
                className={cn('relative h-16 w-16 shrink-0 overflow-hidden border-2 transition-opacity lg:h-20 lg:w-20', n === cur ? '' : 'opacity-60 hover:opacity-100')}
                style={{ ...radius('control'), borderColor: n === cur ? 'var(--shop-ink)' : 'transparent', background: 'var(--shop-tint)' }}>
                {u && <Image src={u} alt="" fill sizes="80px" className="object-cover" />}
              </button>))}
          </div>)}
        <div className="min-w-0 flex-1">{main}</div>
      </div>
      {video}
    </div>);
}

// ─── Choosing and buying ─────────────────────────────────────────────────────────

function choiceText(g: ViewGroup, c: ViewChoice, wholesale: boolean) {
  const varies = !!g.variants && new Set(g.choices.map((x) => x.priceCents)).size > 1;
  const own = wholesale && c.wholesalePriceCents != null ? c.wholesalePriceCents : c.priceCents;
  return { price: g.variants ? (varies && own != null ? fmt(own) : '') : c.deltaCents ? `+${fmt(c.deltaCents)}` : '', soldOut: !!g.variants && c.inStock === false };
}

function Choices({ v }: { v: ProductViewProps }) {
  const groups = v.product.optionGroups || [];
  if (!groups.length) return null;
  const L = v.layout;
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const picked = v.selections[g.id] || g.choices[0]?.id;
        const pickedLabel = g.choices.find((c) => c.id === picked)?.label || '';
        const labelId = `choice-${g.id}`;
        return (
          <div key={g.id} className="space-y-2">
            <p id={labelId} className="text-sm" style={L === 'maison' ? spaced : undefined}>
              {L === 'maison' ? `${g.name} · ${pickedLabel}` : <>{g.name}: <span className="font-semibold">{pickedLabel}</span></>}
            </p>
            {L === 'index' && g.variants ? (
              <div role="group" aria-labelledby={labelId} className="overflow-hidden cf-line" style={{ ...radius('control'), ...line }}>
                {g.choices.map((c, n) => {
                  const on = picked === c.id; const t = choiceText(g, c, v.wholesale);
                  return (
                    <button key={c.id} type="button" aria-pressed={on} onClick={() => v.onSelect(g.id, c.id)}
                      className={cn('flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm', n > 0 && 'border-t')}
                      style={{ ...line, background: on ? 'var(--shop-tint)' : 'transparent', boxShadow: on ? 'inset 3px 0 0 var(--shop-ink)' : 'none' }}>
                      <span className={on ? 'font-semibold' : ''}>{c.label}{t.price ? ` · ${t.price}` : ''}</span>
                      <span className="text-xs" style={{ color: t.soldOut ? 'var(--shop-muted)' : c.lowStock ? (v.dark ? '#e0a458' : '#b45309') : 'var(--shop-muted)' }}>{t.soldOut ? 'Sold out' : c.lowStock ? 'Low stock' : 'In stock'}</span>
                    </button>);
                })}
              </div>
            ) : (
              <div role="group" aria-labelledby={labelId} className={cn('flex flex-wrap', L === 'maison' ? 'gap-5' : 'gap-2')}>
                {g.choices.map((c) => {
                  const on = picked === c.id; const t = choiceText(g, c, v.wholesale);
                  const text = `${c.label}${t.price ? ` · ${t.price}` : ''}${t.soldOut ? ' · sold out' : ''}`;
                  if (L === 'maison') {
                    return <button key={c.id} type="button" aria-pressed={on} onClick={() => v.onSelect(g.id, c.id)}
                      className="h-11 min-w-11 border-b px-1 text-sm transition-colors" style={{ borderColor: on ? 'var(--shop-ink)' : 'transparent', color: on ? 'var(--shop-ink)' : 'var(--shop-muted)' }}>{text}</button>;
                  }
                  const pill = L === 'spotlight' || L === 'bento';
                  return (
                    <button key={c.id} type="button" aria-pressed={on} onClick={() => v.onSelect(g.id, c.id)}
                      className={cn('inline-flex h-11 items-center gap-2 cf-line px-4 text-sm transition-colors', t.soldOut && !on && 'opacity-60')}
                      style={{ ...(pill ? { borderRadius: 999 } : radius('control')),
                        borderColor: on ? 'var(--shop-ink)' : 'var(--shop-line)', borderWidth: on && L === 'spotlight' ? 2 : 1,
                        background: on && L !== 'spotlight' ? 'var(--shop-ink)' : L === 'bento' ? 'var(--shop-card)' : 'transparent',
                        color: on && L !== 'spotlight' ? 'var(--shop-surface)' : 'var(--shop-ink)' }}>
                      {text}
                    </button>);
                })}
              </div>)}
          </div>);
      })}
    </div>);
}

function Stepper({ v, big }: { v: ProductViewProps; big?: boolean }) {
  if (v.digital) return null;
  return (
    <div className={cn('inline-flex shrink-0 items-center cf-line', big ? 'h-14' : 'h-12')} style={{ ...(v.layout === 'spotlight' || v.layout === 'bento' ? { borderRadius: 999 } : radius('control')), ...line, background: v.layout === 'bento' ? 'var(--shop-card)' : 'transparent' }}>
      <button type="button" aria-label="Decrease quantity" disabled={v.qty <= v.qtyMin} onClick={() => v.stepQty(-1)} className="flex h-11 w-11 items-center justify-center disabled:opacity-30"><Minus className="h-4 w-4" aria-hidden="true" /></button>
      <output className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite" aria-label={`Quantity ${v.qty}`}>{v.qty}</output>
      <button type="button" aria-label="Increase quantity" disabled={v.qty >= v.qtyMax} onClick={() => v.stepQty(1)} className="flex h-11 w-11 items-center justify-center disabled:opacity-30"><Plus className="h-4 w-4" aria-hidden="true" /></button>
    </div>);
}

function BuyButton({ v, look = 'solid', className, id }: { v: ProductViewProps; look?: 'solid' | 'outline'; className?: string; id?: string }) {
  const L = v.layout; const off = !v.canBuy || v.paused;
  return (
    <button id={id} type="button" disabled={off} onClick={v.onAdd}
      className={cn('inline-flex h-12 min-w-0 flex-1 items-center justify-center px-6 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50', (L === 'spotlight' || L === 'bento') && 'h-14 text-base', look === 'outline' && 'cf-line', className)}
      style={{ ...(L === 'spotlight' || L === 'bento' ? { borderRadius: 999 } : L === 'maison' ? { borderRadius: 0 } : radius('control')),
        ...(look === 'solid' ? { background: 'var(--shop-brand)', color: 'var(--shop-on-brand)' } : { borderColor: 'var(--shop-ink)', color: 'var(--shop-ink)' }),
        ...(L === 'maison' ? { textTransform: 'uppercase', letterSpacing: '.14em', fontSize: 12, fontWeight: 500 } : {}) }}>
      {v.buyLabel}
    </button>);
}

function PriceLine({ v, size }: { v: ProductViewProps; size: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p className={cn('tabular-nums', size)} style={v.layout === 'maison' ? { fontWeight: 200 } : { fontWeight: v.layout === 'spotlight' || v.layout === 'bento' ? 700 : 500 }}>{fmt(v.priceCents)}</p>
      {v.strikeCents != null && <p className="text-sm line-through tabular-nums" style={muted}>{fmt(v.strikeCents)}</p>}
      {v.wholesale && (v.product.wholesaleMinQty || 0) > 0 && <p className="text-sm" style={muted}>Wholesale minimum {v.product.wholesaleMinQty}</p>}
    </div>);
}

function Status({ v }: { v: ProductViewProps }) {
  return (
    <p className="flex items-center gap-2 text-sm" aria-live="polite">
      <span className="h-2 w-2 shrink-0 rounded-full" aria-hidden="true" style={{ background: v.canBuy ? (v.dark ? '#7fd1a5' : '#1f7a4d') : 'var(--shop-muted)' }} />
      <span style={v.canBuy ? undefined : muted}>{v.status}</span>
    </p>);
}

function Stars({ avg, count, href }: { avg: number; count: number; href: string }) {
  if (count <= 0) return null;
  return (
    <a href={href} className="inline-flex min-h-11 items-center gap-2 text-sm underline-offset-4 hover:underline">
      <span className="flex" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn('h-4 w-4', n <= Math.round(avg) ? 'fill-current' : 'opacity-25')} />)}</span>
      <span>{avg.toFixed(1)} from {count} {count === 1 ? 'review' : 'reviews'}</span>
    </a>);
}

function Crumbs({ v }: { v: ProductViewProps }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm" style={muted}>
      <Link href={`/shop/${v.tenantId}/catalog`} className="hover:underline">Shop</Link>
      {v.product.category && <><span aria-hidden="true">/</span><Link href={`/shop/${v.tenantId}/catalog?category=${encodeURIComponent(v.product.category)}`} className="truncate hover:underline">{v.product.category}</Link></>}
      <span aria-hidden="true">/</span><span className="truncate" aria-current="page" style={{ color: 'var(--shop-ink)' }}>{v.product.name}</span>
    </nav>);
}

// ─── The folded details ──────────────────────────────────────────────────────────

type Fold = { id: string; title: string; body: React.ReactNode };

function folds(v: ProductViewProps, withDescription: boolean, withDelivery = true): Fold[] {
  const p = v.product; const out: Fold[] = [];
  if (withDescription && p.description) out.push({ id: 'desc', title: v.layout === 'maison' ? 'Details' : 'Description', body: <p className="whitespace-pre-line">{p.description}</p> });
  if (p.howToUse) out.push({ id: 'use', title: 'How to use', body: <p className="whitespace-pre-line">{p.howToUse}</p> });
  if (p.specs.length) out.push({ id: 'specs', title: 'Specifications', body: <SpecTable v={v} /> });
  if (p.documents.length) out.push({ id: 'docs', title: 'Documents and downloads', body: <Docs v={v} /> });
  if (withDelivery && v.trust?.length) out.push({ id: 'delivery', title: v.digital ? 'Access and delivery' : 'Delivery and returns', body: <ul className="space-y-2">{v.trust.map((t) => <li key={t.title}><span className="font-semibold" style={{ color: 'var(--shop-ink)' }}>{t.title}.</span> {t.sub}</li>)}</ul> });
  return out;
}

function Folds({ v, items }: { v: ProductViewProps; items: Fold[] }) {
  if (!items.length) return null;
  return (
    <div className="border-b" style={line}>
      {items.map((f, n) => (
        <details key={f.id} open={n === 0 && v.layout !== 'atelier'} className="group border-t" style={line}>
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 text-[15px] [&::-webkit-details-marker]:hidden" style={v.layout === 'maison' ? spaced : { fontWeight: v.layout === 'spotlight' || v.layout === 'bento' ? 600 : 500 }}>
            {f.title}
            <Plus className="h-4 w-4 shrink-0 transition-transform group-open:rotate-45 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <div className="pb-5 text-[15px] leading-relaxed" style={muted}>{f.body}</div>
        </details>))}
    </div>);
}

function SpecTable({ v }: { v: ProductViewProps }) {
  const rows = [...(v.product.sku ? [{ label: 'SKU', value: v.product.sku }] : []), ...v.product.specs];
  return (
    <table className="w-full border-collapse text-[15px]">
      <tbody>{rows.map((s, n) => (
        <tr key={s.label + n} className="border-t first:border-t-0" style={line}>
          <th scope="row" className="w-2/5 py-2.5 pr-4 text-left align-top font-normal" style={muted}>{s.label}</th>
          <td className="py-2.5 align-top" style={{ color: 'var(--shop-ink)' }}>{s.value}</td>
        </tr>))}</tbody>
    </table>);
}

function Docs({ v }: { v: ProductViewProps }) {
  return (
    <ul className="space-y-2">{v.product.documents.map((d, n) => (
      <li key={d.url + n}><a href={d.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-between gap-3 cf-line px-4" style={{ ...radius('control'), ...line, color: 'var(--shop-ink)' }}>
        <span className="truncate">{d.name}</span><span className="shrink-0 text-sm" style={muted}>Open</span></a></li>))}
    </ul>);
}

// ─── Below the fold: related, reviews, questions ─────────────────────────────────

function Related({ v, cols }: { v: ProductViewProps; cols: string }) {
  if (!v.related.length) return null;
  const L = v.layout;
  const shown = v.related.slice(0, L === 'index' ? 6 : L === 'atelier' ? 4 : 3);
  return (
    <section aria-labelledby="related-heading" className="space-y-6">
      <h2 id="related-heading" className={cn(L === 'maison' ? '' : 'text-2xl sm:text-3xl', L === 'atelier' && 'text-center')} style={L === 'maison' ? spaced : head}>{RELATED_TITLE[L]}</h2>
      <ul className={cn('grid gap-4', cols)}>
        {shown.map((r) => (
          <li key={r.id}>
            <Link href={`/shop/${v.tenantId}/product/${r.id}`} className="group block space-y-2.5">
              <Shot src={r.imageUrls?.[0]} alt="" sizes="(min-width: 1024px) 25vw, 50vw" className={L === 'maison' ? 'aspect-[4/5]' : 'aspect-square'} style={L === 'maison' ? undefined : radius('card')} />
              <span className="block text-[15px] leading-snug">{r.name}</span>
              <span className="block text-sm tabular-nums" style={muted}>{r.priceVaries ? 'From ' : ''}{fmt(r.priceCents)}</span>
            </Link>
          </li>))}
      </ul>
    </section>);
}

function Reviews({ v }: { v: ProductViewProps }) {
  if (v.reviewCount <= 0) return null;
  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24 space-y-6">
      <div className={cn('flex flex-wrap items-end justify-between gap-3', v.layout === 'atelier' && 'flex-col items-center text-center')}>
        <h2 id="reviews-heading" className="text-2xl sm:text-3xl" style={v.layout === 'maison' ? { ...head, fontWeight: 200 } : head}>Customer reviews</h2>
        <p className="flex items-center gap-2 text-sm" style={muted}><Star className="h-4 w-4 fill-current" aria-hidden="true" style={{ color: 'var(--shop-ink)' }} /><span style={{ color: 'var(--shop-ink)' }} className="font-semibold">{v.reviewAvg.toFixed(1)}</span> from {v.reviewCount} {v.reviewCount === 1 ? 'buyer' : 'buyers'}</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {v.reviews.slice(0, 6).map((r) => (
          <li key={r.id} className="space-y-2 p-5" style={{ ...radius('card'), background: 'var(--shop-tint)' }}>
            <p className="flex" role="img" aria-label={`${r.rating} out of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} aria-hidden="true" className={cn('h-4 w-4', n <= r.rating ? 'fill-current' : 'opacity-25')} />)}</p>
            {r.title && <p className="font-semibold">{r.title}</p>}
            {r.body && <p className="text-[15px] leading-relaxed" style={muted}>{r.body}</p>}
            <p className="text-sm" style={muted}>{r.author}{r.at ? ` · ${new Date(r.at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}</p>
          </li>))}
      </ul>
    </section>);
}

function Questions({ v, title = 'Questions' }: { v: ProductViewProps; title?: string }) {
  if (!v.faq?.length) return null;
  return (
    <section aria-labelledby="faq-heading" className="space-y-4">
      <h2 id="faq-heading" className="text-2xl" style={v.layout === 'maison' ? spaced : head}>{title}</h2>
      <div className="border-b" style={line}>
        {v.faq.map((f, n) => (
          <details key={n} className="group border-t" style={line}>
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">{f.q}<Plus className="h-4 w-4 shrink-0 transition-transform group-open:rotate-45 motion-reduce:transition-none" aria-hidden="true" /></summary>
            <p className="pb-5 text-[15px] leading-relaxed" style={muted}>{f.a}</p>
          </details>))}
      </div>
    </section>);
}

function TrustChips({ v }: { v: ProductViewProps }) {
  if (!v.trust?.length) return null;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {v.trust.map((t) => <li key={t.title} className="p-3.5" style={{ ...radius('card'), background: 'var(--shop-tint)' }}><p className="text-sm font-semibold">{t.title}</p><p className="mt-0.5 text-[13px] leading-snug" style={muted}>{t.sub}</p></li>)}
    </ul>);
}

// ─── The page, per layout ────────────────────────────────────────────────────────

export function ProductView(v: ProductViewProps) {
  const L = v.layout; const p = v.product;
  const reviewsHref = '#reviews';

  if (L === 'bento') {
    const tile = (bg = 'var(--shop-card)'): React.CSSProperties => ({ ...radius('card'), background: bg, boxShadow: 'var(--shop-card-shadow)' });
    const lines = p.howToUse.split(/\n+/).map((s) => s.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);
    // Numbered only when it is a list; a single paragraph reads as written.
    const steps = lines.length > 1 ? lines : [];
    return (
      <main className="mx-auto max-w-6xl space-y-3 px-4 py-4">
        <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
          <div className="p-3" style={tile('var(--shop-tint)')}><Gallery v={v} kind="carousel" /></div>
          <div className="flex flex-col gap-5 p-6 sm:p-8" style={tile('var(--shop-accent-soft, var(--shop-tint))')}>
            <div className="space-y-2">
              <Crumbs v={v} />
              <h1 className="text-3xl leading-[1.05] sm:text-4xl" style={head}>{p.name}</h1>
              <div className="flex flex-wrap items-center gap-x-3"><PriceLine v={v} size="text-xl" /><Stars avg={v.reviewAvg} count={v.reviewCount} href={reviewsHref} /></div>
            </div>
            <Choices v={v} />
            {v.promise}
            <Status v={v} />
            <div className="mt-auto flex items-center gap-3 pt-2"><Stepper v={v} big /><BuyButton v={v} id="buy-main" /></div>
            {v.restock}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {(steps.length > 0 || p.howToUse || p.description) && (
            <section aria-labelledby="use-heading" className="space-y-4 p-6" style={tile()}>
              <h2 id="use-heading" className="text-xl" style={head}>{steps.length || p.howToUse ? 'How to use it' : 'About it'}</h2>
              {steps.length ? <ol className="space-y-3">{steps.map((s, n) => <li key={n} className="flex items-start gap-3 text-[15px]"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold" style={{ background: 'var(--shop-tint)' }}>{n + 1}</span><span className="pt-1">{s}</span></li>)}</ol>
                : <p className="whitespace-pre-line text-[15px] leading-relaxed" style={muted}>{p.howToUse || p.description}</p>}
            </section>)}
          {v.reviewCount > 0 && (
            <a href={reviewsHref} className="flex flex-col justify-between gap-6 p-6" style={tile()}>
              <span className="text-sm" style={muted}>Reviews</span>
              <span><span className="text-5xl tabular-nums" style={head}>{v.reviewAvg.toFixed(1)}</span> <span className="text-sm" style={muted}>from {v.reviewCount}</span></span>
              <span className="text-sm font-semibold underline underline-offset-4">Read them</span>
            </a>)}
          {v.related.length > 0 && (
            <section aria-labelledby="pairs-heading" className="space-y-3 p-6" style={tile()}>
              <h2 id="pairs-heading" className="text-xl" style={head}>{RELATED_TITLE.bento}</h2>
              <ul className="space-y-2">{v.related.slice(0, 3).map((r) => (
                <li key={r.id}><Link href={`/shop/${v.tenantId}/product/${r.id}`} className="flex min-h-14 items-center gap-3">
                  <Shot src={r.imageUrls?.[0]} alt="" sizes="48px" className="h-12 w-12 shrink-0" style={radius('control')} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{r.name}</span><span className="block text-sm tabular-nums" style={muted}>{r.priceVaries ? 'From ' : ''}{fmt(r.priceCents)}</span></span>
                  <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </Link></li>))}</ul>
            </section>)}
        </div>
        {(p.description && steps.length > 0) || p.specs.length > 0 || p.documents.length > 0 || v.trust?.length ? (
          <div className="grid gap-3 md:grid-cols-2 md:items-start">
            {(p.description && steps.length > 0) || p.specs.length || p.documents.length ? (
              <section aria-labelledby="details-heading" className="space-y-4 p-6" style={tile()}>
                <h2 id="details-heading" className="text-xl" style={head}>Details</h2>
                {p.description && steps.length > 0 && <p className="whitespace-pre-line text-[15px] leading-relaxed" style={muted}>{p.description}</p>}
                {p.specs.length > 0 && <SpecTable v={v} />}
                {p.documents.length > 0 && <Docs v={v} />}
              </section>) : null}
            {v.trust?.length ? (
              <section aria-labelledby="delivery-heading" className="space-y-4 p-6" style={tile('var(--shop-tint)')}>
                <h2 id="delivery-heading" className="text-xl" style={head}>{v.digital ? 'Access and delivery' : 'Delivery and returns'}</h2>
                <ul className="grid gap-4 sm:grid-cols-3">{v.trust.map((t) => <li key={t.title}><p className="text-sm font-semibold">{t.title}</p><p className="mt-0.5 text-[13px] leading-snug" style={muted}>{t.sub}</p></li>)}</ul>
              </section>) : null}
          </div>) : null}
        {v.together && <div className="p-6" style={tile()}>{v.together}</div>}
        {v.reviewCount > 0 && <div className="p-6" style={tile()}><Reviews v={v} /></div>}
        {v.faq?.length ? <div className="p-6" style={tile('var(--shop-tint)')}><Questions v={v} /></div> : null}
      </main>);
  }

  if (L === 'index') {
    return (
      <main className="mx-auto max-w-6xl space-y-14 px-4 py-6">
        <div className="space-y-4">
          <Crumbs v={v} />
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
            <Gallery v={v} kind="rail" />
            <div className="space-y-5">
              <div className="space-y-1">
                <h1 className="text-3xl leading-tight sm:text-4xl" style={head}>{p.name}</h1>
                <Stars avg={v.reviewAvg} count={v.reviewCount} href={reviewsHref} />
              </div>
              <PriceLine v={v} size="text-2xl" />
              {p.description && <p className="whitespace-pre-line text-[15px] leading-relaxed" style={muted}>{p.description}</p>}
              <Choices v={v} />
              <div className="flex items-center gap-3"><Stepper v={v} /><BuyButton v={v} id="buy-main" /></div>
              <Status v={v} />
              {v.promise}
              {v.restock}
              {v.together}
            </div>
          </div>
        </div>
        <div className="grid gap-10 lg:grid-cols-2">
          {(p.specs.length > 0 || p.sku || p.documents.length > 0 || p.howToUse || v.trust?.length) && <section aria-labelledby="details-heading" className="space-y-4"><h2 id="details-heading" className="text-2xl" style={head}>Details</h2>{(p.specs.length > 0 || p.sku) && <SpecTable v={v} />}{p.documents.length > 0 && <Docs v={v} />}{p.howToUse && <div className="space-y-1 pt-2"><h3 className="font-semibold">How to use</h3><p className="whitespace-pre-line text-[15px] leading-relaxed" style={muted}>{p.howToUse}</p></div>}{v.trust?.length ? <div className="pt-2"><TrustChips v={v} /></div> : null}</section>}
          <Questions v={v} />
        </div>
        <Reviews v={v} />
        <Related v={v} cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" />
      </main>);
  }

  // Atelier, Maison and Spotlight: photos on one side, a buy column on the other.
  const maison = L === 'maison'; const spot = L === 'spotlight';
  return (
    <main className={cn('mx-auto max-w-6xl px-4', maison ? 'space-y-24 py-8' : 'space-y-16 py-6 sm:py-8')}>
      <div className={cn('grid gap-8', spot ? 'lg:grid-cols-[1.1fr_1fr] lg:gap-12' : 'lg:grid-cols-[1.2fr_1fr] lg:gap-14')}>
        <Gallery v={v} kind={spot ? 'rail' : 'stack'} />
        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-2">
            <Crumbs v={v} />
            <h1 className={cn('leading-[1.05]', maison ? 'text-4xl sm:text-5xl' : spot ? 'text-4xl sm:text-6xl' : 'text-3xl sm:text-4xl')} style={head}>{p.name}</h1>
            {spot && <Stars avg={v.reviewAvg} count={v.reviewCount} href={reviewsHref} />}
          </div>
          <div className="space-y-1">
            <PriceLine v={v} size={spot ? 'text-3xl' : 'text-xl'} />
            {L === 'atelier' && !v.digital && <p className="text-sm" style={muted}>Taxes and delivery worked out at checkout.</p>}
          </div>
          {maison && p.description && <p className="whitespace-pre-line text-[15px] leading-relaxed" style={muted}>{p.description}</p>}
          <Choices v={v} />
          {L === 'atelier' ? (
            <div className="space-y-3">
              {!v.digital && <div className="space-y-2"><p className="text-sm">Quantity</p><Stepper v={v} /></div>}
              <BuyButton v={v} look={v.digital ? 'solid' : 'outline'} className="w-full" id="buy-main" />
              {v.buyNowLabel && <button type="button" onClick={v.onBuyNow} className="inline-flex h-12 w-full items-center justify-center text-sm font-semibold transition-opacity hover:opacity-90" style={{ ...radius('control'), background: 'var(--shop-brand)', color: 'var(--shop-on-brand)' }}>{v.buyNowLabel}</button>}
            </div>
          ) : maison ? (
            <div className="space-y-3"><div className="flex items-center gap-3"><Stepper v={v} /><BuyButton v={v} id="buy-main" /></div></div>
          ) : (
            <div className="flex items-center gap-3"><Stepper v={v} big /><BuyButton v={v} id="buy-main" /></div>
          )}
          <Status v={v} />
          {v.promise}
          {v.restock}
          {spot && <TrustChips v={v} />}
          <Folds v={v} items={folds(v, !maison, !spot)} />
        </div>
      </div>
      {v.together && <div className="mx-auto max-w-3xl">{v.together}</div>}
      <Related v={v} cols={maison || spot ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 lg:grid-cols-4'} />
      <Reviews v={v} />
      <div className="mx-auto max-w-3xl"><Questions v={v} title={maison ? 'Questions' : 'Good to know'} /></div>
    </main>);
}
