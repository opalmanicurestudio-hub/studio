'use client';
// src/app/(app)/before-the-visit/page.tsx — BEFORE THE VISIT, THE DESK (approved design, canvas row 25 "Front desk → visits
// that need a decision"). The next 8 days of visits with a check (lib/prep-check): first what needs a person — a change
// that doesn't fit, a client's question, a safety answer — then what's waiting on the provider, clients picking a new
// time, and what's settled. For a change that doesn't fit: ask the client to pick a new time (free, not counted), keep it
// as booked (do what fits), approve it anyway when it fits now, or cancel with no fee — freed time goes to the waitlist.
import * as React from 'react';
import { collection, query, where, type Firestore } from 'firebase/firestore';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318', BLUE = '#3d5a99', PURPLE = '#7a4b8c';
const money = (n: number) => `$${Number.isInteger(Math.round(n * 100) / 100) ? Math.round(n) : n.toFixed(2)}`;
const STATE: Record<string, { label: string; bg: string; fg: string }> = {
  needs_desk: { label: 'Needs you', bg: '#fdf3e6', fg: AMBER }, question: { label: 'Has a question', bg: '#fdf3e6', fg: AMBER }, safety: { label: 'Call first', bg: '#fdecec', fg: RED },
  answered: { label: 'With the provider', bg: '#e6ecf7', fg: BLUE }, agreed: { label: 'Client agreed', bg: '#e6ecf7', fg: BLUE }, asked_move: { label: 'Picking a new time', bg: '#efe6f3', fg: PURPLE },
  approved: { label: 'On the booking', bg: '#e9f3ed', fg: GREEN }, kept: { label: 'Kept as booked', bg: SOFT, fg: INK }, moved: { label: 'Moved', bg: '#e9f3ed', fg: GREEN }, cancelled: { label: 'Cancelled, no fee', bg: SOFT, fg: MUTED },
};

export default function BeforeTheVisitDesk() {
  const { selectedTenant } = useTenant() as any; const { firestore } = useFirebase(); const tenantId = selectedTenant?.id || '';
  const [from] = React.useState(() => new Date(Date.now() - 3 * 3600e3).toISOString()); const [to] = React.useState(() => new Date(Date.now() + 8 * 864e5).toISOString());
  const q = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore as Firestore, `tenants/${tenantId}/appointments`), where('startTime', '>=', from), where('startTime', '<=', to)) : null), [firestore, tenantId, from, to]);
  const { data, isLoading } = useCollection<any>(q);
  const tz = selectedTenant?.timezone || 'America/New_York';
  const rows = (data || []).filter((a: any) => a.prep || a.prepSentAt).sort((a: any, b: any) => String(a.startTime).localeCompare(String(b.startTime)));
  const statusOf = (a: any) => (a.prep?.status || (a.prepSentAt ? 'waiting' : ''));
  const need = rows.filter((a) => ['needs_desk', 'question', 'safety'].includes(statusOf(a)));
  const provider = rows.filter((a) => ['answered', 'agreed'].includes(statusOf(a)) && a.prep?.quote?.changed);
  const moving = rows.filter((a) => statusOf(a) === 'asked_move');
  const settled = rows.filter((a) => ['approved', 'kept', 'moved', 'cancelled'].includes(statusOf(a)) || (['answered', 'agreed'].includes(statusOf(a)) && !a.prep?.quote?.changed));
  const waiting = rows.filter((a) => statusOf(a) === 'waiting');
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
  const group = (title: string, list: any[], sub?: string, actions = false) => list.length > 0 && <section className="space-y-2">
    <div className="flex items-baseline justify-between"><h2 className="text-[17px] font-semibold">{title} <span style={{ color: MUTED }}>· {list.length}</span></h2>{sub && <p className="text-[13px]" style={{ color: MUTED }}>{sub}</p>}</div>
    <div className="overflow-hidden rounded-[18px] border bg-white" style={{ borderColor: LINE }}>{list.map((a, i) => <Row key={a.id} a={a} first={i === 0} when={when} tenantId={tenantId} actions={actions} />)}</div></section>;
  return (
    <div className="min-h-full p-4 md:p-8" style={{ color: INK }}>
      <AppHeader title="Before the visit" />
      <div className="mx-auto mt-4 max-w-[1100px] space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>next 8 days</p><h1 className="text-[34px] font-normal tracking-[-0.03em]">{need.length ? `${need.length} visit${need.length === 1 ? ' needs' : 's need'} a decision` : 'Nothing needs you'}</h1>
          <p className="text-[14px]" style={{ color: MUTED }}>Nothing changes on a client’s booking or price until they’ve seen it. Changes we suggest are always free to move or cancel.</p></div>
          <a href="/settings/before-the-visit" className="inline-flex h-10 items-center rounded-full border bg-white px-4 text-[14px]" style={{ borderColor: LINE }}>Questions and rules</a></div>
        {isLoading && <p style={{ color: MUTED }}>Loading…</p>}
        {!isLoading && !rows.length && <p className="rounded-[18px] p-6 text-[14.5px]" style={{ background: SOFT, color: MUTED }}>No checks in the next 8 days. Turn on questions for a service in <a className="underline" href="/settings/before-the-visit">Settings → Before the visit</a>.</p>}
        {group('Needs you', need, 'Doesn’t fit, a question, or a safety answer', true)}
        {group('With the provider', provider, 'They approve or keep it — it comes here 12 h before if nobody has', true)}
        {group('Picking a new time', moving, 'Free and not counted — they choose from their visit link', true)}
        {group('Not answered yet', waiting, 'If they don’t answer, the weeks since their last visit decide the suggestion')}
        {group('Settled', settled)}
      </div>
    </div>);
}

function Row({ a, first, when, tenantId, actions }: { a: any; first: boolean; when: (iso: string) => string; tenantId: string; actions: boolean }) {
  const [busy, setBusy] = React.useState(''); const [msg, setMsg] = React.useState(''); const [confirm, setConfirm] = React.useState(false);
  const p = a.prep || {}; const q = p.quote; const st = p.status || 'waiting'; const look = STATE[st] || { label: 'Sent', bg: SOFT, fg: MUTED };
  const go = async (action: string) => { setBusy(action); setMsg(''); const r = await payPost('/api/prep-decide', { tenantId, appointmentId: a.id, action }); setBusy(''); setMsg(r.ok ? (action === 'cancel' && r.offered ? `Cancelled — offered to ${r.offered} on the waitlist.` : 'Done — the client has been told.') : r.error || 'That didn’t work.'); setConfirm(false); };
  const photos = Object.values(p.answers || {}).filter((v: any) => typeof v === 'string' && /^https:\/\//.test(v)) as string[];
  const phone = a.clientPhone || a.phone || '';
  const chip = (label: string, action: string, solid = false) => <button type="button" disabled={!!busy} onClick={() => go(action)} className="h-10 rounded-full px-4 text-[13.5px] font-semibold disabled:opacity-40" style={solid ? { background: INK, color: '#fff' } : { background: SOFT }}>{busy === action ? '…' : label}</button>;
  return (
    <div className="grid gap-3 p-4 md:grid-cols-[1fr_1.4fr_auto] md:items-start md:px-5" style={{ borderTop: first ? undefined : `1px solid ${LINE}` }}>
      <div><p className="text-[15px] font-semibold">{a.clientName || 'Client'} · {when(a.startTime)}</p><p className="text-[13px]" style={{ color: MUTED }}>{a.serviceName || 'Visit'}{a.staffName ? ` with ${String(a.staffName).split(' ')[0]}` : ''}{p.answeredAt ? ` · answered ${new Date(p.answeredAt).toLocaleDateString('en-US', { weekday: 'short' })}` : a.prepSentAt ? ' · asked, no answer yet' : ''}</p>
        {photos.length > 0 && <div className="mt-2 flex gap-1.5">{photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-12 w-12 rounded-[10px] object-cover" /></a>)}</div>}</div>
      <div className="space-y-2 text-[14px]">
        {st === 'safety' && <p className="rounded-[12px] px-3 py-2" style={{ background: '#fdecec', color: '#7a1d14' }}>Safety answer — call before anything else. Moving or cancelling is free.</p>}
        {q?.changed && st !== 'safety' && <p><b>{(q.lines || []).join(' · ')}</b>{q.newPrice !== q.oldPrice ? <span style={{ color: MUTED }}> · {money(q.oldPrice)} → {money(q.newPrice)}</span> : null}</p>}
        {!p.answeredAt && a.prepSuggestion && <p style={{ color: PURPLE }}>No answer — {a.prepSuggestion.why}. Suggests {a.prepSuggestion.serviceName}.</p>}
        {p.quote && !q?.changed && st !== 'safety' && <p style={{ color: GREEN }}>No change needed.</p>}
        {['needs_desk', 'answered', 'agreed', 'question'].includes(st) && q?.changed && <p className="text-[13px]" style={{ color: p.fits ? GREEN : AMBER }}>{p.fits ? `Fits${p.freeMinutes ? ` — ${p.freeMinutes} min free after` : ''}; the time is held.` : 'Doesn’t fit after this visit.'}</p>}
        {Array.isArray(p.questions) && p.questions.length > 0 && <p className="rounded-[12px] px-3 py-2" style={{ background: SOFT }}>“{p.questions[p.questions.length - 1].text}”</p>}
        {actions && ['needs_desk', 'question', 'safety', 'answered', 'agreed'].includes(st) && <div className="flex flex-wrap gap-1.5">
          {q?.changed && p.fits && st !== 'safety' && chip('Approve', 'approve', true)}
          {st !== 'safety' && q?.changed && chip('Ask them to pick a new time', 'move', !p.fits)}
          {chip('Keep as booked', 'keep')}
          {!confirm ? <button type="button" disabled={!!busy} onClick={() => setConfirm(true)} className="h-10 rounded-full px-4 text-[13.5px]" style={{ background: SOFT, color: RED }}>Cancel — no fee</button>
            : <button type="button" disabled={!!busy} onClick={() => go('cancel')} className="h-10 rounded-full px-4 text-[13.5px] font-semibold text-white" style={{ background: RED }}>{busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel it'}</button>}
          {phone && <a href={`tel:${phone}`} className="inline-flex h-10 items-center rounded-full px-4 text-[13.5px]" style={{ background: SOFT }}>Call</a>}</div>}
        {msg && <p className="text-[13px]" style={{ color: msg.startsWith('Done') || msg.startsWith('Cancelled') ? GREEN : RED }}>{msg}</p>}
      </div>
      <div><span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={{ background: look.bg, color: look.fg }}>{look.label}</span></div>
    </div>);
}
