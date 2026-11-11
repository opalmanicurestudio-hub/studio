// src/lib/holding.ts — HOLDING TIMERS (pure; the same on the server and every screen). Some things are cooked ahead in
// a batch and kept warm for a set time (fries, nuggets, a pot of coffee): the menu says how long an item may be held
// (holdMinutes, lib/counter-orders) and how many a batch usually is. The kitchen screen starts a batch with one tap,
// takes from it as tickets come in, and is told plainly when it has to be thrown out. Nothing past its time is ever
// handed to a guest: the server refuses to take from a batch that's run out of time.

export type HoldBin = { id: string; itemId: string; name: string; quantity: number; startedAt: string; expiresAt: string; startedBy: string | null; status: 'held' | 'used' | 'tossed' };

/** How a batch stands: fresh, near its time (the last quarter, or the last two minutes), or past it. */
export function binState(bin: Pick<HoldBin, 'startedAt' | 'expiresAt'>, nowMs: number): { left: number; share: number; state: 'fresh' | 'soon' | 'expired'; text: string } {
  const start = Date.parse(bin.startedAt), end = Date.parse(bin.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { left: 0, share: 0, state: 'expired', text: 'Throw out' };
  const left = Math.round((end - nowMs) / 1000);
  const share = Math.max(0, Math.min(1, (end - nowMs) / (end - start)));
  if (left <= 0) return { left, share: 0, state: 'expired', text: 'Throw out' };
  const t = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return { left, share, state: share <= 0.25 || left <= 120 ? 'soon' : 'fresh', text: `${t} left` };
}

/** How many a batch usually is (the menu's own, or 6). */
export const batchSizeOf = (item: any) => { const n = Math.floor(Number(item?.batchSize)); return Number.isFinite(n) && n >= 1 && n <= 200 ? n : 6; };

/** The batch to take from for this many: the oldest one still in time that has enough (first in, first out). */
export function binFor<T extends Pick<HoldBin, 'itemId' | 'quantity' | 'startedAt' | 'expiresAt' | 'status'>>(bins: T[], itemId: string | null | undefined, quantity: number, nowMs: number): T | null {
  if (!itemId) return null;
  return bins.filter((b) => b.status === 'held' && b.itemId === itemId && b.quantity >= quantity && binState(b, nowMs).state !== 'expired')
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))[0] || null;
}
