'use client';
// src/app/(app)/month/page.tsx — THE MONTH IN REVIEW (lib/month-review): what the automatic parts of the business did,
// one month at a time. Sent to the owner on the 1st; any month can be opened here. Managers only.
import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';

const MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', GREEN = '#1f7a4d', AMBER = '#b45309';
const $ = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const n = (v: number) => (Number(v) || 0).toLocaleString('en-US');
const shift = (ym: string, by: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 15)); return d.toISOString().slice(0, 7); };

function Tile({ title, big, sub, children, tone }: { title: string; big: string; sub?: string; children?: React.ReactNode; tone?: string }) {
  return (
    <section className="rounded-[20px] border bg-card p-5" style={{ borderColor: LINE }}>
      <p className="text-[13px]" style={{ color: MUTED }}>{title}</p>
      <p className="mt-1 text-[32px] font-light leading-none tracking-[-0.02em]" style={{ color: tone }}>{big}</p>
      {sub && <p className="mt-1.5 text-[13.5px]" style={{ color: MUTED }}>{sub}</p>}
      {children && <div className="mt-3 space-y-1.5 border-t pt-3 text-[13.5px]" style={{ borderColor: LINE }}>{children}</div>}
    </section>);
}
const Row = ({ l, v }: { l: string; v: React.ReactNode }) => <div className="flex justify-between gap-3"><span style={{ color: MUTED }}>{l}</span><span className="font-semibold">{v}</span></div>;

export default function MonthPage() { return <React.Suspense fallback={null}><MonthInReview /></React.Suspense>; }
function MonthInReview() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || ''; const q = useSearchParams();
  const manager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [month, setMonth] = React.useState<string>(q.get('m') || ''); const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { if (!tenantId || !manager) return; setD(null); payPost('/api/month-review', { tenantId, month: month || undefined }).then((r: any) => { setD(r); if (!month && r?.review?.month) setMonth(r.review.month); }); }, [tenantId, month, manager]);
  if (!manager) return <div className="p-8"><AppHeader title="Month in review" /><p className="mt-6" style={{ color: MUTED }}>Only managers can see the month in review.</p></div>;
  const r = d?.review; const atNow = r && d.thisMonth === r.month;
  return (
    <div className="min-h-full bg-background"><AppHeader title="Month in review" />
      <main className="mx-auto max-w-[1080px] space-y-5 px-4 pb-16 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-[13px]" style={{ color: MUTED }}>Month in review</p><h1 className="text-[34px] font-light tracking-[-0.02em]">{r ? r.label : '…'}{atNow ? <span className="ml-2 text-[15px]" style={{ color: MUTED }}>so far</span> : null}</h1></div>
          <div className="flex items-center gap-2 print:hidden">
            <button type="button" aria-label="Previous month" disabled={!r} onClick={() => setMonth(shift(r.month, -1))} className="grid h-10 w-10 place-items-center rounded-full border" style={{ borderColor: LINE }}><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" aria-label="Next month" disabled={!r || atNow} onClick={() => setMonth(shift(r.month, 1))} className="grid h-10 w-10 place-items-center rounded-full border disabled:opacity-30" style={{ borderColor: LINE }}><ChevronRight className="h-4 w-4" /></button>
            <button type="button" onClick={() => window.print()} className="flex h-10 items-center gap-2 rounded-full border px-4 text-[13.5px] font-semibold" style={{ borderColor: LINE }}><Printer className="h-4 w-4" />Print</button></div></div>
        {!d && <p style={{ color: MUTED }}>Loading…</p>}
        {d && !d.ok && <p style={{ color: '#b42318' }}>{d.error || 'That didn’t load.'}</p>}
        {r && <>
          {d.lines.length === 0 && <div className="rounded-[20px] border bg-card p-6 text-[14px]" style={{ borderColor: LINE, color: MUTED }}>Nothing automatic happened this month yet.</div>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Tile title="Cancelled times filled again" big={`${r.waitlist.filled} of ${r.waitlist.openings}`} sub={r.waitlist.openings ? `${Math.round((r.waitlist.filled / r.waitlist.openings) * 100)}% filled from the waitlist` : 'No cancellations to fill'} tone={r.waitlist.filled ? GREEN : undefined}>
              {r.waitlist.openings > 0 && <><Row l="By text" v={r.waitlist.how.text} /><Row l="By a call" v={r.waitlist.how.call} /><Row l="By a party" v={r.waitlist.how.party} /><Row l="Booked automatically" v={r.waitlist.how.auto} /><Row l="Came in sooner" v={r.waitlist.how.moveUp} /></>}</Tile>
            <Tile title="Opportunities that came back" big={$(r.opportunities.paidCents)} sub={`${r.opportunities.cameBack} came back and paid`} tone={r.opportunities.paidCents ? GREEN : undefined}>
              <Row l="Found" v={r.opportunities.found} /><Row l="Contacted" v={r.opportunities.contacted} /><Row l="Booked, not yet in" v={r.opportunities.stillBooked} /></Tile>
            <Tile title="Rewards used" big={String(r.rewards.used)} sub={r.rewards.usedValueCents ? `${$(r.rewards.usedValueCents)} off for clients` : 'No rewards used yet'}>
              <Row l="Points earned" v={n(r.rewards.earned)} /><Row l="Points used" v={n(r.rewards.usedPoints)} /><Row l="What rewards cost you" v={$(r.rewards.costCents)} />{r.rewards.expired > 0 && <Row l="Points expired" v={n(r.rewards.expired)} />}</Tile>
            <Tile title="Calls about openings" big={`${r.calls.used}`} sub={r.calls.on ? `of about ${r.calls.allowed} in your monthly limit` : 'Calls are off'} tone={r.calls.allowed && r.calls.used >= r.calls.allowed ? AMBER : undefined} />
            <Tile title="Texts" big={n(r.texts.sent)} sub="sent">
              <Row l="Didn’t go through" v={<span style={{ color: r.texts.failed ? AMBER : undefined }}>{r.texts.failed}</span>} /><Row l="Replied STOP" v={r.texts.stops} /></Tile>
            <Tile title="Gift cards between locations" big={r.giftOwed.length ? $(r.giftOwed.reduce((s: number, g: any) => s + g.cents, 0)) : '$0'} sub={r.giftOwed.length ? 'to settle up' : 'Nothing to settle'}>
              {r.giftOwed.map((g: any, i: number) => <Row key={i} l={`${g.fromName} owes ${g.toName}`} v={$(g.cents)} />)}</Tile>
          </div>
          {d.lines.length > 0 && <section className="rounded-[20px] border bg-card p-5" style={{ borderColor: LINE }}><p className="text-[15px] font-semibold">In a few words</p>
            <ul className="mt-2 space-y-1.5 text-[14px] leading-relaxed">{d.lines.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul></section>}
        </>}
      </main>
    </div>);
}
