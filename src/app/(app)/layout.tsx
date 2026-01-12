import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/shared/AppSidebar';
import { FirebaseClientProvider } from '@/firebase';
import { InventoryProvider } from '@/context/InventoryContext';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseClientProvider>
      <InventoryProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </InventoryProvider>
    </FirebaseClientProvider>
  );
}
