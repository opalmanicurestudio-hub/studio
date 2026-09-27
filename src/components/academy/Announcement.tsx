'use client';
// src/components/academy/Announcement.tsx — one announcement, for students.
//   ✓ Got it        hides it from then on (staff see "12 of 30 got it")
//   Add to calendar when it has a date: Apple/Outlook (.ics) or Google
// Pure: the parent does the saving (onAck), so there's no import cycle.
import { useState } from 'react';
import { icsHref, googleHref } from '@/lib/ics';

export interface AnnWords { gotIt: string; addToCalendar: string; translatedNote?: string }
export function AnnouncementItem({ a, title, body, dateText, school, color, words, onAck, translated }: {
  a: any; title: string; body: string; dateText: string; school: string; color: string; words: AnnWords; onAck?: (id: string) => Promise<void>; translated?: boolean;
}) {
  const [busy, setBusy] = useState(false); const [cal, setCal] = useState(false);
  const ev = a.eventAt ? { title: school ? `${a.title} — ${school}` : a.title, start: a.eventAt, end: a.eventEndAt, location: a.location, details: a.body, uid: a.id } : null;
  const when = a.eventAt ? new Date(a.eventAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <div className={`space-y-1.5 py-2 ${a.acked ? 'opacity-60' : ''}`}>
      <p className="font-semibold">{title}</p>
      {ev && <p className="text-[13px] font-medium" style={{ color }}>📅 {when}{a.location ? ` · ${a.location}` : ''}</p>}
      <p className="whitespace-pre-wrap text-[15px] text-stone-700">{body}</p>
      <p className="text-[11px] text-stone-400">{dateText}{translated && words.translatedNote ? ` · ${words.translatedNote}` : ''}</p>
      <div className="flex flex-wrap gap-2 pt-0.5">
        {!a.acked && onAck && <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onAck(a.id); } finally { setBusy(false); } }} className="h-10 rounded-full px-4 text-[13px] font-medium text-white disabled:opacity-50" style={{ background: color }}>✓ {words.gotIt}</button>}
        {a.acked && <span className="inline-flex h-10 items-center text-[13px] text-emerald-700">✓ {words.gotIt}</span>}
        {ev && (!cal ? <button type="button" onClick={() => setCal(true)} className="h-10 rounded-full bg-white px-4 text-[13px] shadow-sm">📅 {words.addToCalendar}</button> : <>
          <a href={icsHref(ev)} download={`${a.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'event'}.ics`} className="inline-flex h-10 items-center rounded-full bg-white px-4 text-[13px] shadow-sm">Apple / Outlook</a>
          <a href={googleHref(ev)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full bg-white px-4 text-[13px] shadow-sm">Google</a>
        </>)}
      </div>
    </div>
  );
}
