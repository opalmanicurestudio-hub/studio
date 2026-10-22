'use client';
// src/components/orders/Today.tsx — TODAY, AT A GLANCE (lib/ship-day): the cutoff and how long is left, the next carrier
// pickup, what has to ship today and how much of it is packed, and four counts that open what needs someone: Late, At
// risk, Labels, Carrier.
import * as React from 'react';
import Link from 'next/link';
import type { DayPicture } from '@/lib/ship-day';
import { minutesLabel } from '@/lib/ship-promise';
import { Btn, C, muted } from './ui';

export type DayList = 'late' | 'risk' | 'labels' | 'carrier';

function Count({ n, label, warn, onClick }: { n: number; label: string; warn?: boolean; onClick: () => void }) {
  const hot = warn && n > 0;
  return (
    <button type="button" onClick={onClick} aria-label={`${label}: ${n}`} className="cf-press flex min-w-0 flex-1 flex-col rounded-2xl px-3 py-2.5 text-left"
      style={{ border: hot ? `2px solid ${C.warn}` : `1px solid ${C.line}`, background: C.paper }}>
      <span className="text-[24px] font-light leading-tight tracking-[-0.02em]" style={{ color: hot ? C.warn : n ? C.ink : C.muted }}>{n}</span>
      <span className="truncate text-[12.5px] font-semibold" style={muted}>{label}</span>
    </button>);
}

export function TodayCard({ day, labels, onOpen, onPackNext, canPack, nextShipWord }: {
  day: DayPicture; labels: number; onOpen: (k: DayList) => void; onPackNext?: () => void; canPack: boolean; nextShipWord: string;
}) {
  const { cutoff, pickup, ship } = day;
  const done = ship.packed + ship.sent;
  const pct = ship.total ? Math.round((done / ship.total) * 100) : 0;
  const left = cutoff.minutesLeft;
  return (
    <div className="mt-3 lg:max-w-2xl">
      <div className="flex flex-col gap-2 rounded-[20px] px-4 py-3.5" style={{ border: `2px solid ${C.ink}` }}>
        {!day.scheduled ? (
          <Link href="/retail-orders/policies/shipping" className="cf-press flex justify-between gap-2.5 text-[15px] leading-snug">
            <span className="font-semibold">Set your cutoff and pickups</span><span className="shrink-0 text-right" style={muted}>Shipping schedule</span>
          </Link>
        ) : day.shipsToday ? (<>
          <span className="flex justify-between gap-2.5 text-[16px] font-semibold leading-snug">
            <span>Cutoff {cutoff.label}</span>
            <span className="shrink-0 text-right" style={left === null ? muted : left <= 60 ? { color: C.warn } : undefined}>{left === null ? 'Passed' : `${minutesLabel(left)} left`}</span>
          </span>
          {(pickup || day.pickupsDone) && (
            <span className="flex justify-between gap-2.5 text-[14px] leading-snug" style={muted}>
              <span>{pickup ? `${pickup.carrier} ${pickup.kind === 'dropoff' ? 'drop-off' : 'pickup'}` : 'Today’s pickups'}</span>
              <span className="shrink-0 text-right">{pickup ? pickup.label : 'Gone'}</span>
            </span>)}
        </>) : (
          <span className="flex justify-between gap-2.5 text-[16px] font-semibold leading-snug"><span>Not a ship day</span><span className="shrink-0 text-right font-normal" style={muted}>Orders go out {nextShipWord}</span></span>
        )}
        {ship.total > 0 && (<>
          <span className="block h-2 overflow-hidden rounded-full" style={{ background: C.soft }} role="progressbar" aria-valuemin={0} aria-valuemax={ship.total} aria-valuenow={done} aria-label="Packed for today">
            <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: C.mint, transition: 'width .4s ease' }} />
          </span>
          <span className="flex justify-between gap-2.5 text-[14px] leading-snug">
            <span>Ship {day.shipsToday ? 'today' : nextShipWord}: {ship.total}</span>
            <span className="shrink-0 text-right">{[ship.sent ? `${ship.sent} sent` : '', `${ship.packed} packed`, `${ship.toGo} to go`].filter(Boolean).join(' · ')}</span>
          </span>
        </>)}
        {ship.total === 0 && day.shipsToday && <span className="text-[14px]" style={muted}>Nothing has to ship today.</span>}
        {canPack && onPackNext && ship.toGo > 0 && <Btn kind="primary" className="mt-1 h-11 w-full" onClick={onPackNext}>Pack the next one</Btn>}
      </div>
      <div className="mt-2 flex gap-2">
        <Count n={day.late.length} label="Late" warn onClick={() => onOpen('late')} />
        <Count n={day.atRisk.length} label="At risk" onClick={() => onOpen('risk')} />
        <Count n={labels} label="Labels" onClick={() => onOpen('labels')} />
        <Count n={day.carrier.length} label="Carrier" onClick={() => onOpen('carrier')} />
      </div>
    </div>);
}
