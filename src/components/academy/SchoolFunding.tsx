'use client';
// src/components/academy/SchoolFunding.tsx
//
// ACADEMY → FUNDING
//   Overview      this year's gifts and awards; each fund's raised / awarded /
//                 balance; a draft "How gifts have been used" (totals only,
//                 never names) to edit and publish on the Support page.
//   Gifts         every gift, receipts, CSV export.
//   Scholarships  applications from the website: answers, notes, a person's
//                 decision (award from a fund, or decline) — emailed.
//   Awards        what's been awarded and whether it's on the student's
//                 tuition yet (it applies itself when their plan is created);
//                 direct awards (e.g. an emergency grant).

import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { deviceId } from '@/lib/device';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const field = 'h-10 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const usd = (c: number) => `${(c || 0) < 0 ? '−' : ''}$${(Math.abs(Math.round(c || 0)) / 100).toLocaleString('en-US', { minimumFractionDigits: (c || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const day = (v?: string) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const STATUS: Record<string, string> = { new: 'New', reviewing: 'Reviewing', awarded: 'Awarded', declined: 'Not awarded', withdrawn: 'Withdrawn' };

function Decision({ a, funds, onDone }: { a: any; funds: string[]; onDone: (body: any) => Promise<any> }) {
  const [d, setD] = useState<any>({ outcome: '', amount: a.maxCents ? String(a.maxCents / 100) : '', fund: a.fund || funds[0], message: '' });
  if (['awarded', 'declined', 'withdrawn'].includes(a.status)) return null;
  return (
    <div className="space-y-2 rounded-xl border-2 border-foreground/10 p-3">
      <p className="text-sm font-black">⚖️ Decision <span className="font-normal text-muted-foreground">— made by a person, emailed to the applicant</span></p>
      <div className="flex gap-2">{[['awarded', '✅ Award'], ['declined', '✉️ Not this time']].map(([k, l]) => <button key={k} type="button" onClick={() => setD({ ...d, outcome: k })} className={`h-9 flex-1 rounded-lg text-[13px] font-bold ${d.outcome === k ? 'bg-foreground text-background' : 'border-2'}`}>{l}</button>)}</div>
      {d.outcome === 'awarded' && <div className="grid gap-2 sm:grid-cols-2"><label className="text-[12px] font-bold">Amount ($){a.maxCents ? ` — up to ${usd(a.maxCents)}` : ''}<input className={field} inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} /></label><label className="text-[12px] font-bold">Paid from<select className={field} value={d.fund} onChange={(e) => setD({ ...d, fund: e.target.value })}>{funds.map((f) => <option key={f} value={f}>{f}</option>)}</select></label></div>}
      {d.outcome && <textarea className="min-h-16 w-full rounded-xl border-2 p-2 text-sm" value={d.message} onChange={(e) => setD({ ...d, message: e.target.value })} placeholder="A personal note for the letter (optional)" />}
      {d.outcome && <button type="button" onClick={async () => { if (!window.confirm(`Record this decision and email ${a.name}?`)) return; await onDone({ outcome: d.outcome, amountCents: Math.round((Number(String(d.amount).replace(/[^0-9.]/g, '')) || 0) * 100), fund: d.fund, message: d.message }); }} className="h-10 rounded-full bg-foreground px-5 text-sm font-bold text-background">Record decision & email</button>}
    </div>
  );
}

export function SchoolFunding({ tenantId }: { tenantId: string }) {
  const [d, setD] = useState<any>(null); const [tab, setTab] = useState('overview'); const [open, setOpen] = useState<string | null>(null);
  const [report, setReport] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [direct, setDirect] = useState({ admissionId: '', amount: '', fund: '', reason: '' });
  const load = useCallback(async () => { const r = await api({ action: 'funding-summary', tenantId }); if (r.ok) { setD(r); setReport((x) => x || r.useReport || r.draft || ''); } else setErr(r.error || 'Couldn’t load.'); }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  const act = async (body: any, done: string) => { setErr(''); setMsg(''); const r = await api({ tenantId, ...body }); if (!r.ok) { setErr(r.error || 'Couldn’t save.'); return r; } setMsg(done); await load(); return r; };
  if (!d) return err ? <p className="text-sm text-red-700">{err}</p> : null;
  const y = d.summary.year_; const apps = d.apps.filter((a: any) => a.kind !== 'direct'); const awards = d.apps.filter((a: any) => a.status === 'awarded');
  const cur = d.apps.find((a: any) => a.id === open);
  const csv = () => {
    const rows = [['Date', 'Receipt', 'Amount', 'Fund', 'Name', 'Email', 'Business', 'Anonymous', 'Thanked by name', 'Message'], ...d.gifts.map((g: any) => [day(g.createdAt), g.receiptNo, (g.amountCents / 100).toFixed(2), g.fund, g.name, g.email || '', g.business || '', g.anonymous ? 'yes' : '', g.showName ? 'yes' : '', g.message || ''])];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })); a.download = `gifts-${d.summary.year}.csv`; a.click();
  };
  return (
    <div className="space-y-4">
      {!d.donorsOn && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">The Support our students page is off — turn it on in <b>Website → Donors</b> to take gifts online.</p>}
      {d.donorsOn && !d.canGive && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">Online giving needs your Stripe account connected (the same one tuition uses). Until then, the Support page asks people to contact you.</p>}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist">{[['overview', 'Overview'], ['gifts', `Gifts · ${d.gifts.length}`], ['scholarships', `Scholarships · ${apps.filter((a: any) => ['new', 'reviewing'].includes(a.status)).length} to review`], ['awards', `Awards · ${awards.length}`]].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setOpen(null); }} className={`h-9 shrink-0 rounded-full px-3 text-[13px] font-bold ${tab === k ? 'bg-foreground text-background' : 'bg-muted'}`}>{l}</button>)}</div>

      {tab === 'overview' && <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[[usd(y.raised), `given in ${d.summary.year}`], [String(y.donors), 'supporters'], [usd(y.awarded), 'awarded'], [String(y.students), 'students helped']].map(([v, l]) => <div key={l} className="rounded-2xl bg-muted/40 p-3"><p className="text-xl font-black tabular-nums">{v}</p><p className="text-[12px] text-muted-foreground">{l}</p></div>)}</div>
        <section className="overflow-hidden rounded-2xl border-2"><table className="w-full text-sm"><thead className="bg-muted/40 text-left text-[12px]"><tr><th className="px-3 py-2">Fund</th><th className="px-3 py-2 text-right">Raised</th><th className="px-3 py-2 text-right">Awarded</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
          <tbody>{d.summary.byFund.map((f: any) => <tr key={f.fund} className="border-t"><td className="px-3 py-2">{f.fund}</td><td className="px-3 py-2 text-right tabular-nums">{usd(f.raised)}</td><td className="px-3 py-2 text-right tabular-nums">{usd(f.awarded)}</td><td className={`px-3 py-2 text-right font-bold tabular-nums ${f.balance < 0 ? 'text-red-700' : ''}`}>{usd(f.balance)}</td></tr>)}</tbody></table></section>
        {d.summary.byFund.some((f: any) => f.balance < 0) && <p className="text-[12px] text-red-700">A negative balance means more was awarded from that fund than it has received — the school is covering the difference.</p>}
        <section className="space-y-2 rounded-2xl bg-muted/40 p-4">
          <p className="font-black">How gifts have been used <span className="font-normal text-muted-foreground">— shown on your Support page</span></p>
          <textarea className="min-h-32 w-full rounded-xl border-2 p-3 text-sm" value={report} onChange={(e) => setReport(e.target.value)} placeholder="Nothing to report yet — this fills in from your real gifts and awards." />
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setReport(d.draft)} disabled={!d.draft} className="h-9 rounded-full border-2 px-3 text-[12px] font-bold disabled:opacity-40">↻ Draft from this year’s numbers</button><button type="button" onClick={() => act({ action: 'funding-report-save', text: report }, 'Published on your Support page.')} className="h-9 rounded-full bg-foreground px-4 text-[12px] font-bold text-background">Publish on the website</button></div>
          <p className="text-[11px] text-muted-foreground">The draft uses totals only — never students’ or donors’ names.</p>
        </section>
      </>}

      {tab === 'gifts' && <section className="space-y-2">
        <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{d.nonprofit ? 'Receipts say gifts may be tax-deductible (nonprofit + EIN set).' : 'Receipts say gifts are not tax-deductible.'}</p>{d.gifts.length > 0 && <button type="button" onClick={csv} className="h-9 rounded-full border-2 px-3 text-[12px] font-bold">⬇ CSV</button>}</div>
        {d.gifts.length === 0 ? <p className="text-sm text-muted-foreground">No gifts yet.</p> : d.gifts.map((g: any) => <div key={g.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1"><b>{usd(g.amountCents)}</b> · {g.fund} · {g.business || g.name}{g.anonymous ? ' (anonymous)' : ''} · {day(g.createdAt)}<span className="block text-[12px] text-muted-foreground">{g.receiptNo}{g.email ? ` · ${g.email}` : ''}{g.message ? ` · “${g.message}”` : ''}</span></span>
          <button type="button" onClick={() => act({ action: 'funding-receipt', id: g.id }, 'Receipt sent.')} className="h-8 rounded-lg border-2 px-2 text-[12px] font-bold">Resend receipt</button>
        </div>)}
      </section>}

      {tab === 'scholarships' && (!cur ? <section className="space-y-2">
        {apps.length === 0 ? <p className="text-sm text-muted-foreground">No applications yet. Add scholarships in Website → Funding — they get an Apply form on your website.</p> :
          apps.map((a: any) => <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="flex w-full items-center gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-left text-sm"><span className="min-w-0 flex-1"><b>{a.name}</b> · {a.scholarship}<span className="block text-[12px] text-muted-foreground">Applied {day(a.createdAt)}</span></span><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${a.status === 'awarded' ? 'bg-emerald-100 text-emerald-800' : ['new', 'reviewing'].includes(a.status) ? 'bg-amber-100 text-amber-900' : 'bg-muted'}`}>{STATUS[a.status]}</span></button>)}
      </section> : <section className="space-y-3">
        <button type="button" onClick={() => setOpen(null)} className="text-sm font-bold">← All applications</button>
        <div><p className="text-xl font-black">{cur.name}</p><p className="text-sm text-muted-foreground">{cur.scholarship}{cur.maxCents ? ` (up to ${usd(cur.maxCents)})` : ''} · {cur.email}{cur.phone ? ` · ${cur.phone}` : ''} · applied {day(cur.createdAt)}{cur.admissionId ? ' · also in Admissions' : ''}</p></div>
        {[['Why they’re applying', cur.answers?.why], ['What it would make possible', cur.answers?.need], ['Their goals', cur.answers?.goals]].filter(([, v]) => v).map(([l, v]) => <div key={l} className="rounded-xl bg-muted/40 p-3 text-sm"><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{l}</p><p className="whitespace-pre-wrap">{v}</p></div>)}
        {['new', 'reviewing'].includes(cur.status) && <div className="flex gap-2">{cur.status === 'new' && <button type="button" onClick={() => act({ action: 'funding-status', id: cur.id, status: 'reviewing' }, 'Marked as reviewing.')} className="h-9 rounded-lg border-2 px-3 text-[12px] font-bold">Start review</button>}<button type="button" onClick={() => act({ action: 'funding-status', id: cur.id, status: 'withdrawn' }, 'Marked withdrawn.')} className="h-9 rounded-lg px-3 text-[12px] font-bold text-muted-foreground">They withdrew</button></div>}
        <div className="space-y-1.5"><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Review notes <span className="font-normal normal-case">(staff only)</span></p>{(cur.notes || []).map((n: any, i: number) => <p key={i} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">{n.text}<span className="block text-[11px] text-muted-foreground">{n.by} · {day(n.at)}</span></p>)}
          <div className="flex gap-2"><input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" aria-label="Add a note" /><button type="button" disabled={!note.trim()} onClick={async () => { const r = await act({ action: 'funding-note', id: cur.id, text: note }, 'Note added.'); if (r?.ok) setNote(''); }} className="h-10 shrink-0 rounded-xl bg-foreground px-3 text-sm font-bold text-background disabled:opacity-40">Add</button></div></div>
        {cur.decision && <p className="rounded-xl bg-muted/40 p-3 text-sm">{cur.status === 'awarded' ? `✅ Awarded ${usd(cur.awardCents)} from ${cur.fund}` : '✉️ Not awarded'} · {cur.decision.by} · {day(cur.decision.at)}{cur.letterEmailed === false ? ' · letter not emailed' : ''}</p>}
        <Decision a={cur} funds={d.funds} onDone={(decision) => act({ action: 'funding-decide', id: cur.id, decision }, 'Decision recorded and emailed.')} />
      </section>)}

      {tab === 'awards' && <>
        <section className="space-y-2">{awards.length === 0 ? <p className="text-sm text-muted-foreground">No awards yet.</p> : awards.map((a: any) => <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1"><b>{a.name}</b> · {usd(a.awardCents)} · {a.scholarship} · from {a.fund}<span className="block text-[12px] text-muted-foreground">{a.appliedAt ? `✓ On their tuition since ${day(a.appliedAt)}` : a.waitingForPlan || a.programId ? '⏳ Waiting — applies automatically when their enrolment agreement is signed' : 'Not linked to a program yet'}</span></span>
          {!a.appliedAt && <button type="button" onClick={() => act({ action: 'funding-apply', id: a.id }, 'Checked — applied if their tuition plan exists.')} className="h-8 rounded-lg border-2 px-2 text-[12px] font-bold">Apply now</button>}
        </div>)}</section>
        <section className="space-y-2 rounded-2xl bg-muted/40 p-4">
          <p className="font-black">Make a direct award <span className="font-normal text-muted-foreground">— e.g. an emergency grant or a kit</span></p>
          <select className={field} value={direct.admissionId} onChange={(e) => setDirect({ ...direct, admissionId: e.target.value })} aria-label="Student"><option value="">Choose a student…</option>{d.students.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.stage})</option>)}</select>
          <div className="grid gap-2 sm:grid-cols-3"><input className={field} inputMode="decimal" value={direct.amount} onChange={(e) => setDirect({ ...direct, amount: e.target.value })} placeholder="Amount ($)" aria-label="Amount" /><select className={field} value={direct.fund || d.funds[0]} onChange={(e) => setDirect({ ...direct, fund: e.target.value })} aria-label="From fund">{d.funds.map((f: string) => <option key={f} value={f}>{f}</option>)}</select><input className={field} value={direct.reason} onChange={(e) => setDirect({ ...direct, reason: e.target.value })} placeholder="What for (e.g. Kit grant)" aria-label="What for" /></div>
          <button type="button" disabled={!direct.admissionId || !direct.amount} onClick={async () => { if (!window.confirm('Record this award? It goes on the student’s tuition as a credit.')) return; const r = await act({ action: 'funding-direct', admissionId: direct.admissionId, amountCents: Math.round((Number(direct.amount.replace(/[^0-9.]/g, '')) || 0) * 100), fund: direct.fund || d.funds[0], reason: direct.reason }, 'Award recorded.'); if (r?.ok) setDirect({ admissionId: '', amount: '', fund: '', reason: '' }); }} className="h-10 rounded-full bg-foreground px-5 text-sm font-bold text-background disabled:opacity-40">Record award</button>
        </section>
      </>}
      {err && <p className="text-sm text-red-700">{err}</p>}{msg && <p className="text-sm text-emerald-800">{msg}</p>}
    </div>
  );
}
