'use client';
// src/components/cases/MirReportView.tsx — THE MONTHLY MAKING IT RIGHT REPORT (lib/mir-report), for managers. Pick a month:
// how many cases (with the last five months alongside), how many were made right, how fast the team replied and closed,
// what making it right cost, who the cases were about (counted fairly), why clients weren't happy, what caused it and how
// it was put right. Print it or download it for a spreadsheet. Layout follows the approved design (canvas row 6).
import * as React from 'react';
import { monthReport, monthOf, monthLabel, prevMonth, fmtHours, fmtMoney, reportCsv, caseCost, type MirReport } from '@/lib/mir-report';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318', GREY = '#c9cacd';
const BG = 'radial-gradient(120% 80% at 8% -5%, #e5e5ec 0%, transparent 55%), radial-gradient(100% 70% at 100% 0%, #e8eaf0 0%, transparent 50%), #f7f7f8';
const card = 'rounded-[18px] border bg-white';

const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 15)).toISOString().slice(0, 7); };
const monthName = (ym: string, short = false) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, 15)).toLocaleDateString('en-US', { month: short ? 'short' : 'long', timeZone: 'UTC' }); };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "▼ 3 vs August" — green when it moved the good way. */
function Delta({ now, before, vs, good = 'down', money = false }: { now: number; before: number; vs: string; good?: 'down' | 'up'; money?: boolean }) {
  if (now === before) return <span className="text-[12.5px] font-medium" style={{ color: MUTED }}>Same as {vs}</span>;
  const up = now > before; const fine = good === 'up' ? up : !up; const d = Math.abs(now - before);
  return <span className="text-[12.5px] font-medium tabular-nums" style={{ color: fine ? GREEN : RED }}>{up ? '▲' : '▼'} {money ? fmtMoney(d) : d} vs {vs}</span>;
}
function Tile({ n, label, children, aside }: { n: React.ReactNode; label: string; children?: React.ReactNode; aside?: React.ReactNode }) {
  return <div className={`${card} tile flex items-end justify-between gap-3 p-[18px]`} style={{ borderColor: LINE }}>
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-[30px] font-normal leading-none tracking-[-0.03em] tabular-nums md:text-[34px]">{n}</p>
      <p className="text-[13.5px]" style={{ color: MUTED }}>{label}</p>
      {children && <div className="text-[12.5px] font-medium">{children}</div>}
    </div>
    {aside}
  </div>;
}
/** The last five months' case counts; the chosen month is dark. */
function Spark({ rows, h, bw, gap }: { rows: { ym: string; n: number }[]; h: number; bw: number; gap: number }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return <div className="flex shrink-0 items-end" style={{ gap, height: h + 18 }} aria-label="Cases, last five months">
    {rows.map((r, i) => <div key={r.ym} className="flex flex-col items-center gap-1" title={`${monthLabel(r.ym)}: ${plural(r.n, 'case')}`}>
      <div className="rounded-[5px]" style={{ width: bw, height: Math.max(3, Math.round((r.n / max) * h)), background: i === rows.length - 1 ? INK : '#d6d7da' }} />
      <span className="text-[10.5px]" style={{ color: MUTED }}>{monthName(r.ym, true)}</span>
    </div>)}
  </div>;
}
function Bars({ title, rows, note }: { title: string; rows: { key: string; label: string; n: number }[]; note?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return <section className={`${card} flex flex-col gap-3 p-[18px] md:p-[22px]`} style={{ borderColor: LINE }}>
    <h2 className="text-[15px] font-bold">{title}</h2>
    {!rows.length ? <p className="text-[14px]" style={{ color: MUTED }}>Nothing this month.</p> : rows.map((r) => <div key={r.key} className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3 text-[14px]"><span className="min-w-0 truncate">{r.label}</span><b className="tabular-nums">{r.n}</b></div>
      <div className="h-2 rounded" style={{ background: SOFT }}><div className="h-2 rounded" style={{ width: `${Math.round((r.n / max) * 100)}%`, background: r.key === 'unmarked' || r.key === 'open' ? GREY : INK }} /></div>
    </div>)}
    {note && <p className="text-[12.5px] leading-snug" style={{ color: MUTED }}>{note}</p>}
  </section>;
}

export function MirReportView({ cases, adj, isLoading, tz, tenantName }: { cases: any[] | null | undefined; adj: any[] | null | undefined; isLoading?: boolean; tz: string; tenantName?: string }) {
  const thisMonth = monthOf(new Date().toISOString(), tz);
  const firstMonth = React.useMemo(() => { let f = thisMonth; for (const c of cases || []) { const m = monthOf(c.createdAt, tz); if (m && m < f) f = m; } return f; }, [cases, tz, thisMonth]);
  const [ym, setYm] = React.useState('');
  React.useEffect(() => { const q = new URLSearchParams(window.location.search).get('month'); if (q && /^\d{4}-\d{2}$/.test(q)) setYm(q); }, []);
  const month = ym && ym <= thisMonth ? ym : thisMonth;
  const go = (m: string) => { setYm(m); try { const u = new URL(window.location.href); u.searchParams.set('month', m); window.history.replaceState(null, '', u.toString()); } catch { /* fine */ } };
  const r: MirReport = React.useMemo(() => monthReport(cases || [], month, tz, adj || []), [cases, month, tz, adj]);
  const p: MirReport = React.useMemo(() => monthReport(cases || [], prevMonth(month), tz, adj || []), [cases, month, tz, adj]);
  const trend = React.useMemo(() => { const out: { ym: string; n: number }[] = []; let m = month; for (let i = 0; i < 5; i++) { out.unshift({ ym: m, n: monthReport(cases || [], m, tz).total }); m = prevMonth(m); } return out; }, [cases, month, tz]);
  const chips = React.useMemo(() => { const out: string[] = []; let m = thisMonth; for (let i = 0; i < 12 && m >= firstMonth; i++) { out.push(m); m = prevMonth(m); } if (!out.includes(month)) out.push(month); return out; }, [thisMonth, firstMonth, month]);
  const csv = () => { const blob = new Blob([reportCsv(r)], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `making-it-right-${month}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };

  const partial = month === thisMonth; const vs = monthName(prevMonth(month));
  // Fixes that cost something (a refund, credit or free redo) — "record it only" isn't one.
  const fixes = React.useMemo(() => (cases || []).filter((c) => !c.renterCase && c.kind !== 'incident' && monthOf(c.createdAt, tz) === month && (({ refund, credit, redo }) => refund + credit + redo > 0)(caseCost(c))).length, [cases, tz, month]);
  const pct = r.closed ? Math.round((r.madeRight / r.closed) * 100) : null;
  const segs = [{ l: 'Refunded', v: r.cost.refund, c: INK }, { l: 'Credit', v: r.cost.credit, c: MUTED }, { l: 'Free redos', v: r.cost.redo, c: GREY }];
  const flags = [r.safety ? plural(r.safety, 'safety report') : '', r.incidents ? plural(r.incidents, 'incident') : '', r.reopened ? `${r.reopened} reopened after the fix` : ''].filter(Boolean);

  const costBlock = <section className={`${card} flex flex-col gap-3.5 p-[18px] md:p-[22px]`} style={{ borderColor: LINE }}>
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-[15px] font-bold">What it cost to put right</h2><Delta now={r.cost.total} before={p.cost.total} vs={vs} money /></div>
    <div className="flex items-baseline gap-2.5"><p className="text-[36px] font-normal leading-none tracking-[-0.03em] tabular-nums md:text-[44px]">{fmtMoney(r.cost.total)}</p><p className="text-[13px]" style={{ color: MUTED }}>{fixes ? `across ${plural(fixes, 'fix', 'fixes')}` : 'nothing given this month'}</p></div>
    <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]" style={{ background: SOFT }}>
      {r.cost.total > 0 && segs.filter((s) => s.v > 0).map((s) => <div key={s.l} style={{ width: `${(s.v / r.cost.total) * 100}%`, background: s.c }} />)}
    </div>
    <div className="grid grid-cols-3 gap-2.5">{segs.map((s) => <div key={s.l} className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-[12.5px]" style={{ color: MUTED }}><span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: s.c }} />{s.l}</span>
      <b className="text-[16px] tabular-nums md:text-[18px]">{fmtMoney(s.v)}</b></div>)}</div>
    <p className="border-t pt-2.5 text-[12.5px]" style={{ borderColor: LINE, color: MUTED }}>
      {r.cost.pay !== 0 && <>Pay corrections from your redo rules: <b style={{ color: INK }}>{r.cost.pay > 0 ? '+' : '−'}{fmtMoney(Math.abs(r.cost.pay))}</b> on pay stubs · </>}Free redos counted at what the client paid
    </p>
  </section>;

  const provTable = <section className={`${card} flex flex-col p-[18px] md:p-[22px]`} style={{ borderColor: LINE }}>
    <h2 className="pb-3 text-[15px] font-bold">By provider</h2>
    {!r.byProvider.length ? <p className="text-[14px]" style={{ color: MUTED }}>Nothing this month.</p> : <>
      <div className="grid grid-cols-[1fr_52px_44px] pb-2 text-[11.5px] md:grid-cols-[1fr_70px_70px_70px]" style={{ color: MUTED }}><span>Provider</span><span className="text-right">The work</span><span className="text-right">All</span><span className="hidden text-right md:block">To mark</span></div>
      {r.byProvider.map((x) => <div key={x.id} className="grid grid-cols-[1fr_52px_44px] items-center border-t py-[11px] text-[14px] md:grid-cols-[1fr_70px_70px_70px]" style={{ borderColor: LINE }}>
        <div className="min-w-0"><p className="truncate font-medium">{x.name}</p>{x.incidents > 0 && <p className="text-[12px]" style={{ color: AMBER }}>{plural(x.incidents, 'incident')}</p>}</div>
        <b className="text-right tabular-nums">{x.counted}</b><span className="text-right tabular-nums" style={{ color: MUTED }}>{x.total}</span>
        <span className="hidden text-right tabular-nums md:block" style={{ color: x.unmarked ? INK : MUTED }}>{x.unmarked || '—'}</span>
      </div>)}
    </>}
    <p className="pt-3 text-[12px] leading-snug" style={{ color: MUTED }}>Only cases marked “the work itself” count against someone. Product, aftercare, normal wear and misunderstandings don’t.</p>
  </section>;

  return (
    <div className="min-h-screen" style={{ color: INK, background: BG, letterSpacing: '-0.01em' }}>
      <style>{`@media print { body * { visibility: hidden !important; } .mir-report, .mir-report * { visibility: visible !important; } .mir-report { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; } .no-print { display: none !important; } section, .tile { break-inside: avoid; } }`}</style>
      <nav className="no-print hidden h-[52px] items-center gap-2.5 border-b px-8 text-[14px] md:flex" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.6)' }}>
        <a href="/cases" style={{ color: MUTED }}>Cases</a><span style={{ color: MUTED }}>›</span><span className="font-medium">Monthly report</span>
      </nav>
      <main className="mir-report mx-auto flex max-w-[1200px] flex-col gap-3 px-5 pb-8 pt-5 md:gap-5 md:px-10 md:pb-10 md:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <a href="/cases" className="no-print mb-2.5 block text-[14px] md:hidden" style={{ color: MUTED }}>‹ Cases</a>
            <p className="text-[12px] lowercase tracking-[0.1em]" style={{ color: MUTED }}>making it right{tenantName ? <span className="hidden md:inline"> · {tenantName}</span> : null}{partial ? ' · so far' : ''}</p>
            <h1 className="mt-1 text-[32px] font-normal tracking-[-0.03em] md:text-[44px]"><span className="md:hidden">{monthName(month)}</span><span className="hidden md:inline">{monthLabel(month)}</span></h1>
          </div>
          <div className="no-print hidden items-center gap-2 md:flex">
            <div className="flex h-11 items-center overflow-hidden rounded-full border bg-white" style={{ borderColor: LINE }}>
              <button type="button" aria-label="Previous month" disabled={month <= firstMonth} onClick={() => go(prevMonth(month))} className="h-11 w-11 disabled:opacity-30" style={{ color: MUTED }}>‹</button>
              <span className="min-w-[96px] px-1.5 text-center text-[14px] font-medium">{monthName(month)}</span>
              <button type="button" aria-label="Next month" disabled={month >= thisMonth} onClick={() => go(nextMonth(month))} className="h-11 w-11 disabled:opacity-30" style={{ color: MUTED }}>›</button>
            </div>
            <button type="button" onClick={() => window.print()} className="h-11 rounded-full border bg-white px-5 text-[14px]" style={{ borderColor: LINE }}>Print</button>
            <button type="button" onClick={csv} className="h-11 rounded-full px-5 text-[14px] font-medium text-white" style={{ background: INK }}>Download CSV</button>
          </div>
        </div>
        <div className="no-print -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:hidden">
          {chips.map((m) => <button key={m} type="button" onClick={() => go(m)} className="h-9 shrink-0 rounded-full px-3.5 text-[13.5px]"
            style={m === month ? { background: INK, color: '#fff', fontWeight: 500 } : { background: '#fff', border: `1px solid ${LINE}` }}>{monthName(m, true)}{m.slice(0, 4) !== thisMonth.slice(0, 4) ? ` ’${m.slice(2, 4)}` : ''}</button>)}
        </div>

        {isLoading ? <p style={{ color: MUTED }}>Loading…</p> : <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-[1.25fr_1fr_1fr_1fr] md:gap-3.5">
            <Tile n={r.total} label="Cases" aside={<div className="hidden md:block"><Spark rows={trend} h={52} bw={16} gap={7} /></div>}><Delta now={r.total} before={p.total} vs={vs} /></Tile>
            <Tile n={r.closed ? <>{r.madeRight}<span className="text-[18px]" style={{ color: MUTED }}> of {r.closed}</span></> : '—'} label="Closed with the client saying it’s right">
              {pct !== null && <span style={{ color: pct >= 80 ? GREEN : AMBER }}>{pct}%</span>}
            </Tile>
            <Tile n={fmtHours(r.replyMedianH)} label="Typical first reply">
              {r.lateReplies > 0 ? <span style={{ color: RED }}>{r.lateReplies === 1 ? '1 reply was late' : `${r.lateReplies} replies were late`}</span> : r.total ? <span style={{ color: MUTED }}>All on time</span> : null}
            </Tile>
            <Tile n={fmtHours(r.closeMedianH)} label="Typical time to close">{r.open > 0 && <span style={{ color: MUTED }}>{r.open} still open</span>}</Tile>
          </div>

          {flags.length > 0 && <div className="flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-[14px]" style={{ background: '#fdf3e6', borderColor: '#f3dfc2' }}>
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ background: AMBER }}>!</span>
            <span><b>{flags.join(' · ')}.</b> <a href="/cases" className="no-print" style={{ color: MUTED }}>Open them from Cases.</a></span>
          </div>}

          <div className="grid gap-3 md:grid-cols-2 md:gap-3.5">
            {costBlock}
            <div className="hidden md:block [&>section]:h-full">{provTable}</div>
          </div>
          <div className="grid gap-3 md:grid-cols-3 md:gap-3.5">
            <Bars title="Why clients weren’t happy" rows={r.byReason} />
            <Bars title="What caused it" rows={r.byCause} note={r.unmarked ? `${plural(r.unmarked, 'case')} still need${r.unmarked === 1 ? 's' : ''} a cause — mark it on the case so provider numbers stay fair.` : undefined} />
            <Bars title="How it was made right" rows={r.byFix} />
          </div>
          <div className="md:hidden">{provTable}</div>
          <section className={`${card} flex flex-col gap-2.5 p-[18px] md:hidden`} style={{ borderColor: LINE }}>
            <h2 className="text-[15px] font-bold">Last 5 months</h2><Spark rows={trend} h={70} bw={40} gap={22} />
          </section>
          <button type="button" onClick={csv} className="no-print h-12 rounded-full text-[15px] font-medium text-white md:hidden" style={{ background: INK }}>Download CSV</button>
          <div className="flex flex-wrap justify-between gap-2 pt-1 text-[12px]" style={{ color: MUTED }}>
            <span>Cases count in the month they were opened. Renters’ own clients aren’t included.</span><span>Sent to owners and managers on the 1st</span>
          </div>
        </>}
      </main>
    </div>);
}
