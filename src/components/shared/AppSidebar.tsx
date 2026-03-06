'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  Sidebar,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarContent,
  SidebarSeparator,
  SidebarGroup,
  SidebarGroupLabel,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  LayoutDashboard,
  Calendar,
  Users,
  Settings,
  Sparkles,
  List,
  Box,
  FileText,
  BookOpen,
  Landmark,
  DollarSign,
  FileSignature,
  Gift,
  Briefcase,
  ListChecks,
  BarChart,
  HardHat,
  Percent,
  Megaphone,
  Star,
  Award,
  LogOut,
  LifeBuoy,
  BookText,
  CreditCard,
  Globe,
} from 'lucide-react';
import Link from 'next/link';
import { TenantSwitcher } from './TenantSwitcher';
import { useIsMobile } from '@/hooks/use-mobile';
import { ClientOnly } from './ClientOnly';
import { useTenant } from '@/context/TenantContext';
import { cn } from '@/lib/utils';
import { useAuth } from '@/firebase';
import { signOut } from 'firebase/auth';

export const ClarityFlowLogo = ({ className }: { className?: string }) => (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-primary", className)}
    >
      <path
        d="M16 3.5C9.09644 3.5 3.5 9.09644 3.5 16C3.5 22.9036 9.09644 28.5 16 28.5C22.9036 28.5 28.5 22.9036 28.5 16C28.5 9.09644 22.9036 3.5 16 3.5Z"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        d="M16.0011 20.9C18.7067 20.9 20.9011 18.7056 20.9011 16C20.9011 13.2944 18.7067 11.1 16.0011 11.1"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );

const mainNavItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/planner', icon: Calendar, label: 'Planner' },
  { href: '/pos', icon: ListChecks, label: 'POS' },
  { href: '/clients', icon: Users, label: 'Clients' },
  { href: '/services', icon: BookOpen, label: 'Services' },
  { href: '/staff', icon: Briefcase, label: 'Staff' },
];

const manageNavItems = [
    { href: '/inventory', icon: Box, label: 'Inventory' },
    { href: '/memberships', icon: Award, label: 'Memberships' },
    { href: '/discounts', icon: Percent, label: 'Discounts' },
    { href: '/campaigns', icon: Megaphone, label: 'Campaigns' },
    { href: '/resources', icon: HardHat, label: 'Resources' },
    { href: '/consents', icon: FileSignature, label: 'Consents' },
    { href: '/reviews', icon: Star, label: 'Reviews' },
    { href: '/quotes', icon: FileText, label: 'Quotes' },
];

const financialsNavItems = [
    { href: '/financials', icon: Landmark, label: 'Foundation' },
    { href: '/ledger', icon: BookText, label: 'Ledger' },
    { href: '/bills', icon: CreditCard, label: 'Bills' },
    { href: '/payday', icon: DollarSign, label: 'Payday' },
    { href: '/reports', icon: BarChart, label: 'Reports' },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { selectedTenant, isLoading: isTenantLoading, role } = useTenant();
  const tenantId = selectedTenant?.id;
  const auth = useAuth();
  const router = useRouter();

  const isNavItemActive = (href: string) => {
    if (href === '/dashboard') return pathname === href;
    return pathname.startsWith(href);
  }

  const handleLogout = async () => {
    if (auth) {
        await signOut(auth);
        router.push('/login');
    }
  };

  const staffNavItems = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'My Dashboard' },
    { href: '/planner', icon: Calendar, label: 'My Planner' },
    ];


  return (
    <Sidebar className="border-r border-border/40">
      <SidebarHeader className="p-6">
        <div className="flex items-center gap-3">
            <ClarityFlowLogo className="w-8 h-8" />
            <h2 className="text-xl font-black uppercase tracking-tighter text-slate-900 group-data-[collapsible=icon]:hidden">
                ClarityFlow
            </h2>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-4">
        {role === 'owner' && (
            <div className="mb-6">
            <ClientOnly>
                <TenantSwitcher />
            </ClientOnly>
            </div>
        )}
        <SidebarGroup>
            <SidebarMenu>
            {(role === 'owner' ? mainNavItems : staffNavItems).map((item) => (
                <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                    asChild
                    isActive={isNavItemActive(item.href)}
                    tooltip={item.label}
                    className="rounded-xl h-11 font-bold transition-all data-[active=true]:bg-primary data-[active=true]:text-white hover:bg-primary/10"
                >
                    <Link href={item.href}>
                    <item.icon className="w-5 h-5" />
                    <span>{item.label}</span>
                    </Link>
                </SidebarMenuButton>
                </SidebarMenuItem>
            ))}
            </SidebarMenu>
        </SidebarGroup>

        {role === 'owner' && (
            <>
                <SidebarSeparator className="my-4 opacity-50" />
                <SidebarGroup>
                    <SidebarGroupLabel className="px-2 mb-2 font-black uppercase text-[10px] tracking-widest text-muted-foreground">Studio Management</SidebarGroupLabel>
                    <SidebarMenu>
                        {manageNavItems.map((item) => (
                            <SidebarMenuItem key={item.href}>
                                <SidebarMenuButton asChild isActive={isNavItemActive(item.href)} tooltip={item.label} className="rounded-xl h-10 font-bold transition-all data-[active=true]:bg-primary data-[active=true]:text-white hover:bg-primary/10">
                                    <Link href={item.href}><item.icon className="w-4.5 h-4.5" /><span>{item.label}</span></Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        ))}
                    </SidebarMenu>
                </SidebarGroup>
                <SidebarSeparator className="my-4 opacity-50" />
                <SidebarGroup>
                    <SidebarGroupLabel className="px-2 mb-2 font-black uppercase text-[10px] tracking-widest text-muted-foreground">Financial Suite</SidebarGroupLabel>
                    <SidebarMenu>
                        {financialsNavItems.map((item) => (
                            <SidebarMenuItem key={item.href}>
                                <SidebarMenuButton asChild isActive={isNavItemActive(item.href)} tooltip={item.label} className="rounded-xl h-10 font-bold transition-all data-[active=true]:bg-primary data-[active=true]:text-white hover:bg-primary/10">
                                    <Link href={item.href}><item.icon className="w-4.5 h-4.5" /><span>{item.label}</span></Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        ))}
                    </SidebarMenu>
                </SidebarGroup>
                <SidebarSeparator className="my-4 opacity-50" />
                <SidebarGroup>
                    <SidebarGroupLabel className="px-2 mb-2 font-black uppercase text-[10px] tracking-widest text-muted-foreground">Public Touchpoints</SidebarGroupLabel>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton asChild tooltip="Booking Page" disabled={isTenantLoading || !tenantId} className="rounded-xl h-10 font-bold hover:bg-primary/10">
                                <Link href={tenantId ? `/book/${tenantId}` : '#'} target="_blank">
                                    <Globe className="w-4.5 h-4.5 text-primary" />
                                    <span>Client Booking Page</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <SidebarMenuButton asChild tooltip="Walk-in Kiosk" disabled={isTenantLoading || !tenantId} className="rounded-xl h-10 font-bold hover:bg-primary/10">
                                <Link href={tenantId ? `/kiosk/${tenantId}` : '#'} target="_blank">
                                    <Users className="w-4.5 h-4.5 text-primary" />
                                    <span>Walk-in Kiosk</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarGroup>
            </>
        )}
      </SidebarContent>
      <SidebarFooter className="p-4 bg-muted/30">
        <SidebarMenu>
            {role === 'owner' && (
                <>
                    <SidebarMenuItem>
                        <SidebarMenuButton asChild isActive={pathname.startsWith('/settings')} tooltip="Settings" className="rounded-xl font-bold hover:bg-primary/10">
                        <Link href="/settings">
                            <Settings className="w-4.5 h-4.5" />
                            <span>Settings</span>
                        </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleLogout} tooltip="Logout" className="rounded-xl font-bold text-destructive hover:bg-destructive/5 hover:text-destructive">
                <LogOut className="w-4.5 h-4.5" />
                <span>Sign Out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}