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
  Armchair, KeyRound, HandCoins,
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
//   6. Booth Rental    — renters, leases, and rent collection
//   7. Events          — as needed
//   8. Public Portals  — rarely accessed, critical when needed

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

const BOOTH_RENTAL = [
  { href: '/booths',  icon: Armchair,  label: 'Booths'  },
  { href: '/renters', icon: KeyRound,  label: 'Renters' },
  { href: '/rent',    icon: HandCoins, label: 'Rent'    },
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
  const