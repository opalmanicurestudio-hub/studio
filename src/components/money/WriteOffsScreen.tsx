'use client';
// src/components/money/WriteOffsScreen.tsx — WRITE-OFFS on the Money page (design board "Write-offs: found for you,
// finished by you"). Write-offs that are easy to miss, found from what ClarityFlow already holds and kept with their
// proof. Business miles first (api/mileage, lib/trip-log): the year so far at the IRS rate, drives the books point to,
// and the way into the log.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { milesText } from '@/lib/trip-log';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold ${RING}`;
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Miles = { year: number; summary: { trips: number; businessTenths: number; amountCents: number; rate: { label: string; year: number; stale: boolean } }; suggestions: unknown[]; drive: { ended: string | null } | null };

export function MilesWriteOff({ data, canLog, err }: { data: Miles | null; canLog: boolean; err?: string }) {
  if (!canLog) return (
    <section aria-label="Business miles" className="rounded-3xl bg-[#fff] p-5">
      <h2 className="text-[18px] font-bold">Business miles</h2>
      <p className="mt-1 text-[14px]" style={{ color: MUTED }}>The owner keeps the mileage log, and people whose role includes keeping the books can see it.</p>
    </section>);
  const s = data?.summary; const waiting = data?.suggestions?.length || 0;
  return (
    <section aria-label="Business miles" className="flex flex-col gap-3 rounded-3xl bg-[#fff] p-5" style={{ color: INK }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold">Business miles</h2>
          {!data ? <p className="mt-1 text-[14px]" style={{ color: err ? AMBER : MUTED }}>{err || 'Loading…'}</p>
            : s && s.trips > 0 ? <p className="mt-1 text-[15px]">{milesText(s.businessTenths)} miles in {s.trips} trip{s.trips === 1 ? '' : 's'} this year, at the IRS rate of {s.rate.label} a mile{s.rate.stale ? ` (${s.rate.year}’s, until ${data.year}’s is in)` : ''}.</p>
            : <p className="mt-1 max-w-[620px] text-[15px]" style={{ color: MUTED }}>Drives for supplies, the bank, classes, events and clients add up, and are often never claimed because they’re hard to work out and prove. Log them as you go: the miles come from the map, and each trip is kept with its date, place and reason.</p>}
        </div>
        {data && <span className="text-[24px] font-bold tracking-[-0.01em]" style={{ color: s && s.trips ? GREEN : MUTED }}>{usd(s?.amountCents || 0)}</span>}
      </div>
      {data?.drive && !data.drive.ended && <p className="rounded-2xl px-4 py-3 text-[14px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>A drive is under way. End it in Mileage when you get there.</p>}
      {waiting > 0 && <p className="text-[14px]" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12 }}><span className="font-semibold">{waiting} drive{waiting === 1 ? '' : 's'} to check</span><span style={{ color: MUTED }}>, from your card purchases and events. One tap logs each, with its proof.</span></p>}
      <div className="flex flex-wrap gap-2">
        <a href="/mileage" className={btn} style={{ background: INK, color: '#fff' }}>{waiting > 0 ? 'Check them in Mileage' : 'Open mileage'}</a>
      </div>
    </section>
  );
}

export function WriteOffsScreen({ tenantId, canLog }: { tenantId: string; canLog: boolean }) {
  const [miles, setMiles] = React.useState<Miles | null>(null); const [err, setErr] = React.useState('');
  React.useEffect(() => {
    if (!tenantId || !canLog) return; let on = true;
    (async () => {
      const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      const r: any = await fetch('/api/mileage', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, action: 'list' }) }).then((x) => x.json()).catch(() => null);
      if (!on) return; if (r?.ok) setMiles(r); else setErr(r?.error || 'Mileage didn’t load. Try again.');
    })();
    return () => { on = false; };
  }, [tenantId, canLog]);
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 pb-12 pt-5 md:px-6" style={{ color: INK }}>
      <div className="max-w-[680px]">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">Write-offs</h1>
        <p className="mt-1 text-[15px]" style={{ color: MUTED }}>Costs the business can write off that are easy to miss, found from what’s already in ClarityFlow and kept with their proof for your accountant.</p>
      </div>
      <MilesWriteOff data={miles} canLog={canLog} err={err} />
    </div>
  );
}
