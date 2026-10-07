'use client';
// src/components/pos/desk/Disinfection.tsx — THE DISINFECTION GUIDE, where the team is cleaning: each product's contact
// time (how long it must stay wet), how to mix it, the steps, what to wear and when the solution was last made fresh.
// One tap (or a scan of the bottle's label) starts a contact timer with a live ring; it turns green when the time is
// reached. Managers write each product up from its own label — nothing here supplies a contact time.
import * as React from 'react';
import { collection, doc, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { logAuditClient } from '@/lib/audit-client';
import { contactLeft, solutionState, disinfectantProblem, cleanSteps, openTimers, type Disinfectant, type ContactTimer } from '@/lib/disinfect';
import { printCodeLabels, brandOf } from '@/lib/print-labels';
import { useSeconds } from '@/components/pos/desk/LiveTimer';
import { Ring } from '@/components/pos/desk/hk-ui';
import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';

const blank = { name: '', use: '', contactMinutes: '', dilution: '', steps: '', ppe: '', changeEveryHours: '', regNumber: '' };
const codeOf = (d: Disinfectant) => String(d.code || `D${String(d.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 5)}`).toUpperCase();

export function Disinfection({ tenantId, tenant, manager, scan = true }: { tenantId: string; tenant: any; manager: boolean; scan?: boolean }) {
  const { firestore } = useFirebase(); const now = useSeconds();
  const dq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'disinfectants') : null), [firestore, tenantId]);
  const since = React.useMemo(() => new Date(Date.now() - 12 * 3600000).toISOString(), []);
  const tq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'contactTimers'), where('startedAt', '>=', since)) : null), [firestore, tenantId, since]);
  const { data: rawD } = useCollection<any>(dq); const { data: rawT } = useCollection<any>(tq);
  const products: Disinfectant[] = React.useMemo(() => [...(rawD || [])].filter((d: any) => !d.archived).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))), [rawD]);
  const timers = openTimers((rawT || []) as ContactTimer[], now);
  const [what, setWhat] = React.useState<Record<string, string>>({}); const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = React.useState<(typeof blank & { id?: string }) | null>(null); const [typed, setTyped] = React.useState(''); const [cam, setCam] = React.useState(false); const [openId, setOpenId] = React.useState<string | null>(null);
  const who = () => (getAuth().currentUser?.displayName || getAuth().currentUser?.email || 'Staff').split('@')[0];
  const actor = () => ({ type: 'user' as const, id: getAuth().currentUser?.uid, name: who(), role: manager ? 'manager' : 'staff' });
  if (!firestore) return null;

  const start = async (d: Disinfectant, label?: string) => { const ref = doc(collection(firestore, 'tenants', tenantId, 'contactTimers')); const forWhat = (label ?? what[d.id] ?? '').trim().slice(0, 60) || null;
    try { await setDoc(ref, { id: ref.id, disinfectantId: d.id, name: d.name, what: forWhat, minutes: Number(d.contactMinutes), startedAt: new Date().toISOString(), byName: who(), byId: getAuth().currentUser?.uid || null, doneAt: null });
      void logAuditClient(firestore, tenantId, { action: 'disinfect.timer_started', targetType: 'contactTimer', targetId: ref.id, actor: actor(), summary: `${who()} started ${d.contactMinutes} min contact time with ${d.name}${forWhat ? ` — ${forWhat}` : ''}` });
      setWhat((w) => ({ ...w, [d.id]: '' })); setMsg({ ok: true, text: `${d.name}: ${d.contactMinutes} min timer started. Keep it wet the whole time.` }); return true; }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); return false; } };
  const clear = async (t: ContactTimer) => { const reached = contactLeft(t, Date.now()) <= 0;
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'contactTimers', t.id), { doneAt: new Date().toISOString(), doneBy: who(), reached });
      void logAuditClient(firestore, tenantId, { action: reached ? 'disinfect.contact_reached' : 'disinfect.timer_stopped_early', targetType: 'contactTimer', targetId: t.id, actor: actor(), summary: `${t.name}${t.what ? ` (${t.what})` : ''}: ${reached ? `contact time of ${t.minutes} min reached` : 'timer stopped BEFORE the contact time was reached'}` }); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); } };
  const mixed = async (d: Disinfectant) => { try { await updateDoc(doc(firestore, 'tenants', tenantId, 'disinfectants', d.id), { mixedAt: new Date().toISOString(), mixedBy: who() });
      void logAuditClient(firestore, tenantId, { action: 'disinfect.mixed_fresh', targetType: 'disinfectant', targetId: d.id, actor: actor(), summary: `${who()} made ${d.name} fresh${d.dilution ? ` (${d.dilution})` : ''}` }); setMsg({ ok: true, text: `${d.name} logged as made fresh.` }); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); } };
  const save = async () => { if (!form) return; const problem = disinfectantProblem(form); if (problem) { setMsg({ ok: false, text: problem }); return; }
    const ref = form.id ? doc(firestore, 'tenants', tenantId, 'disinfectants', form.id) : doc(collection(firestore, 'tenants', tenantId, 'disinfectants'));
    const rec = { id: ref.id, name: form.name.trim().slice(0, 60), use: form.use.trim().slice(0, 80) || null, contactMinutes: Number(form.contactMinutes), dilution: form.dilution.trim().slice(0, 120) || null, steps: cleanSteps(form.steps), ppe: form.ppe.trim().slice(0, 120) || null, changeEveryHours: Math.max(0, Number(form.changeEveryHours) || 0) || null, regNumber: form.regNumber.trim().slice(0, 40) || null, updatedAt: new Date().toISOString(), updatedBy: who() };
    try { await setDoc(ref, rec, { merge: true }); void logAuditClient(firestore, tenantId, { action: form.id ? 'disinfect.product_changed' : 'disinfect.product_added', targetType: 'disinfectant', targetId: ref.id, actor: actor(), after: rec, summary: `${rec.name}: contact time ${rec.contactMinutes} min${rec.dilution ? `, ${rec.dilution}` : ''}` });
      setForm(null); setMsg({ ok: true, text: `${rec.name} saved.` }); }
    catch { setMsg({ ok: false, text: 'That didn’t save — try again.' }); } };
  const handleCode = async (raw: string) => { const t = String(raw || '').trim().toUpperCase().split(/[/=#]/).pop() || ''; const d = products.find((p) => codeOf(p) === t);
    if (!d) { scanFeedback(false); setMsg({ ok: false, text: 'No disinfectant has that label.' }); return; } scanFeedback(await start(d)); };
  const edit = (d: Disinfectant) => setForm({ id: d.id, name: d.name, use: d.use || '', contactMinutes: String(d.contactMinutes || ''), dilution: d.dilution || '', steps: (d.steps || []).join('\n'), ppe: d.ppe || '', changeEveryHours: String(d.changeEveryHours || ''), regNumber: d.regNumber || '' });
  const input = 'h-11 w-full rounded-xl border bg-background px-3 text-[15px]';

  return (
    <div className="space-y-3">
      {msg && <p role="status" className={`text-[14px] font-semibold ${msg.ok ? 'text-emerald-800' : 'text-red-700'}`}>{msg.text}</p>}
      {timers.map((t) => { const left = contactLeft(t, now); const total = Math.max(1, t.minutes * 60); const done = left <= 0; return (
        <div key={t.id} className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-[24px] p-4 ${done ? 'border-[2px] border-emerald-700 bg-emerald-50' : 'border bg-card'}`}>
          <Ring value={(total - left) / total} done={done} size={108}>{done ? <><span aria-hidden className="text-[30px] font-[800] leading-none text-emerald-800">✓</span><span className="text-[11px] font-bold text-emerald-800">Reached</span></>
            : <><span className="text-[24px] font-[800] leading-none tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span><span className="mt-1 text-[11px] text-muted-foreground">keep wet</span></>}</Ring>
          <div className="min-w-0 space-y-2">
            <p className="text-[18px] font-[700] leading-tight">{t.what || t.name}</p>
            <p className="text-[13px] text-muted-foreground">{t.what ? `${t.name} · ` : ''}{t.minutes} min contact · {String(t.byName || '').split(' ')[0]}</p>
            <button type="button" onClick={() => clear(t)} className={`h-11 w-full rounded-[14px] text-[15px] font-[700] ${done ? 'bg-emerald-700 text-white' : 'border-[1.5px] bg-card text-muted-foreground'}`}>{done ? 'Done' : 'Stop early'}</button>
          </div>
        </div>); })}
      {scan && products.length > 0 && (<>
        <form onSubmit={(e) => { e.preventDefault(); const v = typed; setTyped(''); if (v.trim()) void handleCode(v); }} className="flex gap-2">
          <input value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 80))} placeholder="Scan a bottle’s label to start its timer" aria-label="Disinfectant label" autoCapitalize="characters" className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[15px] uppercase tracking-wider" />
          <button type="button" onClick={() => setCam((c) => !c)} className="h-11 rounded-xl border px-3 text-[13px] font-semibold">{cam ? 'Close camera' : 'Camera'}</button>
        </form>
        {cam && <ScanGate onScan={(v) => { void handleCode(v); }} label="Point the camera at the bottle’s label" />}
      </>)}
      {!products.length && !form && <p className="rounded-[20px] border border-dashed p-4 text-[14px] text-muted-foreground">No disinfectants written up yet. {manager ? 'Add each product you use, copying its contact time and directions from the label.' : 'A manager adds them here.'}</p>}
      {products.map((d) => { const sol = solutionState(d, now); const open = openId === d.id; return (
        <div key={d.id} className="rounded-[20px] border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="text-[18px] font-[700] leading-tight">{d.name}</p>{d.use && <p className="text-[14px] text-muted-foreground">{d.use}</p>}</div>
            <p className="shrink-0 text-right leading-none"><span className="text-[30px] font-[800] tabular-nums">{d.contactMinutes}</span><span className="text-[14px] font-semibold"> min</span><span className="mt-1 block text-[12px] text-muted-foreground">must stay wet</span></p>
          </div>
          {sol.due && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-900">{sol.never ? 'No fresh mix logged' : `Mixed ${sol.hoursOld} h ago`} — make it fresh (every {d.changeEveryHours} h).</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={what[d.id] || ''} onChange={(e) => setWhat((w) => ({ ...w, [d.id]: e.target.value }))} placeholder="What for? (optional, e.g. Chair 4 tools)" aria-label={`What ${d.name} is being used on`} className="h-12 min-w-[160px] flex-1 rounded-[14px] border bg-background px-3 text-[14px]" />
            <button type="button" onClick={() => start(d)} className="h-12 rounded-[14px] bg-foreground px-4 text-[15px] font-[700] text-background">Start {d.contactMinutes} min timer</button>
          </div>
          <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : d.id)} className="mt-2 h-10 text-[14px] font-semibold underline">{open ? 'Hide directions' : 'How to use it'}</button>
          {open && (<div className="mt-1 space-y-2 text-[14px]">
            {d.dilution && <p><b>Mix:</b> {d.dilution}</p>}
            {(d.steps || []).length > 0 && <ol className="space-y-1.5">{(d.steps || []).map((s, i) => <li key={i} className="flex gap-2"><span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-[700] text-background">{i + 1}</span><span>{s}</span></li>)}</ol>}
            {d.ppe && <p><b>Wear:</b> {d.ppe}</p>}
            {d.changeEveryHours ? <p><b>Make fresh:</b> every {d.changeEveryHours} h{d.mixedAt ? ` · last by ${String(d.mixedBy || '').split(' ')[0]} at ${new Date(d.mixedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</p> : null}
            {d.regNumber && <p className="text-muted-foreground">Registration no. {d.regNumber}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={() => mixed(d)} className="h-10 rounded-full border px-4 text-[13px] font-semibold">I just made it fresh</button>
              {manager && <button type="button" onClick={() => edit(d)} className="h-10 rounded-full border px-4 text-[13px]">Edit</button>}
              {manager && <button type="button" onClick={async () => { if (!(await printCodeLabels([{ title: d.name, sub: `${d.contactMinutes} min contact time`, code: codeOf(d), steps: (d.steps || []).slice(0, 4) }], 'Disinfectant labels', brandOf(tenant), 'sticker'))) setMsg({ ok: false, text: 'Allow pop-ups to print the label.' }); }} className="h-10 rounded-full border px-4 text-[13px]">Print its label</button>}
            </div>
          </div>)}
        </div>); })}
      {manager && (form ? (
        <div className="space-y-2 rounded-[20px] border-[2px] bg-card p-4">
          <p className="text-[15px] font-[700]">{form.id ? 'Edit product' : 'Add a disinfectant'}</p>
          <p className="text-[13px] text-muted-foreground">Copy everything from the product’s own label. The contact time is how long it must stay visibly wet.</p>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Product name" aria-label="Product name" className={input} />
          <input value={form.use} onChange={(e) => setForm({ ...form, use: e.target.value })} placeholder="Used for (e.g. tools, surfaces, foot spas)" aria-label="Used for" className={input} />
          <div className="flex flex-wrap gap-2 text-[13px]">
            <label>Contact time (min) <input type="number" min={0} step="0.5" value={form.contactMinutes} onChange={(e) => setForm({ ...form, contactMinutes: e.target.value })} placeholder="from the label" className="mt-1 block h-11 w-36 rounded-xl border bg-background px-3 text-[15px]" /></label>
            <label>Make fresh every (hours) <input type="number" min={0} value={form.changeEveryHours} onChange={(e) => setForm({ ...form, changeEveryHours: e.target.value })} placeholder="optional" className="mt-1 block h-11 w-36 rounded-xl border bg-background px-3 text-[15px]" /></label>
          </div>
          <input value={form.dilution} onChange={(e) => setForm({ ...form, dilution: e.target.value })} placeholder="How to mix it (as the label says), or “ready to use”" aria-label="How to mix it" className={input} />
          <textarea value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} rows={4} placeholder={'Steps, one per line\nClean off visible debris first\nApply until thoroughly wet\nLeave wet for the full contact time'} aria-label="Steps" className="w-full rounded-xl border bg-background p-3 text-[15px]" />
          <input value={form.ppe} onChange={(e) => setForm({ ...form, ppe: e.target.value })} placeholder="What to wear (e.g. gloves, eye protection)" aria-label="What to wear" className={input} />
          <input value={form.regNumber} onChange={(e) => setForm({ ...form, regNumber: e.target.value })} placeholder="Registration number on the label (optional)" aria-label="Registration number" className={input} />
          <div className="flex gap-2"><button type="button" onClick={save} className="h-11 rounded-full bg-foreground px-5 text-[14px] font-[700] text-background">Save</button><button type="button" onClick={() => setForm(null)} className="h-11 px-3 text-[14px]">Cancel</button></div>
        </div>
      ) : <button type="button" onClick={() => { setForm({ ...blank }); setMsg(null); }} className="h-11 rounded-full border px-4 text-[14px] font-semibold">+ Add a disinfectant</button>)}
    </div>);
}
