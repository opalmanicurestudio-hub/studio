'use client';
// src/app/(app)/records/page.tsx — RECORDS (design canvas "Food numbers": Records; lib/records, api/records). For
// managers: what the accountant, a payroll check or the IRS asks for, a month at a time, nothing to hunt for. Money
// (each night's close, sales tax, profit and loss, gift cards owed), people (hours, payroll, tips by person, the cash tips
// each person declared, tips against sales) and stock (the shelf's value, purchases by supplier, food cost, comps and
// voids by person); each one downloaded as a spreadsheet, or opened where it lives. What's still to finish for the
// month is said at the top.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { monthWords, recentMonths } from '@/lib/records';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-[#fff] px-3.5 text-[13.5px] font-semibold disabled:opacity-50 ${RING}`;
const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whole = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const cents = (c: number) => money(c / 100);
const md = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(iso.length === 10 ? { timeZone: 'UTC' } : {}) });
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

type Person = { staffId: string; name: string; chargedCents: number; cashCents: number; shareCents: number; declared: { cashCents: number; paidOutCents: number; signedName: string; signedAt: string; changed?: boolean } | null; due: boolean };
type R = {
  month: string; today: string; days: number; business: string; hospitality: boolean; partial?: boolean;
  nights: { day: string; closed: boolean; count: number; sales: number; tax: number }[]; closes: { closed: number; open: string[] };
  sales: { total: number; tax: number; tips: number; refunds: number };
  tips: { people: Person[]; chargedCents: number; cashCents: number; declaredCashCents: number; mode: string; check: { sales: number; reported: number; pct: number | null; shortfall: number; under: boolean } };
  stock: { now: number; nowTypical: number; kept: { total: number; at: string; by: string; auto: boolean } | null; lines: number; keepable: boolean };
  purchases: { list: { at: string; supplier: string; number: string; total: number; invoice: boolean }[]; bySupplier: { supplier: string; count: number; total: number; invoices: number }[]; total: number };
  adjustments: { name: string; comps: number; compCount: number; voids: number; voidCount: number; remakes: number }[];
};

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'plain'; children: React.ReactNode }) {
  return <span className="inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold" style={tone === 'ok' ? { background: GREEN_TINT, color: GREEN } : tone === 'warn' ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: INK }}>{children}</span>;
}

export default function RecordsPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [month, setMonth] = useState<string>('');
  const [r, setR] = useState<R | null>(null); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); const [said, setSaid] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return; setLoading(true);
    const d = await post({ tenantId, action: 'month', ...(month ? { month } : {}) }); setLoading(false);
    if (d.ok) { setR(d); setErr(''); if (!month) setMonth(d.month); } else setErr(d.error || 'That didn’t load. Try again.');
  }, [tenantId, month]);
  useEffect(() => { void load(); }, [load]);

  const download = async (kind: string) => {
    if (!tenantId || !r) return; setBusy(kind); setErr('');
    const d = await post({ tenantId, action: 'csv', month: r.month, kind }); setBusy(null);
    if (!d.ok) { setErr(d.error || 'That didn’t download. Try again.'); return; }
    try {
      const url = URL.createObjectURL(new Blob([d.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = d.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setErr('That didn’t download. Try again.'); }
  };
  const keepStock = async () => {
    if (!tenantId || !r) return; setBusy('keep'); setErr(''); setSaid('');
    const d = await post({ tenantId, action: 'keepStock', month: r.month }); setBusy(null);
    if (!d.ok) { setErr(d.error || 'That didn’t save.'); return; }
    setSaid(`${money(d.total)} kept as ${monthWords(r.month)}’s stock value.`); void load();
  };

  const months = r ? recentMonths(r.today) : [];
  const words = r ? monthWords(r.month) : '';
  const current = r ? r.month === r.today.slice(0, 7) : false;
  const notDeclared = r ? r.tips.people.filter((p) => p.due && !p.declared) : [];
  const declared = r ? r.tips.people.filter((p) => p.declared) : [];
  const finish: string[] = [];
  if (r) {
    if (r.hospitality && r.closes.open.length) finish.push(`${r.closes.open.length === 1 ? 'One night wasn’t' : `${r.closes.open.length} nights weren’t`} closed (${list(r.closes.open.map(md))})`);
    if (notDeclared.length && !current) finish.push(`${notDeclared.length === 1 ? `${notDeclared[0].name} hasn’t` : `${notDeclared.length} people haven’t`} declared their cash tips`);
    if (!current && !r.stock.kept) finish.push('no stock value was kept for the month');
  }
  // Render helpers (plain functions, so nothing is remounted on a re-render and focus stays where it was).
  const dlBtn = (kind: string) => <button type="button" onClick={() => void download(kind)} disabled={busy === kind} className={BTN} style={{ border: `1px solid ${LINE}` }}>{busy === kind ? 'Getting it…' : 'Download'}</button>;
  const openBtn = (href: string) => <Link href={href} className={BTN} style={{ border: `1px solid ${LINE}` }}>Open</Link>;
  const moreBtn = (id: string, label: string) => (
    <button type="button" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id} className={`mt-0.5 inline-flex min-h-[44px] items-center text-[13px] font-semibold underline underline-offset-4 ${RING}`} style={{ color: INK }}>{open === id ? 'Hide' : label}</button>);
  const row = (key: string, x: { name: string; pill?: React.ReactNode; sub: React.ReactNode; action?: React.ReactNode; more?: React.ReactNode }) => (
    <li key={key} className="border-t py-2.5" style={{ borderColor: LINE }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-semibold">{x.name}{x.pill}</p>
          <div className="mt-0.5 text-[13px] leading-snug" style={{ color: MUTED }}>{x.sub}</div>
        </div>
        {x.action}
      </div>
      {x.more}
    </li>);

  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Records</h1>
            <p className="max-w-2xl text-[15px]" style={{ color: MUTED }}>What your accountant, a payroll check or the IRS asks for, a month at a time. Download each one as a spreadsheet, or open it where it lives.</p>
          </div>
          {r && (
            <label className="block"><span className="sr-only">Which month</span>
              <select value={r.month} onChange={(e) => { setMonth(e.target.value); setOpen(null); setSaid(''); }} className={`min-h-[44px] rounded-full border-0 px-4 text-[14.5px] font-semibold ${RING}`} style={{ background: INK, color: '#fff' }}>
                {months.map((m) => <option key={m} value={m}>{monthWords(m)}</option>)}
              </select></label>
          )}
        </header>
        {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {said && <p role="status" className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: GREEN_TINT, color: GREEN }}>{said}</p>}
        {!r ? <div className="h-48 rounded-3xl bg-[#fff]" aria-busy="true" /> : (<>
          {r.partial && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{words} has more sales than are read at once, so some totals here may be low. The nightly file has each night in full.</p>}
          {finish.length > 0
            ? <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}><b className="font-semibold">To finish for {words}:</b> {list(finish)}.</p>
            : !current && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: GREEN_TINT, color: GREEN }}>Everything for {words} is in.</p>}
          <div className="grid items-start gap-4 lg:grid-cols-3" aria-busy={loading}>

            <section aria-labelledby="money-title" className="rounded-3xl bg-[#fff] px-5 pb-2 pt-4">
              <h2 id="money-title" className="text-[17px] font-semibold">Money</h2>
              <p className="text-[13px]" style={{ color: MUTED }}>For the accountant and the tax returns.</p>
              <ul className="mt-2">
                {row('r1', { name: r.hospitality ? 'Nightly closes' : 'Sales by day', pill: r.hospitality ? <Pill tone={r.closes.open.length ? 'warn' : 'ok'}>{r.closes.closed} of {r.days} closed</Pill> : undefined, sub: <>{whole(r.sales.total)} in sales{r.sales.refunds ? `, ${whole(r.sales.refunds)} refunded` : ''}. Sales, tax, tips, comps, voids and the drawers, day by day.</>, more: r.closes.open.length > 0 ? <p className="text-[13px]" style={{ color: AMBER }}>Not closed: {list(r.closes.open.map(md))}.</p> : null, action: dlBtn('nights') })}
                {row('r2', { name: "Sales tax", sub: <>{money(r.sales.tax)} collected on {whole(r.sales.total)} of sales. Each day’s is in the nightly file.</>, action: dlBtn('nights') })}
                {row('r3', { name: "Profit and loss", sub: "In Money: pick the month, then Reports, for profit and loss and the tax summary.", action: openBtn('/money') })}
                {row('r4', { name: "Gift cards owed", sub: "What’s still on cards, sold and used, and cards unused for two years.", action: openBtn('/gift-cards/report') })}
              </ul>
            </section>

            <section aria-labelledby="people-title" className="rounded-3xl bg-[#fff] px-5 pb-2 pt-4">
              <h2 id="people-title" className="text-[17px] font-semibold">People</h2>
              <p className="text-[13px]" style={{ color: MUTED }}>Hours, pay and tips, kept the way wage law and the IRS ask.</p>
              <ul className="mt-2">
                {row('r5', { name: "Hours worked", sub: "Hours, overtime and breaks from the time clock, with a spreadsheet download there.", action: openBtn('/timesheets') })}
                {row('r6', { name: "Payroll register", sub: "In Money: pick the month, then Reports.", action: openBtn('/money') })}
                {row('r7', { name: "Tips by person", sub: <>{cents(r.tips.chargedCents)} on cards, {cents(r.tips.cashCents)} in cash as the till has it{r.tips.mode !== 'direct' ? ', and how they were shared' : ''}.</>, action: dlBtn('tips') })}
                {row('r8', { name: "Cash tips declared", pill: r.tips.people.some((p) => p.due) ? <Pill tone={notDeclared.length ? 'warn' : 'ok'}>{declared.length} of {r.tips.people.filter((p) => p.due || p.declared).length}</Pill> : undefined, sub: <>Anyone making $20 or more a month in cash tips reports them to you in writing by the 10th of the next month. Each person declares and signs on their phone, under Pay; this keeps the signed copy.</>, more: r.tips.people.length ? <>
                    {moreBtn('declared', `See who${notDeclared.length ? `, ${notDeclared.length} not yet` : ''}`)}
                    {open === 'declared' && <ul className="mb-2 mt-1 space-y-1 text-[13.5px]">{r.tips.people.map((p) => <li key={p.staffId} className="flex justify-between gap-3"><span>{p.name}</span><span className="tabular-nums" style={{ color: p.declared ? INK : AMBER }}>{p.declared ? `${cents(p.declared.cashCents)}, signed ${md(p.declared.signedAt)}${p.declared.changed ? ', changed' : ''}` : 'Not yet'}</span></li>)}</ul>}
                  </> : null, action: dlBtn('declared') })}
                {r.hospitality && row('r9', { name: "Tips against sales", pill: r.tips.check.pct !== null ? <Pill tone={r.tips.check.under ? 'warn' : 'ok'}>{(r.tips.check.pct * 100).toFixed(1)}%</Pill> : undefined, sub: r.tips.check.pct === null ? 'No sales yet this month.' : r.tips.check.under
                      ? <>{money(r.tips.check.shortfall)} short of 8% of {whole(r.tips.check.sales)} in food and drink sales (cash tips count once each person declares them). If you file the IRS’s Form 8027 (tipping is usual and you normally have more than 10 people on a day), your accountant allocates it among those tipped directly.</>
                      : <>Over 8% of {whole(r.tips.check.sales)} in food and drink sales, so there’s nothing to allocate. Kept for the IRS’s Form 8027 if you normally have more than 10 people on a day.</> })}
              </ul>
            </section>

            <section aria-labelledby="stock-title" className="rounded-3xl bg-[#fff] px-5 pb-2 pt-4">
              <h2 id="stock-title" className="text-[17px] font-semibold">Stock</h2>
              <p className="text-[13px]" style={{ color: MUTED }}>What you bought, what’s on the shelf, and where it went.</p>
              <ul className="mt-2">
                {row('r10', { name: current ? 'Stock value now' : `Stock value, end of ${words}`, pill: !current && !r.stock.kept ? <Pill tone="warn">Not kept</Pill> : undefined, sub: r.stock.kept
                    ? <>{money(r.stock.kept.total)} on the shelf at what you pay, kept {md(r.stock.kept.at)}{r.stock.kept.auto ? ', automatically' : ` by ${r.stock.kept.by}`}. Your accountant needs this for cost of goods sold.</>
                    : <>{money(r.stock.now)} on the shelf now, at what you pay{r.stock.nowTypical > 0 ? ` (${whole(r.stock.nowTypical)} of it at typical prices)` : ''}. {current ? 'Count at month end, then keep it as the month’s value; otherwise it’s kept automatically on the 1st.' : 'Nothing was kept for this month.'}</>, more: r.stock.keepable ? <button type="button" onClick={() => void keepStock()} disabled={busy === 'keep'} className={`mt-0.5 inline-flex min-h-[44px] items-center text-[13px] font-semibold underline underline-offset-4 disabled:opacity-50 ${RING}`}>{busy === 'keep' ? 'Keeping it…' : current ? `Keep today’s as ${words}’s value` : `Keep today’s shelf, as of ${md(r.today)}, for ${words}`}</button> : null, action: dlBtn('stock') })}
                {row('r11', { name: 'Orders received, by supplier', sub: r.purchases.list.length ? <>{money(r.purchases.total)} on {r.purchases.list.length} {r.purchases.list.length === 1 ? 'order' : 'orders'} from {r.purchases.bySupplier.length} {r.purchases.bySupplier.length === 1 ? 'supplier' : 'suppliers'}{r.purchases.list.some((p) => p.invoice) ? `, ${r.purchases.list.filter((p) => p.invoice).length} with the invoice attached` : ''}. Stock received without an order is on each item’s history.</> : 'No orders received this month. Orders put away on the Ordering page show here.', more: r.purchases.bySupplier.length ? <>
                    {moreBtn('suppliers', 'See by supplier')}
                    {open === 'suppliers' && <ul className="mb-2 mt-1 space-y-1 text-[13.5px]">{r.purchases.bySupplier.map((s) => <li key={s.supplier} className="flex justify-between gap-3"><span>{s.supplier}<span style={{ color: MUTED }}>, {s.count}</span></span><span className="tabular-nums">{money(s.total)}</span></li>)}</ul>}
                  </> : null, action: dlBtn('purchases') })}
                {r.hospitality && row('r12', { name: 'Food cost', sub: 'What the food and drink sold cost to make, waste, counts and staff meals.', action: openBtn('/food-cost') })}
                {r.hospitality && row('r12b', { name: 'Food safety logs', sub: 'Temperature logs, certificates and permits, service dates, the allergen chart and incidents, for the inspector.', action: openBtn('/binder') })}
                {row('r13', { name: "Comps and voids by person", sub: r.adjustments.length ? <>{money(r.adjustments.reduce((s, a) => s + a.comps, 0))} comped and {money(r.adjustments.reduce((s, a) => s + a.voids, 0))} voided this month{r.adjustments[0] && r.adjustments.length > 1 ? `; ${r.adjustments[0].name} the most` : ''}.</> : 'None this month.', more: r.adjustments.length ? <>
                    {moreBtn('adjust', 'See by person')}
                    {open === 'adjust' && <ul className="mb-2 mt-1 space-y-1 text-[13.5px]">{r.adjustments.map((a) => <li key={a.name} className="flex justify-between gap-3"><span>{a.name}</span><span className="tabular-nums">{money(a.comps)} comped, {money(a.voids)} voided</span></li>)}</ul>}
                  </> : null, action: dlBtn('adjustments') })}
              </ul>
            </section>
          </div>
          <p className="text-[13px]" style={{ color: MUTED }}>Federal wage law asks for payroll records to be kept at least 3 years and time cards 2; your state and your accountant may want longer. Download each month and keep it with your books.</p>
        </>)}
      </div>
    </div>
  );
}
