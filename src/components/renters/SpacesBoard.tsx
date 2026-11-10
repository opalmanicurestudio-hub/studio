'use client';
// components/renters/SpacesBoard.tsx — THE SPACES LIST (the Spaces page's List view). One row per space: its status in
// words, who has it, when the lease ends, its rent, what it brought in this year and how much of the last twelve months
// it was used. Tap a space for the detail: the lease, rent, deposit, signing, repairs and use month by month, with the
// next step (open the renter, report a repair, edit the space, or write a lease for an open one). Worked out on the
// server (api/renters/spaces, lib/spaces-board) by the same rule as the Rentals home.
import * as React from 'react';
import Link from 'next/link';
import { staffAuthHeader } from '@/lib/staff-fetch';
import type { SpaceRow, SpaceFilter } from '@/lib/spaces-board';

type Board = { rows: SpaceRow[]; chips: { key: SpaceFilter; label: string; count: number }[]; leaseable: { id: string; name: string; status: string }[] };

const sub = 'text-[13px] leading-snug text-[#6d7075]';
const light = 'inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#ececee] bg-white px-3.5 text-[14px] font-medium text-[#16171a] hover:bg-[#f5f5f7]';
const dark = 'inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#16171a] px-3.5 text-[14px] font-semibold text-white disabled:opacity-40';
const usd = (c: number) => `$${(Math.round(c) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const longDay = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };

export function SpacesBoard({ tenantId, locationId, refreshKey, onEdit, onLease }: {
  tenantId: string; locationId?: string | null;
  /** Changes when the spaces or leases change, so the list reads them again. */
  refreshKey?: string;
  onEdit: (boothId: string) => void;
  /** Write a lease for this renter, with the space already picked. */
  onLease: (renterId: string, boothId: string) => void;
}) {
  const [data, setData] = React.useState<Board | null>(null);
  const [err, setErr] = React.useState('');
  const [tick, setTick] = React.useState(0);
  const [filter, setFilter] = React.useState<SpaceFilter>('all');
  const [sel, setSel] = React.useState('');
  const [pick, setPick] = React.useState('');
  const detailRef = React.useRef<HTMLElement | null>(null);

  // Another location: its own spaces, never the last one's while they load.
  React.useEffect(() => { setData(null); setSel(''); }, [tenantId, locationId]);
  React.useEffect(() => {
    let live = true; setErr('');
    const q = `tenantId=${encodeURIComponent(tenantId)}${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''}`;
    staffAuthHeader().then((h) => fetch(`/api/renters/spaces?${q}`, { headers: h })).then((r) => r.json())
      .then((d) => { if (!live) return; if (d?.ok) setData(d); else setErr(d?.error || 'The spaces didn’t load.'); })
      .catch(() => { if (live) setErr('The spaces didn’t load. Check your connection.'); });
    return () => { live = false; };
  }, [tenantId, locationId, refreshKey, tick]);

  const rows = (data?.rows || []).filter((r) => r.filters.includes(filter) && (filter !== 'all' || r.state !== 'off'));
  const off = filter === 'all' ? (data?.rows || []).filter((r) => r.state === 'off') : [];
  const shown = [...rows, ...off];
  const chosen = shown.find((r) => r.id === sel) || shown[0] || null;
  const choose = (id: string) => {
    setSel(id); setPick('');
    if (typeof window !== 'undefined' && window.innerWidth < 1024) setTimeout(() => detailRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
  };

  if (err) return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[#ececee] bg-white p-5">
      <p className="text-[15px] text-[#b45309]">{err}</p>
      <button type="button" className={light} onClick={() => setTick((t) => t + 1)}>Try again</button>
    </div>
  );
  if (!data) return <p className={sub} aria-live="polite">Loading…</p>;

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {data.chips.map((c) => (
          <button key={c.key} type="button" aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}
            className={`min-h-[44px] rounded-full border px-4 text-[14px] ${filter === c.key ? 'border-[#16171a] bg-[#16171a] font-semibold text-white' : 'border-[#ececee] bg-white text-[#16171a] hover:bg-[#f5f5f7]'}`}>
            {c.label} <span className={filter === c.key ? 'text-white/70' : 'text-[#6d7075]'}>{c.count}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className={`rounded-[20px] border border-[#ececee] bg-white p-5 ${sub}`}>No spaces here.</p>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <section aria-label="Spaces" className="min-w-0 overflow-hidden rounded-[20px] border border-[#ececee] bg-white" style={{ flex: '999 1 560px' }}>
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-left text-[14px]">
              <thead>
                <tr className="text-[13px] text-[#6d7075]">
                  {['Space', 'Status', 'Renter', 'Lease ends', 'Rent', 'This year', 'Used'].map((h, i) => <th key={h} scope="col" className={`px-4 py-3 font-medium ${i >= 5 ? 'text-right' : ''}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} onClick={() => choose(r.id)} className={`cursor-pointer border-t border-[#ececee] ${chosen?.id === r.id ? 'bg-[#f5f5f7]' : 'hover:bg-[#fafafb]'}`}>
                    <th scope="row" className="px-4 py-3 font-semibold text-[#16171a]">
                      <button type="button" onClick={(e) => { e.stopPropagation(); choose(r.id); }} aria-current={chosen?.id === r.id ? 'true' : undefined} className="min-h-[44px] text-left">{r.name}</button>
                    </th>
                    <td className="px-4 py-3"><Status r={r} /></td>
                    <td className="px-4 py-3 text-[#16171a]">{r.renter || <span className="text-[#6d7075]">None</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-[#16171a]">{r.leaseEnds ? longDay(r.leaseEnds) : <span className="text-[#6d7075]">None</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-[#16171a]">{r.rent}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#16171a]">{r.thisYearCents ? usd(r.thisYearCents) : <span className="text-[#6d7075]">$0</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#16171a]">{r.usedPct === null ? <span className="text-[#6d7075]">New</span> : `${r.usedPct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <ul className="md:hidden">
              {shown.map((r, i) => (
                <li key={r.id} className={i ? 'border-t border-[#ececee]' : ''}>
                  <button type="button" onClick={() => choose(r.id)} aria-current={chosen?.id === r.id ? 'true' : undefined}
                    className={`flex min-h-[44px] w-full flex-wrap items-start justify-between gap-x-3 gap-y-1 px-4 py-3 text-left ${chosen?.id === r.id ? 'bg-[#f5f5f7]' : ''}`}>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-[#16171a]">{r.name}</span>
                      <span className={`block ${sub}`}>{[r.renter, r.rent, r.leaseEnds ? `to ${longDay(r.leaseEnds)}` : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Status r={r} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {chosen && (
            <aside ref={detailRef as any} aria-labelledby="space-detail" className="min-w-0 scroll-mt-20 rounded-[20px] border border-[#ececee] bg-white p-5" style={{ flex: '1 1 300px' }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 id="space-detail" className="text-[19px] font-bold leading-7 text-[#16171a]">{chosen.name}</h2>
                <Status r={chosen} />
              </div>
              {chosen.detail.about && <p className={`mt-1 ${sub}`}>{chosen.detail.about}</p>}
              <dl className="mt-3">
                {chosen.detail.lines.map((l) => (
                  <div key={l.label} className="flex justify-between gap-4 border-t border-[#ececee] py-2.5 text-[14px]">
                    <dt className="shrink-0 text-[#6d7075]">{l.label}</dt>
                    <dd className={`text-right ${l.warn ? 'text-[#b45309]' : 'text-[#16171a]'}`}>{l.value}</dd>
                  </div>
                ))}
              </dl>
              {chosen.state !== 'off' && (
                <div className="mt-3">
                  <p className="text-[13px] font-medium text-[#16171a]">Used, last 12 months{chosen.usedPct !== null ? `: ${chosen.usedPct}%` : ''}</p>
                  <div className="mt-2 flex h-14 items-end gap-1" role="img" aria-label={`Use by month: ${chosen.detail.usedByMonth.map((m) => `${m.month} ${m.pct === null ? 'not yet' : `${m.pct}%`}`).join(', ')}`}>
                    {chosen.detail.usedByMonth.map((m, i) => (
                      <div key={i} className="flex flex-1 flex-col items-center gap-1">
                        {m.pct === null ? <div className="w-full border-b border-dashed border-[#ececee]" /> : <div className="w-full rounded-[3px] bg-[#16171a]" style={{ height: `${Math.max(2, Math.round(m.pct * 0.4))}px`, opacity: m.pct ? 1 : 0.15 }} />}
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[12px] text-[#6d7075]"><span>{chosen.detail.usedByMonth[0]?.month}</span><span>{chosen.detail.usedByMonth[11]?.month}</span></div>
                </div>
              )}

              {chosen.state === 'open' && (
                <div className="mt-4 border-t border-[#ececee] pt-4">
                  <p className="text-[15px] font-semibold text-[#16171a]">Lease this space</p>
                  {data.leaseable.length ? (
                    <div className="mt-2 space-y-2">
                      <label className="block">
                        <span className="text-[13px] font-medium text-[#16171a]">Renter</span>
                        <select value={pick} onChange={(e) => setPick(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a]">
                          <option value="">Choose a renter</option>
                          {data.leaseable.map((r) => <option key={r.id} value={r.id}>{r.name}{r.status === 'past' ? ' (rented before)' : ''}</option>)}
                        </select>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={dark} disabled={!pick} onClick={() => pick && onLease(pick, chosen.id)}>Write the lease</button>
                        <Link href="/booths?addRenter=1" className={light}>Someone new</Link>
                      </div>
                    </div>
                  ) : <p className={`mt-1 ${sub}`}>Everyone you’ve added has a space. Add the renter first.</p>}
                  {!data.leaseable.length && <Link href="/booths?addRenter=1" className={`mr-2 mt-2 ${light}`}>Add renter</Link>}
                  {chosen.detail.applicants > 0 && <Link href="/pipeline" className={`mt-2 ${light}`}>See who applied</Link>}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {chosen.renterIds.slice(0, 2).map((id, i) => (
                  <Link key={id} href={`/renters?renter=${encodeURIComponent(id)}`} className={dark}>{chosen.renterIds.length > 1 ? `Open ${chosen.renter.split(', ')[i] || 'renter'}` : 'Open renter'}</Link>
                ))}
                <Link href="/maintenance" className={light}>Report a repair</Link>
                <button type="button" className={light} onClick={() => onEdit(chosen.id)}>Edit space</button>
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function Status({ r }: { r: SpaceRow }) {
  return <span className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${r.warn ? 'bg-[#fff7ed] text-[#b45309]' : r.state === 'taken' || r.state === 'shared' ? 'bg-[#ecf6f0] text-[#1f7a4d]' : 'bg-[#f5f5f7] text-[#16171a]'}`}>{r.status}</span>;
}
