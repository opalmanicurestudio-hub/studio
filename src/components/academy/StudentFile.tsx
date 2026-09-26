'use client';
// src/components/academy/StudentFile.tsx
//
// THE STUDENT FILE — one screen, everything the school (and the state) keeps.
//   Overview      photo, contact, date of birth, emergency contact, status,
//                 risk, retention date
//   Documents     the permanent-file checklist (e.g. North Carolina 14T .0502):
//                 scan with the phone (several pages → one PDF) or upload;
//                 check; replacements keep the earlier copy
//   Board forms   what's due and when (enrolment 15 days, exit 30 days in NC),
//                 mark submitted with date, confirmation number and receipt
//   Hours         totals with state limits applied; daily + weekly records with
//                 a running total (the format the Board asks schools to keep)
//   Evaluations   infection control first (100%, in order), required mannequin
//                 evaluations, performances signed off
//   Grades · Tuition · Messages & notes · History (this student's audit trail)
//   Print complete file — one document in the ClarityFlow look.

import { ProgressRing } from '@/components/academy/Delight';
import { deviceId } from '@/lib/device';
import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader, X } from 'lucide-react';
import { PrivateImg, openPrivateFile } from '@/components/shared/private-file';
import { printDocument, heading, esc, mdLite } from '@/lib/doc-theme';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/student-file', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const shrink = (file: File, max = 1600) => new Promise<string>((res, rej) => { const r = new FileReader(); const img = new Image(); r.onload = () => { img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.82)); }; img.onerror = rej; img.src = String(r.result); }; r.onerror = rej; r.readAsDataURL(file); });
const readRaw = (file: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
const d = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const hrs = (m: number) => `${(Math.floor((m / 60) * 4) / 4).toFixed(2)} h`;
const $ = (c?: number | null) => (c == null ? '—' : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const field = 'h-10 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const SECTIONS = [['overview', 'Overview'], ['documents', 'Documents on file'], ['forms', 'Board forms'], ['hours', 'Hours & records'], ['evaluations', 'Evaluations & performances'], ['grades', 'Grades'], ['tuition', 'Tuition'], ['notes', 'Messages & notes'], ['letters', 'Letters'], ['portfolio', 'Portfolio'], ['history', 'History']] as const;

export function StudentFile({ tenantId, studentId, brand, onClose }: { tenantId: string; studentId: string; brand: { name: string; logoUrl?: string | null; color?: string | null }; onClose: () => void }) {
  const [f, setF] = useState<any>(null);
  const [sec, setSec] = useState<string>('overview');
  const [msg, setMsg] = useState('');
  const [scan, setScan] = useState<{ category: string; pages: string[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const load = useCallback(async () => { const r = await api({ action: 'get', tenantId, studentId }); if (r.ok) setF(r); else setMsg(r.error); }, [tenantId, studentId]);
  useEffect(() => { void load(); }, [load]);
  const act = async (body: any, done?: string) => { setBusy(body.action); const r = await api({ tenantId, studentId, ...body }); setBusy(''); if (!r.ok) { setMsg(r.error); return r; } if (done) setMsg(done); await load(); return r; };

  if (!f) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-background"><Loader className="h-6 w-6 animate-spin" /></div>;
  const P = f.profile; const prog = f.programs[0];
  const requiredDocs: string[] = Array.from(new Set(f.programs.flatMap((p: any) => p.requiredDocs || [])));
  const current = (cat: string) => f.files.filter((x: any) => x.category === cat && !x.replacedBy);
  const overdue = (x: any) => x.status === 'due' && new Date(x.dueAt) < new Date();

  const printFile = () => {
    const pr = prog;
    printDocument({ title: `Student file — ${P.name}`, brand, official: { label: 'Certified true record — school official' }, body: `
      ${heading('Student', 'file')}<p class="sub">${esc(P.name)} · ${esc(P.email)}${P.dob ? ` · born ${esc(d(P.dob))}` : ''}</p>
      <div class="panel"><b>Contact</b> ${esc(P.phone || '—')} · ${esc(P.address || '—')}<br><b>Emergency</b> ${esc(P.emergency?.name || '—')} ${P.emergency?.relation ? `(${esc(P.emergency.relation)})` : ''} ${esc(P.emergency?.phone || '')}</div>
      ${f.programs.map((p: any) => `
        <h2>${esc(p.name)} ${p.rule ? `· ${esc(p.rule)}` : ''}</h2>
        <div class="grid"><div class="stat"><div class="v">${esc(p.hours?.total ?? 0)} h</div><div class="l">Total${p.totalHours ? ` of ${esc(p.totalHours)}` : ''}</div></div><div class="stat"><div class="v">${esc(p.hours?.inPerson ?? 0)} h</div><div class="l">In school</div></div><div class="stat"><div class="v">${esc(p.hours?.online ?? 0)} h</div><div class="l">Online${p.limits ? ` (max ${esc(p.limits.onlineMaxPct)}%)` : ''}</div></div><div class="stat"><div class="v">${esc(p.status)}</div><div class="l">Started ${esc(d(p.startDate))}</div></div></div>
        ${(p.hours?.notes || []).length ? `<p class="muted">${p.hours.notes.map(esc).join(' · ')}</p>` : ''}
        ${p.evaluations.length ? `<table><thead><tr><th>Evaluation</th><th>Pass mark</th><th>Result</th><th>Date</th><th>Teacher</th></tr></thead>${p.evaluations.map((e: any) => `<tr><td>${esc(e.label)}</td><td>${esc(e.passPct)}%</td><td class="${e.result?.passed ? 'ok' : 'muted'}">${e.result?.passed ? `Passed ${esc(e.result.score)}%` : e.result ? `Not yet (${esc(e.result.attempts?.length || 0)} attempts)` : 'Not taken'}</td><td>${esc(d(e.result?.at))}</td><td>${esc(e.result?.by || '')}</td></tr>`).join('')}</table>` : ''}
        ${p.requirements.length ? `<table><thead><tr><th>Performance</th><th>Signed off</th><th>Required</th></tr></thead>${p.requirements.map((r: any) => `<tr><td>${esc(r.label)}</td><td>${esc(r.done)}</td><td>${esc(r.required)}</td></tr>`).join('')}</table>` : ''}
        ${p.retainUntil ? `<p class="muted">Keep these records until ${esc(d(p.retainUntil))} (or until accepted for the Board exam, if earlier).</p>` : ''}`).join('')}
      <h2>Documents on file</h2><table><thead><tr><th>Document</th><th>Status</th><th>Filed</th><th>By</th></tr></thead>${requiredDocs.map((c) => { const x = current(c)[0]; return `<tr><td>${esc(c)}</td><td class="${x ? (x.status === 'verified' ? 'ok' : 'warn') : 'bad'}">${x ? esc(x.status) : 'missing'}</td><td>${esc(d(x?.at))}</td><td>${esc(x?.uploadedBy || '')}</td></tr>`; }).join('')}</table>
      <h2>Board forms</h2><table><thead><tr><th>Form</th><th>Due</th><th>Status</th><th>Submitted</th><th>Confirmation</th></tr></thead>${f.forms.map((x: any) => `<tr><td>${esc(x.label)}</td><td>${esc(d(x.dueAt))}</td><td class="${x.status === 'submitted' ? 'ok' : overdue(x) ? 'bad' : 'warn'}">${esc(x.status)}</td><td>${esc(x.submittedAt || '')}</td><td>${esc(x.confirmation || '')}</td></tr>`).join('')}</table>
      <h2 class="break">Hour records — weekly subtotals and running total</h2><table><thead><tr><th>Week of</th><th>In school</th><th>Online</th><th>Running total</th></tr></thead>${f.records.slice().reverse().map((w: any) => `<tr><td>${esc(d(w.week))}</td><td>${esc(hrs(w.schoolMin))}</td><td>${esc(hrs(w.onlineMin))}</td><td>${esc(hrs(w.runningMin))}</td></tr>`).join('')}</table>
      ${f.admission?.agreement ? `<h2>Enrolment agreement</h2><div class="panel">Signed by ${esc(f.admission.agreement.signedName)} on ${esc(d(f.admission.agreement.signedAt))}${f.admission.agreement.countersignedBy ? ` · countersigned by ${esc(f.admission.agreement.countersignedBy)}` : ''}<br><span class="muted">Fingerprint ${esc(f.admission.agreement.sha256)}</span></div>` : ''}
      <h2>History (latest 60)</h2><table><thead><tr><th>#</th><th>When</th><th>By</th><th>What</th></tr></thead>${f.audit.slice(0, 60).map((a: any) => `<tr><td>${esc(a.seq)}</td><td>${esc(new Date(a.at).toLocaleString())}</td><td>${esc(a.by)}</td><td>${esc(a.summary)}</td></tr>`).join('')}</table>` });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-4">
        <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
          {P.photo ? <PrivateImg src={P.photo} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-lg font-black">{String(P.name || '?')[0]}</div>}
          <div className="min-w-0 flex-1"><p className="truncate text-xl font-black">{P.name}</p><p className="truncate text-[12px] text-muted-foreground">{P.email}{prog ? ` · ${prog.name} · ${prog.status}` : ''}{prog?.risk ? ` · risk ${prog.risk.level}` : ''}</p></div>
          <button type="button" onClick={printFile} className="h-10 shrink-0 rounded-xl bg-foreground px-3 text-sm font-bold text-background sm:px-4"><span className="sm:hidden">🖨 Print</span><span className="hidden sm:inline">Print complete file</span></button>
          <button type="button" onClick={onClose} aria-label="Close" className="h-10 w-10 rounded-xl border-2"><X className="mx-auto h-4 w-4" /></button>
        </div>
        {msg && <p className="mt-3 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" onClick={() => setMsg('')}>{msg}</p>}
        <div className="mt-4 grid gap-6 lg:grid-cols-[200px_1fr]">
          <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:block lg:space-y-1 lg:px-0">{SECTIONS.map(([k, l]) => {
            const flag = k === 'documents' ? requiredDocs.filter((c) => !current(c).length).length : k === 'forms' ? f.forms.filter((x: any) => x.status === 'due').length : 0;
            return <button key={k} type="button" onClick={() => setSec(k)} className={`flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold lg:w-full ${sec === k ? 'bg-foreground text-background' : 'bg-muted/40 lg:bg-transparent'}`}>{l}{flag ? <span className="rounded-full bg-red-500 px-1.5 text-[11px] text-white">{flag}</span> : null}</button>;
          })}</nav>

          <div className="min-w-0 space-y-4">
            {sec === 'overview' && (
              <>
                {f.programs.filter((p: any) => p.totalHours).map((p: any) => <div key={p.id} className="flex flex-wrap items-center gap-4 rounded-2xl bg-muted/40 p-4"><ProgressRing value={p.hours?.total || 0} max={p.totalHours} color={brand.color || '#1c1917'} label={`${p.hours?.total || 0}`} sub={`of ${p.totalHours} h`} />
                  <div className="min-w-0 flex-1 space-y-2">{(p.requirements || []).slice(0, 4).map((r: any) => <div key={r.key}><div className="flex justify-between text-[12px]"><span className="truncate">{r.label}</span><b>{r.done}/{r.required}</b></div><div className="mt-0.5 h-1.5 rounded-full bg-background"><div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, (r.done / Math.max(1, r.required)) * 100)}%`, background: brand.color || '#1c1917' }} /></div></div>)}</div></div>)}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{f.programs.map((p: any) => [['Total hours', `${p.hours?.total ?? 0}${p.totalHours ? ` / ${p.totalHours}` : ''}`], ['In school', `${p.hours?.inPerson ?? 0} h`], ['Online', `${p.hours?.online ?? 0} h`], ['Keep records until', p.retainUntil ? d(p.retainUntil) : '—']]).flat().map(([l, v]: any, i: number) => <div key={i} className="rounded-2xl bg-muted/40 p-3"><p className="text-lg font-black">{v}</p><p className="text-[11px] text-muted-foreground">{l}</p></div>)}</div>
                {f.programs.flatMap((p: any) => p.hours?.notes || []).map((n: string) => <p key={n} className="rounded-xl bg-amber-50 p-2 text-[12px] text-amber-900">{n}</p>)}
                <section className="space-y-2 rounded-2xl border-2 border-border/60 p-4">
                  <div className="flex items-center justify-between"><p className="font-black">Details</p>{f.canManage && !edit && <button type="button" onClick={() => setEdit({ dob: P.dob || '', phone: P.phone || '', address: P.address || '', emergency: P.emergency || { name: '', phone: '', relation: '' } })} className="text-sm font-bold underline">Edit</button>}</div>
                  {!edit ? (
                    <div className="grid gap-1 text-sm sm:grid-cols-2">
                      <p><span className="text-muted-foreground">Date of birth</span> · {P.dob ? d(P.dob) : '—'}</p><p><span className="text-muted-foreground">Phone</span> · {P.phone || '—'}</p>
                      <p className="sm:col-span-2"><span className="text-muted-foreground">Address</span> · {P.address || '—'}</p>
                      <p className="sm:col-span-2"><span className="text-muted-foreground">Emergency contact</span> · {P.emergency?.name ? `${P.emergency.name}${P.emergency.relation ? ` (${P.emergency.relation})` : ''} · ${P.emergency.phone || ''}` : '—'}</p>
                      <p><span className="text-muted-foreground">Language</span> · {({ en: 'English', es: 'Español', vi: 'Tiếng Việt', ko: '한국어', zh: '中文', pt: 'Português', fr: 'Français', ht: 'Kreyòl ayisyen', ar: 'العربية', ru: 'Русский' } as Record<string, string>)[P.language] || P.language}</p><p><span className="text-muted-foreground">Student since</span> · {d(P.createdAt)}</p>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-[12px] font-bold">Date of birth<input type="date" className={field} value={edit.dob} onChange={(e) => setEdit({ ...edit, dob: e.target.value })} /></label>
                      <label className="text-[12px] font-bold">Phone<input className={field} value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
                      <label className="text-[12px] font-bold sm:col-span-2">Address<input className={field} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></label>
                      {(['name', 'relation', 'phone'] as const).map((k) => <label key={k} className="text-[12px] font-bold">Emergency contact — {k}<input className={field} value={edit.emergency[k] || ''} onChange={(e) => setEdit({ ...edit, emergency: { ...edit.emergency, [k]: e.target.value } })} /></label>)}
                      <div className="flex gap-2 sm:col-span-2"><button type="button" onClick={async () => { const r = await act({ action: 'profile-save', profile: edit }, 'Details saved.'); if (r?.ok) setEdit(null); }} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Save</button><button type="button" onClick={() => setEdit(null)} className="h-10 px-3 text-sm font-bold text-muted-foreground">Cancel</button></div>
                    </div>
                  )}
                </section>
                <AccommodationsCard value={f.accommodations} canManage={f.canManage} onSave={(acc: any) => act({ action: 'acc-save', accommodations: acc }, 'Accommodations saved — they apply wherever this student signs in.')} />
                {prog?.risk?.reasons?.length > 0 && <section className="rounded-2xl bg-red-50 p-4 text-sm"><p className="font-black text-red-900">Needs attention ({prog.risk.level})</p>{prog.risk.reasons.map((r: string) => <p key={r}>• {r}</p>)}</section>}
                {f.admission?.agreement && <section className="rounded-2xl bg-muted/40 p-4 text-sm"><p className="font-black">Enrolment agreement</p><p>Signed by {f.admission.agreement.signedName} on {d(f.admission.agreement.signedAt)}{f.admission.agreement.countersignedBy ? ` · countersigned by ${f.admission.agreement.countersignedBy}` : ' · not countersigned yet'}</p><details><summary className="cursor-pointer text-[12px] font-bold">Read it</summary><pre className="mt-1 whitespace-pre-wrap text-[12px]">{f.admission.agreement.text}</pre></details></section>}
              </>
            )}

            {sec === 'documents' && (f.signed || []).length > 0 && <section className="space-y-1 rounded-2xl bg-emerald-50 p-3 text-sm"><p className="font-black text-emerald-900">Signed school documents</p>{f.signed.map((a: any, i: number) => <p key={i}>✓ <b>{a.title}</b> (v{a.version}) — signed “{a.signedName}” on {d(a.at)}</p>)}</section>}
            {sec === 'documents' && (
              <section className="space-y-2">
                <p className="text-sm text-muted-foreground">The permanent file {prog?.state === 'NC' ? 'North Carolina requires (21 NCAC 14T .0502)' : 'for this program'}. Scan with your phone — several pages become one PDF. Nothing is ever deleted; a new copy keeps the old one.</p>
                {[...requiredDocs, 'Other'].map((cat) => { const cur = current(cat); const x = cur[0]; const past = f.files.filter((y: any) => y.category === cat && y.replacedBy); return (
                  <div key={cat} className={`rounded-2xl p-3 text-sm ${cat === 'Other' ? 'bg-muted/20' : x ? (x.status === 'verified' ? 'bg-emerald-50' : 'bg-amber-50') : 'bg-red-50'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 font-bold">{cat}{cat !== 'Other' && <span className={`ml-2 text-[11px] ${x ? (x.status === 'verified' ? 'text-emerald-700' : 'text-amber-700') : 'text-red-700'}`}>{x ? `${x.status} · ${d(x.at)} · ${x.uploadedBy}` : 'missing'}</span>}</span>
                      {f.canManage && <>
                        <button type="button" onClick={() => setScan({ category: cat, pages: [] })} className="h-8 rounded-lg bg-foreground px-3 text-[12px] font-bold text-background">📷 Scan</button>
                        <label className="h-8 cursor-pointer rounded-lg border-2 px-3 text-[12px] font-bold leading-7">Upload PDF<input type="file" accept="application/pdf,image/*" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const data = file.type === 'application/pdf' ? await readRaw(file) : await shrink(file); await act({ action: 'file-upload', category: cat, name: cat === 'Other' ? file.name : cat, files: [data] }, `${cat} filed.`); }} /></label>
                        {x && <button type="button" onClick={() => openPrivateFile(x.ref)} className="h-8 rounded-lg border-2 px-3 text-[12px] font-bold">Open</button>}
                        {x && x.status !== 'verified' && <button type="button" onClick={() => act({ action: 'file-verify', fileId: x.id }, 'Checked.')} className="h-8 rounded-lg border-2 border-emerald-300 px-3 text-[12px] font-bold text-emerald-800">Mark checked</button>}
                      </>}
                    </div>
                    {cat === 'Other' && cur.length > 0 && <div className="mt-1 space-y-0.5">{cur.map((y: any) => <p key={y.id} className="text-[12px]">{y.name} · {d(y.at)} {f.canManage && <button type="button" onClick={() => openPrivateFile(y.ref)} className="underline">open</button>}</p>)}</div>}
                    {past.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Earlier copies kept: {past.map((y: any) => d(y.at)).join(', ')}</p>}
                  </div>
                ); })}
                {!f.canManage && <p className="text-[12px] text-muted-foreground">Identity documents are visible to owners and managers only.</p>}
              </section>
            )}

            {sec === 'forms' && (
              <section className="space-y-2">
                <p className="text-sm text-muted-foreground">Forms owed to the licensing board, created automatically with their due dates.{prog?.state === 'NC' && <> Submit through the Board’s <a href="https://www.nccosmeticarts.com" target="_blank" rel="noreferrer" className="underline">school documents portal</a>, then record it here.</>}</p>
                {f.forms.length === 0 ? <p className="text-sm text-muted-foreground">No forms due.</p> : f.forms.map((x: any) => (
                  <FormRow key={x.id} x={x} overdue={overdue(x)} canManage={f.canManage} onSave={(body: any) => act({ action: 'form-update', formId: x.id, ...body }, 'Form updated.')} />
                ))}
              </section>
            )}

            {sec === 'hours' && (
              <section className="space-y-3">
                {f.programs.map((p: any) => <div key={p.id} className="rounded-2xl bg-muted/40 p-3 text-sm"><p className="font-black">{p.name}</p><p>{p.hours?.total ?? 0} h total{p.totalHours ? ` of ${p.totalHours}` : ''} · {p.hours?.inPerson ?? 0} h in school · {p.hours?.online ?? 0} h online{p.hours?.live ? ` (incl. ${p.hours.live} h live)` : ''}</p>{p.limits && <p className="text-[12px] text-muted-foreground">Limits applied: {p.limits.dailyCapHours} h/day, {p.limits.weeklyCapHours} h/week in school; online up to {p.limits.onlineMaxPct}%; rounded down to the quarter hour.</p>}{(p.hours?.notes || []).map((n: string) => <p key={n} className="text-[12px] text-amber-800">{n}</p>)}</div>)}
                <div className="overflow-x-auto rounded-2xl border-2 border-border/60"><table className="w-full text-left text-[12px]"><thead className="bg-muted/50"><tr><th className="p-2">Week of</th><th className="p-2">In school</th><th className="p-2">Online</th><th className="p-2">Running total</th><th className="p-2">Days</th></tr></thead>
                  <tbody>{f.records.map((w: any) => <tr key={w.week} className="border-t align-top"><td className="p-2 font-bold">{d(w.week)}</td><td className="p-2">{hrs(w.schoolMin)}</td><td className="p-2">{hrs(w.onlineMin)}</td><td className="p-2 font-bold">{hrs(w.runningMin)}</td><td className="p-2 text-muted-foreground">{w.days.map((x: any) => `${new Date(x.day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })} ${hrs(x.school)}${x.online ? ` + ${hrs(x.online)} online` : ''}`).join(' · ')}</td></tr>)}</tbody></table></div>
              </section>
            )}

            {sec === 'evaluations' && f.programs.map((p: any) => (
              <section key={p.id} className="space-y-3">
                {p.evaluations.length > 0 && <div className="space-y-1.5"><p className="font-black">Evaluations {p.rule ? <span className="font-normal text-muted-foreground">· {p.rule}</span> : null}</p>
                  {p.evaluations.map((e: any) => <EvalRow key={e.key} e={e} onRecord={(score: number, notes: string) => act({ action: 'eval-record', enrollmentId: p.id, key: e.key, score, notes }, 'Recorded.')} />)}
                  <p className="text-[11px] text-muted-foreground">Infection control and blood exposure come first, at 100%, in order. The student salon only offers a student the services they’ve been cleared for.</p></div>}
                <div className="space-y-1.5"><p className="font-black">Performances signed off</p><div className="grid gap-1.5 sm:grid-cols-2">{p.requirements.map((r: any) => <div key={r.key} className="rounded-xl bg-muted/40 px-3 py-2 text-sm"><div className="flex justify-between"><span>{r.label}</span><b>{r.done}/{r.required}</b></div><div className="mt-1 h-1.5 rounded-full bg-background"><div className="h-1.5 rounded-full bg-foreground" style={{ width: `${Math.min(100, (r.done / Math.max(1, r.required)) * 100)}%` }} /></div></div>)}</div></div>
                {p.sap.length > 0 && <div className="text-sm"><p className="font-black">Progress checks</p>{p.sap.map((s: any, i: number) => <p key={i}>{s.checkpoint} h · <b>{s.result}</b> · {d(s.at)}{s.fails?.length ? ` · ${s.fails.join('; ')}` : ''}</p>)}</div>}
              </section>
            ))}

            {sec === 'grades' && <section className="space-y-1 text-sm">{f.grades.length === 0 ? <p className="text-muted-foreground">No quiz grades yet.</p> : f.grades.map((g: any, i: number) => <p key={i} className="flex justify-between rounded-xl bg-muted/40 px-3 py-2"><span>Quiz · lesson {g.lessonId.slice(0, 6)}</span><span className={g.passed ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>{g.best}% · {g.attempts} attempt{g.attempts === 1 ? '' : 's'}</span></p>)}</section>}

            {sec === 'tuition' && f.programs.map((p: any) => p.tuition ? (
              <section key={p.id} className="space-y-2 text-sm"><p className="text-lg font-black">{$(p.tuition.balanceCents)} due <span className="text-sm font-normal text-muted-foreground">· paid {$(p.tuition.paidCents)} of {$(p.tuition.totalCents)} · {p.tuition.status.replace(/_/g, ' ')}{p.tuition.nextDueAt ? ` · next ${d(p.tuition.nextDueAt)}` : ''}</span></p>
                <div className="space-y-0.5">{p.tuition.entries.map((e: any, i: number) => <p key={i} className="text-[12px]">{d(e.at)} · {e.type} · <b>{$(e.amountCents)}</b> · {e.desc}</p>)}</div></section>
            ) : <p key={p.id} className="text-sm text-muted-foreground">No tuition plan.</p>)}

            {sec === 'notes' && (
              <section className="space-y-3">
                <form onSubmit={async (e) => { e.preventDefault(); const el = e.currentTarget.elements.namedItem('n') as HTMLTextAreaElement; if (el.value.trim()) { await act({ action: 'note-add', text: el.value }); el.value = ''; } }} className="space-y-2"><textarea name="n" rows={2} className="w-full rounded-xl border-2 p-3 text-sm" placeholder="Private staff note (the student never sees these)" /><button className="h-9 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Add note</button></form>
                {f.notes.map((n: any, i: number) => <p key={i} className="rounded-xl bg-muted/40 p-2 text-sm"><span className="text-[11px] text-muted-foreground">{d(n.at)} · {n.by}</span><br />{n.text}</p>)}
                <p className="pt-2 font-black">Recent messages</p>
                {f.messages.map((m: any, i: number) => <p key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from === 'school' ? 'ml-auto bg-foreground text-background' : 'bg-muted'}`}>{m.text}{m.translated && m.from === 'student' ? <span className="mt-1 block text-[11px] italic opacity-80">English: {m.translated}</span> : null}</p>)}
              </section>
            )}

            {sec === 'portfolio' && <PortfolioReview items={f.portfolio || []} onReview={(id: string, status: string) => act({ action: 'portfolio-review', id, status }, status === 'approved' ? 'Approved — it can now appear on the student’s shared portfolio.' : 'Hidden from the shared portfolio.')} />}
            {sec === 'letters' && <Letters f={f} brand={brand} onSend={(body: any) => act({ action: 'letter-send', ...body }, body.email ? 'Letter emailed and saved to the file.' : 'Letter saved to the file.')} />}
            {sec === 'history' && <section className="space-y-1">{f.audit.map((a: any) => <p key={a.seq} className="text-[12px]"><span className="text-muted-foreground">#{a.seq} · {new Date(a.at).toLocaleString()} · {a.by}</span> — {a.summary}</p>)}<p className="pt-2 text-[11px] text-muted-foreground">From the academy’s tamper-evident audit log (Attendance → Verify records checks the whole chain).</p></section>}
          </div>
        </div>
      </div>

      {scan && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => setScan(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-3 rounded-3xl bg-background p-5">
            <p className="text-lg font-black">Scan · {scan.category}</p>
            <p className="text-sm text-muted-foreground">Photograph each page flat, in good light. Add as many pages as you need — they’re saved as one PDF.</p>
            <div className="grid grid-cols-3 gap-2">{scan.pages.map((pg, i) => <div key={i} className="relative"><img src={pg} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full rounded-xl object-cover" /><button type="button" onClick={() => setScan({ ...scan, pages: scan.pages.filter((_, k) => k !== i) })} className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/60 text-[12px] text-white" aria-label={`Remove page ${i + 1}`}>✕</button><span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span></div>)}
              <label className="flex aspect-[3/4] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-sm font-bold">📷<span>Add page</span><input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setScan({ ...scan, pages: [...scan.pages, await shrink(file)] }); e.currentTarget.value = ''; }} /></label></div>
            <div className="flex gap-2"><button type="button" disabled={!scan.pages.length || !!busy} onClick={async () => { const r = await act({ action: 'file-upload', category: scan.category, name: scan.category, files: scan.pages }, `${scan.category} filed (${scan.pages.length} page${scan.pages.length === 1 ? '' : 's'}).`); if (r?.ok) setScan(null); }} className="h-11 flex-1 rounded-xl bg-foreground text-sm font-bold text-background disabled:opacity-40">{busy ? 'Saving…' : `Save ${scan.pages.length || ''} page${scan.pages.length === 1 ? '' : 's'} as PDF`}</button><button type="button" onClick={() => setScan(null)} className="h-11 px-4 text-sm font-bold text-muted-foreground">Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function EvalRow({ e, onRecord }: { e: any; onRecord: (score: number, notes: string) => void }) {
  const [open, setOpen] = useState(false); const [score, setScore] = useState(''); const [notes, setNotes] = useState('');
  const r = e.result;
  return (
    <div className={`rounded-xl px-3 py-2 text-sm ${r?.passed ? 'bg-emerald-50' : 'bg-muted/40'}`}>
      <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1">{e.infection ? '🧼 ' : '🖐 '}{e.label}</span>
        <span className={`text-[12px] font-bold ${r?.passed ? 'text-emerald-700' : 'text-muted-foreground'}`}>{r?.passed ? `✓ ${r.score}% · ${new Date(r.at).toLocaleDateString()} · ${r.by}` : r ? `not yet · ${r.attempts?.length || 0} attempt${r.attempts?.length === 1 ? '' : 's'}` : `pass mark ${e.passPct}%`}</span>
        {!r?.passed && <button type="button" onClick={() => setOpen(!open)} className="h-8 rounded-lg border-2 px-2 text-[12px] font-bold">Record score</button>}</div>
      {open && <div className="mt-2 flex flex-wrap gap-2"><input type="number" min={0} max={100} value={score} onChange={(x) => setScore(x.target.value)} placeholder="Score %" className="h-9 w-24 rounded-lg border-2 px-2" /><input value={notes} onChange={(x) => setNotes(x.target.value)} placeholder="Notes (optional)" className="h-9 flex-1 rounded-lg border-2 px-2" /><button type="button" disabled={score === ''} onClick={() => { onRecord(Number(score), notes); setOpen(false); setScore(''); setNotes(''); }} className="h-9 rounded-lg bg-foreground px-3 text-[12px] font-bold text-background disabled:opacity-40">Save</button></div>}
      {(r?.attempts || []).length > 1 && <p className="mt-1 text-[11px] text-muted-foreground">Attempts: {r.attempts.map((a: any) => `${a.score}% (${new Date(a.at).toLocaleDateString()})`).join(' · ')}</p>}
    </div>
  );
}

function FormRow({ x, overdue, canManage, onSave }: { x: any; overdue: boolean; canManage: boolean; onSave: (b: any) => void }) {
  const [open, setOpen] = useState(false); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [conf, setConf] = useState(''); const [receipt, setReceipt] = useState<string | null>(null);
  return (
    <div className={`rounded-2xl p-3 text-sm ${x.status === 'submitted' ? 'bg-emerald-50' : overdue ? 'bg-red-50' : 'bg-amber-50'}`}>
      <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 font-bold">{x.label}</span>
        <span className={`text-[12px] font-bold ${x.status === 'submitted' ? 'text-emerald-700' : overdue ? 'text-red-700' : 'text-amber-800'}`}>{x.status === 'submitted' ? `✓ submitted ${x.submittedAt}${x.confirmation ? ` · #${x.confirmation}` : ''}` : `${overdue ? 'OVERDUE — ' : ''}due ${new Date(x.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}</span>
        {x.receiptRef && <button type="button" onClick={() => openPrivateFile(x.receiptRef)} className="text-[12px] font-bold underline">receipt</button>}
        {canManage && x.status !== 'submitted' && <button type="button" onClick={() => setOpen(!open)} className="h-8 rounded-lg bg-foreground px-3 text-[12px] font-bold text-background">Mark submitted</button>}</div>
      {open && <div className="mt-2 grid gap-2 sm:grid-cols-[150px_1fr_auto_auto]"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-lg border-2 px-2" /><input value={conf} onChange={(e) => setConf(e.target.value)} placeholder="Confirmation number (if any)" className="h-9 rounded-lg border-2 px-2" />
        <label className="h-9 cursor-pointer rounded-lg border-2 px-3 text-[12px] font-bold leading-8">{receipt ? '✓ receipt' : 'Receipt / screenshot'}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setReceipt(file.type === 'application/pdf' ? await readRaw(file) : await shrink(file)); }} /></label>
        <button type="button" onClick={() => { onSave({ status: 'submitted', submittedAt: date, confirmation: conf, receipt }); setOpen(false); }} className="h-9 rounded-lg bg-emerald-600 px-3 text-[12px] font-bold text-white">Save</button></div>}
    </div>
  );
}


// ── Accommodations ────────────────────────────────────────────────────────
function AccommodationsCard({ value, canManage, onSave }: any) {
  const v0 = { extraTime: 1, largeText: false, dyslexia: false, highContrast: false, reducedMotion: false, audioFirst: false, note: '', ...(value || {}) };
  const [edit, setEdit] = useState(false); const [v, setV] = useState<any>(v0);
  const on = [v0.extraTime > 1 && `Extra time ×${v0.extraTime}`, v0.largeText && 'Larger text', v0.dyslexia && 'Dyslexia-friendly font', v0.highContrast && 'High contrast', v0.reducedMotion && 'Reduced motion', v0.audioFirst && 'Audio-first'].filter(Boolean) as string[];
  const T: [string, string, string][] = [['largeText', 'Larger text', 'Everything a size up'], ['dyslexia', 'Dyslexia-friendly', 'Readable font, extra spacing'], ['highContrast', 'High contrast', 'Solid backgrounds, darker text'], ['reducedMotion', 'Reduced motion', 'No animations'], ['audioFirst', 'Audio-first', 'Read-aloud on text and quiz questions']];
  return (
    <section className="space-y-2 rounded-2xl border-2 border-sky-200 bg-sky-50/60 p-4">
      <div className="flex items-center justify-between"><p className="font-black">♿ Accommodations</p>{canManage && !edit && <button type="button" onClick={() => { setV(v0); setEdit(true); }} className="text-sm font-bold underline">{on.length ? 'Edit' : 'Add'}</button>}</div>
      {!edit ? (on.length ? <div className="flex flex-wrap gap-1.5">{on.map((x) => <span key={x} className="rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-sky-900">{x}</span>)}</div> : <p className="text-sm text-muted-foreground">None. Accommodations apply automatically wherever the student signs in.</p>)
        : <div className="space-y-2">
          <div><p className="text-[12px] font-bold">Extra time on timed work</p><div className="mt-1 flex gap-1.5">{[1, 1.25, 1.5, 2].map((x) => <button key={x} type="button" onClick={() => setV({ ...v, extraTime: x })} className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${v.extraTime === x ? 'bg-foreground text-background' : 'bg-white'}`}>{x === 1 ? 'None' : `×${x}`}</button>)}</div><p className="mt-1 text-[11px] text-muted-foreground">Practice exams and speed-round games. Live-class quiz timers are shared by the room.</p></div>
          <div className="grid gap-1.5 sm:grid-cols-2">{T.map(([k, l, h]) => <label key={k} className="flex items-start gap-2 rounded-xl bg-white p-2 text-sm"><input type="checkbox" className="mt-1" checked={!!v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} /><span><b className="block">{l}</b><span className="text-[11px] text-muted-foreground">{h}</span></span></label>)}</div>
          <label className="block text-[12px] font-bold">Notes for instructors (private — the student never sees this)<textarea rows={2} className="mt-1 w-full rounded-xl border-2 bg-white p-2 text-sm" value={v.note || ''} onChange={(e) => setV({ ...v, note: e.target.value })} /></label>
          <div className="flex gap-2"><button type="button" onClick={async () => { await onSave(v); setEdit(false); }} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Save</button><button type="button" onClick={() => setEdit(false)} className="h-10 px-3 text-sm font-bold text-muted-foreground">Cancel</button></div>
          <p className="text-[11px] text-muted-foreground">These set the student’s starting point — they can still adjust text size and more from the Aa menu.</p>
        </div>}
      {!edit && v0.note && canManage && <p className="text-[12px] text-sky-900"><b>Instructor notes:</b> {v0.note}</p>}
    </section>
  );
}

// ── Letters ───────────────────────────────────────────────────────────────
function letterTemplates(f: any, brand?: any) {
  const P = f.profile || {}; const pr = (f.programs || [])[0] || {};
  const first = String(P.name || 'Student').split(' ')[0]; const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const prog = pr.name || '[[fill in: program]]'; const start = pr.startDate ? new Date(pr.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '[[fill in: start date]]';
  const hrs = pr.hours ? `${pr.hours.total} of ${pr.totalHours || '—'} hours` : '[[fill in: hours]]';
  // With a signer in School identity, the official block below the letter carries the signature, name and title.
  const sign = brand?.signerName ? '\n\nSincerely,' : '\n\nSincerely,\n\n[[fill in: your name and title]]';
  return [
    { kind: 'enrolment', title: 'Enrolment confirmation', body: `Dear ${first},\n\nWelcome! This letter confirms your enrolment in **${prog}**, starting ${start}.\n\n# What happens next\n- Your student portal is where you’ll find lessons, hours and your to-do list\n- Please read and sign the student handbook in your portal\n- Bring [[fill in: what to bring on day one]]\n\nWe’re glad to have you.${sign}` },
    { kind: 'warning', title: 'Progress warning', body: `Dear ${first},\n\nThis letter is a formal notice about your progress in **${prog}** as of ${today}. You have completed ${hrs}.\n\n# What we noticed\n[[fill in: what isn’t meeting the standard — attendance, grades or practicals]]\n\n# What needs to happen\n[[fill in: the improvement plan and the date it will be reviewed]]\n\nWe want you to succeed. Please speak with us if anything is getting in the way — we can help.${sign}` },
    { kind: 'probation', title: 'Academic probation notice', body: `Dear ${first},\n\nFollowing your progress evaluation, you are placed on **academic probation** in ${prog} from ${today}, in line with the school’s satisfactory academic progress policy.\n\n# Why\n[[fill in: the standard not met]]\n\n# The plan\n[[fill in: the conditions to meet and the review date]]\n\nYou may appeal this decision by [[fill in: how and by when]].${sign}` },
    { kind: 'leave', title: 'Leave of absence approved', body: `Dear ${first},\n\nYour request for a leave of absence from ${prog} is approved.\n\n- **Leave begins:** [[fill in: start date]]\n- **Expected return:** [[fill in: return date]]\n\nIf your plans change, please tell us before your return date. If you do not return as planned, the school’s leave policy will apply.${sign}` },
    { kind: 'withdrawal', title: 'Withdrawal confirmation', body: `Dear ${first},\n\nThis letter confirms your withdrawal from ${prog}, effective [[fill in: date]]. Your record shows ${hrs} completed.\n\nAny refund owed is calculated under the school’s refund policy. [[fill in: refund details, if any]]\n\nWe wish you the very best, and you are welcome to talk with us about returning.${sign}` },
    { kind: 'completion', title: 'Program completion', body: `Dear ${first},\n\nCongratulations! This letter confirms that you have completed **${prog}**, with ${hrs} recorded as of ${today}.\n\n# Next steps\n- [[fill in: licensing exam steps for your state]]\n\nWe’re proud of you.${sign}` },
    { kind: 'custom', title: 'Letter', body: `Dear ${first},\n\n${sign}` },
  ];
}
function Letters({ f, brand, onSend }: any) {
  const tpls = letterTemplates(f, brand);
  const [cur, setCur] = useState<any>(null); const [busy, setBusy] = useState('');
  const holes = (t: string) => (String(t || '').match(/\[\[[^\]]*\]\]/g) || []).length;
  const P = f.profile || {};
  const print = (t: string, b: string, when?: string) => printDocument({ title: t, brand, official: { date: new Date(when || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }, body: `<p class="muted">${esc(new Date(when || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}</p><p><b>${esc(P.name || '')}</b>${P.address ? `<br>${esc(P.address)}` : ''}</p>${heading('', t)}${mdLite(b)}` });
  return (
    <section className="space-y-3">
      {!cur ? <>
        <p className="text-sm text-muted-foreground">Letters are filled from this file. Anything that needs your decision is marked [[fill in]]. Saved copies stay here; emails go in the student’s language with the English original as the official copy.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{tpls.map((t) => <button key={t.kind} type="button" onClick={() => setCur({ ...t })} className="rounded-2xl border-2 border-border/60 p-3 text-left text-sm font-bold hover:bg-muted/30">✉️ {t.title}</button>)}</div>
        {(f.letters || []).length > 0 && <div className="space-y-1"><p className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">Sent and saved</p>{f.letters.map((l: any) => <button key={l.id} type="button" onClick={() => print(l.title, l.body, l.at)} className="flex w-full justify-between rounded-xl bg-muted/40 px-3 py-2 text-left text-sm"><span>{l.title}</span><span className="text-[12px] text-muted-foreground">{new Date(l.at).toLocaleDateString()} · {l.emailed ? `emailed${l.lang ? ` (${l.lang} + English)` : ''}` : 'saved'} · {l.by}</span></button>)}</div>}
      </> : <>
        <input className="h-11 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm font-bold" value={cur.title} onChange={(e) => setCur({ ...cur, title: e.target.value })} />
        {holes(cur.body) > 0 && <p className="rounded-xl bg-amber-50 p-2 text-sm text-amber-900"><b>{holes(cur.body)} part{holes(cur.body) === 1 ? '' : 's'} to fill in</b> before saving or sending.</p>}
        <div className="grid gap-3 lg:grid-cols-2"><textarea rows={14} className="w-full rounded-xl border-2 border-border/60 bg-background p-3 text-sm" value={cur.body} onChange={(e) => setCur({ ...cur, body: e.target.value })} />
          <div className="rounded-xl border-2 border-border/60 bg-white p-4 text-sm [&_h2]:mt-3 [&_h2]:font-black [&_li]:ml-5 [&_li]:list-disc [&_p]:my-1.5" dangerouslySetInnerHTML={{ __html: mdLite(cur.body) }} /></div>
        {f.canManage ? <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => print(cur.title, cur.body)} className="h-10 rounded-xl border-2 px-4 text-sm font-bold">Print</button>
          <button type="button" disabled={!!busy || holes(cur.body) > 0} onClick={async () => { setBusy('save'); const r = await onSend({ kind: cur.kind, title: cur.title, body: cur.body, email: false }); setBusy(''); if (r?.ok) setCur(null); }} className="h-10 rounded-xl border-2 px-4 text-sm font-bold disabled:opacity-40">Save to file</button>
          <button type="button" disabled={!!busy || holes(cur.body) > 0 || !P.email} onClick={async () => { setBusy('email'); const r = await onSend({ kind: cur.kind, title: cur.title, body: cur.body, email: true }); setBusy(''); if (r?.ok) setCur(null); }} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background disabled:opacity-40">{busy === 'email' ? 'Sending…' : `Email to ${String(P.name || '').split(' ')[0] || 'student'}`}</button>
          <button type="button" onClick={() => setCur(null)} className="h-10 px-3 text-sm font-bold text-muted-foreground">Cancel</button></div>
          : <p className="text-[12px] text-muted-foreground">Owners and managers send letters.</p>}
      </>}
    </section>
  );
}


// ── Portfolio: approve each piece before it can be shared ──────────────────
function PortfolioReview({ items, onReview }: { items: any[]; onReview: (id: string, status: string) => void }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No portfolio work yet. Students add before-and-after photos from their portal; you approve each piece before it can be shared.</p>;
  const pending = items.filter((x) => x.status === 'pending').length;
  return (
    <section className="space-y-3">
      {pending > 0 && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900"><b>{pending} waiting for approval.</b> Check the photos show hands and nails only, and that the client consented.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{items.map((x) => (
        <div key={x.id} className="space-y-2 rounded-2xl border-2 border-border/60 p-3">
          <div className="grid grid-cols-2 gap-2">{[['Before', x.before], ['After', x.after]].map(([l, u]: any) => <div key={l} className="aspect-square overflow-hidden rounded-xl bg-muted">{u ? <img src={u} alt={l} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-[11px] text-muted-foreground">No {String(l).toLowerCase()}</span>}</div>)}</div>
          <p className="font-black">{x.service}</p>{x.note && <p className="text-[13px] text-muted-foreground">{x.note}</p>}
          <p className="text-[12px] text-muted-foreground">Client consent: <b>{x.consent?.initials}</b> · {x.consent?.at ? new Date(x.consent.at).toLocaleDateString() : ''}</p>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${x.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : x.status === 'hidden' ? 'bg-muted' : 'bg-amber-100 text-amber-900'}`}>{x.status === 'approved' ? 'Approved' : x.status === 'hidden' ? 'Hidden' : 'Waiting'}</span>
            {x.status !== 'approved' && <button type="button" onClick={() => onReview(x.id, 'approved')} className="ml-auto h-9 rounded-xl bg-emerald-600 px-3 text-[12px] font-bold text-white">Approve</button>}
            {x.status !== 'hidden' && <button type="button" onClick={() => onReview(x.id, 'hidden')} className={`h-9 rounded-xl border-2 px-3 text-[12px] font-bold ${x.status === 'approved' ? 'ml-auto' : ''}`}>Hide</button>}
          </div>
        </div>
      ))}</div>
    </section>
  );
}
