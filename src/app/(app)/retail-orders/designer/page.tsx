'use client';

import { doc, setDoc, type Firestore } from 'firebase/firestore';
import {
  ArrowDown, ArrowLeft, ArrowUp, Eye, EyeOff, Loader, Paintbrush, Plus, Trash2, X,
} from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  SHOP_SECTION_DEFS, ShopSectionsRenderer, defaultShopConfig, newShopSection, sanitizeShopConfig,
  type ShopPageConfig, type ShopSection, type ShopSectionProduct, type ShopSectionType,
} from '@/lib/shop-sections';
import {
  DEFAULT_THEME, THEME_PRESETS, contrastRatio, readableOn, sanitizeTheme,
  type ShopTheme,
} from '@/lib/shop-theme';
import { cn } from '@/lib/utils';

// ─── Shop Designer ────────────────────────────────────────────────────────────
// The sales-landing builder for the storefront — the shop's version of the
// booking page builder. Add sections, reorder, toggle, edit props, and watch
// the live preview render with the EXACT components the storefront uses, fed
// by your real retail products. Save writes retailSettings.shopPageConfig;
// the shop reflects it on next load.

export default function ShopDesignerPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { inventory } = useInventory();
  const { toast } = useToast();

  const [config, setConfig] = useState<ShopPageConfig>(defaultShopConfig());
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState<ShopTheme>(DEFAULT_THEME);

  useEffect(() => {
    if (loaded || !selectedTenant) return;
    setTheme(sanitizeTheme((selectedTenant as any)?.retailSettings?.shopTheme));
    const raw = (selectedTenant as any)?.retailSettings?.shopPageConfig;
    setConfig(raw ? sanitizeShopConfig(raw) : defaultShopConfig());
    setLoaded(true);
  }, [selectedTenant, loaded]);

  const liveProducts: ShopSectionProduct[] = useMemo(
    () => (inventory || [])
      .filter((i: any) => i.type === 'retail' && i.status !== 'archived' && i.showOnline === true && (i.msrp ?? 0) > 0)
      .map((i: any) => ({
        id: i.id,
        name: i.name,
        priceCents: Math.round((i.msrp || 0) * 100),
        imageUrls: Array.isArray(i.imageUrls) ? i.imageUrls : [],
        inStock: (i.totalStock - (i.stockReserved || 0)) > 0 || i.allowBackorder === true,
      })),
    [inventory]
  );

  const selected = config.sections.find((s) => s.id === selectedId) || null;

  const mutate = (fn: (c: ShopPageConfig) => ShopPageConfig) => setConfig((c) => fn({ sections: [...c.sections] }));

  const updateSection = (id: string, patch: Partial<ShopSection>) =>
    mutate((c) => ({ sections: c.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const updateProps = (id: string, key: string, value: any) =>
    mutate((c) => ({
      sections: c.sections.map((s) => (s.id === id ? { ...s, props: { ...s.props, [key]: value } } : s)),
    }));

  const move = (id: string, dir: -1 | 1) =>
    mutate((c) => {
      const i = c.sections.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= c.sections.length) return c;
      const next = [...c.sections];
      [next[i], next[j]] = [next[j], next[i]];
      return { sections: next };
    });

  const remove = (id: string) => {
    mutate((c) => ({ sections: c.sections.filter((s) => s.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const add = (type: ShopSectionType) => {
    const sec = newShopSection(type);
    mutate((c) => ({ sections: [...c.sections, sec] }));
    setSelectedId(sec.id);
    setAddOpen(false);
  };

  const save = async () => {
    if (!firestore || !tenantId || saving) return;
    setSaving(true);
    try {
      await setDoc(doc(firestore as Firestore, 'tenants', tenantId), {
        retailSettings: {
          shopPageConfig: JSON.parse(JSON.stringify(sanitizeShopConfig(config))),
          shopTheme: JSON.parse(JSON.stringify(sanitizeTheme(theme))),
        },
      }, { merge: true });
      toast({ title: 'Shop saved', description: 'Brand, layout and sections go live on next load.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Save failed', description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/5">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-muted/5 pb-28">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Shop Designer</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              {config.sections.length} section{config.sections.length === 1 ? '' : 's'} · landing above your catalog
            </p>
          </div>
          <Button asChild variant="outline" className="h-11 rounded-xl font-black uppercase text-[9px] tracking-widest border-2">
            <a href={`/shop/${tenantId}`} target="_blank" rel="noreferrer">View live</a>
          </Button>
          <Button onClick={save} disabled={saving}
            className="h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-md shadow-primary/20">
            {saving ? <Loader className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Paintbrush className="w-4 h-4 text-primary" />
              <p className="text-[11px] font-black uppercase tracking-widest">Brand &amp; layout</p>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Start from a look</p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {THEME_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setTheme(sanitizeTheme({ ...DEFAULT_THEME, ...p.theme }))}
                    className="shrink-0 rounded-2xl border-2 p-2 text-left transition-shadow hover:shadow-md"
                    style={{ background: (p.theme.surface || DEFAULT_THEME.surface) }}
                  >
                    <span
                      className="block h-10 w-24 rounded-xl"
                      style={{ background: p.theme.brand || DEFAULT_THEME.brand }}
                    />
                    <span
                      className="mt-1.5 block text-[11px] font-black uppercase tracking-widest"
                      style={{ color: p.theme.ink || DEFAULT_THEME.ink }}
                    >
                      {p.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {([
                ['brand', 'Brand'],
                ['ink', 'Text'],
                ['surface', 'Background'],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{label}</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label={`${label} colour`}
                      value={(theme as any)[key]}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTheme({ ...theme, [key]: e.target.value })}
                      className="h-10 w-10 shrink-0 cursor-pointer rounded-xl border-2 bg-white p-1"
                    />
                    <Input
                      value={(theme as any)[key]}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTheme({ ...theme, [key]: e.target.value })}
                      className="h-10 rounded-xl border-2 font-mono text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>

            {contrastRatio(theme.ink, theme.surface) < 4.5 && (
              <p className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-3 text-[11px] font-bold text-amber-800">
                That text colour is hard to read on that background, so the shop will use a readable one instead.
                Pick a darker text colour to keep yours.
              </p>
            )}

            {([
              ['layout', 'Product layout', [['grid', 'Grid'], ['editorial', 'Editorial'], ['list', 'List']]],
              ['corners', 'Corners', [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round']]],
              ['surfaceStyle', 'Cards', [['soft', 'Soft'], ['flat', 'Flat'], ['glass', 'Glass'], ['bordered', 'Bordered']]],
              ['font', 'Type', [['jakarta', 'Modern'], ['serif', 'Classic'], ['rounded', 'Friendly'], ['mono', 'Technical']]],
            ] as const).map(([key, label, opts]) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{label}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {opts.map(([val, name]) => (
                    <button
                      key={val}
                      type="button"
                      aria-pressed={(theme as any)[key] === val}
                      onClick={() => setTheme({ ...theme, [key]: val } as ShopTheme)}
                      className={cn(
                        'h-9 rounded-full border-2 px-3.5 text-[11px] font-black uppercase tracking-widest transition-colors',
                        (theme as any)[key] === val ? 'border-foreground bg-foreground text-background' : 'bg-white'
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Preview</p>
              <div
                className="rounded-2xl border-2 p-4"
                style={{ background: sanitizeTheme(theme).surface, color: sanitizeTheme(theme).ink }}
              >
                <p className="text-base font-bold" style={{ letterSpacing: '-0.02em' }}>Nourishing cuticle oil</p>
                <p className="mt-1 font-mono text-sm">$24.00</p>
                <span
                  className="mt-3 inline-flex h-10 items-center px-4 text-[11px] font-black uppercase tracking-widest"
                  style={{
                    background: theme.brand,
                    color: readableOn(theme.brand),
                    borderRadius: theme.corners === 'sharp' ? '0.25rem' : theme.corners === 'round' ? '999px' : '0.875rem',
                  }}
                >
                  Add to cart
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Paintbrush className="w-4 h-4 text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest">Sections</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setAddOpen(!addOpen)}
                className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                {addOpen ? <X className="mr-1 h-3.5 w-3.5" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
                {addOpen ? 'Close' : 'Add section'}
              </Button>
            </div>

            {addOpen && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {(Object.keys(SHOP_SECTION_DEFS) as ShopSectionType[]).map((t) => (
                  <button key={t} type="button" onClick={() => add(t)}
                    className="rounded-2xl border-2 p-3 text-left hover:border-primary/40 transition-all">
                    <p className="text-[10px] font-black uppercase tracking-widest">{SHOP_SECTION_DEFS[t].label}</p>
                    <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">{SHOP_SECTION_DEFS[t].hint}</p>
                  </button>
                ))}
              </div>
            )}

            {config.sections.length === 0 && !addOpen && (
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 text-center py-6">
                No sections yet — your shop shows just the catalog. Add a hero to start selling the story.
              </p>
            )}

            <div className="space-y-2">
              {config.sections.map((s, i) => (
                <div key={s.id}
                  className={cn('rounded-2xl border-2 p-3 flex items-center gap-2 transition-all',
                    selectedId === s.id ? 'border-primary bg-primary/5' : 'hover:border-primary/30',
                    !s.enabled && 'opacity-50')}>
                  <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}>
                    <p className="text-[10px] font-black uppercase tracking-widest">{SHOP_SECTION_DEFS[s.type].label}</p>
                    <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground truncate">
                      {s.props.headline || s.props.title || s.props.text || SHOP_SECTION_DEFS[s.type].hint}
                    </p>
                  </button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" disabled={i === 0} onClick={() => move(s.id, -1)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" disabled={i === config.sections.length - 1} onClick={() => move(s.id, 1)}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => updateSection(s.id, { enabled: !s.enabled })}>
                    {s.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-destructive/70" onClick={() => remove(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {selected && (
          <Card className="border-2 border-primary rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                  Editing · {SHOP_SECTION_DEFS[selected.type].label}
                </p>
                <div className="flex gap-1.5">
                  {SHOP_SECTION_DEFS[selected.type].layouts.map((l) => (
                    <button key={l.id} type="button" onClick={() => updateSection(selected.id, { layout: l.id })}
                      className={cn('h-8 px-3 rounded-full border-2 text-[8px] font-black uppercase tracking-widest transition-all',
                        (selected.layout || SHOP_SECTION_DEFS[selected.type].layouts[0].id) === l.id
                          ? 'bg-foreground text-background border-foreground' : 'bg-white hover:border-primary/40')}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {selected.type === 'hero' && (
                <div className="space-y-2">
                  <Input placeholder="Headline" value={selected.props.headline || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'headline', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <Textarea placeholder="Subheadline" value={selected.props.subhead || ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateProps(selected.id, 'subhead', e.target.value)}
                    className="rounded-xl border-2 min-h-[56px] font-bold text-sm" />
                  <Input placeholder="Image URL" value={selected.props.imageUrl || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'imageUrl', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-xs" />
                  <Input placeholder="Button label" value={selected.props.ctaLabel || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'ctaLabel', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                </div>
              )}

              {selected.type === 'drop' && (
                <div className="space-y-2">
                  <Input placeholder="Title (e.g. Holiday drop)" value={selected.props.title || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'title', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <div className="space-y-1">
                    <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Counts down to</Label>
                    <Input type="datetime-local" value={selected.props.endsAt || ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'endsAt', e.target.value)}
                      className="h-11 rounded-xl border-2 font-bold text-sm" />
                  </div>
                  <Input placeholder="Text after it hits zero" value={selected.props.endedText || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'endedText', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                </div>
              )}

              {selected.type === 'featured' && (
                <div className="space-y-2">
                  <Input placeholder="Section title" value={selected.props.title || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'title', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    Tap up to 4 live products
                  </Label>
                  <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                    {liveProducts.map((p) => {
                      const ids: string[] = Array.isArray(selected.props.productIds) ? selected.props.productIds : [];
                      const on = ids.includes(p.id);
                      return (
                        <button key={p.id} type="button"
                          onClick={() => updateProps(selected.id, 'productIds',
                            on ? ids.filter((x) => x !== p.id) : ids.length < 4 ? [...ids, p.id] : ids)}
                          className={cn('rounded-xl border-2 p-2.5 text-left transition-all',
                            on ? 'border-primary bg-primary/5' : 'hover:border-primary/30')}>
                          <p className="text-[10px] font-black uppercase tracking-tight line-clamp-1">{p.name}</p>
                          <p className="text-[9px] font-bold text-primary">${(p.priceCents / 100).toFixed(2)}</p>
                        </button>
                      );
                    })}
                    {liveProducts.length === 0 && (
                      <p className="col-span-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                        No live products yet — flip items Live in Shop Settings first.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {selected.type === 'banner' && (
                <div className="space-y-2">
                  <Input placeholder="Banner text" value={selected.props.text || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'text', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <Input placeholder="Button label" value={selected.props.ctaLabel || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'ctaLabel', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                </div>
              )}

              {selected.type === 'story' && (
                <div className="space-y-2">
                  <Input placeholder="Title" value={selected.props.title || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'title', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <Textarea placeholder="Your story" value={selected.props.body || ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateProps(selected.id, 'body', e.target.value)}
                    className="rounded-xl border-2 min-h-[80px] font-bold text-sm" />
                  <Input placeholder="Image URL" value={selected.props.imageUrl || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'imageUrl', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-xs" />
                </div>
              )}

              {selected.type === 'policies' && (
                <div className="space-y-2">
                  <Input placeholder="Section title" value={selected.props.title || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'title', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <Textarea placeholder="Pickup policy (blank hides the card)" value={selected.props.pickupText || ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateProps(selected.id, 'pickupText', e.target.value)}
                    className="rounded-xl border-2 min-h-[52px] font-bold text-sm" />
                  <Textarea placeholder="Curbside policy (blank hides the card)" value={selected.props.curbsideText || ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateProps(selected.id, 'curbsideText', e.target.value)}
                    className="rounded-xl border-2 min-h-[52px] font-bold text-sm" />
                  <Textarea placeholder="Shipping policy (blank hides the card)" value={selected.props.shippingText || ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateProps(selected.id, 'shippingText', e.target.value)}
                    className="rounded-xl border-2 min-h-[52px] font-bold text-sm" />
                </div>
              )}

              {selected.type === 'locator' && (
                <div className="space-y-2">
                  <Input placeholder="Section title (e.g. Find us)" value={selected.props.title || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'title', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <Textarea placeholder="Address" value={selected.props.address || ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateProps(selected.id, 'address', e.target.value)}
                    className="rounded-xl border-2 min-h-[52px] font-bold text-sm" />
                  <Textarea placeholder={'Hours (e.g. Mon-Fri 9-6, Sat 10-4)'} value={selected.props.hours || ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateProps(selected.id, 'hours', e.target.value)}
                    className="rounded-xl border-2 min-h-[52px] font-bold text-sm" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Phone" value={selected.props.phone || ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'phone', e.target.value)}
                      className="h-11 rounded-xl border-2 font-bold text-sm" />
                    <Input placeholder="Google Maps link" value={selected.props.mapsUrl || ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'mapsUrl', e.target.value)}
                      className="h-11 rounded-xl border-2 font-bold text-xs" />
                  </div>
                </div>
              )}

              {selected.type === 'faq' && (
                <div className="space-y-2">
                  <Input placeholder="Section title" value={selected.props.title || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'title', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    One per line as: Question | Answer
                  </Label>
                  <Textarea
                    placeholder={'How fast is pickup? | Usually within the hour.'}
                    value={(Array.isArray(selected.props.items) ? selected.props.items : [])
                      .map((it: any) => `${it.q} | ${it.a}`).join('\n')}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                      const items = e.target.value.split(/\n+/).map((line) => {
                        const idx = line.indexOf('|');
                        if (idx <= 0) return line.trim() ? { q: line.trim(), a: '' } : null;
                        return { q: line.slice(0, idx).trim(), a: line.slice(idx + 1).trim() };
                      }).filter(Boolean).slice(0, 12);
                      updateProps(selected.id, 'items', items);
                    }}
                    className="rounded-xl border-2 min-h-[100px] font-bold text-sm" />
                </div>
              )}

              {selected.type === 'marquee' && (
                <div className="space-y-2">
                  <Input placeholder={'Ticker text (e.g. Free pickup \u00b7 Same-day curbside)'} value={selected.props.text || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'text', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    Scroll speed and pulse are the layout pills above. Motion pauses automatically for reduced-motion visitors.
                  </p>
                </div>
              )}

              {selected.type === 'testimonials' && (
                <div className="space-y-2">
                  <Input placeholder="Section title" value={selected.props.title || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateProps(selected.id, 'title', e.target.value)}
                    className="h-11 rounded-xl border-2 font-bold text-sm" />
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    One per line as: Quote — Name
                  </Label>
                  <Textarea
                    placeholder={'Best pickup experience ever — Maya R.'}
                    value={(Array.isArray(selected.props.quotes) ? selected.props.quotes : [])
                      .map((q: any) => `${q.quote} — ${q.name}`).join('\n')}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                      const quotes = e.target.value.split(/\n+/).map((line) => {
                        const idx = line.lastIndexOf('—');
                        if (idx <= 0) return line.trim() ? { quote: line.trim(), name: '' } : null;
                        return { quote: line.slice(0, idx).trim(), name: line.slice(idx + 1).trim() };
                      }).filter(Boolean).slice(0, 6);
                      updateProps(selected.id, 'quotes', quotes);
                    }}
                    className="rounded-xl border-2 min-h-[90px] font-bold text-sm" />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Badge variant="outline" className="h-6 px-3 font-black text-[8px] uppercase tracking-widest border-2">Live preview</Badge>
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Rendered with the exact storefront components and your real products
            </p>
          </div>
          <div className="rounded-[2.5rem] border-2 border-dashed bg-muted/5 pb-6 overflow-hidden">
            {config.sections.filter((s) => s.enabled).length === 0 ? (
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 text-center py-16">
                Nothing to preview yet
              </p>
            ) : (
              <ShopSectionsRenderer
                config={config}
                products={liveProducts}
                tenantId={tenantId}
                onShopNow={() => toast({ title: 'Shop now', description: 'On the live shop this scrolls to your catalog.' })}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
