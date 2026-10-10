'use client';
// src/components/pay/PayHome.tsx — THE STAFF PAY TAB ("Pay 5"): this period so far on a brand-colour card (services,
// tips, retail), a bar for each day, how close they are to their best period, and their pay stubs to swipe through
// (each opens the full line-by-line stub, PayStubView). Open pay questions show at the top with where they're at.
import * as React from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';
import { money, money0, dshort, payGet, downloadStub, PART_COLORS } from '@/components/pay/pay-client';
import { PayStubView } from '@/components/pay/PayStubView';
import { PayQuestionStatus } from '@/components/pay/PayQuestion';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const DL = <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>;

export function PayHome({ tenantId, staffId, firestore, accent = INK }: { tenantId: string; staffId: string; firestore: any; accent?: string }) {
  const [data, setData] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const [open, setOpen] = React.useState<string | null>(null); const [qOpen, setQOpen] = React.useState<string | null>(null); const [dl, setDl] = React.useState('');
  const load = React.useCallback(async () => { const r = await payGet(`/api/pay/home?tenantId=${encodeURIComponent(tenantId)}`); if (r.ok) { setData(r); setErr(''); } else setErr(r.error || 'Couldn’t load your pay.'); }, [tenantId]);
  React.useEffect(() => { load(); }, [load]);
  const qQ = useMemoFirebase(() => (!firestore || !tenantId || !staffId) ? null : query(collection(firestore, `tenants/${tenantId}/payQuestions`), where('staffId', '==', staffId)), [firestore, tenantId, staffId]);
  const { data: questions } = useCollection<any>(qQ);
  const live = (questions || []).filter((q: any) => ['open', 'checking'].includes(q.status) || (Date.now() - Date.parse(q.updatedAt || '') < 7 * 86400000)).sort((a: any, b: any) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  if (qOpen) return <PayQuestionStatus tenantId={tenantId} question={(questions || []).find((q: any) => q.id === qOpen)} accent={accent} onBack={() => setQOpen(null)} />;
  if (open) { const i = (data?.stubs || []).findIndex((s: any) => s.period.from === open); const prev = i >= 0 ? data.stubs[i + 1] : data?.stubs?.[0];
    return <PayStubView tenantId={tenantId} from={open} accent={accent} previousTotal={prev?.total ?? null} previousStats={prev?.stats || null} onBack={() => { setOpen(null); load(); }} />; }
  if (err) return <p role="alert" className="rounded-[16px] px-4 py-3 text-[14px]" style={{ background: '#fdecec', color: '#b42318' }}>{err}</p>;
  if (!data) return <div className="space-y-3" aria-busy="true"><div className="h-[190px] animate-pulse rounded-[26px]" style={{ background: '#f1f1f3' }} /><div className="h-[120px] animate-pulse rounded-[20px]" style={{ background: '#f6f6f7' }} /></div>;

  const c = data.current; const p = c?.period; const parts = c?.parts || {};
  const days: string[] = []; if (p) { let d = p.from; while (d <= p.to) { days.push(d); d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10); } }
  const byDay = c?.audit?.byDay || {}; const maxDay = Math.max(1, ...days.map((d) => byDay[d] || 0));
  const today = new Date().toLocaleDateString('en-CA'); const best = days.reduce((b, d) => ((byDay[d] || 0) > (byDay[b] || 0) ? d : b), days[0]);
  const bestTotal = data.bestTotal || 0; const pct = bestTotal ? Math.min(100, ((c?.total || 0) / bestTotal) * 100) : 0;
  const tiles = [['Services', parts.services], ['Tips', parts.tips], [parts.time ? 'Time' : 'Retail', parts.time || parts.retail]].filter((x) => x[1] != null);

  return (
    <div className="space-y-4" style={{ color: INK }}>
      {live.map((q: any) => (
        <button key={q.id} type="button" onClick={() => setQOpen(q.id)} className="flex w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left" style={{ background: q.status === 'sorted' || q.status === 'explained' ? `${accent}12` : '#fdf6ea' }}>
          <span className="min-w-0 flex-1"><span className="block text-[13px] font-bold" style={{ color: q.status === 'sorted' || q.status === 'explained' ? accent : '#9a5b00' }}>{({ open: 'Pay question sent', checking: 'Your manager is checking', sorted: 'Sorted', explained: 'Answered' } as any)[q.status]}</span>
            <span className="block truncate text-[14px] font-semibold">{q.reasonLabel}{q.line?.title ? ` — ${q.line.title}` : ''}</span></span>
          <span aria-hidden style={{ color: MUTED }}>›</span>
        </button>))}

      {c && (
        <section aria-label="This pay period" className="space-y-3 rounded-[26px] p-[18px] text-white" style={{ background: `linear-gradient(160deg, ${accent}, ${INK})` }}>
          <div className="flex justify-between text-[13px] opacity-85"><span>{dshort(p.from)} – {dshort(p.to)} · so far</span><span>Payday {dshort(p.payday)}</span></div>
          <p className="text-[40px] font-extrabold leading-none tracking-[-0.02em]">{money(c.total)}</p>
          <div className="grid grid-cols-3 gap-2">
            {tiles.map(([k, v]: any) => <div key={k} className="rounded-[14px] p-2.5" style={{ background: 'rgba(255,255,255,.12)' }}><p className="text-[11px] opacity-80">{k}</p><p className="text-[16px] font-extrabold">{money0(v)}</p></div>)}
          </div>
          {parts.adjustments ? <p className="text-[13px] font-semibold opacity-90">Includes {money(parts.adjustments)} in corrections</p> : null}
        </section>)}

      {c && days.length > 0 && (
        <section aria-label="Day by day" className="space-y-2.5 rounded-[20px] border p-3.5" style={{ borderColor: LINE }}>
          <div className="flex justify-between text-[13px]"><span className="font-bold">Your days</span>{(byDay[best] || 0) > 0 && <span style={{ color: MUTED }}>Best: {new Date(`${best}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} · {money0(byDay[best])}</span>}</div>
          <div className="flex h-[96px] items-end gap-1.5" role="img" aria-label={`Earnings by day: ${days.filter((d) => byDay[d]).map((d) => `${dshort(d)} ${money0(byDay[d])}`).join(', ') || 'none yet'}`}>
            {days.map((d) => { const v = byDay[d] || 0; const future = d > today; return (
              <div key={d} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div className="w-full rounded-[5px]" style={{ height: Math.max(3, (v / maxDay) * 76), background: d === today ? accent : future ? '#f3f3f5' : v ? `${accent}66` : '#e6e6e8' }} />
                <span className="text-[9px]" style={{ color: d === today ? accent : '#9a9ca1', fontWeight: d === today ? 800 : 500 }}>{new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })}</span>
              </div>); })}
          </div>
        </section>)}

      {c && bestTotal > 0 && (
        <section aria-label="Your best period" className="space-y-2 rounded-[20px] border p-3.5" style={{ borderColor: LINE }}>
          <div className="flex justify-between text-[14px]"><span className="font-bold">{c.total >= bestTotal ? 'Your best period yet' : `Your best period was ${money0(bestTotal)}`}</span>{c.total < bestTotal && <span style={{ color: MUTED }}>{money0(bestTotal - c.total)} to go</span>}</div>
          <div className="h-2.5 rounded-full" style={{ background: '#f0f0f2' }}><div className="h-2.5 rounded-full" style={{ width: `${pct}%`, background: accent }} /></div>
          {data.previousTotal != null && <p className="text-[13px]" style={{ color: MUTED }}>Last period: {money(data.previousTotal)}</p>}
        </section>)}

      <div className="flex items-baseline justify-between"><p className="text-[15px] font-bold">Pay stubs</p>{c && <button type="button" onClick={() => setOpen(p.from)} className="text-[13px] font-bold" style={{ color: accent }}>This period, line by line</button>}</div>
      {(data.stubs || []).length === 0 ? <p className="rounded-[16px] px-4 py-3 text-[14px]" style={{ background: '#f6f6f7', color: MUTED }}>Your first stub appears here after your first payday.</p> : (
        <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1">
          {data.stubs.map((s: any) => { const sum = Math.max(1, ['services', 'tips', 'retail', 'time'].reduce((t, k) => t + Math.max(0, s.parts[k] || 0), 0)); return (
            <div key={s.period.from} className="w-[176px] shrink-0 snap-start space-y-1.5 rounded-[18px] p-3.5" style={{ background: '#f6f6f7' }}>
              <button type="button" onClick={() => setOpen(s.period.from)} className="block w-full space-y-1.5 text-left">
                <span className="block text-[12px]" style={{ color: MUTED }}>{dshort(s.period.from)} – {dshort(s.period.to)}</span>
                <span className="block text-[20px] font-extrabold">{money(s.total)}</span>
                <span className="flex h-1.5 gap-0.5">{['services', 'retail', 'tips', 'time'].filter((k) => s.parts[k] > 0).map((k) => <span key={k} className="rounded-full" style={{ flex: s.parts[k] / sum, background: PART_COLORS(accent)[k] }} />)}</span>
                <span className="block text-[12px]" style={{ color: MUTED }}>{s.paid ? `Paid ${dshort(s.period.payday)}` : `Pays ${dshort(s.period.payday)}`}</span>
              </button>
              <button type="button" disabled={dl === s.period.from} onClick={async () => { setDl(s.period.from); try { await downloadStub(tenantId, s.period.from); } catch {} finally { setDl(''); } }} className="flex items-center gap-1.5 text-[12px] font-bold disabled:opacity-50" style={{ color: accent }} aria-label={`Download the ${dshort(s.period.from)} stub as a PDF`}>{DL}{dl === s.period.from ? 'Getting it…' : 'PDF'}</button>
            </div>); })}
        </div>)}
      <p className="text-[12px]" style={{ color: MUTED }}>Before taxes and deductions — your payroll provider takes those out. Something look wrong? Open the stub and tap the line.</p>
    </div>);
}
