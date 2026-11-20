// src/lib/screens.ts — EVERY SCREEN, BY WHERE IT GOES (design board "Screens in the menu"). The tablets and TVs a business
// sets up once, for the menu's Screens group (components/shared/AppSidebar), the search at the top (NAV_AREAS) and the
// Screens page (app/(app)/screens). Each opens at its own address with the business's id in it (the client screen pairs
// with a code instead, so it has none). Only the tools that are on show (lib/modules pageVisible), and a pickup-only
// drive-thru (lib/counter-orders pickupOnlyOf) has nobody ordering at the speaker, so no speaker and no order board.
import { pageVisible } from '@/lib/modules';
import { pickupOnlyOf } from '@/lib/counter-orders';

export type ScreenId = 'lane' | 'menu-board' | 'speaker' | 'order-board' | 'window' | 'kiosk' | 'ready'
  | 'kds' | 'dish' | 'barback' | 'host-stand' | 'floor'
  | 'walk-in' | 'check-in' | 'lobby' | 'client-screen' | 'concierge'
  | 'timeclock' | 'staff-portal';

/** `page`: the page it is (what the tool gate goes by); `sub`: the screen under it; `noTenant`: opened without the business's
 *  id (paired with a code); `line`: what it is and where it goes, for the Screens page. */
export type ScreenDef = { id: ScreenId; page: string; sub?: string; noTenant?: boolean; label: string; line: string; when?: (t: any) => boolean };
export type ScreenArea = { id: 'drive' | 'kitchen' | 'front' | 'team'; label: string; screens: ScreenDef[] };

const ordersAtSpeaker = (t: any) => !pickupOnlyOf(t);

export const SCREEN_AREAS: ScreenArea[] = [
  { id: 'drive', label: 'Drive-thru and counter', screens: [
    { id: 'lane', page: '/drive-thru', label: 'Drive-thru lane', line: 'The team’s tablet: take each car’s order, send it to the kitchen, take payment and hand it over.' },
    { id: 'menu-board', page: '/drive-thru', sub: 'menu', label: 'Menu board', line: 'The menu guests read before they order, at the drive-thru or by the counter, with a photo for every item.' },
    { id: 'speaker', page: '/drive-thru', sub: 'speaker', label: 'Speaker', line: 'The tablet wired to the speaker, where the voice assistant takes each car’s order.', when: ordersAtSpeaker },
    { id: 'order-board', page: '/drive-thru', sub: 'board', label: 'Order board', line: 'By the speaker: the guest sees their order as it’s taken, and the total, so a mistake is caught early.', when: ordersAtSpeaker },
    { id: 'window', page: '/drive-thru', sub: 'window', label: 'Window screen', line: 'Faces the guest at the window: their order, the total and how paying is going.' },
    { id: 'kiosk', page: '/drive-thru', sub: 'kiosk', label: 'Kiosk', line: 'A tablet by the door with its own card reader: guests order and pay on their own.' },
    { id: 'ready', page: '/drive-thru', sub: 'ready', label: 'Ready board', line: 'A TV by the counter: which orders are being made and which are ready, by number.' },
  ] },
  { id: 'kitchen', label: 'Kitchen and floor', screens: [
    { id: 'kds', page: '/kds', label: 'Kitchen screen', line: 'Every ticket for the kitchen, or for one station, in the order it’s due.' },
    { id: 'dish', page: '/dish', label: 'Dish', line: 'A tablet by the dish machine, or the phone of whoever’s on dish: what the line and the floor called for.' },
    { id: 'barback', page: '/barback', label: 'Barback', line: 'The barback’s phone, or a tablet behind the bar: what the bartenders called for.' },
    { id: 'host-stand', page: '/host-stand', label: 'Host stand tablet', line: 'The host stand’s own tablet: who’s waiting, who’s booked and which tables are free.' },
    { id: 'floor', page: '/floor', label: 'Floor staff', line: 'A board for an event night: what the seats asked for, food ready for the room, every table at a glance.' },
  ] },
  { id: 'front', label: 'Front desk and waiting', screens: [
    { id: 'walk-in', page: '/walk-in', label: 'Walk-in kiosk', line: 'A tablet by the door where walk-in guests add themselves to the line.' },
    { id: 'check-in', page: '/kiosk', label: 'Check-in kiosk', line: 'Where renters check in when they arrive.' },
    { id: 'lobby', page: '/lobby', label: 'Lobby board', line: 'A TV where waiting guests see who’s next and roughly how long.' },
    { id: 'client-screen', page: '/screen', noTenant: true, label: 'Client screen', line: 'An iPad at the front desk facing the guest: their ticket, a tip and paying. Pair it from the front desk.' },
    { id: 'concierge', page: '/concierge', label: 'Lounge concierge', line: 'A tablet in the lounge where guests order drinks and snacks from their seat.' },
  ] },
  { id: 'team', label: 'Team', screens: [
    { id: 'timeclock', page: '/timeclock', label: 'Time clock', line: 'A shared tablet where the team clocks in and out.' },
    { id: 'staff-portal', page: '/staff-portal', label: 'Staff portal', line: 'The team’s own app on their phone: their day, their time and their messages.' },
  ] },
];

/** How a screen gets going on its tablet the first time: a manager signs in on it and sets it up (it then keeps its own
 *  key: lib/screen-keys), it's paired with a code from the front desk, or it just opens. */
const MANAGER_SETS_UP = ['/drive-thru', '/kds', '/dish', '/barback', '/host-stand', '/floor'];
export function setUpBy(s: ScreenDef): 'manager' | 'code' | null {
  return s.noTenant ? 'code' : MANAGER_SETS_UP.includes(s.page) ? 'manager' : null;
}

/** Where a screen opens for this business. */
export function screenPath(s: ScreenDef, tenantId: string): string {
  if (s.noTenant) return s.page;
  return `${s.page}/${encodeURIComponent(tenantId)}${s.sub ? `/${s.sub}` : ''}`;
}

/** Shown for this business: its tool is on, and it fits how the business runs. */
export function screenShown(tenant: any, s: ScreenDef): boolean {
  return pageVisible(tenant, s.page) && (!s.when || s.when(tenant));
}

/** The areas with what's shown in each (an area with nothing shown is left out). `only`: just these pages (a manager's
 *  station screens). */
export function shownAreas(tenant: any, o: { only?: string[] } = {}): ScreenArea[] {
  return SCREEN_AREAS.map((a) => ({ ...a, screens: a.screens.filter((s) => screenShown(tenant, s) && (!o.only || o.only.includes(s.page))) }))
    .filter((a) => a.screens.length > 0);
}

/** A screen by its id (the Screens page opens on one from the search: /screens?show=kiosk). */
export function screenById(id: unknown): ScreenDef | null {
  for (const a of SCREEN_AREAS) for (const s of a.screens) if (s.id === id) return s;
  return null;
}
