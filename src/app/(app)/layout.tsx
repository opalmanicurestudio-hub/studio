'use client';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/shared/AppSidebar';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { TenantProvider } from '@/context/TenantContext';
import { LocationProvider } from '@/context/LocationContext';
import { usePathname } from 'next/navigation';

/**
 * IMPORTANT FINDING, not introduced by this change: TenantProvider was
 * never actually mounted anywhere in this codebase before this edit.
 * AuthGuard does its OWN independent owner/staff resolution inline
 * (ownerTenantQuery, staffDirectoryEntryRef) rather than consuming
 * TenantContext — the two systems compute overlapping things
 * (who owns/staffs which tenant) completely independently. TenantContext
 * existed as a real, well-written file with nothing rendering it; any
 * future call to useTenant() would have thrown "must be used within a
 * TenantProvider" regardless of anything to do with LocationProvider or
 * the booth-rental pages specifically.
 *
 * This is fixed here by mounting TenantProvider for real. It is NOT a
 * full fix for the duplication this reveals — AuthGuard's inline
 * isOwner/isStaff logic and TenantContext's role/selectedTenant logic
 * are now two parallel systems computing related things from the same
 * Firestore data. That consolidation (having AuthGuard read from
 * TenantContext instead of re-querying independently) is a separate,
 * deliberate refactor of AuthGuard itself — flagged here, not done as a
 * side effect of wiring in LocationProvider.
 */

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSubscriptionPage = pathname.startsWith('/subscriptions');
  const isBookingPage = pathname.startsWith('/book');

  // If on a public-facing page, render a simple layout without the app shell.
  // Neither TenantProvider nor LocationProvider are mounted here: public
  // pages (booking, subscriptions) are guest-facing and never call
  // useTenant() or useLocation() — adding either provider here would run
  // Firestore queries for every guest visit with no consumer to use them.
  if (isSubscriptionPage || isBookingPage) {
    return (
      <AuthGuard>
        <div className="bg-muted/40">
          {children}
        </div>
      </AuthGuard>
    );
  }

  // For all other app routes: TenantProvider must be the outermost of the
  // two new providers, since LocationProvider's implementation calls
  // useTenant() internally — it has to render beneath TenantProvider, not
  // beside it. Both go inside AuthGuard: TenantProvider's own logic calls
  // useFirebase()/useUser() for the signed-in user, which is only
  // meaningful once AuthGuard has already let the request through.
  return (
    <AuthGuard>
      <TenantProvider>
        <LocationProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>{children}</SidebarInset>
          </SidebarProvider>
        </LocationProvider>
      </TenantProvider>
    </AuthGuard>
  );
}
