
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/shared/AppSidebar';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { InventoryProvider } from '@/context/InventoryContext';

export default function AppLayout({ children }: { children: React.ReactNode }) {
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
