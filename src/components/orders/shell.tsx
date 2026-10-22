'use client';
// src/components/orders/shell.tsx — WHAT EVERY ONLINE-SHOP SCREEN SHARES: the phone tab bar for the shop's four places
// (Orders, Problems, Shoppers, Setup) and the check for a computer-width screen.
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Btn, C } from './ui';

export function useWide() {
  const [w, setW] = React.useState(false);
  React.useEffect(() => { const m = window.matchMedia('(min-width: 1024px)'); const f = () => setW(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return w;
}

export function PhoneShopBar({ onPackNext, problems }: { onPackNext?: () => void; problems: number }) {
  const path = usePathname() || '';
  const I = (d: React.ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
  const tabs: [string, string, React.ReactNode, number][] = [
    ['/retail-orders', 'Orders', I(<><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /></>), 0],
    ['/retail-orders/problems', 'Problems', I(<path d="M4 5h16v11H8l-4 4z" />), problems],
    ['/retail-orders/customers', 'Shoppers', I(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>), 0],
    ['/retail-orders/setup', 'Setup', I(<><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>), 0],
  ];
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
