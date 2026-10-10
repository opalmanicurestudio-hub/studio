'use client';
// src/components/pay/PayStubView.tsx — ONE PAY STUB, LINE BY LINE (the B look on screen, the C layout as the PDF). A
// header like the printed statement, a ring of where the money came from and how it compares with last period, then
// every part opening into its lines — each visit, sale, tip, shift and correction with how it was worked out — and the
// check that the lines add up to the total. Tap any line: its details and "Something's off" (PayQuestionSheet).
import * as React from 'react';
import { money, dshort, dlong, payGet, downloadStub, PART_COLORS, PART_LABEL } from '@/components/pay/pay-client';
import { PayQuestionSheet } from '@/components/pay/PayQuestion';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const FLAG = <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V4h11l-2 4 2 4H5" /></svg>;
const DL = <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>;

export function PayStubView({ tenantId, from, accent = INK, previousTotal, previousStats, onBack }: { tenantId: string; from: string; accent?: string; previousTotal?: number | null; previousStats?: any; onBack: () => void }) {
  const [stub, setStub] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const [openPart, setOpenPart] = React.useState<string | null>('services'); const [line, setLine] = React.useState<any>(null); const [ask, setAsk] = React.useState<any>(null);
  const [dl, setDl] = React.useState(false); const [sent, setSent] = React.useState(''); const [week, setWeek] = React.useState(0); const [dayPick, setDayPick] = React.useState<string | null>(null);
  React.useEffect(() => { (async () => { const r = await payGet(`/api/pay/stub?tenantId=${encodeURIComponent(tenantId)}&from=${from}`); if (r.ok) setStub(r.stub); else setErr(r.error || 'Couldn’t load this stub.'); })(); }, [tenantId, from]);

  const back = <button type="button" onClick={onBack} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: '#f4f4f5' }}>Back</button>;
  if (err) return <div className="space-y-3">{back}<p role="alert" className="rounded-[16px] px-4 py-3 text-[14px]" style={{ background: '#fdecec', color: '#b42318' }}>{err}</p></div>;
  if (!stub) return <div className="space-y-3">{back}<div className="h-[260px] animate-pulse rounded-[24px]" style={{ background: '#f6f6f7' }} /></div>;
  if (ask) return <PayQuestionSheet tenantId={tenantId} stub={stub} line={ask === 'general' ? null : ask} accent={accent} onClose={(ok) => { setAsk(null); setLine(null); if (ok) setSent('Sent to your manager. You’ll see where it’s at on your Pay tab.'); }} />;

  const a = stub.audit; const p = stub.period;
  const groups: { key: string; lines: any[]; total: number }[] = [
    { key: 'services', lines: a.visits, total: stub.parts.services }, { key: 'tips', lines: a.tips, total: stub.parts.tips }, { key: 'retail', lines: a.retail, total: stub.parts.retail },
    { key: 'time', lines: a.period.filter((x: any) => ['p:hourly', 'p:training', 'p:salary', 'p:ot', 'p:minwage'].includes(x.ref)), total: stub.parts.time },
    { key: 'other', lines: a.period.filter((x: any) => !['p:hourly', 'p:training', 'p:salary', 'p:ot', 'p:minwage'].includes(x.ref)), total: stub.parts.other },
    { key: 'adjustments', lines: a.adjustments, total: stub.parts.adjustments },
  ].filter((g) => g.lines.length || g.total);
  const diff = previousTotal != null ? stub.total - previousTotal : null;

  if (line) return (
    <div className="space-y-4" style={{ color: INK }}>
      <button type="button" onClick={() => setLine(null)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: '#f4f4f5' }}>Back to the stub</button>
      <div className="space-y-3 rounded-[24px] border p-4" style={{ borderColor: LINE }}>
        <p className="text-[13px]" style={{ color: MUTED }}>{line.date ? dlong(line.date) : `${dshort(p.from)} – ${dshort(p.to)}`}</p>
        <p className="text-[20px] font-extrabold leading-tight">{line.title}</p>
        <div className="rounded-[14px] px-3.5 py-3 text-[14px]" style={{ background: '#f6f6f7' }}><p className="text-[12px] font-bold" style={{ color: MUTED }}>How it was worked out</p><p>{line.detail}</p></div>
        {line.kind !== 'shift' && <div className="flex items-baseline justify-between"><span className="text-[14px]" style={{ color: MUTED }}>On this stub</span><span className="text-[26px] font-extrabold">{money(line.amount)}</span></div>}
      </div>
      <button type="button" onClick={() => setAsk(line)} className="flex h-12 w-full items-center justify-center gap-2 rounded-[16px] border text-[15px] font-semibold" style={{ borderColor: '#e6e6e8' }}>{FLAG}Something’s off with this</button>
    </div>);

  return (
    <div className="space-y-4" style={{ color: INK }}>
      <div className="flex items-center gap-2.5">{back}<p className="text-[18px] font-extrabold">{dshort(p.from)} – {dshort(p.to)}</p></div>
      {sent && <p role="status" className="rounded-[16px] px-4 py-3 text-[14px] font-semibold" style={{ background: `${accent}14`, color: accent }}>{sent}</p>}

      {(() => {
        // ── Stub D: the period on a brand card, with the days inside it ──
        const days: string[] = []; { let d = p.from; while (d <= p.to) { days.push(d); d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10); } }
        const weeks: string[][] = []; for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
        const wk = weeks[Math.min(week, weeks.length - 1)] || []; const byDay = a.byDay || {};
        const max = Math.max(1, ...days.map((d) => byDay[d] || 0)); const wkTotal = wk.reduce((x, d) => x + (byDay[d] || 0), 0);
        const visitsOn = (d: string) => a.visits.filter((l: any) => l.date === d && l.amount > 0).length;
        const st = stub.stats || {}; const ps = previousStats || {};
        const delta = (cur: any, prev: any, unit: '$' | 'pts') => cur == null || prev == null || cur === prev ? '' : `${cur > prev ? '▲' : '▼'} ${unit === '$' ? money(Math.abs(cur - prev)).replace(/\.00$/, '') : `${Math.abs(cur - prev)} pts`}`;
        const pill = (t: string) => <span key={t} className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ background: 'rgba(255,255,255,.18)' }}>{t}</span>;
        return (<>
          <section aria-label="Statement" className="overflow-hidden rounded-[26px] bg-white" style={{ boxShadow: '0 22px 44px -28px rgba(22,23,26,.5)', border: `1px solid ${LINE}` }}>
            <div className="relative space-y-1.5 overflow-hidden p-[18px] text-white" style={{ background: `linear-gradient(140deg, ${accent}, ${INK})` }}>
              <span aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full" style={{ background: 'rgba(255,255,255,.08)' }} />
              <div className="relative flex justify-between text-[12px] opacity-85"><span>{dshort(p.from)} – {dshort(p.to)}</span><span>{stub.paid ? `Paid ${dshort(p.payday)}` : `Payday ${dshort(p.payday)}`}{stub.frozen ? ' · final' : ''}</span></div>
              <p className="relative text-[42px] font-extrabold leading-none tracking-[-0.03em]">{money(stub.total)}</p>
              <div className="relative flex flex-wrap gap-1.5 pt-1">
                {diff != null && Math.abs(diff) >= 1 ? pill(`${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff)).replace(/\.\d\d$/, '')} vs last`) : null}
                {pill(`${stub.visits} visit${stub.visits === 1 ? '' : 's'}`)}
                {st.rebookPct != null ? pill(`${st.rebookPct}% rebooked`) : null}
                {!stub.paid ? pill('still adding up') : null}
              </div>
            </div>
            {days.length > 0 && (
              <div className="space-y-2 p-3.5">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-extrabold">{weeks.length > 1 ? `Week of ${dshort(wk[0])}` : 'Your days'}</span>
                  <span className="flex items-center gap-1.5"><span style={{ color: MUTED }}>{money(wkTotal).replace(/\.\d\d$/, '')}</span>
                    {weeks.length > 1 && weeks.map((_, i) => <button key={i} type="button" aria-label={`Week ${i + 1}`} aria-pressed={i === week} onClick={() => setWeek(i)} className="h-6 min-w-6 rounded-full px-2 text-[11px] font-bold" style={i === week ? { background: INK, color: '#fff' } : { background: '#f4f4f5', color: MUTED }}>{i + 1}</button>)}</span>
                </div>
                {wk.map((d) => { const v = byDay[d] || 0; const n = visitsOn(d); return (
                  <button key={d} type="button" onClick={() => { if (!v) return; setDayPick(dayPick === d ? null : d); setOpenPart('services'); }} aria-pressed={dayPick === d} className="flex w-full items-center gap-3 text-left">
                    <span className="w-9 text-[12px] font-bold" style={{ color: MUTED }}>{new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
                    <span className="relative h-[26px] flex-1 overflow-hidden rounded-[8px]" style={{ background: '#f4f4f5' }}>
                      {v > 0 && <span className="absolute inset-y-0 left-0 rounded-[8px]" style={{ width: `${Math.max(8, (v / max) * 100)}%`, background: accent }} />}
                      <span className="absolute left-2.5 top-[5px] text-[12px] font-bold" style={{ color: v > 0 && v / max > 0.35 ? '#fff' : MUTED }}>{v > 0 ? `${n} visit${n === 1 ? '' : 's'}` : 'off'}</span>
                    </span>
                    <span className="w-14 text-right text-[14px] font-extrabold tabular-nums">{v ? money(v).replace(/\.\d\d$/, '') : '—'}</span>
                  </button>); })}
              </div>)}
          </section>
          {/* ── Stub E's tiles: the numbers behind the money ── */}
          <section aria-label="Your numbers" className="grid grid-cols-2 gap-2">
            {[['Average visit', st.avgVisit != null ? money(st.avgVisit).replace(/\.00$/, '') : '—', delta(st.avgVisit, ps.avgVisit, '$')],
              ['Rebooked', st.rebookPct != null ? `${st.rebookPct}%` : '—', delta(st.rebookPct, ps.rebookPct, 'pts')],
              ['Retail per visit', st.retailPerVisit != null ? money(st.retailPerVisit) : '—', delta(st.retailPerVisit, ps.retailPerVisit, '$')],
              ['Hours', `${stub.hours} h`, stub.overtimeHours ? `${stub.overtimeHours} h overtime` : '']].map(([k, v, d]: any) => (
              <div key={k} className="space-y-0.5 rounded-[18px] border p-3" style={{ borderColor: LINE }}>
                <p className="text-[12px]" style={{ color: MUTED }}>{k}</p><p className="text-[22px] font-extrabold tracking-[-0.02em]">{v}</p>
                {d ? <p className="text-[12px] font-bold" style={{ color: String(d).startsWith('▼') ? '#9a5b00' : accent }}>{d}</p> : null}
              </div>))}
          </section>
        </>);
      })()}

      {dayPick && <div className="flex items-center justify-between rounded-[14px] px-3.5 py-2.5 text-[14px]" style={{ background: `${accent}12` }}><span className="font-semibold">Showing {dshort(dayPick)} only</span><button type="button" onClick={() => setDayPick(null)} className="font-bold" style={{ color: accent }}>Show all</button></div>}
      <section aria-label="Every line" className="overflow-hidden rounded-[20px] border" style={{ borderColor: LINE }}>
        {groups.map((g, gi) => { const on = openPart === g.key; return (
          <div key={g.key} style={{ borderTop: gi ? `1px solid #f0f0f2` : undefined }}>
            <button type="button" aria-expanded={on} onClick={() => setOpenPart(on ? null : g.key)} className="flex w-full items-center gap-2.5 px-3.5 py-3.5 text-left">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PART_COLORS(accent)[g.key] }} />
              <span className="flex-1 text-[15px] font-bold">{PART_LABEL[g.key]} <span className="text-[13px] font-medium" style={{ color: MUTED }}>· {g.lines.length} line{g.lines.length === 1 ? '' : 's'}</span></span>
              <span className="text-[15px] font-extrabold">{money(g.total)}</span><span aria-hidden style={{ color: '#9a9ca1' }}>{on ? '▾' : '▸'}</span>
            </button>
            {on && <ul className="border-t" style={{ borderColor: '#f0f0f2', background: '#fafafa' }}>
              {g.lines.filter((l: any) => !dayPick || l.date === dayPick).map((l: any) => (
                <li key={l.ref}><button type="button" onClick={() => setLine(l)} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left">
                  <span className="w-11 shrink-0 pt-0.5 text-[12px] tabular-nums" style={{ color: MUTED }}>{l.date ? dshort(l.date) : ''}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold">{l.title}</span><span className="block truncate text-[12px]" style={{ color: MUTED }}>{l.detail}</span></span>
                  <span className="pt-0.5 text-[14px] font-bold tabular-nums">{money(l.amount)}</span>
                </button></li>))}
            </ul>}
          </div>); })}
        {a.shifts.length > 0 && (() => { const on = openPart === 'shifts'; return (
          <div style={{ borderTop: '1px solid #f0f0f2' }}>
            <button type="button" aria-expanded={on} onClick={() => setOpenPart(on ? null : 'shifts')} className="flex w-full items-center gap-2.5 px-3.5 py-3.5 text-left">
              <span className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: '#c7cad1' }} />
              <span className="flex-1 text-[15px] font-bold">Shifts <span className="text-[13px] font-medium" style={{ color: MUTED }}>· {a.shifts.length} · {stub.hours} h</span></span><span aria-hidden style={{ color: '#9a9ca1' }}>{on ? '▾' : '▸'}</span>
            </button>
            {on && <ul className="border-t" style={{ borderColor: '#f0f0f2', background: '#fafafa' }}>
              {a.shifts.map((l: any) => <li key={l.ref}><button type="button" onClick={() => setLine(l)} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left">
                <span className="w-11 shrink-0 pt-0.5 text-[12px]" style={{ color: MUTED }}>{dshort(l.date)}</span>
                <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold">{l.title}</span><span className="block text-[12px]" style={{ color: /not counted|not approved/.test(l.detail) ? '#b42318' : MUTED }}>{l.detail}</span></span>
              </button></li>)}
            </ul>}
          </div>); })()}
        <div className="flex items-center justify-between gap-3 border-t px-3.5 py-3 text-[13px]" style={{ borderColor: INK, borderTopWidth: 1.5 }}>
          <span style={{ color: a.check.ok ? MUTED : '#b42318' }}>{a.check.ok ? '✓ ' : ''}{a.check.lines} lines add up to {money(a.check.linesTotal)}{a.check.ok ? '' : ' — ask your manager to check this stub'}</span>
          <span className="font-extrabold" style={{ color: INK }}>{money(stub.total)}</span>
        </div>
      </section>

      {stub.notes.filter((n: string) => !/^Before taxes/.test(n)).map((n: string) => <p key={n} className="rounded-[14px] px-3.5 py-2.5 text-[13px]" style={{ background: '#fdf6ea', color: '#7a4a00' }}>{n}</p>)}

      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" disabled={dl} onClick={async () => { setDl(true); try { await downloadStub(tenantId, p.from); } catch {} finally { setDl(false); } }} className="flex h-12 items-center justify-center gap-2 rounded-[16px] text-[15px] font-bold text-white disabled:opacity-60" style={{ background: INK }}>{DL}{dl ? 'Getting it…' : 'Download PDF'}</button>
        <button type="button" onClick={() => setAsk('general')} className="flex h-12 items-center justify-center gap-2 rounded-[16px] border text-[15px] font-semibold" style={{ borderColor: '#e6e6e8' }}>{FLAG}Something’s off</button>
      </div>
      <p className="text-[12px]" style={{ color: MUTED }}>Before taxes and deductions. {stub.paid ? 'This stub is final — any fix goes on your next one.' : 'Until payday this updates as visits are checked out and shifts approved.'}</p>
    </div>);
}
