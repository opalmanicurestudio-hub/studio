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
import { settingsOf, FIX_LABEL, FIX_HINT, STAGES, stageIndex, WANTS, wantsFor, CAUSES, providerCaseStats, type FixKind } from '@/lib/making-it-right';

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


const tl = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const dl = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
/** Open times for the redo — same service, same length, the provider's real calendar. Picks one; the caller books it. */
function SlotPicker({ tenantId, caseId, onPick, busy, label }: { tenantId: string; caseId: string; onPick: (p: { staffId: string; date: string; time: string }) => void; busy: boolean; label: string }) {
  const [others, setOthers] = React.useState(false); const [data, setData] = React.useState<any>(null); const [who, setWho] = React.useState(''); const [day, setDay] = React.useState(''); const [time, setTime] = React.useState('');
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => { setData(null); payPost('/api/cases', { tenantId, id: caseId, action: 'redo_times', others }).then((d) => { setData(d); const p0 = (d.providers || []).find((p: any) => p.days.length); setWho(p0?.staffId || ''); setDay(p0?.days[0]?.date || ''); setTime(''); }); }, [tenantId, caseId, others, tick]);
  const choose = async (w: string | null) => { await payPost('/api/cases', { tenantId, id: caseId, action: 'redo_with', who: w }); setOthers(false); setTick((t) => t + 1); };
  const adv = data?.advice;
  const P = data?.providers?.find((p: any) => p.staffId === who); const D = P?.days.find((d: any) => d.date === day); const list = (data?.providers || []).filter((p: any) => p.days.length);
  return (
    <div className="space-y-3 rounded-2xl p-3.5" style={{ background: SOFT }}>
      {adv?.avoidOriginal && <div className="rounded-xl bg-white p-3 text-[13.5px]"><b>Suggesting someone else for the fix.</b> {adv.why}. The client is only offered other providers{adv.override === 'other' ? '' : ' — the person who did the visit isn’t shown'}.
        <button type="button" onClick={() => choose('original')} className="ml-1 font-semibold underline">Offer the original provider anyway</button></div>}
      {adv?.onlyOne && <div className="rounded-xl bg-white p-3 text-[13.5px]"><b>No one else does this service.</b> {adv.why ? `${adv.why}, so ` : ''}offer to do it yourself, or choose a refund or credit instead if that would feel better for them.</div>}
      {!adv?.avoidOriginal && adv?.override === 'original' && <p className="text-[13px]" style={{ color: MUTED }}>Offering the original provider (chosen by the team). <button type="button" onClick={() => choose(null)} className="underline">Undo</button></p>}
      {!adv?.avoidOriginal && !adv?.override && !adv?.onlyOne && data && <button type="button" onClick={() => choose('other')} className="text-[13px] underline" style={{ color: MUTED }}>Only offer other providers for this fix</button>}
      {!data ? <p className="text-[14px]" style={{ color: MUTED }}>Finding open times…</p> : !list.length ? <p className="text-[14px]">{data.error || (others ? 'No one else has an opening soon.' : 'No openings soon with the original provider.')}</p> : <>
        <div className="flex flex-wrap gap-2">{list.map((p: any) => <button key={p.staffId} type="button" onClick={() => { setWho(p.staffId); setDay(p.days[0].date); setTime(''); }} className="h-9 rounded-full px-3.5 text-[13.5px] font-semibold" style={who === p.staffId ? { background: INK, color: '#fff' } : { background: '#fff' }}>{p.name}{p.original ? ' (did the visit)' : ''}</button>)}</div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">{(P?.days || []).map((d: any) => <button key={d.date} type="button" onClick={() => { setDay(d.date); setTime(''); }} className="h-10 shrink-0 rounded-xl px-3 text-[13.5px] font-semibold" style={day === d.date ? { background: INK, color: '#fff' } : { background: '#fff' }}>{dl(d.date)}</button>)}</div>
        <div className="flex flex-wrap gap-1.5">{(D?.times || []).map((t: string) => <button key={t} type="button" onClick={() => setTime(t)} className="h-9 rounded-lg px-3 text-[13.5px] font-semibold" style={time === t ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` }}>{tl(t)}</button>)}</div>
        {data.minutes ? <p className="text-[12.5px]" style={{ color: MUTED }}>{data.minutes} min — the same length as the original visit.</p> : null}</>}
      <div className="flex flex-wrap items-center gap-3">
        {time && <button type="button" disabled={busy} onClick={() => onPick({ staffId: who, date: day, time })} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: INK, color: '#fff' }}>{busy ? 'Booking…' : `${label} ${dl(day)} at ${tl(time)}`}</button>}
        {!adv?.avoidOriginal && <button type="button" onClick={() => setOthers(!others)} className="text-[13.5px] underline" style={{ color: MUTED }}>{others ? 'Back to the original provider' : 'Someone else'}</button>}
      </div>
    </div>);
}


/** WHAT THE FIX IS: the same service again, or what the team decided from the photos — e.g. a removal, then a new service —
 *  with what the client pays (if anything) and a note for them. The times offered fit the whole plan. */
function PlanEditor({ v, services, value, onChange }: { v: any; services: any[]; value: any; onChange: (p: any) => void }) {
  const [diff, setDiff] = React.useState(!!value); const [ids, setIds] = React.useState<string[]>(value?.serviceIds || []); const [pay, setPay] = React.useState(value?.priceCents ? String(value.priceCents / 100) : ''); const [note, setNote] = React.useState(value?.note || ''); const [add, setAdd] = React.useState('');
  const list = (services || []).filter((x: any) => !x.archived && x.isActive !== false).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  const picked = ids.map((id) => list.find((x: any) => x.id === id)).filter(Boolean) as any[];
  const minutes = picked.reduce((x, sv) => x + (Number(sv.duration) || 30), 0); const listPrice = picked.reduce((x, sv) => x + (Number(sv.price) || 0), 0);
  React.useEffect(() => { onChange(diff && ids.length ? { serviceIds: ids, names: picked.map((x) => x.name), minutes, priceCents: Math.round((Number(pay) || 0) * 100), note: note.trim() || null } : null); }, [diff, ids.join(','), pay, note]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-2.5 rounded-2xl border p-3.5" style={{ borderColor: LINE }}>
      <p className="text-[13px] font-bold" style={{ color: MUTED }}>WHAT WE’LL DO</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setDiff(false)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={!diff ? { background: INK, color: '#fff' } : { background: SOFT }}>The same service again{v.serviceName ? ` (${v.serviceName})` : ''}</button>
        <button type="button" onClick={() => setDiff(true)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={diff ? { background: INK, color: '#fff' } : { background: SOFT }}>Something different</button>
      </div>
      {diff && <>
        <p className="text-[13px]" style={{ color: MUTED }}>From the photos, what does it need? Add the services in the order they’ll be done — e.g. a removal, then the new service.</p>
        <ol className="space-y-1.5">{picked.map((sv, i) => <li key={sv.id} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[14.5px]" style={{ background: SOFT }}><b>{i + 1}.</b><span className="flex-1">{sv.name} <span style={{ color: MUTED }}>· {Number(sv.duration) || 30} min</span></span>
          {i > 0 && <button type="button" aria-label="Move up" onClick={() => setIds(ids.map((x, j) => (j === i - 1 ? ids[i] : j === i ? ids[i - 1] : x)))} className="px-1">↑</button>}
          <button type="button" aria-label="Remove" onClick={() => setIds(ids.filter((x) => x !== sv.id))} className="px-1" style={{ color: RED }}>×</button></li>)}</ol>
        {ids.length < 4 && <select value={add} onChange={(e) => { if (e.target.value) setIds([...ids, e.target.value]); setAdd(''); }} className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }}>
          <option value="">Add a service…</option>{list.filter((x: any) => !ids.includes(x.id)).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        {ids.length > 0 && <p className="text-[13.5px]">Takes about <b>{minutes} min</b> in all — only times with room for all of it are offered.</p>}
        <label className="flex flex-wrap items-center gap-2 text-[14.5px]">Client pays $<input type="number" inputMode="decimal" min={0} value={pay} onChange={(e) => setPay(e.target.value)} placeholder="0" className="h-10 w-24 rounded-xl border px-3" style={{ borderColor: LINE }} />
          <span className="text-[12.5px]" style={{ color: MUTED }}>{listPrice ? `Listed at $${listPrice.toFixed(2)}` : ''}{v.paid ? `${listPrice ? '; ' : ''}they paid $${Number(v.paid).toFixed(2)} for the visit` : ''}. Leave 0 for no charge.</span></label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="A note for them, e.g. From your photos the product needs to come off first so the new set lasts." className="w-full rounded-xl border p-3 text-[14.5px]" style={{ borderColor: LINE }} />
      </>}
    </div>);
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
        <div className="flex flex-wrap gap-2">{wantsFor(S).map((w) => [w.id, w.client]).map(([k, l]) => <button key={k} type="button" onClick={() => setWants(wants === k ? '' : k)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={wants === k ? { background: INK, color: '#fff' } : { background: SOFT }}>{l}</button>)}</div></div>
      {err && <p className="text-[14px] font-semibold" style={{ color: RED }}>{err}</p>}
      <button type="button" disabled={busy || (!reason && !words.trim()) || (!visit && !name.trim())} onClick={go} className={btn} style={{ background: INK, color: '#fff' }}>{busy ? 'Starting…' : 'Start the case'}</button>
    </div>);
}

function CaseView({ c, tenantId, S, me, isManager, tz, services, solo }: { c: any; tenantId: string; S: any; me: string; isManager: boolean; tz: string; services: any[]; solo?: boolean }) {
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [ok, setOk] = React.useState('');
  const [kind, setKind] = React.useState<FixKind | ''>(''); const [amt, setAmt] = React.useState(''); const [redoMode, setRedoMode] = React.useState<'client' | 'book'>('client'); const [move, setMove] = React.useState(false); const [plan, setPlan] = React.useState<any>(null); const [editPlan, setEditPlan] = React.useState(false);
  const [msg, setMsg] = React.useState(''); const [note, setNote] = React.useState(''); const [inc, setInc] = React.useState<any>({}); const [stmt, setStmt] = React.useState(''); const [cb, setCb] = React.useState('');
  React.useEffect(() => { setKind(''); setAmt(''); setRedoMode('client'); setMove(false); setErr(''); setOk(''); setInc({}); }, [c.id]);
  const act = async (action: string, extra: any = {}, done = 'Saved.') => { setBusy(true); setErr(''); setOk(''); const r = await payPost('/api/cases', { tenantId, id: c.id, action, ...extra }); setBusy(false); if (r.ok) { setOk(r.pending ? `Sent to a manager — ${r.why}` : action === 'message' && r.sent === false ? 'Saved on the case — we couldn’t text them, so call or message them too.' : done); return true; } setErr(r.error || 'That didn’t work.'); return false; };
  const v = c.visit || {}; const sensitive = !!(c.preferOther || c.safety || /treat|rude|manner|attitude|behav/i.test(`${c.reasonId} ${c.reasonLabel}`));
  const order: FixKind[] = solo && sensitive ? ['refund', 'credit', 'redo', 'addon', 'replace', 'note'] : (Object.keys(FIX_LABEL) as FixKind[]);
  const fixes = order.filter((k) => S.fixes[k]); const fixLabel = (k: FixKind) => (solo && k === 'redo' ? 'Fix it myself' : FIX_LABEL[k]);
  const clock = !c.firstReplyAt && c.replyDueAt && c.status !== 'closed' ? left(c.replyDueAt) : null;
  const dl = async (k: 'record' | 'incident') => { try { await download(tenantId, c.id, k, c.number); } catch (e: any) { setErr(e.message); } };
  const dispute = async () => { try { const tk = await getAuth().currentUser?.getIdToken().catch(() => ''); const r = await fetch(`/api/disputes/pack?tenantId=${encodeURIComponent(tenantId)}&caseId=${encodeURIComponent(c.id)}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'That didn’t download — try again.'); }
    const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = `dispute-${c.number}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); } catch (e: any) { setErr(e.message); } };
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
  const Card = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="space-y-2 rounded-[18px] border p-4" style={{ borderColor: LINE }}><p className="text-[12px] font-bold tracking-wide" style={{ color: MUTED }}>{title}</p>{children}</div>;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        {c.safety && <p className="rounded-xl px-3.5 py-2.5 text-[14px] font-bold" style={{ background: PINK, color: RED }}>Safety case — a manager owns this and fills in the incident report.</p>}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[13px] font-semibold" style={{ color: MUTED }}>{c.number} · {VIA[c.via] || c.via} · {ago(c.createdAt)} ago</p>
            <h2 className="text-[26px] font-bold leading-tight tracking-tight">{c.clientName}</h2>
            <p className="text-[16px]">{c.reasonLabel}</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => dl('record')} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>Case record (PDF)</button>
            {c.visit?.appointmentId && <button type="button" onClick={dispute} title="Everything a card processor asks for if the client disputes the charge" className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>Card dispute pack (PDF)</button>}
            {(c.safety || c.kind === 'incident') && <button type="button" onClick={() => dl('incident')} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: PINK, color: RED }}>Incident report (PDF)</button>}
          </div>
        </div>
        <StageRail status={c.status} />
        <div className="flex flex-wrap gap-2 text-[13.5px]">
          <span className="rounded-full px-3 py-1" style={{ background: SOFT }}>{c.ownerName ? `Owned by ${c.ownerName}` : 'No one owns this yet'}</span>
          {clock && <span className="rounded-full px-3 py-1 font-semibold" style={clock.late ? { background: PINK, color: RED } : { background: SOFT }}>{clock.text}</span>}
          {c.locked && <span className="rounded-full px-3 py-1 font-semibold" style={{ background: '#e8f3ec', color: GREEN }}>Closed {c.closedAt ? new Date(c.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''} · locked</span>}
        </div>
      </header>

      {!solo && !c.ownerId && !c.locked && (!c.safety || isManager) && <button type="button" disabled={busy} onClick={() => act('own', {}, 'It’s yours.')} className={btn} style={{ background: INK, color: '#fff' }}>I’ll take this</button>}

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="WHAT THEY SAID">
          <p className="text-[16px] leading-snug">{c.words ? `“${c.words}”` : !c.voice ? <span style={{ color: MUTED }}>No words recorded.</span> : null}</p>
          {c.wordsEn && <p className="rounded-xl p-3 text-[14.5px]" style={{ background: SOFT }}><b>In English:</b> {c.wordsEn}</p>}
          {c.preferOther && <p className="text-[14px] font-semibold">They’d prefer someone else for the fix.</p>}
          {c.wants && <p className="text-[14px]" style={{ color: MUTED }}>Hoping for: <b style={{ color: INK }}>{WANTS.find((w) => w.id === c.wants)?.team}</b></p>}
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
            <div className="space-y-1 border-t pt-2 text-[13.5px]" style={{ borderColor: LINE }}>
              {v.agreedAtBooking && <p>✓ Agreed to the Making it right policy when booking</p>}
              <p>{(v.consents || []).length ? <>✓ Signed: {(v.consents || []).map((x: any) => x.title).join(', ')}</> : <span style={{ color: MUTED }}>No signed consent on file</span>}</p>
              <p>{v.aftercareSentAt ? <>✓ Aftercare sent {fmt(v.aftercareSentAt)}</> : <span style={{ color: MUTED }}>No aftercare on record</span>}</p>
              {(v.afterPhotos || []).length ? <div className="space-y-1"><p>✓ After photo{v.afterPhotos.length === 1 ? '' : 's'} from the visit</p><div className="flex gap-2 overflow-x-auto">{v.afterPhotos.map((u: string) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="After the visit" className="h-20 w-20 rounded-xl object-cover" /></a>)}</div></div> : <p style={{ color: MUTED }}>No after photo</p>}
            </div>
            <a href={`/pos?visit=${v.appointmentId}`} className="text-[14px] font-bold underline">Open the visit</a></> : <p className="text-[14px]" style={{ color: MUTED }}>No visit linked.</p>}
        </Card>
      </div>

      {(!solo || c.kind === 'incident' || (c.statements || []).length > 0) && <Card title={c.kind === 'incident' ? 'STATEMENTS' : solo ? 'NOTES' : 'EVERYONE’S SIDE'}>
        {c.sideWanted && !c.locked && <p className="rounded-xl px-3 py-2 text-[14px] font-semibold" style={{ background: '#fff7e6' }}>Waiting for {v.providerName ? v.providerName.split(' ')[0] : 'the provider'}’s side — they’ve been asked in the staff app.</p>}
        {[...(c.statements || []), ...(c.incident?.statements || [])].map((st: any, i: number) => <div key={i} className="space-y-1 border-b pb-2 last:border-0" style={{ borderColor: LINE }}>
          <p className="text-[13px]" style={{ color: MUTED }}><b style={{ color: INK }}>{st.by}</b> · {fmt(st.at)} · signed</p>
          {st.text && <p className="text-[15px]">“{st.text}”</p>}{st.textEn && <p className="text-[14px]" style={{ color: MUTED }}><b>In English:</b> {st.textEn}</p>}
          {st.voice?.url && <audio controls src={st.voice.url} className="w-full" />}{st.voice?.translation && <p className="text-[14px]" style={{ color: MUTED }}><b>In English:</b> {st.voice.translation}</p>}</div>)}
        {!(c.statements || []).length && !(c.incident?.statements || []).length && !c.sideWanted && <p className="text-[14px]" style={{ color: MUTED }}>No statements yet.</p>}
        {!c.locked && <div className="flex gap-2"><input value={stmt} onChange={(e) => setStmt(e.target.value)} placeholder="Your account (signed with your name)" className="h-11 flex-1 rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /><button type="button" disabled={busy || !stmt.trim()} onClick={async () => { if (await act('statement', { text: stmt }, 'Statement signed.')) setStmt(''); }} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>Sign it</button></div>}
      </Card>}

      {isManager && c.kind !== 'incident' && <Card title={solo ? 'WHAT CAUSED IT (JUST FOR YOU)' : 'WHAT CAUSED IT'}>
        <div className="flex flex-wrap gap-2">{Object.entries(CAUSES).map(([k, d]) => <button key={k} type="button" disabled={busy} onClick={() => act('cause', { cause: k }, 'Cause saved.')} className="min-h-10 rounded-full px-4 text-[14px] font-semibold" style={c.cause === k ? { background: INK, color: '#fff' } : { background: SOFT }}>{d.label}</button>)}</div>
        {!solo && <p className="text-[13px]" style={{ color: MUTED }}>Only “The work itself” counts in {v.providerName ? `${v.providerName.split(' ')[0]}’s` : 'the provider’s'} numbers. {c.sideWanted ? 'Their side isn’t in yet.' : ''}</p>}
      </Card>}

      <Card title="FAIR-USE CHECK">
        {(c.checks || []).length === 0 ? <p className="text-[14px]" style={{ color: MUTED }}>Nothing to check.</p> :
          (c.checks || []).map((k: any) => <p key={k.key} className="flex items-start gap-2.5 text-[14.5px]"><span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: k.ok ? GREEN : RED }}>{k.ok ? '✓' : '!'}</span><span><b>{k.title}</b> <span style={{ color: MUTED }}>— {k.detail}</span></span></p>)}
        {(c.checks || []).some((k: any) => !k.ok) && <p className="text-[13.5px]" style={{ color: MUTED }}>Not a no — it means a manager decides this one.</p>}
      </Card>

      {c.pending && <div className="space-y-3 rounded-[18px] p-4" style={{ background: '#fff7e6' }}>
        <p className="text-[15px]"><b>{c.pending.askedBy}</b> wants to give <b>{FIX_LABEL[c.pending.kind as FixKind]}{c.pending.amountCents ? ` $${(c.pending.amountCents / 100).toFixed(2)}` : ''}</b>. {c.pending.why}</p>
        {isManager ? <button type="button" disabled={busy} onClick={() => act('approve', {}, 'Approved.')} className={btn} style={{ background: INK, color: '#fff' }}>Approve</button> : <p className="text-[14px]" style={{ color: MUTED }}>Waiting for a manager.</p>}
      </div>}

      {solo && sensitive && !c.locked && !c.fix && <p className="rounded-xl p-3 text-[14px]" style={{ background: '#fff7e6' }}><b>You’re the only provider.</b> {c.preferOther ? 'They asked for someone else, so a' : 'Another visit might not feel right for either of you. A'} refund or credit is listed first; fixing it yourself is still an option.</p>}
      {!c.locked && !c.fix && !c.pending && <Card title={solo ? 'WHAT WILL YOU DO?' : 'CHOOSE THE FIX'}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">{fixes.map((k) => <button key={k} type="button" onClick={() => setKind(k)} className="rounded-2xl border p-3 text-left" style={kind === k ? { borderColor: INK, background: INK, color: '#fff' } : { borderColor: LINE }}><span className="block text-[15px] font-bold">{fixLabel(k)}</span><span className="block text-[12.5px] opacity-75">{FIX_HINT[k]}</span></button>)}</div>
        {(kind === 'refund' || kind === 'credit') && <label className="flex items-center gap-2 text-[15px]">Amount $<input type="number" inputMode="decimal" min={0} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={v.paid ? Number(v.paid).toFixed(2) : '0.00'} className="h-11 w-32 rounded-xl border px-3" style={{ borderColor: LINE }} />
          {kind === 'refund' && v.paid ? <span className="text-[13px]" style={{ color: MUTED }}>of ${Number(v.paid).toFixed(2)} paid</span> : null}</label>}
        {kind === 'redo' && <div className="space-y-2.5">
          <PlanEditor v={v} services={services} value={null} onChange={setPlan} />
          <div className="flex flex-wrap gap-2">{([['client', 'Let them pick a time'], ['book', 'Book it now']] as const).map(([m, l]) => <button key={m} type="button" onClick={() => setRedoMode(m)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={redoMode === m ? { background: INK, color: '#fff' } : { background: SOFT }}>{l}</button>)}</div>
          <p className="text-[13px]" style={{ color: MUTED }}>{redoMode === 'client' ? `We text them a link to choose from ${v.providerName ? `${v.providerName.split(' ')[0]}’s` : 'the'} open times. If none work, they can see someone else or tell you when suits them.` : 'Already agreed a time with them? Pick it here.'}</p>
          {redoMode === 'book' && (plan ? <p className="text-[13px]" style={{ color: MUTED }}>Save the plan first (Offer the fix), then use “Book it for them” to pick a time that fits it.</p> : <SlotPicker tenantId={tenantId} caseId={c.id} busy={busy} label="Book" onPick={async (pk) => { if (await act('choose_fix', { kind: 'redo', redo: { mode: 'book', ...pk } }, 'Redo booked.')) setKind(''); }} />)}
        </div>}
        {kind && !(kind === 'redo' && redoMode === 'book' && !plan) && <button type="button" disabled={busy || ((kind === 'refund' || kind === 'credit') && !(Number(amt) > 0))} onClick={async () => { if (await act('choose_fix', { kind, amountCents: Math.round((Number(amt) || 0) * 100), redo: kind === 'redo' ? { mode: redoMode === 'book' ? 'team' : 'client', plan } : null }, kind === 'redo' ? (redoMode === 'book' ? 'Fix saved — now book it for them.' : 'Fix offered — they’ll pick a time.') : 'Fix chosen.')) setKind(''); }} className={btn} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : kind === 'redo' ? (redoMode === 'book' ? 'Save the fix' : plan ? 'Offer the fix' : 'Offer the free redo') : `Go with ${FIX_LABEL[kind].toLowerCase()}`}</button>}
      </Card>}

      {c.fix && <Card title="THE FIX">
        <p className="text-[16px]"><b>{c.fix.label}{c.fix.amountCents ? ` $${(c.fix.amountCents / 100).toFixed(2)}` : ''}</b> · chosen by {c.fix.by}{c.fix.approvedBy && c.fix.approvedBy !== c.fix.by ? `, approved by ${c.fix.approvedBy}` : ''}</p>
        {c.fix.kind === 'redo' && (() => { const r = c.fix.redo || {}; const booked = !!c.fix.redoAppointmentId;
          return <div className="space-y-2">
            {r.plan && <p className="text-[14.5px]"><b>Plan:</b> {(r.plan.names || []).join(' → ')} · {r.plan.priceCents ? `client pays $${(r.plan.priceCents / 100).toFixed(2)}` : 'no charge'}{r.plan.note ? <span style={{ color: MUTED }}> — “{r.plan.note}”</span> : null}</p>}
            {!booked && !c.locked && (editPlan ? <div className="space-y-2"><PlanEditor v={v} services={services} value={r.plan || null} onChange={setPlan} /><button type="button" disabled={busy} onClick={async () => { if (await act('plan', { plan }, 'Plan updated — we’ve texted them.')) setEditPlan(false); }} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: INK, color: '#fff' }}>Save the plan</button></div>
              : <button type="button" onClick={() => setEditPlan(true)} className="text-[14px] font-semibold underline">Change what we’ll do</button>)}
            <p className="text-[14.5px]">{booked ? <>Booked: <b>{r.startTime ? fmt(r.startTime) : ''}</b>{r.changes ? ` · moved by the client ${r.changes}×` : ''}</> : r.state === 'needs_time' ? <><b style={{ color: RED }}>None of the times work for them.</b>{r.note ? ` They said: “${r.note}”` : ''}</> : 'Waiting for them to pick a time.'}</p>
            {!c.locked && c.status === 'fix_chosen' && (move || (!booked && r.state === 'needs_time') ? <SlotPicker tenantId={tenantId} caseId={c.id} busy={busy} label={booked ? 'Move to' : 'Book'} onPick={async (pk) => { if (await act('redo_book', pk, booked ? 'Redo moved — we’ve texted them.' : 'Redo booked — we’ve texted them.')) setMove(false); }} />
              : <button type="button" onClick={() => setMove(true)} className="text-[14px] font-semibold underline">{booked ? 'Move it' : 'Book it for them'}</button>)}
          </div>; })()}
        {c.fix.todo && c.status === 'fix_chosen' && <p className="rounded-xl p-3 text-[14px] font-semibold" style={{ background: '#fff7e6' }}>To do: {c.fix.todo}</p>}
        {c.fix.kind === 'refund' && c.fix.amountCents > 0 && c.status === 'fix_chosen' && !c.fix.refundedAt && <RefundGiving c={c} tenantId={tenantId} busy={busy} onCard={() => { if (window.confirm(`Send $${(c.fix.amountCents / 100).toFixed(2)} back to their card now?`)) act('refund_card', {}, 'Refunded to their card — we’ve texted them.'); }} />}
        {c.fix.refundedAt && <p className="rounded-xl p-3 text-[14px]" style={{ background: '#eef8f1' }}><b>{c.fix.refundVia === 'Store credit' ? `Gave $${((c.fix.refundedCents || 0) / 100).toFixed(2)} as store credit` : `Refunded $${((c.fix.refundedCents || 0) / 100).toFixed(2)} ${c.fix.refundVia ? (c.fix.refundVia === 'Cash' ? 'in cash' : `by ${c.fix.refundVia}`) : 'to their card'}`}</b> · {new Date(c.fix.refundedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.{c.fix.refundVia === 'Store credit' ? ' It’s on their account.' : ' It’s in Money as a refund.'}</p>}
        {c.status === 'fix_chosen' && <button type="button" disabled={busy} onClick={() => act('done', {}, S.followUpDays ? 'Marked done. We’ll remind you to check back.' : 'Marked done. Their page now asks if we made it right.')} className={btn} style={{ background: INK, color: '#fff' }}>It’s done</button>}
        {c.status === 'done' && <div className="space-y-2"><p className="text-[14.5px]">Check back{c.followUpAt ? ` around ${new Date(c.followUpAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}: <b>did we make it right?</b></p>
          <input value={cb} onChange={(e) => setCb(e.target.value)} placeholder="What they said (optional)" className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} />
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => act('checked_back', { answer: 'yes', note: cb }, 'Closed. Nice work.')} className={btn} style={{ background: GREEN, color: '#fff' }}>Yes — close the case</button>
            <button type="button" disabled={busy} onClick={() => act('checked_back', { answer: 'no', note: cb }, 'Reopened.')} className={btn} style={{ background: SOFT }}>Still not right</button></div></div>}
      </Card>}

      {(c.safety || c.kind === 'incident') && <Card title="INCIDENT REPORT">
        {[['whatHappened', 'What happened'], ['where', 'Where (chair, room, station)'], ['kit', 'Kit or tools used'], ['cycle', 'Sterilization record'], ['firstAid', 'First aid given'], ['advice', 'Advice given to the client']].map(([k, l]) => (
          <label key={k} className="block space-y-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>{l}</span>
            <input defaultValue={c.incident?.[k] || ''} disabled={!isManager || c.locked} onChange={(e) => setInc({ ...inc, [k]: e.target.value })} className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /></label>))}
        <label className="block space-y-1"><span className="text-[13px] font-semibold" style={{ color: MUTED }}>Who was there (comma between names)</span>
          <input defaultValue={(c.incident?.present || []).join(', ')} disabled={!isManager || c.locked} onChange={(e) => setInc({ ...inc, present: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /></label>
        {isManager && !c.locked && <button type="button" disabled={busy || !Object.keys(inc).length} onClick={async () => { if (await act('incident', { incident: inc }, 'Incident report saved.')) setInc({}); }} className={btn} style={{ background: INK, color: '#fff' }}>Save the report</button>}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: LINE }}>
          {c.incident?.checkIn48At ? <p className="text-[14.5px]" style={{ color: GREEN }}><b>Follow-up check-in done</b> {fmt(c.incident.checkIn48At)}{c.incident.checkIn48Note ? ` — ${c.incident.checkIn48Note}` : ''}</p> :
            isManager && !c.locked && <><input placeholder="Follow-up check-in: how are they?" onChange={(e) => setInc({ ...inc, checkIn48Note: e.target.value })} className="h-11 flex-1 rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /><button type="button" disabled={busy} onClick={() => act('incident', { incident: { checkIn48: true, checkIn48Note: inc.checkIn48Note || '' } }, 'Check-in recorded.')} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>Record check-in</button></>}
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


/** Each provider's numbers, fairly: only cases marked "the work itself" count. */
function ByProvider({ cases }: { cases: any[] }) {
  const ids = [...new Set(cases.map((c) => c.visit?.providerId).filter(Boolean))] as string[]; if (ids.length < 2) return null;
  const rows = ids.map((id) => ({ id, name: cases.find((c) => c.visit?.providerId === id)?.visit?.providerName || 'Provider', ...providerCaseStats(cases, id) })).sort((a, b) => b.counted - a.counted || b.total - a.total);
  return (
    <div className="space-y-1.5 pt-4"><p className="text-[12px] font-bold tracking-wide" style={{ color: MUTED }}>BY PROVIDER</p>
      {rows.map((r) => <p key={r.id} className="flex justify-between gap-2 text-[14px]"><span className="truncate">{r.name}</span><span><b>{r.counted}</b> <span style={{ color: MUTED }}>of {r.total}{r.unmarked ? ` · ${r.unmarked} to mark` : ''}{r.incidents ? ` · ${r.incidents} incident${r.incidents === 1 ? '' : 's'}` : ''}</span></span></p>)}
      <p className="text-[12px]" style={{ color: MUTED }}>Counted = cause marked “the work itself”.</p></div>);
}

/** CLIENT CONDUCT reports from providers — never shown to the client. A manager decides what happens next. */
function Conduct({ firestore, tenantId }: { firestore: any; tenantId: string }) {
  const q = useMemoFirebase(() => (firestore && tenantId ? collection(firestore as Firestore, `tenants/${tenantId}/conductReports`) : null), [firestore, tenantId]);
  const { data } = useCollection<any>(q); const [open, setOpen] = React.useState(''); const [acts, setActs] = React.useState<string[]>([]); const [note, setNote] = React.useState(''); const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { const id = new URLSearchParams(window.location.search).get('conduct'); if (id) setOpen(id); }, []);
  const list = (data || []).slice().sort((a: any, b: any) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!list.length) return null; const r = list.find((x: any) => x.id === open);
  const OPTS: [string, string][] = [['note', 'Add a note to their profile'], ['deposit', 'Ask for a deposit to book'], ['manager_present', 'A manager on site for their visits'], ['not_with_provider', 'Don’t book them with this provider'], ['none', 'No action']];
  return (
    <div className="space-y-2 pt-4"><p className="text-[12px] font-bold tracking-wide" style={{ color: MUTED }}>CLIENT CONDUCT · {list.filter((x: any) => x.status === 'open').length} to look at</p>
      {list.slice(0, 6).map((x: any) => <button key={x.id} type="button" onClick={() => { setOpen(open === x.id ? '' : x.id); setActs([]); setNote(''); }} className="block w-full rounded-[16px] border bg-white p-3 text-left" style={{ borderColor: x.status === 'open' ? '#e7b04f' : LINE }}>
        <p className="text-[14.5px] font-bold">{x.clientName} <span className="font-normal" style={{ color: MUTED }}>· {x.staffName?.split(' ')[0]}</span></p>
        <p className="truncate text-[13px]" style={{ color: MUTED }}>{x.status === 'open' ? (x.stopped ? 'Service stopped · ' : '') + (x.wordsEn || x.words || 'Voice note') : `Decided: ${(x.decision?.actions || []).join(', ').replace(/_/g, ' ')}`}</p></button>)}
      {r && <div className="space-y-2 rounded-[16px] p-3" style={{ background: SOFT }}>
        {r.words && <p className="text-[14px]">“{r.words}”</p>}{r.wordsEn && <p className="text-[13.5px]" style={{ color: MUTED }}>In English: {r.wordsEn}</p>}
        {r.voice?.url && <audio controls src={r.voice.url} className="w-full" />}{r.voice?.translation && <p className="text-[13.5px]" style={{ color: MUTED }}>In English: {r.voice.translation}</p>}
        {r.status === 'open' ? <>
          {OPTS.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={acts.includes(k)} onChange={(e) => setActs(e.target.checked ? [...acts.filter((a) => (k === 'none' ? false : a !== 'none')), k] : acts.filter((a) => a !== k))} />{l}</label>)}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note (shows on their profile if you add one)" className="w-full rounded-xl border p-2.5 text-[14px]" style={{ borderColor: LINE }} />
          <button type="button" disabled={busy || !acts.length} onClick={async () => { setBusy(true); await payPost('/api/cases', { tenantId, action: 'conduct_decide', id: r.id, actions: acts, note }); setBusy(false); setOpen(''); }} className="h-10 rounded-full px-4 text-[14px] font-semibold disabled:opacity-40" style={{ background: INK, color: '#fff' }}>Save decision</button>
          <p className="text-[12px]" style={{ color: MUTED }}>The provider is told a manager looked at it. The client never sees this.</p></> : <p className="text-[13.5px]">Decided by {r.decision?.by}{r.decision?.note ? ` — “${r.decision.note}”` : ''}</p>}
      </div>}
    </div>);
}

/** Giving a refund fix: back to the card for card sales; for cash sales, pickup / app / credit — staff pick or the client chooses. */
function RefundGiving({ c, tenantId, busy, onCard }: { c: any; tenantId: string; busy: boolean; onCard: () => void }) {
  const [info, setInfo] = React.useState<any>(null); const [mode, setMode] = React.useState<'client' | 'staff'>('client'); const [m, setM] = React.useState('');
  const [wins, setWins] = React.useState<any[] | null>(null); const [w, setW] = React.useState<any>(null); const [handle, setHandle] = React.useState(''); const [name, setName] = React.useState('');
  const [saving, setSaving] = React.useState(false); const [err, setErr] = React.useState(''); const [done, setDone] = React.useState('');
  React.useEffect(() => { payPost('/api/refund-payouts', { tenantId, action: 'sale_kind', caseId: c.id }).then(setInfo); }, [tenantId, c.id]);
  React.useEffect(() => { if (m === 'pickup' && !wins) payPost('/api/refund-payouts', { tenantId, action: 'windows' }).then((r) => setWins(r.windows || [])); }, [m, wins, tenantId]);
  const amt = `$${(c.fix.amountCents / 100).toFixed(2)}`;
  if (c.payoutId) return <a href={`/refunds?id=${c.payoutId}`} className="block rounded-xl p-3 text-[14px]" style={{ background: SOFT }}><b>Cash refund is set up.</b> Follow it in Refunds to give →</a>;
  if (!info) return <p className="text-[13.5px]" style={{ color: MUTED }}>Checking how they paid…</p>;
  if (info.kind === 'card') return <button type="button" disabled={busy} onClick={onCard} className={btn} style={{ background: GREEN, color: '#fff' }}>Refund {amt} to their card</button>;
  const M = (info.methods || []).find((x: any) => x.id === m);
  const tl2 = (t: string) => { const h = Number(t.slice(0, 2)); const mm = t.slice(3, 5); return `${h % 12 || 12}${mm === '00' ? '' : `:${mm}`}${h < 12 ? 'am' : 'pm'}`; };
  const save = async () => { setSaving(true); setErr(''); const r = await payPost('/api/refund-payouts', { tenantId, action: 'create', caseId: c.id, mode, method: m, pickup: w, handle, accountName: name }); setSaving(false); if (r.ok) setDone(mode === 'client' ? (r.sent ? 'Texted them the choices.' : 'Saved — we couldn’t text them, so share the link from Refunds to give.') : 'Set up — follow it in Refunds to give.'); else setErr(r.error || 'That didn’t work.'); };
  if (done) return <p className="rounded-xl p-3 text-[14px] font-semibold" style={{ background: '#eef8f1' }}>{done}</p>;
  if (!(info.methods || []).length) return <p className="rounded-xl p-3 text-[14px]" style={{ background: '#fff7e6' }}>{info.kind === 'cash' ? 'They paid in cash.' : 'No card payment was found for this visit.'} Turn on a way to give cash refunds in Settings → Making it right.</p>;
  return <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: LINE }}>
    <p className="text-[14.5px]"><b>{info.kind === 'cash' ? 'They paid in cash' : 'No card payment found for this visit'}</b>, so {amt} can’t go back to a card.</p>
    <div className="inline-flex rounded-full p-1" style={{ background: SOFT }}>{(['client', 'staff'] as const).map((x) => <button key={x} type="button" onClick={() => setMode(x)} className="h-10 rounded-full px-4 text-[14px]" style={mode === x ? { background: INK, color: '#fff' } : { color: MUTED }}>{x === 'client' ? `Let ${String(c.clientName || 'them').split(' ')[0]} choose` : 'I’ll pick'}</button>)}</div>
    {mode === 'client' ? <p className="text-[13.5px]" style={{ color: MUTED }}>They’ll get a text with: {(info.methods || []).map((x: any) => x.label).join(', ')}.</p> : <>
      <div className="flex flex-wrap gap-2">{info.methods.map((x: any) => <button key={x.id} type="button" onClick={() => { setM(x.id); setW(null); }} className="h-10 rounded-full border px-4 text-[14px]" style={m === x.id ? { background: INK, color: '#fff', borderColor: INK } : { borderColor: LINE }}>{x.label}</button>)}</div>
      {m === 'pickup' && (wins === null ? <p className="text-[13.5px]" style={{ color: MUTED }}>Finding times…</p> : <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setW(null)} className="h-10 rounded-full border px-3.5 text-[13.5px]" style={!w ? { background: INK, color: '#fff', borderColor: INK } : { borderColor: LINE }}>Let them pick a time</button>{wins.slice(0, 10).map((x: any) => { const on = w && w.date === x.date && w.start === x.start; return <button key={x.date + x.start} type="button" onClick={() => setW(x)} className="h-10 rounded-full border px-3.5 text-[13.5px]" style={on ? { background: INK, color: '#fff', borderColor: INK } : { borderColor: LINE }}>{x.dayLabel} {tl2(x.start)}–{tl2(x.end)}</button>; })}</div>)}
      {M?.ask && <div className="grid gap-2 sm:grid-cols-2"><input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={M.placeholder || M.ask} aria-label={M.ask} className="h-11 rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name on the account" aria-label="Name on the account" className="h-11 rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /></div>}</>}
    {err && <p className="text-[14px] font-semibold" style={{ color: RED }}>{err}</p>}
    <button type="button" disabled={saving || (mode === 'staff' && (!m || (!!M?.ask && !handle)))} onClick={save} className={btn} style={{ background: INK, color: '#fff' }}>{saving ? 'Saving…' : mode === 'client' ? 'Text them the choices' : m === 'credit' ? `Add ${amt} as credit` : m === 'pickup' ? (w ? 'Book pickup and text them' : 'Text them to pick a time') : 'Save and text them'}</button>
  </div>;
}

export default function CasesPage() {
  const { firestore, user } = useFirebase() as any; const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase()); const allowed = isManager || String(role) === 'front_desk';
  const S = React.useMemo(() => settingsOf(selectedTenant), [selectedTenant]); const tz = selectedTenant?.timezone || 'America/New_York';
  const cQ = useMemoFirebase(() => (firestore && tenantId && allowed ? collection(firestore as Firestore, `tenants/${tenantId}/cases`) : null), [firestore, tenantId, allowed]);
  const { data, isLoading } = useCollection<any>(cQ);
  const sQ = useMemoFirebase(() => (firestore && tenantId && allowed ? collection(firestore as Firestore, `tenants/${tenantId}/services`) : null), [firestore, tenantId, allowed]);
  const stQ = useMemoFirebase(() => (firestore && tenantId && allowed ? collection(firestore as Firestore, `tenants/${tenantId}/staff`) : null), [firestore, tenantId, allowed]);
  const { data: staffRows } = useCollection<any>(stQ);
  const solo = !!staffRows && staffRows.filter((m: any) => m.archived !== true && m.isActive !== false && m.role !== 'renter').length <= 1;
  const { data: services } = useCollection<any>(sQ);
  const [pick, setPick] = React.useState<string>(''); const [starting, setStarting] = React.useState(false); const [showClosed, setShowClosed] = React.useState(false);
  React.useEffect(() => { const id = new URLSearchParams(window.location.search).get('id'); if (id) setPick(id); }, []);
  // A renter's client is the renter's case (they run it in their app) — the salon sees renter cases only for safety or equipment.
  const all = (data || []).filter((x: any) => !x.renterCase); const open = all.filter((c: any) => !c.locked).sort((a: any, b: any) => (b.safety ? 1 : 0) - (a.safety ? 1 : 0) || (a.firstReplyAt ? 1 : 0) - (b.firstReplyAt ? 1 : 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const closed = all.filter((c: any) => c.locked).sort((a: any, b: any) => String(b.closedAt).localeCompare(String(a.closedAt)));
  const c = all.find((x: any) => x.id === pick) || null;

  if (!allowed) return <div className="p-6"><AppHeader title="Making it right" /><p className="mt-6" style={{ color: MUTED }}>Cases are handled by the desk and managers.</p></div>;
  const Row = ({ x }: { x: any }) => { const clock = !x.firstReplyAt && !x.locked && x.replyDueAt ? left(x.replyDueAt) : null; return (
    <button type="button" onClick={() => { setPick(x.id); setStarting(false); }} className="block w-full rounded-[18px] border bg-white p-3.5 text-left" style={{ borderColor: pick === x.id ? INK : LINE, boxShadow: pick === x.id ? `0 0 0 1px ${INK}` : undefined }}>
      <div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-[15.5px] font-bold">{x.clientName}</p>{x.safety ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold" style={{ background: PINK, color: RED }}>{x.kind === 'incident' ? 'INCIDENT' : 'SAFETY'}</span> : x.kind === 'incident' ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold" style={{ background: '#fff7e6' }}>INCIDENT</span> : x.pending ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold" style={{ background: '#fff7e6' }}>NEEDS OK</span> : null}</div>
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
          {isManager && <Conduct firestore={firestore} tenantId={tenantId} />}
          {isManager && <ByProvider cases={all} />}
          {isManager && <a href="/settings/making-it-right" className="block pt-3 text-[14px] underline" style={{ color: MUTED }}>Your rules for making it right</a>}
        </aside>
        <section className="p-4 md:p-8">
          {starting ? <NewCase firestore={firestore} tenantId={tenantId} S={S} onDone={(id) => { setStarting(false); setPick(id); }} />
            : c ? <CaseView c={c} tenantId={tenantId} S={S} me={user?.uid || ''} isManager={isManager} tz={tz} services={services || []} solo={solo} />
            : <div className="mx-auto max-w-md space-y-2 pt-16 text-center"><p className="text-[20px] font-bold">Pick a case</p><p className="text-[15px]" style={{ color: MUTED }}>Every complaint gets an owner, a fix, and a check-back — and a record you can download.</p></div>}
        </section>
      </main>
    </div>);
}
