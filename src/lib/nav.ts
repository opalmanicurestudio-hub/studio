// src/lib/nav.ts — THE MENU, BY WHAT A BUSINESS HAS (design board "Only what your plan includes, in the same order
// everywhere", A: sections by the work, nothing you don't have; components/shared/AppSidebar and the header search).
// A page shows in the menu only when the business's plan includes it (lib/modules pageVisible) and it fits how the
// business works: one that doesn't take bookings never sees the booking pages, and one that doesn't serve food never
// sees the food pages. Sections come in one fixed order, and a section with nothing in it isn't shown. Turning a tool
// on or off changes the menu straight away. (A page left out of the menu still opens from a link.)
import { lockedModule, moduleEnabled, pageVisible } from '@/lib/modules';
import { takesBookings } from '@/lib/business-shape';
import { isFoodBusiness } from '@/lib/food-setup';

/** Pages only a business that takes bookings uses. */
export const BOOKING_PAGES = ['/planner', '/before-the-visit', '/waitlist', '/appointments/requests', '/tidy', '/services', '/book'];
/** Pages only a business that serves food or drink uses (the food menu, and what runs service). */
export const FOOD_PAGES = ['/menu', '/food-cost', '/binder', '/briefing', '/prep', '/host', '/tables', '/clear', '/bar-tabs', '/counter', '/drive-live', '/close'];

/** It serves food or drink: it says so, it chose the lounge and hospitality tool, or it takes orders ahead from its menu. */
export const servesFood = (t: any): boolean => isFoodBusiness(t) || t?.modules?.hospitality === true || t?.orderAhead?.on === true;

/** Whether the business's plan includes a page (its tools, nothing about how it works): what the header search goes by,
 *  so a page the menu leaves out on how the business works can still be found by name. */
export const planShown = (t: any, href: string): boolean => pageVisible(t, href) && !lockedModule(t, href);

/** Whether a page belongs in this business's menu. */
export function navShown(t: any, href: string): boolean {
  // (A page under a tool's own page is that tool's too: the shop's Problems and Setup go with the shop.)
  if (!pageVisible(t, href) || lockedModule(t, href)) return false;
  if (BOOKING_PAGES.includes(href) && !takesBookings(t)) return false;
  if (FOOD_PAGES.includes(href) && !servesFood(t)) return false;
  // (The front desk: for bookings, and for selling in person at a shop; a café or a drive-thru rings up at the Counter.)
  if (href === '/pos') return takesBookings(t) || (moduleEnabled(t, 'retail') && t?.modules?.retail === true) || !servesFood(t);
  return true;
}

export type NavSectionId = 'today' | 'appointments' | 'food' | 'shop' | 'customers' | 'stock' | 'rentals' | 'events' | 'team' | 'money';
/** The sections, in the one order they always come in, and the pages each holds (by page). Curbside goes with food and
 *  drink at a business that serves it, and with the shop otherwise; the front desk with appointments, or with the shop
 *  at one that doesn't take bookings. */
export const NAV_SECTIONS: { id: NavSectionId; label: string; pages: string[] }[] = [
  { id: 'today', label: 'Today', pages: ['/dashboard', '/inbox', '/messages', '/my-schedule', '/voice', '/message-log'] },
  { id: 'appointments', label: 'Appointments', pages: ['/planner', '/pos', '/before-the-visit', '/waitlist', '/appointments/requests', '/tidy'] },
  { id: 'food', label: 'Food and drink', pages: ['/counter', '/drive-live', '/curbside', '/host', '/tables', '/clear', '/bar-tabs', '/prep', '/close'] },
  { id: 'shop', label: 'Shop', pages: ['/retail-orders', '/retail-orders/pickups', '/curbside', '/pos', '/retail-orders/problems', '/retail-orders/customers', '/retail-orders/setup', '/window', '/popup'] },
  { id: 'customers', label: 'Customers', pages: ['/clients', '/opportunities', '/cases', '/refunds', '/gift-cards', '/loyalty', '/campaigns', '/reviews', '/referrals'] },
  { id: 'stock', label: 'Stock', pages: ['/services', '/menu', '/inventory', '/inventory/ordering', '/food-cost', '/inventory/codes', '/inventory/distribution', '/inventory/formulas', '/memberships', '/discounts', '/binder', '/briefing', '/resources', '/maintenance'] },
  { id: 'rentals', label: 'Rentals', pages: ['/rentals', '/booths', '/pipeline', '/renters', '/rent', '/rental-policies'] },
  { id: 'events', label: 'Events and classes', pages: ['/events', '/classes', '/quotes', '/academy'] },
  { id: 'team', label: 'Team', pages: ['/team', '/practice', '/pay-calculator'] },
  { id: 'money', label: 'Money', pages: ['/money', '/mileage', '/financials', '/activity', '/records', '/disputes', '/reports'] },
];

/** A section's pages at this business, in order (none: the section isn't shown). */
export function sectionPages(t: any, id: NavSectionId): string[] {
  const sec = NAV_SECTIONS.find((s) => s.id === id); if (!sec) return [];
  const food = servesFood(t), books = takesBookings(t);
  return sec.pages.filter((h) => {
    if (h === '/curbside' && (id === 'food') !== food) return false;
    if (h === '/pos' && (id === 'appointments') !== books) return false;
    return navShown(t, h);
  });
}

/** What the section of the business's own things is called: its services, its menu, or its products, and the stock
 *  behind them. */
export const stockLabel = (t: any): string => (takesBookings(t) ? 'Services and stock' : servesFood(t) ? 'Menu and stock' : 'Products and stock');

/** The name of the section a page sits in at this business, as its menu says it (the search shows it beside the page);
 *  null when the menu leaves it out. */
export function sectionLabelOf(t: any, href: string): string | null {
  const sec = NAV_SECTIONS.find((s) => sectionPages(t, s.id).includes(href)); if (!sec) return null;
  return sec.id === 'stock' ? stockLabel(t) : sec.id === 'customers' ? (takesBookings(t) ? 'Clients' : 'Customers') : sec.label;
}

/** Where "Add a tool" goes: Your ClarityFlow, with each tool the business doesn't have yet, what it does and its price. */
export const ADD_TOOL_HREF = '/subscriptions';
