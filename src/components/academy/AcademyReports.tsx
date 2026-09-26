'use client';
// src/components/academy/AcademyReports.tsx
//
// REPORTS (licensed schools). Pick a report → it shows here → "Print / save
// as PDF" opens a clean page (no app around it) and "Download CSV" exports
// the table. Hours certification letters carry a verification code anyone
// can check at /verify/CODE.

import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader } from 'lucide-react';

async function call(path: string, body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const esc = (v: any) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const field = 'h-10 rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const REPORTS = [
  { k: 'hours-letter', t: 'Hours certification letter', h: 'For the licensing board — one student’s verified hours and services, with a verification code' },
  { k: 'attendance', t: 'Monthly attendance', h: 'Online, live and in-person hours for every student in a month' },
  { k: 'sap', t: 'Progress checks (SAP)', h: 'Every student’s satisfactory-academic-progress checks' },
  { k: 'outcomes', t: 'Outcomes', h: 'Completion, licensure and placement — with the graduates behind them' },
] as const;

function printHtml(title: string, body: string) {
  const w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:Georgia,'Times New Roman',serif;color:#1c1917;max-width:900px;margin:32px auto;padding:0 28px;line-height:1.5}
    h1{font-weight:400;font-size:26px;margin:0 0 4px} .sub{color:#57534e;margin:0 0 20px} table{width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;font-size:12px}
    th,td{border-bottom:1px solid #d6d3d1;text-align:left;padding:6px 8px;vertical-align:top} th{background:#f5f5f4} .notes{font-family:system-ui,sans-serif;font-size:11px;color:#57534e;margin-top:16px}
    .head{border-bottom:2px solid #1c1917;padding-bottom:10px;margin-bottom:24px} .school{font-size:22px} .small{font-size:12px;color:#57534e;font-family:system-ui,sans-serif}
    .sig{margin-top:56px;display:flex;gap:48px} .sig div{flex:1;border-top:1px solid #1c1917;padding-top:6px;font-size:12px;font-family:system-ui,sans-serif}
    .summary{display:flex;gap:12px;margin:12px 0 20px} .summary div{flex:1;border:1px solid #d6d3d1;border-radius:10px;padding:10px;font-family:system-ui,sans-serif} .summary b{font-size:22px;display:block}
    @media print{body{margin:0}}</style></head><body>${body}<script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

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
      printHtml(`Hours certification — ${L.studentName}`, `
        <div class="head"><div class="school">${esc(L.school.name)}</div><div class="small">${esc([L.school.address, L.school.phone, L.school.email].filter(Boolean).join(' · '))}</div></div>
        <p class="small">${esc(new Date(L.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}</p>
        <h1>Certification of hours</h1><p class="sub">To the state licensing board, or whom it may concern</p>
        <p>This certifies that <b>${esc(L.studentName)}</b> (${esc(L.email)}) was enrolled in <b>${esc(L.programName)}</b>${L.programHours ? ` (${esc(L.programHours)} hours)` : ''} at ${esc(L.school.name)}${L.startDate ? `, starting ${esc(new Date(L.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}` : ''}, and as of this date has completed the following, as recorded by the school’s attendance and learning records:</p>
        <table><tr><th>Hours</th><th></th></tr>
          <tr><td>Online learning (verified active time${L.hours.live ? `, including ${esc(L.hours.live)} h of live classes` : ''})</td><td>${esc(L.hours.online)} h</td></tr>
          <tr><td>In person (clocked in and out; approved)</td><td>${esc(L.hours.inPerson)} h</td></tr>
          <tr><td><b>Total</b></td><td><b>${esc(L.hours.total)} h</b>${L.programHours ? ` of ${esc(L.programHours)}` : ''}</td></tr></table>
        ${L.requirements?.length ? `<br><table><tr><th>Practical services (instructor signed off as passed)</th><th>Completed</th><th>Required</th></tr>${L.requirements.map((r: any) => `<tr><td>${esc(r.label)}</td><td>${esc(r.done)}</td><td>${esc(r.required)}</td></tr>`).join('')}</table>` : ''}
        <div class="sig"><div>Authorised school official — signature</div><div>Printed name & title<br>${esc(L.issuedBy)}</div><div>Date</div></div>
        <p class="notes">Verification code <b>${esc(L.code)}</b> — confirm this letter is genuine at ${esc(L.verifyUrl)}. Hours are measured by the school’s systems (server time), and every record is kept in a tamper-evident audit log.</p>`);
      return;
    }
    const rep = out?.report; if (!rep) return;
    printHtml(rep.title, `<h1>${esc(rep.title)}</h1><p class="sub">${esc(rep.subtitle)} · generated ${esc(new Date().toLocaleString())}</p>
      ${rep.summary ? `<div class="summary">${rep.summary.map((s: any[]) => `<div><b>${esc(s[1])}</b>${esc(s[0])}<br><span class="small">${esc(s[2])}</span></div>`).join('')}</div>` : ''}
      <table><tr>${rep.columns.map((c: string) => `<th>${esc(c)}</th>`).join('')}</tr>${rep.rows.map((r: any[]) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>
      <div class="notes">${(rep.notes || []).map((n: string) => `<p>${esc(n)}</p>`).join('')}</div>`);
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
