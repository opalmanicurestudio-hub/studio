'use client';
// src/components/shared/WayHome.tsx — A WAY HOME FROM EVERY PAGE. On a phone or a tablet (below 1024px) the app's menu
// is folded away, and the button that opens it is in the page's header (AppHeader). A page without that header would
// leave nobody a way back, so the app's frame (app/(app)/layout) puts this bar in its place: the menu button and Home,
// shaped like the header, so a page whose header arrives once it has loaded swaps one for the other where it stands.
// A header that carries the button says so (useWayHome), and the bar steps aside. On a computer the menu is always
// showing, so the bar never is. It scrolls with the page rather than staying on top, as many of these pages keep their
// own bar at the top as they scroll.
//   It also keeps, for this tab only, the app page last open, so a page outside the app reached from it in the same
// tab (the pay calculator, say) can offer the way back (BackToApp). Someone who opened that page any other way (a
// client following a link) never sees it.
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Home } from 'lucide-react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useTenantOptional } from '@/context/TenantContext';

const LAST_PAGE = 'cf:lastAppPage';
const AddContext = React.createContext<(() => () => void) | null>(null);
const CountContext = React.createContext(0);
// (Before the page is first shown, so a page with its own header never shows the bar for a moment.)
const useBeforePaint = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

export function WayHomeProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = React.useState(0);
  const add = React.useCallback(() => { setCount((n) => n + 1); return () => setCount((n) => Math.max(0, n - 1)); }, []);
  return <AddContext.Provider value={add}><CountContext.Provider value={count}>{children}</CountContext.Provider></AddContext.Provider>;
}

/** Called by a header that shows the menu button (`on` while it does). */
export function useWayHome(on = true) {
  const add = React.useContext(AddContext);
  useBeforePaint(() => (on && add ? add() : undefined), [on, add]);
}

/** The bar, for a page with no header of its own, on a phone or a tablet. Home is the dashboard; for someone signed in
 *  through the team app (who has the floor's pages here, components/shared/PortalScope), the team app; and on the host
 *  stand's tablet, which has nowhere else to go, there is no Home, just its menu. */
export function WayHomeBar() {
  const count = React.useContext(CountContext);
  const path = usePathname() || '';
  const { viaPortal, screen, selectedTenant } = (useTenantOptional() || {}) as any;
  const home = screen ? null : viaPortal ? (selectedTenant?.id ? `/staff-portal/${encodeURIComponent(String(selectedTenant.id))}` : null) : '/dashboard';
  // (Drawn before the page is first shown, so the page never jumps down to make room; the server never draws it.)
  const [ready, setReady] = React.useState(false);
  useBeforePaint(() => { setReady(true); }, []);
  React.useEffect(() => {
    try { window.sessionStorage.setItem(LAST_PAGE, `${path}${window.location.search}`); } catch { /* a private window: no way back offered outside */ }
  }, [path]);
  if (!ready || count > 0) return null;
  return (
    <nav aria-label="Menu and home" className="relative mx-3 mt-3 flex h-14 items-center md:h-[60px] gap-1 rounded-[22px] bg-card/95 px-2 shadow-[0_1px_2px_rgba(28,25,23,.05),0_10px_32px_rgba(28,25,23,.07)] backdrop-blur-xl lg:hidden print:hidden">
      <SidebarTrigger aria-label="Open the menu" className="h-11 w-11 rounded-full hover:bg-primary/10" />
      {home && path !== home && (
        <Link href={home} className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-3 text-[15px] font-semibold text-foreground hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Home aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.9} />Home
        </Link>
      )}
    </nav>
  );
}

/** On a page outside the app: the way back to the app page this tab came from, when it came from one. */
export function BackToApp({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  const [to, setTo] = React.useState<string | null>(null);
  React.useEffect(() => {
    try { const v = window.sessionStorage.getItem(LAST_PAGE); if (v && /^\/(?![\\/])/.test(v)) setTo(v); } catch { /* none */ }
  }, []);
  if (!to) return null;
  return (
    <Link href={to} className={`inline-flex min-h-[44px] items-center gap-2 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] ${className}`} style={{ color: '#16171a', textDecoration: 'none', ...style }}>
      <ArrowLeft aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.9} />Back to ClarityFlow
    </Link>
  );
}
