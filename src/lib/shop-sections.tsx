'use client';

import { ArrowRight, Car, HelpCircle, MapPin, Package, Phone, Quote, Sparkles, Timer, Truck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ─── src/lib/shop-sections.tsx ────────────────────────────────────────────────
// The shop landing system — same mental model as the booking page builder
// (sections array with per-section layout + props, saved on the tenant,
// rendered identically in the designer preview and the live storefront) but
// scoped for commerce. Config lives at retailSettings.shopPageConfig.
//
// Section types:
//   hero         — sales headline + image + CTA (split | centered | immersive)
//   drop         — live countdown to a launch/sale moment
//   featured     — hand-picked products (up to 4), tap-through to product pages
//   banner       — CTA strip (solid | outline)
//   story        — image + text split (imageLeft | imageRight)
//   testimonials — quote strip
//
// The renderer is pure display: pass it the config, the public product list,
// and the tenantId. Unknown section types are skipped, every field has a
// fallback, and images only render on real URLs — a half-edited config can
// never break the storefront.

import {
  SHOP_SECTION_DEFS, defaultShopConfig, newShopSection, sanitizeShopConfig,
  type ShopPageConfig, type ShopSection, type ShopSectionProduct, type ShopSectionType,
} from '@/lib/shop-config';

export {
  SHOP_SECTION_DEFS, defaultShopConfig, newShopSection, sanitizeShopConfig,
};
export type { ShopPageConfig, ShopSection, ShopSectionProduct, ShopSectionType };

/* ── helpers ────────────────────────────────────────────────────────────── */

const isUrl = (u: any) => typeof u === 'string' && /^https?:\/\//i.test(u);
const fmt = (cents: number) =>
  ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function ShopImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  return (
    <div className={cn('relative overflow-hidden bg-muted/10', className)}>
      {isUrl(url) ? (
        <Image src={url} alt={alt} fill className="object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="w-8 h-8 opacity-10" />
        </div>
      )}
    </div>
  );
}

/* ── sections ───────────────────────────────────────────────────────────── */

function HeroSection({ s, onShopNow }: { s: ShopSection; onShopNow: () => void }) {
  const p = s.props;
  const layout = s.layout || 'split';
  if (layout === 'immersive') {
    return (
      <section className="relative rounded-[2.5rem] overflow-hidden border-2 min-h-[320px] flex items-end">
        <ShopImage url={p.imageUrl} alt="" className="absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="relative p-8 space-y-3 text-white">
          <h2 className="font-black uppercase tracking-tighter text-3xl leading-none">{p.headline || 'Shop'}</h2>
          {p.subhead && <p className="text-sm font-bold text-white/80 max-w-md">{p.subhead}</p>}
          <Button onClick={onShopNow} className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl">
            {p.ctaLabel || 'Shop now'} <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </section>
    );
  }
  if (layout === 'centered') {
    return (
      <section className="rounded-[2.5rem] border-2 bg-white p-10 text-center space-y-4">
        <h2 className="font-black uppercase tracking-tighter text-3xl leading-none">{p.headline || 'Shop'}</h2>
        {p.subhead && <p className="text-sm font-bold text-muted-foreground max-w-md mx-auto">{p.subhead}</p>}
        <Button onClick={onShopNow} className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">
          {p.ctaLabel || 'Shop now'} <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </section>
    );
  }
  return (
    <section className="rounded-[2.5rem] border-2 bg-white overflow-hidden grid md:grid-cols-2">
      <div className="p-8 flex flex-col justify-center space-y-3">
        <h2 className="font-black uppercase tracking-tighter text-3xl leading-none">{p.headline || 'Shop'}</h2>
        {p.subhead && <p className="text-sm font-bold text-muted-foreground">{p.subhead}</p>}
        <div>
          <Button onClick={onShopNow} className="h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20">
            {p.ctaLabel || 'Shop now'} <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>
      <ShopImage url={p.imageUrl} alt={p.headline || ''} className="min-h-[220px]" />
    </section>
  );
}

function DropSection({ s }: { s: ShopSection }) {
  const p = s.props;
  const [left, setLeft] = useState<number | null>(null);
  const ends = p.endsAt ? new Date(p.endsAt).getTime() : NaN;

  useEffect(() => {
    if (!Number.isFinite(ends)) { setLeft(null); return; }
    const tick = () => setLeft(Math.max(0, ends - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [ends]);

  if (!Number.isFinite(ends)) return null;
  const done = left !== null && left <= 0;

  const units = left === null ? null : {
    d: Math.floor(left / 86_400_000),
    h: Math.floor((left % 86_400_000) / 3_600_000),
    m: Math.floor((left % 3_600_000) / 60_000),
    s: Math.floor((left % 60_000) / 1000),
  };

  const inner = done ? (
    <p className="font-black uppercase tracking-tight text-lg">{p.endedText || 'It\u2019s live!'}</p>
  ) : units && (
    <div className="flex items-center gap-3">
      {([['D', units.d], ['H', units.h], ['M', units.m], ['S', units.s]] as [string, number][]).map(([u, v]) => (
        <div key={u} className="text-center">
          <p className="font-black font-mono text-2xl tabular-nums leading-none">{String(v).padStart(2, '0')}</p>
          <p className="text-[8px] font-black uppercase tracking-widest opacity-60 mt-1">{u}</p>
        </div>
      ))}
    </div>
  );

  if ((s.layout || 'band') === 'card') {
    return (
      <section className="rounded-[2.5rem] border-2 bg-white p-8 text-center space-y-3">
        <div className="flex items-center justify-center gap-2">
          <Timer className="w-4 h-4 text-primary" />
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{p.title || 'Coming soon'}</p>
        </div>
        <div className="flex justify-center">{inner}</div>
      </section>
    );
  }
  return (
    <section className="rounded-[2.5rem] overflow-hidden border-2 bg-foreground text-background p-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Timer className="w-4 h-4" />
        <p className="font-black uppercase tracking-tight text-sm">{p.title || 'Coming soon'}</p>
      </div>
      {inner}
    </section>
  );
}

function FeaturedSection({ s, products, tenantId }: {
  s: ShopSection; products: ShopSectionProduct[]; tenantId: string;
}) {
  const ids: string[] = Array.isArray(s.props.productIds) ? s.props.productIds : [];
  const picks = ids.map((id) => products.find((p) => p.id === id)).filter(Boolean) as ShopSectionProduct[];
  if (picks.length === 0) return null;
  const duo = (s.layout || 'row') === 'duo';

  return (
    <section className="space-y-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">{s.props.title || 'Featured'}</p>
      <div className={cn('grid gap-4', duo ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2 md:grid-cols-4')}>
        {picks.slice(0, 4).map((p) => (
          <Link key={p.id} href={`/shop/${tenantId}/product/${p.id}`}
            className="rounded-[1.75rem] border-2 bg-white overflow-hidden hover:border-primary/40 transition-all block">
            <ShopImage url={p.imageUrls[0] || ''} alt={p.name} className={duo ? 'aspect-[4/3]' : 'aspect-square'} />
            <div className="p-3 space-y-0.5">
              <p className="font-black uppercase tracking-tight text-xs leading-tight line-clamp-2">{p.name}</p>
              <p className="font-black text-sm text-primary">{fmt(p.priceCents)}</p>
              {!p.inStock && <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Sold out</p>}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function BannerSection({ s, onShopNow }: { s: ShopSection; onShopNow: () => void }) {
  const solid = (s.layout || 'solid') === 'solid';
  return (
    <section className={cn('rounded-[2.5rem] border-2 p-6 flex flex-wrap items-center justify-between gap-4',
      solid ? 'bg-primary text-primary-foreground border-primary' : 'bg-white')}>
      <p className="font-black uppercase tracking-tight text-sm">{s.props.text || ''}</p>
      <Button onClick={onShopNow} variant={solid ? 'secondary' : 'default'}
        className="h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest">
        {s.props.ctaLabel || 'Shop now'} <ArrowRight className="ml-1.5 h-4 w-4" />
      </Button>
    </section>
  );
}

function StorySection({ s }: { s: ShopSection }) {
  const right = s.layout === 'imageRight';
  return (
    <section className="rounded-[2.5rem] border-2 bg-white overflow-hidden grid md:grid-cols-2">
      <ShopImage url={s.props.imageUrl} alt="" className={cn('min-h-[220px]', right && 'md:order-2')} />
      <div className="p-8 flex flex-col justify-center space-y-3">
        <h3 className="font-black uppercase tracking-tighter text-2xl leading-tight">{s.props.title || ''}</h3>
        {s.props.body && (
          <p className="text-sm font-bold text-muted-foreground leading-relaxed whitespace-pre-line">{s.props.body}</p>
        )}
      </div>
    </section>
  );
}

function TestimonialsSection({ s }: { s: ShopSection }) {
  const quotes: { quote: string; name: string }[] = Array.isArray(s.props.quotes) ? s.props.quotes : [];
  if (quotes.length === 0) return null;
  return (
    <section className="space-y-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">{s.props.title || 'Reviews'}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {quotes.slice(0, 6).map((q, i) => (
          <div key={i} className="rounded-[1.75rem] border-2 bg-white p-5 space-y-2">
            <Quote className="w-4 h-4 text-primary" />
            <p className="text-sm font-bold text-muted-foreground leading-relaxed">{q.quote}</p>
            <p className="text-[9px] font-black uppercase tracking-widest">{q.name}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PoliciesSection({ s }: { s: ShopSection }) {
  const p = s.props;
  const cards = [
    { icon: Package, label: 'Pickup', text: p.pickupText },
    { icon: Car, label: 'Curbside', text: p.curbsideText },
    { icon: Truck, label: 'Shipping', text: p.shippingText },
  ].filter((c) => String(c.text || '').trim());
  if (cards.length === 0) return null;
  const stacked = s.layout === 'stacked';
  return (
    <section className="space-y-3">
      {p.title && <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">{p.title}</p>}
      <div className={cn('grid gap-3', stacked ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-3')}>
        {cards.map((c) => (
          <div key={c.label} className={cn('rounded-[1.75rem] border-2 bg-white p-5', stacked && 'flex items-start gap-4')}>
            <div className={cn('w-10 h-10 rounded-xl border-2 bg-primary/5 flex items-center justify-center shrink-0', !stacked && 'mb-3')}>
              <c.icon className="w-4 h-4 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest">{c.label}</p>
              <p className="text-sm font-bold text-muted-foreground leading-relaxed">{c.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LocatorSection({ s }: { s: ShopSection }) {
  const p = s.props;
  if (!String(p.address || '').trim() && !String(p.hours || '').trim()) return null;
  const banner = s.layout === 'banner';
  const directions = isUrl(p.mapsUrl) ? p.mapsUrl : null;
  return (
    <section className={cn('rounded-[2.5rem] border-2 overflow-hidden',
      banner ? 'bg-foreground text-background p-6 flex flex-wrap items-center justify-between gap-4' : 'bg-white p-7 space-y-4')}>
      <div className={cn(banner ? 'flex items-center gap-4 flex-wrap' : 'space-y-3')}>
        <div className="flex items-center gap-2">
          <MapPin className={cn('w-4 h-4', banner ? '' : 'text-primary')} />
          <p className="text-[10px] font-black uppercase tracking-widest">{p.title || 'Find us'}</p>
        </div>
        {p.address && <p className={cn('font-black uppercase tracking-tight text-sm whitespace-pre-line', !banner && 'text-lg')}>{p.address}</p>}
        {p.hours && (
          <p className={cn('text-sm font-bold whitespace-pre-line', banner ? 'opacity-70' : 'text-muted-foreground')}>{p.hours}</p>
        )}
        {p.phone && (
          <p className={cn('text-[11px] font-black uppercase tracking-widest flex items-center gap-1.5', banner ? 'opacity-70' : 'text-muted-foreground')}>
            <Phone className="w-3.5 h-3.5" /> {p.phone}
          </p>
        )}
      </div>
      {directions && (
        <Button asChild variant={banner ? 'secondary' : 'default'}
          className="h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest">
          <a href={directions} target="_blank" rel="noreferrer">Get directions <ArrowRight className="ml-1.5 h-4 w-4" /></a>
        </Button>
      )}
    </section>
  );
}

function FaqSection({ s }: { s: ShopSection }) {
  const items: { q: string; a: string }[] = Array.isArray(s.props.items) ? s.props.items : [];
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <HelpCircle className="w-3.5 h-3.5 text-primary" />
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{s.props.title || 'FAQ'}</p>
      </div>
      <div className="space-y-2">
        {items.slice(0, 16).map((it, i) => (
          <details key={i} className="group rounded-[1.5rem] border-2 bg-white overflow-hidden">
            <summary className="list-none cursor-pointer p-4 flex items-center justify-between gap-3">
              <p className="font-black uppercase tracking-tight text-xs">{it.q}</p>
              <span className="w-6 h-6 rounded-lg border-2 flex items-center justify-center text-xs font-black shrink-0 transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="px-4 pb-4 text-sm font-bold text-muted-foreground leading-relaxed">{it.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

const MARQUEE_CSS = `
@keyframes cf-shop-marquee { from { transform: translateX(0); } to { transform: translateX(-100%); } }
.cf-shop-marquee { animation: cf-shop-marquee var(--cf-marquee-s, 22s) linear infinite; }
@media (prefers-reduced-motion: reduce) { .cf-shop-marquee { animation: none; } }
`;

function MarqueeSection({ s }: { s: ShopSection }) {
  const text = String(s.props.text || '').trim();
  if (!text) return null;
  const layout = s.layout || 'scroll';
  if (layout === 'pulse') {
    return (
      <section className="rounded-[2.5rem] border-2 bg-primary text-primary-foreground py-4 px-6 text-center">
        <p className="font-black uppercase tracking-widest text-sm animate-pulse">{text}</p>
      </section>
    );
  }
  const speed = layout === 'fast' ? '12s' : '22s';
  const chunk = (
    <div className="cf-shop-marquee flex items-center shrink-0" style={{ ['--cf-marquee-s' as any]: speed }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <span key={i} className="mx-6 font-black uppercase tracking-widest text-sm whitespace-nowrap">{text} ✦</span>
      ))}
    </div>
  );
  return (
    <section className="rounded-[2.5rem] border-2 bg-foreground text-background py-3.5 overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: MARQUEE_CSS }} />
      <div className="flex w-max">
        {chunk}
        <div aria-hidden="true" className="flex">{chunk}</div>
      </div>
    </section>
  );
}

/* ── error isolation (mirrors the booking builder's preview boundary) ───── */

class SectionBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('[shop-section]', error); }
  render() {
    if (this.state.failed) return null; // a broken section vanishes; the shop survives
    return this.props.children;
  }
}

/* ── the public renderer ────────────────────────────────────────────────── */

export function ShopSectionsRenderer({
  config, products, tenantId, onShopNow,
}: {
  config: ShopPageConfig | null | undefined;
  products: ShopSectionProduct[];
  tenantId: string;
  onShopNow: () => void;
}) {
  const sections = (config?.sections || []).filter((s) => s.enabled !== false);
  if (sections.length === 0) return null;
  return (
    <div className="max-w-5xl mx-auto px-4 pt-6 space-y-5">
      {sections.map((s) => (
        <SectionBoundary key={s.id}>
          {s.type === 'hero' && <HeroSection s={s} onShopNow={onShopNow} />}
          {s.type === 'drop' && <DropSection s={s} />}
          {s.type === 'featured' && <FeaturedSection s={s} products={products} tenantId={tenantId} />}
          {s.type === 'banner' && <BannerSection s={s} onShopNow={onShopNow} />}
          {s.type === 'story' && <StorySection s={s} />}
          {s.type === 'testimonials' && <TestimonialsSection s={s} />}
          {s.type === 'policies' && <PoliciesSection s={s} />}
          {s.type === 'locator' && <LocatorSection s={s} />}
          {s.type === 'faq' && <FaqSection s={s} />}
          {s.type === 'marquee' && <MarqueeSection s={s} />}
        </SectionBoundary>
      ))}
    </div>
  );
}
