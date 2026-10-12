'use client';
// src/components/staff-portal/PrepSummary.tsx — "BEFORE THE VISIT" in the staff app's visit drawer (lib/prep-check):
// what the client answered (and their photo), the change it suggests and whether they agreed — or, when they didn't
// answer, the suggestion from the weeks since their last visit. A safety answer is shown first, in red. Read-only for
// now: approving the change onto the booking comes with Prep (round 2).
import * as React from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', BLUE = '#3d5a99', RED = '#b42318';
const money = (n: number) => `$${Number.isInteger(Math.round(n * 100) / 100) ? Math.round(n) : n.toFixed(2)}`;

export function PrepSummary({ apt }: { apt: any }) {
  const p = apt?.prep; const sug = apt?.prepSuggestion;
  if (!p && !sug && !apt?.prepSentAt) return null;
  const first = String(apt?.clientName || 'They').split(' ')[0];
  const q = p?.quote; const photos = Object.values(p?.answers || {}).filter((v: any) => typeof v === 'string' && /^https:\/\//.test(v)) as string[];
  const chip = p?.status === 'safety' ? { t: 'Call first', bg: '#fdecec', fg: RED } : p?.status === 'agreed' ? { t: 'Agreed', bg: '#e9f3ed', fg: GREEN } : p?.status === 'question' ? { t: 'Has a question', bg: '#fdf3e6', fg: '#b45309' } : p?.answeredAt ? { t: 'Answered', bg: '#e6ecf7', fg: BLUE } : { t: 'Not answered yet', bg: SOFT, fg: MUTED };
  return (
    <div className="space-y-2.5 rounded-[18px] border bg-white p-3.5 text-left" style={{ borderColor: p?.status === 'safety' ? '#f4c7c3' : LINE, color: INK }}>
      <div className="flex items-center justify-between gap-2"><p className="text-[15.5px] font-semibold">Before the visit</p><span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={{ background: chip.bg, color: chip.fg }}>{chip.t}</span></div>
      {p?.status === 'safety' && <p className="rounded-[12px] px-3 py-2.5 text-[13.5px]" style={{ background: '#fdecec', color: '#7a1d14' }}>{first} gave a safety answer. Talk to them before you start — moving the visit is free.</p>}
      {q && q.changed && <div className="rounded-[12px] px-3 py-2.5 text-[13.5px]" style={{ background: '#fdf3e6', color: '#7a3e05' }}><b>Suggested:</b> {(q.lines || []).join(' · ')}{q.newPrice !== q.oldPrice ? ` · ${money(q.oldPrice)} → ${money(q.newPrice)}` : ''}</div>}
      {q && !q.changed && p?.status !== 'safety' && <p className="text-[13.5px]" style={{ color: GREEN }}>No change from what {first} told us.</p>}
      {!p?.answeredAt && sug && <div className="rounded-[12px] px-3 py-2.5 text-[13.5px]" style={{ background: '#efe6f3', color: '#4d2d5a' }}><b>No answer —</b> {sug.why}. Suggests {sug.serviceName}.</div>}
      {photos.length > 0 && <div className="flex gap-2">{photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`${first}'s photo`} className="h-16 w-16 rounded-[12px] object-cover" /></a>)}</div>}
      {Array.isArray(p?.questions) && p.questions.length > 0 && <p className="text-[13px]" style={{ color: MUTED }}>Asked: “{p.questions[p.questions.length - 1].text}”</p>}
      {p?.agreedAt && <p className="text-[12px]" style={{ color: MUTED }}>Agreed {new Date(p.agreedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. Nothing has changed on the booking yet.</p>}
    </div>);
}
