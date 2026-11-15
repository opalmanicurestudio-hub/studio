// src/lib/event-sheet.ts — THE EVENT SHEET (design canvas "Event sheet and final invoice"; lib/event-sheet-server,
// api/event-sheet, the page at /events/[eventId]/sheet). One page the team works the event from, made from the quote it
// came from and what the event has since: when and where, the client, the guests, what's included, the run of show, the
// menu from the guests' choices with the allergies, the team, the seating, the notes, and for managers the money.
// Pure.
import { shapeOf } from '@/lib/table-kinds';
import { chartTables } from '@/lib/event-guest-link';

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cents = (v: unknown) => Math.round(num(v) * 100);
const and = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "6:30 pm", "7 pm". */
export const clockWords = (hm: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(hm || ''); if (!m) return ''; const h = Number(m[1]) % 24; const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return Number(m[2]) ? `${h12}:${m[2]} ${ap}` : `${h12} ${ap}`; };
/** "Friday, November 20, 6:30 to 10 pm" (the end from its length; "6:30 pm" with no length; the day alone with no time). */
export function whenWords(ev: any): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ev?.date || ''));
  const day = d ? new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
  const t = /^(\d{1,2}):(\d{2})/.exec(String(ev?.time || ''));
  if (!t) return day;
  const start = Number(t[1]) * 60 + Number(t[2]);
  const len = num(ev?.durationMinutes) > 0 ? num(ev.durationMinutes) : num(ev?.durationHours) > 0 ? num(ev.durationHours) * 60 : 0;
  const hm = (m: number) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
  const from = clockWords(hm(start)); const to = len ? clockWords(hm(start + len)) : '';
  // "6:30 to 10 pm" when both ends share am or pm on the same day; "11 am to 2 pm" across noon; "10 pm to 1 am" past
  // midnight; a day or more, both in full with "the next day".
  const nextDay = start + len >= 1440;
  const days = Math.floor((start + len) / 1440);
  const range = !to ? from : days >= 2 ? `${from} to ${to}, ${days} days later` : len >= 720 && nextDay ? `${from} to ${to} the next day` : !nextDay && from.slice(-2) === to.slice(-2) ? `${from.slice(0, -3)} to ${to}` : `${from} to ${to}`;
  return [day, range].filter(Boolean).join(', ');
}

/** The seating in words: "5 long tables of 8 and 2 round tables of 6". */
export function seatingWords(ev: any): string {
  const raw = new Map<string, any>((Array.isArray(ev?.seatingTables) ? ev.seatingTables : []).map((t: any) => [String(t?.id), t]));
  const groups = new Map<string, number>();
  for (const t of chartTables(ev)) { if (!t.seats.length) continue; const shape = shapeOf(raw.get(t.id)); const k = `${shape}|${t.seats.length}`; groups.set(k, (groups.get(k) || 0) + 1); }
  const parts = Array.from(groups.entries()).sort((a, b) => b[1] - a[1]).map(([k, n]) => { const [shape, seats] = k.split('|');
    const thing = shape === 'counter' ? (n === 1 ? 'counter' : 'counters') : `${shape} ${n === 1 ? 'table' : 'tables'}`;
    return `${n === 1 ? 'a' : n} ${thing} of ${seats}`; });
  const text = and(parts); return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

export type SheetMoney = { quotedCents: number; depositCents: number; depositPaid: boolean; paidCents: number; balanceCents: number };
/** The money as quoted: the total, the deposit and whether it's paid, any payments since, and what's left before extras. */
export function sheetMoney(ev: any): SheetMoney {
  const quotedCents = Math.max(0, cents(ev?.quoteTotal));
  const dep = ev?.deposit || {}; const depositCents = Math.max(0, cents(dep.amount)); const depositPaid = dep.paid === true;
  const payments = Array.isArray(dep.payments) ? dep.payments.reduce((a: number, p: any) => a + Math.max(0, cents(p?.amount)), 0) : 0;
  const paidCents = Math.max(depositPaid ? depositCents : 0, payments);
  return { quotedCents, depositCents, depositPaid, paidCents, balanceCents: Math.max(0, quotedCents - paidCents) };
}

/** What's included, from the quote: names and how many, without prices (the team's copy). */
export const includedWords = (ev: any): string[] => (Array.isArray(ev?.quoteLines) ? ev.quoteLines : []).map((l: any) => `${String(l?.name || 'Item').slice(0, 80)}${num(l?.quantity) > 1 ? ` (${num(l.quantity)})` : ''}`).slice(0, 30);

export const money = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
