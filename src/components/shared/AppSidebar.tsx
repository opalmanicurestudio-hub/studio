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
} from '@/components/ui/sidebar';
import {
  LayoutDashboard,
  Calendar,
  Users,
  User,
  Settings,
  Sparkles,
  List,
  Box,
  FileText,
  BookOpen,
  Landmark,
  DollarSign,
  FileSignature,
  Briefcase,
  ListChecks,
  BarChart,
  HardHat,
  Percent,
  Megaphone,
  Star,
  Award,
  LogOut,
  BookText,
  CreditCard,
  Globe,
  Fingerprint,
  Zap,
  Repeat,
  Coffee,
  Clock,
  ClipboardList,
} from 'lucide-react';
import Link from 'next/link';
import { TenantSwitcher } from './TenantSwitcher';
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

const strategicHub = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/planner', icon: Calendar, label: 'Planner' },
  { href: '/pos', icon: ListChecks, label: 'Terminal (POS)' },
];

const identityGrowth = [
  { href: '/clients', icon: User, label: 'Guest Dossier' },
  { href: '/staff', icon: Users, label: 'Pro Team' },
  { href: '/timesheets', icon: ClipboardList, label: 'Timesheets' },
  { href: '/campaigns', icon: Megaphone, label: 'Outreach' },
  { href: '/reviews', icon: Star, label: 'Reputation' },
  { href: '/quotes', icon: FileText, label: 'Quotes' },
];

const yieldAssets = [
  { href: '/services', icon: BookOpen, label: 'Service Menu' },
  { href: '/inventory', icon: Box, label: 'Manifest (Inventory)' },
  { href: '/memberships', icon: Award, label: 'Clubs' },
  { href: '/discounts', icon: Percent, label: 'Incentives' },
  { href: '/resources', icon: HardHat, label: 'Resources' },
  { href: '/consents', icon: FileSignature, label: 'Agreements' },
];

const financialSuite = [
  { href: '/financials', icon: Landmark, label: 'Foundation (TMHR)' },
  { href: '/ledger', icon: BookText, label: 'Ledger' },
  { href: '/bills', icon: CreditCard, label: 'Obligations' },
  { href: '/payday', icon: DollarSign, label: 'Payday' },
  { href: '/reports', icon: BarChart, label: 'Analytics' },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { selectedTenant, role } = useTenant();
  const tenantId = selectedTenant?.id;
  const auth = useAuth();
  const router = useRouter();

  const isNavItemActive = (href: string) => {
    if (href === '/dashboard') return pathname === href;
    return pathname.startsWith(href);
  };

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
      router.push('/login');
    }
  };

  const renderMenuItems = (items: any[]) => (
    items.map((item) => (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton
          asChild
          isActive={isNavItemActive(item.href)}
          tooltip={item.label}
          className="rounded-xl h-11 font-black uppercase text-[10px] tracking-widest transition-all data-[active=true]:bg-primary data-[active=true]:text-white data-[active=true]:shadow-lg data-[active=true]:shadow-primary/20 hover:bg-primary/10"
        >
          <Link href={item.href}>
            <item.icon className="w-5 h-5" />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ))
  );

  return (
    <Sidebar className="border-r-4 border-border/40 bg-white">
      <SidebarHeader className="p-8">
        <div className="flex items-center gap-4">
          <ClarityFlowLogo className="w-9 h-9" />
          <div className="flex flex-col">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">
              ClarityFlow
            </h2>
            <p className="text-[8px] font-black uppercase tracking-[0.3em] text-primary mt-1 opacity-60">
              Studio OS
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-4">
        {role === 'owner' && (
          <div className="mb-8 px-2">
            <ClientOnly>
              <TenantSwitcher />
            </ClientOnly>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="px-2 mb-3 font-black uppercase text-[10px] tracking-[0.2em] text-muted-foreground opacity-40">
            Strategic Hub
          </SidebarGroupLabel>
          <SidebarMenu>{renderMenuItems(strategicHub)}</SidebarMenu>
        </SidebarGroup>

        {role === 'owner' && (
          <>
            <SidebarSeparator className="my-6 opacity-50" />
            <SidebarGroup>
              <SidebarGroupLabel className="px-2 mb-3 font-black uppercase text-[10px] tracking-[0.2em] text-muted-foreground opacity-40">
                Identity & Growth
              </SidebarGroupLabel>
              <SidebarMenu>{renderMenuItems(identityGrowth)}</SidebarMenu>
            </SidebarGroup>

            <SidebarSeparator className="my-6 opacity-50" />
            <SidebarGroup>
              <SidebarGroupLabel className="px-2 mb-3 font-black uppercase text-[10px] tracking-[0.2em] text-muted-foreground opacity-40">
                Yield & Assets
              </SidebarGroupLabel>
              <SidebarMenu>{renderMenuItems(yieldAssets)}</SidebarMenu>
            </SidebarGroup>

            <SidebarSeparator className="my-6 opacity-50" />
            <SidebarGroup>
              <SidebarGroupLabel className="px-2 mb-3 font-black uppercase text-[10px] tracking-[0.2em] text-muted-foreground opacity-40">
                Financial Suite
              </SidebarGroupLabel>
              <SidebarMenu>{renderMenuItems(financialSuite)}</SidebarMenu>
            </SidebarGroup>

            <SidebarSeparator className="my-6 opacity-50" />
            <SidebarGroup>
              <SidebarGroupLabel className="px-2 mb-3 font-black uppercase text-[10px] tracking-[0.2em] text-muted-foreground opacity-40">
                Public Portals
              </SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    disabled={!tenantId}
                    className="rounded-xl h-11 font-black uppercase text-[10px] tracking-widest hover:bg-primary/10 transition-all"
                  >
                    <Link href={tenantId ? `/book/${tenantId}` : '#'} target="_blank">
                      <Globe className="w-5 h-5 text-primary" />
                      <span>Booking Page</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    disabled={!tenantId}
                    className="rounded-xl h-11 font-black uppercase text-[10px] tracking-widest hover:bg-primary/10 transition-all"
                  >
                    <Link href={tenantId ? `/kiosk/${tenantId}` : '#'} target="_blank">
                      <Fingerprint className="w-5 h-5 text-primary" />
                      <span>Walk-in Kiosk</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    disabled={!tenantId}
                    className="rounded-xl h-11 font-black uppercase text-[10px] tracking-widest hover:bg-primary/10 transition-all"
                  >
                    <Link href={tenantId ? `/concierge/${tenantId}` : '#'} target="_blank">
                      <Coffee className="w-5 h-5 text-primary" />
                      <span>Lounge Concierge</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    disabled={!tenantId}
                    className="rounded-xl h-11 font-black uppercase text-[10px] tracking-widest hover:bg-primary/10 transition-all"
                  >
                    <Link href={tenantId ? `/timeclock/${tenantId}` : '#'} target="_blank">
                      <Clock className="w-5 h-5 text-primary" />
                      <span>Time Clock</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-6 bg-muted/20 border-t-2 border-border/50">
        <SidebarMenu className="gap-2">
          {role === 'owner' && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/settings')}
                className="rounded-xl h-11 font-black uppercase text-[10px] tracking-widest transition-all data-[active=true]:bg-primary data-[active=true]:text-white hover:bg-primary/10"
              >
                <Link href="/settings">
                  <Settings className="w-5 h-5" />
                  <span>Studio Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleLogout}
              className="rounded-xl h-11 font-black uppercase text-[10px] tracking-widest text-destructive hover:bg-destructive/5 hover:text-destructive transition-all"
            >
              <LogOut className="w-5 h-5" />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}