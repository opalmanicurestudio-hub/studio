'use client';
// components/renters/RenterPage.tsx — ONE RENTER, ON ONE PAGE (app/(app)/renters/[renterId]). Opened the same way
// from the Rentals home, Spaces, Renters and Rent: who they are and where, the one thing that needs doing, six numbers,
// and an Overview of four cards (lease, money, insurance and paperwork, their business), each with its next step. The
// Money, Documents, Messages and Activity tabs are the renter card's own (components/renters/RenterProfileDrawer, shown
// in the page). One Record payment (the Rent page's), one End lease (EndLeaseDialog), one Edit (RenterEditDialog).
import * as React from 'react';
import Link from 'next/link';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { PrintLink } from '@/components/shared/PrintLink';
import { RENTALS_BTN, RENTALS_BTN_DARK } from '@/components/renters/RentalsNav';
import type { Line, Tile } from '@/lib/renter-summary';

export type RenterTab = 'overview' | 'details' | 'money' | 'documents' | 'messages' | 'activity';
const TABS: { id: RenterTab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'details', label: 'Details' }, { id: 'money', label: 'Money' }, { id: 'documents', label: 'Documents' }, { id: 'messages', label: 'Messages' }, { id: 'activity', label: 'Activity' },
];
type Summary = {
  name: string; initials: string; sub: string; status: { text: string; warn: boolean };
  tiles: Tile[]; lease: Line[]; money: Line[]; papers: Line[]; business: Line[]; relationship: Line[]; providerId: string | null;
  leaseId: string | null; holding: boolean; movedOut: boolean; owedCents: number; late: boolean; depositHeldCents: number; depositsByLease: Record<string, number>;
};
const RED = 'inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#f3d0cc] bg-white px-3.5 text-[14px] font-semibold text-[#b42318] hover:bg-[#fff5f4]';
const sub = 'text-[13px] leading-snug text-[#6d7075]';

function Card({ id, title, lines, children, stacked }: { id: string; title: string; lines: Line[]; children?: React.ReactNode; stacked?: boolean }) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-[20px] border border-[#ececee] bg-white p-5">
      <h3 id={id} className="mb-2 text-[16px] font-bold leading-6 text-[#16171a]">{title}</h3>
      {lines.length === 0 ? <p className={sub}>Nothing yet.</p> : (
        <dl>
          {lines.map((l, i) => (
            <div key={l.label} className={`${stacked ? 'space-y-0.5' : 'flex justify-between gap-4'} py-2.5 text-[14px] ${i ? 'border-t border-[#ececee]' : ''}`}>
              <dt className="shrink-0 text-[#6d7075]">{l.label}</dt>
              <dd className={`${stacked ? 'leading-snug' : 'text-right'} ${l.warn ? 'font-semibold text-[#b45309]' : l.ok ? 'text-[#1f7a4d]' : 'text-[#16171a]'}`}>{l.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children && <div className="mt-3.5 flex flex-wrap gap-2">{children}</div>}
    </section>
  );
}

export function RenterPage({ tenantId, renterId, phone, refreshKey, tab, onTab, onEdit, onEndLease, renderTab }: {
  tenantId: string; renterId: string; phone?: string;
  /** Changes when the renter, their lease or money changes, so the summary reads again. */
  refreshKey?: string;
  tab: RenterTab; onTab: (t: RenterTab) => void;
  onEdit: () => void;
  /** End their lease, knowing what they owe and the deposit held (so the dialog can say what's left to settle). */
  onEndLease: (left: { owedCents: number; depositsByLease: Record<string, number> }) => void;
  /** The deeper tabs (Money, Documents, Messages, Activity), drawn by the page. */
  renderTab: (t: RenterTab) => React.ReactNode;
}) {
  const [s, setS] = React.useState<Summary | null>(null);
  const [err, setErr] = React.useState('');
  const [tick, setTick] = React.useState(0);
  // Another renter: never the last one's numbers while theirs load.
  React.useEffect(() => { setS(null); }, [tenantId, renterId]);
  // Back on Overview after working in another tab (a payment, a charge, a deposit): read it again.
  const lastTab = React.useRef(tab);
  React.useEffect(() => { if (tab === 'overview' && lastTab.current !== 'overview') setTick((t) => t + 1); lastTab.current = tab; }, [tab]);
  React.useEffect(() => {
    let live = true; setErr('');
    staffAuthHeader().then((h) => fetch(`/api/renters/one?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(renterId)}`, { headers: h })).then((r) => r.json())
      .then((d) => { if (!live) return; if (d?.ok) setS(d.summary); else setErr(d?.error || 'This renter didn’t load.'); })
      .catch(() => { if (live) setErr('This renter didn’t load. Check your connection.'); });
    return () => { live = false; };
  }, [tenantId, renterId, refreshKey, tick]);

  if (err && !s) return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[#ececee] bg-white p-5">
      <p className="text-[15px] text-[#b45309]">{err}</p>
      <button type="button" className={RENTALS_BTN} onClick={() => setTick((t) => t + 1)}>Try again</button>
    </div>
  );
  if (!s) return <p className={sub} aria-live="polite">Loading…</p>;

  const pay = `/rent?pay=${encodeURIComponent(renterId)}`;
  // The one step that matters most now, as the main button.
  const primary = s.late ? <Link href={pay} className={RENTALS_BTN_DARK}>Record payment</Link>
    : !s.holding && !s.movedOut ? <Link href={`/booths?lease=${encodeURIComponent(renterId)}`} className={RENTALS_BTN_DARK}>Write the lease</Link>
    : s.status.warn && /sign/.test(s.status.text) ? <button type="button" className={RENTALS_BTN_DARK} onClick={() => onTab('documents')}>See the lease</button>
    : <button type="button" className={RENTALS_BTN_DARK} onClick={onEdit}>Edit</button>;

  return (
    <div className="space-y-5">
      <Link href="/renters" className="inline-flex min-h-[44px] items-center text-[14px] text-[#6d7075] hover:text-[#16171a]"><span aria-hidden className="mr-1">‹</span>Renters</Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <div aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#ececee] text-[18px] font-bold text-[#16171a]">{s.initials}</div>
          <div className="min-w-0">
            <h2 className="break-words text-[26px] font-bold leading-8 text-[#16171a]">{s.name}</h2>
            <p className="text-[14px] leading-snug text-[#6d7075]">{s.sub}{s.sub ? ' · ' : ''}<span className={s.status.warn ? 'font-semibold text-[#b45309]' : ''}>{s.status.text}</span></p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={RENTALS_BTN} onClick={() => onTab('messages')}>Message</button>
          {phone && <a href={`tel:${phone}`} className={RENTALS_BTN}>Call</a>}
          {primary}
        </div>
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {s.tiles.map((t) => (
          <div key={t.label} className="min-w-0 rounded-2xl border border-[#ececee] bg-white px-3.5 py-3">
            <p className={sub}>{t.label}</p>
            <p className={`break-words text-[17px] font-bold leading-6 ${t.warn ? 'text-[#b45309]' : t.ok ? 'text-[#1f7a4d]' : 'text-[#16171a]'}`}>{t.value}</p>
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="Renter" className="flex max-w-full gap-1 overflow-x-auto border-b border-[#ececee]">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => onTab(t.id)}
            className={`-mb-px min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-4 text-[15px] ${tab === t.id ? 'border-[#16171a] font-semibold text-[#16171a]' : 'border-transparent text-[#6d7075] hover:text-[#16171a]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            <Card id="c-lease" title="Lease" lines={s.lease}>
              {s.leaseId ? <>
                <button type="button" className={RENTALS_BTN} onClick={() => onTab('documents')}>Read the lease</button>
                {s.holding && <button type="button" className={RED} onClick={() => onEndLease({ owedCents: s.owedCents, depositsByLease: s.depositsByLease })}>End lease</button>}
              </> : <Link href={`/booths?lease=${encodeURIComponent(renterId)}`} className={RENTALS_BTN_DARK}>Write the lease</Link>}
            </Card>
            <Card id="c-money" title="Money" lines={s.money}>
              <Link href={pay} className={s.owedCents > 0 ? RENTALS_BTN_DARK : RENTALS_BTN}>Record payment</Link>
              <button type="button" className={RENTALS_BTN} onClick={() => onTab('money')}>Charges and history</button>
              <PrintLink path="/api/booths/account-statement" params={{ tenantId, renterId }} className={RENTALS_BTN}>Statement</PrintLink>
            </Card>
            <Card id="c-papers" title="Insurance and paperwork" lines={s.papers}>
              {s.papers.some((l) => l.warn) && <button type="button" className={RENTALS_BTN} onClick={() => onTab('messages')}>Ask for what’s missing</button>}
              <button type="button" className={RENTALS_BTN} onClick={() => onTab('documents')}>See the copies</button>
            </Card>
            <Card id="c-biz" title="Their business" lines={s.business}>
              <button type="button" className={RENTALS_BTN} onClick={() => onTab('details')}>Portal link, autopay and notes</button>
              <button type="button" className={RENTALS_BTN} onClick={onEdit}>Edit their details</button>
            </Card>
            {s.relationship.length > 0 && (
              <Card id="c-rel" title="Renter, not staff" lines={s.relationship} stacked>
                {s.providerId && <Link href={`/staff/${encodeURIComponent(s.providerId)}`} className={RENTALS_BTN}>Open their booking record</Link>}
              </Card>
            )}
          </div>
        ) : renderTab(tab)}
      </div>
    </div>
  );
}
