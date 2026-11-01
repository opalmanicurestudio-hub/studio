'use client';
// src/components/settings/settings-place.ts — WHERE AM I IN SETTINGS.
// useInSettings: whether this page opens inside Settings (its own list on the left on a computer). Every /settings
// address does; the shop settings that still live under /retail-orders do for an owner, admin or manager (the people
// whose screens let them change those settings), while other staff who open one see the app as usual.
// useSettingsBack: the way back on a phone, to the page's group when the group has more than one page, otherwise to
// Settings.
import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';
import { isSettingsPath, settingsPageAt, visibleGroups } from '@/lib/settings-registry';

/** A page with unsaved edits (Delivery, Pickup times) sets this while it's open, so the Settings list asks before
 *  leaving the same way the page's own back link does. Returns true when it's fine to go. */
let leaveGuard: (() => boolean) | null = null;
/** Sets the guard and returns how to remove it; removing only clears this page's own guard. */
export function setLeaveGuard(fn: () => boolean): () => void { leaveGuard = fn; return () => { if (leaveGuard === fn) leaveGuard = null; }; }
export function mayLeave(): boolean { return leaveGuard ? leaveGuard() : true; }

export function useInSettings(): boolean {
  const pathname = usePathname() || '';
  const { role } = useTenant() as any;
  if (!isSettingsPath(pathname)) return false;
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return true;
  return role == null || role === 'owner' || role === 'admin' || role === 'manager';
}

export function useSettingsBack(fallback?: { href: string; label: string }, tab: string | null = null) {
  const pathname = usePathname() || '';
  const { selectedTenant } = useTenant() as any;
  const inSettings = useInSettings();
  const [hash, setHash] = React.useState('');
  React.useEffect(() => { setHash(window.location.hash); }, [pathname]);
  React.useEffect(() => {
    const f = () => setHash(window.location.hash);
    window.addEventListener('hashchange', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('hashchange', f); window.removeEventListener('popstate', f); };
  }, []);
  if (!inSettings) return { ...(fallback || { href: '/settings', label: 'Settings' }), inSettings };
  const at = settingsPageAt(pathname, tab, hash);
  const g = at && selectedTenant ? visibleGroups(selectedTenant).find((x) => x.id === at.group.id) : null;
  if (g && g.pages.length > 1) return { href: `/settings/group/${g.id}`, label: g.title, inSettings };
  return { href: '/settings', label: 'Settings', inSettings };
}
