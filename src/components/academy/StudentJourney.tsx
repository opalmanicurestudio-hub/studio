'use client';
// src/components/academy/StudentJourney.tsx
//
// STUDENTS (licensed-school mode).
//   Students       every student, riskiest first, with the REASONS; latest
//                  progress check; open one → progress-check history, license
//                  and placement, "Recheck now", message.
//   Messages       one thread per student with the school.
//   Announcements  to everyone, a program or a cohort; optionally emailed.
//   Outcomes       completion · licensure · placement; applicants by source.

import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader, X } from 'lucide-react';
import { StudentFile } from '@/components/academy/StudentFile';

async function api(path: string, body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const J = (tenantId: string, body: any) => api('/api/academy/journey', { tenantId, ...body });
const field = 'h-10 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const RISK: Record<string, string> = { high: 'bg-red-100 text-red-800', watch: 'bg-amber-100 text-amber-800', ok: 'bg-emerald-100 text-emerald-800' };
const SAP: Record<string, string> = { satisfactory: 'text-emerald-700', warning: 'text-amber-700', probation: 'text-red-700' };
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export function StudentJourney({ tenantId, brand }: { tenantId: string; brand: { name: string; logoUrl?: string | null; color?: string | null } }) {
  const [fileFor, setFileFor] = useState<string | null>(null);
  const [tab, setTab] = useState<'students' | 'messages' | 'announcements' | 'outcomes'>('students');
  const [list, setList] = useState<any[] | null>(null);
  const [open, setOpen] = useState<any>(null);
  const [threads, setThreads] = useState<any[] | null>(null);
  const [thread, setThread] = useState<{ studentId: string; name: string; messages: any[] } | null>(null);
  const [reply, setReply] = useState('');
  const [anns, setAnns] = useState<any[] | null>(null);
  const [ann, setAnn] = useState({ title: '', body: '', programId: '', cohortId: '', email: true });
  const [meta, setMeta] = useState<any>(null);   // programs + cohorts for targeting
  const [out, setOut] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => { const r = await J(tenantId, { action: 'students' }); if (r.ok) setList(r.students); else setMsg(r.error); }, [tenantId]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    if (tab === 'messages' && !threads) J(tenantId, { action: 'threads' }).then((r) => r.ok && setThreads(r.threads));
    if (tab === 'announcements' && !anns) { J(tenantId, { action: 'announcements' }).then((r) => r.ok && setAnns(r.announcements)); api('/api/academy/admissions', { tenantId, action: 'board' }).then((r) => r.ok && setMeta(r)); }
    if (tab === 'outcomes' && !out) J(tenantId, { action: 'outcomes' }).then((r) => r.ok && setOut(r.outcomes));
  }, [tab, threads, anns, out, tenantId]);
  const openThread = async (studentId: string, name: string) => { setTab('messages'); const r = await J(tenantId, { action: 'thread', studentId }); if (r.ok) setThread({ studentId, name, messages: r.messages }); };

  if (fileFor) return <StudentFile tenantId={tenantId} studentId={fileFor} brand={brand} onClose={() => { setFileFor(null); void loadList(); }} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">{([['students', 'Students'], ['messages', 'Messages'], ['announcements', 'Announcements'], ['outcomes', 'Outcomes']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 rounded-full px-4 text-sm font-bold ${tab === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{l}{k === 'messages' && threads?.some((x) => x.unreadSchool) ? ' •' : ''}</button>)}</div>
      {msg && <p className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}

      {tab === 'students' && (!list ? <Loader className="h-5 w-5 animate-spin" /> : list.length === 0 ? <p className="text-sm text-muted-foreground">No students yet — enrol them in Programs or through Admissions.</p> : (
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted-foreground">Scores refresh every night. Managers get a Monday email listing anyone who needs attention.</p>
          {list.map((s) => (
            <button key={s.id} type="button" onClick={() => setOpen(s)} className="flex w-full flex-wrap items-center gap-2 rounded-2xl bg-muted/40 px-3 py-2.5 text-left text-sm">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${s.risk ? RISK[s.risk.level] : 'bg-muted text-muted-foreground'}`}>{s.risk ? `${s.risk.level} ${s.risk.score}` : 'new'}</span>
              <span className="min-w-0 flex-1"><span className="font-bold">{s.name}</span> <span className="text-muted-foreground">· {s.program} · {s.status === 'loa' ? 'leave' : s.status}</span>
                {s.risk?.reasons?.length > 0 && <span className="block truncate text-[12px] text-muted-foreground">{s.risk.reasons.join(' · ')}</span>}</span>
              {s.sap && <span className={`text-[11px] font-bold ${SAP[s.sap.result]}`}>{s.sap.checkpoint}h: {s.sap.result}</span>}
              {s.journey?.license?.result === 'passed' && <span className="text-[11px] font-bold text-violet-700">licensed</span>}
              {['hired', 'renting', 'self_employed'].includes(s.journey?.placement?.status) && <span className="text-[11px] font-bold text-violet-700">placed</span>}
            </button>
          ))}
        </div>
      ))}

      {tab === 'messages' && (
        <div className="grid gap-3 md:grid-cols-[260px_1fr]">
          <div className="space-y-1">{!threads ? <Loader className="h-5 w-5 animate-spin" /> : threads.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet.</p> : threads.map((th) => (
            <button key={th.id} type="button" onClick={() => openThread(th.id, th.name || th.email)} className={`block w-full rounded-xl px-3 py-2 text-left text-sm ${thread?.studentId === th.id ? 'bg-foreground text-background' : 'bg-muted/40'}`}>
              <span className="font-bold">{th.name || th.email}</span>{th.unreadSchool ? <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">{th.unreadSchool}</span> : null}
              <span className="block truncate text-[12px] opacity-70">{th.lastFrom === 'school' ? 'You: ' : ''}{th.lastText}</span></button>
          ))}</div>
          {thread ? (
            <div className="space-y-2 rounded-2xl border-2 border-border/60 p-3">
              <p className="font-black">{thread.name}</p>
              <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">{thread.messages.map((m, i) => <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from === 'school' ? 'ml-auto bg-foreground text-background' : 'bg-muted'}`}><p className="whitespace-pre-wrap">{m.text}</p>
                {m.translated && <p className={`mt-1 whitespace-pre-wrap border-t pt-1 text-[12px] ${m.from === 'school' ? 'border-white/30 opacity-80' : 'border-black/10 italic'}`}>{m.from === 'student' ? `English: ${m.translated}` : `Sent in their language: ${m.translated}`}</p>}
                <p className="mt-0.5 text-[10px] opacity-60">{m.by} · {new Date(m.at).toLocaleString()}</p></div>)}</div>
              <div className="flex gap-2"><textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} className="flex-1 rounded-xl border-2 p-2 text-sm" placeholder="Reply (they’ll get an email too)" />
                <button type="button" disabled={busy || !reply.trim()} onClick={async () => { setBusy(true); const r = await J(tenantId, { action: 'reply', studentId: thread.studentId, text: reply }); setBusy(false); if (r.ok) { setReply(''); await openThread(thread.studentId, thread.name); setThreads(null); } else setMsg(r.error); }} className="rounded-xl bg-foreground px-4 text-sm font-bold text-background disabled:opacity-50">Send</button></div>
            </div>
          ) : <p className="rounded-2xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">Choose a conversation — or open a student and tap “Message”.</p>}
        </div>
      )}

      {tab === 'announcements' && (
        <div className="space-y-3">
          <div className="space-y-2 rounded-2xl border-2 border-foreground/30 p-3">
            <input className={field} placeholder="Title (e.g. Clinic closed Monday)" value={ann.title} onChange={(e) => setAnn({ ...ann, title: e.target.value })} />
            <textarea className="w-full rounded-xl border-2 p-3 text-sm" rows={4} placeholder="Message" value={ann.body} onChange={(e) => setAnn({ ...ann, body: e.target.value })} />
            <div className="grid gap-2 sm:grid-cols-3">
              <select className={field} value={ann.programId} onChange={(e) => setAnn({ ...ann, programId: e.target.value, cohortId: '' })}><option value="">Everyone</option>{(meta?.programs || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <select className={field} value={ann.cohortId} onChange={(e) => setAnn({ ...ann, cohortId: e.target.value })} disabled={!ann.programId}><option value="">All cohorts</option>{(meta?.cohorts || []).filter((c: any) => c.programId === ann.programId).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={ann.email} onChange={(e) => setAnn({ ...ann, email: e.target.checked })} />Email it too</label>
            </div>
            <button type="button" disabled={busy || !ann.title || !ann.body} onClick={async () => { setBusy(true); const r = await J(tenantId, { action: 'announce', ...ann }); setBusy(false); if (r.ok) { setMsg(`Sent to ${r.recipients} student${r.recipients === 1 ? '' : 's'}${ann.email ? ` (${r.emailed} emailed)` : ''}.`); setAnn({ title: '', body: '', programId: '', cohortId: '', email: true }); setAnns(null); } else setMsg(r.error); }} className="h-10 rounded-xl bg-foreground px-5 text-sm font-bold text-background disabled:opacity-50">Send announcement</button>
          </div>
          {(anns || []).map((a) => <div key={a.id} className="rounded-2xl bg-muted/40 p-3 text-sm"><p className="font-bold">{a.title}</p><p className="whitespace-pre-wrap">{a.body}</p><p className="mt-1 text-[11px] text-muted-foreground">{a.by} · {dt(a.at)}</p></div>)}
        </div>
      )}

      {tab === 'outcomes' && (!out ? <Loader className="h-5 w-5 animate-spin" /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">{([['Completion', out.rates.completion, `${out.counts.graduated} graduated · ${out.counts.withdrawn} withdrew`], ['Licensure', out.rates.licensure, `${out.counts.licensed} of ${out.counts.tookExam} passed`], ['Placement', out.rates.placement, `${out.counts.placed} of ${out.counts.graduated} graduates`]] as const).map(([l, v, sub]) => (
            <div key={l} className="rounded-2xl bg-muted/40 p-4 text-center"><p className="text-3xl font-black">{v == null ? '—' : `${v}%`}</p><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{l}</p><p className="text-[11px] text-muted-foreground">{sub}</p></div>
          ))}</div>
          <p className="text-[12px] text-muted-foreground">Placed: {out.placementBreakdown.hired} hired · {out.placementBreakdown.renting} renting a chair · {out.placementBreakdown.self_employed} self-employed. Active {out.counts.active} · on leave {out.counts.loa}. Accreditors define these rates precisely — check your accreditor’s formula before reporting.</p>
          <div className="rounded-2xl bg-muted/40 p-3"><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Where applicants come from</p>
            {out.bySource.length === 0 ? <p className="text-sm text-muted-foreground">No applicants yet.</p> : out.bySource.map((s: any) => <div key={s.source} className="flex justify-between text-sm"><span>{s.source}</span><span><span className="font-bold">{s.applicants}</span> applied · {s.enrolled} enrolled{s.conversion != null ? ` (${s.conversion}%)` : ''}</span></div>)}</div>
        </div>
      ))}

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="h-full w-full max-w-lg space-y-4 overflow-y-auto bg-background p-5 shadow-2xl">
            <div className="flex items-start justify-between"><div><p className="text-xl font-black">{open.name}</p><p className="text-sm text-muted-foreground">{open.email} · {open.program} · started {dt(open.startDate)}</p></div><button type="button" onClick={() => setOpen(null)} aria-label="Close"><X className="h-5 w-5" /></button></div>
            <button type="button" onClick={() => { setFileFor(open.studentId); setOpen(null); }} className="h-11 w-full rounded-xl bg-foreground text-sm font-bold text-background">Open student file →</button>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setOpen(null); void openThread(open.studentId, open.name); }} className="h-9 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Message</button>
              <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await J(tenantId, { action: 'refresh', enrollmentId: open.id }); setBusy(false); if (r.ok) { setOpen({ ...open, risk: r.risk, sapHistory: [...(open.sapHistory || []), ...r.newChecks] }); void loadList(); } else setMsg(r.error); }} className="h-9 rounded-xl border-2 px-4 text-sm font-bold">{busy ? 'Checking…' : 'Recheck now'}</button>
            </div>
            <section className="space-y-1 rounded-2xl bg-muted/40 p-3">
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Risk {open.risk ? `· ${open.risk.score}/100 · ${open.risk.level}` : ''}</p>
              {open.risk?.reasons?.length ? open.risk.reasons.map((r: string) => <p key={r} className="text-sm">• {r}</p>) : <p className="text-sm">{open.risk ? 'Nothing concerning right now.' : 'Scored tonight — or tap Recheck now.'}</p>}
              {open.risk?.signals && <p className="text-[11px] text-muted-foreground">{open.risk.signals.hours} h done · attendance {open.risk.signals.attendancePct ?? '—'}% · quizzes {open.risk.signals.quizAvg ?? '—'}% · practicals {open.risk.signals.practicalAvg ?? '—'}/5 · services {open.risk.signals.requirementsPct ?? '—'}%</p>}
            </section>
            <section className="space-y-1">
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Progress checks (SAP)</p>
              {(open.sapHistory || []).length === 0 ? <p className="text-sm text-muted-foreground">None yet — the first runs at the program’s first checkpoint.</p> : open.sapHistory.map((x: any, i: number) => <p key={i} className="text-sm"><span className={`font-bold ${SAP[x.result]}`}>{x.checkpoint} h — {x.result}</span> · {dt(x.at)} · attendance {x.attendancePct ?? '—'}% · quizzes {x.quizAvg ?? '—'}% · practicals {x.practicalAvg ?? '—'}{x.fails?.length ? ` · ${x.fails.join('; ')}` : ''}</p>)}
            </section>
            <JourneyEditor tenantId={tenantId} s={open} onSaved={(j) => { setOpen({ ...open, journey: j }); void loadList(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function JourneyEditor({ tenantId, s, onSaved }: { tenantId: string; s: any; onSaved: (j: any) => void }) {
  const [lic, setLic] = useState({ examDate: s.journey?.license?.examDate || '', result: s.journey?.license?.result || '', licenseNumber: s.journey?.license?.licenseNumber || '' });
  const [pl, setPl] = useState({ status: s.journey?.placement?.status || '', where: s.journey?.placement?.where || '', at: s.journey?.placement?.at || '' });
  const [note, setNote] = useState('');
  const save = async (body: any) => { const r = await J(tenantId, { action: 'journey-save', enrollmentId: s.id, ...body }); if (r.ok) { setNote('Saved.'); onSaved(r.journey); } else setNote(r.error); };
  return (
    <>
      <section className="space-y-2 rounded-2xl bg-muted/40 p-3">
        <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">State board exam & license</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className={field} type="date" value={lic.examDate} onChange={(e) => setLic({ ...lic, examDate: e.target.value })} />
          <select className={field} value={lic.result} onChange={(e) => setLic({ ...lic, result: e.target.value })}><option value="">Result…</option><option value="scheduled">Scheduled</option><option value="passed">Passed</option><option value="failed">Not passed</option></select>
          <input className={field} placeholder="License #" value={lic.licenseNumber} onChange={(e) => setLic({ ...lic, licenseNumber: e.target.value })} />
        </div>
        <button type="button" onClick={() => save({ license: lic })} className="h-9 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Save license</button>
      </section>
      <section className="space-y-2 rounded-2xl bg-muted/40 p-3">
        <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">After graduation</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <select className={field} value={pl.status} onChange={(e) => setPl({ ...pl, status: e.target.value })}><option value="">Status…</option><option value="hired">Hired</option><option value="renting">Renting a chair / suite</option><option value="self_employed">Self-employed</option><option value="seeking">Looking for work</option><option value="not_seeking">Not seeking work</option></select>
          <input className={field} placeholder="Where" value={pl.where} onChange={(e) => setPl({ ...pl, where: e.target.value })} />
          <input className={field} type="date" value={pl.at} onChange={(e) => setPl({ ...pl, at: e.target.value })} />
        </div>
        <button type="button" onClick={() => save({ placement: pl })} className="h-9 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Save placement</button>
        <p className="text-[11px] text-muted-foreground">Graduates looking for a chair? Point them to your booth rental or hiring page — that’s the ClarityFlow loop.</p>
      </section>
      {note && <p className="text-sm">{note}</p>}
    </>
  );
}
