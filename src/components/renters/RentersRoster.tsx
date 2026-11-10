'use client';
// components/renters/RentersRoster.tsx — THE RENTERS LIST, BY STAGE (the Renters page). One row per renter: their
// space, lease, what they owe, autopay, insurance, license and portal, in amber when something needs doing; tapping
// an amber cell goes to the fix, tapping the name opens the renter. Stages (current, new, signing, ending soon, time
// away, past, missing something) filter the list. Worked out on the server (api/renters/roster, lib/renters-roster).
import * as React from 'react';
import Link from 'next/link';
import { staffAuthHeader } from '@/lib/staff-fetch';
import type { RosterRow, RosterStage, RosterCell } from '@/lib/renters-roster';

type Roster = { rows: RosterRow[]; chips: { key: RosterStage; label: string; count: number }[] };
const sub = 'text-[13px] leading-snug text-[#6d7075]';
const light = 'inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#ececee] bg-white px-3.5 text-[14px] font-medium text-[#16171a] hover:bg-[#f5f5f7]';
const COLS: [keyof RosterRow, string][] = [['lease', 'Lease'], ['balance', 'Balance'], ['autopay', 'Autopay'], ['insurance', 'Insurance'], ['license', 'License'], ['portal', 'Portal']];

export function RentersRoster({ tenantId, locationId, refreshKey, onOpen }: {
  tenantId: string; locationId?: string | null;
  /** Changes when renters or leases change, so the list reads them again. */
  refreshKey?: string;
  onOpen: (renterId: string) => void;
}) {
  const [data, setData] = React.useState<Roster | null>(null);
  const [err, setErr] = React.useState('');
  const [tick, setTick] = React.useState(0);
  const [stage, setStage] = React.useState<RosterStage>('current');

  // Another location: its own renters, never the last one's while they load.
  React.useEffect(() => { setData(null); }, [tenantId, locationId]);
  React.useEffect(() => {
    let live = true; setErr('');
    const q = `tenantId=${encodeURIComponent(tenantId)}${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''}`;
    staffAuthHeader().then((h) => fetch(`/api/renters/roster?${q}`, { headers: h })).then((r) => r.json())
      .then((d) => { if (!live) return; if (d?.ok) setData(d); else setErr(d?.error || 'The renters didn’t load.'); })
      .catch(() => { if (live) setErr('The renters didn’t load. Check your connection.'); });
    return () => { live = false; };
  }, [tenantId, locationId, refreshKey, tick]);

  if (err) return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[#ececee] bg-white p-5">
      <p className="text-[15px] text-[#b45309]">{err}</p>
      <button type="button" className={light} onClick={() => setTick((t) => t + 1)}>Try again</button>
    </div>
  );
  if (!data) return <p className={sub} aria-live="polite">Loading…</p>;
  const rows = data.rows.filter((r) => r.stages.includes(stage));

  const cell = (c: RosterCell, label: string, name: string) => c.warn && c.href
    ? <Link href={c.href} className="inline-flex min-h-[44px] items-center text-[#b45309] underline decoration-[#b45309]/40 underline-offset-2" aria-label={`${label} for ${name}: ${c.text}. Fix it`}>{c.text}</Link>
    : <span className={c.warn ? 'text-[#b45309]' : c.text === 'None' || c.text === 'Not needed' ? 'text-[#6d7075]' : 'text-[#16171a]'}>{c.text}</span>;

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {data.chips.map((c) => (
          <button key={c.key} type="button" aria-pressed={stage === c.key} onClick={() => setStage(c.key)}
            className={`min-h-[44px] rounded-full border px-4 text-[14px] ${stage === c.key ? 'border-[#16171a] bg-[#16171a] font-semibold text-white' : c.key === 'missing' && c.count ? 'border-[#ececee] bg-white text-[#b45309] hover:bg-[#f5f5f7]' : 'border-[#ececee] bg-white text-[#16171a] hover:bg-[#f5f5f7]'}`}>
            {c.label} <span className={stage === c.key ? 'text-white/70' : 'text-[#6d7075]'}>{c.count}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className={`rounded-[20px] border border-[#ececee] bg-white p-5 ${sub}`}>
          {stage === 'missing' ? 'Nobody is missing anything.' : stage === 'new' ? 'Nobody is waiting for a lease. Add a renter, or turn an application into one in Pipeline.' : stage === 'current' ? 'Nobody is renting yet. Add a renter and write their lease.' : 'Nobody here.'}
        </p>
      ) : (
        <section aria-label="Renters" className="min-w-0 overflow-hidden rounded-[20px] border border-[#ececee] bg-white">
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-left text-[14px]">
              <thead>
                <tr className="text-[13px] text-[#6d7075]">
                  <th scope="col" className="px-4 py-3 font-medium">Renter</th>
                  <th scope="col" className="px-4 py-3 font-medium">Space</th>
                  {COLS.map(([, h]) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[#ececee] align-middle">
                    <th scope="row" className="px-4 py-2 text-left font-normal">
                      <button type="button" onClick={() => onOpen(r.id)} className="min-h-[44px] text-left">
                        <span className="block font-semibold text-[#16171a] hover:underline">{r.name}</span>
                        {r.specialty && <span className={`block ${sub}`}>{r.specialty}</span>}
                      </button>
                    </th>
                    <td className="px-4 py-2 text-[#16171a]">{r.space || <span className="text-[#6d7075]">None</span>}</td>
                    {COLS.map(([k, h]) => <td key={h} className="whitespace-nowrap px-4 py-2">{cell(r[k] as RosterCell, h, r.name)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="lg:hidden">
            {rows.map((r, i) => {
              const flags = COLS.filter(([k]) => k !== 'balance').map(([k, h]) => ({ h, c: r[k] as RosterCell })).filter((x) => x.c.warn);   // the balance is already on the right
              return (
                <li key={r.id} className={`px-4 py-3 ${i ? 'border-t border-[#ececee]' : ''}`}>
                  <button type="button" onClick={() => onOpen(r.id)} className="flex min-h-[44px] w-full flex-wrap items-start justify-between gap-x-3 text-left">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-[#16171a]">{r.name}</span>
                      <span className={`block ${sub}`}>{[r.specialty, r.space, r.lease.text].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className={`shrink-0 text-[14px] ${r.balance.warn ? 'text-[#b45309]' : 'text-[#16171a]'}`}>{r.balance.text}</span>
                  </button>
                  {r.balance.warn && r.balance.href && <Link href={r.balance.href} className="inline-flex min-h-[44px] items-center text-[13px] text-[#b45309] underline decoration-[#b45309]/40 underline-offset-2">Record payment</Link>}
                  {flags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-4">
                      {flags.map((f) => <span key={f.h} className="text-[13px]">{f.h}: {cell(f.c, f.h, r.name)}</span>)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p className={sub}>Tap a renter to open everything about them. Amber means something needs doing; tapping it goes to the fix.</p>
    </div>
  );
}
