
'use client';

import { usePathname, useSearchParams } from 'next/navigation';
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
  Percent,
  Megaphone,
  Star,
  Award,
  LogOut,
  LifeBuoy,
} from 'lucide-react';
import Link from 'next/link';
import { TenantSwitcher } from './TenantSwitcher';

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

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/pos', icon: ListChecks, label: 'Order Line' },
  { href: '/planner', icon: Calendar, label: 'Planner' },
  { href: '/inventory', icon: Box, label: 'Manage Dishes' },
  { href: '/clients', icon: Users, label: 'Customers' },
];

export function AppSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toggleSidebar } = useSidebar();

  const isNavItemActive = (href: string) => {
    return pathname.startsWith(href);
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2">
            <ClarityFlowLogo />
            <h2 className="text-xl font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                Tasty Station
            </h2>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
        {navItems.map((item) => (
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
                <SidebarMenuButton asChild tooltip="Help Center">
                  <Link href="#">
                    <LifeBuoy />
                    <span>Help Center</span>
                  </Link>
                </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={toggleSidebar} tooltip="Logout">
                <LogOut />
                <span>Logout</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
