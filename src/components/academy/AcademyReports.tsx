'use client';
// src/components/academy/AcademyReports.tsx
//
// REPORTS (licensed schools). Pick a report → it shows here → "Print / save
// as PDF" opens a clean page (no app around it) and "Download CSV" exports
// the table. Hours certification letters carry a verification code anyone
// can check at /verify/CODE.

import { deviceId } from '@/lib/device';
import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader } from 'lucide-react';
import { printDocument, heading, esc } from '@/lib/doc-theme';

async function call(path: string, body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const field = 'h-10 rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const REPORTS = [
  { k: 'hours-letter', t: 'Hours certification letter', h: 'For the licensing board — one student’s verified hours and services, with a verification code' },
  { k: 'attendance', t: 'Monthly attendance', h: 'Online, live and in-person hours for every student in a month' },
  { k: 'sap', t: 'Progress checks (SAP)', h: 'Every student’s satisfactory-academic-progress checks' },
  { k: 'outcomes', t: 'Outcomes', h: 'Completion, licensure and placement — with the graduates behind them' },
] as const;

export function AcademyReports({ tenantId }: { tenantId: string }) {
  const [kind, setKind] = useState<string>('hours-letter');
  const [students, setStudents] = useState<any[]>([]);
  const [programs, setPrograms] = useState<any[]>([]);
  const [opt, setOpt] = useState({ enrollmentId: '', month: new Date().toISOString().slice(0, 7), programId: '' });
  const [out, setOut] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    call('/api/academy/journey', { tenantId, action: 'students' }).then((r) => r.ok && setStudents(r.students));
    call('/api/academy/school', { tenantId, action: 'overview' }).then((r) => r.ok && setPrograms(r.programs));
  }, [tenantId]);

  const run = async () => {
    setBusy(true); setErr(''); setOut(null);
    const r = await call('/api/academy/reports', { tenantId, action: kind, ...opt });
    setBusy(false); if (r.ok) setOut(r); else setErr(r.error);
  };
  const csv = () => {
    const rep = out?.report; if (!rep) return;
    const text = [rep.columns, ...rep.rows].map((row: any[]) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `${rep.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`; a.click();
  };
  const print = () => {
    if (out?.letter) {
      const L = out.letter;
      printDocument({ title: `Hours certification — ${L.studentName}`, brand: out.brand, official: { date: new Date(L.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }, footerNote: `Verification code ${L.code} · confirm at ${L.verifyUrl}`, body: `
        <p class="muted">${esc(new Date(L.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}</p>
        ${heading('Certification of', 'hours')}<p class="sub">To ${esc(out.brand?.licensingBoard || 'the North Carolina Board of Cosmetic Art Examiners')}, or whom it may concern</p>
        <p>This certifies that <b>${esc(L.studentName)}</b> (${esc(L.email)}) was enrolled in <b>${esc(L.programName)}</b>${L.programHours ? ` (${esc(L.programHours)} hours)` : ''}${L.startDate ? `, starting ${esc(new Date(L.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}` : ''}, and as of this date has completed the following, as recorded by the school’s attendance and learning records:</p>
        <div class="grid grid3"><div class="stat"><div class="v">${esc(L.hours.online)} h</div><div class="l">Online (verified${L.hours.live ? `, incl. ${esc(L.hours.live)} h live` : ''})</div></div><div class="stat"><div class="v">${esc(L.hours.inPerson)} h</div><div class="l">In school (approved)</div></div><div class="stat"><div class="v accent">${esc(L.hours.total)} h</div><div class="l">Total${L.programHours ? ` of ${esc(L.programHours)}` : ''}</div></div></div>
        ${(L.hours.notes || []).length ? `<p class="muted">${L.hours.notes.map(esc).join(' · ')}</p>` : ''}
        ${L.requirements?.length ? `<h2>Performances signed off</h2><table><thead><tr><th>Performance</th><th>Completed</th><th>Required</th></tr></thead>${L.requirements.map((r: any) => `<tr><td>${esc(r.label)}</td><td>${esc(r.done)}</td><td>${esc(r.required)}</td></tr>`).join('')}</table>` : ''}
        <p class="muted" style="margin-top:14px">Hours are rounded down to the quarter hour and measured by the school’s systems (server time). Every record is kept in a tamper-evident audit log.</p>` });
      return;
    }
    const rep = out?.report; if (!rep) return;
    printDocument({ title: rep.title, brand: out.brand, body: `${heading(rep.title.split(' ').slice(0, -1).join(' ') || rep.title, rep.title.split(' ').slice(-1)[0])}<p class="sub">${esc(rep.subtitle)}</p>
      ${rep.summary ? `<div class="grid grid3">${rep.summary.map((s: any[]) => `<div class="stat"><div class="v">${esc(s[1])}</div><div class="l">${esc(s[0])} · ${esc(s[2])}</div></div>`).join('')}</div>` : ''}
      <table><thead><tr>${rep.columns.map((c: string) => `<th>${esc(c)}</th>`).join('')}</tr></thead>${rep.rows.map((r: any[]) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>
      ${(rep.notes || []).map((n: string) => `<p class="muted">${esc(n)}</p>`).join('')}` });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">{REPORTS.map((r) => (
        <button key={r.k} type="button" onClick={() => { setKind(r.k); setOut(null); }} className={`rounded-2xl border-2 p-4 text-left ${kind === r.k ? 'border-foreground' : 'border-border/60'}`}><p className="font-black">{r.t}</p><p className="text-[12px] text-muted-foreground">{r.h}</p></button>
      ))}</div>
      <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-muted/40 p-3">
        {kind === 'hours-letter' ? (
          <label className="text-[12px] font-bold">Student<select className={`${field} block w-72`} value={opt.enrollmentId} onChange={(e) => setOpt({ ...opt, enrollmentId: e.target.value })}><option value="">Choose…</option>{students.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.program}</option>)}</select></label>
        ) : (
          <>
            {kind === 'attendance' && <label className="text-[12px] font-bold">Month<input type="month" className={`${field} block`} value={opt.month} onChange={(e) => setOpt({ ...opt, month: e.target.value })} /></label>}
            <label className="text-[12px] font-bold">Program<select className={`${field} block`} value={opt.programId} onChange={(e) => setOpt({ ...opt, programId: e.target.value })}><option value="">All programs</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </>
        )}
        <button type="button" disabled={busy || (kind === 'hours-letter' && !opt.enrollmentId)} onClick={run} className="h-10 rounded-xl bg-foreground px-5 text-sm font-bold text-background disabled:opacity-40">{busy ? 'Preparing…' : kind === 'hours-letter' ? 'Issue letter' : 'Show report'}</button>
      </div>
      {err && <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-800">{err}</p>}
      {busy && <Loader className="h-5 w-5 animate-spin" />}

      {out?.letter && (
        <div className="space-y-2 rounded-2xl border-2 border-foreground/30 p-4 text-sm">
          <p className="text-lg font-black">Letter ready — {out.letter.studentName}</p>
          <p>{out.letter.hours.total} hours ({out.letter.hours.online} online{out.letter.hours.live ? `, incl. ${out.letter.hours.live} live` : ''} · {out.letter.hours.inPerson} in person){out.letter.programHours ? ` of ${out.letter.programHours}` : ''}.</p>
          {out.letter.requirements?.length > 0 && <p>{out.letter.requirements.map((r: any) => `${r.label} ${r.done}/${r.required}`).join(' · ')}</p>}
          <p className="text-muted-foreground">Verification code <span className="font-mono font-bold text-foreground">{out.letter.code}</span> · recorded in the audit log</p>
          <button type="button" onClick={print} className="h-10 rounded-xl bg-foreground px-5 text-sm font-bold text-background">Print / save as PDF</button>
        </div>
      )}
      {out?.report && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-lg font-black">{out.report.title}</p><p className="text-[12px] text-muted-foreground">{out.report.subtitle}</p></div>
            <div className="flex gap-2"><button type="button" onClick={print} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Print / save as PDF</button><button type="button" onClick={csv} className="h-10 rounded-xl border-2 px-4 text-sm font-bold">Download CSV</button></div></div>
          {out.report.summary && <div className="grid grid-cols-3 gap-2">{out.report.summary.map((s: any[]) => <div key={s[0]} className="rounded-2xl bg-muted/40 p-3 text-center"><p className="text-2xl font-black">{s[1]}</p><p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{s[0]}</p><p className="text-[11px] text-muted-foreground">{s[2]}</p></div>)}</div>}
          <div className="overflow-x-auto rounded-2xl border-2 border-border/60"><table className="w-full text-left text-[12px]"><thead className="bg-muted/50"><tr>{out.report.columns.map((c: string) => <th key={c} className="px-3 py-2 font-black">{c}</th>)}</tr></thead>
            <tbody>{out.report.rows.length === 0 ? <tr><td className="px-3 py-4 text-muted-foreground" colSpan={out.report.columns.length}>Nothing to show yet.</td></tr> : out.report.rows.map((r: any[], i: number) => <tr key={i} className="border-t">{r.map((v, j) => <td key={j} className="px-3 py-2">{String(v)}</td>)}</tr>)}</tbody></table></div>
          {(out.report.notes || []).map((n: string) => <p key={n} className="text-[11px] text-muted-foreground">{n}</p>)}
        </div>
      )}
    </div>
  );
}
