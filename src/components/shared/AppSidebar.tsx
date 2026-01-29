

'use client';

import { usePathname } from 'next/navigation';
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
  SidebarRail,
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
  Wallet,
  BookOpen,
  Landmark,
  DollarSign,
  FileSignature,
  ShoppingCart,
  Gift,
  Briefcase,
  ListChecks,
  BarChart,
  PanelLeft,
  BookText,
  Hammer,
  HardHat,
  Percent
} from 'lucide-react';
import Link from 'next/link';

export const ClarityFlowLogo = () => (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-primary"
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

const setupNavItems = [
  { href: '/financials', icon: Wallet, label: 'Financials' },
  { href: '/services', icon: List, label: 'Services' },
  { href: '/inventory', icon: Box, label: 'Inventory' },
  { href: '/resources', icon: HardHat, label: 'Resources' },
  { href: '/clients', icon: Users, label: 'Clients' },
  { href: '/staff', icon: Briefcase, label: 'Staff' },
  { href: '/memberships', icon: Gift, label: 'Memberships' },
  { href: '/consents', icon: FileSignature, label: 'Consents' },
];

const operationsNavItems = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/planner', icon: Calendar, label: 'Planner' },
    { href: '/walk-in-queue', icon: ListChecks, label: 'Walk-in Queue' },
    { href: '/retail', icon: ShoppingCart, label: 'Retail' },
    { href: '/quotes', icon: FileText, label: 'Quotes' },
    { href: '/reports', icon: BarChart, label: 'Reports' },
];

const moneyNavItems = [
    { href: '/ledger', icon: BookOpen, label: 'Ledger' },
    { href: '/bills', icon: Landmark, label: 'Bills' },
    { href: '/payday', icon: DollarSign, label: 'Payday' },
    { href: '/discounts', icon: Percent, label: 'Discounts' },
]

export function AppSidebar() {
  const pathname = usePathname();
  const { toggleSidebar } = useSidebar();

  const isNavItemActive = (href: string) => {
    if (href === '/') {
        return pathname === href;
    }
    return pathname.startsWith(href);
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2">
            <ClarityFlowLogo />
            <h2 className="text-xl font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                ClarityFlow
            </h2>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
             <SidebarGroupLabel>Setup</SidebarGroupLabel>
            <SidebarMenu>
            {setupNavItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                    asChild
                    isActive={isNavItemActive(item.href)}
                    tooltip={item.label}
                >
                    <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                    </Link>
                </SidebarMenuButton>
                </SidebarMenuItem>
            ))}
            </SidebarMenu>
        </SidebarGroup>
        <SidebarSeparator />
         <SidebarGroup>
            <SidebarGroupLabel>Operations</SidebarGroupLabel>
            <SidebarMenu>
            {operationsNavItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                    asChild
                    isActive={isNavItemActive(item.href)}
                    tooltip={item.label}
                >
                    <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                    </Link>
                </SidebarMenuButton>
                </SidebarMenuItem>
            ))}
            </SidebarMenu>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
            <SidebarGroupLabel>Money</SidebarGroupLabel>
            <SidebarMenu>
                {moneyNavItems.map((item) => (
                    <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                        asChild
                        isActive={isNavItemActive(item.href)}
                        tooltip={item.label}
                    >
                        <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                        </Link>
                    </SidebarMenuButton>
                    </SidebarMenuItem>
                ))}
            </SidebarMenu>
        </SidebarGroup>
         <SidebarSeparator />
          <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isNavItemActive('/ai-cfo')} tooltip="AI CFO">
                  <Link href="/ai-cfo">
                    <Sparkles />
                    <span>AI CFO</span>
                  </Link>
                </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith('/settings')} tooltip="Settings">
                  <Link href="/settings">
                    <Settings />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={toggleSidebar} tooltip="Collapse sidebar">
                <PanelLeft />
                <span>Collapse</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
