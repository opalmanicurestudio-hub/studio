
'use client';

import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/shared/AppSidebar';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { usePathname } from 'next/navigation';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSubscriptionPage = pathname.startsWith('/subscriptions');
  const isBookingPage = pathname.startsWith('/book');

  // If on a public-facing page, render a simple layout without the app shell.
  if (isSubscriptionPage || isBookingPage) {
    return (
      <AuthGuard>
        <div className="bg-muted/40">
          {children}
        </div>
      </AuthGuard>
    );
  }

  // For all other app routes, render the standard layout with the sidebar.
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
