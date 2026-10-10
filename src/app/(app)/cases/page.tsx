'use client';
// src/app/(app)/cases/page.tsx — MAKING IT RIGHT: every client complaint as a case (lib/cases). Left: open cases, safety
// first, then whoever's waited longest for a reply; closed ones underneath. Right: the case — where it is (Heard → Owned →
// Fix chosen → Done → Checked back), what the client said, the visit, the fair-use checks, the fixes this business offers
// (with a time picker for a free redo), messages and notes, the incident report for safety cases, and the records to
// download (case record, incident report). "Start a case" logs a phone call or a complaint at the desk.
import * as React from 'react';
import { collection, query, where, type Firestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';
import { settingsOf, FIX_LABEL, FIX_HINT, STAGES, stageIndex, type FixKind } from '@/lib/making-it-right';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f6', RED = '#b42318', PINK = '#fdecec', GREEN = '#1f6b3a';
const ago = (iso: string) => { const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
const left = (iso: string) => { const m = (Date.parse(iso) - Date.now()) / 60000; if (m <= 0) return { text: `Reply overdue by ${ago(iso)}`, late: true }; return { text: m < 60 ? `Reply within ${Math.round(m)} min` : `Reply within ${Math.round(m / 60)} h`, late: false }; };
const VIA: Record<string, string> = { call: 'Phone call', staff: 'Provider', desk: 'Front desk', survey: 'Visit rating', link: 'Visit link' };
const btn = 'h-11 rounded-full px-5 text-[15px] font-semibold disabled:opacity-40';

async function download(tenantId: string, id: string, kind: 'record' | 'incident', number: string) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '');
  const r = await fetch(`/api/cases/pdf?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(id)}&kind=${kind}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'That didn’t download — try again.'); }
  const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = `${kind === 'incident' ? 'incident' : 'case'}-${number}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function StageRail({ status }: { status: string }) {
  const at = stageIndex(status);
  return (
    <ol className="flex gap-1.5" aria-label="Where this case is">
      {STAGES.map((s, i) => { const done = i < at || status === 'closed', now = i === at && status !== 'closed';
        return <li key={s} className="flex-1 space-y-1.5"><div className="h-1.5 rounded-full" style={{ background: done ? INK : now ? '#9a9ca1' : LINE }} /><p className="text-[12px] font-semibold" style={{ color: done || now ? INK : MUTED }}>{s}</p></li>; })}
    </ol>);
}

function NewCase({ firestore, tenantId, S, onDone }: { firestore: any; tenantId: string; S: any; onDone: (id: string) => void }) {
  const since = React.useMemo(() => new Date(Date.now() - 60 * 86400000).toISOString(), []);
  const aQ = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore as Firestore, `tenants/${tenantId}/appointments`), where('startTime', '>=', since)) : null), [firestore, tenantId, since]);
  const { data: appts } = useCollection<any>(aQ);
  const [find, setFind] = React.useState(''); const [visit, setVisit] = React.useState<any>(null); const [reason, setReason] = React.useState(''); const [words, setWords] = React.useState('');
  const [via, setVia] = React.useState<'call' | 'desk'>('call'); const [wants, setWants] = React.useState(''); const [name, setName] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const past = (appts || []).filter((a: any) => Date.parse(a.startTime) < Date.now() && !['cancelled', 'no_show', 'expired'].includes(String(a.status)));
  const hits = find.trim().length < 2 ? [] : past.filter((a: any) => `${a.clientName} ${a.serviceName}`.toLowerCase().includes(find.toLowerCase())).sort((a: any, b: any) => String(b.startTime).localeCompare(String(a.startTime))).slice(0, 6);
  const go = async () => { setBusy(true); setErr(''); const r = await payPost('/api/cases', { tenantId, action: 'open', appointmentId: visit?.id || '', clientId: visit?.clientId || '', clientName: visit?.clientName || name, reasonId: reason, words, via, wants: wants || null }); setBusy(false); if (r.ok) onDone(r.id); else setErr(r.error || 'That didn’t work.'); };
  return (
    <div className="space-y-5">
      <h2 className="text-[22px] font-bold tracking-tight">Start a case</h2>
      <div className="space-y-2"><p className="text-[13px] font-bold" style={{ color: MUTED }}>HOW DID YOU HEAR?</p>
        <div className="flex gap-2">{(['call', 'desk'] as const).map((v) => <button key={v} type="button" onClick={() => setVia(v)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={via === v ? { background: INK, color: '#fff' } : { background: SOFT }}>{v === 'call' ? 'Phone call' : 'At the desk'}</button>)}</div></div>
      <div className="space-y-2"><p className="text-[13px] font-bold" style={{ color: MUTED }}>WHICH VISIT?</p>
        {visit ? <div className="flex items-center justify-between gap-3 rounded-2xl p-3.5" style={{ background: SOFT }}><span><b>{visit.clientName}</b> · {visit.serviceName}<br /><span className="text-[13px]" style={{ color: MUTED }}>{new Date(visit.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {visit.staffName || ''}</span></span><button type="button" className="text-[14px] underline" onClick={() => setVisit(null)}>Change</button></div> : <>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search the client’s name" className="h-12 w-full rounded-xl border px-4 text-[15px]" style={{ borderColor: LINE }} />
          {hits.map((a: any) => <button key={a.id} type="button" onClick={() => setVisit(a)} className="block w-full rounded-xl border p-3 text-left text-[14px]" style={{ borderColor: LINE }}><b>{a.clientName}</b> · {a.serviceName} <span style={{ color: MUTED }}>— {new Date(a.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{a.staffName ? `, ${a.staffName}` : ''}</span></button>)}
          {find.trim().length >= 2 && !hits.length && <><p className="text-[14px]" style={{ color: MUTED }}>No visit in the last 60 days. You can still start the case with their name.</p><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Client’s name" className="h-12 w-full rounded-xl border px-4 text-[15px]" style={{ borderColor: LINE }} /></>}
        </>}</div>
      <div className="space-y-2"><p className="text-[13px] font-bold" style={{ color: MUTED }}>WHAT WENT WRONG?</p>
        <div className="flex flex-wrap gap-2">{S.reasons.filter((r: any) => r.on !== false).map((r: any) => <button key={r.id} type="button" onClick={() => setReason(r.id)} className="min-h-10 rounded-full px-4 text-[14px] font-semibold" style={reason === r.id ? { background: r.safety ? RED : INK, color: '#fff' } : { background: r.safety ? PINK : SOFT, color: r.safety ? RED : INK }}>{r.label}</button>)}</div>
        {S.reasons.find((r: any) => r.id === reason)?.safety && <p className="rounded-xl p-3 text-[14px] font-semibold" style={{ background: PINK, color: RED }}>This is a safety case. A manager is told now, an incident report starts, and nothing is offered until they’ve looked.</p>}</div>
      <div className="space-y-2"><p className="text-[13px] font-bold" style={{ color: MUTED }}>IN THEIR WORDS</p>
        <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={3} placeholder="What they said, as close to their words as you can" className="w-full rounded-xl border p-3 text-[15px]" style={{ borderColor: LINE }} /></div>
      <div className="space-y-2"><p className="text-[13px] font-bold" style={{ color: MUTED }}>WHAT ARE THEY HOPING FOR?</p>
        <div className="flex flex-wrap gap-2">{[['fix', 'Get it fixed'], ['refund', 'Their money back'], ['talk', 'Just to be heard']].map(([k, l]) => <button key={k} type="button" onClick={() => setWants(wants === k ? '' : k)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={wants === k ? { background: INK, color: '#fff' } : { background: SOFT }}>{l}</button>)}</div></div>
      {err && <p className="text-[14px] font-semibold" style={{ color: RED }}>{err}</p>}
      <button type="button" disabled={busy || (!reason && !words.trim()) || (!visit && !name.trim())} onClick={go} className={btn} style={{ background: INK, color: '#fff' }}>{busy ? 'Starting…' : 'Start the case'}</button>
    </div>);
}

function CaseView({ c, tenantId, S, me, isManager, tz }: { c: any; tenantId: string; S: any; me: string; isManager: boolean; tz: string }) {
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [ok, setOk] = React.useState('');
  const [kind, setKind] = React.useState<FixKind | ''>(''); const [amt, setAmt] = React.useState(''); const [when, setWhen] = React.useState(''); const [mins, setMins] = React.useState('45');
  const [msg, setMsg] = React.useState(''); const [note, setNote] = React.useState(''); const [inc, setInc] = React.useState<any>({}); const [stmt, setStmt] = React.useState(''); const [cb, setCb] = React.useState('');
  React.useEffect(() => { setKind(''); setAmt(''); setWhen(''); setErr(''); setOk(''); setInc({}); }, [c.id]);
  const act = async (action: string, extra: any = {}, done = 'Saved.') => { setBusy(true); setErr(''); setOk(''); const r = await payPost('/api/cases', { tenantId, id: c.id, action, ...extra }); setBusy(false); if (r.ok) { setOk(r.pending ? `Sent to a manager — ${r.why}` : action === 'message' && r.sent === false ? 'Saved on the case — we couldn’t text them, so call or message them too.' : done); return true; } setErr(r.error || 'That didn’t work.'); return false; };
  const v = c.visit || {}; const fixes = (Object.keys(FIX_LABEL) as FixKind[]).filter((k) => S.fixes[k]);
  const clock = !c.firstReplyAt && c.replyDueAt && c.status !== 'closed' ? left(c.replyDueAt) : null;
  const dl = async (k: 'record' | 'incident') => { try { await download(tenantId, c.id, k, c.number); } catch (e: any) { setErr(e.message); } };
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
  const Card = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="space-y-2 rounded-[18px] border p-4" style={{ borderColor: LINE }}><p className="text-[12px] font-bold tracking-wide" style={{ color: MUTED }}>{title}</p>{children}</div>;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        {c.safety && <p className="rounded-xl px-3.5 py-2.5 text-[14px] font-bold" style={{ background: PINK, color: RED }}>Safety case — a manager owns this, and the incident report must be finished before it closes.</p>}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[13px] font-semibold" style={{ color: MUTED }}>{c.number} · {VIA[c.via] || c.via} · {ago(c.createdAt)} ago</p>
            <h2 className="text-[26px] font-bold leading-tight tracking-tight">{c.clientName}</h2>
            <p className="text-[16px]">{c.reasonLabel}</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => dl('record')} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>Case record (PDF)</button>
            {c.safety && <button type="button" onClick={() => dl('incident')} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: PINK, color: RED }}>Incident report (PDF)</button>}
          </div>
        </div>
        <StageRail status={c.status} />
        <div className="flex flex-wrap gap-2 text-[13.5px]">
          <span className="rounded-full px-3 py-1" style={{ background: SOFT }}>{c.ownerName ? `Owned by ${c.ownerName}` : 'No one owns this yet'}</span>
          {clock && <span className="rounded-full px-3 py-1 font-semibold" style={clock.late ? { background: PINK, color: RED } : { background: SOFT }}>{clock.text}</span>}
          {c.locked && <span className="rounded-full px-3 py-1 font-semibold" style={{ background: '#e8f3ec', color: GREEN }}>Closed {c.closedAt ? new Date(c.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''} · locked</span>}
        </div>
      </header>

      {!c.ownerId && !c.locked && (!c.safety || isManager) && <button type="button" disabled={busy} onClick={() => act('own', {}, 'It’s yours.')} className={btn} style={{ background: INK, color: '#fff' }}>I’ll take this</button>}

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="WHAT THEY SAID">
          <p className="text-[16px] leading-snug">{c.words ? `“${c.words}”` : !c.voice ? <span style={{ color: MUTED }}>No words recorded.</span> : null}</p>
          {c.wordsEn && <p className="rounded-xl p-3 text-[14.5px]" style={{ background: SOFT }}><b>In English:</b> {c.wordsEn}</p>}
          {c.wants && <p className="text-[14px]" style={{ color: MUTED }}>Hoping for: <b style={{ color: INK }}>{({ fix: 'getting it fixed', refund: 'their money back', talk: 'to be heard' } as any)[c.wants]}</b></p>}
          {(c.photos || []).length > 0 && <div className="flex gap-2 overflow-x-auto">{c.photos.map((u: string) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Client photo" className="h-20 w-20 rounded-xl object-cover" /></a>)}</div>}
          {c.voice?.url && <div className="space-y-1.5"><p className="text-[13px] font-semibold" style={{ color: MUTED }}>Voice note{c.voice.seconds ? ` · ${c.voice.seconds}s` : ''}</p><audio controls src={c.voice.url} className="w-full" />
            {c.voice.transcript && <p className="text-[14.5px]">“{c.voice.transcript}”</p>}
            {c.voice.translation && <p className="rounded-xl p-3 text-[14.5px]" style={{ background: SOFT }}><b>In English:</b> {c.voice.translation}</p>}</div>}
          {c.providerAction && <p className="text-[14px]" style={{ color: MUTED }}>Provider: {c.providerAction}</p>}
        </Card>
        <Card title="THE VISIT">
          {v.appointmentId ? <>
            <p className="text-[16px] font-bold">{v.serviceName}</p>
            <p className="text-[14px]">{v.startTime ? fmt(v.startTime) : ''}{v.providerName ? ` · ${v.providerName}` : ''}</p>
            <p className="text-[14px]">Paid <b>${Number(v.paid || 0).toFixed(2)}</b>{v.tip ? ` + $${Number(v.tip).toFixed(2)} tip` : ''}{v.cardLast4 ? ` · card ending ${v.cardLast4}` : ''}</p>
            {(v.products || []).length > 0 && <p className="text-[13.5px]" style={{ color: MUTED }}>Products: {v.products.join(', ')}</p>}
            <a href={`/pos?visit=${v.appointmentId}`} className="text-[14px] font-bold underline">Open the visit</a></> : <p className="text-[14px]" style={{ color: MUTED }}>No visit linked.</p>}
        </Card>
      </div>

      <Card title="FAIR-USE CHECK">
        {(c.checks || []).length === 0 ? <p className="text-[14px]" style={{ color: MUTED }}>Nothing to check.</p> :
          (c.checks || []).map((k: any) => <p key={k.key} className="flex items-start gap-2.5 text-[14.5px]"><span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: k.ok ? GREEN : RED }}>{k.ok ? '✓' : '!'}</span><span><b>{k.title}</b> <span style={{ color: MUTED }}>— {k.detail}</span></span></p>)}
        {(c.checks || []).some((k: any) => !k.ok) && <p className="text-[13.5px]" style={{ color: MUTED }}>Not a no — it means a manager decides this one.</p>}
      </Card>

      {c.pending && <div className="space-y-3 rounded-[18px] p-4" style={{ background: '#fff7e6' }}>
        <p className="text-[15px]"><b>{c.pending.askedBy}</b> wants to give <b>{FIX_LABEL[c.pending.kind as FixKind]}{c.pending.amountCents ? ` $${(c.pending.amountCents / 100).toFixed(2)}` : ''}</b>. {c.pending.why}</p>
        {isManager ? <button type="button" disabled={busy} onClick={() => act('approve', {}, 'Approved.')} className={btn} style={{ background: INK, color: '#fff' }}>Approve</button> : <p className="text-[14px]" style={{ color: MUTED }}>Waiting for a manager.</p>}
      </div>}

      {!c.locked && !c.fix && !c.pending && <Card title="CHOOSE THE FIX">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">{fixes.map((k) => <button key={k} type="button" onClick={() => setKind(k)} className="rounded-2xl border p-3 text-left" style={kind === k ? { borderColor: INK, background: INK, color: '#fff' } : { borderColor: LINE }}><span className="block text-[15px] font-bold">{FIX_LABEL[k]}</span><span className="block text-[12.5px] opacity-75">{FIX_HINT[k]}</span></button>)}</div>
        {(kind === 'refund' || kind === 'credit') && <label className="flex items-center gap-2 text-[15px]">Amount $<input type="number" inputMode="decimal" min={0} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={v.paid ? Number(v.paid).toFixed(2) : '0.00'} className="h-11 w-32 rounded-xl border px-3" style={{ borderColor: LINE }} />
          {kind === 'refund' && v.paid ? <span className="text-[13px]" style={{ color: MUTED }}>of ${Number(v.paid).toFixed(2)} paid</span> : null}</label>}
        {kind === 'redo' && <div className="flex flex-wrap items-center gap-2 text-[15px]"><label className="flex items-center gap-2">When <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-11 rounded-xl border px-3" style={{ borderColor: LINE }} /></label>
          <label className="flex items-center gap-2">for <input type="number" min={15} step={15} value={mins} onChange={(e) => setMins(e.target.value)} className="h-11 w-20 rounded-xl border px-3" style={{ borderColor: LINE }} /> min</label>
          <span className="text-[13px]" style={{ color: MUTED }}>Leave the time empty to book it later. {S.fairUse.originalProviderFirst && v.providerName ? `Booked with ${v.providerName.split(' ')[0]}.` : ''}</span></div>}
        {kind && <button type="button" disabled={busy || ((kind === 'refund' || kind === 'credit') && !(Number(amt) > 0))} onClick={async () => { if (await act('choose_fix', { kind, amountCents: Math.round((Number(amt) || 0) * 100), redo: kind === 'redo' && when ? { startTime: new Date(when).toISOString(), minutes: Number(mins) || 45 } : null }, 'Fix chosen.')) setKind(''); }} className={btn} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : `Go with ${FIX_LABEL[kind].toLowerCase()}`}</button>}
      </Card>}

      {c.fix && <Card title="THE FIX">
        <p className="text-[16px]"><b>{c.fix.label}{c.fix.amountCents ? ` $${(c.fix.amountCents / 100).toFixed(2)}` : ''}</b> · chosen by {c.fix.by}{c.fix.approvedBy && c.fix.approvedBy !== c.fix.by ? `, approved by ${c.fix.approvedBy}` : ''}</p>
        {c.fix.todo && c.status === 'fix_chosen' && <p className="rounded-xl p-3 text-[14px] font-semibold" style={{ background: '#fff7e6' }}>To do: {c.fix.todo}</p>}
        {c.status === 'fix_chosen' && <button type="button" disabled={busy} onClick={() => act('done', {}, 'Marked done. We’ll remind you to check back.')} className={btn} style={{ background: INK, color: '#fff' }}>It’s done</button>}
        {c.status === 'done' && <div className="space-y-2"><p className="text-[14.5px]">Check back{c.followUpAt ? ` around ${new Date(c.followUpAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}: <b>did we make it right?</b></p>
          <input value={cb} onChange={(e) => setCb(e.target.value)} placeholder="What they said (optional)" className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} />
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => act('checked_back', { answer: 'yes', note: cb }, 'Closed. Nice work.')} className={btn} style={{ background: GREEN, color: '#fff' }}>Yes — close the case</button>
            <button type="button" disabled={busy} onClick={() => act('checked_back', { answer: 'no', note: cb }, 'Reopened.')} className={btn} style={{ background: SOFT }}>Still not right</button></div></div>}
      </Card>}

      {c.safety && <Card title="INCIDENT REPORT">
        {[['whatHappened', 'What happened'], ['where', 'Where (chair, room, station)'], ['kit', 'Kit or tools used'], ['cycle', 'Sterilization record'], ['firstAid', 'First aid given'], ['advice', 'Advice given to the client']].map(([k, l]) => (
          <label key={k} className="block space-y-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>{l}</span>
            <input defaultValue={c.incident?.[k] || ''} disabled={!isManager || c.locked} onChange={(e) => setInc({ ...inc, [k]: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /></label>))}
        <label className="block space-y-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Who was there (comma between names)</span>
          <input defaultValue={(c.incident?.present || []).join(', ')} disabled={!isManager || c.locked} onChange={(e) => setInc({ ...inc, present: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /></label>
        {isManager && !c.locked && <button type="button" disabled={busy || !Object.keys(inc).length} onClick={async () => { if (await act('incident', { incident: inc }, 'Incident report saved.')) setInc({}); }} className={btn} style={{ background: INK, color: '#fff' }}>Save the report</button>}
        <div className="space-y-1.5 border-t pt-3" style={{ borderColor: LINE }}>
          <p className="text-[13px] font-semibold" style={{ color: MUTED }}>Statements</p>
          {(c.incident?.statements || []).map((s: any, i: number) => <p key={i} className="text-[14.5px]"><b>{s.by}</b> <span style={{ color: MUTED }}>({fmt(s.at)}, signed)</span>: “{s.text}”</p>)}
          {!c.locked && <div className="flex gap-2"><input value={stmt} onChange={(e) => setStmt(e.target.value)} placeholder="Your account of what happened" className="h-11 flex-1 rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /><button type="button" disabled={busy || !stmt.trim()} onClick={async () => { if (await act('statement', { text: stmt }, 'Statement signed.')) setStmt(''); }} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>Sign it</button></div>}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: LINE }}>
          {c.incident?.checkIn48At ? <p className="text-[14.5px]" style={{ color: GREEN }}><b>48-hour check-in done</b> {fmt(c.incident.checkIn48At)}{c.incident.checkIn48Note ? ` — ${c.incident.checkIn48Note}` : ''}</p> :
            isManager && !c.locked && <><input placeholder="48-hour check-in: how are they?" onChange={(e) => setInc({ ...inc, checkIn48Note: e.target.value })} className="h-11 flex-1 rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /><button type="button" disabled={busy} onClick={() => act('incident', { incident: { checkIn48: true, checkIn48Note: inc.checkIn48Note || '' } }, 'Check-in recorded.')} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>Record check-in</button></>}
          {c.incident?.signedOffBy ? <p className="text-[14.5px]">Signed off by <b>{c.incident.signedOffBy}</b></p> : isManager && !c.locked && <button type="button" disabled={busy} onClick={() => act('incident', { incident: { signOff: true } }, 'Signed off.')} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: INK, color: '#fff' }}>Sign off the report</button>}
        </div>
      </Card>}

      {!c.locked && <Card title="MESSAGE THE CLIENT">
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} placeholder={`e.g. So sorry about this, ${String(c.clientName || '').split(' ')[0]} — we’d love to make it right.`} className="w-full rounded-xl border p-3 text-[15px]" style={{ borderColor: LINE }} />
        <p className="text-[13px]" style={{ color: MUTED }}>We text it to them with a link to their case page, where they’ll see every reply.</p>
        <button type="button" disabled={busy || !msg.trim()} onClick={async () => { if (await act('message', { text: msg }, 'Sent.')) setMsg(''); }} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: INK, color: '#fff' }}>Send reply</button>
      </Card>}

      <Card title="EVERY STEP">
        {(c.timeline || []).slice().reverse().map((t: any, i: number) => <p key={i} className="grid grid-cols-[110px_1fr] gap-3 text-[14px]"><span style={{ color: MUTED }}>{fmt(t.at)}</span><span><b>{t.by}</b> — {t.text}</span></p>)}
        {(c.addenda || []).map((a: any, i: number) => <p key={`a${i}`} className="grid grid-cols-[110px_1fr] gap-3 text-[14px]"><span style={{ color: MUTED }}>{fmt(a.at)}</span><span><b>{a.by}</b> (added after closing) — {a.text}</span></p>)}
        <div className="flex gap-2 pt-1"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={c.locked ? 'Add a dated note to the closed case' : 'Add a note'} className="h-11 flex-1 rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} />
          <button type="button" disabled={busy || !note.trim()} onClick={async () => { if (await act(c.locked ? 'addendum' : 'note', { text: note }, 'Note added.')) setNote(''); }} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>Add</button></div>
      </Card>

      {!c.locked && (isManager || !c.safety) && c.status !== 'done' && <button type="button" disabled={busy} onClick={() => { const why = window.prompt('Why close it without a check-back?'); if (why != null) act('close', { text: why }, 'Closed.'); }} className="text-[14px] underline" style={{ color: MUTED }}>Close without checking back</button>}
      {err && <p className="sticky bottom-4 rounded-xl p-3 text-[14px] font-semibold" style={{ background: PINK, color: RED }}>{err}</p>}
      {ok && <p className="sticky bottom-4 rounded-xl p-3 text-[14px] font-semibold" style={{ background: '#e8f3ec', color: GREEN }}>{ok}</p>}
    </div>);
}

export default function CasesPage() {
  const { firestore, user } = useFirebase() as any; const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase()); const allowed = isManager || String(role) === 'front_desk';
  const S = React.useMemo(() => settingsOf(selectedTenant), [selectedTenant]); const tz = selectedTenant?.timezone || 'America/New_York';
  const cQ = useMemoFirebase(() => (firestore && tenantId && allowed ? collection(firestore as Firestore, `tenants/${tenantId}/cases`) : null), [firestore, tenantId, allowed]);
  const { data, isLoading } = useCollection<any>(cQ);
  const [pick, setPick] = React.useState<string>(''); const [starting, setStarting] = React.useState(false); const [showClosed, setShowClosed] = React.useState(false);
  React.useEffect(() => { const id = new URLSearchParams(window.location.search).get('id'); if (id) setPick(id); }, []);
  const all = data || []; const open = all.filter((c: any) => !c.locked).sort((a: any, b: any) => (b.safety ? 1 : 0) - (a.safety ? 1 : 0) || (a.firstReplyAt ? 1 : 0) - (b.firstReplyAt ? 1 : 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const closed = all.filter((c: any) => c.locked).sort((a: any, b: any) => String(b.closedAt).localeCompare(String(a.closedAt)));
  const c = all.find((x: any) => x.id === pick) || null;

  if (!allowed) return <div className="p-6"><AppHeader title="Making it right" /><p className="mt-6" style={{ color: MUTED }}>Cases are handled by the desk and managers.</p></div>;
  const Row = ({ x }: { x: any }) => { const clock = !x.firstReplyAt && !x.locked && x.replyDueAt ? left(x.replyDueAt) : null; return (
    <button type="button" onClick={() => { setPick(x.id); setStarting(false); }} className="block w-full rounded-[18px] border bg-white p-3.5 text-left" style={{ borderColor: pick === x.id ? INK : LINE, boxShadow: pick === x.id ? `0 0 0 1px ${INK}` : undefined }}>
      <div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-[15.5px] font-bold">{x.clientName}</p>{x.safety ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold" style={{ background: PINK, color: RED }}>SAFETY</span> : x.pending ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold" style={{ background: '#fff7e6' }}>NEEDS OK</span> : null}</div>
      <p className="truncate text-[14px]">{x.reasonLabel}{x.visit?.providerName ? ` · ${x.visit.providerName.split(' ')[0]}` : ''}</p>
      <p className="mt-1 text-[12.5px]" style={{ color: clock?.late ? RED : MUTED }}>{x.locked ? `Closed · ${x.fix?.label || 'no fix'}` : clock ? clock.text : STAGES[Math.min(4, stageIndex(x.status))]}{' · '}{x.number}</p>
    </button>); };

  return (
    <div className="flex min-h-screen flex-col bg-white" style={{ color: INK }}>
      <AppHeader title="Making it right" />
      <main className="grid flex-1 md:grid-cols-[360px_1fr]">
        <aside className="space-y-2.5 border-r p-4 md:p-6" style={{ borderColor: LINE, background: '#fafafa' }} aria-label="Cases">
          <div className="flex items-center justify-between gap-2 pb-1"><h1 className="text-[22px] font-bold tracking-tight">{open.length ? `${open.length} open` : 'All caught up'}</h1>
            <button type="button" onClick={() => { setStarting(true); setPick(''); }} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: INK, color: '#fff' }}>Start a case</button></div>
          {isLoading && <p className="text-[14px]" style={{ color: MUTED }}>Loading…</p>}
          {!isLoading && !open.length && <p className="text-[14px]" style={{ color: MUTED }}>No open cases. When a client isn’t happy, start one here — or a provider can from the staff app.</p>}
          {open.map((x: any) => <Row key={x.id} x={x} />)}
          {closed.length > 0 && <button type="button" onClick={() => setShowClosed(!showClosed)} className="pt-2 text-[14px] font-semibold" style={{ color: MUTED }}>{showClosed ? 'Hide' : 'Show'} {closed.length} closed</button>}
          {showClosed && closed.map((x: any) => <Row key={x.id} x={x} />)}
          {isManager && <a href="/settings/making-it-right" className="block pt-3 text-[14px] underline" style={{ color: MUTED }}>Your rules for making it right</a>}
        </aside>
        <section className="p-4 md:p-8">
          {starting ? <NewCase firestore={firestore} tenantId={tenantId} S={S} onDone={(id) => { setStarting(false); setPick(id); }} />
            : c ? <CaseView c={c} tenantId={tenantId} S={S} me={user?.uid || ''} isManager={isManager} tz={tz} />
            : <div className="mx-auto max-w-md space-y-2 pt-16 text-center"><p className="text-[20px] font-bold">Pick a case</p><p className="text-[15px]" style={{ color: MUTED }}>Every complaint gets an owner, a fix, and a check-back — and a record you can download.</p></div>}
        </section>
      </main>
    </div>);
}
