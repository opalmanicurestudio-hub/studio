'use client';
// src/app/(app)/cases/report/page.tsx — THE MONTHLY MAKING IT RIGHT REPORT (lib/mir-report), for managers. Pick a month:
// how many cases and why, the causes, who they were about (counted fairly), the fixes given, what it cost, and how fast
// the team replied and closed — with last month alongside. Print it or download it for a spreadsheet.
import * as React from 'react';
import { collection, query, where, type Firestore } from 'firebase/firestore';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { monthReport, monthOf, monthLabel, prevMonth, fmtHours, fmtMoney, reportCsv, type MirReport } from '@/lib/mir-report';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f6', GREEN = '#1f6b3a', RED = '#b42318';

function Delta({ now, before, good = 'down', money = false }: { now: number; before: number; good?: 'down' | 'up'; money?: boolean }) {
  if (now === before) return <span className="text-[12.5px]" style={{ color: MUTED }}>Same as last month</span>;
  const up = now > before; const fine = good === 'up' ? up : !up; const d = Math.abs(now - before);
  return <span className="text-[12.5px] font-semibold" style={{ color: fine ? GREEN : RED }}>{up ? '▲' : '▼'} {money ? fmtMoney(d) : d} vs last month</span>;
}
function Tile({ n, label, children }: { n: React.ReactNode; label: string; children?: React.ReactNode }) {
  return <div className="rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}><p className="text-[28px] font-extrabold leading-none tracking-tight">{n}</p><p className="mt-1.5 text-[13.5px]" style={{ color: MUTED }}>{label}</p>{children && <div className="mt-1">{children}</div>}</div>;
}
function Bars({ title, rows, note }: { title: string; rows: { key: string; label: string; n: number }[]; note?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return <section className="rounded-[18px] border bg-white p-5" style={{ borderColor: LINE }}>
    <h2 className="text-[15px] font-bold">{title}</h2>
    {!rows.length ? <p className="mt-2 text-[14px]" style={{ color: MUTED }}>Nothing this month.</p> : <div className="mt-3 space-y-2.5">{rows.map((r) => <div key={r.key}>
      <div className="flex justify-between gap-3 text-[14px]"><span className="min-w-0 truncate">{r.label}</span><b>{r.n}</b></div>
      <div className="mt-1 h-2 rounded-full" style={{ background: SOFT }}><div className="h-2 rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: r.key === 'unmarked' || r.key === 'open' ? '#c9cacd' : INK }} /></div></div>)}</div>}
    {note && <p className="mt-3 text-[12.5px]" style={{ color: MUTED }}>{note}</p>}
  </section>;
}

export default function MirReportPage() {
  const { firestore } = useFirebase() as any; const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase()); const tz = selectedTenant?.timezone || 'America/New_York';
  const cQ = useMemoFirebase(() => (firestore && tenantId && isManager ? collection(firestore as Firestore, `tenants/${tenantId}/cases`) : null), [firestore, tenantId, isManager]);
  const { data: cases, isLoading } = useCollection<any>(cQ);
  const aQ = useMemoFirebase(() => (firestore && tenantId && isManager ? query(collection(firestore as Firestore, `tenants/${tenantId}/payAdjustments`), where('by', '==', 'making_it_right')) : null), [firestore, tenantId, isManager]);
  const { data: adj } = useCollection<any>(aQ);
  const thisMonth = monthOf(new Date().toISOString(), tz);
  const months = React.useMemo(() => { const s = new Set<string>([thisMonth]); for (const c of cases || []) { const m = monthOf(c.createdAt, tz); if (m) s.add(m); } return [...s].sort().reverse(); }, [cases, tz, thisMonth]);
  const [ym, setYm] = React.useState('');
  React.useEffect(() => { const q = new URLSearchParams(window.location.search).get('month'); if (q && /^\d{4}-\d{2}$/.test(q)) setYm(q); }, []);
  const month = ym || thisMonth;
  const r: MirReport = React.useMemo(() => monthReport(cases || [], month, tz, adj || []), [cases, month, tz, adj]);
  const p: MirReport = React.useMemo(() => monthReport(cases || [], prevMonth(month), tz, adj || []), [cases, month, tz, adj]);
  const csv = () => { const blob = new Blob([reportCsv(r)], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `making-it-right-${month}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };

  if (!isManager) return <div className="p-6"><AppHeader title="Making it right report" /><p className="mt-6" style={{ color: MUTED }}>The report is for managers.</p></div>;
  const partial = month === thisMonth;
  return (
    <div className="min-h-screen bg-[#fafafa]" style={{ color: INK }}>
      <style>{`@media print { body * { visibility: hidden !important; } .mir-report, .mir-report * { visibility: visible !important; } .mir-report { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; } .no-print { display: none !important; } section, .tile { break-inside: avoid; } }`}</style>
      <div className="no-print"><AppHeader title="Making it right report" /></div>
      <main className="mir-report mx-auto max-w-5xl space-y-5 p-4 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><a href="/cases" className="no-print text-[14px] font-semibold" style={{ color: MUTED }}>‹ Cases</a>
            <h1 className="text-[26px] font-extrabold tracking-tight">{monthLabel(month)}</h1>
            <p className="text-[14px]" style={{ color: MUTED }}>{selectedTenant?.name || ''} · Making it right{partial ? ' · so far this month' : ''}</p></div>
          <div className="no-print flex flex-wrap gap-2">
            <select value={month} onChange={(e) => setYm(e.target.value)} aria-label="Month" className="h-11 rounded-full border bg-white px-4 text-[14.5px] font-semibold" style={{ borderColor: LINE }}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
            <button type="button" onClick={() => window.print()} className="h-11 rounded-full border bg-white px-5 text-[14.5px] font-semibold" style={{ borderColor: LINE }}>Print</button>
            <button type="button" onClick={csv} className="h-11 rounded-full px-5 text-[14.5px] font-semibold text-white" style={{ background: INK }}>Download CSV</button>
          </div>
        </div>
        {isLoading ? <p style={{ color: MUTED }}>Loading…</p> : <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile n={r.total} label="Cases"><Delta now={r.total} before={p.total} /></Tile>
            <Tile n={r.total ? `${r.madeRight} of ${r.closed}` : '—'} label="Closed with the client saying it’s right" />
            <Tile n={fmtHours(r.replyMedianH)} label="Typical first reply">{r.lateReplies > 0 && <span className="text-[12.5px] font-semibold" style={{ color: RED }}>{r.lateReplies} late</span>}</Tile>
            <Tile n={fmtHours(r.closeMedianH)} label="Typical time to close">{r.open > 0 && <span className="text-[12.5px]" style={{ color: MUTED }}>{r.open} still open</span>}</Tile>
          </div>
          {(r.incidents > 0 || r.safety > 0 || r.reopened > 0) && <p className="rounded-[18px] p-4 text-[14px]" style={{ background: '#fff7e6' }}>{[r.safety ? `${r.safety} safety report${r.safety === 1 ? '' : 's'}` : '', r.incidents ? `${r.incidents} incident${r.incidents === 1 ? '' : 's'}` : '', r.reopened ? `${r.reopened} reopened after the fix` : ''].filter(Boolean).join(' · ')}.</p>}

          <section className="rounded-[18px] border bg-white p-5" style={{ borderColor: LINE }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-[15px] font-bold">What it cost</h2><Delta now={r.cost.total} before={p.cost.total} money /></div>
            <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
              {[[r.cost.refund, 'Refunded'], [r.cost.credit, 'Credit given'], [r.cost.redo, 'Free redos (what they’d paid)'], [r.cost.total, 'Total']].map(([v, l]) => <div key={String(l)}><p className={`text-[22px] tracking-tight ${l === 'Total' ? 'font-extrabold' : 'font-bold'}`}>{fmtMoney(Number(v))}</p><p className="text-[13px]" style={{ color: MUTED }}>{l}</p></div>)}
            </div>
            {r.cost.pay !== 0 && <p className="mt-3 text-[13px]" style={{ color: MUTED }}>Pay corrections from your redo and refund rules: <b style={{ color: INK }}>{r.cost.pay > 0 ? '+' : '−'}{fmtMoney(Math.abs(r.cost.pay))}</b> (on pay stubs).</p>}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <Bars title="Why clients weren’t happy" rows={r.byReason} />
            <Bars title="What caused it" rows={r.byCause} note={r.unmarked ? `${r.unmarked} case${r.unmarked === 1 ? '' : 's'} still need a cause — mark it on the case so provider numbers are fair.` : 'Marked by a manager on each case.'} />
            <Bars title="How it was made right" rows={r.byFix} />
            <section className="rounded-[18px] border bg-white p-5" style={{ borderColor: LINE }}>
              <h2 className="text-[15px] font-bold">By provider</h2>
              {!r.byProvider.length ? <p className="mt-2 text-[14px]" style={{ color: MUTED }}>Nothing this month.</p> : <table className="mt-3 w-full text-[14px]"><thead><tr className="text-left text-[12px]" style={{ color: MUTED }}><th className="pb-2 font-semibold">Provider</th><th className="pb-2 text-right font-semibold">The work</th><th className="pb-2 text-right font-semibold">All cases</th><th className="pb-2 text-right font-semibold">To mark</th></tr></thead>
                <tbody>{r.byProvider.map((x) => <tr key={x.id} className="border-t" style={{ borderColor: LINE }}><td className="py-2 pr-2">{x.name}{x.incidents ? <span className="ml-1 text-[12px]" style={{ color: MUTED }}>· {x.incidents} incident{x.incidents === 1 ? '' : 's'}</span> : null}</td><td className="py-2 text-right font-bold">{x.counted}</td><td className="py-2 text-right">{x.total}</td><td className="py-2 text-right" style={{ color: x.unmarked ? INK : MUTED }}>{x.unmarked || '—'}</td></tr>)}</tbody></table>}
              <p className="mt-3 text-[12.5px]" style={{ color: MUTED }}>Only cases marked “the work itself” count against a provider. Product, aftercare, normal wear and misunderstandings don’t.</p>
            </section>
          </div>
          <p className="text-[12px]" style={{ color: MUTED }}>Cases are counted in the month they were opened. Renters’ own clients aren’t included.</p>
        </>}
      </main>
    </div>);
}
