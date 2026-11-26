'use client';
// src/components/money/MoneyOverview.tsx — THE MONEY OVERVIEW, read like a statement (design board "Money in the app's
// look", option A). The period's profit with each day's sales, then the statement itself (lib/books-summary, the same
// reading as the printed Profit and Loss): sales, what came off them, net sales, tips, each kind of cost, profit. Beside
// it: what needs you (bank lines to sort, checks paid but never closed, bills due, lines without a category, sales tax
// due), what's held and never yours (sales tax, gift cards, renters' money), and the latest lines in the books. The
// page's own cards (closing a month, app payouts, miles and the rest) follow, passed in as `more`.
import * as React from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { readDatedRange, useTransactionsInRange } from '@/hooks/use-transactions';
import { booksSummary, lookupOf, netSalesOf, normalizeLine } from '@/lib/books-summary';
import { staffAuthHeader } from '@/lib/staff-fetch';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', AMBER = '#b45309';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const usd = (n: number) => `$${Math.abs(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n < 0 ? '−' : ''}${usd(n)}`;
type Preset = 'thisMonth' | 'lastMonth' | 'thisYear';
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayLabel = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

/** The period: its first moment to its last (the whole month or year, as the printed reports read it), and what it's
 *  called. "So far" ends today. */
function rangeOf(p: Preset, now: Date): { from: Date; to: Date; label: string; title: string } {
  if (p === 'lastMonth') { const from = new Date(now.getFullYear(), now.getMonth() - 1, 1); const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { from, to, label: `${MONTHS[from.getMonth()]} ${from.getFullYear()}`, title: `Profit in ${MONTHS[from.getMonth()]}` }; }
  if (p === 'thisYear') { const from = new Date(now.getFullYear(), 0, 1); return { from, to: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999), label: `January 1 to ${dayLabel(now)}`, title: 'Profit so far this year' }; }
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from, to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999), label: `${dayLabel(from)} to ${now.getDate()}`, title: 'Profit so far this month' };
}

function Row({ label, value, sub, strong, tone }: { label: React.ReactNode; value: string; sub?: boolean; strong?: boolean; tone?: string }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-4" style={{ borderTop: `1px solid ${strong ? INK : LINE}`, paddingLeft: sub ? 16 : 0, color: sub ? MUTED : INK, fontWeight: strong ? 600 : 400 }}>
      <span>{label}</span><span className="tabular-nums" style={tone ? { color: tone } : undefined}>{value}</span>
    </div>
  );
}

type Need = { key: string; title: string; detail: string; tone?: 'amber'; onClick?: () => void; href?: string };

export function MoneyOverview({ onNavigate, more, bankCount = null }: { onNavigate: (tab: string) => void; more?: React.ReactNode; bankCount?: number | null }) {
  const { firestore } = useFirebase() as any;
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id as string | undefined;
  const { billDefinitions, billInstances } = useInventory() as any;
  const [preset, setPreset] = React.useState<Preset>('thisMonth');
  // (Now moves on: every few minutes and when the page is looked at again, so today and the month stay current.)
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const tick = () => setNow((was) => { const n = new Date(); return n.toDateString() === was.toDateString() && n.getTime() - was.getTime() < 300000 ? was : n; });
    const id = window.setInterval(tick, 300000); const vis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, []);
  const r = React.useMemo(() => rangeOf(preset, now), [preset, now]);
  // A month live; a whole year read once (it's long), again when the day changes.
  const live = useTransactionsInRange(preset === 'thisYear' ? null : r.from, preset === 'thisYear' ? null : new Date(r.to.getTime() + 1));
  const [yearLines, setYearLines] = React.useState<any[] | null>(null); const [yearErr, setYearErr] = React.useState(false); const [yearTry, setYearTry] = React.useState(0);
  const dayKey = now.toDateString();
  React.useEffect(() => {
    if (preset !== 'thisYear' || !firestore || !tenantId) return; let on = true; setYearLines(null);
    setYearErr(false);
    readDatedRange(firestore, tenantId, 'transactions', 'date', r.from, new Date(r.to.getTime() + 1)).then((l) => { if (on) setYearLines(l); }).catch(() => { if (on) setYearErr(true); });
    return () => { on = false; };
  }, [preset, firestore, tenantId, dayKey, yearTry]); // eslint-disable-line react-hooks/exhaustive-deps
  const raw = preset === 'thisYear' ? (yearLines || []) : live.transactions;
  const isLoading = preset === 'thisYear' ? yearLines === null && !yearErr : live.isLoading;
  const lines = React.useMemo(() => (raw || []).map((t: any) => normalizeLine(t)), [raw]);
  const s = React.useMemo(() => booksSummary(lines, { lookup: lines, businessOnly: true }), [lines]);
  const byId = React.useMemo(() => lookupOf(lines), [lines]);
  // (This month: the same days of last month, read once a day through the matching day, and cut at this time of day
  // here, so the comparison moves with the clock without reading again.)
  const [prevLines, setPrevLines] = React.useState<any[] | null>(null);
  const prevFrom = React.useMemo(() => new Date(now.getFullYear(), now.getMonth() - 1, 1), [now]);
  React.useEffect(() => {
    if (preset !== 'thisMonth' || !firestore || !tenantId) { setPrevLines(null); return; } let on = true;
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const to = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), lastDay) + 1);
    readDatedRange(firestore, tenantId, 'transactions', 'date', prevFrom, to).then((l) => { if (on) setPrevLines(l.map((t: any) => normalizeLine(t))); }).catch(() => { if (on) setPrevLines(null); });
    return () => { on = false; };
  }, [preset, firestore, tenantId, dayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevNet = React.useMemo(() => {
    if (!prevLines) return null;
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const cut = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), lastDay), now.getHours(), now.getMinutes()).getTime();
    const upTo = prevLines.filter((t: any) => new Date(t.date).getTime() < cut);
    return booksSummary(upTo, { lookup: prevLines, businessOnly: true }).net;
  }, [prevLines, now]);

  // Each day's net sales, for the bars: each from one midnight to the next, the business's own lines.
  const days = React.useMemo(() => {
    if (preset === 'thisYear') return [] as { label: string; v: number }[];
    const out: { label: string; v: number }[] = []; const end = dayStart(preset === 'lastMonth' ? r.to : now);
    const biz = lines.filter((t: any) => String(t.context) !== 'Personal');
    for (let d = dayStart(r.from); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const k = d.getTime(); const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      out.push({ label: dayLabel(d), v: biz.filter((t: any) => { const x = new Date(t.date).getTime(); return x >= k && x < n; }).reduce((a: number, t: any) => a + netSalesOf(t, byId), 0) });
    }
    return out;
  }, [lines, r, preset, byId, now]);
  const maxDay = Math.max(1, ...days.map((d) => d.v));

  // Costs: what the team was paid on its own line, the rest together, biggest first.
  const opex = s.byCategory.opex; const isPay = (c: string) => /^(payroll|contract labor|team pay|wages)/i.test(c);
  const teamPay = opex.filter(([c]) => isPay(c)).reduce((a, [, v]) => a + v, 0);
  const others = opex.filter(([c]) => !isPay(c)); const otherTotal = others.reduce((a, [, v]) => a + v, 0);
  const otherWords = others.slice(0, 4).map(([c, v]) => `${c.toLowerCase()} ${usd(v)}`).join(', ') + (others.length > 4 ? ` and ${others.length - 4} more` : '');

  // What needs you.
  const [openChecks, setOpenChecks] = React.useState<{ name: string; cents: number }[]>([]);
  const [taxDue, setTaxDue] = React.useState<string | null>(null);
  const [taxOpen, setTaxOpen] = React.useState<{ label: string; due: string; toPay: number } | null>(null);
  const [payroll, setPayroll] = React.useState<{ gross: number; from: Date; to: Date } | null>(null);
  React.useEffect(() => {
    if (!firestore || !tenantId) return; let on = true;
    getDocs(query(collection(firestore, 'tenants', tenantId, 'pendingCheckouts'), where('status', 'in', ['partial', 'paid_waiting']))).then((q: any) => {
      if (!on) return;
      const taken = (pc: any) => String(pc.status) === 'paid_waiting' ? Math.round(Number(pc.paidCents) || 0) : Math.round((Array.isArray(pc.tenders) ? pc.tenders : []).filter((x: any) => x && !x.refundedAt).reduce((n: number, x: any) => n + (Number(x.amount) || 0) + (Number(x.tip) || 0), 0) * 100);
      setOpenChecks(q.docs.map((d: any) => d.data() || {}).filter((pc: any) => taken(pc) > 0).map((pc: any) => ({ name: String(pc.tableName ? `Table ${pc.tableName}` : pc.clientName || 'A check'), cents: taken(pc) })));
    }).catch(() => {});
    // (A payroll worked out and waiting to be approved: managers only, so for anyone else it's left out.)
    getDocs(query(collection(firestore, 'tenants', tenantId, 'payrollDrafts'), where('status', '==', 'pending'), limit(1))).then((q: any) => {
      const d = q.docs[0]?.data(); if (on) setPayroll(d ? { gross: Number(d.grossTotal) || 0, from: new Date(d.periodStart), to: new Date(d.periodEnd) } : null);
    }).catch(() => {});
    // (Sales tax: the reminder while it shows, and what the last period that ended still owes, from its filing report, in
    // one light call: api/money/sales-tax status.)
    (async () => {
      const call = async (action: string) => { const res = await fetch('/api/money/sales-tax', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, action }) }); return res.json().catch(() => null); };
      try { const d = await call('status'); if (!on) return; setTaxDue(d?.ok && d.reminder ? String(d.reminder.text) : null);
        setTaxOpen(d?.ok && d.owed ? { label: String(d.owed.label), due: String(d.owed.due), toPay: Number(d.owed.cents) / 100 } : null); } catch { /* shown next time */ }
    })();
    return () => { on = false; };
  }, [firestore, tenantId, dayKey]);
  const bills = React.useMemo(() => {
    const today = dayStart(now); const week = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 8);
    const unpaid = (billInstances || []).filter((i: any) => i.status !== 'paid').map((i: any) => ({ def: (billDefinitions || []).find((d: any) => d.id === i.billDefinitionId), due: new Date(i.dueDate) })).filter((x: any) => x.def);
    const sum = (l: any[]) => l.reduce((a: number, x: any) => a + (Number(x.def.amount) || 0), 0);
    const overdue = unpaid.filter((x: any) => x.due < today); const soon = unpaid.filter((x: any) => x.due >= today && x.due < week);
    return { overdue: overdue.length, overdueTotal: sum(overdue), soon: soon.length, soonTotal: sum(soon), next: soon.sort((a: any, b: any) => a.due.getTime() - b.due.getTime())[0] || null };
  }, [billInstances, billDefinitions, now]);
  const needs: Need[] = [
    ...(bankCount ? [{ key: 'bank', title: `${bankCount} bank line${bankCount === 1 ? '' : 's'} to sort`, detail: 'Each has a category picked', onClick: () => onNavigate('bank') }] : []),
    ...openChecks.slice(0, 3).map((c, i) => ({ key: `chk${i}`, title: `${c.name} paid ${usd(c.cents / 100)}`, detail: 'Never closed, so it isn’t in your sales yet', tone: 'amber' as const, href: '/pos' })),
    ...(openChecks.length > 3 ? [{ key: 'chkmore', title: `${openChecks.length - 3} more check${openChecks.length - 3 === 1 ? '' : 's'} paid but never closed`, detail: 'Close them at the front desk', tone: 'amber' as const, href: '/pos' }] : []),
    ...(payroll ? [{ key: 'payroll', title: `Payroll ready to approve, ${usd(payroll.gross)}`, detail: `For ${dayLabel(payroll.from)} to ${payroll.to.getMonth() === payroll.from.getMonth() ? payroll.to.getDate() : dayLabel(payroll.to)}`, onClick: () => onNavigate('payday') }] : []),
    ...(bills.overdue ? [{ key: 'billsover', title: `${bills.overdue} bill${bills.overdue === 1 ? '' : 's'} overdue, ${usd(bills.overdueTotal)}`, detail: bills.overdue === 1 ? 'Pay it or mark it paid' : 'Pay them or mark them paid', tone: 'amber' as const, onClick: () => onNavigate('bills') }] : []),
    ...(bills.soon ? [{ key: 'billssoon', title: bills.soon === 1 && bills.next ? `${bills.next.def.name || 'A bill'}, ${usd(Number(bills.next.def.amount) || 0)}` : `${bills.soon} bills due this week, ${usd(bills.soonTotal)}`,
      detail: bills.next ? `${bills.soon === 1 ? 'Due' : 'The next is due'} ${dayLabel(bills.next.due)}` : 'Due this week', onClick: () => onNavigate('bills') }] : []),
    ...(s.unsorted.count && !(preset === 'thisYear' && yearErr) ? [{ key: 'unsorted', title: `${s.unsorted.count} line${s.unsorted.count === 1 ? '' : 's'} without a category`, detail: `${usd(s.unsorted.amount)} waiting to be sorted`, onClick: () => onNavigate('ledger') }] : []),
    ...(taxDue ? [{ key: 'tax', title: taxDue, detail: 'Its report has what your return asks for', href: '/settings?tab=payments#sales-tax' }] : []),
  ];

  // (Newest first, by the moment: the lines' dates are times. Up to the end of today: never a line dated later.)
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const recent = React.useMemo(() => [...lines].filter((t: any) => String(t.context) !== 'Personal' && new Date(t.date).getTime() < endToday).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5), [lines, endToday]);
  const whenOf = (v: any) => { const d = dayStart(new Date(v)); const t = dayStart(now); const diff = Math.round((t.getTime() - d.getTime()) / 86400000); return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };
  const diff = prevNet === null || isLoading ? null : s.net - prevNet;
  // (A failed read of the year: nothing on the page pretends the books are empty.)
  const failed = preset === 'thisYear' && yearErr;
  const periodWord = preset === 'thisYear' ? 'this year' : preset === 'lastMonth' ? `in ${MONTHS[r.from.getMonth()]}` : 'this month';

  const card = 'rounded-3xl bg-[#fff]';
  const cardStyle = { border: `1px solid ${LINE}`, color: INK };
  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-5 md:px-6" style={{ color: INK }}>
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="text-[30px] font-semibold leading-tight md:text-[34px]" style={{ letterSpacing: '-0.02em' }}>Money</h1>
          <p className="mt-1 text-[14px]" style={{ color: MUTED }}>{r.label}</p>
        </div>
        <div role="group" aria-label="Period" className="flex flex-wrap gap-1.5">
          {([['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['thisYear', 'This year']] as [Preset, string][]).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={preset === v} onClick={() => setPreset(v)} className={`min-h-[44px] rounded-full px-4 text-[14px] ${RING}`}
              style={preset === v ? { background: INK, color: '#fff', fontWeight: 600, border: `1px solid ${INK}` } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{l}</button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="pl-h" className={`${card} p-5 md:p-6`} style={cardStyle}>
          <h2 id="pl-h" className="text-[14px] font-medium" style={{ color: MUTED }}>{r.title}</h2>
          <p className="mt-0.5 text-[40px] font-semibold leading-tight tabular-nums" style={{ letterSpacing: '-0.025em' }}>{isLoading || failed ? '…' : signed(s.net)}</p>
          {diff !== null && <p className="mt-1 text-[14px] font-medium" style={{ color: diff >= 0 ? GREEN : AMBER }}>{usd(diff)} {diff >= 0 ? 'more' : 'less'} than this point in {MONTHS[prevFrom.getMonth()]}</p>}
          {days.length > 0 && (
            <div className="mt-4 flex h-[72px] items-end justify-between gap-[3px]" role="img" aria-label={`Net sales each day, ${r.label}`}>
              {days.map((d, i) => <span key={i} title={`${d.label}: ${usd(d.v)}`} className="rounded-[3px]" style={{ flex: '0 1 8px', height: `${Math.max(3, (d.v / maxDay) * 100)}%`, background: i === days.length - 1 && preset === 'thisMonth' ? INK : '#d7d8dc' }} />)}
            </div>
          )}
          {failed ? <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
              <p className="text-[14px]" style={{ color: AMBER }}>Your books for this year couldn’t be added up just now. Check your connection and try again.</p>
              <button type="button" onClick={() => setYearTry((n) => n + 1)} className={`min-h-[44px] rounded-full bg-[#fff] px-4 text-[14px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}` }}>Try again</button></div>
            : isLoading ? <p className="mt-4 py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>Adding up your books</p> : <div className="mt-4 text-[15px]">
            <Row label="Sales" value={usd(s.sales)} />
            {s.returns ? <Row label="Refunds and returns" value={signed(-s.returns)} sub /> : null}
            {s.discounts ? <Row label="Discounts and deposits used" value={signed(-s.discounts)} sub /> : null}
            <Row label="Net sales" value={signed(s.netSales)} strong />
            {s.tips ? <Row label="Tips for the team" value={usd(s.tips)} /> : null}
            {s.otherIncome ? <Row label="Other income" value={signed(s.otherIncome)} /> : null}
            {s.cogs ? <Row label="Cost of goods" value={signed(-s.cogs)} /> : null}
            {s.netFees ? <Row label="Card fees" value={signed(-s.netFees)} /> : null}
            {teamPay ? <Row label="Team pay" value={signed(-teamPay)} /> : null}
            {otherTotal ? (
              <details className="group" style={{ borderTop: `1px solid ${LINE}` }}>
                <summary className={`flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-4 ${RING}`}><span className="inline-flex items-center gap-1.5">Other costs<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition-transform group-open:rotate-180"><path d="M6 9l6 6 6-6" /></svg></span><span className="tabular-nums">{signed(-otherTotal)}</span></summary>
                <p className="pb-3 text-[14px]" style={{ color: MUTED }}>{otherWords.charAt(0).toUpperCase() + otherWords.slice(1)}</p>
              </details>
            ) : null}
            <Row label="Profit" value={signed(s.net)} strong />
          </div>}
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="needs-h" className={`${card} px-5 pb-2 pt-4`} style={cardStyle}>
            <h2 id="needs-h" className="mb-1 text-[17px] font-semibold">Needs you</h2>
            {needs.length === 0 && !isLoading && !failed && <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>Nothing right now. Everything’s sorted.</p>}
            {needs.map((n) => {
              const body = (<>
                <span className="min-w-0"><span className="block">{n.title}</span><span className="block text-[13px]" style={{ color: n.tone === 'amber' ? AMBER : MUTED }}>{n.detail}</span></span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M9 6l6 6-6 6" /></svg>
              </>);
              const cls = `flex min-h-[56px] w-full items-center justify-between gap-3 text-left ${RING}`;
              return n.href ? <a key={n.key} href={n.href} className={cls} style={{ borderTop: `1px solid ${LINE}`, color: INK, textDecoration: 'none' }}>{body}</a>
                : <button key={n.key} type="button" onClick={n.onClick} className={cls} style={{ borderTop: `1px solid ${LINE}`, background: 'transparent' }}>{body}</button>;
            })}
          </section>

          <section aria-labelledby="held-h" className={`${card} px-5 pb-2 pt-4`} style={cardStyle}>
            <h2 id="held-h" className="text-[17px] font-semibold">Held, not yours</h2>
            <p className="mb-1 text-[13px]" style={{ color: MUTED }}>Never counted as income</p>
            {failed ? <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>Shown once your books for this year are added up.</p> : <div className="text-[15px]">
              <Row label={`Sales tax collected, ${periodWord}`} value={usd(s.taxOwed)} />
              {s.taxPaid ? <Row label={`Paid to the state, ${periodWord}`} value={usd(s.taxPaid)} /> : null}
              {taxOpen && <Row label={`Owed for ${taxOpen.label}, due ${taxOpen.due}`} value={usd(taxOpen.toPay)} strong />}
              {s.giftCardsSold ? <Row label="Gift cards sold" value={usd(s.giftCardsSold)} /> : null}
              {s.heldForRenters ? <Row label="Taken for renters" value={usd(s.heldForRenters)} /> : null}
            </div>}
          </section>

          <section aria-labelledby="recent-h" className={`${card} px-5 pb-2 pt-4`} style={cardStyle}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 id="recent-h" className="text-[17px] font-semibold">Latest in your books</h2>
              <button type="button" onClick={() => onNavigate('ledger')} className={`min-h-[44px] rounded-full px-2 text-[14px] font-semibold underline underline-offset-2 ${RING}`}>See everything</button>
            </div>
            {recent.length === 0 && !isLoading && !failed && <p className="py-3 text-[14px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}` }}>Nothing in your books for {r.label} yet.</p>}
            {recent.map((t: any) => {
              const income = String(t.type) === 'income';
              return (
                <div key={t.id} className="flex min-h-[58px] items-center justify-between gap-3" style={{ borderTop: `1px solid ${LINE}` }}>
                  <span className="min-w-0"><span className="block truncate">{String(t.description || t.clientOrVendor || t.category || 'A line')}</span>
                    <span className="block truncate text-[13px]" style={{ color: MUTED }}>{String(t.category || 'No category')}{t.paymentMethod ? `, ${String(t.paymentMethod).toLowerCase()}` : ''}</span></span>
                  <span className="shrink-0 text-right"><span className="block font-semibold tabular-nums" style={{ color: income ? GREEN : INK }}>{income ? '+' : '−'}{usd(Number(t.amount) || 0)}</span>
                    <span className="block text-[13px]" style={{ color: MUTED }}>{whenOf(t.date)}</span></span>
                </div>
              );
            })}
          </section>
        </div>
      </div>

      {more && <div className="mt-5 flex flex-col gap-5">{more}</div>}
    </div>
  );
}
