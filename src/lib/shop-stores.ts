// src/lib/shop-stores.ts — THE ONLINE SHOP AT MORE THAN ONE STORE (pure; design board "The online shop at more than one
// store"). With two or more locations, each one that's on the shop (Shop settings, Your stores) is a store customers can
// find, pick up from and have deliveries come from. One location: none of this, and the shop works as before.
import { windowOn } from '@/lib/ahead-hours';
import { addDays, todayIn } from '@/lib/tenant-time';

/** Whether a pickup time (start to end) is inside a store's opening hours (no week: always). */
export function insideWeek(week: Record<string, any> | null, tz: string, start: number, end: number): boolean {
  if (!week) return true;
  const day = todayIn(tz, new Date(start));
  for (const d of [addDays(day, -1), day]) { const w = windowOn(week, d, tz); if (w && start >= w.open && end <= w.close) return true; }
  return false;
}

/** Directions to a store, in the phone's own maps. */
export const directionsTo = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

/** The store a customer picked, kept on their device for next time. */
export const storeKey = (tenantId: string) => `cf.shop.store.${tenantId}`;
export function savedStore(tenantId: string): string {
  try { return localStorage.getItem(storeKey(tenantId)) || ''; } catch { return ''; }
}
export function saveStore(tenantId: string, id: string) {
  try { if (id) localStorage.setItem(storeKey(tenantId), id); else localStorage.removeItem(storeKey(tenantId)); } catch { /* private mode: picked again next time */ }
}

/** A store as the customer's pages show it (api/retail/stores). */
export type StoreRow = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; delivers: boolean; directions: string | null; open: boolean; until: string | null; opens: string | null };

/** "Open until 9 PM", "Opens 10 AM tomorrow", "Closed": what the store's hours say right now. */
export function storeOpenLine(s: Pick<StoreRow, 'open' | 'until' | 'opens'>, tz: string, now = Date.now()): string {
  const clock = (iso: string) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(':00', ''); } catch { return ''; } };
  if (s.open) return s.until ? `Open until ${clock(s.until)}` : 'Open';
  if (!s.opens) return 'Closed';
  const today = todayIn(tz, new Date(now)); const day = todayIn(tz, new Date(s.opens));
  if (day === today) return `Closed, opens ${clock(s.opens)}`;
  if (day === addDays(today, 1)) return `Closed, opens ${clock(s.opens)} tomorrow`;
  let weekday = ''; try { weekday = new Date(s.opens).toLocaleDateString('en-US', { weekday: 'long', timeZone: tz }); } catch { /* the time alone */ }
  return `Closed, opens ${weekday ? `${weekday} ` : ''}${clock(s.opens)}`;
}
