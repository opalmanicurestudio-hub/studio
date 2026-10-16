// src/lib/week-numbers.ts — "THIS WEEK" on the planner, honestly. What's been taken so far, what's still booked (each
// visit at its own price), the goal if one is set, the same point last week, and what it costs to open for a week, from
// the business's real bills turned into a weekly figure. No guessed overheads: with no bills entered, it says so.
import { monthlyEquivalent } from '@/lib/bills-recurrence';

const ms = (v: any): number => { if (!v) return 0; if (v instanceof Date) return v.getTime(); if (typeof v === 'string') return Date.parse(v) || 0; if (v?.toDate) return v.toDate().getTime(); if (v?.seconds) return v.seconds * 1000; return Number(v) || 0; };
const isTaken = (t: any) => t?.type === 'income' && t?.context !== 'Personal' && /service|retail|product/i.test(String(t?.category || ''));
const LIVE = ['confirmed', 'booked', 'scheduled', 'pending', 'deposit_pending', 'pending_payment', 'checked_in', 'waiting', 'servicing', 'ready_for_checkout'];

export function weekNumbers(o: { weekStart: Date; now?: number; transactions: any[]; appointments: any[]; services: any[]; billDefinitions: any[]; tenant: any; openDays: number }) {
  const now = o.now ?? Date.now(); const s = o.weekStart.getTime(); const e = s + 7 * 864e5;
  const sum = (from: number, to: number) => (o.transactions || []).filter((t) => { const d = ms(t.date); return isTaken(t) && d >= from && d < to; }).reduce((n, t) => n + (Number(t.amount) || 0), 0);
  const upTo = Math.min(now, e);
  const taken = sum(s, upTo);
  const lastWeekSamePoint = sum(s - 7 * 864e5, upTo - 7 * 864e5);
  const price = (a: any) => { const p = Number(a.price ?? a.totalPrice ?? a.checkoutState?.total); if (Number.isFinite(p) && p > 0) return p; return Number((o.services || []).find((x) => x.id === a.serviceId)?.price) || 0; };
  const ahead = (o.appointments || []).filter((a) => { const d = ms(a.startTime); return d >= Math.max(s, now - 3 * 3600000) && d < e && LIVE.includes(String(a.status || '')) && !a.paidAt && !a.checkoutSessionId; });
  const stillBooked = ahead.reduce((n, a) => n + price(a), 0);
  const weeklyGoal = Number(o.tenant?.weeklyGoal) > 0 ? Number(o.tenant.weeklyGoal) : Number(o.tenant?.dailyGoal) > 0 ? Number(o.tenant.dailyGoal) * Math.max(1, o.openDays) : null;
  const bills = (o.billDefinitions || []).filter((b) => b && b.context !== 'Personal' && b.active !== false && b.archived !== true);
  const weeklyCost = bills.length ? bills.reduce((n, b) => n + monthlyEquivalent({ amount: Number(b.amount) || 0, cadence: b.cadence || (b.billingCycle === 'annually' ? 'annual' : b.billingCycle) }) * 12 / 52, 0) : null;
  const projected = taken + stillBooked;
  return {
    taken, lastWeekSamePoint, stillBooked, stillBookedCount: ahead.length, projected, weeklyGoal, weeklyCost, billCount: bills.length,
    /** Projected less the week's share of the bills (before pay and products). null without bills. */
    overCost: weeklyCost == null ? null : projected - weeklyCost,
    vsLastWeek: lastWeekSamePoint > 0 ? Math.round(((taken - lastWeekSamePoint) / lastWeekSamePoint) * 100) : null,
  };
}

/** The "needs you" line for bills: how many, how much, and the soonest. */
export function billsLine(due: any[], now = Date.now()): string | null {
  if (!due?.length) return null;
  const total = due.reduce((n, i) => n + Math.max(0, (Number(i.amountDue ?? i.definition?.amount) || 0) - (Number(i.amountPaid) || 0)), 0);
  const first = [...due].sort((a, b) => ms(a.dueDate) - ms(b.dueDate))[0]; const d = ms(first.dueDate); const days = Math.floor((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
  const when = days < 0 ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  const name = String(first.definition?.name || 'a bill');
  return `${due.length} bill${due.length === 1 ? '' : 's'} due · $${Math.round(total).toLocaleString('en-US')} · ${name} ${when}`;
}
