'use client';
// src/components/money/BillsScreen.tsx — BILLS (the Money page's Bills tab; design board "Bills: overdue, this week, later,
// paid"). Every unpaid bill by when it's due, this month at a glance (due, paid, still to pay), what was paid lately, and
// Mark paid. The Bills tab (money/page.tsx) reads the bills and writes a payment; this screen lays them out and asks how
// it was paid.
import * as React from 'react';
import Link from 'next/link';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', AMBER = '#b45309';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const card = 'rounded-3xl bg-[#fff] px-5 pb-3 pt-4';
const usd = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (n: number) => (Math.round(n * 100) % 100 === 0 ? `$${Math.round(Math.abs(n)).toLocaleString('en-US')}` : usd(n));
const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export type UnpaidBill = { id: string; name: string; amount: number; due: Date; personal?: boolean; cadence?: string; lateFee?: number; paymentUrl?: string };
export type PaidBill = { id: string; name: string; amount: number; paidOn: Date };
/** How it was paid: the value kept with the payment, and the words shown. */
export const PAY_WAYS: [string, string][] = [['Bank Transfer', 'Bank transfer'], ['Card', 'Card'], ['Cash', 'Cash'], ['Check', 'Check'], ['Auto-Pay', 'Autopay']];
const EVERY: Record<string, string> = { daily: 'every day', weekly: 'every week', 'bi-weekly': 'every two weeks', monthly: 'every month', quarterly: 'every three months', annual: 'every year' };
const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : '');

/** The unpaid bills by when they're due: overdue, in the next 7 days, and later. */
export function groupBills(bills: UnpaidBill[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 8);
  const sorted = [...bills].sort((a, b) => a.due.getTime() - b.due.getTime());
  return {
    overdue: sorted.filter((b) => b.due < today),
    soon: sorted.filter((b) => b.due >= today && b.due < week),
    later: sorted.filter((b) => b.due >= week),
  };
}

export function BillsScreen({ bills, paid, month, onPay, now = new Date() }: {
  bills: UnpaidBill[]; paid: PaidBill[];
  /** This month's bills: what was due, what's paid of it, and what's still to pay. */
  month: { label: string; due: number; paid: number; left: number; earlier?: number };
  /** Marks one paid, how it was paid; true when it's done. */
  onPay: (id: string, way: string) => Promise<boolean>;
  now?: Date;
}) {
  const g = groupBills(bills, now);
  const earlier = Math.max(0, Number(month.earlier) || 0); const stillToPay = Math.round((month.left + earlier) * 100) / 100;
  const [paying, setPaying] = React.useState<UnpaidBill | null>(null);
  const [way, setWay] = React.useState('Bank Transfer');
  const [busy, setBusy] = React.useState(false);
  const [showPaid, setShowPaid] = React.useState(5);
  const dialog = React.useRef<HTMLDivElement>(null);
  const total = (l: UnpaidBill[]) => l.reduce((n, b) => n + (Number(b.amount) || 0), 0);
  const close = () => { if (!busy) setPaying(null); };
  React.useEffect(() => {
    if (!paying) return; dialog.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [paying]); // eslint-disable-line react-hooks/exhaustive-deps
  const pay = async () => { if (!paying) return; setBusy(true); const ok = await onPay(paying.id, way).catch(() => false); setBusy(false); if (ok) setPaying(null); };

  const row = (b: UnpaidBill, late: boolean) => {
    const url = safeUrl(b.paymentUrl);
    const when = late ? `Overdue since ${day(b.due)}` : `Due ${day(b.due)}`;
    const more = [b.cadence && EVERY[b.cadence] ? EVERY[b.cadence] : '', b.personal ? 'personal' : ''].filter(Boolean).join(', ');
    return (
      <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
        <span className="flex min-w-[220px] flex-1 items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block">{b.name}</span>
            <span className="block text-[13px]" style={{ color: late ? AMBER : MUTED }}>{when}{more ? `, ${more}` : ''}{late && Number(b.lateFee) > 0 ? `. A ${short(Number(b.lateFee))} late fee may apply.` : ''}</span>
          </span>
          <span className="shrink-0 pt-0.5 font-semibold tabular-nums">{usd(b.amount)}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {url && <a href={url} target="_blank" rel="noopener noreferrer" className={btn} style={plain}>Pay online</a>}
          <button type="button" onClick={() => { setWay('Bank Transfer'); setPaying(b); }} className={btn} style={late ? solid : plain} aria-label={`Mark ${b.name} paid`}>Mark paid</button>
        </span>
      </div>
    );
  };
  const group = (title: string, list: UnpaidBill[], late = false) => list.length > 0 && (
    <section aria-label={title} className={card} style={{ border: `1px solid ${LINE}` }}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[17px] font-semibold">{title}</h3>
        <span className="text-[14px] tabular-nums" style={{ color: late ? AMBER : MUTED }}>{list.length} {list.length === 1 ? 'bill' : 'bills'}, {usd(total(list))}</span>
      </div>
      <div className="mt-2">{list.map((b) => row(b, late))}</div>
    </section>
  );

  return (
    <div style={{ color: INK }}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[24px] font-semibold leading-tight">Bills</h2>
          <p className="text-[14px]" style={{ color: MUTED }}>Every unpaid bill, business and personal, by when it’s due. Mark one paid and it’s added to your books.</p>
        </div>
        <Link href="/financials" className={btn} style={plain}>Add or change bills</Link>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          {bills.length === 0 && (
            <section aria-label="All paid" className={`${card} pb-4`} style={{ border: `1px solid ${LINE}` }}>
              <h3 className="text-[17px] font-semibold">All paid</h3>
              <p className="text-[14px]" style={{ color: MUTED }}>No bills are waiting. New due dates show here as they come up.</p>
            </section>
          )}
          {group('Overdue', g.overdue, true)}
          {group('Due in the next 7 days', g.soon)}
          {group('Later', g.later)}
        </div>
        <div className="space-y-4">
          <section aria-label={`${month.label}’s bills`} className={card} style={{ border: `1px solid ${LINE}` }}>
            <h3 className="text-[17px] font-semibold">{month.label}’s bills</h3>
            <div className="mt-2">
              <div className="flex min-h-[44px] items-center justify-between gap-3" style={{ borderTop: `1px solid ${LINE}` }}><span>Due in {month.label}</span><span className="tabular-nums">{usd(month.due)}</span></div>
              <div className="flex min-h-[44px] items-center justify-between gap-3" style={{ borderTop: `1px solid ${LINE}` }}><span>Paid</span><span className="tabular-nums">{month.paid ? `−${usd(month.paid)}` : usd(0)}</span></div>
              {earlier > 0 && <div className="flex min-h-[44px] items-center justify-between gap-3" style={{ borderTop: `1px solid ${LINE}`, color: AMBER }}><span>Overdue from before {month.label}</span><span className="tabular-nums">{usd(earlier)}</span></div>}
              <div className="flex min-h-[44px] items-center justify-between gap-3 font-semibold" style={{ borderTop: `1px solid ${INK}` }}><span>Still to pay</span>
                <span className="tabular-nums" style={{ color: stillToPay > 0 ? INK : GREEN }}>{usd(stillToPay)}</span></div>
            </div>
          </section>
          <section aria-label="Paid lately" className={card} style={{ border: `1px solid ${LINE}` }}>
            <h3 className="text-[17px] font-semibold">Paid lately</h3>
            <div className="mt-2">
              {paid.length === 0 && <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>Nothing paid in the last 30 days.</p>}
              {paid.slice(0, showPaid).map((b) => (
                <div key={b.id} className="flex min-h-[44px] items-center justify-between gap-3 py-2" style={{ borderTop: `1px solid ${LINE}` }}>
                  <span className="min-w-0"><span className="block">{b.name}</span><span className="block text-[13px]" style={{ color: MUTED }}>Paid {day(b.paidOn)}</span></span>
                  <span className="shrink-0 tabular-nums">{usd(b.amount)}</span>
                </div>
              ))}
              {paid.length > showPaid && <button type="button" onClick={() => setShowPaid((n) => n + 10)} className={`${btn} my-2`} style={plain}>Show more</button>}
            </div>
          </section>
        </div>
      </div>

      {paying && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(22,23,26,0.35)] md:items-center md:p-6" onClick={close}>
          <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="pay-title" onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[440px] rounded-t-3xl bg-[#fff] p-5 focus:outline-none md:rounded-3xl" style={{ color: INK }}>
            <h3 id="pay-title" className="text-[19px] font-semibold">Mark {paying.name} paid</h3>
            <p className="mt-1 text-[14px]" style={{ color: MUTED }}>{usd(paying.amount)}, due {day(paying.due)}. It’s added to your {paying.personal ? 'personal' : 'business'} books as a cost, dated today.</p>
            <p className="mb-2 mt-4 text-[14px]" style={{ color: MUTED }}>How was it paid?</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="How was it paid">
              {PAY_WAYS.map(([v, l]) => (
                <button key={v} type="button" onClick={() => setWay(v)} aria-pressed={way === v} className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`}
                  style={way === v ? { background: INK, color: '#fff', fontWeight: 600 } : plain}>{l}</button>))}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={pay} disabled={busy} className={btn} style={solid}>{busy ? 'Marking it paid' : 'Mark paid'}</button>
              <button type="button" onClick={close} disabled={busy} className={btn} style={plain}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

