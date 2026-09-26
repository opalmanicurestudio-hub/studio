'use client';
// src/components/academy/ClassroomToolkit.tsx
//
// CLASSROOM TOOLKIT (Teach → Toolkit)
//   Timer           presets or custom · full screen · amber in the last minute,
//                   red at zero · soft chime
//   Picker          random student from a course roster or typed names · spin ·
//                   don't repeat
//   Groups          by number of groups or group size · reshuffle · save as groups
//                   (for Assign work)
//   Practical exam  student + evaluation · timer · tick each step done right
//                   (checklist remembered per evaluation on this device) · score ·
//                   save to the student file (same evaluation records, audited)

import { useEffect, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { deviceId } from '@/lib/device';

async function call(path: string, body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const shuffle = <T,>(a: T[]) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.floor(s)) % 60).padStart(2, '0')}`;
function chime() { try { const C = (window as any).AudioContext || (window as any).webkitAudioContext; const ctx = new C(); [0, 0.25, 0.5].forEach((t, i) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = [660, 880, 990][i]; g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.6); o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.7); }); } catch { /* no sound */ } }
const field = 'h-11 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';

export function ClassroomToolkit({ tenantId, courses }: { tenantId: string; courses: any[] }) {
  const [tool, setTool] = useState<'timer' | 'picker' | 'groups' | 'exam'>('timer');
  const [names, setNames] = useState<string[]>([]); const [src, setSrc] = useState<string>(''); const [typed, setTyped] = useState('');
  const [roster, setRoster] = useState<Record<string, { id: string; name: string }[]>>({});
  useEffect(() => { (async () => { const out: any = {}; for (const c of courses) { const r = await call('/api/academy/admin', { action: 'assign-options', tenantId, courseId: c.id }); out[c.id] = (r.students || []).map((s: any) => ({ id: s.id, name: s.name })); } setRoster(out); if (courses[0]) setSrc(courses[0].id); })(); }, [tenantId, courses]);
  useEffect(() => { setNames(src === 'typed' ? typed.split('\n').map((x) => x.trim()).filter(Boolean) : (roster[src] || []).map((s) => s.name)); }, [src, typed, roster]);
  const people = src === 'typed' ? [] : roster[src] || [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{([['timer', '⏱', 'Timer'], ['picker', '🎲', 'Random picker'], ['groups', '👥', 'Group maker'], ['exam', '🖐', 'Practical exam']] as const).map(([k, i, l]) => <button key={k} type="button" onClick={() => setTool(k)} className={`rounded-2xl p-3 text-left ${tool === k ? 'bg-foreground text-background' : 'bg-muted/40'}`}><span className="text-2xl">{i}</span><b className="block text-sm">{l}</b></button>)}</div>
      {tool === 'timer' && <Timer />}
      {tool === 'picker' && <><Source courses={courses} roster={roster} src={src} setSrc={setSrc} typed={typed} setTyped={setTyped} /><Picker names={names} /></>}
      {tool === 'groups' && <><Source courses={courses} roster={roster} src={src} setSrc={setSrc} typed={typed} setTyped={setTyped} /><Groups tenantId={tenantId} people={people} names={names} /></>}
      {tool === 'exam' && <PracticalExam tenantId={tenantId} />}
    </div>
  );
}

// Top-level (not inside the toolkit) so the names box keeps focus while typing.
function Source({ courses, roster, src, setSrc, typed, setTyped }: any) {
  return (
    <div className="space-y-2"><select className={field} value={src} onChange={(e) => setSrc(e.target.value)}>{courses.map((c: any) => <option key={c.id} value={c.id}>{c.title} · {(roster[c.id] || []).length} students</option>)}<option value="typed">Type names instead</option></select>
      {src === 'typed' && <textarea rows={4} className="w-full rounded-xl border-2 border-border/60 bg-background p-3 text-sm" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="One name per line" />}</div>
  );
}

function Timer() {
  const [total, setTotal] = useState(600); const [left, setLeft] = useState(600); const [run, setRun] = useState(false); const [big, setBig] = useState(false); const [label, setLabel] = useState('Contact time');
  const end = useRef(0); const rang = useRef(false);
  useEffect(() => { if (!run) return; end.current = Date.now() + left * 1000; rang.current = false; const iv = setInterval(() => { const l = Math.ceil((end.current - Date.now()) / 1000); setLeft(Math.max(0, l)); if (l <= 0) { setRun(false); if (!rang.current) { rang.current = true; chime(); } } }, 200); return () => clearInterval(iv); }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (m: number, l: string) => { setRun(false); setTotal(m * 60); setLeft(m * 60); setLabel(l); };
  const tone = left === 0 ? 'bg-red-500 text-white' : left <= 60 ? 'bg-amber-300 text-amber-950' : 'bg-muted/40';
  const face = (
    <div className={`flex flex-col items-center justify-center rounded-3xl transition-colors ${tone} ${big ? 'fixed inset-0 z-[70] rounded-none' : 'py-10'}`} onClick={big ? () => setBig(false) : undefined}>
      <p className={`font-semibold opacity-70 ${big ? 'text-3xl' : 'text-sm'}`}>{label}</p>
      <p className={`font-black tabular-nums leading-none ${big ? 'text-[22vw]' : 'text-7xl'}`}>{mmss(left)}</p>
      {big && <p className="mt-4 text-lg opacity-60">Tap to close</p>}
      <div className="mt-4 h-2 w-3/4 max-w-md overflow-hidden rounded-full bg-black/10"><div className="h-2 rounded-full bg-current transition-all duration-200" style={{ width: `${total ? (left / total) * 100 : 0}%` }} /></div>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">{([[5, 'Quick task'], [10, 'Contact time'], [15, 'Practice'], [30, 'Practical'], [60, 'Practical exam']] as const).map(([m, l]) => <button key={m} type="button" onClick={() => set(m, l)} className="rounded-full bg-muted/50 px-3 py-1.5 text-[12px] font-bold">{m} min · {l}</button>)}
        <input type="number" min={1} max={240} placeholder="Custom min" className="h-8 w-28 rounded-full border-2 px-3 text-[12px]" onKeyDown={(e) => { if (e.key === 'Enter') set(Math.max(1, Number((e.target as HTMLInputElement).value) || 1), 'Timer'); }} /></div>
      {face}
      <div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => { if (left === 0) setLeft(total); setRun(!run); }} className="h-14 rounded-2xl bg-foreground text-lg font-black text-background">{run ? 'Pause' : left === 0 ? 'Restart' : 'Start'}</button><button type="button" onClick={() => { setRun(false); setLeft(total); }} className="h-14 rounded-2xl border-2 text-sm font-bold">Reset</button><button type="button" onClick={() => setBig(true)} className="h-14 rounded-2xl border-2 text-sm font-bold">Full screen</button></div>
    </div>
  );
}

function Picker({ names }: { names: string[] }) {
  const [shown, setShown] = useState<string | null>(null); const [spin, setSpin] = useState(false); const [used, setUsed] = useState<string[]>([]); const [noRepeat, setNoRepeat] = useState(true);
  const pool = noRepeat ? names.filter((n) => !used.includes(n)) : names;
  const pick = () => { if (!pool.length || spin) return; setSpin(true); let k = 0; const iv = setInterval(() => { setShown(pool[Math.floor(Math.random() * pool.length)]); if (++k > 14) { clearInterval(iv); const final = pool[Math.floor(Math.random() * pool.length)]; setShown(final); setUsed((u) => [...u, final]); setSpin(false); } }, 70); };
  return (
    <div className="space-y-3">
      <div className="flex min-h-40 items-center justify-center rounded-3xl bg-muted/40 p-6 text-center"><p className={`font-black ${shown ? 'text-5xl' : 'text-lg text-muted-foreground'} ${spin ? 'opacity-60' : 'cf-land'}`}>{shown || (names.length ? 'Ready' : 'No names yet')}</p></div>
      <button type="button" disabled={!pool.length || spin} onClick={pick} className="h-14 w-full rounded-2xl bg-foreground text-lg font-black text-background disabled:opacity-40">{pool.length ? '🎲 Pick someone' : 'Everyone’s had a turn'}</button>
      <div className="flex items-center justify-between text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={noRepeat} onChange={(e) => setNoRepeat(e.target.checked)} />Don’t pick the same person twice</label>{used.length > 0 && <button type="button" onClick={() => { setUsed([]); setShown(null); }} className="font-bold underline">Start over ({used.length} picked)</button>}</div>
    </div>
  );
}

function Groups({ tenantId, people, names }: { tenantId: string; people: { id: string; name: string }[]; names: string[] }) {
  const [mode, setMode] = useState<'count' | 'size'>('count'); const [n, setN] = useState(3); const [groups, setGroups] = useState<string[][]>([]); const [msg, setMsg] = useState('');
  const make = () => { const s = shuffle(names); const k = mode === 'count' ? Math.max(1, Math.min(n, s.length)) : Math.max(1, Math.ceil(s.length / Math.max(1, n))); const g: string[][] = Array.from({ length: k }, () => []); s.forEach((x, i) => g[i % k].push(x)); setGroups(g); setMsg(''); };
  const save = async () => { const day = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); let saved = 0; for (let i = 0; i < groups.length; i++) { const ids = groups[i].map((nm) => people.find((p) => p.name === nm)?.id).filter(Boolean); if (!ids.length) continue; const r = await call('/api/academy/admin', { action: 'group-save', tenantId, name: `Group ${i + 1} — ${day}`, studentIds: ids }); if (r.ok) saved++; } setMsg(`${saved} group${saved === 1 ? '' : 's'} saved — find them in Assign work → Groups.`); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm"><div className="flex gap-1">{([['count', 'Number of groups'], ['size', 'People per group']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setMode(k)} className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${mode === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{l}</button>)}</div>
        <input type="number" min={1} max={50} value={n} onChange={(e) => setN(Number(e.target.value) || 1)} className="h-9 w-20 rounded-xl border-2 px-2" /><button type="button" disabled={!names.length} onClick={make} className="h-9 rounded-xl bg-foreground px-4 text-sm font-bold text-background disabled:opacity-40">{groups.length ? '🔀 Shuffle again' : 'Make groups'}</button></div>
      {groups.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{groups.map((g, i) => <div key={i} className="cf-land rounded-2xl bg-muted/40 p-3" style={{ animationDelay: `${i * 60}ms` }}><p className="font-black">Group {i + 1} <span className="font-normal text-muted-foreground">· {g.length}</span></p>{g.map((x) => <p key={x} className="text-sm">{x}</p>)}</div>)}</div>}
      {groups.length > 0 && people.length > 0 && <button type="button" onClick={save} className="h-10 rounded-xl border-2 px-4 text-sm font-bold">Save as groups</button>}
      {msg && <p className="text-sm text-emerald-800">{msg}</p>}
    </div>
  );
}

const DEFAULT_STEPS = ['Hand washing and set-up', 'Implements disinfected and laid out', 'Client consultation', 'Technique — main steps', 'Clean-up and disinfection'];
function PracticalExam({ tenantId }: { tenantId: string }) {
  const [roster, setRoster] = useState<any[]>([]); const [who, setWho] = useState(''); const [file, setFile] = useState<any>(null); const [ev, setEv] = useState('');
  const [steps, setSteps] = useState<string[]>(DEFAULT_STEPS); const [ok, setOk] = useState<boolean[]>([]); const [override, setOverride] = useState(''); const [note, setNote] = useState('');
  const [t0, setT0] = useState<number | null>(null); const [now, setNow] = useState(Date.now()); const [stopped, setStopped] = useState<number | null>(null); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { call('/api/academy/school', { action: 'roster', tenantId }).then((r) => setRoster((r.students || []).filter((s: any) => s.status !== 'withdrawn'))); }, [tenantId]);
  useEffect(() => { const r = roster.find((x) => x.id === who); if (!r) { setFile(null); return; } call('/api/academy/student-file', { action: 'get', tenantId, studentId: r.studentId }).then((f) => setFile(f.ok ? f : null)); }, [who, roster, tenantId]);
  useEffect(() => { if (!ev) return; try { const s = JSON.parse(localStorage.getItem(`cf_exam_steps_${ev}`) || 'null'); setSteps(Array.isArray(s) && s.length ? s : DEFAULT_STEPS); } catch { setSteps(DEFAULT_STEPS); } setOk([]); }, [ev]);
  useEffect(() => { if (!t0 || stopped) return; const iv = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(iv); }, [t0, stopped]);
  const prog = file?.programs?.find((p: any) => p.id === who);
  const evals = (prog?.evaluations || []) as any[]; const E = evals.find((x) => x.key === ev);
  const score = override !== '' ? Math.max(0, Math.min(100, Number(override) || 0)) : steps.length ? Math.round((ok.filter(Boolean).length / steps.length) * 100) : 0;
  const secs = t0 ? Math.round(((stopped || now) - t0) / 1000) : 0;
  const saveSteps = (s: string[]) => { setSteps(s); try { localStorage.setItem(`cf_exam_steps_${ev}`, JSON.stringify(s)); } catch { /* */ } };
  return (
    <div className="space-y-3">
      <select className={field} value={who} onChange={(e) => { setWho(e.target.value); setEv(''); setMsg(''); }}><option value="">Choose a student…</option>{roster.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      {who && (!file ? <p className="text-sm text-muted-foreground">Loading…</p> : evals.length === 0 ? <p className="text-sm text-muted-foreground">This student’s program has no evaluations set up.</p> :
        <select className={field} value={ev} onChange={(e) => setEv(e.target.value)}><option value="">Choose the evaluation…</option>{evals.map((x) => <option key={x.key} value={x.key}>{x.result?.passed ? '✓ ' : ''}{x.label} (pass {x.passPct}%)</option>)}</select>)}
      {E && <>
        <div className="flex items-center gap-3 rounded-2xl bg-muted/40 p-4"><p className="text-4xl font-black tabular-nums">{mmss(secs)}</p>
          {!t0 ? <button type="button" onClick={() => { setT0(Date.now()); setStopped(null); }} className="ml-auto h-12 rounded-xl bg-foreground px-5 font-black text-background">Start</button> : !stopped ? <button type="button" onClick={() => setStopped(Date.now())} className="ml-auto h-12 rounded-xl bg-red-600 px-5 font-black text-white">Stop</button> : <button type="button" onClick={() => { setT0(null); setStopped(null); }} className="ml-auto h-12 rounded-xl border-2 px-5 font-bold">Reset</button>}</div>
        <div className="space-y-1.5">{steps.map((s, i) => <div key={i} className="flex items-center gap-2"><button type="button" onClick={() => { const o = [...ok]; o[i] = !o[i]; setOk(o); }} className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl ${ok[i] ? 'bg-emerald-500 text-white' : 'bg-muted'}`} aria-label={`Step ${i + 1} done correctly`}>{ok[i] ? '✓' : ''}</button>
          <input className={field} value={s} onChange={(e) => { const x = [...steps]; x[i] = e.target.value; saveSteps(x); }} /><button type="button" onClick={() => { saveSteps(steps.filter((_, k) => k !== i)); setOk(ok.filter((_, k) => k !== i)); }} className="px-2 text-red-600" aria-label="Remove step">✕</button></div>)}
          <button type="button" onClick={() => saveSteps([...steps, ''])} className="rounded-full bg-muted px-3 py-1 text-[12px] font-bold">+ Step</button><p className="text-[11px] text-muted-foreground">Your checklist for this evaluation is remembered on this device.</p></div>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted/40 p-4"><p className="text-3xl font-black">{score}%</p><span className={`rounded-full px-3 py-1 text-sm font-bold ${score >= E.passPct ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{score >= E.passPct ? 'Pass' : `Needs ${E.passPct}%`}</span>
          <label className="ml-auto flex items-center gap-2 text-[12px] font-bold">Override %<input type="number" min={0} max={100} value={override} onChange={(e) => setOverride(e.target.value)} className="h-9 w-20 rounded-xl border-2 px-2" /></label></div>
        <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. great cuticle work; watch file angle" />
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await call('/api/academy/student-file', { action: 'eval-record', tenantId, studentId: prog?.studentId || file.profile?.id, enrollmentId: who, key: ev, score, notes: `${note ? `${note} · ` : ''}${steps.length ? `${ok.filter(Boolean).length}/${steps.length} steps` : ''}${secs ? ` · ${mmss(secs)}` : ''}` }); setBusy(false); setMsg(r.ok ? `Saved to ${file.profile?.name}’s file — ${r.passed ? 'passed' : 'not passed yet'} (${r.score}%).` : r.error); }} className="h-12 w-full rounded-xl bg-foreground text-sm font-bold text-background disabled:opacity-50">{busy ? 'Saving…' : 'Save to the student file'}</button>
        {msg && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
      </>}
    </div>
  );
}
