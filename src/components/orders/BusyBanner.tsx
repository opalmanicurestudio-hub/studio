'use client';
// src/components/orders/BusyBanner.tsx — WHILE A BUSY PERIOD IS ON, EVERYONE CAN SEE IT (lib/ship-promise busy periods):
// its name and last day, what new orders get, and where customers read about it, with Change (the period under
// Shipping schedule) and End it now (a manager; dates already promised stay as they are).
import * as React from 'react';
import Link from 'next/link';
import { busyDays, clockLabel, dayLabel, type BusyPeriod, type ShipSchedule } from '@/lib/ship-promise';
import { Btn, C, Sheet, feel, muted } from './ui';
import { saveBusy } from './schedule-save';

/** 'on your shop, on product pages, at checkout and in their email', from the lines that are on (the product and email
 *  lines go with the ship-by dates, so only while customers are shown dates). */
function where(p: BusyPeriod, dates: boolean): string {
  const parts = [...(p.banner?.on ? ['on your shop'] : []), ...(dates && p.product?.on ? ['on product pages', 'at checkout'] : []), ...(dates && p.email?.on ? ['in their email'] : [])];
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function BusyBanner({ period, schedule, today, tz, tenantId, canEnd, onToast }: {
  period: BusyPeriod; schedule: ShipSchedule; today: string; tz: string; tenantId: string; canEnd: boolean; onToast: (m: string) => void;
}) {
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const name = period.name || 'A busy period';
  const days = busyDays(today, schedule);
  const told = where(period, schedule.showDates);
  const end = async () => {
    setBusy(true);
    // Started before today, it ends yesterday; started today, it comes off. Dates already promised stay.
    const r = period.id ? await saveBusy(tenantId, { op: 'end', id: period.id }) : { ok: false, error: 'Open it under Shipping schedule to end it.' };
    setBusy(false); feel(r.ok);
    if (r.ok) { setAsking(false); onToast(`${name} has ended. Dates already promised stay as they are.`); } else onToast(r.error || 'That didn’t save. Try again.');
  };
  return (
    <div className="mt-3 flex flex-col gap-1 rounded-[18px] px-4 py-3.5 lg:max-w-2xl" style={{ background: C.ink, color: C.paper }}>
      <span className="text-[15px] font-semibold">{name} is on until {dayLabel(period.to, tz)}</span>
      <span className="text-[13.5px] leading-snug" style={{ opacity: 0.8 }}>
        New orders ship within {days} business day{days === 1 ? '' : 's'}{period.cutoff ? `, cutoff ${clockLabel(period.cutoff)}` : ''}{period.capacity ? `, about ${period.capacity} a day` : ''}. {told ? `Customers see it ${told}.` : 'Customers aren’t shown a message for it.'}
      </span>
      <span className="mt-1.5 flex gap-2">
        <Link href="/retail-orders/policies/shipping" className="cf-press inline-flex h-9 items-center rounded-full px-3.5 text-[13.5px] font-semibold" style={{ background: C.paper, color: C.ink }}>Change</Link>
        {canEnd && <button type="button" onClick={() => setAsking(true)} className="cf-press inline-flex h-9 items-center rounded-full px-3.5 text-[13.5px] font-semibold" style={{ border: '1px solid rgba(255,255,255,.4)', color: C.paper }}>End it now</button>}
      </span>
      {asking && (
        <Sheet title={`End ${name} now?`} sub="New orders go back to your usual time from now. Dates already promised stay as they are; only new orders get the faster time." onClose={() => setAsking(false)}>
          <div className="mt-3 flex flex-col gap-2">
            <Btn kind="primary" className="h-12 w-full" disabled={busy} onClick={() => void end()}>{busy ? 'One moment…' : 'End it now'}</Btn>
            <Btn kind="soft" className="h-12 w-full" disabled={busy} onClick={() => setAsking(false)}>Keep it on</Btn>
            <p className="m-0 text-center text-[12.5px]" style={muted}>Its customer messages stop showing when it ends.</p>
          </div>
        </Sheet>)}
    </div>);
}

/** While new orders get an extra day from a capacity suggestion or by themselves (lib/capacity): what that means, and
 *  Stop it (a manager; none is added again today). */
export function CatchUpNote({ period, today, tz, tenantId, canEnd, onToast }: { period: BusyPeriod; today: string; tz: string; tenantId: string; canEnd: boolean; onToast: (m: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const stop = async () => {
    if (!period.id) return;
    setBusy(true);
    const r = await saveBusy(tenantId, { op: 'end', id: period.id });
    setBusy(false); feel(r.ok);
    onToast(r.ok ? 'New orders are back to your usual time. Dates already promised stay as they are.' : r.error || 'That didn’t save. Try again.');
  };
  return (
    <div className="mt-3 flex items-center gap-3 rounded-[18px] px-4 py-3 lg:max-w-2xl" style={{ background: C.soft }}>
      <span className="min-w-0 flex-1 text-[14px] leading-snug">{period.auto === 'early_cutoff' ? `Today’s cutoff is ${clockLabel(period.cutoff || '')} while the team catches up.` : `New orders get one more day while the team catches up${period.to > today ? `, until ${dayLabel(period.to, tz)}` : ', today'}.`}</span>
      {canEnd && <Btn kind="soft" className="h-9 shrink-0 px-3.5 text-[13.5px]" style={{ background: C.paper }} disabled={busy} onClick={() => void stop()}>{busy ? 'One moment…' : 'Stop it'}</Btn>}
    </div>);
}
