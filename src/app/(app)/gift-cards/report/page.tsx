'use client';
// src/app/(app)/gift-cards/report/page.tsx — THE GIFT CARD MONEY REPORT (/api/gift-cards action 'report'). For the owner
// and the accountant: by month, what was sold, brought in from another app, used, corrected and cancelled, and what's still
// owed to clients at the end of each month; balances nobody has touched in a year or more; a spreadsheet to download.
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', AMBER = '#b45309';
const card = { background: 'hsl(var(--card))', border: `1px solid ${LINE}`, borderRadius: 18 } as const;
const $ = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (ym: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

export default function GiftCardReportPage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { if (tenantId && isManager) payPost('/api/gift-cards', { tenantId, action: 'report' }).then((r) => setD(r.ok ? r : { months: [], owedNow: 0, idle: null })); }, [tenantId, isManager]);
  if (!isManager) return <div className="p-6"><AppHeader title="Gift card report" /><p className="mt-6" style={{ color: MUTED }}>This report is for managers.</p></div>;
  const csv = () => {
    const rows = [['Month', 'Sold', 'Cards sold', 'Brought in', 'Used', 'Corrected', 'Cancelled', 'Owed at month end'], ...(d?.months || []).map((r: any) => [label(r.month), r.sold / 100, r.soldCount, r.imported / 100, r.used / 100, r.adjusted / 100, r.voided / 100, r.owedEnd / 100])];
    const blob = new Blob([rows.map((r) => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gift-cards-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); };
  const idle = d?.idle;
  return (
    <div className="min-h-screen" style={{ color: INK, backgroundColor: 'hsl(var(--background))' }}>
      <AppHeader title="Gift card report" />
      <main className="mx-auto max-w-5xl space-y-4 p-4 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}><a href="/gift-cards" className="hover:underline">gift cards</a> · report</p><h1 className="text-[34px] font-normal tracking-[-0.03em]">Gift card money</h1></div>
          <button type="button" disabled={!d?.months?.length} onClick={csv} className="inline-flex h-11 items-center rounded-full px-5 text-[14px] font-medium text-background disabled:opacity-40" style={{ background: INK }}>Download for your accountant</button></div>
        {!d ? <p style={{ color: MUTED }}>Loading…</p> : <>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="p-4" style={card}><p className="text-[26px] font-normal tracking-[-0.03em]">{$(d.owedNow)}</p><p className="text-[13px]" style={{ color: MUTED }}>owed on cards now</p></div>
            {idle && ([['y1', '1–2 years'], ['y2', '2–3 years'], ['y3', '3+ years']] as const).map(([k, l]) => <div key={k} className="p-4" style={card}><p className="text-[26px] font-normal tracking-[-0.03em]" style={{ color: k === 'y3' && idle[k].cents > 0 ? AMBER : INK }}>{$(idle[k].cents)}</p><p className="text-[13px]" style={{ color: MUTED }}>untouched {l} · {idle[k].n} card{idle[k].n === 1 ? '' : 's'}</p></div>)}
          </div>
          {d.gifted && d.gifted.recipients > 0 && <div className="space-y-3 p-5" style={card}>
            <p className="text-[15px] font-semibold">New clients from gift cards</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[[String(d.gifted.recipients), 'people used a gift someone gave them'], [String(d.gifted.newClients), 'were new to you'], [String(d.gifted.cameBack), `came back after (${d.gifted.laterVisits} visit${d.gifted.laterVisits === 1 ? '' : 's'})`], [$(d.gifted.laterSpendCents), 'spent on those later visits']].map(([n, l]) => <div key={l}><p className="text-[24px] font-normal tracking-[-0.03em]">{n}</p><p className="text-[13px]" style={{ color: MUTED }}>{l}</p></div>)}</div>
            <p className="text-[12.5px]" style={{ color: MUTED }}>Counted from completed visits. “New to you” means no visit before the one they used the card on.</p></div>}
          {(d.offers || []).length > 0 && <div className="space-y-3 p-5" style={card}>
            <p className="text-[15px] font-semibold">Offers</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[14px]"><thead><tr className="text-left text-[12px]" style={{ color: MUTED }}>{['Offer', 'Gift cards sold with it', 'Bonus given', 'Bonus used', 'Still to use', 'Ended unused'].map((h, i) => <th key={h} className={`py-2 pr-3 font-normal ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>{d.offers.map((o: any) => <tr key={o.id} style={{ borderTop: `1px solid ${LINE}` }}><td className="py-3 pr-3">{o.name}</td><td className="py-3 pr-3 text-right">{$(o.soldCents)}<span className="block text-[11.5px]" style={{ color: MUTED }}>{o.cardsSold} card{o.cardsSold === 1 ? '' : 's'}</span></td><td className="py-3 pr-3 text-right">{$(o.bonusCents)}</td><td className="py-3 pr-3 text-right">{$(o.usedCents)}</td><td className="py-3 pr-3 text-right">{$(o.leftCents)}</td><td className="py-3 text-right">{$(o.endedCents)}</td></tr>)}</tbody></table></div>
            <p className="text-[12.5px]" style={{ color: MUTED }}>What an offer cost you is the bonus used — it shows in your books as a discount. Bonus cards aren’t in “owed”: nobody paid for them.</p></div>}
          <div className="overflow-x-auto" style={card}>
            <table className="w-full min-w-[720px] text-[14px]"><thead><tr className="text-left text-[12px]" style={{ color: MUTED }}>{['Month', 'Sold', 'Brought in', 'Used', 'Corrected', 'Cancelled', 'Owed at month end'].map((h, i) => <th key={h} className={`px-4 py-3 font-normal ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>{d.months.length ? d.months.map((r: any) => <tr key={r.month} style={{ borderTop: `1px solid ${LINE}` }}><td className="px-4 py-3">{label(r.month)}</td><td className="px-4 py-3 text-right">{$(r.sold)}{r.soldCount ? <span className="block text-[11.5px]" style={{ color: MUTED }}>{r.soldCount} card{r.soldCount === 1 ? '' : 's'}</span> : null}</td><td className="px-4 py-3 text-right">{r.imported ? $(r.imported) : '—'}</td><td className="px-4 py-3 text-right">{$(r.used)}</td><td className="px-4 py-3 text-right">{r.adjusted ? $(r.adjusted) : '—'}</td><td className="px-4 py-3 text-right">{r.voided ? $(r.voided) : '—'}</td><td className="px-4 py-3 text-right font-semibold">{$(r.owedEnd)}</td></tr>)
                : <tr><td colSpan={7} className="px-4 py-6" style={{ color: MUTED }}>No gift cards yet.</td></tr>}</tbody></table>
          </div>
          <div className="space-y-2 p-5 text-[14px] leading-relaxed" style={card}>
            <p><b>How to read this.</b> Money for a gift card is held for the client when it’s sold, and becomes a sale when it’s used — so “Sold” isn’t income yet, and “Used” is. “Owed at month end” is what clients could still spend.</p>
            <p style={{ color: MUTED }}>Many states treat gift card balances that go unused for several years as unclaimed property that may need reporting. Rules differ by state (and some exempt gift cards entirely) — share this report with your accountant, especially the 3+ year figure.</p>
          </div>
        </>}
      </main>
    </div>);
}
