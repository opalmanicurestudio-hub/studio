'use client';
// src/components/academy/AssignPanel.tsx
//
// ASSIGN WORK (Teach → Assign work)
//   list       every assignment: course, who, due, a progress bar
//   ＋ Assign  What (course → tick lessons) · Who (everyone / program / cohort /
//              group / chosen students) · When (due date, note) · optional
//              automatic review ("only if they score under __% on …")
//   progress   who's done, who isn't, Nudge (email in each student's language)
//   groups     make groups like "Needs extra practice" to assign to

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { deviceId } from '@/lib/device';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const WHO: [string, string][] = [['course', 'Everyone in the course'], ['program', 'A program'], ['cohort', 'A cohort'], ['group', 'A group'], ['students', 'Chosen students']];
const field = 'h-11 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No due date');

export function AssignPanel({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<any[] | null>(null); const [opt, setOpt] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null); const [open, setOpen] = useState<any>(null); const [groupsOpen, setGroupsOpen] = useState(false); const [msg, setMsg] = useState('');
  const load = useCallback(async () => { const [l, o] = await Promise.all([api({ action: 'assign-list', tenantId }), api({ action: 'assign-options', tenantId })]); if (l.ok) setItems(l.items); if (o.ok) setOpt(o); }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  if (!items || !opt) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const whoLabel = (a: any) => a.audience.type === 'course' ? 'Everyone' : a.audience.type === 'students' ? `${a.audience.ids.length} student${a.audience.ids.length === 1 ? '' : 's'}` : (a.audience.ids.map((id: string) => (opt[`${a.audience.type}s`] || []).find((x: any) => x.id === id)?.name).filter(Boolean).join(', ') || a.audience.type);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setEdit({ courseId: opt.courses[0]?.id || '', lessonIds: [], audience: { type: 'course', ids: [] }, dueAt: '', note: '', title: '', condition: null })} className="h-11 rounded-xl bg-foreground px-5 text-sm font-bold text-background">＋ Assign work</button>
        <button type="button" onClick={() => setGroupsOpen(true)} className="h-11 rounded-xl border-2 px-4 text-sm font-bold">Groups · {opt.groups.length}</button></div>
      {msg && <p className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900" onClick={() => setMsg('')}>{msg}</p>}
      {items.length === 0 ? <p className="rounded-3xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">Nothing assigned yet. Assign a lesson, quiz or game to a class, a group or one student — with a due date, and an automatic review for anyone who scores low.</p> : (
        <div className="space-y-2">{items.map((a) => (
          <button key={a.id} type="button" onClick={() => setOpen(a)} className="block w-full rounded-2xl border-2 border-border/60 p-3 text-left hover:bg-muted/30">
            <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 truncate font-black">{a.condition ? '🔁 ' : ''}{a.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${a.dueAt && new Date(a.dueAt) < new Date() ? 'bg-red-100 text-red-800' : 'bg-muted'}`}>{when(a.dueAt)}</span></div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">{a.courseTitle} · {a.lessonIds.length} lesson{a.lessonIds.length === 1 ? '' : 's'} · {whoLabel(a)}{a.condition ? ` · only if under ${a.condition.below}%` : ''}</p>
          </button>
        ))}</div>
      )}
      {edit && <AssignSheet tenantId={tenantId} opt={opt} value={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); setMsg('Assigned — students see it on their To do list.'); await load(); }} />}
      {open && <ProgressSheet tenantId={tenantId} a={open} onClose={() => setOpen(null)} onEdit={() => { setEdit({ ...open, dueAt: open.dueAt ? String(open.dueAt).slice(0, 10) : '' }); setOpen(null); }} onDeleted={async () => { setOpen(null); await load(); }} />}
      {groupsOpen && <GroupsSheet tenantId={tenantId} groups={opt.groups} onClose={async () => { setGroupsOpen(false); await load(); }} />}
    </div>
  );
}

function Sheet({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-t-3xl bg-background p-5 sm:rounded-3xl">
        <div className="flex items-center justify-between"><p className="text-xl font-black">{title}</p><button type="button" onClick={onClose} className="text-sm font-bold text-muted-foreground">Close</button></div>
        {children}
      </div>
    </div>
  );
}

// Defined outside the sheet so inputs inside keep focus while typing.
function Step({ n, t, children }: any) { return <section className="space-y-2"><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{n} · {t}</p>{children}</section>; }

function AssignSheet({ tenantId, opt, value, onClose, onSaved }: any) {
  const [a, setA] = useState<any>(value); const [o, setO] = useState<any>(opt); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (a.courseId) api({ action: 'assign-options', tenantId, courseId: a.courseId }).then((r) => r.ok && setO(r)); }, [a.courseId, tenantId]);
  const mods = useMemo(() => { const out: { title: string; ls: any[] }[] = []; for (const l of o.lessons || []) { const m = out.find((x) => x.title === l.moduleTitle); if (m) m.ls.push(l); else out.push({ title: l.moduleTitle, ls: [l] }); } return out; }, [o.lessons]);
  const pickList = a.audience.type === 'program' ? o.programs : a.audience.type === 'cohort' ? o.cohorts : a.audience.type === 'group' ? o.groups : a.audience.type === 'students' ? o.students : [];
  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  return (
    <Sheet title={value.id ? 'Edit assignment' : 'Assign work'} onClose={onClose}>
      <Step n="1" t="What">
        <select className={field} value={a.courseId} onChange={(e) => setA({ ...a, courseId: e.target.value, lessonIds: [], condition: null })}>{o.courses.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-2xl bg-muted/30 p-2">{mods.map((m) => <div key={m.title}><p className="px-1 text-[11px] font-black text-muted-foreground">{m.title}</p>{m.ls.map((l: any) => <label key={l.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-background"><input type="checkbox" checked={a.lessonIds.includes(l.id)} onChange={() => setA({ ...a, lessonIds: toggle(a.lessonIds, l.id) })} />{l.title}{l.hasQuiz ? <span className="text-[11px] text-muted-foreground">· quiz</span> : null}</label>)}</div>)}</div>
        <input className={field} value={a.title} onChange={(e) => setA({ ...a, title: e.target.value })} placeholder="Name it (optional) — e.g. Infection control review" />
      </Step>
      <Step n="2" t="Who">
        <div className="flex flex-wrap gap-1.5">{WHO.map(([k, l]) => <button key={k} type="button" onClick={() => setA({ ...a, audience: { type: k, ids: [] } })} className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${a.audience.type === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{l}</button>)}</div>
        {a.audience.type !== 'course' && (pickList.length === 0 ? <p className="text-[12px] text-muted-foreground">{a.audience.type === 'group' ? 'No groups yet — make one from “Groups”.' : a.audience.type === 'students' ? 'No one is enrolled in this course yet.' : `No ${a.audience.type}s yet.`}</p> :
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-2xl bg-muted/30 p-2">{pickList.map((x: any) => <label key={x.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-background"><input type="checkbox" checked={a.audience.ids.includes(x.id)} onChange={() => setA({ ...a, audience: { ...a.audience, ids: toggle(a.audience.ids, x.id) } })} />{x.name}{x.studentIds ? <span className="text-[11px] text-muted-foreground">· {x.studentIds.length}</span> : null}</label>)}</div>)}
        <p className="text-[11px] text-muted-foreground">Only students enrolled in this course receive it — including anyone who joins later.</p>
      </Step>
      <Step n="3" t="When">
        <input type="date" className={field} value={a.dueAt || ''} onChange={(e) => setA({ ...a, dueAt: e.target.value })} />
        <textarea rows={2} className="w-full rounded-xl border-2 border-border/60 bg-background p-3 text-sm" value={a.note || ''} onChange={(e) => setA({ ...a, note: e.target.value })} placeholder="A note for students (optional)" />
      </Step>
      <Step n="4" t="Automatic review (optional)">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={!!a.condition} onChange={(e) => setA({ ...a, condition: e.target.checked ? { lessonId: (o.lessons || []).find((l: any) => l.hasQuiz)?.id || '', below: 70 } : null })} /><span>Only give this to students who score low on a quiz — it appears for them automatically after they try it.</span></label>
        {a.condition && <div className="flex flex-wrap items-center gap-2 text-sm">Under <input type="number" className="h-10 w-20 rounded-xl border-2 px-2" value={a.condition.below} onChange={(e) => setA({ ...a, condition: { ...a.condition, below: e.target.value } })} />% on
          <select className="h-10 min-w-0 flex-1 rounded-xl border-2 px-2" value={a.condition.lessonId} onChange={(e) => setA({ ...a, condition: { ...a.condition, lessonId: e.target.value } })}>{(o.lessons || []).filter((l: any) => l.hasQuiz).map((l: any) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></div>}
      </Step>
      {err && <p className="text-sm text-red-700">{err}</p>}
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(''); const r = await api({ action: 'assign-save', tenantId, assignment: a }); setBusy(false); if (r.ok) onSaved(); else setErr(r.error); }} className="h-12 w-full rounded-xl bg-foreground text-sm font-bold text-background disabled:opacity-50">{busy ? 'Saving…' : value.id ? 'Save changes' : 'Assign'}</button>
    </Sheet>
  );
}

function ProgressSheet({ tenantId, a, onClose, onEdit, onDeleted }: any) {
  const [rows, setRows] = useState<any[] | null>(null); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api({ action: 'assign-progress', tenantId, id: a.id }).then((r) => setRows(r.ok ? r.rows : [])); }, [a.id, tenantId]);
  const done = (rows || []).filter((r) => r.done).length;
  return (
    <Sheet title={a.title} onClose={onClose}>
      <p className="-mt-2 text-sm text-muted-foreground">{a.courseTitle} · {when(a.dueAt)}{a.condition ? ` · review for scores under ${a.condition.below}%` : ''}</p>
      {!rows ? <p className="text-sm text-muted-foreground">Loading…</p> : <>
        <div><div className="flex justify-between text-sm"><b>{done} of {rows.length} done</b>{rows.length > 0 && <span>{Math.round((done / rows.length) * 100)}%</span>}</div><div className="mt-1 h-2.5 rounded-full bg-muted"><div className="h-2.5 rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${rows.length ? (done / rows.length) * 100 : 0}%` }} /></div></div>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">{a.condition ? 'No one needs this review yet — it appears for students who score under the mark.' : 'No enrolled students match yet.'}</p>}
        <div className="max-h-72 space-y-1 overflow-y-auto">{rows.map((r) => <div key={r.studentId} className="flex items-center gap-2 rounded-xl bg-muted/30 px-3 py-2 text-sm"><span className={r.done ? 'text-emerald-600' : 'text-muted-foreground'}>{r.done ? '✓' : '○'}</span><span className="min-w-0 flex-1 truncate">{r.name}</span><span className="text-[12px] text-muted-foreground">{r.finished}/{a.lessonIds.length}</span></div>)}</div>
        {rows.some((r) => !r.done) && <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await api({ action: 'assign-nudge', tenantId, id: a.id }); setBusy(false); setMsg(r.ok ? `Reminder sent to ${r.sent} student${r.sent === 1 ? '' : 's'} (in their own language).` : r.error); }} className="h-11 w-full rounded-xl bg-violet-700 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Sending…' : `Nudge the ${rows.filter((r) => !r.done).length} who haven’t finished`}</button>}
        {msg && <p className="text-sm text-emerald-800">{msg}</p>}
      </>}
      <div className="flex gap-2"><button type="button" onClick={onEdit} className="h-10 flex-1 rounded-xl border-2 text-sm font-bold">Edit</button><button type="button" onClick={async () => { if (!window.confirm('Remove this assignment? Students’ progress in the lessons stays.')) return; await api({ action: 'assign-delete', tenantId, id: a.id }); onDeleted(); }} className="h-10 rounded-xl px-4 text-sm font-bold text-red-700">Remove</button></div>
    </Sheet>
  );
}

function GroupsSheet({ tenantId, groups, onClose }: any) {
  const [list, setList] = useState<any[]>(groups); const [ed, setEd] = useState<any>(null); const [people, setPeople] = useState<any[]>([]); const [q, setQ] = useState('');
  useEffect(() => { (async () => { const o = await api({ action: 'assign-options', tenantId }); const all = new Map<string, any>(); for (const c of o.courses || []) { const r = await api({ action: 'assign-options', tenantId, courseId: c.id }); for (const s of r.students || []) all.set(s.id, s); } setPeople([...all.values()].sort((x, y) => String(x.name).localeCompare(String(y.name)))); })(); }, [tenantId]);
  return (
    <Sheet title="Groups" onClose={onClose}>
      {!ed ? <>
        <p className="-mt-2 text-sm text-muted-foreground">Groups like “Needs extra practice” or “Tuesday class” — assign work to them in one tap.</p>
        {list.map((g) => <button key={g.id} type="button" onClick={() => setEd({ ...g })} className="flex w-full items-center justify-between rounded-2xl bg-muted/40 px-4 py-3 text-left text-sm"><b>{g.name}</b><span className="text-muted-foreground">{(g.studentIds || []).length} ›</span></button>)}
        <button type="button" onClick={() => setEd({ name: '', studentIds: [] })} className="h-11 w-full rounded-xl border-2 border-dashed text-sm font-bold">＋ New group</button>
      </> : <>
        <input className={field} value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} placeholder="Group name" />
        <input className={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students" />
        <div className="max-h-72 space-y-1 overflow-y-auto">{people.filter((p) => !q || String(p.name).toLowerCase().includes(q.toLowerCase())).map((p) => <label key={p.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-muted/40"><input type="checkbox" checked={ed.studentIds.includes(p.id)} onChange={() => setEd({ ...ed, studentIds: ed.studentIds.includes(p.id) ? ed.studentIds.filter((x: string) => x !== p.id) : [...ed.studentIds, p.id] })} />{p.name}</label>)}</div>
        <div className="flex gap-2"><button type="button" onClick={async () => { const r = await api({ action: 'group-save', tenantId, ...ed }); if (r.ok) { setList(ed.id ? list.map((g) => (g.id === ed.id ? ed : g)) : [...list, { ...ed, id: r.id }]); setEd(null); } }} className="h-11 flex-1 rounded-xl bg-foreground text-sm font-bold text-background">Save · {ed.studentIds.length} student{ed.studentIds.length === 1 ? '' : 's'}</button>
          {ed.id && <button type="button" onClick={async () => { if (!window.confirm(`Delete “${ed.name}”?`)) return; await api({ action: 'group-delete', tenantId, id: ed.id }); setList(list.filter((g) => g.id !== ed.id)); setEd(null); }} className="h-11 rounded-xl px-3 text-sm font-bold text-red-700">Delete</button>}
          <button type="button" onClick={() => setEd(null)} className="h-11 px-3 text-sm font-bold text-muted-foreground">Back</button></div>
      </>}
    </Sheet>
  );
}
