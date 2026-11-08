'use client';
// src/components/auth/AccessGate.tsx — A LOCKED BUSINESS (lib/tenant-access) OPENS NO APP SCREENS. Paused by HQ, a
// subscription that ended, or a late payment past its grace period: the team is taken to the suspended page, and
// nothing of the business shows behind it. An owner with another business that's open is switched to it instead.
// (Your ClarityFlow, where an owner fixes billing, sits outside this gate.)
import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader } from 'lucide-react';
import { useTenantOptional } from '@/context/TenantContext';
import { accessLockOf } from '@/lib/tenant-access';

export function AccessGate({ children }: { children: ReactNode }) {
  const ctx = useTenantOptional();
  const router = useRouter();
  const pathname = usePathname() || '';
  const t: any = ctx?.selectedTenant || null;
  const lock = accessLockOf(t);
  const blocked = lock.locked && !pathname.startsWith('/subscriptions');
  const openOne: any = blocked ? (ctx?.tenants || []).find((x: any) => x?.id && x.id !== t?.id && !accessLockOf(x).locked) || null : null;
  useEffect(() => {
    if (!blocked) return;
    if (openOne && ctx?.setSelectedTenant) { ctx.setSelectedTenant(openOne); return; }
    router.replace(`/suspended?reason=${lock.reason}`);
  }, [blocked, openOne?.id, lock.reason, router]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing of the business shows until it's known to be open.
  const waiting = !!ctx?.isLoading || (!t && (ctx?.tenants || []).length > 0);
  if (waiting || blocked) {
    return <div className="flex h-dvh w-full items-center justify-center bg-background" aria-busy="true"><Loader className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden /><span className="sr-only">Loading</span></div>;
  }
  return <>{children}</>;
}
