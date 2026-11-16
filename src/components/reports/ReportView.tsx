'use client';
// src/components/reports/ReportView.tsx — ONE REPORT, READ IN A MINUTE (lib/report-kit; design canvas "Food numbers": One
// report, read in a minute). The same six parts for every report: what it is, the numbers that matter, one picture, what's
// worth a look, the table with its totals, and how to read it. Print or save as PDF gives every row, with the business,
// the report and the page numbers at the foot and none of the app around it; the spreadsheet (CSV) has the same columns.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cellText, dollars, type Chart, type Report } from '@/lib/report-kit';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-[#fff] px-4 text-[13.5px] font-semibold disabled:opacity-50 ${RING}`;
// Bars: the ones the picture is about in ink, the rest a lighter grey, anything to fix amber (each named in the legend).
const FILL = { main: INK, soft: '#9a9ca2', warn: '#c76a1c' } as const;
const ROWS_SHOWN = 12;
const made = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** A round top for the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v: number): number {
  if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p; return 10 * p;
}
const axisWords = (v: number, money: boolean) => (money ? (v >= 1000 ? `$${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : `$${v.toLocaleString('en-US')}`) : v.toLocaleString('en-US'));

/** One series of bars from a baseline: thin bars, rounded at the top, a 2px gap between neighbors, a hairline grid, the
 *  value of each on hover. The table under it carries every number. */
export function BarChart({ chart }: { chart: Chart }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the width it's shown at, so its words stay readable on a phone.
  const box = useRef<HTMLDivElement | null>(null); const [W, setW] = useState(800);
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width)))); ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = W < 500 ? 180 : 220, L = 46, R = 8, TOP = 10, B = 26; const pw = W - L - R, ph = H - TOP - B;
  const n = chart.bars.length; const top = niceMax(Math.max(...chart.bars.map((b) => b.value), chart.avg?.value || 0));
  const slot = pw / Math.max(1, n); const bw = Math.min(24, Math.max(2, slot - 2));
  const y = (v: number) => TOP + ph - (Math.max(0, v) / top) * ph;
  const ticks = [0, top / 2, top];
  const bar = (i: number) => { const b = chart.bars[i]; const x = L + i * slot + (slot - bw) / 2; const h = Math.max(0, TOP + ph - y(b.value)); const r = Math.min(4, bw / 2, h);
    // Rounded at the data end, square at the baseline.
    return h <= 0 ? '' : `M${x},${TOP + ph}V${TOP + ph - h + r}Q${x},${TOP + ph - h} ${x + r},${TOP + ph - h}H${x + bw - r}Q${x + bw},${TOP + ph - h} ${x + bw},${TOP + ph - h + r}V${TOP + ph}Z`; };
  const total = chart.bars.reduce((s, b) => s + b.value, 0);
  const h = hover === null ? null : chart.bars[hover];
  return (
    <figure className="m-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <figcaption className="text-[15px] font-semibold">{chart.title}</figcaption>
        {(chart.legend?.length || chart.avg) && <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]" style={{ color: MUTED }}>
          {chart.legend?.map((l) => <span key={l.label} className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: FILL[l.tone] }} />{l.label}</span>)}
          {chart.avg && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block w-3.5" style={{ borderTop: `2px solid ${GREEN}` }} />{chart.avg.label}, {chart.money ? dollars(chart.avg.value, chart.avg.value < 1000) : chart.avg.value.toLocaleString('en-US')}</span>}
        </p>}
      </div>
      <div ref={box} className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${chart.title}: ${n} bars, ${chart.money ? dollars(total, false) : total.toLocaleString('en-US')} in all. Every value is in the table below.`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={LINE} strokeWidth={1} /><text x={L - 8} y={y(t) + 4} fontSize={11} fill={MUTED} textAnchor="end">{axisWords(t, chart.money)}</text></g>)}
          {chart.bars.map((b, i) => <path key={i} d={bar(i)} fill={FILL[b.tone]} opacity={hover === null || hover === i ? 1 : 0.55} />)}
          {chart.avg && <line x1={L} x2={W - R} y1={y(chart.avg.value)} y2={y(chart.avg.value)} stroke={GREEN} strokeWidth={1.5} />}
          {chart.bars.map((b, i) => (chart.days ? i % 7 === 0 : slot >= 44 || i % Math.ceil(44 / slot) === 0) && <text key={`l${i}`} x={L + i * slot + slot / 2} y={H - 8} fontSize={11} fill={MUTED} textAnchor="middle">{b.label}</text>)}
          {chart.bars.map((_, i) => <rect key={`h${i}`} x={L + i * slot} y={TOP} width={slot} height={ph} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        </svg>
        {h && hover !== null && <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold shadow-sm print:hidden"
          style={{ left: `${((L + hover * slot + slot / 2) / W) * 100}%`, background: INK, color: '#fff' }}>{h.tip || `${h.label}: ${chart.money ? dollars(h.value) : h.value}`}</div>}
      </div>
    </figure>
  );
}

export function ReportView({ report: r, onCsv, csvBusy, back, picker }: { report: Report; onCsv: () => void; csvBusy: boolean; back?: { href: string; label: string }; picker?: React.ReactNode }) {
  const [all, setAll] = useState(false);
  // A statement (the profit and loss) shows every line; a long list, the first dozen until asked.
  const shown = r.rowsShown || ROWS_SHOWN; const many = r.rows.length > shown;
  const kpiCols = r.kpis.length >= 5 ? 'lg:grid-cols-5' : r.kpis.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4';
  const right = (k: string) => k === 'money' || k === 'price' || k === 'count' || k === 'num' || k === 'pct';
  // The page's foot, in the printout's CSS: letters, numbers and plain punctuation only, so no name can end the style or
  // the string it sits in.
  const foot = `${r.business ? `${r.business}, ` : ''}${r.title}`.replace(/[^\p{L}\p{N} .,'&()-]/gu, '').slice(0, 140);
  return (
    <div id="report" className="min-h-dvh print:min-h-0" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <style>{`@media print {
        [data-sidebar], .group.peer, header { display: none !important; }
        html, body, main { background: #fff !important; }
        #report { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        #report section { break-inside: avoid; box-shadow: none; }
        #report tr { break-inside: avoid; }
        @page { size: letter; margin: 0.55in 0.5in 0.7in; @bottom-left { content: "${foot}"; font-size: 9pt; color: #6d7075; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 9pt; color: #6d7075; } }
      }`}</style>
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 print:max-w-none print:space-y-3 print:p-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 print:hidden">
          {back ? <Link href={back.href} className={`inline-flex min-h-[44px] items-center text-[13.5px] font-semibold underline-offset-4 hover:underline ${RING}`} style={{ color: MUTED }}>{back.label}</Link> : <span />}
          <div className="flex flex-wrap items-center gap-2">
            {picker}
            <button type="button" onClick={() => window.print()} className={BTN} style={{ border: `1px solid ${LINE}` }}>Print or save as PDF</button>
            <button type="button" onClick={onCsv} disabled={csvBusy} className={`${BTN} text-[#fff]`} style={{ background: INK }}>{csvBusy ? 'Getting it…' : 'Download spreadsheet (CSV)'}</button>
          </div>
        </div>
        <div>
          <p className="hidden text-[12.5px] print:block" style={{ color: MUTED }}>{r.business}{r.business ? ', ' : ''}made {made(r.madeAt)}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">{r.title}</h1>
          <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed"><b className="font-semibold">What this is:</b> <span style={{ color: MUTED }}>{r.what}</span></p>
        </div>

        <section aria-label="The numbers that matter" className={`grid grid-cols-2 gap-3 ${kpiCols} ${r.kpis.length >= 5 ? 'print:grid-cols-5' : r.kpis.length === 3 ? 'print:grid-cols-3' : 'print:grid-cols-4'}`}>
          {r.kpis.map((k) => (
            <div key={k.label} className="rounded-2xl border px-4 py-3.5" style={k.tone === 'warn' ? { background: '#fffaf3', borderColor: '#f3dcc2' } : { background: '#fff', borderColor: LINE }}>
              <p className="text-[12.5px] font-medium" style={{ color: MUTED }}>{k.label}</p>
              <p className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-tight sm:text-[26px]" style={{ color: k.tone === 'warn' ? AMBER : INK }}>{k.value}</p>
              {k.note && <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: MUTED }}>{k.tone === 'ok' && /^(Up|Over)/.test(k.note) ? <><b className="font-semibold" style={{ color: GREEN }}>{k.note.split('. ')[0]}.</b>{k.note.slice(k.note.split('. ')[0].length + 1)}</> : k.note}</p>}
            </div>))}
        </section>

        <div className={`grid items-start gap-4 ${r.chart ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
          {r.chart && <section aria-label="The picture" className="rounded-3xl bg-[#fff] px-5 pb-3 pt-4"><BarChart chart={r.chart} /></section>}
          <section aria-labelledby="look-title" className="rounded-3xl bg-[#fff] px-5 pb-4 pt-4">
            <h2 id="look-title" className="text-[15px] font-semibold">Worth a look</h2>
            <ul className="mt-2 space-y-2">
              {r.notes.map((n, i) => (
                <li key={i} className="rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-snug" style={n.tone === 'warn' ? { background: AMBER_TINT, color: AMBER } : { background: SOFT }}>
                  {n.text}{n.href && <> <Link href={n.href} className={`font-semibold underline underline-offset-4 print:no-underline ${RING}`}>{n.link || 'Open'}</Link>.</>}
                </li>))}
            </ul>
          </section>
        </div>

        <section aria-labelledby="detail-title" className="rounded-3xl bg-[#fff] px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="detail-title" className="text-[15px] font-semibold">In detail</h2>
            {many && <p className="text-[12.5px] print:hidden" style={{ color: MUTED }}>{all ? `All ${r.rows.length} rows.` : `The first ${shown} of ${r.rows.length}. The spreadsheet and the printout have them all.`}</p>}
          </div>
          {r.rows.length === 0 ? <p className="py-3 text-[14px]" style={{ color: MUTED }}>{r.empty}</p> : (
            <div className="relative mt-1 overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[640px] text-[12.5px] tabular-nums print:min-w-0 print:text-[9.5px]">
                <thead><tr>{r.columns.map((c) => <th key={c.label} scope="col" className={`whitespace-nowrap border-b px-2 py-2 font-semibold first:pl-0 ${right(c.kind) ? 'text-right' : 'text-left'}`} style={{ color: MUTED, borderColor: LINE }}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {r.rows.map((row, i) => (
                    <tr key={i} className={`${!all && i >= shown ? 'hidden print:table-row' : ''} ${r.strong?.includes(i) ? 'font-semibold' : ''}`}>
                      {row.map((v, j) => { const c = r.columns[j]; const neg = typeof v === 'number' && v < 0;
                        return <td key={j} className={`border-b px-2 py-1.5 first:pl-0 ${right(c.kind) ? 'whitespace-nowrap text-right' : 'text-left'}`} style={{ borderColor: '#f3f3f5', color: neg || v === 'Not yet' || v === 'No' ? AMBER : INK }}>{cellText(c, v)}</td>; })}
                    </tr>))}
                  {r.totals && <tr className="font-semibold">{r.totals.map((v, j) => <td key={j} className={`px-2 py-2 first:pl-0 ${right(r.columns[j].kind) ? 'whitespace-nowrap text-right' : 'text-left'}`} style={{ color: typeof v === 'number' && v < 0 ? AMBER : INK }}>{cellText(r.columns[j], v)}</td>)}</tr>}
                </tbody>
              </table>
            </div>)}
          {many && <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className={`mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold underline underline-offset-4 print:hidden ${RING}`}>{all ? `Show the first ${shown}` : `Show all ${r.rows.length}`}</button>}
        </section>

        <section aria-labelledby="read-title" className="pb-2">
          <h2 id="read-title" className="sr-only">How to read it</h2>
          <dl className="grid gap-x-6 gap-y-2 text-[12.5px] leading-relaxed sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-2">
            {[...r.glossary, ['The spreadsheet', 'has these columns, one row each, as plain numbers with no $ signs, so it adds up in Excel or Google Sheets.'] as [string, string]].map(([t, d]) => (
              <div key={t}><dt className="inline font-semibold">{t}</dt> <dd className="inline" style={{ color: MUTED }}>{d}</dd></div>))}
          </dl>
        </section>
      </div>
    </div>
  );
}

