'use client';
// src/components/visit/PhotosReplyCard.tsx — "MIA LOOKED AT YOUR PHOTOS", on the visit link (board 17B, "The team marks
// up too"). Once the team sends their marks on the client's inspiration photos (lib/markup/team), the visit link shows
// each photo with the client's own marks and the team's on separate layers (each can be shown or hidden), the team's
// note, and Compare (how it looks now beside the plan, when they sent a photo of that). They can say it looks good or
// reply (api/checkin/actions "photos_reply": a reply also reaches the business's inbox). Every mark is also written out
// in plain words, for screen readers. Never a private team note: the visit link isn't given any.
import * as React from 'react';
import { VisitCard, VisitButton } from '@/components/booking/VisitShell';
import { PhotoCompare } from '@/components/markup/PhotoCompare';
import { visitDevice } from '@/components/visit/VerifyCard';
import type { PhotosReply } from '@/lib/markup/team';

const GOOD = '#1f7a4d';

export function PhotosReplyCard({ reply, token, accent, onAnswered }: { reply: PhotosReply; token: string; accent: string; onAnswered?: () => void }) {
  const by = reply.by || 'The team';
  const [i, setI] = React.useState(0); const [mineOn, setMineOn] = React.useState(true); const [theirsOn, setTheirsOn] = React.useState(true);
  const [comparing, setComparing] = React.useState(false); const [writing, setWriting] = React.useState(false); const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [said, setSaid] = React.useState<{ text: string; ok?: boolean } | null>(null);
  const [broken, setBroken] = React.useState(false);
  const p = reply.photos[Math.min(i, reply.photos.length - 1)];
  React.useEffect(() => { setBroken(false); }, [p?.base]);
  const answer = async (kind: 'ok' | 'reply') => {
    if (busy) return; if (kind === 'reply' && !text.trim()) return;
    setBusy(true); setSaid(null);
    try {
      const r = await fetch('/api/checkin/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'photos_reply', token, device: visitDevice(), answer: kind, text: kind === 'reply' ? text.trim() : undefined }) });
      const d = await r.json().catch(() => null);
      if (d?.ok) { setSaid({ ok: true, text: kind === 'ok' ? `Thanks. ${by} will see that it looks good.` : `Sent. ${by} will see your reply.` }); setWriting(false); setText(''); onAnswered?.(); }
      else setSaid({ text: d?.error || 'That didn’t send. Please try again.' });
    } catch { setSaid({ text: 'That didn’t send. Check your connection and try again.' }); } finally { setBusy(false); }
  };
  if (!p) return null;
  const chip = (on: boolean, color?: string): React.CSSProperties => (on ? (color ? { background: color, color: '#fff' } : { background: 'var(--ink)', color: 'var(--paper)' }) : { background: 'var(--card, #fff)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--line)' });
  const done = said?.ok ? said.text : reply.answer ? (reply.answer.kind === 'ok' ? `You said it looks good. ${by} has seen that.` : `You replied: “${reply.answer.text || ''}”`) : null;
  const ratio = p.w && p.h ? `${p.w} / ${p.h}` : '4 / 5';
  const alt = `Photo ${p.n}${p.mine && mineOn ? ' with your marks' : ''}${theirsOn ? `${p.mine && mineOn ? ' and' : ' with'} ${by}’s marks: ${p.line}` : ''}`;
  return (
    <VisitCard>
      <section aria-label={`${by} looked at your photos`} className="space-y-3">
        <p className="text-[19px] font-semibold leading-snug">{by} looked at your photos</p>
        <div className="-mx-1 flex flex-wrap gap-2 px-1">
          {p.mine && <button type="button" role="switch" aria-checked={mineOn} onClick={() => setMineOn((v) => !v)} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold" style={chip(mineOn)}>Your marks</button>}
          <button type="button" role="switch" aria-checked={theirsOn} onClick={() => setTheirsOn((v) => !v)} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold" style={chip(theirsOn, GOOD)}>{by}’s marks</button>
          {reply.now && <button type="button" onClick={() => setComparing(true)} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold" style={chip(false)}>Compare</button>}
        </div>
        <div className="relative w-full overflow-hidden rounded-[20px]" style={{ aspectRatio: ratio, background: 'var(--soft)' }}>
          {broken ? <p className="absolute inset-0 grid place-items-center px-6 text-center text-[14.5px]" role="alert" style={{ color: 'var(--warn)' }}>This photo couldn’t be shown just now. Please try again later.</p> : <>
            <img src={p.base} alt={alt} onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-contain" />
            {p.mine && mineOn && <img src={p.mine} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-contain" />}
            {theirsOn && <img src={p.theirs} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-contain" />}</>}
        </div>
        {reply.photos.length > 1 && <div className="-mx-1 flex gap-2 overflow-x-auto px-1" role="group" aria-label="Photos">
          {reply.photos.map((q, k) => <button key={q.key} type="button" aria-pressed={k === i} onClick={() => setI(k)} className="inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-[14px] font-semibold" style={chip(k === i)}>Photo {q.n}</button>)}
        </div>}
        {(p.note || p.line) && <div className="space-y-1 rounded-2xl p-4" style={{ background: 'var(--soft)' }}>
          {p.note && <p className="text-[15px] leading-snug">“{p.note}” <span style={{ color: 'var(--muted)' }}>{by}</span></p>}
          {p.line && p.line !== 'No marks or note' && <p className="text-[13.5px] leading-snug" style={{ color: 'var(--muted)' }}>{by}’s marks: {p.line}</p>}
        </div>}
        {done ? <p className="text-[14.5px]" role="status" style={{ color: 'var(--good)' }}>{done}</p>
          : writing ? <div className="space-y-2">
              <label className="block"><span className="text-[14px]" style={{ color: 'var(--muted)' }}>Your reply to {by}</span>
                <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} rows={3} autoFocus className="mt-1 w-full rounded-2xl p-3 text-[16px] outline-none focus:ring-2" style={{ background: 'var(--card, #fff)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--line)' }} placeholder="A little shorter, please" /></label>
              <div className="grid grid-cols-2 gap-2"><VisitButton onClick={() => void answer('reply')} disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send reply'}</VisitButton><VisitButton quiet onClick={() => { setWriting(false); setText(''); setSaid(null); }}>Cancel</VisitButton></div>
            </div>
          : <div className="grid grid-cols-2 gap-2"><VisitButton onClick={() => void answer('ok')} disabled={busy}>{busy ? 'Sending…' : 'Looks good'}</VisitButton><VisitButton quiet onClick={() => { setWriting(true); setSaid(null); }}>Reply</VisitButton></div>}
        {said && !said.ok && <p className="text-[14px]" role="alert" style={{ color: 'var(--warn)' }}>{said.text}</p>}
      </section>
      {comparing && reply.now && <PhotoCompare now={{ src: reply.now, label: 'Now' }} accent={accent} viewer="client" who={undefined}
        goals={reply.photos.map((q) => ({ src: q.base, label: reply.photos.length > 1 ? `Photo ${q.n}` : 'The plan', over: [...(q.mine ? [q.mine] : []), q.theirs] }))} onClose={() => setComparing(false)} />}
    </VisitCard>);
}
