// src/lib/curbside.ts — THE CURBSIDE SCREEN's lists (design canvas: Curbside; components/orders/CurbsideScreen). One
// list for whoever runs orders out to cars: the shop's curbside orders (lib/pickups-view) and café orders placed ahead
// for curbside (lib/curbside-server), side by side. Outside now, longest wait first; then who's on the way; then how
// many more are coming later today. Pure.
import { isHere, onTheWay } from '@/lib/pickups-view';
import type { CafeCurb } from '@/lib/curbside-server';

export type CurbRow = { kind: 'shop'; key: string; o: any; since: number } | { kind: 'cafe'; key: string; c: CafeCurb; since: number };
export const WAIT_WARN_MIN = 5;
const ms = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
/** A shop order collected at the curb (not at the counter, inside, shipped or delivered). */
export const isShopCurb = (o: any) => String(o?.method || '') === 'curbside';

export function curbsideBoard(shopActive: any[], cafe: CafeCurb[], now: number): { outside: CurbRow[]; coming: CurbRow[]; later: { count: number; next: string | null } } {
  const shop = (shopActive || []).filter(isShopCurb);
  const outside: CurbRow[] = [
    ...shop.filter(isHere).map((o) => ({ kind: 'shop' as const, key: `s:${o.id}`, o, since: ms(o.curbside?.arrivedAt) || now })),
    ...(cafe || []).filter((c) => !!c.hereAt).map((c) => ({ kind: 'cafe' as const, key: `c:${c.id}`, c, since: ms(c.hereAt) || now })),
  ].sort((a, b) => a.since - b.since);
  const coming: CurbRow[] = shop.filter(onTheWay).map((o) => ({ kind: 'shop' as const, key: `s:${o.id}`, o, since: ms(o.curbside?.onWayAt) || now }));
  const waiting = [...shop.filter((o) => !isHere(o) && !onTheWay(o)).map((o) => o.pickupAt || o.readyBy || null), ...(cafe || []).filter((c) => !c.hereAt).map((c) => c.at)];
  const times = waiting.filter(Boolean).map(String).filter((t) => ms(t) > now - 3600000).sort((a, b) => ms(a) - ms(b));
  return { outside, coming, later: { count: waiting.length, next: times[0] || null } };
}

/** Minutes someone has been outside. */
export const waitedMin = (since: number, now: number) => Math.max(0, Math.floor((now - since) / 60000));
