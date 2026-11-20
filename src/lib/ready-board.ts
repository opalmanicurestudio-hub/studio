// src/lib/ready-board.ts — THE READY BOARD (pure; design canvas "The ready board"): a TV by the counter that says which
// orders are being made and which are ready to collect, by number and first name, from the kitchen screen itself.
// Counter and kiosk orders, and orders placed ahead to pick up inside (one for later shows only once the kitchen starts
// it). The drive-thru's cars have their own window screens, and curbside orders are taken out to the car, so neither is on
// it. Ready means every part of it is (each station's tickets, lib/two-stations), until it's handed over: at the counter
// (the order done) or marked picked up on the kitchen screen (every ticket delivered). Never items or prices.
import { cleanName } from '@/lib/counter-server';

export type BoardOrder = { number: string; name: string | null };
export type ReadyBoard = { making: (BoardOrder & { since: string })[]; ready: (BoardOrder & { at: string })[] };
export const MAX_MAKING = 24, MAX_READY = 12;
/** The kitchen tickets that can put an order on the board (the board starts from these, never a whole day's orders). */
export const LIVE_TICKETS = ['pending', 'in_progress', 'unfired', 'ready'];
/** The order channels on the board (each kitchen ticket says which it came from). */
export const BOARD_CHANNELS = ['counter', 'kiosk', 'ahead'];
/** A ready order no one marked collected leaves the board after this long; one being made, after this long (something's
 *  off: the kitchen screen shows it). */
export const READY_MIN = 45, MAKING_HOURS = 3;

/** Whether an order is for this board: the counter's, a kiosk's, or placed ahead to pick up inside. */
export function onReadyBoard(o: any): boolean {
  if (!o || o.status !== 'sent') return false;
  if (o.channel === 'counter' || o.channel === 'kiosk') return true;
  return o.channel === 'ahead' && !!o.paidAt && (o.ahead?.way === 'inside' || !o.ahead?.way);
}

const firstName = (v: unknown) => { const n = cleanName(v); return n ? n.split(' ')[0] : null; };

/** Where each order stands, from its kitchen tickets: being made (oldest first), or ready (newest first). An order whose
 *  tickets are all still held for later, or all handed over, isn't shown, nor one ready for over READY_MIN minutes or
 *  being made for over MAKING_HOURS hours. */
export function readyBoardOf(orders: { id: string; [k: string]: any }[], tickets: any[], now = Date.now()): ReadyBoard {
  const byOrder = new Map<string, any[]>();
  for (const t of tickets) { if (!t || t.status === 'cancelled') continue; const id = String(t.orderId || ''); if (!byOrder.has(id)) byOrder.set(id, []); byOrder.get(id)!.push(t); }
  const making: ReadyBoard['making'] = []; const ready: ReadyBoard['ready'] = [];
  for (const o of orders) {
    if (!onReadyBoard(o)) continue;
    const mine = byOrder.get(o.id) || [];
    if (!mine.length) continue;
    const held = (t: any) => t.status === 'unfired' || (t.status === 'pending' && t.holdUntil && Date.parse(String(t.holdUntil)) > now);
    if (mine.every(held)) continue;
    if (mine.every((t) => t.status === 'delivered')) continue;
    const row = { number: String(o.number || ''), name: firstName(o.guestName) };
    if (mine.some((t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'unfired')) {
      const since = String(o.sentAt || o.createdAt || '');
      if (now - (Date.parse(since) || now) <= MAKING_HOURS * 3600000) making.push({ ...row, since });
    } else {
      const at = mine.map((t) => String(t.readyAt || t.deliveredAt || '')).sort().pop() || String(o.sentAt || '');
      if (now - (Date.parse(at) || now) <= READY_MIN * 60000) ready.push({ ...row, at });
    }
  }
  making.sort((a, b) => a.since.localeCompare(b.since)); ready.sort((a, b) => b.at.localeCompare(a.at));
  return { making, ready };
}
