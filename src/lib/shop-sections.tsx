'use client';

import { ArrowRight, Quote, Sparkles, Timer } from 'lucide-react';
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

export type ShopSectionType = 'hero' | 'drop' | 'featured' | 'banner' | 'story' | 'testimonials';

export interface ShopSection {
  id: string;
  type: ShopSectionType;
  enabled: boolean;
  layout?: string;
  props: Record<string, any>;
}

export interface ShopPageConfig {
  sections: ShopSection[];
}

export interface ShopSectionProduct {
  id: string;
  name: string;
  priceCents: number;
  imageUrls: string[];
  inStock: boolean;
}

export const SHOP_SECTION_DEFS: Record<ShopSectionType, {
  label: string;
  hint: string;
  layouts: { id: string; label: string }[];
  defaults: Record<string, any>;
}> = {
  hero: {
    label: 'Hero',
    hint: 'The sales headline at the top',
    layouts: [
      { id: 'split', label: 'Split' },
      { id: 'centered', label: 'Centered' },
      { id: 'immersive', label: 'Immersive' },
    ],
    defaults: {
      headline: 'Your favorites, ready today',
      subhead: 'Order online — pick up in minutes or have it shipped to your door.',
      imageUrl: '',
      ctaLabel: 'Shop now',
    },
  },
  drop: {
    label: 'Drop Countdown',
    hint: 'Count down to a launch or sale',
    layouts: [
      { id: 'band', label: 'Band' },
      { id: 'card', label: 'Card' },
    ],
    defaults: {
      title: 'New drop landing soon',
      endsAt: '',
      endedText: 'It\u2019s live — shop the drop below!',
    },
  },
  featured: {
    label: 'Featured Products',
    hint: 'Hand-pick up to 4 to spotlight',
    layouts: [
      { id: 'row', label: 'Row' },
      { id: 'duo', label: 'Big Duo' },
    ],
    defaults: { title: 'Featured', productIds: [] },
  },
  banner: {
    label: 'CTA Banner',
    hint: 'A bold strip that sells one thing',
    layouts: [
      { id: 'solid', label: 'Solid' },
      { id: 'outline', label: 'Outline' },
    ],
    defaults: { text: 'Free counter pickup — ready fast', ctaLabel: 'Browse everything' },
  },
  story: {
    label: 'Story',
    hint: 'Image + your why',
    layouts: [
      { id: 'imageLeft', label: 'Image Left' },
      { id: 'imageRight', label: 'Image Right' },
    ],
    defaults: {
      title: 'Made for people who care about the details',
      body: 'Every product in this shop is one we use ourselves, every day.',
      imageUrl: '',
    },
  },
  testimonials: {
    label: 'Testimonials',
    hint: 'Social proof strip',
    layouts: [{ id: 'strip', label: 'Strip' }],
    defaults: {
      title: 'Loved by our clients',
      quotes: [{ quote: 'The pickup flow is unreal — ordered on my lunch break, grabbed it after work.', name: 'A happy regular' }],
    },
  },
};

export function newShopSection(type: ShopSectionType): ShopSection {
  const def = SHOP_SECTION_DEFS[type];
  return {
    id: `sec-${Math.random().toString(36).slice(2, 9)}`,
    type,
    enabled: true,
    layout: def.layouts[0]?.id,
    props: JSON.parse(JSON.stringify(def.defaults)),
  };
}

export function defaultShopConfig(): ShopPageConfig {
  return { sections: [] };
}

export function sanitizeShopConfig(raw: any): ShopPageConfig {
  const sections = Array.isArray(raw?.sections) ? raw.sections : [];
  return {
    sections: sections
      .filter((s: any) => s && typeof s === 'object' && SHOP_SECTION_DEFS[s.type as ShopSectionType])
      .slice(0, 12)
      .map((s: any) => ({
        id: String(s.id || `sec-${Math.random().toString(36).slice(2, 9)}`),
        type: s.type as ShopSectionType,
        enabled: s.enabled !== false,
        layout: typeof s.layout === 'string' ? s.layout : undefined,
        props: typeof s.props === 'object' && s.props !== null ? s.props : {},
      })),
  };
}

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
        </SectionBoundary>
      ))}
    </div>
  );
}
