'use client';
// src/components/orders/shell.tsx — WHAT EVERY ONLINE-SHOP SCREEN SHARES: the phone tab bar for the shop's four places
// (Orders, Problems, Shoppers, Setup) and the checks for a computer-width screen and a wide one.
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Btn, C, Ic, muted } from './ui';
import { useInSettings, useSettingsBack } from '@/components/settings/settings-place';

function useMin(px: number) {
  const [w, setW] = React.useState(false);
  React.useEffect(() => { const m = window.matchMedia(`(min-width: ${px}px)`); const f = () => setW(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, [px]);
  return w;
}
/** The way back from a shop settings screen: to the Shop group when it opens inside Settings (on a phone only — on a
 *  computer the Settings list is right there), otherwise to the shop's Setup. */
export function ShopBack({ look, fallback = { href: '/retail-orders/setup', label: 'Setup' }, onClick }: { look: 'round' | 'quiet' | 'ink'; fallback?: { href: string; label: string }; onClick?: React.MouseEventHandler<HTMLAnchorElement> }) {
  const back = useSettingsBack(fallback);
  const hide = back.inSettings ? ' lg:hidden' : '';
  if (look === 'round') return <Link href={back.href} onClick={onClick} aria-label={`Back to ${back.label}`} className={'cf-press grid h-11 w-11 shrink-0 place-items-center rounded-full' + hide} style={{ background: C.soft, color: C.ink }}>{Ic.back}</Link>;
  if (look === 'ink') return <Link href={back.href} onClick={onClick} className={'inline-flex h-11 items-center gap-1 text-[17px]' + hide} style={{ color: C.ink }}>{Ic.back}{back.label}</Link>;
  return <Link href={back.href} onClick={onClick} className={'cf-press inline-flex h-11 items-center gap-1 text-[15px]' + hide} style={muted}>{Ic.back} {back.label}</Link>;
}

/** The top row of a shop screen with a round back button and where it goes; beside the Settings list on a computer
 *  the list is the way back, so the row isn't there. */
export function ShopBackRow() {
  const back = useSettingsBack({ href: '/retail-orders/setup', label: 'Setup' });
  return (
    <div className={'flex items-center justify-between gap-2' + (back.inSettings ? ' lg:hidden' : '')}>
      <ShopBack look="round" />
      <span className="text-[14px]" style={muted}>{back.label}</span>
      <span className="h-11 w-11" />
    </div>);
}

/** A computer-width screen: the order sits beside the list. */
export function useWide() { return useMin(1024); }
/** Wide enough for the customer to sit beside the order too. */
export function useWidest() { return useMin(1280); }

export function PhoneShopBar({ onPackNext, problems }: { onPackNext?: () => void; problems: number }) {
  const path = usePathname() || '';
  const inSettings = useInSettings();
  const I = (d: React.ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
  const tabs: [string, string, React.ReactNode, number][] = [
    ['/retail-orders', 'Orders', I(<><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /></>), 0],
    ['/retail-orders/problems', 'Problems', I(<path d="M4 5h16v11H8l-4 4z" />), problems],
    ['/retail-orders/customers', 'Shoppers', I(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>), 0],
    ['/retail-orders/setup', 'Setup', I(<><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>), 0],
  ];
  if (inSettings) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t" style={{ borderColor: C.line, background: 'color-mix(in srgb, var(--paper, #fff) 86%, transparent)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {onPackNext && <div className="px-4 pt-3"><Btn kind="primary" className="w-full text-[17px]" onClick={onPackNext}>Pack the next order</Btn></div>}
      <nav aria-label="Online shop" className="flex h-14">
        {tabs.map(([href, label, icon, badge]) => { const on = href === '/retail-orders' ? path === href : path.startsWith(href) || (href === '/retail-orders/setup' && /^\/retail-orders\/(labels|alerts|capacity|lost)(\/|$)/.test(path)); return (
          <Link key={href} href={href} aria-current={on ? 'page' : undefined} className="relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold" style={{ color: on ? C.ink : C.muted }}>
            {icon}<span>{label}</span>
            {badge > 0 && <span className="absolute left-[56%] top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[11px] text-white" style={{ background: C.warn }}>{badge}</span>}
          </Link>); })}
      </nav>
    </div>);
}
