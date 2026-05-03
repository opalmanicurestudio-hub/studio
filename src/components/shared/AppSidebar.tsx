'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  Sidebar, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarFooter, SidebarContent, SidebarSeparator, SidebarGroup,
  SidebarGroupLabel, SidebarRail, SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar';
import {
  LayoutDashboard, Calendar, Users, User, Settings, Box, FileText, BookOpen,
  Landmark, DollarSign, FileSignature, ListChecks, BarChart, HardHat, Percent,
  Megaphone, Star, LogOut, BookText, CreditCard, Globe, Fingerprint, Coffee,
  Clock, ClipboardList, CalendarDays, Shield, ChefHat, PartyPopper, Layers,
  PanelLeftClose, PanelLeftOpen, ChevronRight, ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { TenantSwitcher } from './TenantSwitcher';
import { ClientOnly } from './ClientOnly';
import { useTenant } from '@/context/TenantContext';
import { cn } from '@/lib/utils';
import { useAuth } from '@/firebase';
import { signOut } from 'firebase/auth';
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from '@/components/ui/tooltip';

// ─── LOGO ──────────────────────────────────────────────────────────────────────
export const ClarityFlowLogo = ({ className }: { className?: string }) => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none"
    xmlns="http://www.w3.org/2000/svg" className={cn('text-primary', className)}>
    <path
      d="M16 3.5C9.09644 3.5 3.5 9.09644 3.5 16C3.5 22.9036 9.09644 28.5 16 28.5C22.9036 28.5 28.5 22.9036 28.5 16C28.5 9.09644 22.9036 3.5 16 3.5Z"
      stroke="currentColor" strokeWidth="3" />
    <path
      d="M16.0011 20.9C18.7067 20.9 20.9011 18.7056 20.9011 16C20.9011 13.2944 18.7067 11.1 16.0011 11.1"
      stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

// ─── NAV SECTIONS ──────────────────────────────────────────────────────────────
// Ordered by daily workflow frequency:
//   1. Daily Hub       — touched every session
//   2. Clients         — constant but not every minute
//   3. Studio Assets   — weekly configuration
//   4. Team            — scheduling & staff
//   5. Financial Suite — periodic deep-dives
//   6. Events          — as needed
//   7. Public Portals  — rarely accessed, critical when needed

const DAILY_HUB = [
  { href: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard'      },
  { href: '/planner',     icon: Calendar,        label: 'Planner'        },
  { href: '/pos',         icon: ListChecks,      label: 'Terminal (POS)' },
  { href: '/my-schedule', icon: Clock,           label: 'My Schedule'    },
];

const CLIENT_GROWTH = [
  { href: '/clients',   icon: User,      label: 'Guest Dossier' },
  { href: '/quotes',    icon: FileText,  label: 'Quotes'        },
  { href: '/campaigns', icon: Megaphone, label: 'Outreach'      },
  { href: '/reviews',   icon: Star,      label: 'Reputation'    },
];

const STUDIO_ASSETS = [
  { href: '/services',    icon: BookOpen,      label: 'Service Menu'       },
  { href: '/inventory',   icon: Box,           label: 'Manifest'           },
  { href: '/memberships', icon: Star,          label: 'Clubs'              },
  { href: '/discounts',   icon: Percent,       label: 'Incentives'         },
  { href: '/resources',   icon: HardHat,       label: 'Resources'          },
  { href: '/consents',    icon: FileSignature, label: 'Agreements'         },
];

const TEAM_FULL = [
  { href: '/staff',      icon: Users,        label: 'Pro Team'       },
  { href: '/schedule',   icon: CalendarDays, label: 'Shift Schedule' },
  { href: '/timesheets', icon: ClipboardList,label: 'Timesheets'     },
];

const TEAM_ADMIN = [
  { href: '/staff',      icon: Users,        label: 'Pro Team'       },
  { href: '/schedule',   icon: CalendarDays, label: 'Shift Schedule' },
  { href: '/timesheets', icon: ClipboardList,label: 'Timesheets'     },
];

const FINANCIAL_SUITE = [
  { href: '/financials', icon: Landmark,   label: 'Foundation (TMHR)' },
  { href: '/ledger',     icon: BookText,   label: 'Ledger'            },
  { href: '/bills',      icon: CreditCard, label: 'Obligations'       },
  { href: '/payday',     icon: DollarSign, label: 'Payday'            },
  { href: '/reports',    icon: BarChart,   label: 'Analytics'         },
];

const EVENTS = [
  { href: '/events', icon: PartyPopper, label: 'Events' },
];

const PUBLIC_PORTALS = [
  { href: '/book',         icon: Globe,       label: 'Booking Page'     },
  { href: '/kiosk',        icon: Fingerprint, label: 'Walk-in Kiosk'    },
  { href: '/concierge',    icon: Coffee,      label: 'Lounge Concierge' },
  { href: '/kds',          icon: ChefHat,     label: 'KDS Display'      },
  { href: '/floor',        icon: Layers,      label: 'Floor Staff'      },
  { href: '/timeclock',    icon: Clock,       label: 'Time Clock'       },
  { href: '/staff-portal', icon: Shield,      label: 'Staff Portal'     },
];

// ─── NAV ITEM ──────────────────────────────────────────────────────────────────
function NavItem({
  href, icon: Icon, label, isPortal = false, tenantId,
}: {
  href: string; icon: any; label: string; isPortal?: boolean; tenantId?: string;
}) {
  const pathname    = usePathname();
  const { state }   = useSidebar();
  const isCollapsed = state === 'collapsed';

  // Portals open in new tab with the tenantId appended
  const finalHref = isPortal && tenantId ? `${href}/${tenantId}` : href;
  const isActive  = !isPortal && (
    href === '/dashboard' ? pathname === href : pathname.startsWith(href)
  );

  const btn = (
    <SidebarMenuButton
      asChild
      isActive={isActive}
      className={cn(
        'rounded-xl h-10 font-black uppercase text-[9px] tracking-widest',
        'transition-all duration-150',
        // Expanded: normal text + icon
        'data-[active=true]:bg-primary data-[active=true]:text-primary-foreground',
        'data-[active=true]:shadow-md data-[active=true]:shadow-primary/20',
        'hover:bg-primary/10 hover:text-primary',
        // Collapsed icon mode: centre the icon
        isCollapsed && 'justify-center',
      )}
    >
      <Link href={finalHref} target={isPortal ? '_blank' : undefined}>
        <Icon className="w-[17px] h-[17px] shrink-0" />
        <span>{label}</span>
        {isPortal && !isCollapsed && (
          <ExternalLink className="ml-auto w-3 h-3 opacity-30 shrink-0" />
        )}
      </Link>
    </SidebarMenuButton>
  );

  // In collapsed mode show a tooltip so the icon is still labelled
  if (isCollapsed) {
    return (
      <SidebarMenuItem>
        <Tooltip>
          <TooltipTrigger asChild>{btn}</TooltipTrigger>
          <TooltipContent
            side="right"
            align="center"
            className="font-black uppercase text-[9px] tracking-widest rounded-xl border-2 shadow-xl"
          >
            {label}
          </TooltipContent>
        </Tooltip>
      </SidebarMenuItem>
    );
  }

  return <SidebarMenuItem>{btn}</SidebarMenuItem>;
}

// ─── NAV SECTION ───────────────────────────────────────────────────────────────
function NavSection({
  label, items, isPortal, tenantId,
}: {
  label: string;
  items: { href: string; icon: any; label: string }[];
  isPortal?: boolean;
  tenantId?: string;
}) {
  const { state }   = useSidebar();
  const isCollapsed = state === 'collapsed';

  return (
    <SidebarGroup className="py-1">
      {/* Label — hidden in icon mode */}
      {!isCollapsed && (
        <SidebarGroupLabel className="px-3 mb-1 h-5 font-black uppercase text-[8px] tracking-[0.22em] text-muted-foreground/40">
          {label}
        </SidebarGroupLabel>
      )}
      {/* Thin divider replaces label in icon mode */}
      {isCollapsed && <div className="mx-auto w-4 h-px bg-border/50 mb-2" />}
      <SidebarMenu className="gap-px px-0">
        {items.map(item => (
          <NavItem
            key={item.href} {...item}
            isPortal={isPortal} tenantId={tenantId}
          />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

// ─── COLLAPSE TOGGLE ───────────────────────────────────────────────────────────
// Wraps useSidebar so it can live inside the Sidebar context
function CollapseToggle() {
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === 'collapsed';
  return (
    <button
      onClick={toggleSidebar}
      className="flex items-center justify-center w-8 h-8 rounded-xl hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all shrink-0"
      title={isCollapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
    >
      {isCollapsed
        ? <PanelLeftOpen  className="w-4 h-4" />
        : <PanelLeftClose className="w-4 h-4" />}
    </button>
  );
}

// ─── MAIN SIDEBAR ──────────────────────────────────────────────────────────────
export function AppSidebar() {
  const { selectedTenant, role } = useTenant();
  const tenantId = selectedTenant?.id;
  const auth     = useAuth();
  const router   = useRouter();
  const pathname = usePathname();

  const isOwner = role === 'owner';
  const isAdmin = role === 'admin';

  const handleLogout = async () => {
    if (auth) { await signOut(auth); router.push('/login'); }
  };

  return (
    <TooltipProvider delayDuration={0}>
      <Sidebar
        collapsible="icon"
        className="border-r-2 border-border/40 bg-white"
      >
        {/* ── Rail — thin click-strip on the right edge for easy collapse ── */}
        <SidebarRail />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <SidebarHeader className="border-b border-border/30">
          <div className="flex items-center justify-between px-4 py-4 min-h-[68px]">
            {/* Logo + wordmark — wordmark hidden in icon mode via group */}
            <Link href="/dashboard" className="flex items-center gap-3 min-w-0">
              <ClarityFlowLogo className="w-8 h-8 shrink-0" />
              {/* Hidden by sidebar's group-data-[collapsible=icon] CSS */}
              <div className="flex flex-col leading-none min-w-0 group-data-[collapsible=icon]:hidden">
                <span className="text-[19px] font-black uppercase tracking-tighter text-slate-900">
                  ClarityFlow
                </span>
                <span className="text-[7px] font-black uppercase tracking-[0.35em] text-primary opacity-60 mt-0.5">
                  Studio OS
                </span>
              </div>
            </Link>

            {/* Collapse button — hidden in icon mode (no room) */}
            <div className="group-data-[collapsible=icon]:hidden">
              <CollapseToggle />
            </div>
          </div>
        </SidebarHeader>

        {/* ── Content ────────────────────────────────────────────────────── */}
        <SidebarContent className="overflow-y-auto overflow-x-hidden py-2 px-1.5">

          {/* Tenant switcher — owner only, full mode only */}
          {isOwner && (
            <div className="px-2 pb-3 pt-1 group-data-[collapsible=icon]:hidden">
              <ClientOnly><TenantSwitcher /></ClientOnly>
            </div>
          )}

          {/* 1 ── Daily Hub (all roles) */}
          <NavSection label="Daily" items={DAILY_HUB} />

          {/* 2 ── Clients & Growth (owner) */}
          {isOwner && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection label="Clients & Growth" items={CLIENT_GROWTH} />
            </>
          )}

          {/* 3 ── Studio Assets (owner) */}
          {isOwner && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection label="Studio Assets" items={STUDIO_ASSETS} />
            </>
          )}

          {/* 4 ── Team — full for owner, subset for admin */}
          {isOwner && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection label="Team" items={TEAM_FULL} />
            </>
          )}
          {isAdmin && !isOwner && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection label="Team" items={TEAM_ADMIN} />
            </>
          )}

          {/* 5 ── Financial Suite (owner) */}
          {isOwner && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection label="Financial Suite" items={FINANCIAL_SUITE} />
            </>
          )}

          {/* 6 ── Events (owner) */}
          {isOwner && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection label="Events" items={EVENTS} />
            </>
          )}

          {/* 7 ── Public Portals (owner + tenantId) */}
          {isOwner && tenantId && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection
                label="Public Portals"
                items={PUBLIC_PORTALS}
                isPortal
                tenantId={tenantId}
              />
            </>
          )}
        </SidebarContent>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <SidebarFooter className="border-t border-border/30 py-2 px-1.5">
          <SidebarMenu className="gap-px px-0">

            {/* In icon mode — show the expand button here so it's reachable */}
            <SidebarMenuItem className="group-data-[collapsible!=icon]:hidden">
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    onClick={() => {
                      /* CollapseToggle handles this via SidebarRail;
                         this is a fallback tap target in icon mode */
                    }}
                    className="rounded-xl h-10 hover:bg-primary/10 hover:text-primary text-muted-foreground transition-all justify-center"
                  >
                    <PanelLeftOpen className="w-[17px] h-[17px]" />
                    <span>Expand</span>
                  </SidebarMenuButton>
                </TooltipTrigger>
                <TooltipContent side="right" className="font-black uppercase text-[9px] tracking-widest rounded-xl border-2">
                  Expand sidebar (⌘B)
                </TooltipContent>
              </Tooltip>
            </SidebarMenuItem>

            {/* Settings — owner only */}
            {isOwner && (
              <NavItem href="/settings" icon={Settings} label="Studio Settings" />
            )}

            {/* Sign out */}
            <SidebarMenuItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    onClick={handleLogout}
                    className="rounded-xl h-10 font-black uppercase text-[9px] tracking-widest text-destructive hover:bg-destructive/8 hover:text-destructive transition-all"
                  >
                    <LogOut className="w-[17px] h-[17px] shrink-0" />
                    <span>Sign Out</span>
                  </SidebarMenuButton>
                </TooltipTrigger>
                <TooltipContent side="right" className="font-black uppercase text-[9px] tracking-widest rounded-xl border-2">
                  Sign Out
                </TooltipContent>
              </Tooltip>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    </TooltipProvider>
  );
}

// ─── MOBILE TRIGGER ────────────────────────────────────────────────────────────
// Drop this into your AppHeader for the mobile hamburger button.
// It calls toggleSidebar which opens the Sheet on mobile (< lg breakpoint).
export function MobileSidebarTrigger({ className }: { className?: string }) {
  return (
    <SidebarTrigger
      className={cn(
        'lg:hidden flex items-center justify-center w-10 h-10 rounded-xl',
        'hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all',
        className,
      )}
    />
  );
}