'use client';
// src/components/staff-portal/PrepSummary.tsx — "BEFORE THE VISIT" in the staff app's visit drawer (lib/prep-check):
// what the client answered (and their photo), the change it suggests and whether they agreed — or, when they didn't
// answer, the suggestion from the weeks since their last visit. A safety answer is shown first, in red. The provider
// approves the change onto the booking (if it fits), keeps it as booked, or sends it to the desk (/api/prep-decide).
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { logHealthOpen } from '@/lib/health-view-client';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', GREEN = '#1f7a4d', BLUE = '#3d5a99', RED = '#b42318';
const money = (n: number) => `$${Number.isInteger(Math.round(n * 100) / 100) ? Math.round(n) : n.toFixed(2)}`;

export function PrepSummary({ apt, tenantId, solo = false }: { apt: any; tenantId: string; solo?: boolean }) {
  const [busy, setBusy] = React.useState(''); const [msg, setMsg] = React.useState(''); const [done, setDone] = React.useState('');
  const decide = async (action: string) => { setBusy(action); setMsg(''); const r = await payPost('/api/prep-decide', { tenantId, appointmentId: apt.id, action }); setBusy(''); if (r.ok) setDone(action); else setMsg(r.error || 'That didn’t work.'); };
  const p = apt?.prep; const sug = apt?.prepSuggestion;
  // Health information mode: the client's answers can include safety and health answers, so seeing them is recorded.
  React.useEffect(() => { if (apt?.prep?.answers && apt?.clientId) logHealthOpen(tenantId, { clientId: String(apt.clientId), what: 'Before-the-visit answers', appointmentId: apt.id ? String(apt.id) : null }); }, [apt?.id, apt?.clientId, tenantId]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!p && !sug && !apt?.prepSentAt) return null;
  const first = String(apt?.clientName || 'They').split(' ')[0];
  const q = p?.quote; const photos = Object.values(p?.answers || {}).filter((v: any) => typeof v === 'string' && /^https:\/\//.test(v)) as string[];
  const st = done === 'approve' ? 'approved' : done === 'keep' ? 'kept' : done === 'desk' ? 'needs_desk' : done === 'move' ? 'asked_move' : done === 'cancel' ? 'cancelled' : p?.status;
  const chip = st === 'approved' ? { t: 'On the booking', bg: '#e9f3ed', fg: GREEN } : st === 'kept' ? { t: 'Kept as booked', bg: SOFT, fg: INK } : st === 'needs_desk' ? { t: 'With the desk', bg: '#fdf3e6', fg: '#b45309' } : st === 'asked_move' ? { t: 'Picking a new time', bg: '#e6ecf7', fg: BLUE } : st === 'cancelled' ? { t: 'Cancelled, no fee', bg: SOFT, fg: MUTED } : p?.status === 'safety' ? { t: 'Call first', bg: '#fdecec', fg: RED } : p?.status === 'agreed' ? { t: 'Agreed', bg: '#e9f3ed', fg: GREEN } : p?.status === 'question' ? { t: 'Has a question', bg: '#fdf3e6', fg: '#b45309' } : p?.answeredAt ? { t: 'Answered', bg: '#e6ecf7', fg: BLUE } : { t: 'Not answered yet', bg: SOFT, fg: MUTED };
  return (
    <div className="space-y-2.5 rounded-[18px] border bg-card p-3.5 text-left" style={{ borderColor: p?.status === 'safety' ? '#f4c7c3' : LINE, color: INK }}>
      <div className="flex items-center justify-between gap-2"><p className="text-[15.5px] font-semibold">Before the visit</p><span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={{ background: chip.bg, color: chip.fg }}>{chip.t}</span></div>
      {p?.status === 'safety' && <p className="rounded-[12px] px-3 py-2.5 text-[13.5px]" style={{ background: 'color-mix(in srgb, #b42318 10%, transparent)', color: '#7a1d14' }}>{first} gave a safety answer. Talk to them before you start — moving the visit is free.</p>}
      {q && q.changed && <div className="rounded-[12px] px-3 py-2.5 text-[13.5px]" style={{ background: 'color-mix(in srgb, #b45309 10%, transparent)', color: 'var(--warn-ink)' }}><b>Suggested:</b> {(q.lines || []).join(' · ')}{q.newPrice !== q.oldPrice ? ` · ${money(q.oldPrice)} → ${money(q.newPrice)}` : ''}</div>}
      {q && !q.changed && p?.status !== 'safety' && <p className="text-[13.5px]" style={{ color: GREEN }}>No change from what {first} told us.</p>}
      {!p?.answeredAt && sug && <div className="rounded-[12px] px-3 py-2.5 text-[13.5px]" style={{ background: '#efe6f3', color: '#4d2d5a' }}><b>No answer —</b> {sug.why}. Suggests {sug.serviceName}.</div>}
      {photos.length > 0 && <div className="flex gap-2">{photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`${first}'s photo`} className="h-16 w-16 rounded-[12px] object-cover" /></a>)}</div>}
      {Array.isArray(p?.questions) && p.questions.length > 0 && <p className="text-[13px]" style={{ color: MUTED }}>Asked: “{p.questions[p.questions.length - 1].text}”</p>}
      {q?.changed && ['answered', 'agreed', 'question'].includes(String(st)) && <>
        <p className="text-[13px]" style={{ color: p?.fits ? GREEN : '#b45309' }}>{p?.fits ? `Fits${p?.freeMinutes ? ` — your next ${p.freeMinutes} minutes are free` : ''}. The extra time is held.` : (solo ? 'Doesn’t fit after this visit — ask them to pick a new time (free), or keep it and do what fits.' : 'Doesn’t fit after this visit — the desk can move it or keep it.')}</p>
        <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
          <button type="button" disabled={!!busy} onClick={() => decide('keep')} className="h-11 rounded-full border bg-card text-[14px] font-medium" style={{ borderColor: LINE }}>{busy === 'keep' ? '…' : 'Keep it'}</button>
          {p?.fits ? <button type="button" disabled={!!busy} onClick={() => decide('approve')} className="h-11 rounded-full text-[14px] font-semibold text-background" style={{ background: INK }}>{busy === 'approve' ? 'Approving…' : 'Approve'}</button>
            : solo ? <button type="button" disabled={!!busy} onClick={() => decide('move')} className="h-11 rounded-full text-[14px] font-semibold text-background" style={{ background: INK }}>{busy === 'move' ? 'Sending…' : 'Ask them to pick a new time'}</button>
            : <button type="button" disabled={!!busy} onClick={() => decide('desk')} className="h-11 rounded-full text-[14px] font-semibold text-background" style={{ background: INK }}>{busy === 'desk' ? 'Sending…' : 'Send to the desk'}</button>}</div>
        {solo && !p?.fits && <button type="button" disabled={!!busy} onClick={() => decide('cancel')} className="h-10 text-[13px]" style={{ color: RED }}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel it — no fee'}</button>}
        {p?.status !== 'agreed' && <p className="text-[12px]" style={{ color: MUTED }}>{first} hasn’t tapped “Looks right” yet — approving still tells them the final plan.</p>}</>}
      {st === 'approved' && <p className="text-[12.5px]" style={{ color: MUTED }}>{p?.auto ? 'Approved on its own — it fitted your free time.' : 'Approved'} — {first} has been told the final plan.</p>}
      {msg && <p className="text-[13px]" style={{ color: RED }}>{msg}</p>}
    </div>);
}
