
'use client';

import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/shared/AppSidebar';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { InventoryProvider } from '@/context/InventoryContext';
import { usePathname } from 'next/navigation';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSubscriptionPage = pathname.startsWith('/subscriptions');

  // If on the subscription page, render a simple, centered layout without the sidebar.
  if (isSubscriptionPage) {
    return (
      <AuthGuard>
        <InventoryProvider>
          <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
            {children}
          </div>
        </InventoryProvider>
      </AuthGuard>
    );
  }

  // For all other app routes, render the standard layout with the sidebar.
  return (
    <AuthGuard>
      <InventoryProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </InventoryProvider>
    </AuthGuard>
  );
}
