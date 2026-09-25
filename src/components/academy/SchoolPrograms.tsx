'use client';
// src/components/academy/SchoolPrograms.tsx
//
// PROGRAMS (licensed-school mode).
//   Build a program: total / online / in-person hours; SERVICE requirements
//   (e.g. "Pedicures × 25") mapped to the clinic services that count; the
//   check-off rubric instructors score; theory courses students get.
//   Enrol students (they become bookable in the student salon).
//   Roster: status and progress; open a student for full progress;
//   leave of absence / withdrawn / graduated with a reason (kept on record).

import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader, Plus, Trash2 } from 'lucide-react';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/school', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const field = 'h-10 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const STATUS: Record<string, string> = { active: 'bg-emerald-100 text-emerald-800', loa: 'bg-amber-100 text-amber-800', withdrawn: 'bg-stone-200 text-stone-600', graduated: 'bg-violet-100 text-violet-800' };

export function SchoolPrograms({ tenantId, courses }: { tenantId: string; courses: any[] }) {
  const [d, setD] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [roster, setRoster] = useState<any[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [prog, setProg] = useState<any>(null);
  const [f, setF] = useState({ name: '', email: '', startDate: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api({ action: 'overview', tenantId }); if (r.ok) setD(r); else setMsg(r.error); }, [tenantId]);
  const loadRoster = useCallback(async (pid: string) => { const r = await api({ action: 'roster', tenantId, programId: pid }); if (r.ok) setRoster(r.students); }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (sel) { void loadRoster(sel); setProg(null); } }, [sel, loadRoster]);

  if (!d) return <Loader className="h-5 w-5 animate-spin" />;
  const program = d.programs.find((p: any) => p.id === sel);
  const save = async () => {
    const td = edit.tuitionD || {};
    const program = { ...edit, requiredDocs: String(edit.requiredDocsText || '').split('\n').map((x: string) => x.trim()).filter(Boolean),
      tuition: { tuitionCents: Math.round(Number(td.tuition) * 100) || 0, registrationFeeCents: Math.round(Number(td.registration) * 100) || 0, kitCents: Math.round(Number(td.kit) * 100) || 0, downPaymentCents: Math.round(Number(td.down) * 100) || 0, installments: Number(td.installments) || 0, interval: td.interval } };
    setBusy(true); const r = await api({ action: 'program-save', tenantId, program }); setBusy(false);
    if (!r.ok) { setMsg(r.error); return; } setMsg('Program saved.'); setEdit(null); await load(); setSel(r.id);
  };
  const DEFAULT_TIERS = [{ upToPct: 10, keepPct: 10 }, { upToPct: 25, keepPct: 25 }, { upToPct: 50, keepPct: 50 }, { upToPct: 100, keepPct: 100 }];
  const withMoney = (p: any) => ({ ...p, requiredDocsText: (p.requiredDocs?.length ? p.requiredDocs : ['Photo ID', 'High school diploma or GED', 'Proof of age']).join('\n'),
    tuitionD: { tuition: (p.tuition?.tuitionCents || 0) / 100, registration: (p.tuition?.registrationFeeCents || 0) / 100, kit: (p.tuition?.kitCents || 0) / 100, down: (p.tuition?.downPaymentCents || 0) / 100, installments: p.tuition?.installments || 0, interval: p.tuition?.interval || 'month' },
    refundPolicy: p.refundPolicy || { cancelDays: 3, registrationNonRefundable: true, kitNonRefundable: true, tiers: DEFAULT_TIERS }, agreementTemplate: p.agreementTemplate || '',
    scheduledHoursPerWeek: p.scheduledHoursPerWeek || '', sap: { checkpoints: (p.sap?.checkpoints || [150, 300, 450]).join(', '), minAttendancePct: p.sap?.minAttendancePct ?? 67, minQuizAvg: p.sap?.minQuizAvg ?? 70, minPracticalAvg: p.sap?.minPracticalAvg ?? 3 } });
  const newProgram = () => setEdit(withMoney({ name: '', totalHours: '', requiredOnlineHours: '', requiredInPersonHours: '', requirements: [{ label: '', count: 0, serviceIds: [] }], rubric: d.defaultRubric, courseIds: [], tipPolicy: 'school' }));

  return (
    <div className="space-y-4">
      {msg && <p className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {d.programs.map((p: any) => <button key={p.id} type="button" onClick={() => { setSel(p.id); setEdit(null); }} className={`h-10 rounded-xl border-2 px-4 text-sm font-bold ${sel === p.id ? 'border-foreground' : 'border-border/60'}`}>{p.name}</button>)}
        <button type="button" onClick={newProgram} className="inline-flex h-10 items-center gap-1 rounded-xl border-2 border-dashed px-4 text-sm font-bold"><Plus className="h-4 w-4" />New program</button>
      </div>
      {d.programs.length === 0 && !edit && <p className="rounded-2xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">Create your first program — e.g. “Nail Technology, 600 hours” — with the hours and services your state requires.</p>}

      {edit && (
        <div className="space-y-3 rounded-2xl border-2 border-foreground/30 p-4">
          <p className="font-black">{edit.id ? 'Edit program' : 'New program'}</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <label className="text-[12px] font-bold sm:col-span-4">Name<input className={field} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Nail Technology" /></label>
            <label className="text-[12px] font-bold">Total hours<input className={field} type="number" value={edit.totalHours || ''} onChange={(e) => setEdit({ ...edit, totalHours: e.target.value })} /></label>
            <label className="text-[12px] font-bold">Online (max / required)<input className={field} type="number" value={edit.requiredOnlineHours || ''} onChange={(e) => setEdit({ ...edit, requiredOnlineHours: e.target.value })} /></label>
            <label className="text-[12px] font-bold">In person required<input className={field} type="number" value={edit.requiredInPersonHours || ''} onChange={(e) => setEdit({ ...edit, requiredInPersonHours: e.target.value })} /></label>
            <label className="text-[12px] font-bold">Clinic tips go to<select className={field} value={edit.tipPolicy} onChange={(e) => setEdit({ ...edit, tipPolicy: e.target.value })}><option value="school">the school</option><option value="student">the student</option><option value="none">no tips</option></select></label>
          </div>
          <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
            <p className="text-sm font-black">Service requirements <span className="font-normal text-muted-foreground">— what your state requires students to perform, and which clinic services count</span></p>
            {edit.requirements.map((r: any, i: number) => {
              const setR = (patch: any) => { const rs = [...edit.requirements]; rs[i] = { ...rs[i], ...patch }; setEdit({ ...edit, requirements: rs }); };
              return (
                <div key={i} className="space-y-1.5 rounded-xl bg-background p-2">
                  <div className="flex gap-2"><input className={field} value={r.label} onChange={(e) => setR({ label: e.target.value })} placeholder="e.g. Pedicures" /><input className={field + ' w-24'} type="number" value={r.count} onChange={(e) => setR({ count: e.target.value })} title="How many" /><button type="button" onClick={() => setEdit({ ...edit, requirements: edit.requirements.filter((_: any, k: number) => k !== i) })} className="p-2 text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></div>
                  <div className="flex flex-wrap gap-1">{d.services.map((s: any) => { const on = (r.serviceIds || []).includes(s.id); return <button key={s.id} type="button" onClick={() => setR({ serviceIds: on ? r.serviceIds.filter((x: string) => x !== s.id) : [...(r.serviceIds || []), s.id] })} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${on ? 'bg-foreground text-background' : 'bg-muted'}`}>{s.name}</button>; })}</div>
                </div>
              );
            })}
            <button type="button" onClick={() => setEdit({ ...edit, requirements: [...edit.requirements, { label: '', count: 0, serviceIds: [] }] })} className="rounded-full bg-background px-3 py-1 text-[12px] font-bold">+ Requirement</button>
            <p className="text-[11px] text-muted-foreground">Tip: create discounted “Student clinic” services in your service menu first, then pick them here. Enrolled students are added to them automatically.</p>
          </div>
          <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
            <p className="text-sm font-black">Check-off rubric <span className="font-normal text-muted-foreground">— instructors score each 1–5</span></p>
            {edit.rubric.criteria.map((c: any, i: number) => <div key={i} className="flex gap-2"><input className={field} value={c.label} onChange={(e) => { const cs = [...edit.rubric.criteria]; cs[i] = { label: e.target.value }; setEdit({ ...edit, rubric: { ...edit.rubric, criteria: cs } }); }} /><button type="button" onClick={() => setEdit({ ...edit, rubric: { ...edit.rubric, criteria: edit.rubric.criteria.filter((_: any, k: number) => k !== i) } })} className="p-2 text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></div>)}
            <div className="flex items-center gap-2"><button type="button" onClick={() => setEdit({ ...edit, rubric: { ...edit.rubric, criteria: [...edit.rubric.criteria, { label: '' }] } })} className="rounded-full bg-background px-3 py-1 text-[12px] font-bold">+ Criterion</button>
              <label className="ml-auto text-[12px] font-bold">Pass at average ≥ <input className="h-8 w-16 rounded-lg border px-2" type="number" min={1} max={5} step={0.5} value={edit.rubric.passAvg} onChange={(e) => setEdit({ ...edit, rubric: { ...edit.rubric, passAvg: e.target.value } })} /></label></div>
          </div>
          <div className="space-y-1 rounded-2xl bg-muted/40 p-3">
            <p className="text-sm font-black">Theory courses <span className="font-normal text-muted-foreground">— enrolled students get these free</span></p>
            <div className="flex flex-wrap gap-1">{courses.map((c: any) => { const on = (edit.courseIds || []).includes(c.id); return <button key={c.id} type="button" onClick={() => setEdit({ ...edit, courseIds: on ? edit.courseIds.filter((x: string) => x !== c.id) : [...(edit.courseIds || []), c.id] })} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${on ? 'bg-foreground text-background' : 'bg-background'}`}>{c.title}</button>; })}</div>
          </div>
          <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
            <p className="text-sm font-black">Tuition <span className="font-normal text-muted-foreground">— what enrolling costs, and how it’s paid</span></p>
            <div className="grid gap-2 sm:grid-cols-3">
              {([['tuition', 'Tuition ($)'], ['registration', 'Registration fee ($)'], ['kit', 'Kit ($)'], ['down', 'Down payment ($)'], ['installments', 'Instalments after that']] as const).map(([k, l]) => (
                <label key={k} className="text-[12px] font-bold">{l}<input className={field} type="number" min={0} value={edit.tuitionD[k]} onChange={(e) => setEdit({ ...edit, tuitionD: { ...edit.tuitionD, [k]: e.target.value } })} /></label>
              ))}
              <label className="text-[12px] font-bold">Every<select className={field} value={edit.tuitionD.interval} onChange={(e) => setEdit({ ...edit, tuitionD: { ...edit.tuitionD, interval: e.target.value } })}><option value="month">month</option><option value="biweekly">2 weeks</option></select></label>
            </div>
            {(() => { const td = edit.tuitionD; const total = (Number(td.tuition) || 0) + (Number(td.registration) || 0) + (Number(td.kit) || 0); const n = Number(td.installments) || 0; return <p className="text-[12px] text-muted-foreground">Total ${total.toLocaleString()} · {n ? `$${Number(td.down || 0).toLocaleString()} down, then ${n} × about $${Math.round((total - (Number(td.down) || 0)) / n).toLocaleString()} on autopay` : 'paid in full at enrolment'}</p>; })()}
          </div>
          <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
            <p className="text-sm font-black">Schedule & progress checks <span className="font-normal text-muted-foreground">— satisfactory academic progress, set to your state / accreditor rules</span></p>
            <div className="grid gap-2 sm:grid-cols-5">
              <label className="text-[12px] font-bold">Scheduled hours / week<input className={field} type="number" value={edit.scheduledHoursPerWeek} onChange={(e) => setEdit({ ...edit, scheduledHoursPerWeek: e.target.value })} /></label>
              <label className="text-[12px] font-bold sm:col-span-2">Check at hours (comma-separated)<input className={field} value={edit.sap.checkpoints} onChange={(e) => setEdit({ ...edit, sap: { ...edit.sap, checkpoints: e.target.value } })} /></label>
              <label className="text-[12px] font-bold">Min attendance %<input className={field} type="number" value={edit.sap.minAttendancePct} onChange={(e) => setEdit({ ...edit, sap: { ...edit.sap, minAttendancePct: e.target.value } })} /></label>
              <label className="text-[12px] font-bold">Min quiz avg %<input className={field} type="number" value={edit.sap.minQuizAvg} onChange={(e) => setEdit({ ...edit, sap: { ...edit.sap, minQuizAvg: e.target.value } })} /></label>
              <label className="text-[12px] font-bold">Min practical avg (1–5)<input className={field} type="number" step={0.5} value={edit.sap.minPracticalAvg} onChange={(e) => setEdit({ ...edit, sap: { ...edit.sap, minPracticalAvg: e.target.value } })} /></label>
            </div>
            <p className="text-[11px] text-muted-foreground">Attendance % = hours completed ÷ hours scheduled so far. Below the minimums at a checkpoint → warning, then probation.</p>
          </div>
          <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
            <p className="text-sm font-black">Refund policy <span className="font-normal text-muted-foreground">— set this to your state’s required refund schedule</span></p>
            <div className="flex flex-wrap items-center gap-3 text-[12px] font-bold">
              <label>Full refund if cancelled within <input className="h-8 w-14 rounded-lg border px-2" type="number" value={edit.refundPolicy.cancelDays} onChange={(e) => setEdit({ ...edit, refundPolicy: { ...edit.refundPolicy, cancelDays: e.target.value } })} /> days of signing</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={edit.refundPolicy.registrationNonRefundable} onChange={(e) => setEdit({ ...edit, refundPolicy: { ...edit.refundPolicy, registrationNonRefundable: e.target.checked } })} />Registration fee non-refundable</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={edit.refundPolicy.kitNonRefundable} onChange={(e) => setEdit({ ...edit, refundPolicy: { ...edit.refundPolicy, kitNonRefundable: e.target.checked } })} />Kit non-refundable once issued</label>
            </div>
            {edit.refundPolicy.tiers.map((x: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">Withdrawing by <input className="h-8 w-16 rounded-lg border px-2" type="number" value={x.upToPct} onChange={(e) => { const ts = [...edit.refundPolicy.tiers]; ts[i] = { ...ts[i], upToPct: e.target.value }; setEdit({ ...edit, refundPolicy: { ...edit.refundPolicy, tiers: ts } }); }} />% of the program → school keeps <input className="h-8 w-16 rounded-lg border px-2" type="number" value={x.keepPct} onChange={(e) => { const ts = [...edit.refundPolicy.tiers]; ts[i] = { ...ts[i], keepPct: e.target.value }; setEdit({ ...edit, refundPolicy: { ...edit.refundPolicy, tiers: ts } }); }} />% of tuition
                <button type="button" onClick={() => setEdit({ ...edit, refundPolicy: { ...edit.refundPolicy, tiers: edit.refundPolicy.tiers.filter((_: any, k: number) => k !== i) } })} className="text-red-600" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button></div>
            ))}
            <button type="button" onClick={() => setEdit({ ...edit, refundPolicy: { ...edit.refundPolicy, tiers: [...edit.refundPolicy.tiers, { upToPct: 100, keepPct: 100 }] } })} className="rounded-full bg-background px-3 py-1 text-[12px] font-bold">+ Step</button>
          </div>
          <div className="grid gap-2 rounded-2xl bg-muted/40 p-3 md:grid-cols-2">
            <label className="text-sm font-black">Documents applicants upload (one per line)<textarea className={field + ' h-28 py-2'} value={edit.requiredDocsText} onChange={(e) => setEdit({ ...edit, requiredDocsText: e.target.value })} /></label>
            <label className="text-sm font-black">About this program (shown on the apply page)<textarea className={field + ' h-28 py-2'} value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
            <label className="text-sm font-black md:col-span-2">Enrolment agreement <span className="font-normal text-muted-foreground">— leave empty to use the standard one. Fill-ins: {'{{student}} {{program}} {{school}} {{start}} {{hours}} {{tuition}} {{registration}} {{kit}} {{total}} {{plan}} {{refundPolicy}}'}</span>
              <textarea className={field + ' h-48 py-2 font-mono text-[12px]'} value={edit.agreementTemplate} onChange={(e) => setEdit({ ...edit, agreementTemplate: e.target.value })} placeholder="Leave empty for the standard agreement — have your state’s required wording reviewed before use." /></label>
          </div>
          <div className="flex gap-2"><button type="button" disabled={busy || !edit.name.trim()} onClick={save} className="h-10 rounded-xl bg-foreground px-5 text-sm font-bold text-background disabled:opacity-50">{busy ? 'Saving…' : 'Save program'}</button><button type="button" onClick={() => setEdit(null)} className="h-10 px-4 text-sm font-bold text-muted-foreground">Cancel</button></div>
        </div>
      )}

      {program && !edit && (
        <div className="space-y-3 rounded-2xl border-2 border-border/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-lg font-black">{program.name}</p><p className="text-[12px] text-muted-foreground">{program.totalHours || '—'} hours · {(program.requirements || []).map((r: any) => `${r.label} × ${r.count}`).join(' · ') || 'no service requirements yet'}</p></div>
            <button type="button" onClick={() => setEdit(withMoney({ ...program, requirements: program.requirements?.length ? program.requirements : [{ label: '', count: 0, serviceIds: [] }], rubric: program.rubric || d.defaultRubric }))} className="h-9 rounded-xl border-2 px-3 text-sm font-bold">Edit program</button>
          </div>
          <div className="grid gap-2 rounded-2xl bg-muted/40 p-3 sm:grid-cols-[1fr_1fr_160px_auto]">
            <input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Student name" />
            <input className={field} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" type="email" />
            <input className={field} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} type="date" title="Start date" />
            <button type="button" disabled={busy || !f.name || !f.email.includes('@')} onClick={async () => { setBusy(true); const r = await api({ action: 'program-enroll', tenantId, programId: program.id, ...f }); setBusy(false); if (r.ok) { setMsg(r.already ? `${f.name} is already enrolled.` : `${f.name} enrolled — they can now be booked in the student salon, and have access to the theory courses.`); setF({ name: '', email: '', startDate: '' }); void loadRoster(program.id); } else setMsg(r.error); }} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background disabled:opacity-50">Enrol</button>
          </div>
          {!roster ? <Loader className="h-5 w-5 animate-spin" /> : roster.length === 0 ? <p className="text-sm text-muted-foreground">No students yet.</p> : (
            <div className="space-y-1.5">{roster.map((s) => {
              const total = (program.requirements || []).reduce((n: number, r: any) => n + (r.count || 0), 0);
              const done = (program.requirements || []).reduce((n: number, r: any) => n + Math.min(r.count || 0, s.serviceCounts?.[r.key] || 0), 0);
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted/40 px-3 py-2 text-sm">
                  <button type="button" onClick={async () => { const r = await api({ action: 'progress', tenantId, enrollmentId: s.id }); if (r.ok) setProg(r.progress); }} className="min-w-0 flex-1 truncate text-left font-bold underline-offset-2 hover:underline">{s.name} <span className="font-normal text-muted-foreground">· {s.email} · since {s.startDate}</span></button>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS[s.status] || ''}`}>{s.status === 'loa' ? 'leave' : s.status}</span>
                  {total > 0 && <span className="text-[12px] font-bold">{done}/{total} services</span>}
                  <select value="" onChange={async (e) => { const status = e.target.value; if (!status) return; const reason = ['loa', 'withdrawn'].includes(status) ? window.prompt(`Reason for ${status === 'loa' ? 'leave of absence' : 'withdrawal'} (kept on the record):`) : ''; if (['loa', 'withdrawn'].includes(status) && !reason) return; const r = await api({ action: 'program-status', tenantId, enrollmentId: s.id, status, reason }); if (r.ok) void loadRoster(program.id); else setMsg(r.error); }} className="h-8 rounded-lg border px-1 text-[12px]">
                    <option value="">Change…</option><option value="active">Active</option><option value="loa">Leave of absence</option><option value="withdrawn">Withdrawn</option><option value="graduated">Graduated</option>
                  </select>
                </div>
              );
            })}</div>
          )}
          {prog && (
            <div className="space-y-2 rounded-2xl border-2 border-foreground/30 p-3">
              <div className="flex items-center justify-between"><p className="font-black">{prog.enrollment.name} — progress</p><button type="button" onClick={() => setProg(null)} className="text-[12px] font-bold text-muted-foreground">Close</button></div>
              <p className="text-sm">Hours: <span className="font-bold">{prog.hours.total}{prog.program.totalHours ? ` of ${prog.program.totalHours}` : ''}</span> ({prog.hours.online} online · {prog.hours.inPerson} in person)</p>
              <div className="grid gap-1.5 sm:grid-cols-2">{prog.requirements.map((r: any) => <div key={r.key} className="rounded-xl bg-muted/40 px-3 py-2 text-sm"><div className="flex justify-between"><span>{r.label}</span><span className="font-bold">{r.done}/{r.required}</span></div><div className="mt-1 h-1.5 rounded-full bg-background"><div className="h-1.5 rounded-full bg-foreground" style={{ width: `${Math.min(100, (r.done / Math.max(1, r.required)) * 100)}%` }} /></div></div>)}</div>
              <p className="text-[11px] text-muted-foreground">Status history: {(prog.enrollment.statusHistory || []).map((h: any) => `${h.status} ${new Date(h.at).toLocaleDateString()}${h.reason ? ` (${h.reason})` : ''}`).join(' → ')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
