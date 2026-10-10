'use client';
// src/app/(app)/payroll/questions/page.tsx — PAY QUESTIONS: what team members flagged on their pay stubs ("Something's
// off"), oldest waiting first, with how long each has waited. Open one: the line they pointed at, the visit and its
// payments, their note — then settle it: add a correction to their current pay, say the record has been put right,
// or explain why it's right. Every step messages them (lib/pay-questions). Opening one tells them it's being checked.
import * as React from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { money, dshort, payPost } from '@/components/pay/pay-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const ago = (iso: string) => { const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? '' : 's'}`; };

function Records({ firestore, tenantId, q }: { firestore: any; tenantId: string; q: any }) {
  const [rec, setRec] = React.useState<any>(null);
  React.useEffect(() => { let on = true; (async () => {
    const aid = q.line?.source?.appointmentId; const tid = q.line?.source?.txnId; const out: any = {};
    try { if (aid) { const a = await getDoc(doc(firestore, `tenants/${tenantId}/appointments/${aid}`)); if (a.exists()) out.visit = { id: a.id, ...a.data() };
      out.txns = (await getDocs(query(collection(firestore, `tenants/${tenantId}/transactions`), where('appointmentId', '==', aid)))).docs.map((d) => ({ id: d.id, ...d.data() })); }
      else if (tid) { const t = await getDoc(doc(firestore, `tenants/${tenantId}/transactions/${tid}`)); if (t.exists()) out.txns = [{ id: t.id, ...t.data() }]; } } catch { /* shown as nothing found */ }
    if (on) setRec(out); })(); return () => { on = false; }; }, [firestore, tenantId, q.id]);
  if (!rec) return <p className="text-[14px]" style={{ color: MUTED }}>Looking up the records…</p>;
  if (!rec.visit && !(rec.txns || []).length) return <p className="text-[14px]" style={{ color: MUTED }}>{q.line?.ref ? 'No linked visit — check the day in Timesheets or Payday.' : 'This is about the whole stub — open their stub in Payday to check.'}</p>;
  const v = rec.visit;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {v && <div className="space-y-1.5 rounded-[18px] border p-3.5" style={{ borderColor: LINE }}>
        <p className="text-[12px] font-bold" style={{ color: MUTED }}>THE VISIT</p>
        <p className="text-[15px] font-bold">{v.clientName || 'Client'} · {v.serviceName || 'Visit'}</p>
        <p className="text-[14px]">{v.startTime ? new Date(v.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''} · {String(v.status || '').replace(/_/g, ' ')}</p>
        <a href={`/pos?visit=${v.id}`} className="text-[14px] font-bold" style={{ color: INK }}>Open the visit</a>
      </div>}
      <div className="space-y-1.5 rounded-[18px] border p-3.5" style={{ borderColor: LINE }}>
        <p className="text-[12px] font-bold" style={{ color: MUTED }}>PAYMENTS ON IT</p>
        {(rec.txns || []).length === 0 ? <p className="text-[14px]" style={{ color: '#b42318' }}>Nothing recorded — it may never have been checked out.</p> :
          (rec.txns || []).map((t: any) => <p key={t.id} className="flex justify-between gap-2 text-[14px]"><span className="min-w-0 truncate">{t.category || t.description} {t.staffId && t.staffId !== q.staffId ? <span style={{ color: '#b42318' }}>· on someone else</span> : ''}</span><span className="font-bold">{money(typeof t.amount === 'number' ? t.amount : (Number(t.amountCents) || 0) / 100)}</span></p>)}
      </div>
    </div>);
}

export default function PayQuestionsPage() {
  const { firestore } = useFirebase(); const { selectedTenant, role, can } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const allowed = ['owner', 'admin', 'manager'].includes(String(role)) || (typeof can === 'function' && can('money.view'));
  const qQ = useMemoFirebase(() => (!firestore || !tenantId || !allowed) ? null : collection(firestore, `tenants/${tenantId}/payQuestions`), [firestore, tenantId, allowed]);
  const { data } = useCollection<any>(qQ);
  const [pick, setPick] = React.useState<string>(''); const [amt, setAmt] = React.useState(''); const [note, setNote] = React.useState(''); const [mode, setMode] = React.useState<'adjust' | 'fixed' | 'explain'>('adjust');
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(''); const [err, setErr] = React.useState('');
  const list = (data || []).slice().sort((a: any, b: any) => { const oa = ['open', 'checking'].includes(a.status) ? 0 : 1, ob = ['open', 'checking'].includes(b.status) ? 0 : 1; return oa - ob || (oa === 0 ? String(a.createdAt).localeCompare(String(b.createdAt)) : String(b.updatedAt).localeCompare(String(a.updatedAt))); });
  const q = list.find((x: any) => x.id === pick) || null; const openCount = list.filter((x: any) => ['open', 'checking'].includes(x.status)).length;
  const act = async (action: string, extra: any = {}) => { setBusy(true); setErr(''); setMsg(''); const r = await payPost('/api/pay/questions', { tenantId, action, id: q.id, ...extra }); setBusy(false); if (r.ok) { setMsg('Done — they’ve been told.'); setNote(''); setAmt(''); } else setErr(r.error || 'That didn’t work.'); };
  React.useEffect(() => { if (q && q.status === 'open') payPost('/api/pay/questions', { tenantId, action: 'seen', id: q.id }); setMsg(''); setErr(''); setMode(q?.reason === 'tip_missing' || q?.reason === 'visit_missing' ? 'adjust' : 'adjust'); }, [q?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <div className="p-6"><AppHeader title="Pay questions" /><p className="mt-6" style={{ color: MUTED }}>Only managers can see pay questions.</p></div>;
  return (
    <div className="flex min-h-screen flex-col bg-white" style={{ color: INK }}>
      <AppHeader title="Pay questions" />
      <main className="grid flex-1 md:grid-cols-[380px_1fr]">
        <aside className="space-y-2.5 border-r p-4 md:p-6" style={{ borderColor: LINE, background: '#fafafa' }} aria-label="Questions">
          <div className="flex items-center justify-between"><p className="text-[18px] font-extrabold">Pay questions</p>{openCount > 0 && <span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ background: '#fde8e8', color: '#b42318' }}>{openCount} open</span>}</div>
          {list.length === 0 && <p className="text-[14px]" style={{ color: MUTED }}>No pay questions. When someone taps “Something’s off” on a stub it shows up here.</p>}
          {list.map((x: any) => { const live = ['open', 'checking'].includes(x.status); const old = live && Date.now() - Date.parse(x.createdAt) > 2 * 86400000; return (
            <button key={x.id} type="button" onClick={() => setPick(x.id)} aria-current={pick === x.id ? 'true' : undefined} className="block w-full space-y-1 rounded-[16px] border bg-white p-3 text-left" style={{ borderColor: pick === x.id ? INK : LINE, borderWidth: pick === x.id ? 2 : 1, opacity: live ? 1 : 0.65 }}>
              <span className="flex justify-between gap-2 text-[14px]"><span className="font-bold">{String(x.staffName).split(' ')[0]} {x.staffName?.split(' ')[1]?.[0] ? `${x.staffName.split(' ')[1][0]}.` : ''} · {String(x.reasonLabel).toLowerCase()}</span>
                <span style={{ color: live ? (old ? '#b42318' : MUTED) : '#1f6b3a', fontWeight: 600 }}>{live ? ago(x.createdAt) : x.status === 'sorted' ? 'Sorted' : 'Answered'}</span></span>
              <span className="block truncate text-[13px]" style={{ color: '#55585e' }}>{x.line?.title || x.visitHint || `${dshort(x.period?.from)} – ${dshort(x.period?.to)}`}</span>
            </button>); })}
        </aside>
        <section className="space-y-4 p-4 md:p-8" aria-label="Question">
          {!q ? <p style={{ color: MUTED }}>Pick a question on the left.</p> : <>
            <div><p className="text-[13px]" style={{ color: MUTED }}>{q.staffName} · stub {dshort(q.period?.from)} – {dshort(q.period?.to)}</p>
              <p className="text-[24px] font-extrabold leading-tight">{q.reasonLabel}{q.line?.title ? ` — ${q.line.title}` : ''}</p>
              {q.line?.ref && <p className="text-[14px]" style={{ color: MUTED }}>On the stub: {money(q.line.amount)}{q.line.date ? ` · ${dshort(q.line.date)}` : ''}</p>}</div>
            {q.visitHint && <p className="rounded-[14px] px-3.5 py-2.5 text-[15px]" style={{ background: '#f6f6f7' }}>Which visit: {q.visitHint}</p>}
            <div className="space-y-2">{(q.messages || []).map((m: any, i: number) => <p key={i} className="max-w-[640px] rounded-[16px] px-3.5 py-2.5 text-[15px]" style={{ background: m.by === q.staffId ? '#f6f6f7' : '#eef4f3' }}><span className="font-bold">{String(m.name).split(' ')[0]}: </span>{m.text}</p>)}</div>
            {firestore && <Records firestore={firestore} tenantId={tenantId} q={q} />}
            {['sorted', 'explained'].includes(q.status) ? (
              <p className="rounded-[16px] px-4 py-3 text-[15px] font-semibold" style={{ background: '#e6f2ec', color: '#1f6b3a' }}>{q.resolution?.kind === 'adjust' ? `Sorted by ${q.resolution.by}: ${money((q.resolution.amountCents || 0) / 100)} on their current pay.` : q.resolution?.kind === 'fixed' ? `Sorted by ${q.resolution.by}: the record was corrected.` : `Answered by ${q.resolution?.by}: “${q.resolution?.note}”`}</p>
            ) : <>
              <p className="text-[15px] font-bold">Sort it</p>
              <div role="radiogroup" aria-label="How to sort it" className="grid gap-3 md:grid-cols-3">
                {([['adjust', 'Add to their current pay', 'A correction line on this period’s stub and the payroll draft. Use this when the stub was already paid.'], ['fixed', 'I corrected the record', 'You fixed the visit, tip or punch itself — the live stub now shows it (only before payday).'], ['explain', 'It’s right — explain', 'Reply with why; closes the question.']] as const).map(([k, t, d]) =>
                  <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className="space-y-1 rounded-[18px] p-3.5 text-left" style={mode === k ? { border: `2px solid ${INK}`, background: '#f6f6f7' } : { border: '1px solid #e6e6e8' }}><span className="block text-[15px] font-extrabold">{t}</span><span className="block text-[13px]" style={{ color: '#55585e' }}>{d}</span></button>)}
              </div>
              {mode === 'adjust' && <label className="block max-w-[260px] text-[13px] font-semibold" style={{ color: MUTED }}>Amount (use – to take off)<input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="20.00" className="mt-1.5 h-12 w-full rounded-[14px] border px-3 text-[16px] font-semibold" style={{ borderColor: '#e6e6e8', color: INK }} /></label>}
              <label className="block max-w-[640px] text-[13px] font-semibold" style={{ color: MUTED }}>Note to {String(q.staffName).split(' ')[0]} {mode === 'explain' ? '' : '(optional)'}<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1.5 w-full rounded-[14px] border px-3 py-2.5 text-[15px]" style={{ borderColor: '#e6e6e8', color: INK }} /></label>
              <div className="flex flex-wrap gap-2.5">
                <button type="button" disabled={busy} onClick={() => act(mode, mode === 'adjust' ? { amount: Number(String(amt).replace(/[^0-9.\-]/g, '')), note } : { note })} className="h-12 rounded-[16px] px-5 text-[15px] font-bold text-white disabled:opacity-50" style={{ background: INK }}>{mode === 'adjust' ? 'Add it and tell them' : mode === 'fixed' ? 'Mark sorted and tell them' : 'Send the answer'}</button>
                <button type="button" disabled={busy || !note.trim()} onClick={() => act('reply', { note })} className="h-12 rounded-[16px] border px-5 text-[15px] font-semibold disabled:opacity-40" style={{ borderColor: '#e6e6e8' }}>Just reply</button>
              </div>
            </>}
            {msg && <p role="status" className="text-[14px] font-semibold" style={{ color: '#1f6b3a' }}>{msg}</p>}
            {err && <p role="alert" className="text-[14px] font-semibold" style={{ color: '#b42318' }}>{err}</p>}
            <p className="text-[12px]" style={{ color: MUTED }}>Paid stubs never change — a fix to a paid period goes on the current one. Every correction is saved with who approved it.</p>
          </>}
        </section>
      </main>
    </div>);
}
