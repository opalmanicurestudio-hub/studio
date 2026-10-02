'use client';

import { guestLogo } from '@/lib/brand';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import {
  Sidebar, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarFooter, SidebarContent, SidebarSeparator, SidebarGroup,
  SidebarGroupLabel, SidebarRail, SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar';
import { AlertTriangle, Armchair, BarChart, BookOpen, Bot, Box, Boxes, Building2, Calendar, CalendarClock, CalendarDays, ChefHat, ChevronRight, ClipboardList, Clock, Coffee, ConciergeBell, DoorOpen, ExternalLink, FileSignature, FileText, Fingerprint, FlaskConical, Gauge, Globe, HandCoins, HardHat, History as HistoryIcon, Hourglass, KeyRound, Landmark, Layers, LayoutDashboard, LifeBuoy, ListChecks, LogOut, Megaphone, MessageSquare, PackageCheck, PackageOpen, Paintbrush, PanelLeftClose, PanelLeftOpen, PartyPopper, Percent, Receipt, RotateCcw, Send, Settings, Shield, ShieldQuestion, ShoppingBag, Star, User, Users, Users2, Wallet, Wrench, UserCheck, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { TenantSwitcher } from './TenantSwitcher';
import { ClientOnly } from './ClientOnly';
import { useTenant } from '@/context/TenantContext';
import { cn } from '@/lib/utils';
import { useAuth, useFirebase, useUser } from '@/firebase';
import { pageVisible } from '@/lib/modules';
import { openHelp, useIsHqAdmin } from '@/components/support/HelpDesk';
import { resolveActiveStaffId } from '@/lib/staff-identity';
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
const DAILY_HUB = [
  { href: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard'      },
  { href: '/planner',     icon: Calendar,        label: 'Planner'        },
  { href: '/pos',         icon: ListChecks,      label: 'Front desk' },
  { href: '/host',        icon: ConciergeBell,   label: 'Host stand'     },
  { href: '/voice',       icon: Bot,             label: 'Phone assistant'},
  { href: '/messages',    icon: MessageSquare,   label: 'Messages'       },
  { href: '/message-log', icon: Send,            label: 'Message log'    },
  { href: '/my-schedule', icon: Clock,           label: 'My schedule'    },
  // Only rendered when approval mode is producing requests — see the filter
  // at render time. A permanent link to an always-empty queue is clutter.
  { href: '/appointments/requests', icon: CalendarClock, label: 'Requests' },
];

const CLIENT_GROWTH = [
  { href: '/clients',   icon: User,      label: 'Clients' },
  { href: '/quotes',    icon: FileText,  label: 'Quotes'        },
  { href: '/campaigns', icon: Megaphone, label: 'Outreach'      },
  { href: '/reviews',   icon: Star,      label: 'Reputation'    },
];

const STUDIO_ASSETS = [
  { href: '/services',    icon: BookOpen,      label: 'Services'       },
  { href: '/inventory',   icon: Box,           label: 'Manifest'           },
  { href: '/inventory/distribution', icon: Boxes, label: 'Distribution' },
  { href: '/inventory/formulas', icon: FlaskConical, label: 'Formulas' },
  { href: '/memberships', icon: Star,          label: 'Clubs'              },
  { href: '/discounts',   icon: Percent,       label: 'Incentives'         },
  { href: '/resources',   icon: HardHat,       label: 'Resources'          },
  { href: '/maintenance', icon: Wrench,        label: 'Maintenance'        },
  { href: '/consents',    icon: FileSignature, label: 'Agreements'         },
];

const COMMERCE = [
  { href: '/retail-orders',          icon: PackageCheck, label: 'Shop orders'   },
  { href: '/retail-orders/history',  icon: HistoryIcon,  label: 'Order history' },
  { href: '/retail-orders/customers', icon: Users2,      label: 'Shoppers'      },
  { href: '/retail-orders/waves',     icon: Layers,       label: 'Wave picking'  },
  { href: '/retail-orders/bench',     icon: PackageOpen,  label: 'Pack bench'    },
  { href: '/retail-orders/kpis',      icon: Gauge,        label: 'Fulfilment'    },
  { href: '/retail-orders/returns',  icon: RotateCcw,    label: 'Returns'       },
  { href: '/retail-orders/reviews',  icon: Star,         label: 'Reviews'       },
  { href: '/retail-orders/claims',   icon: ShieldQuestion, label: 'Claims'      },
  { href: '/retail-orders/support',  icon: LifeBuoy,     label: 'Shop support'  },
  { href: '/retail-orders/wholesale', icon: Building2,   label: 'Wholesale'     },
  { href: '/retail-orders/designer', icon: Paintbrush,   label: 'Shop designer' },
  { href: '/retail-orders/settings', icon: ShoppingBag,  label: 'Shop settings' },
];

const TEAM_FULL = [
  { href: '/staff',      icon: Users,        label: 'Team'       },
  { href: '/applicants', icon: Send,         label: 'Applicants'     },
  { href: '/documents',  icon: FileText,     label: 'Documents'      },
  { href: '/schedule',   icon: CalendarDays, label: 'Shift schedule' },
  { href: '/timesheets', icon: ClipboardList,label: 'Timesheets'     },
];

const TEAM_ADMIN = [
  { href: '/staff',      icon: Users,        label: 'Team'       },
  { href: '/applicants', icon: Send,         label: 'Applicants'     },
  { href: '/documents',  icon: FileText,     label: 'Documents'      },
  { href: '/schedule',   icon: CalendarDays, label: 'Shift schedule' },
  { href: '/timesheets', icon: ClipboardList,label: 'Timesheets'     },
];

// v28 — Ledger, Obligations (Bills), and Payday are now consolidated into
// the tabbed Money Hub at /money. Their old sidebar entries are replaced
// by a single "Money Hub" link; the hub's internal tabs handle the rest.
const FINANCIAL_SUITE = [
  { href: '/financials', icon: Landmark,      label: 'Pricing foundation' },
  { href: '/money',      icon: Wallet,        label: 'Money'         },
  { href: '/disputes',   icon: AlertTriangle, label: 'Disputes'    },
  { href: '/reports',    icon: BarChart,      label: 'Analytics'         },
];

// The hub is being taken apart into pages (the v49 note above this used to
// say the opposite). Rent moved out of it in R5 — money, schedule, notices,
// swaps — but never got a door: the only way in was a link buried on the
// hub's Operations tab. Every page the rental module owns is listed here.
const BOOTH_RENTAL = [
  { href: '/booths',   icon: Armchair,  label: 'Spaces'   },
  { href: '/pipeline', icon: Users,     label: 'Pipeline' },
  { href: '/renters',  icon: UserCheck, label: 'Renters'  },
  { href: '/rent',     icon: Wallet,    label: 'Rent'     },
];

const EVENTS = [
  // Classes had a page but no sidebar link — nobody could find it.
  { href: '/classes', icon: CalendarDays, label: 'Classes' },
  { href: '/academy', icon: BookOpen, label: 'Academy' },
  { href: '/events', icon: PartyPopper, label: 'Events' },
];

const PUBLIC_PORTALS = [
  { href: '/book',         icon: Globe,       label: 'Booking page'     },
  { href: '/shop',         icon: ShoppingBag, label: 'Online shop'      },
  // Walk-in APPOINTMENT kiosk (rebuilt) lives at /walk-in/[tenantId].
  { href: '/walk-in',      icon: Fingerprint, label: 'Walk-in kiosk'    },
  // The waiting-room wall screen: who is next, roughly how long, who is free.
  // Sits directly under the kiosk because they are one pair — the kiosk takes
  // the guest in, this screen is what she stares at afterwards. Like every entry
  // in this list it is rendered with isPortal, so NavItem appends the studio id
  // and opens it in a new tab: /lobby/{tenantId}. Cast it to the lobby TV and
  // leave it; it polls on its own.
  { href: '/lobby',        icon: Hourglass,   label: 'Lobby board'      },
  // The old /kiosk route is now the booth-renter CHECK-IN kiosk.
  { href: '/kiosk',        icon: DoorOpen,    label: 'Check-in kiosk'   },
  { href: '/concierge',    icon: Coffee,      label: 'Lounge concierge' },
  { href: '/kds',          icon: ChefHat,     label: 'Kitchen screen'      },
  { href: '/floor',        icon: Layers,      label: 'Floor staff'      },
  { href: '/timeclock',    icon: Clock,       label: 'Time clock'       },
  { href: '/staff-portal', icon: Shield,      label: 'Staff portal'     },
];

/** Every page in the menu, by area — what the header search looks through. */
export const NAV_AREAS: { area: string; items: { href: string; label: string }[] }[] = [
  { area: 'Today', items: DAILY_HUB }, { area: 'Clients', items: CLIENT_GROWTH }, { area: 'Studio', items: STUDIO_ASSETS }, { area: 'Shop', items: COMMERCE },
  { area: 'Team', items: TEAM_FULL }, { area: 'Money', items: FINANCIAL_SUITE }, { area: 'Booth rental', items: BOOTH_RENTAL }, { area: 'Events', items: EVENTS },
] as any;

// ─── NAV ITEM ──────────────────────────────────────────────────────────────────
function NavItem({
  href, icon: Icon, label, isPortal = false, tenantId, badge,
}: {
  href: string; icon: any; label: string; isPortal?: boolean; tenantId?: string; badge?: number;
}) {
  const pathname    = usePathname();
  const { state }   = useSidebar();
  const isCollapsed = state === 'collapsed';

  const finalHref = isPortal && tenantId ? `${href}/${tenantId}` : href;
  const isActive  = !isPortal && (
    pathname === href || pathname.startsWith(`${href}/`)
  );

  const btn = (
    <SidebarMenuButton
      asChild
      isActive={isActive}
      className={cn(
        'rounded-xl h-10 text-[14px] font-medium normal-case tracking-normal',
        'transition-colors duration-150',
        'data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:font-semibold',
        'hover:bg-[#f3eee8] dark:hover:bg-[#2a2521]',
        isCollapsed && 'justify-center',
      )}
    >
      <Link href={finalHref} target={isPortal ? '_blank' : undefined}>
        <div className="relative shrink-0">
          <Icon className="w-[17px] h-[17px]" />
          {badge !== undefined && badge > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[9px] font-semibold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center leading-none">
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </div>
        <span>{label}</span>
        {isPortal && !isCollapsed && (
          <ExternalLink className="ml-auto w-3 h-3 opacity-30 shrink-0" />
        )}
      </Link>
    </SidebarMenuButton>
  );

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
            {label}{badge !== undefined && badge > 0 ? ` (${badge})` : ''}
          </TooltipContent>
        </Tooltip>
      </SidebarMenuItem>
    );
  }

  return <SidebarMenuItem>{btn}</SidebarMenuItem>;
}

function NavSection({
  label, items, isPortal, tenantId, badges,
}: {
  label:    string;
  items:    { href: string; icon: any; label: string }[];
  isPortal?: boolean;
  tenantId?: string;
  badges?:  Record<string, number>;
}) {
  const { selectedTenant } = useTenant();
  const { state }   = useSidebar();
  const isCollapsed = state === 'collapsed';
  const pathname = usePathname();
  const holdsCurrent = items.some((it: any) => pathname === it.href || pathname.startsWith(`${it.href}/`));
  const [open, setOpen] = useState<boolean>(holdsCurrent || label === 'Today');
  useEffect(() => { if (holdsCurrent) setOpen(true); }, [holdsCurrent]);
  const shown = isCollapsed || open;

  return (
    <SidebarGroup className="py-1">
      {!isCollapsed && (
        <SidebarGroupLabel asChild className="px-3 mb-0.5 h-8 text-[12.5px] font-medium normal-case tracking-normal text-muted-foreground">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between rounded-lg hover:text-foreground">
            <span>{label}</span><ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
          </button>
        </SidebarGroupLabel>
      )}
      {isCollapsed && <div className="mx-auto w-4 h-px bg-border/50 mb-2" />}
      {shown && <SidebarMenu className="gap-px px-0">
        {items.filter((item: any) => pageVisible(selectedTenant, item.href)).map(item => (
          <NavItem
            key={item.href} {...item}
            isPortal={isPortal}
            tenantId={tenantId}
            badge={badges?.[item.href]}
          />
        ))}
      </SidebarMenu>}
    </SidebarGroup>
  );
}

function CollapseToggle() {
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === 'collapsed';
  return (
    <button onClick={toggleSidebar}
      className="flex items-center justify-center w-8 h-8 rounded-xl hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all shrink-0"
      title={isCollapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
    >
      {isCollapsed
        ? <PanelLeftOpen  className="w-4 h-4" />
        : <PanelLeftClose className="w-4 h-4" />}
    </button>
  );
}

// The floating card (Studio look): white on warm paper, soft shadow, generous radius; the business in a tinted card.
const SIDE_CSS = `
.cf-side{padding:12px!important}
.cf-side [data-sidebar="sidebar"]{background:#fff!important;border:0!important;border-radius:26px!important;box-shadow:0 1px 2px rgba(28,25,23,.05),0 10px 32px rgba(28,25,23,.07)!important}
.dark .cf-side [data-sidebar="sidebar"]{background:#211d1a!important}
.cf-biz{background:color-mix(in srgb, hsl(var(--primary)) 9%, transparent)}
.dark{--cf-search-bg:#211d1a}
`;
export function AppSidebar() {
  const { selectedTenant, role } = useTenant();
  const brandLogo = guestLogo(selectedTenant);
  const isHqAdmin = useIsHqAdmin();
  const tenantId = selectedTenant?.id;
  const auth     = useAuth();
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const router   = useRouter();
  const pathname = usePathname();

  const isOwner = role === 'owner';
  const isAdmin = role === 'admin';
  const isOwnerOrAdmin = isOwner || isAdmin;

  // v27 — FIX: /messages was completely absent from the sidebar — every
  // client conversation, staff DM, and team broadcast built this
  // conversation had zero way to be reached from the main nav. Badge
  // count respects the same admin-vs-staff visibility split already
  // established in messages-page.tsx and the mobile portal: owner/admin
  // see every open client thread; regular staff only see ones assigned to
  // them. Combined with a rough unread proxy for staff DMs (last message
  // not sent by me), same heuristic used in the mobile portal's badge.
  const [messagesBadgeCount, setMessagesBadgeCount] = useState(0);
  useEffect(() => {
    const activeStaffId = resolveActiveStaffId(currentUser?.uid);
    if (!firestore || !tenantId || !activeStaffId) return;
    const clientThreadsQ = isOwnerOrAdmin
      ? query(collection(firestore, `tenants/${tenantId}/smsThreads`), where('status', '==', 'open'))
      : query(collection(firestore, `tenants/${tenantId}/smsThreads`), where('status', '==', 'open'), where('assignedStaffId', '==', activeStaffId));
    const staffThreadsQ = query(collection(firestore, `tenants/${tenantId}/staffThreads`), where('participantIds', 'array-contains', activeStaffId));

    let clientCount = 0;
    let staffCount = 0;
    const unsubClient = onSnapshot(clientThreadsQ, (snap) => {
      clientCount = snap.size;
      setMessagesBadgeCount(clientCount + staffCount);
    }, () => { /* non-fatal */ });
    const unsubStaff = onSnapshot(staffThreadsQ, (snap) => {
      staffCount = snap.docs.filter((d) => {
        const data = d.data() as any;
        return data.lastMessageBy && data.lastMessageBy !== activeStaffId && !(data.readBy || []).includes(activeStaffId);
      }).length;
      setMessagesBadgeCount(clientCount + staffCount);
    }, () => { /* non-fatal */ });

    return () => { unsubClient(); unsubStaff(); };
  }, [firestore, tenantId, currentUser?.uid, isOwnerOrAdmin]);

  /* Booking requests waiting on an answer. Live-counted rather than derived
   * from settings, so the badge is the truth even if the shop switches modes
   * with requests still open — and the nav entry hides entirely when there is
   * nothing to answer, so shops that never turn approval on never see it. */
  const [requestBadgeCount, setRequestBadgeCount] = useState(0);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore, `tenants/${tenantId}/appointments`),
      where('status', '==', 'requested'),
    );
    // Online bookings stuck before 5a (bookingRequests still 'pending') count too,
    // so the Requests entry shows until they're answered.
    let appts = 0, stranded = 0; const push = () => setRequestBadgeCount(appts + stranded);
    const unsub = onSnapshot(q, (snap) => { appts = snap.size; push(); }, () => { /* non-fatal */ });
    const unsub2 = onSnapshot(query(collection(firestore, `tenants/${tenantId}/bookingRequests`), where('status', '==', 'pending')),
      (snap) => { stranded = snap.docs.filter((d) => { const c: any = (d.data() as any).createdAt; const ms = c?.toMillis ? c.toMillis() : Date.parse(c || ''); return !ms || Date.now() - ms > 20 * 60000; }).length; push(); }, () => { /* non-fatal */ });
    return () => { unsub(); unsub2(); };
  }, [firestore, tenantId]);

  /* Renters who are waiting on the studio: an unread reply in their thread,
   * or a concern nobody has acknowledged. One number on the Renters entry,
   * because "did anyone write back?" should be answerable from any page. */
  const [rentersBadgeCount, setRentersBadgeCount] = useState(0);
  useEffect(() => {
    if (!firestore || !tenantId) return;
    let threads = 0, concerns = 0;
    const unsubT = onSnapshot(query(collection(firestore, `tenants/${tenantId}/renterThreads`), where('unreadForOwner', '==', true)),
      (snap) => { threads = snap.size; setRentersBadgeCount(threads + concerns); }, () => { /* non-fatal */ });
    const unsubC = onSnapshot(query(collection(firestore, `tenants/${tenantId}/renterGrievances`), where('status', '==', 'open')),
      (snap) => { concerns = snap.size; setRentersBadgeCount(threads + concerns); }, () => { /* non-fatal */ });
    return () => { unsubT(); unsubC(); };
  }, [firestore, tenantId]);
  const rentalBadges = rentersBadgeCount > 0 ? { '/renters': rentersBadgeCount } : undefined;

  /* Show Requests whenever the shop RUNS approval mode, not only when the
   * queue is non-empty. Hiding it at zero seemed tidy, but it means an owner
   * who has just switched approval on has no way to find the screen, cannot
   * confirm it works, and has nowhere to look when a client says "I sent a
   * request". An empty queue is information; an invisible one is not. */
  const approvalMode = String((selectedTenant as any)?.bookingMode?.mode || 'instant') === 'approval';
  const dailyItems = DAILY_HUB.filter(
    (i) => i.href !== '/appointments/requests' || approvalMode || requestBadgeCount > 0,
  );
  const dailyBadges = {
    ...(messagesBadgeCount > 0 ? { '/messages': messagesBadgeCount } : {}),
    ...(requestBadgeCount > 0 ? { '/appointments/requests': requestBadgeCount } : {}),
  };

  const handleLogout = async () => {
    if (auth) { await signOut(auth); router.push('/login'); }
  };

  // Badge counts — add open dispute count here
  // This is a lightweight approach: read from TenantContext if dispute count is stored there,
  // or pass 0 and let the Dispute Center show the count internally.
  // To show live badge: store openDisputeCount on the tenant doc and read it via selectedTenant.
  const openDisputeCount = (selectedTenant as any)?.openDisputeCount || 0;

  const financialBadges = openDisputeCount > 0
    ? { '/disputes': openDisputeCount }
    : undefined;

  return (
    <TooltipProvider delayDuration={0}>
      <Sidebar
        collapsible="icon"
        variant="floating"
        className="cf-side"
      >
        <SidebarRail />

        <SidebarHeader className="p-3 pb-1">
          <div className="flex items-center justify-between gap-2">
            {/* The business's own identity up top — ClarityFlow's mark sits quietly at the bottom. */}
            <style dangerouslySetInnerHTML={{ __html: SIDE_CSS }} />
            <Link href="/dashboard" className="cf-biz flex min-w-0 flex-1 items-center gap-3 rounded-[18px] p-2.5 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
              {brandLogo ? <img src={brandLogo} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-primary-foreground">{String((selectedTenant as any)?.name || 'C').trim()[0]?.toUpperCase()}</span>}
              <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-[14.5px] font-semibold tracking-tight text-primary">{(selectedTenant as any)?.name || 'Your studio'}</span>
                <span className="truncate text-[12px] text-muted-foreground">{role === 'owner' ? 'Owner' : role ? String(role)[0].toUpperCase() + String(role).slice(1) : 'Studio'}</span>
              </div>
            </Link>

            <div className="group-data-[collapsible=icon]:hidden">
              {/* (Collapse lives in the header bar and the sidebar's footer — the card keeps the business name readable.) */}
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="overflow-y-auto overflow-x-hidden py-2 px-1.5">

          {isOwner && (
            <div className="px-2 pb-3 pt-1 group-data-[collapsible=icon]:hidden">
              <ClientOnly><TenantSwitcher /></ClientOnly>
            </div>
          )}

          <NavSection label="Today" items={dailyItems} badges={Object.keys(dailyBadges).length > 0 ? dailyBadges : undefined} />

          {isOwner && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection label="Clients" items={CLIENT_GROWTH} />
            </>
          )}

          {isOwner && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection label="Studio" items={STUDIO_ASSETS} />
              <NavSection label="Shop" items={COMMERCE} />
            </>
          )}

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

          {isOwner && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection
                label="Money"
                items={FINANCIAL_SUITE}
                badges={financialBadges}
              />
            </>
          )}

          {isOwner && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection label="Booth rental" items={BOOTH_RENTAL} badges={rentalBadges} />
            </>
          )}

          {isOwner && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection label="Events" items={EVENTS} />
            </>
          )}

          {isOwner && tenantId && (
            <>
              <SidebarSeparator className="my-1 opacity-20" />
              <NavSection
                label="Public pages"
                items={PUBLIC_PORTALS}
                isPortal
                tenantId={tenantId}
              />
            </>
          )}
        </SidebarContent>

        <SidebarFooter className="border-t border-[#efeae4] py-2 px-1.5 dark:border-[#342e29]">
          <SidebarMenu className="gap-px px-0">

            <SidebarMenuItem className="group-data-[state=expanded]:hidden">
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    onClick={() => {}}
                    className="rounded-xl h-10 hover:bg-primary/10 hover:text-primary text-muted-foreground transition-all justify-center"
                  >
                    <PanelLeftOpen className="w-[17px] h-[17px]" />
                    <span>Expand</span>
                  </SidebarMenuButton>
                </TooltipTrigger>
                <TooltipContent side="right" className="rounded-xl border text-[13px]">
                  Expand sidebar (⌘B)
                </TooltipContent>
              </Tooltip>
            </SidebarMenuItem>

            {isOwner && (
              <NavItem href="/settings" icon={Settings} label="Settings" />
            )}
            {isHqAdmin && <NavItem href="/admin/tenants" icon={Shield} label="ClarityFlow HQ" />}
            <SidebarMenuItem>
              <SidebarMenuButton onClick={openHelp} className="rounded-xl h-10 text-[14px] font-medium text-muted-foreground hover:bg-primary/5 hover:text-primary transition-colors">
                <LifeBuoy className="w-[17px] h-[17px] shrink-0" />
                <span>Help</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    onClick={handleLogout}
                    className="rounded-xl h-10 font-black uppercase text-[9px] tracking-widest text-destructive hover:bg-destructive/8 hover:text-destructive transition-all"
                  >
                    <LogOut className="w-[17px] h-[17px] shrink-0" />
                    <span>Sign out</span>
                  </SidebarMenuButton>
                </TooltipTrigger>
                <TooltipContent side="right" className="rounded-xl border text-[13px]">
                  Sign out
                </TooltipContent>
              </Tooltip>
            </SidebarMenuItem>
          </SidebarMenu>
                  <div className="mt-1 flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground group-data-[collapsible=icon]:justify-center"><ClarityFlowLogo className="h-4 w-4 opacity-70" /><span className="group-data-[collapsible=icon]:hidden">ClarityFlow</span></div>
</SidebarFooter>
      </Sidebar>
    </TooltipProvider>
  );
}

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
