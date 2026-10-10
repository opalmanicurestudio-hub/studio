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

function Ring({ parts, total, accent }: { parts: Record<string, number>; total: number; accent: string }) {
  const C = 2 * Math.PI * 54; const pos = Object.entries(parts).filter(([, v]) => v > 0); const sum = pos.reduce((s, [, v]) => s + v, 0) || 1; let off = 0;
  return (
    <div className="relative h-[140px] w-[140px] shrink-0" role="img" aria-label={`Total ${money(total)}: ${pos.map(([k, v]) => `${PART_LABEL[k]} ${money(v)}`).join(', ')}`}>
      <svg aria-hidden width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="70" cy="70" r="54" fill="none" stroke="#f0f0f2" strokeWidth="20" />
        {pos.map(([k, v]) => { const len = (v / sum) * C; const el = <circle key={k} cx="70" cy="70" r="54" fill="none" stroke={PART_COLORS(accent)[k]} strokeWidth="20" strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-off} />; off += len; return el; })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[12px]" style={{ color: MUTED }}>Total</span><span className="text-[19px] font-extrabold">{money(total).replace(/\.\d\d$/, '')}</span></div>
    </div>);
}

export function PayStubView({ tenantId, from, accent = INK, previousTotal, onBack }: { tenantId: string; from: string; accent?: string; previousTotal?: number | null; onBack: () => void }) {
  const [stub, setStub] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const [openPart, setOpenPart] = React.useState<string | null>('services'); const [line, setLine] = React.useState<any>(null); const [ask, setAsk] = React.useState<any>(null);
  const [dl, setDl] = React.useState(false); const [sent, setSent] = React.useState('');
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

      <section aria-label="Statement" className="overflow-hidden rounded-[24px] border bg-white" style={{ borderColor: LINE, boxShadow: '0 18px 40px -28px rgba(22,23,26,.45)' }}>
        <div className="h-1.5" style={{ background: accent }} />
        <div className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[12px] font-bold" style={{ color: MUTED }}>EARNINGS STATEMENT</p><p className="text-[15px] font-bold">{stub.name}</p>
              <p className="text-[13px]" style={{ color: MUTED }}>{stub.paid ? `Paid ${dlong(p.payday)}` : `Payday ${dlong(p.payday)} · still adding up`}{stub.frozen ? ' · final' : ''}</p></div>
            <div className="text-right"><p className="text-[11px] font-bold" style={{ color: MUTED }}>BEFORE TAXES</p><p className="text-[26px] font-extrabold leading-none tracking-[-0.02em]">{money(stub.total)}</p></div>
          </div>
          <div className="flex items-center gap-4">
            <Ring parts={stub.parts} total={stub.total} accent={accent} />
            <div className="space-y-1.5 text-[13px]">
              {diff != null && Math.abs(diff) >= 1 && <p className="font-bold" style={{ color: diff > 0 ? accent : MUTED }}>{diff > 0 ? '▲' : '▼'} {money(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} than last period</p>}
              <p style={{ color: MUTED }}>{stub.visits} visit{stub.visits === 1 ? '' : 's'} · {stub.hours} h{stub.overtimeHours ? ` (${stub.overtimeHours} h overtime)` : ''}</p>
              {stub.visits > 0 && stub.parts.services > 0 && <p style={{ color: MUTED }}>avg {money(stub.parts.services / stub.visits)} per visit</p>}
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Every line" className="overflow-hidden rounded-[20px] border" style={{ borderColor: LINE }}>
        {groups.map((g, gi) => { const on = openPart === g.key; return (
          <div key={g.key} style={{ borderTop: gi ? `1px solid #f0f0f2` : undefined }}>
            <button type="button" aria-expanded={on} onClick={() => setOpenPart(on ? null : g.key)} className="flex w-full items-center gap-2.5 px-3.5 py-3.5 text-left">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PART_COLORS(accent)[g.key] }} />
              <span className="flex-1 text-[15px] font-bold">{PART_LABEL[g.key]} <span className="text-[13px] font-medium" style={{ color: MUTED }}>· {g.lines.length} line{g.lines.length === 1 ? '' : 's'}</span></span>
              <span className="text-[15px] font-extrabold">{money(g.total)}</span><span aria-hidden style={{ color: '#9a9ca1' }}>{on ? '▾' : '▸'}</span>
            </button>
            {on && <ul className="border-t" style={{ borderColor: '#f0f0f2', background: '#fafafa' }}>
              {g.lines.map((l: any) => (
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
