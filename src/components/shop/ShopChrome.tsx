'use client';
// src/components/shop/ShopChrome.tsx — THE SHOP'S HEADER AND FOOTER, the same on every shop page and shaped by the
// shop's layout (lib/shop-site): Atelier's centered classic bar, Maison's fine editorial line, Index's catalog bar
// with search, Spotlight's glass bar, Bento's floating pill. The logo shows as the owner set it (logo only, logo and
// name, or name only; left or centered; small to large), with its light version on dark backgrounds. On a phone every
// layout keeps the same three things in reach: the menu, the logo and the bag.
import * as React from 'react';
import Link from 'next/link';
import { ShopMenu } from '@/components/shop/ShopMenu';
import { readCart, readWholesaleCode } from '@/lib/shop-cart';
import { LOGO_HEIGHT, logoFor, type ShopBrand, type SiteLayout } from '@/lib/shop-site';

export type ShopSite = {
  tenantId: string; name: string; tagline: string; announcement: string;
  brand: ShopBrand; layout: SiteLayout; dark: boolean;
  address: string;
};

const Ctx = React.createContext<ShopSite | null>(null);
export function ShopSiteProvider({ value, children }: { value: ShopSite; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useShopSite = () => React.useContext(Ctx);

/** How many items are in the bag, kept in step as anything on the page adds or removes one (lib/shop-cart). */
export function useBagCount(tenantId: string): number {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const read = () => setN(Object.values(readCart(tenantId)).reduce((a, q) => a + (Number(q) || 0), 0));
    read();
    window.addEventListener('storage', read); window.addEventListener('cf-cart', read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener('cf-cart', read); };
  }, [tenantId]);
  return n;
}

export function ShopLogo({ site, onDark = false }: { site: ShopSite; onDark?: boolean }) {
  const b = site.brand; const src = logoFor(b, onDark || site.dark);
  const h = LOGO_HEIGHT[b.size];
  const showMark = b.show !== 'name' && !!src; const showName = b.show !== 'mark' || !src;
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      {showMark && <img src={src} alt={showName ? '' : site.name} style={{ height: h, width: 'auto', maxWidth: h * 4 }} className="shrink-0 object-contain" />}
      {showName && <span className="truncate" style={{ fontSize: Math.round(Math.max(15, h * 0.48)), fontWeight: 'var(--shop-logo-weight, 600)' as any, letterSpacing: 'var(--shop-logo-track, .1em)', textTransform: 'var(--shop-logo-case, uppercase)' as any }}>{site.name}</span>}
    </span>);
}

type Active = 'home' | 'catalog' | 'account' | 'product' | 'offer' | '';

const BagIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z" /><path d="M9 8a3 3 0 016 0" /></svg>;
const SearchIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
const UserIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>;

export function ShopHeader({ active = '', categories, activeCategory, onUnlockWholesale, wholesaleUnlocked, overlay = false, compact = false, minimal = false, hideAnnouncement = false }: {
  active?: Active; categories?: string[]; activeCategory?: string; onUnlockWholesale?: () => void; wholesaleUnlocked?: boolean;
  /** Just the logo (a paused shop: nothing to browse or buy). */
  minimal?: boolean;
  /** The shop's announcement is for retail shoppers; a wholesale buyer doesn't see it. */
  hideAnnouncement?: boolean;
  /** Always the phone version (the designer's phone preview). */
  compact?: boolean;
  /** Maison's home: the header sits over the first photo, in the light logo. */
  overlay?: boolean;
}) {
  const site = useShopSite();
  const bag = useBagCount(site?.tenantId || '');
  // A wholesale buyer (their code is saved on this device) doesn't see the retail announcement, on any page.
  const [trade, setTrade] = React.useState(false);
  React.useEffect(() => { setTrade(!!readWholesaleCode(site?.tenantId || '')); }, [site?.tenantId]);
  if (!site) return null;
  const L = site.layout; const base = `/shop/${site.tenantId}`;
  // Wide-screen pieces show from the md breakpoint, or never in the phone preview.
  // The menu (categories, wholesale access, the printable catalog) is at every width; the links beside it show from
  // the md breakpoint, or never in the phone preview.
  const onWide = compact ? 'hidden' : 'hidden lg:flex'; const onPhone = minimal ? 'hidden' : '';
  const nav: [Active, string, string][] = [['home', 'Home', base], ['catalog', L === 'index' ? 'Shop all' : 'Shop', `${base}/catalog`], ['account', 'Your orders', `${base}/account`]];
  const navLink = (on: boolean): React.CSSProperties => ({ minHeight: 44, display: 'inline-flex', alignItems: 'center', fontSize: 'var(--shop-nav-size, 14px)', textTransform: 'var(--shop-nav-case, none)' as any, letterSpacing: 'var(--shop-nav-track, 0)', color: on ? 'var(--shop-ink)' : 'var(--shop-muted)', boxShadow: on ? `inset 0 -${L === 'spotlight' ? 2 : 1}px 0 var(--shop-ink)` : 'none', ...(L === 'bento' ? { padding: '0 14px', borderRadius: 999, boxShadow: 'none', background: on ? 'var(--shop-brand-soft)' : 'transparent', color: 'var(--shop-ink)', fontWeight: on ? 600 : 500 } : {}) });
  const menu = <ShopMenu tenantId={site.tenantId} shopName={site.name} categories={categories} activeCategory={activeCategory} onUnlockWholesale={onUnlockWholesale} wholesaleUnlocked={wholesaleUnlocked} />;
  const bagLabel = bag > 0 ? `Bag, ${bag} item${bag === 1 ? '' : 's'}` : 'Bag';
  const pill = L === 'spotlight' || L === 'bento';
  const bagEl = (
    <Link href={`${base}/checkout`} aria-label={bagLabel} className="relative inline-flex h-11 shrink-0 items-center justify-center gap-2 px-3 text-[14px] font-semibold"
      style={pill ? { borderRadius: 999, padding: '0 16px', background: L === 'bento' ? 'var(--shop-brand)' : 'var(--shop-ink)', color: L === 'bento' ? 'var(--shop-on-brand)' : 'var(--shop-surface)' } : { color: 'inherit', minWidth: 44 }}>
      {pill ? <span>Bag</span> : <BagIcon />}
      {(pill || bag > 0) && <span aria-hidden="true" className="grid h-[22px] min-w-[22px] place-items-center rounded-full px-1.5 text-[12px] font-bold" style={pill ? { background: L === 'bento' ? 'var(--shop-on-brand)' : 'var(--shop-surface)', color: L === 'bento' ? 'var(--shop-brand)' : 'var(--shop-ink)' } : { position: 'absolute', top: 4, right: 0, background: 'var(--shop-brand)', color: 'var(--shop-on-brand)' }}>{bag}</span>}
    </Link>);
  const account = <Link href={`${base}/account`} aria-label="Your account" className={`${compact ? 'hidden' : 'hidden md:inline-flex'} h-11 w-11 shrink-0 items-center justify-center`} style={{ color: 'inherit' }}><UserIcon /></Link>;
  const logoLink = <Link href={base} aria-label={`${site.name} home`} className="flex min-w-0 items-center lg:shrink-0" style={{ color: 'inherit', textDecoration: 'none' }}><ShopLogo site={site} onDark={overlay} /></Link>;
  // On the home page the shop's name is the page's main heading.
  const logo = active === 'home' ? <h1 className="m-0 flex min-w-0 text-[inherit] font-[inherit]">{logoLink}</h1> : logoLink;
  const links = <nav aria-label="Main" className={`${onWide} items-center`} style={{ gap: L === 'bento' ? 4 : L === 'maison' ? 28 : 24 }}>{nav.map(([id, label, href]) => <Link key={id} href={href} aria-current={active === id ? 'page' : undefined} className="whitespace-nowrap" style={{ ...navLink(active === id), textDecoration: 'none' }}>{label}</Link>)}</nav>;
  const search = (
    <form action={`${base}/catalog`} role="search" className={`${onWide} min-w-0 flex-1`} style={{ maxWidth: 420 }}>
      <label className="flex h-[42px] w-full items-center gap-2 px-3.5" style={{ border: '1px solid var(--shop-line)', borderRadius: 'var(--shop-radius-control)', color: 'var(--shop-muted)' }}>
        <SearchIcon /><input name="q" aria-label="Search the shop" placeholder="Search products" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none" style={{ color: 'var(--shop-ink)' }} />
      </label>
    </form>);

  const centered = site.brand.place === 'center';
  const ink = overlay ? '#ffffff' : 'var(--shop-ink)';
  // The shop's announcement, the same on every page and layout: a dark band in Atelier, a quiet line in the others.
  const bar = site.announcement && !hideAnnouncement && !trade && !minimal
    ? <div className="grid min-h-9 place-items-center px-4 py-2 text-center text-[12px] leading-snug" style={L === 'atelier' ? { background: 'var(--shop-ink)', color: 'var(--shop-surface)' } : { background: 'var(--shop-brand-soft)', color: 'var(--shop-ink)', letterSpacing: L === 'maison' ? '.14em' : undefined, textTransform: L === 'maison' ? 'uppercase' : undefined }}><span className="line-clamp-2">{site.announcement}</span></div> : null;

  if (L === 'bento') {
    return (
      <div className={`sticky top-0 z-30 px-3 pt-3 print:hidden ${compact ? '' : 'md:px-6 md:pt-3.5'}`}>
        <header className={`flex h-16 items-center gap-2 pl-2 pr-2 ${compact ? '' : 'md:gap-5 md:pl-5'}`} style={{ borderRadius: 999, background: site.dark ? 'rgba(22,22,22,.85)' : 'rgba(255,255,255,.85)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid var(--shop-line)', boxShadow: '0 6px 24px rgba(0,0,0,.06)', color: 'var(--shop-ink)' }}>
          <span className={onPhone}>{menu}</span>
          {!centered && logo}{!minimal && links}
          {centered && <span className="flex flex-1 justify-center">{logo}</span>}
          {!minimal && <span className="ml-auto flex items-center gap-1.5">{account}{bagEl}</span>}
        </header>
        {bar && <div className="mt-2 overflow-hidden rounded-full">{bar}</div>}
      </div>);
  }

  const headStyle: React.CSSProperties = L === 'spotlight'
    ? { background: site.dark ? 'rgba(14,14,14,.82)' : 'rgba(255,255,255,.82)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid var(--shop-line)', color: ink }
    : overlay ? { background: 'transparent', color: ink, borderBottom: '1px solid rgba(255,255,255,.2)' }
      : { background: 'var(--shop-surface)', borderBottom: '1px solid var(--shop-line)', color: ink };
  const h = compact ? 'h-16' : L === 'index' || L === 'spotlight' ? 'h-16 md:h-[72px]' : 'h-16 md:h-[84px]';
  const pad = compact ? 'px-3' : L === 'maison' ? 'px-3 md:px-14' : L === 'index' ? 'px-3 md:px-10' : 'px-3 md:px-12';

  return (
    <div className={`${overlay ? 'absolute inset-x-0 top-0' : 'sticky top-0'} z-30 print:hidden`}>
      {bar}
      <header className={`${h} ${pad}`} style={headStyle}>
        {centered && L !== 'index' ? (
          <div className="grid h-full items-center gap-2" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
            <span className="flex items-center gap-2"><span className={onPhone}>{menu}</span>{!minimal && links}</span>
            {logo}
            <span className="flex items-center justify-end gap-1">{!minimal && account}{!minimal && bagEl}</span>
          </div>
        ) : (
          <div className={`flex h-full items-center gap-2 ${compact ? '' : 'md:gap-8'}`}>
            <span className={onPhone}>{menu}</span>
            {logo}{!minimal && links}
            {L === 'index' && active !== 'catalog' && !minimal && search}
            {!minimal && <span className="ml-auto flex items-center gap-1">{account}{bagEl}</span>}
          </div>
        )}
      </header>
    </div>);
}

export function ShopFooter({ hasOffers = false }: { hasOffers?: boolean }) {
  const site = useShopSite();
  if (!site) return null;
  const base = `/shop/${site.tenantId}`; const L = site.layout;
  const col = (title: string, items: [string, string][]) => (
    <nav aria-label={title} className="flex flex-col text-[14px]">
      <strong className="mb-1 font-semibold">{title}</strong>
      {items.map(([label, href]) => <Link key={label} href={href} className="flex min-h-[44px] items-center underline-offset-4 hover:underline" style={{ color: 'var(--shop-ink)' }}>{label}</Link>)}
    </nav>);
  return (
    <footer className="print:hidden" style={L === 'bento' ? { margin: '14px 12px 0', paddingBottom: 'env(safe-area-inset-bottom)' } : { borderTop: '1px solid var(--shop-line)' }}>
      <div className={`grid gap-8 px-5 py-10 md:grid-cols-4 md:px-12 md:py-14 ${L === 'bento' ? 'rounded-[24px]' : ''}`} style={L === 'bento' ? { background: 'var(--shop-brand-soft)', color: 'var(--shop-ink)' } : { color: 'var(--shop-ink)' }}>
        <div className="flex flex-col gap-2.5">
          <span className="text-[16px]" style={{ fontWeight: 'var(--shop-logo-weight, 600)' as any, letterSpacing: 'var(--shop-logo-track)', textTransform: 'var(--shop-logo-case)' as any }}>{site.name}</span>
          {site.tagline && <span className="text-[14px] leading-relaxed" style={{ color: 'var(--shop-muted)' }}>{site.tagline}</span>}
          {site.address && <span className="text-[14px] leading-relaxed" style={{ color: 'var(--shop-muted)' }}>{site.address}</span>}
        </div>
        {col('Shop', [['Home', base], ['Shop all', `${base}/catalog`], ...(hasOffers ? [['Kits and bundles', `${base}#offers`] as [string, string]] : [])])}
        {col('Help', [['Your orders and returns', `${base}/account`]])}
        {col('Policies', [['Terms of use', '/legal/terms'], ['Privacy policy', '/legal/privacy']])}
      </div>
      <div className="flex flex-col gap-1 px-5 pb-8 text-[12px] md:flex-row md:justify-between md:px-12" style={{ color: 'var(--shop-muted)', paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}>
        <span>This shop uses only essential cookies, the ones that keep your bag and sign-in working.</span>
        <span>&copy; {new Date().getFullYear()} {site.name}</span>
      </div>
    </footer>);
}
