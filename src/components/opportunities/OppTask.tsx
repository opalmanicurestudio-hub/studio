'use client';
// src/components/opportunities/OppTask.tsx — ONE TASK, worked (design canvas Op2–Op4, Op14). Used on the main app's
// Opportunities board (managers) and full-screen in the staff app. Why it's here, what it's roughly worth, the words to
// use (another approved wording, or send it as a text — every consent and limit is checked on the server), the number
// to call, and what happened: each answer shows what to say, then closes it, makes the follow-up, opens a case, or
// takes them off every list. /api/opportunities.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { PLAYBOOKS, OUTCOMES, TOOL_OF, dollars, type OutcomeId, type OppKind } from '@/lib/opportunities';

export const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318', BLUE = '#3d5a99';
export const EST = ({ cents, note }: { cents: number; note?: string | null }) => cents > 0
  ? <span className="inline-flex h-6 items-center whitespace-nowrap rounded-[8px] border border-dashed px-1.5 text-[11px] font-bold tracking-[0.05em]" style={{ borderColor: '#c9cacf', color: MUTED }} title={note || 'An estimate — not money yet'}>EST. {dollars(cents)}</span> : null;
export const PAID = ({ cents }: { cents: number }) => <span className="inline-flex h-6 items-center whitespace-nowrap rounded-[8px] px-1.5 text-[11px] font-bold tracking-[0.05em]" style={{ background: '#e9f3ed', color: GREEN }}>PAID {dollars(cents)}</span>;
const when = (iso: string) => { const d = new Date(iso); const days = Math.round((d.getTime() - Date.now()) / 864e5); return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
const ORDER: OutcomeId[] = ['booked', 'quote_accepted', 'interested', 'not_now', 'price', 'no_answer', 'voicemail', 'declined', 'bad_experience', 'stop', 'no_longer_applies', 'done'];

export function OppTask({ tenantId, item, manager = false, people = [], onChanged, onClose }: { tenantId: string; item: any; manager?: boolean; people?: any[]; onChanged: (closed?: boolean) => void; onClose?: () => void }) {
  const pb = PLAYBOOKS[item.kind as OppKind] || PLAYBOOKS.manual;
  const [msg, setMsg] = React.useState(item.message || ''); const [busy, setBusy] = React.useState(''); const [say, setSay] = React.useState<OutcomeId | null>(null);
  const [note, setNote] = React.useState(''); const [channel, setChannel] = React.useState<'call' | 'text' | 'in_person'>('call'); const [flash, setFlash] = React.useState<{ ok: boolean; t: string; at?: 'msg' | 'out' } | null>(null);
  React.useEffect(() => { setMsg(item.message || ''); setSay(null); setNote(''); setFlash(null); }, [item.id, item.message]);
  const go = async (action: string, extra: any = {}) => { setBusy(action); setFlash(null); const r = await payPost('/api/opportunities', { tenantId, action, id: item.id, ...extra }); setBusy(''); return r; };
  const open = item.status === 'open'; const branches = pb.branches; const allowed = new Set(branches.map((b) => b.id));
  const outcomes = ORDER.filter((o) => allowed.has(o) || ['no_longer_applies'].includes(o) || (o === 'voicemail' && allowed.has('no_answer')) || (o === 'declined' && item.kind !== 'manual'));
  const sayFor = (o: OutcomeId) => branches.find((b) => b.id === o)?.say || (o === 'voicemail' ? 'Keep it short: who you are, why you called, and that you’ll text too. No pressure.' : o === 'declined' ? '“Totally understand — thank you for letting me know.”' : '');
  const finish = async () => { if (!say) return; const r = await go('outcome', { outcome: say, note, channel });
    if (r.ok) { setFlash({ at: 'out', ok: true, t: r.closed ? (r.followUpId ? 'Done — the follow-up is on your list.' : r.caseId ? 'Done — a Making it right case is open.' : say === 'stop' ? 'Done — they won’t be contacted like this again.' : 'Done.') : 'Noted — it stays on your list.' }); setTimeout(() => onChanged(!!r.closed), 900); }
    else setFlash({ at: 'out', ok: false, t: r.error || 'That didn’t save.' }); };
  const phone = String(item.phone || '').trim();
  const reply = [...(item.attempts || [])].reverse().find((x: any) => x.by === 'client') || null;
  return (
    <div className="flex flex-col gap-3.5" style={{ color: INK }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-[12.5px]" style={{ color: MUTED }}>{pb.label}{item.assigneeName ? ` · ${item.assigneeName}` : ''}</p>
          <h2 className="text-[24px] font-light leading-tight tracking-[-0.02em]">{item.title || item.clientName || 'Task'}</h2></div>
        <div className="flex shrink-0 items-center gap-2"><EST cents={item.valueCents || 0} note={item.valueNote} />{onClose && <button type="button" onClick={onClose} aria-label="Close" className="text-[24px] leading-none" style={{ color: MUTED }}>×</button>}</div>
      </div>
      <div className="rounded-[16px] px-3.5 py-3 text-[13.5px] leading-[1.45]" style={{ background: SOFT }}>{item.why}{item.dueAt && open ? <span style={{ color: MUTED }}> · due {when(item.dueAt).toLowerCase()}</span> : null}</div>
      {item.result?.status === 'paid' && <p className="flex items-center gap-2 text-[13.5px]"><PAID cents={item.result.paidCents || 0} /> they came back after you reached out</p>}
      {item.result?.status === 'booked' && <p className="text-[13.5px]" style={{ color: GREEN }}>They’ve booked — it counts once the visit is paid.</p>}
      {manager && open && <label className="flex items-center justify-between gap-2 text-[14px]"><span>With</span>
        <select value={item.assigneeId || ''} disabled={!!busy} onChange={async (e) => { const r = await go('assign', { staffId: e.target.value || null }); if (r.ok) onChanged(); else setFlash({ ok: false, t: r.error }); }} className="h-10 max-w-[60%] rounded-[12px] border bg-white px-2 text-[14px]" style={{ borderColor: LINE }} aria-label="Who has this task">
          <option value="">Nobody yet</option>{people.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}

      {open && reply && <div className="space-y-2 rounded-[18px] p-3.5" style={{ background: '#eef6f1' }}>
        <p className="text-[12px] font-bold tracking-[0.04em]" style={{ color: GREEN }}>THEY REPLIED · {new Date(reply.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p>
        <p className="text-[15.5px] leading-[1.5]">{String(reply.note || '').replace(/^Replied: /, '')}</p>
        <p className="text-[12.5px]" style={{ color: MUTED }}><b style={{ color: INK }}>Next:</b> {pb.next.replace('{weeks}', item.facts?.weeks || '4')} Answer by phone, or in Messages from the business’s number.</p>
        {phone && <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="inline-flex h-11 items-center rounded-full px-4 text-[14px] font-semibold text-white" style={{ background: INK }}>Call {item.facts?.first || ''}</a>}
      </div>}
      {open && msg && <div className="space-y-2 rounded-[18px] border bg-white p-3.5" style={{ borderColor: LINE }}>
        <p className="text-[12px] font-bold tracking-[0.04em]" style={{ color: MUTED }}>SAY · OR SEND</p>
        <p className="text-[15.5px] leading-[1.5]">{msg}</p>
        <p className="text-[12.5px]" style={{ color: MUTED }}><b style={{ color: INK }}>When they answer:</b> {pb.next.replace('{weeks}', item.facts?.weeks || '4')}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {phone && <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="inline-flex h-11 items-center rounded-full px-4 text-[14px] font-semibold text-white" style={{ background: INK }}>Call {item.facts?.first || ''}</a>}
          <button type="button" disabled={!!busy} onClick={async () => { const r = await go('text'); if (r.ok) { setFlash({ at: 'msg', ok: true, t: r.via === 'email' ? 'Sent — by email (no mobile number worked).' : 'Sent. Replies come to your messages.' }); onChanged(false); } else setFlash({ at: 'msg', ok: false, t: r.error }); }}
            className="h-11 rounded-full border bg-white px-4 text-[14px] font-semibold disabled:opacity-40" style={{ borderColor: LINE }}>{busy === 'text' ? 'Sending…' : 'Send as a text'}</button>
          {pb.versions.length > 1 && <button type="button" disabled={!!busy} onClick={async () => { const r = await go('reword'); if (r.ok) setMsg(r.message); else setFlash({ at: 'msg', ok: false, t: r.error }); }} className="h-11 rounded-full px-3 text-[13.5px]" style={{ color: MUTED }}>Another wording</button>}
        </div>
        {flash && flash.at === 'msg' && <p className="text-[13.5px] font-semibold" style={{ color: flash.ok ? GREEN : RED }}>{flash.t}</p>}
        {pb.never && <p className="text-[12px]" style={{ color: RED }}><b>Never:</b> {pb.never}</p>}
      </div>}

      {open && item.clientId && ['appointments', 'memberships'].includes(TOOL_OF[item.kind as OppKind]) && <TimesPanel tenantId={tenantId} item={item} onChanged={onChanged} />}

      {open && <div className="space-y-2">
        <p className="text-[13px] font-bold" style={{ color: MUTED }}>What happened?</p>
        <div className="flex flex-wrap gap-1.5">{outcomes.map((o) => { const on = say === o; const tone = OUTCOMES[o].tone;
          return <button key={o} type="button" onClick={() => setSay(on ? null : o)} className="h-10 rounded-full px-3.5 text-[13.5px] font-semibold"
            style={on ? { background: INK, color: '#fff' } : tone === 'bad' ? { background: '#fdecec', color: '#7a1d14' } : { background: '#fff', border: `1px solid ${LINE}` }}>{OUTCOMES[o].label}</button>; })}</div>
        {say && <div className="space-y-2.5 rounded-[16px] p-3.5" style={{ background: OUTCOMES[say].tone === 'bad' ? '#fdf1f0' : OUTCOMES[say].tone === 'good' ? '#eef6f1' : SOFT }}>
          {sayFor(say) && <p className="text-[14px] leading-[1.45]">{sayFor(say)}</p>}
          <div className="flex gap-1.5">{(['call', 'text', 'in_person'] as const).map((c) => <button key={c} type="button" onClick={() => setChannel(c)} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={channel === c ? { background: INK, color: '#fff' } : { background: '#fff' }}>{c === 'call' ? 'By phone' : c === 'text' ? 'By text' : 'In person'}</button>)}</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={say === 'bad_experience' ? 'What did they say? (goes on the case)' : 'A note for next time (optional)'} aria-label="Note" className="w-full rounded-[12px] border bg-white p-2.5 text-[14px]" style={{ borderColor: LINE }} />
          <p className="text-[12.5px]" style={{ color: MUTED }}>{say === 'booked' ? 'Booked another way? Save it here. (Booking above closes it for you.) It counts once the visit is paid.' : say === 'not_now' ? 'Closes this one and puts a gentle follow-up on your list in 3 weeks.' : say === 'interested' ? 'Puts a follow-up on your list for tomorrow.' : say === 'no_answer' || say === 'voicemail' ? `Stays on your list. After ${3} tries it stops on its own.` : say === 'bad_experience' ? 'Opens a Making it right case. Nothing is offered to them while it’s open.' : say === 'stop' ? 'Takes them off every list — campaigns, reminders and tasks.' : say === 'price' ? 'Stays on your list.' : 'Closes it.'}</p>
          <button type="button" disabled={!!busy || (say === 'bad_experience' && !note.trim())} onClick={finish} className="h-11 w-full rounded-full text-[14.5px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy === 'outcome' ? 'Saving…' : `Save — ${OUTCOMES[say].label.toLowerCase()}`}</button>
          {flash && flash.at === 'out' && <p className="text-[13.5px] font-semibold" style={{ color: flash.ok ? GREEN : RED }}>{flash.t}</p>}
        </div>}
      </div>}
      {flash && !flash.at && <p className="text-[13.5px] font-semibold" style={{ color: flash.ok ? GREEN : RED }}>{flash.t}</p>}

      {(item.attempts || []).length > 0 && <div className="space-y-1"><p className="text-[12px] font-bold" style={{ color: MUTED }}>SO FAR</p>
        {[...item.attempts].reverse().map((a: any, i: number) => <p key={i} className="text-[13px]" style={{ color: MUTED }}>{new Date(a.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {a.byName} · {a.outcome ? OUTCOMES[a.outcome as OutcomeId]?.label : a.note}{a.outcome && a.note ? ` — “${a.note}”` : ''}</p>)}</div>}
      {item.status === 'waiting' && <div className="space-y-2 rounded-[16px] p-3.5 text-[13.5px] leading-[1.45]" style={{ background: '#eef2fa' }}><p><b>Sent automatically</b> on {new Date(item.autoSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. If they don’t book or reply by {new Date(item.escalateAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, it comes to {pb.who === 'provider' ? (item.providerName || 'their provider') : pb.who === 'desk' ? 'the desk' : 'the owner'}. A reply brings it to them straight away.</p>
        {manager && <button type="button" disabled={!!busy} onClick={async () => { const r = await go('escalate'); if (r.ok) onChanged(); else setFlash({ ok: false, t: r.error }); }} className="h-10 rounded-full bg-white px-4 text-[13.5px] font-semibold">Give it to a person now</button>}</div>}
      {item.status === 'auto' && <p className="rounded-[16px] p-3.5 text-[13.5px] leading-[1.45]" style={{ background: '#eef2fa' }}><b>Sent automatically</b> on {new Date(item.autoSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — no task for anyone. It closes as booked if they book, and on its own after {new Date(item.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. A reply comes to a person.</p>}
      {item.status === 'not_sent' && <p className="rounded-[16px] p-3.5 text-[13.5px]" style={{ background: '#fdf3e6', color: '#7a3e05' }}><b>Not sent automatically:</b> {item.notSentWhy}</p>}
      {!open && !['waiting', 'auto', 'not_sent'].includes(item.status) && <p className="text-[13.5px]" style={{ color: MUTED }}>{item.status === 'expired' ? 'Expired — it wasn’t worked in time.' : item.status === 'dismissed' ? `Set aside${item.dismissedBy ? ` by ${item.dismissedBy}` : ''}.` : `Closed${item.outcome ? ` — ${OUTCOMES[item.outcome as OutcomeId]?.label.toLowerCase()}` : ''}.`}</p>}
      {manager && open && <button type="button" disabled={!!busy} onClick={async () => { const r = await go('dismiss'); if (r.ok) onChanged(); }} className="self-start text-[13px] underline" style={{ color: MUTED }}>Not worth doing — set it aside</button>}
    </div>);
}

const DEPOSIT_WORDS: Record<string, string> = { card_hold: 'Hold their card on file', card_charge: 'Charge their card on file', later: 'Text them a deposit link', none: '' };
/** Step 2 (design canvas OE2): two real open times for their usual service, provider and day, today's menu price, and
 * the actions — text the times, book one, text a booking link, or add them to the waitlist. All through
 * /api/opportunities, which books through the same booking service as the client screen. */
function TimesPanel({ tenantId, item, onChanged }: { tenantId: string; item: any; onChanged: (closed?: boolean) => void }) {
  const [plan, setPlan] = React.useState<any>(null); const [price, setPrice] = React.useState<any>(null); const [busy, setBusy] = React.useState('');
  const [pick, setPick] = React.useState<string[]>([]); const [deposit, setDeposit] = React.useState(''); const [flash, setFlash] = React.useState<{ ok: boolean; t: string } | null>(null);
  React.useEffect(() => { setPlan(null); setPrice(null); setPick([]); setFlash(null); }, [item.id]);
  const call = async (action: string, extra: any = {}) => { setBusy(action); setFlash(null); const r = await payPost('/api/opportunities', { tenantId, action, id: item.id, ...extra }); setBusy(''); return r; };
  const find = async () => { const r = await call('times'); if (!r.ok) { setFlash({ ok: false, t: r.error || 'No times could be found.' }); return; }
    setPlan(r.plan); setPrice(r.price || null); const s = (r.plan?.suggestions || []).slice(0, 2).map((x: any) => x.startIso); setPick(s);
    const dep = Number(r.plan?.depositCents) || 0; setDeposit(dep === 0 ? 'none' : r.plan?.choices?.cardHold ? 'card_hold' : r.plan?.choices?.cardCharge ? 'card_charge' : 'later'); };
  const slots: any[] = (plan?.suggestions || []).slice(0, 4); const chosen = slots.filter((x) => pick.includes(x.startIso));
  const label = (x: any) => `${String(x.dayLabel || '').replace(/,/g, '')} · ${x.label}`;
  const toggle = (iso: string) => setPick((p) => (p.includes(iso) ? p.filter((x) => x !== iso) : [...p, iso].slice(-2)));
  const depOptions = Number(plan?.depositCents) > 0 ? [plan?.choices?.cardHold && 'card_hold', plan?.choices?.cardCharge && 'card_charge', 'later'].filter(Boolean) as string[] : [];
  if (!plan) return (
    <div className="space-y-2 rounded-[18px] border bg-white p-3.5" style={{ borderColor: LINE }}>
      <p className="text-[12px] font-bold tracking-[0.04em]" style={{ color: MUTED }}>BOOK IT FROM HERE</p>
      <p className="text-[13.5px]" style={{ color: MUTED }}>Two real open times for their usual service, provider and day, and today’s price from your menu.</p>
      <button type="button" disabled={!!busy} onClick={find} className="h-11 rounded-full px-4 text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy ? 'Finding times…' : 'Find two times'}</button>
      {flash && <p className="text-[13.5px] font-semibold" style={{ color: flash.ok ? GREEN : RED }}>{flash.t}</p>}
    </div>);
  if (plan.stage === 'already') return (
    <div className="space-y-2 rounded-[18px] p-3.5" style={{ background: '#eef6f1' }}>
      <p className="text-[14px]"><b>They already have a visit booked:</b> {plan.label}{plan.serviceName ? ` · ${plan.serviceName}` : ''}.</p>
      <p className="text-[12.5px]" style={{ color: MUTED }}>Close this task below as Booked or No longer applies.</p>
    </div>);
  return (
    <div className="space-y-2.5 rounded-[18px] border bg-white p-3.5" style={{ borderColor: LINE }}>
      <div className="flex items-baseline justify-between gap-2"><p className="text-[12px] font-bold tracking-[0.04em]" style={{ color: MUTED }}>{`${String(plan.serviceName || 'NEXT VISIT').toUpperCase()}${plan.staffName ? ` · WITH ${String(plan.staffName).toUpperCase()}` : ''}`}</p>
        <button type="button" onClick={find} disabled={!!busy} className="text-[12.5px] underline" style={{ color: MUTED }}>Refresh</button></div>
      {price && <p className="text-[13.5px]">Today’s price: <b>{price.from ? 'from ' : ''}{dollars(Math.round(price.dollars * 100))}</b> <span style={{ color: MUTED }}>(from your menu)</span></p>}
      {plan.why && <p className="text-[12.5px]" style={{ color: MUTED }}>{plan.why}</p>}
      {slots.length ? <div className="grid gap-1.5" role="group" aria-label="Open times">{slots.map((x, i) => { const on = pick.includes(x.startIso);
        return <button key={x.startIso} type="button" aria-pressed={on} onClick={() => toggle(x.startIso)} className="flex items-center justify-between rounded-[14px] border px-3 py-2.5 text-left" style={{ borderColor: on ? INK : LINE, borderWidth: on ? 1.5 : 1 }}>
          <span><span className="block text-[14px] font-semibold">{label(x)}</span><span className="block text-[12px]" style={{ color: MUTED }}>{x.staffName ? `With ${x.staffName}` : 'Anyone available'}{i === 0 ? ' · closest to their usual day and time' : ''}</span></span>
          {on && <span className="text-[16px]" aria-hidden="true">✓</span>}</button>; })}</div>
        : <p className="text-[13.5px]" style={{ color: AMBER }}>No open times in their usual window{plan.window ? ` (${plan.window.min}–${plan.window.max} weeks)` : ''}. Send a booking link so they can choose, or add them to the waitlist.</p>}
      {plan.others && <p className="text-[12.5px]" style={{ color: MUTED }}>Their usual provider has no openings then, so these are with others who do this service.</p>}
      {depOptions.length > 0 && chosen.length > 0 && <div className="space-y-1.5"><p className="text-[12.5px]" style={{ color: MUTED }}>A {dollars(Number(plan.depositCents))} deposit applies.</p>
        <div className="flex flex-wrap gap-1.5">{depOptions.map((d) => <button key={d} type="button" aria-pressed={deposit === d} onClick={() => setDeposit(d)} className="h-8 rounded-full px-3 text-[12.5px] font-semibold" style={deposit === d ? { background: INK, color: '#fff' } : { background: SOFT }}>{DEPOSIT_WORDS[d]}{d !== 'later' && plan.card ? ` (${plan.card})` : ''}</button>)}</div></div>}
      <div className="flex flex-wrap gap-2 pt-1">
        {chosen.length > 0 && <button type="button" disabled={!!busy} onClick={async () => { const r = await call('send_times', { startIsos: chosen.map((x) => x.startIso) }); setFlash(r.ok ? { ok: true, t: 'Sent. When they pick one, come back here and book it.' } : { ok: false, t: r.error }); if (r.ok) onChanged(false); }}
          className="h-11 rounded-full px-4 text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy === 'send_times' ? 'Sending…' : chosen.length === 2 ? 'Text these two times' : 'Text this time'}</button>}
        {chosen.length === 1 && <button type="button" disabled={!!busy} onClick={async () => { const x = chosen[0]; const r = await call('book', { startIso: x.startIso, staffId: x.staffId, deposit });
          if (r.ok) { setFlash({ ok: true, t: `Booked ${r.label}.${r.depositNote ? ` ${r.depositNote}` : ''}` }); setTimeout(() => onChanged(true), 1200); } else setFlash({ ok: false, t: r.error }); }}
          className="h-11 rounded-full border bg-white px-4 text-[14px] font-semibold disabled:opacity-40" style={{ borderColor: INK }}>{busy === 'book' ? 'Booking…' : `Book ${label(chosen[0])}`}</button>}
        <button type="button" disabled={!!busy} onClick={async () => { const r = await call('send_link'); setFlash(r.ok ? { ok: true, t: 'Booking link sent. It closes as booked when they book.' } : { ok: false, t: r.error }); if (r.ok) onChanged(false); }}
          className="h-11 rounded-full border bg-white px-4 text-[14px] font-semibold disabled:opacity-40" style={{ borderColor: LINE }}>{busy === 'send_link' ? 'Sending…' : 'Text a booking link'}</button>
        {plan.waitlist !== false && <button type="button" disabled={!!busy} onClick={async () => { const r = await call('waitlist'); if (r.ok) { setFlash({ ok: true, t: 'Added to the waitlist.' }); setTimeout(() => onChanged(true), 900); } else setFlash({ ok: false, t: r.error }); }}
          className="h-11 rounded-full px-3 text-[13.5px]" style={{ color: MUTED }}>{busy === 'waitlist' ? 'Adding…' : 'Add to waitlist'}</button>}
      </div>
      {chosen.length === 2 && <p className="text-[12px]" style={{ color: MUTED }}>Tap one time to book it straight away.</p>}
      {flash && <p className="text-[13.5px] font-semibold" style={{ color: flash.ok ? GREEN : RED }}>{flash.t}</p>}
    </div>);
}
