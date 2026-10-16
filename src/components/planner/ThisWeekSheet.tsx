'use client';
// src/components/planner/ThisWeekSheet.tsx — "THIS WEEK" from the planner (people who can see money only). The numbers
// come from lib/week-numbers: taken, still booked, the goal, last week at the same point, and the week's share of the
// real bills. The full picture is one tap away in Money and Reports.
import * as React from 'react';
import Link from 'next/link';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const muted = { color: 'var(--muted, #6d7075)' } as React.CSSProperties;

export function ThisWeekSheet({ n, label, onClose }: { n: ReturnType<typeof import('@/lib/week-numbers').weekNumbers>; label: string; onClose: () => void }) {
  const goalPct = n.weeklyGoal ? Math.min(100, Math.round((n.projected / n.weeklyGoal) * 100)) : null;
  const takenPct = n.weeklyGoal ? Math.min(100, Math.round((n.taken / n.weeklyGoal) * 100)) : null;
  const row = (l: string, v: string, sub?: string, tone?: string) => (
    <div className="flex items-baseline justify-between gap-3 border-t py-3" style={{ borderColor: 'var(--line, #ececee)' }}>
      <span className="text-[15px]">{l}{sub && <span className="block text-[12px]" style={muted}>{sub}</span>}</span>
      <span className="text-[17px] tabular-nums" style={tone ? { color: tone } : undefined}>{v}</span>
    </div>);
  return (
    <div role="dialog" aria-modal="true" aria-label="This week" className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(22,23,26,.38)' }} onClick={onClose}>
      <div className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] p-5 sm:rounded-[28px]" style={{ background: 'var(--card, #fff)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[13px]" style={muted}>{label}</p><p className="text-[24px] font-light">This week</p></div>
          <button type="button" onClick={onClose} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: 'var(--soft, #f5f5f7)' }}>Close</button>
        </div>
        <div className="mt-3">
          <p className="text-[13px]" style={muted}>Taken so far</p>
          <p className="text-[40px] font-light leading-tight tabular-nums">{money(n.taken)}</p>
          {n.vsLastWeek != null && <p className="text-[13px]" style={{ color: n.vsLastWeek >= 0 ? 'var(--ok, #1f7a4d)' : 'var(--warn, #b45309)' }}>{n.vsLastWeek >= 0 ? `${n.vsLastWeek}% ahead of` : `${-n.vsLastWeek}% behind`} last week at this point ({money(n.lastWeekSamePoint)})</p>}
        </div>
        {n.weeklyGoal != null && <div className="mt-4">
          <div className="relative h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--soft, #f5f5f7)' }}>
            <i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${goalPct}%`, background: 'color-mix(in srgb, var(--ok, #1f7a4d) 35%, transparent)' }} />
            <i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${takenPct}%`, background: 'var(--ok, #1f7a4d)' }} />
          </div>
          <p className="mt-1.5 text-[12px]" style={muted}>Goal {money(n.weeklyGoal)} · taken (solid) and booked (light)</p>
        </div>}
        <div className="mt-4">
          {row('Still booked', money(n.stillBooked), `${n.stillBookedCount} visit${n.stillBookedCount === 1 ? '' : 's'} left this week, at their own prices`)}
          {row('If they all come', money(n.projected))}
          {n.weeklyCost != null
            ? <>{row('What it costs to open this week', money(n.weeklyCost), `Your ${n.billCount} business bill${n.billCount === 1 ? '' : 's'}, as a weekly share`)}
                {row(n.overCost! >= 0 ? 'Over your bills' : 'Short of your bills', money(Math.abs(n.overCost!)), 'Before pay and products', n.overCost! >= 0 ? 'var(--ok, #1f7a4d)' : 'var(--warn, #b45309)')}</>
            : <div className="border-t py-3 text-[13px]" style={{ borderColor: 'var(--line, #ececee)', ...muted }}>Add your business bills (rent, utilities, software) to see what each week costs to open. <Link href="/bills" className="font-semibold underline underline-offset-2" style={{ color: 'var(--ink, #16171a)' }}>Add bills</Link></div>}
        </div>
        <div className="mt-4 flex gap-2">
          <Link href="/money" className="flex h-11 flex-1 items-center justify-center rounded-full text-[14px] font-semibold" style={{ background: 'var(--ink, #16171a)', color: 'var(--paper, #fff)' }}>Money</Link>
          <Link href="/reports" className="flex h-11 flex-1 items-center justify-center rounded-full text-[14px] font-semibold" style={{ background: 'var(--soft, #f5f5f7)' }}>Reports</Link>
        </div>
      </div>
    </div>);
}
