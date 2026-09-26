'use client';
// src/components/academy/AdmissionsBoard.tsx
//
// ADMISSIONS (licensed-school mode; owners and managers).
//   Pipeline   inquiry → tour → applied → documents → agreement → enrolled
//              Open an applicant: send their private application link, set
//              cohort / start, check documents, see the signed agreement and
//              countersign, tuition + ledger, record a payment, quote a
//              refund, withdraw (with reason), notes.
//   Tuition    every plan: balance, next payment, autopay, failures
//   Cohorts    start dates and capacity (full → new applicants waitlisted)

import { deviceId } from '@/lib/device';
import { printDocument, esc, heading, type DocBrand } from '@/lib/doc-theme';
import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader, Plus, X } from 'lucide-react';
import { PrivateImg, openPrivateFile } from '@/components/shared/private-file';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admissions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const $ = (c?: number | null) => (c == null ? '—' : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const field = 'h-10 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const COLS: [string, string][] = [['inquiry', 'Inquiry'], ['tour', 'Tour'], ['applied', 'Applied'], ['documents', 'Documents'], ['agreement', 'Signed'], ['enrolled', 'Enrolled']];

export function AdmissionsBoard({ tenantId, brand }: { tenantId: string; brand?: DocBrand }) {
  const [tab, setTab] = useState<'pipeline' | 'tuition' | 'cohorts'>('pipeline');
  const [d, setD] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [x, setX] = useState<any>(null);           // the open applicant
  const [tuition, setTuition] = useState<any>(null);
  const [add, setAdd] = useState<any>(null);
  const [cohort, setCohort] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => { const r = await api({ action: 'board', tenantId }); if (r.ok) setD(r); else setMsg(r.error); }, [tenantId]);
  const loadOne = useCallback(async (id: string) => { const r = await api({ action: 'get', tenantId, id }); if (r.ok) setX(r); else setMsg(r.error); }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (open) { setX(null); setQuote(null); void loadOne(open); } }, [open, loadOne]);
  useEffect(() => { if (tab === 'tuition' && !tuition) api({ action: 'tuition', tenantId }).then((r) => r.ok && setTuition(r)); }, [tab, tuition, tenantId]);
  const act = async (body: any, done?: string) => { const r = await api({ tenantId, ...body }); if (!r.ok) { setMsg(r.error); return r; } if (done) setMsg(done); if (open) await loadOne(open); await load(); setTuition(null); return r; };
  if (!d) return <Loader className="h-5 w-5 animate-spin" />;
  const progName = (id: string) => d.programs.find((p: any) => p.id === id)?.name || '—';
  const planId = x ? `${x.admission.programId}_${x.plan?.studentId || ''}` : '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">{([['pipeline', 'Pipeline'], ['tuition', 'Tuition'], ['cohorts', 'Cohorts']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-bold ${tab === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{l}</button>)}</div>
        <div className="flex gap-2">
          <a href={`/learn/${tenantId}/apply`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-full border-2 px-3 text-[13px] font-bold">Your apply page ↗</a>
          {tab === 'pipeline' && <button type="button" onClick={() => setAdd({ name: '', email: '', phone: '', programId: d.programs[0]?.id || '', note: '' })} className="inline-flex h-9 items-center gap-1 rounded-full bg-foreground px-4 text-[13px] font-bold text-background"><Plus className="h-4 w-4" />Add inquiry</button>}
        </div>
      </div>
      {msg && <p className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}

      {add && (
        <div className="grid gap-2 rounded-2xl border-2 border-foreground/30 p-3 sm:grid-cols-5">
          <input className={field} placeholder="Name" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
          <input className={field} placeholder="Email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} />
          <input className={field} placeholder="Phone" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} />
          <select className={field} value={add.programId} onChange={(e) => setAdd({ ...add, programId: e.target.value })}>{d.programs.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <div className="flex gap-1"><button type="button" onClick={async () => { const r = await act({ action: 'create', ...add, source: 'added by staff' }, 'Inquiry added.'); if (r.ok) setAdd(null); }} className="h-10 flex-1 rounded-xl bg-foreground text-sm font-bold text-background">Add</button><button type="button" onClick={() => setAdd(null)} className="px-2 text-muted-foreground" aria-label="Cancel"><X className="h-4 w-4" /></button></div>
        </div>
      )}

      {tab === 'pipeline' && (
        <>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {COLS.map(([k, l]) => { const items = d.admissions.filter((a: any) => a.stage === k).sort((a: any, b: any) => String(b.updatedAt).localeCompare(String(a.updatedAt))); return (
              <div key={k} className="w-64 shrink-0 space-y-2 rounded-2xl bg-muted/40 p-2">
                <p className="px-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground">{l} · {items.length}</p>
                {items.map((a: any) => (
                  <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="block w-full rounded-xl bg-background p-2.5 text-left text-sm shadow-sm">
                    <p className="truncate font-bold">{a.name}</p>
                    <p className="truncate text-[12px] text-muted-foreground">{progName(a.programId)}</p>
                    <p className="mt-1 flex flex-wrap gap-1 text-[10px] font-bold">
                      {a.docsTotal > 0 && <span className="rounded-full bg-muted px-1.5 py-0.5">docs {a.docsDone}/{a.docsTotal}</span>}
                      {a.signed && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-emerald-800">signed</span>}
                      {a.waitlisted && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-800">waitlist</span>}
                      {a.source && <span className="rounded-full bg-muted px-1.5 py-0.5">{a.source}</span>}
                    </p>
                  </button>
                ))}
              </div>
            ); })}
          </div>
          {d.admissions.some((a: any) => ['declined', 'withdrawn'].includes(a.stage)) && (
            <details className="text-sm"><summary className="cursor-pointer font-bold text-muted-foreground">Declined & withdrawn ({d.admissions.filter((a: any) => ['declined', 'withdrawn'].includes(a.stage)).length})</summary>
              <div className="mt-1 space-y-1">{d.admissions.filter((a: any) => ['declined', 'withdrawn'].includes(a.stage)).map((a: any) => <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="block text-left text-[13px] underline-offset-2 hover:underline">{a.name} · {a.stage} · {progName(a.programId)}</button>)}</div></details>
          )}
        </>
      )}

      {tab === 'tuition' && (!tuition ? <Loader className="h-5 w-5 animate-spin" /> : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-2xl bg-muted/40 p-3"><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Outstanding</p><p className="text-xl font-black">{$(tuition.totals.outstandingCents)}</p></div>
            <div className="rounded-2xl bg-muted/40 p-3"><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Past due</p><p className={`text-xl font-black ${tuition.totals.pastDue ? 'text-red-600' : ''}`}>{tuition.totals.pastDue}</p></div>
            <div className="rounded-2xl bg-muted/40 p-3"><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Plans</p><p className="text-xl font-black">{tuition.plans.length}</p></div>
          </div>
          {tuition.plans.map((p: any) => (
            <div key={p.id} className={`flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 text-sm ${p.status === 'past_due' ? 'bg-red-50' : 'bg-muted/40'}`}>
              <span className="min-w-0 flex-1 truncate font-bold">{p.name} <span className="font-normal text-muted-foreground">· {p.email}</span></span>
              <span className="text-[12px]">{p.status.replace(/_/g, ' ')} · instalments {p.installments}{p.nextDueAt ? ` · next ${dt(p.nextDueAt)}` : ''}{p.autopay ? ' · autopay' : ''}</span>
              <span className="font-black">{$(p.balanceCents)} due</span>
              {p.lastError && <span className="w-full text-[11px] text-red-700">Last attempt failed: {p.lastError} — the student was asked to update their card; it retries every 3 days.</span>}
            </div>
          ))}
          {tuition.plans.length === 0 && <p className="text-sm text-muted-foreground">No tuition plans yet — they start when an applicant signs their agreement.</p>}
        </div>
      ))}

      {tab === 'cohorts' && (
        <div className="space-y-2">
          {d.cohorts.map((c: any) => <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted/40 px-3 py-2 text-sm"><span className="font-bold">{c.name} <span className="font-normal text-muted-foreground">· {progName(c.programId)} · starts {dt(c.startDate)}{c.schedule ? ` · ${c.schedule}` : ''}</span></span><span className="text-[12px] font-bold">{c.enrolled}{c.capacity ? ` / ${c.capacity}` : ''} enrolled</span></div>)}
          {!cohort ? <button type="button" onClick={() => setCohort({ name: '', programId: d.programs[0]?.id || '', startDate: '', capacity: '', schedule: '' })} className="inline-flex h-9 items-center gap-1 rounded-full border-2 border-dashed px-4 text-sm font-bold"><Plus className="h-4 w-4" />New cohort</button> : (
            <div className="grid gap-2 rounded-2xl border-2 border-foreground/30 p-3 sm:grid-cols-3">
              <input className={field} placeholder="Name (e.g. Spring 2027 — Days)" value={cohort.name} onChange={(e) => setCohort({ ...cohort, name: e.target.value })} />
              <select className={field} value={cohort.programId} onChange={(e) => setCohort({ ...cohort, programId: e.target.value })}>{d.programs.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <input className={field} type="date" value={cohort.startDate} onChange={(e) => setCohort({ ...cohort, startDate: e.target.value })} />
              <input className={field} type="number" placeholder="Capacity" value={cohort.capacity} onChange={(e) => setCohort({ ...cohort, capacity: e.target.value })} />
              <input className={field} placeholder="Schedule (e.g. Tue–Sat 9–4)" value={cohort.schedule} onChange={(e) => setCohort({ ...cohort, schedule: e.target.value })} />
              <div className="flex gap-1"><button type="button" onClick={async () => { const r = await act({ action: 'cohort-save', cohort }, 'Cohort saved.'); if (r.ok) setCohort(null); }} className="h-10 flex-1 rounded-xl bg-foreground text-sm font-bold text-background">Save</button><button type="button" onClick={() => setCohort(null)} className="px-2 text-muted-foreground" aria-label="Cancel"><X className="h-4 w-4" /></button></div>
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="h-full w-full max-w-xl space-y-4 overflow-y-auto bg-background p-5 shadow-2xl">
            {!x ? <Loader className="h-5 w-5 animate-spin" /> : (() => { const a = x.admission; return (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div><p className="text-xl font-black">{a.name}</p><p className="text-sm text-muted-foreground">{a.email}{a.phone ? ` · ${a.phone}` : ''} · {x.program.name} · since {dt(a.createdAt)}{a.source ? ` · ${a.source}` : ''}</p></div>
                  <button type="button" onClick={() => setOpen(null)} className="p-1" aria-label="Close"><X className="h-5 w-5" /></button>
                </div>
                {a.message && <p className="rounded-2xl bg-muted/40 p-3 text-sm">“{a.message}”</p>}

                <div className="flex flex-wrap gap-2">
                  <select className="h-10 rounded-xl border-2 px-2 text-sm" value={a.stage} onChange={async (e) => { const stage = e.target.value; const note = ['declined', 'withdrawn'].includes(stage) ? window.prompt('Reason (kept on the record):') : ''; if (['declined', 'withdrawn'].includes(stage) && !note) return; await act({ action: 'stage', id: a.id, stage, note }, 'Stage updated.'); }}>
                    {['inquiry', 'tour', 'applied', 'documents', 'agreement', 'declined', 'withdrawn'].map((s) => <option key={s} value={s}>{s}</option>)}{a.stage === 'enrolled' && <option value="enrolled">enrolled</option>}
                  </select>
                  <button type="button" onClick={async () => { const r = await act({ action: 'send-link', id: a.id }); if (r?.ok) { try { await navigator.clipboard.writeText(r.link); } catch { /* ignore */ } setMsg(`Application link ${r.emailed ? 'emailed to' : 'created for'} ${a.name}${r.emailed ? '' : ' (copied — send it yourself)'}.`); } }} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background">{a.hasLink ? 'Send a new application link' : 'Send application link'}</button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-[12px] font-bold">Cohort<select className={field} value={a.cohortId || ''} onChange={async (e) => { if (!e.target.value) return; const r = await act({ action: 'cohort-assign', id: a.id, cohortId: e.target.value }); if (r?.ok) setMsg(r.waitlisted ? 'That cohort is full — added to its waitlist.' : 'Cohort set.'); }}><option value="">—</option>{d.cohorts.filter((c: any) => c.programId === a.programId).map((c: any) => <option key={c.id} value={c.id}>{c.name} · {dt(c.startDate)}</option>)}</select></label>
                  <label className="text-[12px] font-bold">Start date{a.waitlisted ? ' (waitlisted)' : ''}<input className={field} type="date" value={a.startDate || ''} onChange={(e) => act({ action: 'set-start', id: a.id, startDate: e.target.value })} /></label>
                </div>

                <section className="space-y-1.5">
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Documents</p>
                  {(a.requiredDocs || []).map((k: string) => { const doc = a.documents?.[k]; return (
                    <div key={k} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm">
                      {doc?.type?.startsWith('image/') && <PrivateImg src={doc.ref} alt={k} className="h-10 w-10 rounded-lg object-cover" />}
                      <span className="min-w-0 flex-1">{k} · <span className="font-bold">{doc ? doc.status : 'not uploaded'}</span>{doc?.reason ? ` — ${doc.reason}` : ''}</span>
                      {doc && <button type="button" onClick={() => openPrivateFile(doc.ref)} className="text-[12px] font-bold underline">Open</button>}
                      {doc && doc.status !== 'verified' && <button type="button" onClick={() => act({ action: 'doc-verify', id: a.id, docKey: k, verified: true }, `${k} verified.`)} className="h-8 rounded-lg border-2 border-emerald-300 px-2 text-[12px] font-bold text-emerald-800">Verify</button>}
                      {doc && doc.status !== 'rejected' && <button type="button" onClick={async () => { const reason = window.prompt(`Why can’t “${k}” be accepted? (the applicant will see this)`); if (reason) await act({ action: 'doc-verify', id: a.id, docKey: k, verified: false, reason }, `${k} sent back.`); }} className="h-8 rounded-lg border-2 border-red-200 px-2 text-[12px] font-bold text-red-700">Reject</button>}
                    </div>
                  ); })}
                </section>

                <section className="space-y-1.5">
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Enrolment agreement</p>
                  {a.agreement?.signedAt ? (
                    <div className="space-y-1 rounded-xl bg-muted/40 p-3 text-sm">
                      <p>Signed by <span className="font-bold">{a.agreement.signedName}</span> on {new Date(a.agreement.signedAt).toLocaleString()} · {a.agreement.ip || 'IP unknown'}</p>
                      <p className="break-all font-mono text-[11px] text-muted-foreground">Fingerprint {a.agreement.sha256}</p>
                      {a.agreement.countersignedBy ? <p className="text-emerald-700">✓ Countersigned by {a.agreement.countersignedBy} on {dt(a.agreement.countersignedAt)}</p> : <button type="button" onClick={() => act({ action: 'countersign', id: a.id }, 'Countersigned.')} className="h-9 rounded-lg bg-foreground px-3 text-[12px] font-bold text-background">Countersign for the school</button>}
                      {brand && <button type="button" onClick={() => printAgreement(a, progName(a.programId), brand)} className="h-9 rounded-lg border-2 px-3 text-[12px] font-bold">🖨 Print signed agreement</button>}
                      <details><summary className="cursor-pointer text-[12px] font-bold">Read what they signed</summary><pre className="mt-1 whitespace-pre-wrap text-[12px]">{a.agreement.text}</pre></details>
                    </div>
                  ) : <p className="text-sm text-muted-foreground">Not signed yet — they sign on their application page after uploading documents.</p>}
                </section>

                <section className="space-y-1.5">
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Tuition</p>
                  {!x.plan ? <p className="text-sm text-muted-foreground">The plan starts when they sign. {x.program.tuition ? `Total ${$(x.program.tuition.tuitionCents + x.program.tuition.registrationFeeCents + x.program.tuition.kitCents)}.` : 'Set tuition in Programs → Edit program.'}</p> : (
                    <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-sm">
                      <p><span className="font-black">{$(x.balance?.balanceCents)} due</span> · paid {$(x.balance?.paidCents)} of {$(x.balance?.chargedCents)} · {x.plan.status.replace(/_/g, ' ')}{x.plan.autopay ? ` · autopay ${x.plan.installmentsPaid}/${x.plan.installmentsTotal}, next ${dt(x.plan.nextDueAt)}` : ''}</p>
                      <div className="max-h-40 space-y-0.5 overflow-y-auto">{(x.balance?.entries || []).map((e: any, i: number) => <p key={i} className="text-[12px]">{dt(e.at)} · {e.type} · <span className="font-bold">{$(e.amountCents)}</span> · {e.desc} · {e.by}</p>)}</div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={async () => { const amt = window.prompt('Payment received ($) — e.g. cash or cheque:'); if (!amt) return; const desc = window.prompt('Note (e.g. “Cash, receipt #104”):') || 'Payment'; await act({ action: 'ledger-add', planId, type: 'payment', amountCents: Math.round(Number(amt) * 100), desc }, 'Payment recorded.'); }} className="h-9 rounded-lg border-2 px-3 text-[12px] font-bold">Record a payment</button>
                        <button type="button" onClick={async () => { const pct = window.prompt('How much of the program is complete (%)? Leave empty to use their recorded hours.'); const r = await api({ tenantId, action: 'refund-quote', planId, pctComplete: pct === '' || pct == null ? null : Number(pct) }); if (r.ok) setQuote(r); else setMsg(r.error); }} className="h-9 rounded-lg border-2 px-3 text-[12px] font-bold">Refund quote</button>
                      </div>
                      {quote && (
                        <div className="space-y-1 rounded-xl bg-background p-3">
                          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">If they withdraw now ({quote.pctComplete}% complete)</p>
                          {quote.quote.steps.map((s: string, i: number) => <p key={i} className="text-[13px]">{s}</p>)}
                          <button type="button" onClick={async () => { const reason = window.prompt('Reason for withdrawal (kept on the record):'); if (!reason) return; if (!window.confirm(`Withdraw ${a.name}? Autopay stops, their clinic bookings end, and the balance is closed under the refund policy.`)) return; await act({ action: 'withdraw', planId, pctComplete: quote.pctComplete, reason, recordRefund: true }, 'Withdrawn — issue any refund due from Stripe or by cheque.'); setQuote(null); }} className="mt-1 h-9 rounded-lg border-2 border-red-200 px-3 text-[12px] font-bold text-red-700">Withdraw with this calculation</button>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <section className="space-y-1.5">
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Notes & history</p>
                  <form onSubmit={async (e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('n') as HTMLInputElement; if (f.value.trim()) { await act({ action: 'note', id: a.id, text: f.value }); f.value = ''; } }} className="flex gap-2"><input name="n" className={field} placeholder="Add a note (e.g. toured Tuesday, wants evenings)" /><button className="h-10 rounded-xl bg-foreground px-3 text-sm font-bold text-background">Add</button></form>
                  {(a.notes || []).slice().reverse().map((n: any, i: number) => <p key={i} className="text-[12px]">{dt(n.at)} · {n.by}: {n.text}</p>)}
                  <p className="text-[11px] text-muted-foreground">{(a.history || []).map((h: any) => `${h.stage} ${dt(h.at)}`).join(' → ')}</p>
                </section>
              </>
            ); })()}
          </div>
        </div>
      )}
    </div>
  );
}


/** The signed enrolment agreement — official once the school has countersigned. */
function printAgreement(a: any, program: string, brand: DocBrand) {
  const g = a.agreement || {}; const d = (v: any) => (v ? new Date(v).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : '—');
  printDocument({
    title: `Enrolment agreement — ${a.name}`, brand,
    official: g.countersignedAt ? { label: 'For the school', date: new Date(g.countersignedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) } : false,
    footerNote: `Fingerprint ${g.sha256 || '—'} · the exact text signed is kept with this record`,
    body: `${heading('Enrolment', 'agreement')}<p class="sub">${esc(a.name)} · ${esc(program)}</p>
      <div style="white-space:pre-wrap">${esc(g.text || '')}</div>
      <h2>Student’s electronic signature</h2>
      <div class="panel">Signed by <b>${esc(g.signedName)}</b> on ${esc(d(g.signedAt))}${g.ip ? ` · IP ${esc(g.ip)}` : ''}<br><span class="muted">Fingerprint ${esc(g.sha256 || '—')}</span></div>
      ${g.countersignedAt ? `<p class="muted">Countersigned in ClarityFlow by ${esc(g.countersignedBy)} on ${esc(d(g.countersignedAt))}.</p>` : '<p class="warn">Not yet countersigned by the school.</p>'}`,
  });
}
