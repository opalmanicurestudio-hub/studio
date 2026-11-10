'use client';
// components/renters/RentalsHome.tsx — THE RENTALS HOME (app/(app)/rentals). The first thing the owner sees in
// Rentals: how full the spaces are and the money (rent roll, collected, owed, deposits held, what open spaces cost),
// one list of what needs them with the step to take, leases ending in the next 90 days, and today at the spaces.
// Worked out on the server (api/renters/home, lib/rentals-home); this only shows it.
import * as React from 'react';
import Link from 'next/link';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { RentalsNav } from '@/components/renters/RentalsNav';
import type { NeedItem } from '@/lib/rentals-home';

type Home = {
  kpis: { key: string; label: string; value: string; sub: string; warn?: boolean }[];
  needs: NeedItem[];
  ending: { leaseId: string; renterId: string; renter: string; space: string; endDate: string; renews: boolean }[];
  today: { label: string; value: string }[];
  leaseable: { id: string; name: string; status: string }[];
  counts: { spaces: number; renters: number };
  businessName: string;
};

const card = 'min-w-0 rounded-[20px] border border-[#ececee] bg-white px-5 pb-3 pt-2';
const h2 = 'mb-1 mt-3 text-[17px] font-bold leading-6 text-[#16171a]';
const sub = 'text-[13px] leading-snug text-[#6d7075]';
const light = 'inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#ececee] bg-white px-3.5 text-[14px] font-medium text-[#16171a] hover:bg-[#f5f5f7]';
const dark = 'inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#16171a] px-3.5 text-[14px] font-semibold text-white disabled:opacity-40';
const monthDay = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };

export function RentalsHome({ tenantId, locationId, businessName, locationSwitcher }: { tenantId: string; locationId?: string | null; businessName?: string; locationSwitcher?: React.ReactNode }) {
  const [data, setData] = React.useState<Home | null>(null);
  const [err, setErr] = React.useState('');
  const [tick, setTick] = React.useState(0);
  const [picking, setPicking] = React.useState(false);
  const [pick, setPick] = React.useState('');

  React.useEffect(() => {
    let live = true; setErr('');
    const q = `tenantId=${encodeURIComponent(tenantId)}${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''}`;
    staffAuthHeader().then((h) => fetch(`/api/renters/home?${q}`, { headers: h })).then((r) => r.json())
      .then((d) => { if (!live) return; if (d?.ok) setData(d); else setErr(d?.error || 'The Rentals home didn’t load.'); })
      .catch(() => { if (live) setErr('The Rentals home didn’t load. Check your connection.'); });
    return () => { live = false; };
  }, [tenantId, locationId, tick]);

  const name = data?.businessName || businessName || '';
  const leaseable = data?.leaseable || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {name && <p className={sub}>{name}</p>}
          <h1 className="text-[28px] font-bold leading-9 text-[#16171a]">Rentals</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {locationSwitcher}
          <Link href="/booths?addRenter=1" className={light}>Add renter</Link>
          <button type="button" className={dark} aria-expanded={picking} onClick={() => { setPicking((v) => !v); setPick(''); }}>New lease</button>
        </div>
      </div>

      <RentalsNav current="/rentals" />

      {picking && (
        <section aria-labelledby="new-lease" className="rounded-[20px] border border-[#ececee] bg-white p-5">
          <h2 id="new-lease" className="text-[17px] font-bold leading-6 text-[#16171a]">Who is the lease for?</h2>
          {!data ? <p className={`mt-1 ${sub}`}>Loading your renters…</p> : leaseable.length ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 basis-60">
                <span className="text-[13px] font-medium text-[#16171a]">Renter</span>
                <select value={pick} onChange={(e) => setPick(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a]">
                  <option value="">Choose a renter</option>
                  {leaseable.map((r) => <option key={r.id} value={r.id}>{r.name}{r.status === 'past' ? ' (rented before)' : ''}</option>)}
                </select>
              </label>
              {pick ? <Link href={`/booths?lease=${encodeURIComponent(pick)}`} className={dark}>Write the lease</Link> : <button type="button" disabled className={dark}>Write the lease</button>}
              <Link href="/booths?addRenter=1" className={light}>Someone new</Link>
            </div>
          ) : (
            <div className="mt-1 space-y-3"><p className={sub}>Everyone you’ve added already has a space. Add the renter first, then write their lease.</p><Link href="/booths?addRenter=1" className={light}>Add renter</Link></div>
          )}
        </section>
      )}

      {err && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[#ececee] bg-white p-5">
          <p className="text-[15px] text-[#b45309]">{err}</p>
          <button type="button" className={light} onClick={() => setTick((t) => t + 1)}>Try again</button>
        </div>
      )}

      <p className={data || err ? 'sr-only' : sub} aria-live="polite">{data ? 'Rentals home loaded.' : err ? '' : 'Loading…'}</p>

      {data && (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {data.kpis.map((k) => (
              <div key={k.key} className="min-w-0 rounded-[18px] border border-[#ececee] bg-white px-4 py-3.5">
                <p className={sub}>{k.label}</p>
                <p className={`text-[24px] font-bold leading-8 tabular-nums ${k.warn ? 'text-[#b45309]' : 'text-[#16171a]'}`}>{k.value}</p>
                <p className={sub}>{k.sub}</p>
              </div>
            ))}
          </div>

          {data.counts.spaces === 0 && (
            <div className="rounded-[20px] border border-[#ececee] bg-white p-5">
              <p className="text-[15px] font-semibold text-[#16171a]">Start with your spaces</p>
              <p className={`mt-1 ${sub}`}>Add the spaces you rent out and their rent. Then add renters and write their leases.</p>
              <Link href="/booths" className={`mt-3 ${dark}`}>Add a space</Link>
            </div>
          )}

          <div className="flex flex-wrap items-start gap-6">
            <section aria-labelledby="needs-you" className={card} style={{ flex: '999 1 520px' }}>
              <h2 id="needs-you" className={h2}>Needs you {data.needs.length > 0 && <span className="font-medium text-[#6d7075]">· {data.needs.length}</span>}</h2>
              {data.needs.length === 0 ? (
                <p className={`pb-2 ${sub}`}>Nothing needs you right now. Late rent, unsigned leases, papers running out, concerns, repairs and new applications show here.</p>
              ) : (
                <ul>
                  {data.needs.map((it, i) => (
                    <li key={it.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 py-3.5 ${i ? 'border-t border-[#ececee]' : ''}`}>
                      <div className="min-w-0 flex-1 basis-44">
                        <p className="break-words text-[15px] font-semibold leading-snug text-[#16171a]">{it.title}</p>
                        <p className={`break-words ${sub}`}>{it.detail}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {it.actions.map((a) => <Link key={a.label} href={a.href} className={a.primary ? dark : light}>{a.label}</Link>)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <aside className="flex min-w-0 flex-col gap-4" style={{ flex: '1 1 300px' }}>
              <section aria-labelledby="ending" className={card}>
                <h2 id="ending" className={h2}>Leases ending in the next 90 days</h2>
                {data.ending.length === 0 ? <p className={`pb-2 ${sub}`}>None.</p> : (
                  <ul>
                    {data.ending.map((e, i) => (
                      <li key={e.leaseId} className={`flex items-center justify-between gap-3 py-1 text-[14px] ${i ? 'border-t border-[#ececee]' : ''}`}>
                        <Link href={`/renters?renter=${encodeURIComponent(e.renterId)}`} className="flex min-h-[44px] min-w-0 items-center break-words text-[#16171a] hover:underline">{e.renter} · {e.space}</Link>
                        <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${e.renews ? 'bg-[#f5f5f7] text-[#16171a]' : 'bg-[#fff7ed] text-[#b45309]'}`}>{monthDay(e.endDate)} · {e.renews ? 'renews' : 'ends'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-labelledby="today" className={card}>
                <h2 id="today" className={h2}>Today at the spaces</h2>
                <ul>
                  {data.today.map((t, i) => (
                    <li key={t.label} className={`flex justify-between gap-3 py-2.5 text-[14px] text-[#16171a] ${i ? 'border-t border-[#ececee]' : ''}`}>
                      <span>{t.label}</span><span className="text-right">{t.value}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
