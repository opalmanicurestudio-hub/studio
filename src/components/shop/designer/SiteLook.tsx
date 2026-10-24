'use client';
// src/components/shop/designer/SiteLook.tsx — IN THE SHOP DESIGNER: THE WHOLE-SITE LOOK AND THE LOGO.
// Pick a layout (how every page is put together) and a preset (a finished look for it), then the logo: logo only,
// logo and name, or name only; left or centered; small to large; a light version for dark backgrounds and over photos;
// and the small icon for browser tabs. The preview is the shop's real header (components/shop/ShopChrome) in the
// chosen look, on a phone and a computer. The finer settings below (colors, spacing, buttons) still apply on top.
import * as React from 'react';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { ShopHeader, ShopSiteProvider, type ShopSite } from '@/components/shop/ShopChrome';
import { SITE_LAYOUTS, SITE_PRESETS, presetById, type ShopBrand, type SiteLayout } from '@/lib/shop-site';
import { sanitizeTheme, themeToCss, type ShopTheme } from '@/lib/shop-theme';

const C = { ink: '#16171a', muted: '#6d7075', line: '#ececee', soft: '#f5f5f7' };

const cssVars = (theme: ShopTheme): React.CSSProperties => Object.fromEntries(themeToCss(theme).split(';').map((x) => x.split(/:(.+)/)).filter((kv) => kv.length >= 2).map(([k, v]) => [k.trim(), v.trim()])) as React.CSSProperties;
const isDark = (hex: string) => { const h = hex.replace('#', ''); if (h.length < 6) return false; return parseInt(h.slice(0, 2), 16) * 0.299 + parseInt(h.slice(2, 4), 16) * 0.587 + parseInt(h.slice(4, 6), 16) * 0.114 < 128; };

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const id = React.useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={id} className="text-[13px] font-semibold" style={{ color: C.muted }}>{label}</span>
      <div role="radiogroup" aria-labelledby={id} className="flex gap-1 overflow-x-auto rounded-full p-1" style={{ background: C.soft }}>
        {options.map(([id, name]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}
            className="h-10 min-w-fit flex-1 whitespace-nowrap rounded-full px-3 text-[13px] transition-shadow"
            style={value === id ? { background: '#fff', color: C.ink, fontWeight: 600, boxShadow: '0 1px 3px rgba(0,0,0,.1)' } : { color: C.ink }}>{name}</button>))}
      </div>
    </div>);
}

/** A small drawing of a preset: its colors and its layout's shape. */
function Mini({ id }: { id: string }) {
  const pr = presetById(id)!; const t = sanitizeTheme({ ...pr.theme }); const dark = isDark(t.surface);
  const tone = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)'; const tone2 = dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.1)';
  const r = t.corners === 'sharp' ? 0 : t.corners === 'soft' ? 4 : 8;
  const L = pr.layout;
  return (
    <span aria-hidden="true" className="block overflow-hidden rounded-xl" style={{ background: t.surface, color: t.ink, border: `1px solid ${C.line}` }}>
      <span className="flex items-center justify-between px-2.5 py-2 text-[8px]" style={{ letterSpacing: L === 'maison' ? '.3em' : '.08em', fontWeight: L === 'maison' ? 300 : 700, textTransform: L === 'spotlight' || L === 'bento' ? 'none' : 'uppercase', ...(L === 'bento' ? { margin: 4, borderRadius: 999, background: tone } : {}) }}>
        <span>{L === 'spotlight' || L === 'bento' ? 'Shop' : 'SHOP'}</span><span className="rounded-full px-1.5" style={{ background: L === 'spotlight' || L === 'bento' ? t.brand : 'transparent', color: L === 'spotlight' || L === 'bento' ? (isDark(t.brand) ? '#fff' : '#121212') : 'inherit' }}>Bag</span>
      </span>
      {L === 'bento' ? (
        <span className="grid gap-1 px-1.5 pb-1.5" style={{ gridTemplateColumns: '1.4fr 1fr', gridTemplateRows: '34px 22px' }}>
          <span style={{ gridRow: 'span 2', borderRadius: r + 2, background: tone2 }} /><span style={{ borderRadius: r + 2, background: tone }} /><span style={{ borderRadius: r + 2, background: t.brand, opacity: 0.85 }} />
        </span>
      ) : L === 'spotlight' ? (
        <span className="flex flex-col items-center gap-1 px-2 pb-2"><span className="text-[11px] font-bold leading-none tracking-tight">Big story.</span><span className="grid h-[40px] w-full place-items-center" style={{ borderRadius: r + 2, background: tone }}><span style={{ width: 12, height: 22, borderRadius: '6px 6px 3px 3px', background: tone2 }} /></span></span>
      ) : L === 'maison' ? (
        <span className="block h-[62px]" style={{ background: dark ? '#1b1b1b' : t.ink, opacity: dark ? 1 : 0.85 }}><span className="block px-2 pt-6 text-[11px] font-extralight leading-none" style={{ color: dark ? t.ink : t.surface }}>Editorial</span></span>
      ) : L === 'index' ? (
        <span className="flex flex-col gap-1 px-2 pb-2"><span className="h-[10px] w-full rounded" style={{ border: `1px solid ${tone2}` }} /><span className="grid grid-cols-4 gap-1">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} className="aspect-square" style={{ borderRadius: r, background: tone }} />)}</span></span>
      ) : (
        <span className="flex flex-col gap-1 px-2 pb-2"><span className="h-[30px]" style={{ borderRadius: r, background: tone }} /><span className="grid grid-cols-3 gap-1">{[0, 1, 2].map((i) => <span key={i} className="aspect-square" style={{ borderRadius: r, background: tone2 }} />)}</span></span>
      )}
    </span>);
}

export function SiteLook({ tenantId, shopName, announcement = '', theme, setTheme, brand, setBrand }: {
  tenantId: string; shopName: string; announcement?: string;
  theme: ShopTheme; setTheme: (t: ShopTheme) => void;
  brand: ShopBrand; setBrand: (b: ShopBrand) => void;
}) {
  const [filter, setFilter] = React.useState<SiteLayout | 'all'>('all');
  const [wide, setWide] = React.useState(true);
  // The computer preview is a real 1200 px header, scaled to fit the space it has.
  const box = React.useRef<HTMLDivElement>(null); const [scale, setScale] = React.useState(0.55);
  React.useEffect(() => { const el = box.current; if (!el || typeof ResizeObserver === 'undefined') return; const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / 1200))); ro.observe(el); return () => ro.disconnect(); }, []);
  const shown = SITE_PRESETS.filter((p) => filter === 'all' || p.layout === filter);
  const apply = (id: string) => { const pr = presetById(id); if (pr) setTheme(sanitizeTheme({ ...theme, ...pr.theme })); };
  const site: ShopSite = { tenantId, name: shopName || 'Your shop', tagline: '', announcement, brand, layout: theme.site, dark: isDark(theme.surface), address: '' };
  // A preset still counts as "now" only while its colors haven't been changed below.
  const pr0 = presetById(theme.preset);
  const current = pr0 && (['brand', 'surface', 'ink', 'corners'] as const).every((k) => (pr0.theme as any)[k] === undefined || (pr0.theme as any)[k] === (theme as any)[k]) ? pr0 : null;
  const layoutName = SITE_LAYOUTS.find((l) => l.id === theme.site)?.name || 'Atelier';

  return (
    <section className="rounded-[28px] p-4 sm:p-6" style={{ background: '#fff', border: `1px solid ${C.line}`, color: C.ink, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="m-0 text-[13px] font-semibold" style={{ color: C.muted }}>Your whole site</p><h2 className="m-0 text-[24px] font-semibold tracking-[-0.02em]">Layout and preset</h2>
          <p className="m-0 mt-1 max-w-[560px] text-[14px] leading-snug" style={{ color: C.muted }}>A layout sets how every page is put together. A preset is a finished look for it. Your products, photos and logo carry straight over, and you can fine-tune anything below.</p></div>
        <p className="m-0 text-[14px]">Now: <strong className="font-semibold">{current ? current.name : `${layoutName}, your own colors`}</strong></p>
      </div>

      <div role="toolbar" aria-label="Show presets for" className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {([['all', 'All'], ...SITE_LAYOUTS.map((l) => [l.id, l.name])] as [SiteLayout | 'all', string][]).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className="h-10 shrink-0 rounded-full px-4 text-[14px]"
            style={filter === id ? { background: C.ink, color: '#fff', fontWeight: 600 } : { background: C.soft, color: C.ink }}>{label}</button>))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {shown.map((pr) => { const on = current?.id === pr.id; return (
          <button key={pr.id} type="button" onClick={() => apply(pr.id)} aria-pressed={on} aria-label={`Use ${pr.name}`}
            className="flex flex-col gap-2 rounded-2xl p-2 text-left transition-transform active:scale-[.98]" style={{ border: on ? `2px solid ${C.ink}` : `1px solid ${C.line}`, padding: on ? 7 : 8 }}>
            <Mini id={pr.id} />
            <span className="flex items-baseline justify-between gap-2 px-1"><strong className="truncate text-[14px] font-semibold">{pr.name}</strong><span className="shrink-0 text-[12px]" style={{ color: C.muted }}>{SITE_LAYOUTS.find((l) => l.id === pr.layout)?.name}</span></span>
            <span className="line-clamp-2 px-1 text-[12px] leading-snug" style={{ color: C.muted }}>{pr.blurb}</span>
          </button>); })}
      </div>

      <div className="mt-5">
        <Seg<SiteLayout> label="Or keep your colors and change only the layout" value={theme.site} options={SITE_LAYOUTS.map((l) => [l.id, l.name])} onChange={(v) => setTheme(sanitizeTheme({ ...theme, site: v, preset: '' }))} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-[13px] font-semibold" style={{ color: C.muted }}>Your header, as shoppers see it</p>
            <div className="flex gap-1 rounded-full p-1" style={{ background: C.soft }}>
              {([[true, 'Computer'], [false, 'Phone']] as [boolean, string][]).map(([w, label]) => (
                <button key={label} type="button" aria-pressed={wide === w} onClick={() => setWide(w)} className="h-9 rounded-full px-3 text-[13px]" style={wide === w ? { background: '#fff', fontWeight: 600, boxShadow: '0 1px 3px rgba(0,0,0,.1)' } : {}}>{label}</button>))}
            </div>
          </div>
          <div ref={box} className="mt-2 overflow-hidden rounded-2xl" style={{ border: `1px solid ${C.line}`, height: wide ? Math.round(330 * scale) : undefined }}>
            <div className={wide ? '' : 'mx-auto'} style={{ ...cssVars(theme), background: 'var(--shop-surface)', color: 'var(--shop-ink)', fontFamily: 'var(--shop-font)', width: wide ? 1200 : 390, maxWidth: wide ? undefined : '100%', transform: wide ? `scale(${scale})` : undefined, transformOrigin: 'top left', minHeight: wide ? 330 : undefined }}>
              <ShopSiteProvider value={site}><div className="pointer-events-none select-none" aria-hidden="true" inert><ShopHeader active="home" compact={!wide} /></div></ShopSiteProvider>
              <div className="px-5 pb-6 pt-8" style={{ minHeight: 120 }}>
                <p className="m-0 text-[12px]" style={{ letterSpacing: 'var(--shop-label-track)', textTransform: 'uppercase', color: 'var(--shop-muted)' }}>New this week</p>
                <p className="m-0 mt-2 text-[34px] leading-[1.02]" style={{ fontWeight: 'var(--shop-head-weight)' as any, letterSpacing: 'var(--shop-head-track)' }}>Your headline here</p>
                <span className="mt-4 inline-flex h-11 items-center px-5 text-[14px] font-semibold" style={{ background: 'var(--shop-brand)', color: 'var(--shop-on-brand)', borderRadius: 'var(--shop-radius-pill)' }}>Shop now</span>
              </div>
            </div>
          </div>
          <p className="m-0 mt-2 text-[13px] leading-snug" style={{ color: C.muted }}>Every shop page gets this header and the same footer. The layouts for the home, product and other pages arrive next.</p>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <p className="m-0 text-[13px] font-semibold" style={{ color: C.muted }}>Your logo</p>
            <p className="m-0 mt-1 text-[13px] leading-snug" style={{ color: C.muted }}>The same logo shows on your booking page, receipts and order emails. A file with a clear background looks best.</p>
            <div className="mt-2"><ImageUpload label={brand.logoUrl ? 'Change your logo' : 'Upload your logo'} initialImage={brand.logoUrl || null} storageFolder="branding" enableMarkup={false} maxWidthOrHeight={800} onImageUploaded={(url) => setBrand({ ...brand, logoUrl: url, show: brand.logoUrl ? brand.show : 'mark+name' })} /></div>
          </div>
          <Seg<ShopBrand['show']> label="Show" value={brand.logoUrl ? brand.show : 'name'} options={[['mark+name', 'Logo and name'], ['mark', 'Logo'], ['name', 'Name']]} onChange={(v) => setBrand({ ...brand, show: v })} />
          <Seg<ShopBrand['place']> label="Place" value={brand.place} options={[['left', 'Left'], ['center', 'Centered']]} onChange={(v) => setBrand({ ...brand, place: v })} />
          <Seg<ShopBrand['size']> label="Size" value={brand.size} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} onChange={(v) => setBrand({ ...brand, size: v })} />
          <details className="rounded-2xl p-4" style={{ background: C.soft }}>
            <summary className="flex min-h-[28px] cursor-pointer items-center text-[14px] font-semibold">More: light logo and tab icon</summary>
            <div className="mt-3 flex flex-col gap-4">
              <div><p className="m-0 text-[13px] leading-snug" style={{ color: C.muted }}>A light version, for dark presets and over photos.</p>
                <div className="mt-2"><ImageUpload label={brand.darkLogoUrl ? 'Change the light logo' : 'Upload a light logo'} initialImage={brand.darkLogoUrl || null} storageFolder="branding" enableMarkup={false} maxWidthOrHeight={800} onImageUploaded={(url) => setBrand({ ...brand, darkLogoUrl: url })} /></div>
                {brand.darkLogoUrl && <button type="button" onClick={() => setBrand({ ...brand, darkLogoUrl: '' })} className="mt-1 min-h-[44px] text-[13px] underline underline-offset-4">Remove the light logo</button>}</div>
              <div><p className="m-0 text-[13px] leading-snug" style={{ color: C.muted }}>A small square icon for browser tabs and phone home screens. Your logo is used if you skip this.</p>
                <div className="mt-2"><ImageUpload label={brand.iconUrl ? 'Change the icon' : 'Upload an icon'} initialImage={brand.iconUrl || null} storageFolder="branding" enableMarkup={false} maxWidthOrHeight={512} onImageUploaded={(url) => setBrand({ ...brand, iconUrl: url })} /></div>
                {brand.iconUrl && <button type="button" onClick={() => setBrand({ ...brand, iconUrl: '' })} className="mt-1 min-h-[44px] text-[13px] underline underline-offset-4">Remove the icon</button>}</div>
            </div>
          </details>
        </div>
      </div>
    </section>);
}
