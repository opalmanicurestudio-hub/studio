'use client';
// src/components/academy/AdmissionReview.tsx
//
// REVIEW & DECISION — inside an applicant's panel (Admissions).
//   Review     documents · the program's checks · interview · optional rubric
//   Decision   a person decides: Accept · Accept with conditions · Waitlist ·
//              Not accepted. "Accept" needs everything complete; conditions
//              are prefilled with what's missing. Each decision emails a
//              letter (their language + English) and is kept for printing.
//   Offer      deadline (extend), conditions to tick off, their answer.
// Applying doesn't mean acceptance — the agreement only opens after an
// offer is made and accepted.

import { useState } from 'react';
import { printDocument, mdLite, type DocBrand } from '@/lib/doc-theme';

const field = 'h-10 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const dtt = (v?: string | null) => (v ? new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const DECIDABLE = ['applied', 'documents', 'review', 'waitlist'];
const TILES: [string, string, string][] = [
  ['accepted', '✅ Accept', 'Everything is complete'],
  ['conditional', '📝 Accept with conditions', 'Offer a place; list what’s still owed'],
  ['waitlisted', '⏳ Waitlist', 'Qualified, but no place right now'],
  ['not_accepted', '✉️ Not accepted', 'A respectful letter with the reason'],
];

export function AdmissionReview({ x, act, brand }: { x: any; act: (body: any, done?: string) => Promise<any>; brand?: DocBrand }) {
  const a = x.admission; const rv = x.review; const stage = a.stage === 'documents' ? 'review' : a.stage;
  const [iv, setIv] = useState({ at: '', where: '', with: '', notify: true });
  const [scores, setScores] = useState<Record<string, number>>(a.rubric?.[x.me] || {});
  const [dec, setDec] = useState<any>(null);
  const [setup, setSetup] = useState<{ checks: string; rubric: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const cohorts: any[] = x.cohorts || [];

  const choose = (outcome: string) => setDec({ outcome, cohortId: a.cohortId || '', offerDays: 7, message: '', conditions: outcome === 'conditional' ? rv.missing.join('\n') : '', reasonCode: '', reason: '', reapplyAfter: '' });
  const submit = async () => {
    if (!window.confirm(`Record this decision and email ${a.name} a letter?`)) return;
    setBusy(true);
    const r = await act({ action: 'decide', id: a.id, decision: { ...dec, conditions: String(dec.conditions || '').split('\n'), cohortId: dec.cohortId || null } }, 'Decision recorded — the letter has been sent.');
    setBusy(false); if (r?.ok) setDec(null);
  };
  const printLetter = (l: any) => brand && printDocument({ title: `${l.title} — ${a.name}`, brand, official: { date: new Date(l.at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }, body: `<p class="muted">${new Date(l.at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>${mdLite(l.body)}` });

  return (
    <div className="space-y-4">
      {/* The offer, once made */}
      {a.offer && ['offer', 'accepted', 'agreement', 'enrolled', 'withdrawn'].includes(stage) && (
        <section className="space-y-2 rounded-2xl border-2 border-violet-200 bg-violet-50/60 p-3 text-sm">
          <p className="font-black">{a.offer.fromWaitlist ? '🎟 Offer from the waitlist' : '🎟 Offer of admission'}{a.offer.auto ? ' · sent automatically' : ''}</p>
          <p>{a.offer.response === 'accepted' ? <>✓ Accepted on {dt(a.offer.respondedAt)}</> : a.offer.response === 'declined' ? <>Declined on {dt(a.offer.respondedAt)}{a.offer.declineReason ? ` — “${a.offer.declineReason}”` : ''}</> : a.offer.response === 'expired' ? <>Expired on {dt(a.offer.respondedAt)}</> : <>Waiting for their answer · accept by <b>{dt(a.offer.expiresAt)}</b></>}</p>
          {stage === 'offer' && <div className="flex gap-1.5">{[3, 7].map((d) => <button key={d} type="button" onClick={() => act({ action: 'offer-extend', id: a.id, days: d }, `Offer extended by ${d} days.`)} className="h-8 rounded-lg border-2 px-2 text-[12px] font-bold">+{d} days</button>)}</div>}
          {(a.offer.conditions || []).length > 0 && <div className="space-y-1"><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Conditions</p>
            {a.offer.conditions.map((c: any, i: number) => <label key={i} className="flex items-start gap-2 rounded-lg bg-background px-2 py-1.5"><input type="checkbox" className="mt-1" checked={!!c.met} onChange={(e) => act({ action: 'condition-met', id: a.id, index: i, met: e.target.checked })} /><span className={c.met ? 'text-muted-foreground line-through' : ''}>{c.text}</span>{c.met && c.by && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{c.by} · {dt(c.at)}</span>}</label>)}</div>}
        </section>
      )}

      {(a.answers || []).length > 0 && (
        <section className="space-y-1.5 rounded-2xl bg-muted/40 p-3 text-sm">
          <p className="font-black">📝 Their answers</p>
          {a.answers.map((x: any) => <div key={x.id}><p className="text-[12px] text-muted-foreground">{x.label}</p><p className="whitespace-pre-wrap">{x.value}</p></div>)}
        </section>
      )}

      {/* Review */}
      {['applied', 'review', 'waitlist'].includes(stage) && (
        <section className="space-y-3 rounded-2xl bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-black">🔎 Review {rv.ready ? <span className="text-emerald-700">· complete</span> : <span className="text-muted-foreground">· {rv.missing.length} to go</span>}</p>
            {stage === 'applied' && <button type="button" onClick={() => act({ action: 'start-review', id: a.id }, 'Moved to review.')} className="h-8 rounded-lg bg-foreground px-3 text-[12px] font-bold text-background">Start review</button>}
          </div>
          <p className="text-[12px]">Documents: {rv.docs.filter((d: any) => d.status === 'verified').length} of {rv.docs.length} verified {rv.docs.some((d: any) => d.status !== 'verified') && <span className="text-muted-foreground">(check them below)</span>}</p>
          <div className="space-y-1">
            {rv.checks.map((c: any) => (
              <label key={c.label} className="flex items-start gap-2 rounded-lg bg-background px-2 py-1.5">
                <input type="checkbox" className="mt-1" checked={!!c.done} onChange={(e) => act({ action: 'check-set', id: a.id, label: c.label, done: e.target.checked })} />
                <span className="min-w-0 flex-1">{c.label}{c.done && c.by && <span className="block text-[11px] text-muted-foreground">{c.by} · {dt(c.at)}{c.note ? ` · ${c.note}` : ''}</span>}</span>
              </label>
            ))}
            <button type="button" onClick={() => setSetup(setup ? null : { checks: x.setup.checks.join('\n'), rubric: x.setup.rubric.join('\n') })} className="text-[12px] font-bold underline">⚙ Checks for {x.program.name}</button>
            {setup && <div className="space-y-1.5 rounded-lg bg-background p-2">
              <p className="text-[12px] font-bold">Checks every applicant must meet <span className="font-normal text-muted-foreground">(one per line — applies to everyone applying to this program)</span></p>
              <textarea className="min-h-20 w-full rounded-xl border-2 p-2 text-sm" value={setup.checks} onChange={(e) => setSetup({ ...setup, checks: e.target.value })} />
              <p className="text-[12px] font-bold">Rubric criteria <span className="font-normal text-muted-foreground">(optional, scored 1–5)</span></p>
              <textarea className="min-h-14 w-full rounded-xl border-2 p-2 text-sm" value={setup.rubric} onChange={(e) => setSetup({ ...setup, rubric: e.target.value })} placeholder={'e.g. Motivation\nReadiness to start'} />
              <button type="button" onClick={async () => { const r = await act({ action: 'admission-setup-save', programId: a.programId, checks: setup.checks.split('\n'), rubric: setup.rubric.split('\n') }, 'Checks saved.'); if (r?.ok) setSetup(null); }} className="h-9 rounded-lg bg-foreground px-3 text-[12px] font-bold text-background">Save checks</button>
            </div>}
          </div>

          <InterviewBox a={a} act={act} />

          {rv.rubric.length > 0 && <div className="space-y-1.5 rounded-lg bg-background p-2">
            <p className="text-[12px] font-black">📊 Rubric <span className="font-normal text-muted-foreground">— your scores; the average is across reviewers</span></p>
            {rv.rubric.map((r: any) => <div key={r.criterion} className="flex flex-wrap items-center gap-1.5 text-[13px]"><span className="min-w-0 flex-1">{r.criterion}{r.avg != null && <span className="text-muted-foreground"> · avg {r.avg} ({r.count})</span>}</span>
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${r.criterion}: ${n}`} onClick={() => setScores({ ...scores, [r.criterion]: n })} className={`h-8 w-8 rounded-lg text-[12px] font-bold ${scores[r.criterion] === n ? 'bg-foreground text-background' : 'border-2'}`}>{n}</button>)}</div>)}
            <button type="button" onClick={() => act({ action: 'rubric-score', id: a.id, scores }, 'Scores saved.')} className="h-8 rounded-lg border-2 px-3 text-[12px] font-bold">Save my scores</button>
          </div>}
        </section>
      )}

      {/* Decision */}
      {DECIDABLE.includes(a.stage) && (
        <section className="space-y-2 rounded-2xl border-2 border-foreground/10 p-3 text-sm">
          <p className="font-black">⚖️ Decision <span className="font-normal text-muted-foreground">— made by a person, emailed as a letter, kept on the record</span></p>
          {!dec ? <div className="grid grid-cols-2 gap-1.5">{TILES.filter(([k]) => !(stage === 'waitlist' && k === 'waitlisted')).map(([k, l, h]) => <button key={k} type="button" onClick={() => choose(k)} className="rounded-xl border-2 p-2 text-left"><b className="text-[13px]">{l}</b><span className="block text-[11px] text-muted-foreground">{h}</span></button>)}</div> : (
            <div className="space-y-2">
              <p className="font-bold">{TILES.find(([k]) => k === dec.outcome)?.[1]}</p>
              {dec.outcome === 'accepted' && !rv.ready && <p className="rounded-lg bg-amber-50 p-2 text-[12px] text-amber-900">Not everything is complete: {rv.missing.join('; ')}. Use “Accept with conditions” instead, or finish the review first.</p>}
              {dec.outcome !== 'not_accepted' && cohorts.length > 0 && <label className="block text-[12px] font-bold">Cohort<select className={field} value={dec.cohortId} onChange={(e) => setDec({ ...dec, cohortId: e.target.value })}><option value="">No cohort yet</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.startDate ? ` · starts ${dt(c.startDate)}` : ''}{c.capacity ? ` · ${c.seatsTaken}/${c.capacity} places${c.seatsTaken >= c.capacity ? ' — FULL' : ''}` : ''}</option>)}</select></label>}
              {(dec.outcome === 'accepted' || dec.outcome === 'conditional') && <label className="block text-[12px] font-bold">Days to accept the offer<input type="number" min={1} max={30} className={field} value={dec.offerDays} onChange={(e) => setDec({ ...dec, offerDays: e.target.value })} /></label>}
              {dec.outcome === 'conditional' && <label className="block text-[12px] font-bold">Conditions <span className="font-normal text-muted-foreground">(one per line — they’re in the letter and you tick them off later)</span><textarea className="min-h-20 w-full rounded-xl border-2 p-2 text-sm" value={dec.conditions} onChange={(e) => setDec({ ...dec, conditions: e.target.value })} /></label>}
              {dec.outcome === 'not_accepted' && <>
                <label className="block text-[12px] font-bold">Reason<select className={field} value={dec.reasonCode} onChange={(e) => setDec({ ...dec, reasonCode: e.target.value })}><option value="">Choose…</option>{Object.entries(x.reasons).map(([k, v]: any) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label className="block text-[12px] font-bold">What we’ll tell them <span className="font-normal text-muted-foreground">(goes in the letter — kind and specific)</span><textarea className="min-h-20 w-full rounded-xl border-2 p-2 text-sm" value={dec.reason} onChange={(e) => setDec({ ...dec, reason: e.target.value })} placeholder="e.g. Applicants must be at least 16 at the start of the program." /></label>
                <label className="block text-[12px] font-bold">Welcome to reapply from <span className="font-normal text-muted-foreground">(optional)</span><input type="date" className={field} value={dec.reapplyAfter} onChange={(e) => setDec({ ...dec, reapplyAfter: e.target.value })} /></label>
              </>}
              <label className="block text-[12px] font-bold">A personal note <span className="font-normal text-muted-foreground">(optional, added to the letter)</span><textarea className="min-h-14 w-full rounded-xl border-2 p-2 text-sm" value={dec.message} onChange={(e) => setDec({ ...dec, message: e.target.value })} /></label>
              <div className="flex gap-2"><button type="button" disabled={busy || (dec.outcome === 'accepted' && !rv.ready)} onClick={submit} className="h-10 rounded-full bg-foreground px-5 text-sm font-bold text-background disabled:opacity-40">{busy ? 'Recording…' : 'Record decision & send letter'}</button><button type="button" onClick={() => setDec(null)} className="h-10 rounded-full px-4 text-sm font-bold">Cancel</button></div>
            </div>
          )}
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">Letters in<select className="h-8 rounded-lg border-2 px-1 text-[12px]" value={a.language || 'en'} onChange={(e) => act({ action: 'set-language', id: a.id, language: e.target.value })}>{Object.entries(x.languages || { en: { native: 'English' } }).map(([k, v]: any) => <option key={k} value={k}>{v.native}</option>)}</select>{(a.language || 'en') !== 'en' && '+ English original'}</label>
        </section>
      )}

      {(a.comms || []).length > 0 && (
        <details className="rounded-2xl bg-muted/40 p-3 text-sm"><summary className="cursor-pointer font-black">✉️ Messages sent to them · {a.comms.length}{a.textOk ? ' · texts on' : ''}</summary>
          <div className="mt-2 space-y-1">{[...a.comms].reverse().map((c: any, i: number) => <p key={i} className="text-[13px]"><span className="text-muted-foreground">{dt(c.at)}</span> · {c.subject}<span className="text-[11px] text-muted-foreground">{c.emailed ? ' · emailed' : ''}{c.texted ? ' · texted' : ''}{!c.emailed && !c.texted ? ' · not sent' : ''}</span></p>)}</div>
        </details>
      )}

      {/* Letters */}
      {(a.letters || []).length > 0 && (
        <section className="space-y-1.5">
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Letters</p>
          {[...a.letters].reverse().map((l: any, i: number) => <div key={i} className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm"><span className="min-w-0 flex-1"><b>{l.title}</b> · {dt(l.at)} · {l.by}{l.emailed ? ' · emailed' : ' · not emailed'}</span>{brand && <button type="button" onClick={() => printLetter(l)} className="text-[12px] font-bold underline">🖨 Print</button>}</div>)}
        </section>
      )}
    </div>
  );
}


/** The interview in every state: book · offer times · change requested · result. */
function InterviewBox({ a, act }: { a: any; act: (body: any, done?: string) => Promise<any> }) {
  const iv = a.interview; const first = String(a.name || '').split(' ')[0];
  const [mode, setMode] = useState<'book' | 'offer'>('offer');
  const [slots, setSlots] = useState<string[]>(['', '', '']); const [where, setWhere] = useState(iv?.where || ''); const [withWho, setWith] = useState(iv?.with || '');
  const iso = (v: string) => (v ? new Date(v).toISOString() : '');
  const planner = () => (
    <div className="space-y-1.5 rounded-lg bg-muted/40 p-2">
      <div className="flex gap-1">{([['offer', 'Offer times to choose from'], ['book', 'Book one time']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setMode(k)} className={`h-8 rounded-lg px-2 text-[12px] font-bold ${mode === k ? 'bg-foreground text-background' : 'border-2'}`}>{l}</button>)}</div>
      <div className="grid gap-1.5 sm:grid-cols-3">{(mode === 'offer' ? [0, 1, 2] : [0]).map((i) => <input key={i} type="datetime-local" className={field} value={slots[i]} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Interview time ${i + 1}`} />)}</div>
      <div className="grid gap-1.5 sm:grid-cols-2"><input className={field} value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Where (room, or video link)" aria-label="Where" /><input className={field} value={withWho} onChange={(e) => setWith(e.target.value)} placeholder="With (your name)" aria-label="With" /></div>
      <button type="button" disabled={mode === 'offer' ? !slots.some(Boolean) : !slots[0]} onClick={async () => {
        const r = mode === 'offer' ? await act({ action: 'interview-offer', id: a.id, slots: slots.filter(Boolean).map(iso), where, with: withWho }, `Times sent to ${first} to choose from.`)
          : await act({ action: 'interview-set', id: a.id, at: iso(slots[0]), where, with: withWho, whenText: new Date(slots[0]).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }) }, `Interview booked — ${first} has been told.`);
        if (r?.ok) setSlots(['', '', '']); }} className="h-9 rounded-lg bg-foreground px-3 text-[12px] font-bold text-background disabled:opacity-40">{mode === 'offer' ? `Send times to ${first}` : `Book and tell ${first}`}</button>
      <p className="text-[11px] text-muted-foreground">{first} is told by email{a.textOk ? ' and text' : ''}, and can ask for a different time from their application page.</p>
    </div>
  );
  return (
    <div className="space-y-1.5 rounded-lg bg-background p-2">
      <p className="text-[12px] font-black">🗓 Interview</p>
      {iv?.status === 'reschedule_requested' && <div className="space-y-1.5 rounded-lg border-2 border-amber-300 bg-amber-50 p-2 text-[13px]">
        <p className="font-bold text-amber-900">{first} asked for a different time{iv.previousAt ? ` (was ${dtt(iv.previousAt)})` : ''}</p>
        {iv.note && <p>“{iv.note}”</p>}
        {(iv.proposals || []).length > 0 ? <><p className="text-[12px]">Times that work for them — tap one to book it:</p><div className="flex flex-wrap gap-1.5">{iv.proposals.map((p: string, i: number) => <button key={p} type="button" onClick={() => act({ action: 'interview-accept', id: a.id, index: i }, `Booked for ${dtt(p)} — ${first} has been told.`)} className="h-9 rounded-lg bg-foreground px-3 text-[12px] font-bold text-background">{dtt(p)}</button>)}</div></> : <p className="text-[12px]">They didn’t suggest times — offer some below.</p>}
      </div>}
      {iv?.status === 'offered' && <p className="text-[13px]">⏳ Waiting for {first} to choose: {(iv.offers || []).map(dtt).join(' · ')}</p>}
      {iv?.status === 'scheduled' ? <>
        <p className="text-[13px]">{dtt(iv.at)}{iv.where ? ` · ${iv.where}` : ''} · with {iv.with}</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => act({ action: 'interview-result', id: a.id, status: 'done', note: window.prompt('Notes from the interview (optional)') || '' }, 'Interview recorded.')} className="h-8 rounded-lg border-2 border-emerald-300 px-2 text-[12px] font-bold text-emerald-800">Held ✓</button>
          <button type="button" onClick={() => act({ action: 'interview-result', id: a.id, status: 'no_show' }, 'Recorded as missed.')} className="h-8 rounded-lg border-2 px-2 text-[12px] font-bold">Didn’t attend</button>
          <button type="button" onClick={() => { const reason = window.prompt(`Cancel the interview? ${first} will be told. Add a short note (optional):`); if (reason !== null) void act({ action: 'interview-cancel', id: a.id, reason }, `Cancelled — ${first} has been told.`); }} className="h-8 rounded-lg px-2 text-[12px] font-bold text-red-700">Cancel</button>
        </div>
        <details className="text-[12px]"><summary className="cursor-pointer font-bold">Move it</summary>{planner()}</details>
      </> : <>
        {iv && ['done', 'no_show', 'cancelled'].includes(iv.status) && <p className="text-[12px] text-muted-foreground">Last: {iv.at ? dtt(iv.at) : ''} — {iv.status === 'done' ? 'held' : iv.status === 'no_show' ? 'missed' : 'cancelled'}{iv.note ? ` · “${iv.note}”` : ''}</p>}
        {planner()}
      </>}
    </div>
  );
}
